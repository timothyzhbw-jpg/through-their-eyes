# Hero moment expansion pack — design draft (2026-10-20)

> **Decided 2026-10-20 (Bowen): build all of it, in the order of §0.** That is C4, Module A, C1,
> C2, then C5, C3 and C4's lofted delivery, aerial duel and header finish, one sim change at a
> time.
> - Every gate and the freeze (Mon 10/26 12:00 CT) still apply. A moment whose gate fails, or
>   that is not merged by the freeze, is cut and reported, never shipped weaker.
> - Each moment's text moves into `docs/SPEC.md` (§3.6, §5, §6) in the PR that lands it. C4 is
>   there now.
> - Facts about the code were checked on main at `7b0ee3f` (2026-10-20). Every citation below was
>   read on 2026-10-20; its status column says how far (full text, abstract, or a secondary
>   source).

## 0. Pitch, recommendation and what it costs

**Pitch.** Every phase of play is decided by what a player saw: building up (`blind_side_run`),
escaping the press (`press_escape`), shooting, saving, defending. House pattern, unchanged: the key
look or step is scripted (like `ForcedScan`); everything it causes comes from the model.

**Recommendation (revised 2026-10-20, with Bowen's two extra candidates).** Build in this order,
one sim change at a time:
1. **C4 — the set piece, low delivery** (§5). The marker keeps his eyes on the ball and loses the
   runner on his blind side.
   - It needs no shot module, so it can come first.
   - It is Bowen's best thesis fit, and the live blind-side alert already exists for it.
2. **Module A — shots and keepers.** Behind a new `Scenario.shots` flag.
3. **C1 — the striker reads the keeper.**
4. **C2 — the keeper's sightline.**

Fallback and cuts:
- **C5, first-touch direction** (§6), is the fallback. If any gate fails, it takes the freed sim
  slot. It does not fit as a stretch goal on top of the four above.
- **C3** is cut: C4's marking-on-belief tells the same defender story more cheaply.
- **The lofted delivery, aerial duel and header finish** for C4 do not fit before the freeze (§5.7).

| | Sim | Explain + agents + API | Web | Total | Needs | Reuses | Value |
|---|---|---|---|---|---|---|---|
| C4 set piece, low delivery (`drop_scan`) | 1 d | 1 d (incl. 0.5 d for a hero without a ball decision, H) | labels | 2 d | — | ForcedScan, `drop_scan`, blind-side alert, belief ghosts, most claims | very high: the thesis on a set piece, live alert in broadcast |
| Module A (shots, keeper, save, goal) | 1.5 d | 0.25 d (goal / save / big-chance detectors) | — | 1.75 d | — | ball physics, vision, keyed RNG, Gumbel-max | enabler: goals in `match-2`, C1 and C2 |
| C1 striker reads the keeper | 0.5 d | 0.75 d | labels | 1.25 d | A | ForcedScan, `drop_scan`, scan lens, what-if, most claim builders | medium-high: shooting; overlaps ReSpo.Vision's demo |
| C2 keeper's sightline | 1 d | 0.75 d (H already paid by C4) | step toggle, keeper POV | 1.75 d | A, H | `analytics.vision.visibility`, occlusion shader | very high: the most original POV (occlusion) |
| C5 first-touch direction | 1.5 d | 0.75 d | labels | 2.25 d | — | `_p_win_ball` / carry scoring, free-ball control, scan lens | high: the textbook payoff of scanning; visually subtle |
| C3 defender anticipates | 1.5 d | 1 d | labels | 2.5 d | — | `evaluate_options` on the defender's belief, in-flight interception | medium: superseded by C4 |
| C4 add-on: lofted delivery | 0.75 d | — | 0.5 d (the ball's height) | 1.25 d | C4 | ball parameters, energy test | medium: looks like a real corner |
| C4 add-on: aerial duel + header finish | 1.5 d | 0.5 d | header pose | 2 d | A, lofted | save model | medium; blocked on uncited header parameters |

The core is C4 + A + C1 + C2: 4 sim days of the 5 available (Wed–Sun) and 2.75 explain days.

Why C4 first: it is the cheapest independent candidate, it reuses the most, and it lands a new
moment by Thursday whatever happens to the shot module. Why A, C1 and C2 after it:
- C1 runs through the existing scan lens, `drop_scan`, what-if and decision-moment plumbing
  almost unchanged: the hero is still a ball carrier making a decision on his belief. It is also
  the cheapest test bed for Module A.
- C2 is the more original moment. No competing entry and no commercial POV product
  (REFERENCES, ReSpo.Vision) shows a keeper's occluded view and what one step changed. But it
  needs a new intervention (`drop_step`), a hero without a ball decision, and a new lens.
- C1 overlaps ReSpo.Vision's own example, "a goal through a striker's eyes". Our difference is the
  counterfactual: without the look he goes near post and is saved.

## 1. Module A — shots and keepers (SPEC 3.3 "shot outcomes M4")

### 1.1 Flag and scope
- `Scenario.shots: bool = False`, like `Scenario.tackles`. With the flag off, nothing in this
  section runs and no new random draw is made. So `blind_side_run`, `press_escape`,
  `possession_play` and `match-1` keep their runs byte for byte (§8).
- With the flag on:
  - placed shots (near / far post) replace the single `shot` option;
  - shots are struck at shot speed with an aim error;
  - the keeper positions himself and starts to react only once he sees the ball;
  - a save model resolves every shot on target;
  - the sim emits `shot`, `dive`, `save`, `goal` and `out` events.
- Low driven shots only: the ball stays on the ground, using the closed-form rolling physics
  already in `sim/ball.py`. Lofted shots, height, deflections and rebounds stay out of scope. A
  save is held (the keeper's team gets the ball). An outfield player within the control radius of
  the shot's path still takes the ball, as a block (`_check_control`, unchanged).

### 1.2 Geometry and placement
- Goal 7.32 m wide (Laws of the Game), posts at y = ±3.66 m, goal line x = ±52.5 m.
- Near post: the post on the shooter's side of the goal's centreline (sign of y_shooter). Within
  |y_shooter| < 1 m, it is the side the last pass came from.
- Options `shot:near` and `shot:far`, aimed at y_aim = ±(3.66 − m_in), m_in = 0.5 m inside the
  post (*tunable*). They replace `shot`, which keeps `shot_range` 30 m.

### 1.3 Shot kick
- Speed v_s ~ U(24, 30) m/s, a keyed draw per shot. This sits inside the 18–35 m/s range of
  maximal instep kicks (Kellis & Katis 2007); a placed first-time shot is below maximal. The
  band itself is *tunable*.
- Aim error: a lateral angle ε ~ N(0, σ_θ), keyed by (seed, `shot_error`, shooter, frame), so the
  factual and counterfactual runs share it (SPEC 3.7). σ_θ = 2.5° (*tunable*, about 0.57 m of
  lateral spread at 13 m).
  - Hunter et al. (2018, J Biomech) show error variance rising as a power function of ball speed,
    with low targets more precise. We use that shape only: we have not read their fitted values,
    so we claim no number from the paper.
- The kick is `_kick_pass` with the shot speed instead of `pass_speed`. Event
  `shot:<player>:<frame>` with attrs `placement` (near | far), `aim_y`, `speed`, `distance`,
  `crossing_y` (filled when resolved) and `outcome` (goal | saved | wide | blocked).

### 1.4 Keeper position (scripted helper, not a general model)
- Bisector rule: the keeper stands on the bisector of the angle the ball makes with the two posts,
  `gk_depth` = 1.5 m off his line (*tunable*). He moves toward that point at up to his role's
  v_max and A_MAX.
- This is a convention, not a cited model. It runs only for keepers in scenarios with the flag (as
  a `scripted_targets` helper), so open play has no new keeper behaviour.

### 1.5 When the keeper sees the ball
- V_k(ball, f) = `analytics.vision.visibility(keeper, head_yaw, speed, ball_xy, occluders = every
  other player)`. These are the same field of view and soft occlusion the sim already uses for
  players: Bekkers 2026, body radius 0.3 m, occlusion_max 0.9.
- t_seen = the first frame at or after the strike with V_k ≥ 0.5 (the sim's perception threshold).
- The keeper's head tracks the ball as everyone's does.

### 1.6 Save model (equations)
Let t_cross be the time the ball reaches the keeper's plane (his x). y_c is its lateral position
there, y_k the keeper's lateral position when he sees the ball, and d = |y_c − y_k| (low shots, so
height is ignored).

- **Time to react:** T = t_cross − t_seen (s). If he never sees the ball before t_cross, T = 0.
- **Reach for that time:**
  `r(T) = clip(r_late + v_dive · (T − T_pen), r_body, r_early)`
  - r_late = 2.8 m: the dive range of a keeper who sets off on the kick. r_early = 3.1 m: one who
    goes early. Both are fitted by Brier score on real penalties with the keeper in the correct
    corner (Bransen, Janssen & Davis 2025).
  - T_pen = 0.55 s: the middle of the 500–600 ms penalty flight time that Bransen et al. cite
    (Dicks, Button & Davids 2010; Zheng, de Reus & van der Kamp 2021).
  - The keeper's reaction is inside r_late, because a penalty keeper also reacts to the kick. There
    is no separate reaction-time parameter for the outcome.
  - r_body = 0.3 m (the vision model's body radius): a ball straight at him is blocked.
  - v_dive (m of reach per extra second) has no verified source; see §1.8.
- **Save probability** (Bransen et al. 2025, eq. 2, µ = 0.7 m, ρ = 0.7):
  ```
  P_save(d, r) = ρ                              if d ≤ r − µ
               = ρ · (1/2 − (d − r) / (2µ))     if r − µ < d < r + µ
               = 0                              if d ≥ r + µ
  ```
- **Outcome.**
  - Wide when |y at the goal line| ≥ 3.66 m: an `out` event, then a goal kick at restart.
  - Otherwise, with u ~ U[0, 1) keyed by (seed, `save`, keeper, strike frame): saved if u < P_save,
    else a goal.
  - Common random numbers: a counterfactual that changes only the placement keeps u.
- **Dive (for tracking and rendering).**
  - From t_seen + 0.2 s, the keeper's centre of mass moves toward y_c at up to v_dive_max. On a
    save his hands reach the ball. On a goal he stops short: his centre of mass covers
    min(d, r) − 0.3 m.
  - A `dive` event marks the window. The 0.2 s is render-only: a visual reaction time around
    200 ms is quoted by Silva et al. (2021), a secondary source.
  - `test_players_respect_role_speed_and_acceleration_limits` exempts `dive` windows and checks
    them against v_dive_max = 4 m/s and a_dive_max = 15 m/s² (*tunable*, uncited) instead.
- **The shooter's value of a placement, on his belief (SPEC 3.5).** For `shot:p`:
  `V(shot:p) = P_on(p) · (1 − E[P_save(|y_aim,p − Y|, r(T̂))])`
  - Y ~ N(ŷ_k, s²): the believed keeper position. s = 0.3 m + 1.0 m per second of belief age, the
    existing position uncertainty. The expectation is a 9-point Gauss–Hermite quadrature, so it is
    deterministic.
  - T̂ = the ball's flight time to the keeper's plane. The shooter assumes the keeper sees the
    strike.
  - `P_on(p) = Φ((3.66 − y_aim,p)/σ_y) − Φ((−3.66 − y_aim,p)/σ_y)` along the lateral axis, with
    σ_y = D · tan σ_θ and D the distance to the goal line.
- **"He thought / it was" (SPEC 5.1)** for a shot: the same formula with the keeper's true
  position and age 0. `explain.lenses.option_values` scores shot options this way when the
  scenario has `shots`, instead of keeping the belief value.
- **Possession value and result.**
  - A goal is worth 1.0 to the scorer's team, in xT units: xT and xG are both goal probabilities.
  - A save is −xT_opp at the keeper.
  - `possession_result` gains `goal`, `saved`, `wide` and `blocked`.

### 1.7 Module A acceptance checks (written before the code)
- [ ] With the flag off: `tests/test_committed_exports.py` green; same-seed hashes of
      `blind_side_run` 3, `press_escape` 0 and `match-1` unchanged against main.
      `hero_flip_blind_side_run.md`, `hero_lens_press_escape.md`, `realism.md`,
      `scan_calibration.md`, `blind_side.md` and `scan_detector.md` regenerate with an empty
      `git diff`.
- [ ] `P_save` matches eq. 2 at d = r − µ, r and r + µ (ρ, ρ/2, 0).
      `r(T_pen) = r_late`; r is non-decreasing in T and clipped to [r_body, r_early].
- [ ] Over 200 flagged shots, every shot speed is within 18–35 m/s.
- [ ] Mirror symmetry: with the keeper believed at the near post, V(far) > V(near); mirrored in y,
      the preference mirrors.
- [ ] An override that only touches the shooter (`DropScan`) leaves every draw of the keeper
      unchanged, including the `save` draw (the pattern of `test_sim_m1`).
- [ ] A `goal` event exists if and only if the ball crosses the line between the posts with no save
      before it. A stitched plan with a goal reports the score from it (SPEC 3.1).
- [ ] With the ball fully occluded (a synthetic wall of bodies), no `dive` starts before the first
      frame with V_k ≥ 0.5.

### 1.8 Parameters and sources
| Parameter | Value | Source | Status |
|---|---|---|---|
| shot speed | U(24, 30) m/s per shot | inside 18–35 m/s for maximal instep kicks, Kellis & Katis (2007), Key Points | read (abstract, key points); the band is *tunable* |
| aim error σ_θ | 2.5° | shape only (variance grows as a power of speed): Hunter et al. (2018, J Biomech) | abstract read; value *tunable*, no number from the paper |
| dive range on the kick r_late | 2.8 m | Bransen, Janssen & Davis (2025), App. C, Brier fit on real penalties | full text read; arXiv preprint, not peer-reviewed |
| dive range going early r_early | 3.1 m | same | same |
| reach uncertainty band µ | 0.7 m | same | same |
| save rate within reach ρ | 0.7 | same | same |
| penalty flight time T_pen | 0.55 s (500–600 ms) | Bransen et al. (2025) citing Dicks et al. (2010) and Zheng et al. (2021); Kerwin & Bray (2006) give 500–700 ms (catalogue abstract) | secondary; primaries not read |
| v_dive (reach per extra second) | sweep 2.5–4.0 m/s, default 3.0 | **no verified source.** Ibrahim et al. (2019, J Sports Sci) give the legs' contributions to horizontal CoM velocity as 2.7 ± 0.1 and 1.2 ± 0.1 m/s; whether take-off velocity is their sum needs the full text | gate must hold across the whole sweep |
| full dive duration (sanity check only) | ≈ 1.0 s, signal to ball contact | Ibrahim et al. (2019, Front Sports Act Living): 1.050 s high, 0.972 s low from the fastest stance, ball 1 m in front of the line | full text read; the ball's lateral distance is in the companion paper (not read), so it calibrates nothing |
| render reaction delay | 0.2 s | visual RT 150–301 ms, ≈ 200 ms on average, quoted by Silva et al. (2021) from Magill (2000) and others | secondary; render-only, never changes an outcome |
| keeper depth, bisector rule | 1.5 m | convention | *tunable* |
| m_in (aim inside the post) | 0.5 m | — | *tunable* |

## 2. C1 — the striker reads the keeper (`far_post_finish`)

> **As built (2026-10-21): SPEC §3.3 (Module A) and §3.6 ("Shot hero") are authoritative,
> including their "Deviations from the design plan".** Held out on fresh seeds 200–239: the
> placement changes in 38/40, the median ΔP_goal is +0.524, and both v_dive ends give 38/40.

### 2.1 Setup (home attacks +x; hero H9, ST)
- **Before the switch.** The ball starts with the left back H3 at (18, 24). The away keeper A1
  stands on the bisector, toward the post on that side: y ≈ +1.6…+2.2 (keyed jitter).
- **The switch, through the pivot.** Forced passes H3 → H6 at (22, 4), then H6 → H7 at
  (34, −20). The ball travels behind H9, so his ball-tracking gaze sweeps from about 128° through
  180° to about −93° and never comes near the goal (0°). The keeper stays at least about 85° off
  his gaze, outside the 60° half-cone, so V stays below the 0.5 threshold (about 0.2 at a walk,
  less while running). A1 slides across with the ball to about y ≈ −1.8.
- **The cutback.** H9 runs from (35, 2) to about (41, −4) and receives the forced pass H7 → H9
  there. He faces H7, about 125° off the goal direction, so he cannot see the keeper.
- **Defenders.** Defenders are drawn toward H7 and H10, so no body stands between H9 and the
  goal: that would occlude the keeper and block the shot.
- **Spontaneous scans.** H9's spontaneous scans are suppressed until he acts, as in
  `blind_side_run`.
- **Per seed (keyed draws).** Position jitter, the keeper's offset, the pass timings, the
  key-scan timing and dwell, shot speed, aim error.
- **Hero design rule.** The keeper is visible to H9 only during the key scan. His last sighting
  before it (frame 0, the sim's convention that everyone is known at the start) shows the keeper
  on the far-post side. `drop_scan` flips the placement because of how the scene is built, not by
  chance.

### 2.2 Key action
`ForcedScan(key=True)` toward the keeper at reception − U(0.55, 0.75) s, dwell U(0.10, 0.16) s.
The amplitude is about 125°, inside the calibrated 70–150°. This is the same mechanism as
`blind_side_run`; the intervention is `drop_scan`.

### 2.3 Why the decision flips (worked numbers, design seed geometry)
- **With the scan.** The keeper is seen at y ≈ −1.8, belief age ≈ 0.5 s, s ≈ 0.8 m.
  - Near post (aim −3.16): d ≈ 1.4 m, below r − µ, so P_save ≈ ρ = 0.7.
  - Far post (aim +3.16): d ≈ 5.0 m, so P_save ≈ 0.
  - He picks far.
- **Without the scan.** The belief is ŷ = +2.0 from frame 0, age ≈ 6 s, s ≈ 6.3 m.
  - E[P_save] is about 0.18 near and 0.24 far: the stale sighting puts the keeper on the far side.
  - The near post also has the higher P_on, because it is the shorter shot.
  - He picks near. The keeper is really there, so most of these shots are saved.
- **Expected rates.** The placement flips by design (expect ≥ 85%). The realised goal-to-no-goal
  flip is about P_on(far) × (1 − P_goal(near)) ≈ 0.81 × 0.76 ≈ 0.6, because ρ = 0.7 and the aim
  error are real randomness.

### 2.4 Acceptance checks (eval: `eval/hero_flip.py --scenario far_post_finish`; design seeds 0–99, held-out 100–139)
- [ ] `drop_scan` changes the placement (shot:far → another option) in ≥ 60% of the 40 held-out
      seeds (the hard gate). Target 85%.
- [ ] The median expected gain is ΔP_goal ≥ 0.3, where ΔP_goal = P_goal(factual choice, truth) −
      P_goal(counterfactual choice, truth).
- [ ] The realised outcome change (goal → saved or wide) is reported, not gated.
- [ ] The scan lens is selected in ≥ 60%. The key scan is the most informative scan in ≥ 90%.
- [ ] The placement-flip gate holds at v_dive = 2.5 and 4.0 m/s.
- [ ] The demo seed is the first design seed with a far-post goal factually and a near-post save
      without the look. It is chosen and labelled as chosen, never sold as typical.

### 2.5 Claims and lexicon
- **Lexicon** (`explain/lexicon.py`, *tunable* thresholds):
  - `near post` / `far post` (placement): the shot crossed the line on the near or far half, with
    |crossing_y| ≥ 1.83 m. A ball within the middle 3.66 m is neither.
  - `at his near post` (the keeper's position): |y_k| ≥ 1.0 m, on the shooter's side.
  - Banned additions: `unstoppable`, `howler`, `clinical`, `should have saved`, 世界波, 神扑,
    黄油手, 必救.
- **Claims** (en + zh templates; numbers only from slots):

| id | kind | template (en) | predicate |
|---|---|---|---|
| `scan_at_keeper` | observed | "{player} looked at the goal {secs\|second\|seconds} before the ball reached him." | the key scan ends ≤ secs before reception (`approx`) |
| `keeper_seen_in_scan` | computed | "The look showed him {keeper} at his near post." | max V(H9→keeper) ≥ 0.5 during the scan ∧ the lexicon's `at his near post` |
| `keeper_belief_age` | counterfactual | "Without it, his last sight of {keeper} was {secs\|second\|seconds} old." | `metric_at belief_age` in the cf run |
| `placed_far_post` | observed | "{player} placed it at the far post." | the lexicon's `far post` |
| `goal` | observed | "{player} scored." | a `goal` event by the player |
| `shot_speed` | observed | "He hit it at {kmh} km/h." | `event_attr speed` × 3.6, `approx` |
| `keeper_distance` | computed | "It crossed the line {m} metres from {keeper}." | \|crossing_y − y_k\|, `approx` |
| `shot_thought_vs_was` | computed | "He gave it {p_belief}; it was {p_true}." | P_goal on belief and on truth |
| `cf_shot_near` | counterfactual | "Without the look, he goes near post." (+ "and {keeper} saves it." only when the cf run has a save) | cf chosen placement (+ cf outcome) |
| `cf_value` | counterfactual | "The look raised his scoring chance from {p0} to {p1}." | ΔP_goal from the two runs |

- **Reused unchanged:** `scans_before_reception`, `time_since_last_scan`, `scan_side`,
  `reception_zone`, `belief_error`.

### 2.6 Narration sequences (`agents/fallbacks.py`; the scan lens with `shots`)
- `casual`: connective "What did he see?" → `scan_at_keeper` → `keeper_seen_in_scan` →
  `placed_far_post` → `goal` → `cf_shot_near`.
- `analyst`: connective → `scans_before_reception` → `belief_error` (keeper) →
  `shot_thought_vs_was` → `shot_speed` → `keeper_distance` → `cf_shot_near` → `cf_value`.
- `player_fan`: connective → `scan_at_keeper` → `keeper_seen_in_scan` → `goal` → `cf_shot_near`.
- `coach`: `scans_before_reception` → `time_since_last_scan` → `keeper_seen_in_scan` → `cf_value`.
- `audio_description`: told in the order it happened, with no connectives and no probabilities.
  `reception_zone` ("He took it on the right side of the box.") → `scan_side` ("He turned his head
  left, to the goal.") → `keeper_seen_in_scan` → (`placed_far_post`, `goal`) → `cf_shot_near`.

### 2.7 UI entry points
- **Match picker.** "Reading the keeper" (web `match.ts` label; API `TTE_MATCHES`
  `far_post_finish:<demo seed>`).
- **POV.** H9, as now, with a scan marker on the key scan. The With / Without the look toggle and
  ghost: the cf ball path to the near post and the keeper's save.
- **Tactical board.** Pass options become shot options. Two lines to the posts, width = choice
  probability, believed vs true keeper token. This is the same overlay as the pass options.
- **What-if.** "What if he had gone near post?" maps to `force:shot:near` with no new code.
- **Stitched match.** A new `match-2` (§11) gets its first goal (1–0). `match-1` stays as it is.

## 3. C2 — the keeper's sightline (`screened_shot`)

### 3.1 Setup (the away team attacks −x; hero H1, GK)
- **The shooter.** A8 plays A10 into the edge of the box at (−35, y0), y0 ~ U(−4, 4). A10 shoots
  first time after the 0.2 s touch. It is a forced shot (`Scenario.forced_shot`, the analogue of
  `forced_pass`; the shooter is not the hero, as the passers are scripted in both existing
  heroes).
- **The target.** The corner on the step's side, 0.4 m inside the post. It is a keyed draw, and the
  same target and speed in both runs.
- **The crowd.** H4, H5, H6 and A9 stand around x ∈ [−45, −40], close to the line from the ball to
  the keeper. From the keeper's starting spot that line passes through bodies (transmission < 0.5).
  About 0.6–1.0 m to one side it passes through a gap at least 0.7 m wide.
- **The keeper.** H1 starts on the bisector at x ≈ −51.
- **Hero design rule.** From where the keeper starts, the ball is hidden at the strike; from the
  stepped spot it is in a gap. The shot is forced, so the two runs differ only in where the keeper
  stood and when he first saw the ball.

### 3.2 Key action and intervention
- `ForcedStep(player=H1, start = strike − U(0.30, 0.45) s, lateral = U(0.6, 1.0) m toward the
  gap, duration 0.3 s, key=True)`, with event id `step:H1:<frame>`. It is a scripted movement
  target, so it rides on `scripted_targets` and needs no new physics.
- New override `DropStep(step_id)`. `Scenario.intervention = "drop_step"`, and
  `hero_counterfactual` gets the branch.
- The export carries `key_step` the way it carries `key_scan` (null elsewhere).

### 3.3 Mechanism and expected numbers (shot from about 16 m at 26 m/s, flight to the keeper ≈ 0.6 s)
- **Factual.** He sees the strike, so T ≈ 0.6 s and r ≈ 2.95 m. The ball crosses at d ≈ 2.1 m,
  below r − µ, so P_save ≈ 0.7.
- **Without the step.** He sees the ball only once it is past the last body, about 5.5 m from
  him, so T ≈ 0.22 s and r ≈ 1.8 m. Now d ≈ 2.9 m, above r + µ, so P_save ≈ 0.
- **Decomposition** (the rigor point: it separates seeing from standing closer). An analysis-only
  run takes the step but gets the counterfactual's sighting time (`SightDelay` override):
  d ≈ 2.1 m and r ≈ 1.8 m give P_save ≈ 0.2.
  - Sight accounts for 0.7 − 0.2 = 0.5 of the 0.7.
  - Position accounts for 0.2.

### 3.4 Acceptance checks (eval: `eval/hero_lens.py --scenario screened_shot`; design 0–99, held-out 100–139)
- [ ] Mechanism: without the step, his first sighting after the strike comes ≥ 0.25 s later in
      ≥ 90% of held-out seeds.
- [ ] Hard gate: P_save(factual) − P_save(without the step) ≥ 0.4 in ≥ 60% of the 40 held-out
      seeds. The realised save → goal flip is reported, not gated.
- [ ] The effect is mostly sight: Δ_sight > Δ_position in ≥ 80% of held-out seeds.
      - Δ_sight = P_save(factual) − P_save(step, late sight).
      - Δ_position = P_save(step, late sight) − P_save(no step).
- [ ] Both gates hold at v_dive = 2.5 and 4.0 m/s.
- [ ] Render check (web, optional): in POV at the strike frame, a ray from the camera to the ball
      hits no player mesh in the factual run and does hit one without the step.

### 3.5 Explain changes this moment needs (why C2 costs more)
- **The hero has no ball decision.** `HeroRefs`, `MomentContext.load` and `run.hero_decision()`
  assume one, so they need an anchor that is "the hero's action" (a decision or a save).
- **New detector `save`.** Anchors `shot`, `key_step`, `first_sight`, `save`. Tag
  `screened_save` when the lexicon's `screened` holds at the step's start.
- **New lens `sight`** (perception, sibling of `scan`). Δ = expected goals prevented =
  P_save(factual) − P_save(without the step), in goal-probability units, comparable with xT.
  `space` and `pressure` are unavailable for a keeper without the ball, so selection is trivial
  here, and the SPEC should say so.
- **Lexicon** (*tunable*):
  - `screened`: at the strike frame, FOV(ball) ≥ 0.5 but V(ball) < 0.5. The ball is in his cone,
    so bodies block it (not "he was not looking").
  - `unsighted`: V(ball) < 0.5 at the strike.
  - `saw it late`: first sighting ≥ 0.25 s after the strike.
  - `stepped across`: the key step moved him ≥ 0.5 m laterally.
- **Claims:**

| id | kind | template (en) |
|---|---|---|
| `players_in_sightline` | computed | "Just before the shot, {n} players stood between {keeper} and the ball." (count of occluders with blocked ≥ 0.5 on the keeper→ball ray at the step's start) |
| `keeper_step` | observed | "{keeper} stepped {m} metres to his {side} {secs\|second\|seconds} before the shot." |
| `saw_the_strike` | computed | "From there he could see the ball as it was struck." |
| `save` | observed | "{keeper} saved it." |
| `shot_speed`, `shot_distance` | observed | as in C1 |
| `reach_at_sight` | computed | "When he saw it, he had {secs\|second\|seconds} to cover {m} metres." |
| `cf_first_sight` | counterfactual | "Without the step, he first sees the ball {secs\|second\|seconds} after the strike." |
| `cf_save_chance` | counterfactual | "That step took his chance of saving it from {p0} to {p1}." |
| `cf_goal` | counterfactual | "Without the step, it goes in." (only when the cf run has a goal) |

### 3.6 Narration sequences (lens `sight`)
- `casual`: connective "What did he see?" → `players_in_sightline` → `keeper_step` →
  `saw_the_strike` → `save` → (`cf_goal` | `cf_first_sight`).
- `analyst`: connective → `players_in_sightline` → `keeper_step` → `shot_speed` →
  `reach_at_sight` → `cf_first_sight` → `cf_save_chance`.
- `player_fan`: connective → `keeper_step` → `save` → (`cf_goal` | `cf_first_sight`).
- `coach`: `players_in_sightline` → `keeper_step` → `cf_first_sight` → `cf_save_chance`.
- `audio_description`: `shot_zone` ("A10 shot from the edge of the box, in the middle.") →
  `players_in_sightline` → `keeper_step` → `saw_the_strike` → `save` →
  (`cf_goal` | `cf_first_sight`). No connectives, no probabilities.

### 3.7 UI entry points
- **POV from H1's eyes.** This is the signature shot: bodies block the shooter, one step opens the
  gap. The toggle reads With / Without the step, from the export's `intervention`.
- **Tactical board.** The vision cone and occlusion shader already show the shadowed sectors. Add
  the shot line, plus an optional reach ring r(T) at the moment he sees the ball.
- **Ghost.** The ball path is identical in both runs; only the keeper's ghost differs (no step, a
  late dive).
- **Match picker.** "Through the crowd". In `match-2`, the save keeps the score.
- **Rigged keeper dive.** Check whether the Gameplay Football assets include keeper dive clips. If
  they don't, the keeper uses the token or a slide (the cut order).

## 4. C3 — the defender anticipates (`read_the_run`)

### 4.1 Setup (the away team attacks −x; hero H5, CB)
- The mirror of `blind_side_run`, seen by the defender.
- A8 receives at about (−18, 6) and plays a forced through ball into the channel behind H5,
  aimed at (−38, −8).
- A9 starts beside H4 (marked, 1.5 m) and curls behind H5, setting off 2.5 s before the pass.
- **Hero design rule.** A9 is visible to H5 only during the key scan. The last sighting before it
  shows him marked by H4.

### 4.2 New mechanism: a defender's decision on his belief
- **When.** It is due at the passer's first touch: frame k_d, with the forced kick 0.2–0.3 s
  later. A new hook `Scenario.defender_decides(sim, player, frame)` keeps it out of the other
  scenarios.
- **Options.**
  - `hold`: his marking or zone spot.
  - `cut:<attacker>`: for each attacker among the passer's believed options, the point nearest to
    him on the believed lane from the ball to that option's target.
- **Value: the passer's model run on the defender's belief.**
  - For option a, move the defender in his own belief to where he would be after
    Δt = 0.4 s (*tunable*) running at v_max toward a's point.
  - Then run `evaluate_options` for the passer:
    `V_def(a) = − Σ_k q_k(a) · V_k(a)` (the expected threat the passer would pick, as the defender
    believes it).
- **Choice.** Gumbel-max with keyed noise per (H5, frame, option) and his role temperature.
- **Outcome.** No new physics: the existing in-flight interception logic sends the defender with
  the best time to intercept at the ball. A defender who already started into the lane wins it
  through `_check_control`.

### 4.3 Acceptance, claims and narration (outline)
- [ ] `drop_scan` flips `cut:A9` → `hold` in ≥ 60% of held-out seeds. The interception → A9
      reception flip rate is reported.
- [ ] Without the scan, H5's belief error about A9 at the decision is ≥ 5 m in ≥ 90% of seeds.
- **Lens.** The scan lens with the defensive value V_def on truth.
- **Lexicon.** `anticipated`: he started toward the lane before the pass was kicked, with velocity
  toward his cut point ≥ 1 m/s at the kick frame.
- **Claims.** `scan_before_pass`, `seen_in_scan` (A9), `anticipated`, `interception`,
  `cf_through_ball`, `cf_value`.
- **Sequences** are the `blind_side_run` ones with the defender's claims. `audio_description`:
  where → who he could not see → which way he looked → whom he saw → where he went →
  `cf_through_ball`.

## 5. C4 — the set piece: the marker and the runner on his blind side (`corner_blind_side`)

> **As built (2026-10-20): SPEC §3.6 and `eval/reports/hero_marking_corner_blind_side.md` are
> authoritative.** Three things differ from the design below, all settled on design seeds 0–39
> before the held-out run:
> - **Where A9 runs.** He drifts into the middle of the box and darts out to its edge, not to the
>   penalty spot. A cutback lane through the box was cut out by the zonal defenders.
> - **The press.** H11 closes A11 from the byline side, off the lane.
> - **The gate.** "Unmarked without the look, H5 within 5 m with it". With the look, H5 closes to
>   about 3 m, not 1.5 m.
>
> Held out (100–139): 37/40.

### 5.1 Can one build carry both the set piece and the shot module?
Only partly.
- **What Module A covers.** The finish: any shot, a header included, would resolve through the
  same save model.
- **What the set piece needs that Module A does not have:**
  1. **Marking on belief.** Today `possession_play` steers a marker to his man's *true* position
     (`sim.pos[a]`), so a marker can never lose a man he cannot see.
  2. **A lofted delivery.** `sim/ball.py` rolls on the ground only. The export carries the ball as
     [x, y], and the web draws it at a fixed 0.11 m (`PovView.tsx`).
  3. **An aerial duel and a header.** There is no model, and we found no verified header ball speeds
     or jump-reach numbers.
- **The cheapest version needs only (1).**
  - A short-corner routine with a low cutback, all on the ground.
  - Marking on belief in this scenario's own movement targets (a helper, not a flag), and the
    house intervention `drop_scan`.
  - The outcome is the runner's separation from his marker when the ball reaches him.
  - No Module A, no lofted ball, no duel. It ends at the reception, as `blind_side_run` ends at
    its pass.

### 5.2 Setup (the away team takes a corner at the home goal, −x; hero H5, CB)
- **The routine.** A7 takes the corner short to A11 at about (−46, 26). A11 dribbles a step and
  plays a low cutback (forced pass) to the penalty-spot area.
- **The marking.** H5 marks A9 man to man, starting goal-side and beside him, about 1 m at
  (−44, 2). H5's head tracks the ball, so he is looking toward +y.
- **The run.** A9 curls behind H5, away from the ball, to about (−41, −3). There he is about 165°
  off H5's gaze, outside the cone.
- **The others.** The other markers and attackers fill the box, but nobody stands between A9 and
  the cutback lane.
- **Hero design rule.** A9 is visible to H5 only during the key scan; the last sighting before it
  shows A9 beside him. Without the scan, H5's belief of A9 extrapolates for at most 1 s
  (`belief_horizon_s`) and then freezes, so he marks a point A9 has left.
- **Per seed (keyed draws).** Position jitter, the start and target of A9's run, the cutback's
  timing, and the key scan's timing and dwell.

### 5.3 Key action and the new mechanism
- **Key action.** `ForcedScan(key=True)` for H5 over the shoulder away from the ball, about
  0.6–0.9 s before the cutback is played, with a dwell of 0.10–0.16 s. The intervention is
  `drop_scan`, unchanged. In the factual run he looks and stays with A9; without the look he
  loses him.
  - Variant: make the goal the factual run (he never looks) and the look the counterfactual. That
    needs a new `AddScan` override and its claims, about +0.25 d. Not recommended.
- **Marking on belief** (`sim.scenarios.base.marking_target_on_belief`, called in this scenario's
  movement targets; no flag, and the other scenarios mark the true position):
  - A marker's target is the goal-side point of his man's *believed* position, from
    `BeliefStore.estimate` on his own perception: `target = ŷ_a + gap · unit(own_goal − ŷ_a)`.
  - Same speed caps as now.
  - As built this is a helper in the scenario, not a flag or an engine change. No new random draw:
    the noise is keyed per frame and entity, and the belief comes from existing perception.
- **Outcome.** Separation at the reception, d_sep = |pos(H5) − pos(A9)|.
  - If H5 is within the control radius of the ball first, `_check_control` gives him an
    interception.
  - Otherwise A9 receives. With Module A merged, A9 could take a first-time shot, but not in this
    candidate: its runs stay fixed once merged.

### 5.4 Acceptance checks (eval: `eval/hero_flip.py --scenario corner_blind_side`; design 0–99, held-out 100–139)
- [ ] Hard gate: `drop_scan` raises d_sep at the reception from ≤ 1.5 m to ≥ 3 m in ≥ 60% of the
      40 held-out seeds. The possession flip (H5 wins it or contests ↔ A9 receives free) is
      reported.
- [ ] Without the scan, H5's belief error about A9 at the cutback is ≥ 3 m in ≥ 90% of seeds.
- [ ] The blind-side alert (SPEC 4.4) for H5 → A9 is on before the key scan and clears during it
      in ≥ 90% of seeds. This is the `blind_side_run` test pattern, from tracking only.
- [ ] With the flag off, `possession_play` marking is byte-identical (the §8 invariants).

### 5.5 Claims, lexicon, narration
- **Lexicon** (*tunable*):
  - `lost his man`: d_sep grew from ≤ 2 m to ≥ 4 m within the delivery window.
  - `eyes on the ball`: his gaze stayed within the 60° half-cone of the ball through the window
    while his man was outside it.
  - **Banned:** `ball-watching`, which pundits use as blame; zh 盯球不盯人.
- **Claims:**
  - Reused: `blind_side` (A9 on H5's blind side when the look began), `seen_in_scan`,
    `scan_side`, `time_since_last_scan`, `belief_error`.
  - New:
    - `marker_scan` (observed): "{player} checked over his shoulder {secs|second|seconds} before
      the cutback."
    - `stayed_with_runner` (computed): "He was {m} metres from {runner} when the ball arrived."
    - `cf_lost_runner` (counterfactual): "Without the look, {runner} is {m} metres clear when the
      ball arrives."
    - `cf_value` (counterfactual): the defending team's xT of the reception, with and without.
- **Sequences:**
  - `casual`: connective → `blind_side` → `marker_scan` → `seen_in_scan` →
    `stayed_with_runner` → `cf_lost_runner`.
  - `analyst`: adds `time_since_last_scan`, `belief_error` with and without, and `cf_value`.
  - `audio_description`: where (a corner from the left, played short) → `blind_side` →
    `scan_side` → `seen_in_scan` → `stayed_with_runner` → `cf_lost_runner`.

### 5.6 UI entry points
- **POV from H5.** The ball fills the view; one look over the shoulder shows A9 on the move.
- **Broadcast.** The live blind-side alert pulses on A9 and clears when H5 looks. The overlay
  exists already; only the moment is new.
- **Tactical board.** A belief ghost of A9 (the overlay exists) frozen where H5 last saw him.
- **Match picker.** "The corner".

### 5.7 What the iconic version would add (not in the calendar)
- **Lofted delivery** (+1.25 d).
  - A projectile with the existing quadratic drag (m 0.43 kg, r 0.11 m, C_d 0.25), integrated in
    substeps, with a launch solver for a landing point and apex. Bounce restitution 0.5 (SPEC 3.3).
  - The delivery is scripted, so the decision model needs no lofted predictions.
  - The export gains the ball's z. The web draws the ball's height in POV, broadcast and the
    tactical board.
  - `test_ball_energy_never_increases_between_contacts` covers it.
- **Aerial duel + header finish** (+2 d, needs Module A).
  - Who reaches the descending ball within jump reach first.
  - A header as a shot through the save model.
  - Header ball speed and jump reach have no verified source yet, so they would block on citations
    as v_dive does.

## 6. C5 — first-touch direction (`touch_away`)

### 6.1 Setup (home attacks +x; hero H8, CM)
- H4 plays a forced pass into H8, who receives with his back to goal.
- A10 sprints at him from his blind side (behind-left) and arrives about 1 s after the reception.
  Space is open to H8's front-right.
- **Hero design rule.** A10 is visible to H8 only during the key scan; the last sighting before it
  shows A10 about 10 m away, marking H6.

### 6.2 Mechanism (`Scenario.first_touch`, off elsewhere): the touch is a short carry with a free ball
- **When.** At control, under the flag, the receiver decides a first touch instead of keeping the
  ball attached.
- **Options.** `touch:<θ>` for 8 headings, every 45°, the ball pushed L = 2.0 m (*tunable*), plus
  `settle` (a 0.5 m cushion).
- **Value, on his belief.** As a carry is scored today:
  `V(touch:θ) = P_keep(θ) · xT(p_θ) − (1 − P_keep(θ)) · xT_opp(p_θ)`
  - P_keep comes from `_p_win_ball` along the ball's rolling path to p_θ: time to intercept plus
    the run-in. It is times a reach term: he must reach the ball before it has rolled on.
- **Choice.** Gumbel-max with keyed noise per (H8, frame, option).
- **Physics, all existing.** The touch is a ground self-pass (`touch` event); he runs onto it.
  `_check_control` gives the free ball to whoever is within 1 m first, so a touch toward the
  presser loses it by the rules that already exist.
  - The 0.25 s kick lockout is shorter than the time he takes to reach a 2 m touch.
- **Afterwards.** His normal decision (pass / carry) follows when he controls the ball again.
- **Scope.** Direction only: no contact point, spin or chip. The ball is a point mass, and Bowen
  ruled those analyses out.

### 6.3 Acceptance checks
- [ ] Hard gate: `drop_scan` turns the first touch by ≥ 90° in ≥ 60% of held-out seeds.
- [ ] The ball is lost within 1.5 s of the touch in ≤ 20% of factual runs and ≥ 60% of the runs
      without the look.
- [ ] The first decision of the hero is the touch, so `run.hero_decision()`, the scan lens and the
      what-if box ("what if he had taken it to his left?") work without change.
- **Lexicon:** `away from pressure` means the touch raised the distance to the nearest opponent by
  ≥ 1 m (truth, the touch's end vs control).
- **Claims:** `touch_direction`, `seen_in_scan` (the presser), `cf_touch_lost`.

### 6.4 Does a first-touch model fix the reception-difficulty gap (AUC 0.59, cut 2026-10-20)?
It adds the missing mechanism, but it does not rescue the index.
- **It adds the mechanism.** A reception can now go wrong, and how depends on what the receiver
  believed.
- **It stays inside one scenario.** It sits behind a flag in `touch_away` only. Turning it on in
  `possession_play` would move the scan calibration, the realism table, the hero flips and
  `match-1`; that version was already judged too risky.
- **The index would be circular.** Even with the touch model on everywhere, an index refitted on
  it would mostly recover the model we wrote (time since the last scan and pressure → touch
  direction → loss). An AUC above 0.7 would be circular, not evidence.
- **Verdict.** C5 as a hero moment: yes. Reviving the index: no, consistent with Bowen's cut.

## 7. Cheaper candidates on the same mechanisms
| Candidate | Phase | Reuses | New | Cost | Value |
|---|---|---|---|---|---|
| **Cutback crosser scans the box** (`cutback_scan`): a winger at the byline sees the late runner at the penalty spot free while the near-post runner is marked | chance creation | everything in `blind_side_run`: ForcedScan, `drop_scan`, scan lens, all its claims and sequences | a scenario file and eval seeds; with Module A the runner's shot continues to a goal | ≈ 1 d | medium-high: the final third, and it chains into C1 ("the cross saw him, he saw the keeper") |
| **Keeper distribution** (`keeper_switch`): the keeper receives a back pass, a look shows the far full-back free | build-up from the back | scan hero; a keeper as ball carrier already decides | a scenario; keepers' scan rates are uncalibrated (Jordet et al. exclude keepers), so the key scan is forced only | ≈ 1 d | medium: "even the keeper's first pass starts with a look"; keeper POV without Module A |
| **Goal / big-chance detectors** (SPEC 5.1) | live feed | Module A events | detectors | 0.25 d (in Module A) | medium: the live list gets goals |
| **"What if near post?"** | — | `force_action` | none | 0 (comes with C1) | medium |
| **Counter-press escape** | transition | `press_escape` (tackles, pressure lens, `force:carry`) after a scripted turnover | a scenario | ≈ 0.75 d | low: repeats `press_escape` |
| **Switch of play / third-man run** | midfield | scan hero | a scenario | ≈ 1 d | low: repeats `blind_side_run` |

## 8. What must not change
- Same seed ⇒ byte-identical output, in particular the committed exports
  (`tests/test_committed_exports.py`), `blind_side_run` 3, `press_escape` 0 and `match-1`.
- The eval reports for `hero_flip`, `hero_lens` (press_escape), `realism`, `scan_calibration`,
  `blind_side` and `scan_detector` regenerate with no diff. Every sim PR pastes the commands and
  an empty `git diff --stat`.
- Every new mechanism sits behind a Scenario flag or hook: `shots`, `forced_shot`, ForcedStep,
  `first_touch`, `defender_decides`, and the `ends_on_pass` hook (C4's only engine change).
  Marking on belief is not a flag: it is a helper,
  `sim.scenarios.base.marking_target_on_belief`, called in `corner_blind_side`'s movement
  targets, and the other scenarios mark the true position. Option sets change only under `shots`
  or `first_touch`. New keyed purposes (`shot_error`, `save`, `shot_speed`) are drawn only under
  their flag.
- **Cache keys.** Explain and agents changes bump `PROMPT_VERSION`, so the cache keys of the
  existing heroes change too. After each deploy, pre-warm every hero (personas × en/zh) before
  any video capture.

## 9. Schedule (CT; submission 2026-10-27 23:59 PT = 10-28 01:59 CT)
| Day | Sim lane (one session, serial: decision.py and engine.py) | Explain / agents / API lane | Elsewhere |
|---|---|---|---|
| Tue 10/20 eve | — | — | Bowen picks |
| Wed 10/21 | C4: marking on belief behind its flag, `corner_blind_side`, eval on 100–139; invariants | — | Floodlit port (web/) continues |
| Thu 10/22 | **C4 go / no-go 12:00**; then Module A behind `shots`, §1.7 tests | C4: a hero without a ball decision (H), claims, sequences, API registration, pre-warm | |
| Fri 10/23 | Module A done; C1 scenario + eval; **go / no-go 18:00** | goal / save / big-chance detectors; C1 claims | **video first cut with the two existing heroes**; web: C4 label |
| Sat 10/24 | C2: ball sight, ForcedStep / DropStep, forced shot, scenario, eval, decomposition, v_dive sweep; **go / no-go 22:00** | C1 merge + pre-warm | web: C1 label |
| Sun 10/25 | slack for fixes (no new mechanism) | C2 (`sight` lens on H), `match-2`, judges' tour links | web: step toggle, keeper POV; capture the new shots |
| Mon 10/26 | **freeze 12:00**: nothing from the pack merges after it | SPEC §3.6 / §5 / §6, README, RUBRIC_MAP | repo public |
| Tue 10/27 | — | — | buffer, final video, submit by mid-afternoon |

**Fallback rule.** A failed gate frees its sim slot. C5 (1.5 sim days + 0.75 explain) takes the
slot only if it can pass its own gate by Sat 22:00.
- If C4 fails at Thu 12:00: C5 runs Thu–Fri, Module A and C1 move to Fri–Sat, and C2 is cut.
- If Module A or C1 fails at Fri 18:00: C5 runs Sat–Sun morning. C2 is cut, because it needs
  Module A.

## 10. Cut order for the pack (first to cut first)
1. C4's aerial duel + header finish (never in the calendar; uncited header parameters).
2. C4's lofted delivery (it also needs the ball's height in the export and the web).
3. C3, the defender anticipates (C4's marking on belief covers the defender story more cheaply).
4. The cheap extras (cutback crosser, keeper distribution).
5. C5, first-touch direction (fallback only, §9).
6. The rigged keeper dive: back to the token or a slide.
7. `match-2`: the new heroes stay in the match picker only.
8. C2: if its gate fails, or it is not merged by Sun 10/25 18:00 CT.
9. C1 together with Module A: if C1's gate fails at Fri 18:00 CT, Module A does not merge without
   a scenario that uses it.
10. C4: only if its own gate fails at Thu 12:00 CT. It is Bowen's thesis favourite and the cheapest
    independent candidate.

The pack never takes time from the SPEC §9 never-cut list or from the video. A failed gate is
reported as a counterexample and cut, as with reception difficulty (AUC 0.59, 2026-10-20).

## 11. Integration plan
- **PRs, in merge order** (each through the PR desk; sim PRs merge only with their gate met, the
  invariants proven and no explain changes):
  1. C4 sim (`corner_blind_side` and the `ends_on_pass` hook) +
     `eval/reports/hero_flip_corner_blind_side.md`.
  2. C4 explain, agents and API.
     - The plumbing for a hero without a ball decision (H), and the scan lens for such a hero.
     - Claims and sequences; `DEFAULT_MATCHES` gets `corner_blind_side:<seed>`.
     - *As built (2026-10-21, SPEC §3.6, §5, §6):* a `marker_scan` moment, the scan lens valued as
       the expected turnover where the pass to his man resolves, and his own claims and sequences.
       `DEFAULT_MATCHES` waits for the web to show a marker's moment (SPEC §3.6, "Not served yet").
  3. Module A + the C1 scenario + `eval/reports/hero_flip_far_post_finish.md`.
  4. C1 explain, agents and API: detectors, claims, `far_post_finish:<seed>`.
     - *As built (2026-10-21, SPEC §3.6, §5.2, §6):* no new detector (the ordinary
       `decision_after_scan` card); placed shots valued on the truth; the shot claims and
       sequences of §2.5–2.6 (renamed: `scan_at_goal`, `shot_placement`, `cf_shot`,
       `cf_shot_value`); near/far-post what-ifs. Serving `far_post_finish:11` waits, like the
       corner, for the web.
  5. C2 sim + its eval report (with the decomposition and the sweep).
  6. C2 explain, agents and API (`sight` lens on H, `key_step` in the export).
  7. `match-2`, a new plan: open play, `blind_side_run` 3, open play, `corner_blind_side`,
     `far_post_finish`, `press_escape` 0, `screened_shot`, open play. Its score comes from the
     `goal` events. Judges' tour deep links and new `video/shots.json` entries go in the same PR.
  - SPEC §3.6, §5 and §6 get each moment's text and eval numbers in that moment's explain PR.
- **Web** (owned by the web session, after the Floodlit port merges):
  - match-picker labels;
  - the intervention-aware toggle label (look / step);
  - POV with the marker and with the keeper as hero;
  - shot reading for the broadcast camera (a 26 m/s ball against pan springs with ω = 4);
  - the optional keeper dive clip.
  This pack touches no file under `web/` before then.
- **Video.**
  - The first cut on 10/23 uses only the two existing heroes and does not wait for the pack.
  - After each merge, one 8 s shot:
    - "the corner": the marker's POV and the live blind-side alert in broadcast;
    - "read the keeper";
    - "through the crowd".
  - They go into the 0:55–1:25 segment as an "every phase" montage. Bowen decides what of the
    persona segment it replaces. `blind_side_run` stays the hero of the video.
- **Submission.** README "Try it" lists the new moments with deep links. The technology table is
  unchanged: no new Azure service.

## 12. Open points to settle before code
- v_dive has no verified source. The gates must hold across 2.5–4.0 m/s, or C2 does not ship.
- Bransen et al. (2025) is a preprint fitted on penalties with the keeper in the correct corner.
  Moving it to low open-play shots is our assumption, and the SPEC should say so.
- Low shots only: no height, deflection or rebound. A save is always held.
- C4 in its cheapest form is a ground routine (a short corner, a low cutback). It is a real
  routine, but less iconic than a lofted corner, and it ends at the reception without a goal.
- C2 and C4 heroes have no ball decision, so the explain and agents plumbing generalises from
  "decision" to "hero action" (H, 0.5 d). Whichever of them comes first pays for it.
- Bowen ruled out ball contact point / ball-chip analysis and injury force lines: the sim has no
  spin or biomechanics, so those numbers could not be verified.

## Sources (read 2026-10-20)
- Bransen, L., Janssen, T., Davis, J. (2025). Stop Guessing: Optimizing Goalkeeper Policies for
  Soccer Penalty Kicks. arXiv:2505.24629. Eq. 2 and Appendix C (r_early 3.1 m, r_late 2.8 m,
  µ 0.7 m, ρ 0.7, Brier-score fit); flight times of 500–600 ms citing [11] and [33].
- Dicks, M., Button, C., Davids, K. (2010). Examination of gaze behaviors under in situ and video
  simulation task constraints… Attention, Perception & Psychophysics 72, 706–720. (Cited via
  Bransen et al.; not read.)
- Zheng, R., de Reus, C., van der Kamp, J. (2021). Goalkeeping in the soccer penalty kick: the
  dive is coordinated to the kicker's non-kicking leg placement, irrespective of time constraints.
  Human Movement Science 76, 102763. (Cited via Bransen et al.; not read.)
- Kerwin, D. G., Bray, K. (2006). Measuring and modelling the goalkeeper's diving envelope in a
  penalty kick. The Engineering of Sport 6, vol. 1, 321–326. doi:10.1007/978-0-387-46050-5_57.
  (Catalogue abstract only: 500–700 ms boot to goal line.)
- Kellis, E., Katis, A. (2007). Biomechanical characteristics and determinants of instep soccer
  kick. Journal of Sports Science and Medicine 6(2), 154–165. (Key points: maximal instep ball
  speed 18–35 m/s.)
- Hunter, A. H., Angilletta, M. J., Pavlic, T., Lichtwark, G., Wilson, R. S. (2018). Modeling the
  two-dimensional accuracy of soccer kicks. Journal of Biomechanics 72, 159–166.
  doi:10.1016/j.jbiomech.2018.03.003. (Abstract: error variance a power function of speed.)
- Hunter, A. H., Angilletta, M. J., Wilson, R. S. (2018). Behaviors of shooter and goalkeeper
  interact to determine the outcome of soccer penalties. Scand J Med Sci Sports 28(12),
  2751–2759. doi:10.1111/sms.13276. (Abstract: faster shots → earlier keeper leave times and fewer
  blocks. Context only.)
- Ibrahim, R., Kingma, I., de Boode, V. A., Faber, G. S., van Dieën, J. H. (2019). The effect of
  preparatory posture on goalkeeper's diving save performance in football. Frontiers in Sports and
  Active Living 1, 15. doi:10.3389/fspor.2019.00015. (Full text: dive 1.050 / 0.972 s.)
- Ibrahim, R., Kingma, I., de Boode, V. A., Faber, G. S., van Dieën, J. H. (2019). Kinematic and
  kinetic analysis of the goalkeeper's diving save in football. Journal of Sports Sciences 37(3),
  313–321. doi:10.1080/02640414.2018.1499413. (Abstract: horizontal CoM velocity contributions
  2.7 and 1.2 m/s.)
- Silva, S. L., et al. (2021). The anticipatory and reaction time behaviors of the futsal
  goalkeeper. Journal of Physical Education 32. doi:10.4025/jphyseduc.v32i1.3218. (Secondary:
  visual RT 150–301 ms, ≈ 200 ms on average.)
