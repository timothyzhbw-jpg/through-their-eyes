# Through Their Eyes — Specification (v0.1, 2026-10-19)

> Working title. Microsoft × Premier League "Inside the Game" Developer Hackathon.
> Submission deadline **2026-10-27 23:59 PT** (= 2026-10-28 01:59 CT). Judging until 2026-11-10.
> Parameter values marked *tunable* are starting points, not commitments.

## 0. Pitch and judging alignment

**One-liner:** See what they saw. An AI studio that explains key moments through the player's own
perception — the scans before the ball arrived, what was visible, what he believed — and proves
every on-screen number before it airs.

**Target prizes:** Grand Prize + Best Multi-Agent System (judges may reassign the category).

| Judging criterion (20% each) | How we score |
|---|---|
| Technological implementation | Physics-based synthetic tracking with a research-calibrated perception layer; numpy↔GLSL parity-tested kernels; deterministic counterfactual re-simulation; CI eval suite; Foundry + Agent Framework + MCP + Azure Speech + ACA/SWA + Cosmos DB + App Insights |
| Agentic design & innovation | AI production crew (Director, Analyst, Telestrator, Narrator, Verifier) with typed handoffs, shared moment state, MCP tools, deterministic verification, graceful fallbacks |
| Real-world impact | Production path: the same schema can be fed by stadium skeletal tracking or broadcast-video models; machine-readable, timecoded overlay cues; audit log of every verified claim |
| UX & presentation | First-person replay + tactical camera + live overlays; persona and language switching; a 2-minute video built around one hero moment |
| Category adherence | Distinct agent roles, shared state, handoffs, failure recovery, an end-to-end output a single agent can't produce as well |

## 1. Audiences (personas)

| Persona | Gets | Tone |
|---|---|---|
| `casual` | First-person replay + a one-sentence story | plain language, minimal numbers |
| `analyst` | Scan rate vs research benchmarks, time since last scan at reception, observed-space share, belief error, counterfactual delta, pitch-control / pressing overlays | dense, technical |
| `player_fan` | Camera locked on the chosen player all match; his scans before each reception; his best decisions | personal |
| `coach` (stretch) | "Scanned vs didn't scan" side-by-side + one coaching cue | instructional |

All personas render the **same verified fact set**. Persona changes presentation, never facts.
Languages: `en` and `zh` for the MVP; `es` is a stretch goal.

## 2. Architecture

```
 sim/ ──► analytics/ ──► explain/ ──► api/ (FastAPI + MCP server) ──WS──► web/ (R3F: cameras, overlays,
                                        │                                       breakdown player, UI)
                                        │ MomentCard
                                        ▼
            agents/ — Agent Framework workflow, models via Microsoft Foundry
            Director → Analyst ⇄ MCP tools → Telestrator → Narrator → Verifier → Voice (Azure Speech)
                                        │
              Cosmos DB (matches, events, claims audit) · Application Insights (traces)
```

**Latency model.** Live overlays come from deterministic analytics only (target p95 < 100 ms
server-side). AI breakdowns run asynchronously once a moment is detected and are shown in the
replay window (target p95 < 12 s), the way broadcast replays follow a goal. Live play never waits
on an LLM.

## 3. Synthetic match engine (`sim/`)

### 3.1 State and schema
- Pitch 105 × 68 m, origin at the centre spot; the home team attacks +x in the first half. 25 Hz.
- Per frame, per player: `id, team, role, x, y, vx, vy, body_yaw, head_yaw` (world frame), `has_ball`.
- Ball: `x, y, z, vx, vy, vz, owner`.
- Events: `pass, carry, shot, tackle, interception, pressure, possession_change, out, goal, scan`
  with `t, frame, player, team, attrs` (e.g. pass start/end, speed, outcome, difficulty).
- `scan` events are **ground truth** from the sim. The analytics scan detector must recover them
  from `head_yaw` alone (§4.7).
- Output: JSONL frames + JSON events. Optional kloppy-compatible export (stretch).

### 3.2 Movement
- Formation anchors (e.g. 4-3-3 vs 4-2-3-1) shifted by ball position and phase; compactness and
  line height are team-style knobs.
- Steering toward targets with limits — *tunable*: max speed by role 8.0–9.5 m/s, max accel
  ≈ 3.5 m/s², max decel ≈ 5 m/s², turn-rate limit.
- Separation steering to avoid overlaps (Python-RVO2 optional, see REFERENCES).
- Pressing: the nearest 1–2 defenders converge on the ball carrier when a team pressing trigger fires.

### 3.3 Ball physics
- Flight: gravity + quadratic drag — *tunable*: m = 0.43 kg, r = 0.11 m, ρ = 1.2 kg/m³, C_d ≈ 0.25.
  Magnus optional.
- Ground: rolling friction; bounce with restitution ≈ 0.5 (*tunable*).
- Passes and shots solve launch speed/angle to reach the target (ground vs lofted). Shot speeds
  roughly 80–130 km/h by context.

### 3.4 Perception (the hero feature)
- **Head yaw dynamics.** Baseline gaze tracks the ball. A **scan** is a rapid turn away from the
  ball and back. Most scans are short: >90% last ≤ 0.66 s in eye-tracking work (see REFERENCES).
- **Scan scheduling.** Stochastic process with rate by role and context, plus a per-player trait
  multiplier. Calibration targets from research:
  - ≈ 3 scans in the 10 s before receiving, on average;
  - > 0.5 scans/s counts as very high (elite central midfielders);
  - central midfielders and centre-backs scan most, forwards least;
  - scanning drops under tight pressure.
- **Field of view** (after Bekkers 2026, *Wide Open Gazes*): base 120° binocular cone around
  `head_yaw`; visibility decays with angular offset and distance (Gaussian); the cone narrows as
  running speed rises.
- **Occlusion.** Other players block angular sectors behind them (soft edges).
- **Belief state (mental map).** For every other player: last-seen position, velocity and time.
  Belief = extrapolation from last sighting; uncertainty grows with time since seen. Updated
  whenever that player falls inside the probabilistic visible region.

### 3.5 Decision model
- The ball carrier evaluates candidate actions (pass to each teammate, carry, shot) **on its
  belief state**, never on ground truth.
- Pass value = P(completion | belief) × ΔxT(target). P comes from interception risk along the ball
  path (defender time-to-intercept vs ball arrival time) and receiver pitch control at the target.
- Softmax with a per-player temperature. Receiver body orientation affects completion (facing play
  vs back to goal).
- Consequence: scanning changes information, which changes decisions. This is what makes the
  explanation causal *inside the sim*. Outside the sim (real data) we only claim association.

### 3.6 Scenario templates (hero moments)
Parameterised templates that set up recognisable situations inside normal play: counter-attack
after a turnover, third-man run, switch of play, high-press trap, through-ball behind a high line.
Randomised parameters; the same physics and decision code. Documented in the README as
scenario-driven generation.

### 3.7 Determinism and counterfactuals
- One seeded RNG stream per match; same seed ⇒ byte-identical output.
- `snapshot(t)` / `resume(snapshot, overrides)` re-simulate from t with overrides such as
  `drop_scan(scan_id)`, `freeze_belief(player, at=t')`, `move_player(...)`.
- A counterfactual result = alternative decision + outcome + ΔxT / Δ shot probability.

### Acceptance checks — sim
- [ ] Same seed twice ⇒ identical output hashes.
- [ ] No player exceeds role max speed/accel; ball mechanical energy never increases between contacts.
- [ ] Realism report on 20 seeds: passes, shots, possession changes per match fall inside configured
      target ranges (table written to `eval/`).
- [ ] Scan statistics on 20 seeds: mean scans in the 10 s before reception within ±25% of target;
      CMs > forwards; scan rate under pressure < without pressure.
- [ ] For each hero scenario, `drop_scan` on the key scan changes the chosen action in ≥ 60% of
      seeds (*tunable*; otherwise the moment is not a scan story).

## 4. Analytics kernels (`analytics/`)
Every kernel: numpy reference + unit tests. GLSL versions in `web/` must match the numpy reference
within tolerance on fixed snapshots.

### 4.1 Time to intercept (TTI)
Shaw-style simplification of Spearman: the player keeps current velocity for reaction time τ_r,
then runs at v_max to the target. Defaults (*tunable*): τ_r = 0.7 s, v_max = 5 m/s (a deliberately
conservative model parameter, not real sprint speed). Targets: grid cells (pitch control) and
moving players/ball (pressing).

### 4.2 Pitch control
Closed-form approximation:
`P_home(x) = 1 / (1 + exp(−π / (√3 · σ) · (T_away(x) − T_home(x))))`,
where `T_team(x)` = min over that team's players of TTI and σ ≈ 0.45 s (*tunable*).
Backend grid 105 × 68 at 1 m; per-pixel in the shader. May refine toward Spearman's full
integration later if time allows.

### 4.3 Pressing intensity (after Bekkers)
Defender→attacker and defender→ball TTI, mapped to a probability with a logistic. Per-frame matrix;
aggregate pressure on the ball carrier.

### 4.4 Vision map and observed-space metrics
Per player: `V(x) = FOV(x; head_yaw, speed) × (1 − Occlusion(x))`. Metrics:
- `observed_defended_share` = Σ V·P_def / Σ P_def over opponent-controlled space — the share of
  the opponents' space he actually saw.
- `time_since_last_scan_at_reception`, `scans_in_window(t−10 s, t)`.
- `belief_error`: mean distance between believed and true positions of the relevant players.

### 4.5 Expected threat (xT)
16 × 12 grid fitted on synthetic event data (socceraction, MIT, or a small own Markov
implementation). Cache the grid per sim version.

### 4.6 Pass metrics and speeds
- Pass distance, completion, and difficulty ∈ [0, 1] from: distance, interception risk along the
  path, pressure on passer and receiver, progression (ΔxT), line-breaking.
- Player speed from smoothed velocity. Sprint > 7.0 m/s (25.2 km/h); high-speed running > 5.5 m/s
  (19.8 km/h).
- Ball speed and shot speed from the ball trajectory.

### 4.7 Scan detector
Input: the `head_yaw` time series only. Detect scans as excursions away from the ball direction
whose head angular velocity exceeds a threshold. The traditional 125°/s threshold is known to
over-count versus video annotation, so sweep 125–300°/s and choose by F1 against sim ground truth.
Report a precision / recall / F1 table in `eval/`.

### Acceptance checks — analytics
- [ ] Pitch control ∈ [0, 1] and sums to 1 across teams per cell; symmetric under team swap +
      pitch flip.
- [ ] Shader vs numpy: max abs diff < 0.02 on 10 fixed snapshots.
- [ ] Vision: cells directly behind the player (outside the cone) have V < 0.05; occluded cells
      score lower than unoccluded cells at the same angle and distance.
- [ ] Scan detector F1 ≥ 0.85 on held-out seeds at the chosen threshold; table for all thresholds.
- [ ] xT grid increases toward goal (sanity plot saved).

## 5. Explain layer (`explain/`)

### 5.1 Moment detection
Rule-based detectors over events + analytics: goal, big chance, line-breaking pass, successful
counter-press, sprint tag (live overlay only). Each moment yields a `MomentCard` — the shared state
for the agents: ids, time window, involved players, key metrics, candidate lenses.

### 5.2 Lens selection by counterfactual impact
For each moment, compute candidate explanations:
- `scan`: drop the most informative scan (largest belief update about the eventual target) and
  re-simulate → counterfactual delta.
- `space`: pitch-control / xT gain of the chosen option vs the best alternative.
- `pressure`: pressing intensity on the carrier and how the action escaped it.

Pick the lens with the largest absolute delta. Record all three in the MomentCard.

### 5.3 Claims and verifier
Every factual sentence on screen comes from a `Claim`:

```json
{
  "id": "c17",
  "template": "{player} scanned {n_scans} times in the {window_s} seconds before receiving.",
  "slots": {"player": {"ref": "H8"}, "n_scans": {"value": 3}, "window_s": {"value": 6}},
  "predicate": {
    "op": "eq",
    "lhs": {"fn": "count_events",
            "args": {"type": "scan", "player": "H8", "from": -6.0, "to": 0.0, "anchor": "m12.reception"}},
    "rhs": 3
  },
  "evidence": ["e4512", "e4519", "e4533"]
}
```

- The verifier evaluates predicates against the event store → `supported | refuted | inconclusive`.
  Only `supported` claims render.
- Narration text uses slot placeholders; the renderer fills numbers from verified values. LLMs
  never emit digits.
- Predicate ops: `eq, ne, lt, le, gt, ge, approx(tol), exists, before`.
- Functions: `count_events, metric_at, metric_delta, event_attr, distance, scans_in_window,
  observed_share, cf_delta`.
- Every verdict is written to the claims audit log (Cosmos DB) with inputs and timestamps.

### Acceptance checks — explain
- [ ] Corruption test: perturb 100 supported claims (numbers ±1 / ±20%, swapped players, wrong
      order) → the verifier refutes ≥ 98%.
- [ ] No rendered caption contains a digit that did not come from a slot (regex check on the
      final render payload).
- [ ] Lens selection is deterministic for a given seed.

## 6. Agents (`agents/`)
Microsoft Agent Framework (Python) workflow; models via Microsoft Foundry with structured outputs;
tools exposed by our own MCP server.

| Agent | Input | Output (JSON schema) | Notes |
|---|---|---|---|
| Director | MomentCard stream, budget | `BreakdownRequest` (moment, personas, languages, priority) | rate-limits breakdowns; picks replay slots |
| Analyst | BreakdownRequest + MCP tools | `Findings` (lens, ranked facts as Claims) | tools: `get_moment`, `get_vision`, `get_pitch_control`, `run_counterfactual`, `get_xt`, `get_pressing` |
| Telestrator | Findings | `TelestrationPlan` | camera moves, freeze/rewind, arrows, zones, ghosts, POV segments, timecodes |
| Narrator | Findings + plan + persona + language | `Script` (lines → claim refs + slot placeholders) | one call per persona × language; a style guide per persona |
| Verifier | Script + Claims | verdicts; approve or request a rewrite | deterministic code wrapped as a workflow step |
| Voice | approved Script | audio (Azure Speech TTS, SSML) | cached by content hash |

**Failure policy.** Per-step timeout (≈ 8 s, *tunable*), one retry, then a template fallback for
that step. Refuted claim → Narrator rewrite (max 2) → drop the line. Every handoff is traced to
Application Insights.

`TelestrationPlan` sketch:

```json
{"moment": "m12", "duration_s": 18, "steps": [
  {"t": 0.0, "do": "freeze"},
  {"t": 0.3, "do": "rewind", "to": -6.0},
  {"t": 0.5, "do": "camera", "mode": "tactical"},
  {"t": 1.0, "do": "pov", "player": "H8", "from": -6.0, "to": 0.0, "speed": 0.5},
  {"t": 1.2, "do": "scan_marker", "scan": "e4519", "label_claim": "c17"},
  {"t": 6.0, "do": "zone", "layer": "vision", "player": "H8"},
  {"t": 7.5, "do": "ghost", "kind": "counterfactual", "cf": "cf3"},
  {"t": 8.0, "do": "voice", "line": "L2"}
]}
```

The same plan format doubles as a machine-readable overlay cue list for a production graphics engine.

## 7. Render (`web/`)
Vite + React + TypeScript + three.js via React Three Fiber (+ drei). Fictional teams and an
original visual identity.

- **Players:** stylised capsule/pawn tokens with team colour and number; no limb animation.
- **Cameras:**
  - broadcast — high side angle, follows the ball, smoothed;
  - tactical — top-down;
  - POV — head height ≈ 1.75 m, follows `head_yaw`, FOV ≈ 95°, smoothed;
  - player-lock — for `player_fan`.
- **Overlays:**
  - sprint speed tag (live, threshold-triggered);
  - ball / shot speed burst;
  - pass line coloured by difficulty;
  - pressing rings;
  - pitch control (GLSL shader);
  - vision cone + occlusion (shader);
  - belief ghosts (translucent "where he thought they were");
  - counterfactual ghost path.
- **Breakdown player:** executes a `TelestrationPlan`; timeline with scan ticks; split view
  (POV | tactical).
- **UI:** persona switch, language switch, favourite-player picker, producer console (claims with
  verdicts, audit trail, latency).
- POV clips ≤ 3 s with eased yaw to avoid motion sickness.

### Acceptance checks — render
- [ ] 60 fps on a laptop integrated GPU with the pitch-control shader on (Chrome).
- [ ] Every `TelestrationPlan` is schema-validated before playback; an invalid plan falls back to
      a template plan.

## 8. Platform and deploy
- **Microsoft Foundry:** one project + one model deployment with structured outputs. Verify model
  quota on the Azure for Students subscription first (M0 smoke test).
- **Azure Container Apps:** `api` (+ MCP server). Keep min replicas = 1 during judging.
- **Azure Static Web Apps:** `web`.
- **Azure Cosmos DB (serverless):** containers `matches`, `events`, `claims_audit`.
- **Azure AI Speech:** neural TTS with SSML; one voice per language.
- **Application Insights:** OpenTelemetry traces from Agent Framework and FastAPI.
- **GitHub Actions:** lint, tests, eval suite, build and deploy.
- **Infra as code:** azd + Bicep is a stretch goal; scripts are acceptable.
- Every environment variable documented in `.env.example`; no secrets in the repo.

## 9. Milestones and cut list

| Date | Milestone | Exit criteria |
|---|---|---|
| Oct 19–20 | M0 setup | registered; Azure for Students active; Foundry model + Speech resource pass a smoke test; repo + CI skeleton |
| Oct 20–21 | M1 kernels + sim | TTI / pitch control / vision / scan detector (numpy + tests); sim acceptance checks |
| Oct 22–23 | M2 render + explain | broadcast/tactical/POV cameras, live overlays, pitch-control shader parity; moments, lenses, counterfactuals, claims + verifier |
| Oct 24–25 | M3 agents + voice | Agent Framework workflow end-to-end on 3 hero moments; `en` + `zh` narration; TTS |
| Oct 26 | M4 deploy + eval | live Azure deployment; eval report; README draft |
| Oct 27 | M5 video + submit | ≤ 2:00 video; submission complete before evening CT |

**Cut order when behind:**
1. end-of-match recap reel
2. `coach` persona
3. `es` language
4. Cosmos DB → file store
5. occlusion model → FOV only
6. pitch-control shader → precomputed textures

**Never cut:** perception layer, POV breakdown, verified narration, ≥ 2 personas, Foundry + Agent
Framework, live deployment, the video.

## 10. Demo video storyboard (≤ 2:00)
- **0:00–0:15** Broadcast camera; sprint speed tag; shot speed burst.
- **0:15–0:55** Goal → freeze → "What did he see?" → POV through three scans; the third scan
  lights up the free runner → counterfactual ghost: without that look he passes back.
- **0:55–1:30** The same goal for casual / analyst / player-fan; switch voice `en` ↔ `zh`.
- **1:30–1:45** The verifier blocks a wrong number in the producer console.
- **1:45–2:00** Architecture (Microsoft stack) + eval numbers.

## 11. Submission checklist
- [ ] Registered by 2026-10-20 12:00 PT (all team members, to be safe)
- [ ] Project on Innovation Studio: pitch, Microsoft technologies used, problem solved
- [ ] Public GitHub repo created after 2026-09-29
- [ ] Video < 2:00 at a public URL (YouTube / Vimeo / Facebook Video / Youku); no third-party
      trademarks or copyrighted music
- [ ] Test link live and free until 2026-11-10, with testing instructions
- [ ] README: synthetic-data statement, architecture, how to run, eval results, related work
- [ ] All materials in English
