# Match statistics — passes, possession changes and shots per match (SPEC 3.1, 9)

`uv run python -m eval.match_stats`. The stitched match of sim/match.py (`build_match`) on match seeds 100–119 (20). Synthetic data only: a target below is a design range of SPEC 3 or a number printed in a paper cited in docs/REFERENCES.md; no dataset was used.

**2 inside, 0 outside, 0 inconclusive, 13 with no published reference (1 of them pending module A).**

| Metric | Sim (pooled) | Sim, 90% over seeds | Target | Range checked | Source | Inside |
|---|---|---|---|---|---|---|
| Play per match (min) | 12.99 ± 0.36 (n = 20 matches) | 12.85 to 13.12 | 10–15 | 10.00 to 15.00 (design range of the spec) | SPEC §3.1 | ✅ inside |
| Scenario possessions per match | 18.0 ± 0.0 (n = 20 matches) | 18.0 to 18.0 | 15–25 | 15.0 to 25.0 (design range of the spec) | SPEC §3.1 | ✅ inside |
| Passes attempted per 90 min | 1,853 (267.5 ± 9.3 per match, n = 20 matches) | 1,838 to 1,868 | no published reference | — | — | — |
| Passes completed per 90 min | 1,442 (208.2 ± 10.5 per match, n = 20 matches) | 1,419 to 1,463 | no published reference | — | — | — |
| Pass completion (%) | 80.2% (n = 5,188 resolved passes) | 79.1 to 81.3% | no published reference | — | — | — |
| Possession changes per 90 min | 355 (51.2 ± 8.1 per match, n = 20 matches) | 337 to 377 | no published reference | — | — | — |
| Possession changes by interception per 90 min | 348 (50.2 ± 8.2 per match, n = 20 matches) | 330 to 371 | no published reference | — | — | — |
| Possession changes by tackle per 90 min | 0 (0.0 ± 0.0 per match, n = 20 matches) | 0 to 0 | no published reference | — | — | — |
| Possession changes out of play per 90 min | 7 (1.0 ± 0.9 per match, n = 20 matches) | 5 to 9 | no published reference | — | — | — |
| Team possessions per 90 min | 473 (68.2 ± 8.2 per match, n = 20 matches) | 455 to 495 | no published reference | — | — | — |
| Team possession length (s) | 11.4 ± 10.6 (n = 1,365 team possessions) | 10.9 to 11.9 | no published reference | — | — | — |
| Passes per team possession | 3.92 ± 3.45 (n = 1,365 team possessions) | 3.75 to 4.08 | no published reference | — | — | — |
| Home team's share of possession time (%) | 55.9% (n = 15,591 s of team possession) | 53.7 to 58.3% | no published reference | — | — | — |
| Shots per 90 min | 0 (0.0 ± 0.0 per match, n = 20 matches) | 0 to 0 | no published reference | — | — | — |
| Shot outcomes (goals, saves, misses) | pending module A | — | no published reference | — | — | — |

## How to read it

- **Sim (pooled)**: counts are per 90 min of play (SPEC 3.1), all matches pooled: the total count over the total stitched clock, times 90 min; then the mean ± SD per match. Other rows: mean ± SD of the observations (matches or team possessions), or a pooled share. **Sim, 90% over seeds**: the 5th–95th percentile of the pooled value over 1000 bootstrap resamples of the match seeds (whole matches resampled).
- **90 min of play** is 90 min of the stitched clock. It has no stoppages: a cut skips the dead time between passages of play, so a per-90 figure here is per 90 min of the ball in play, not per 90 min of a match clock. No conversion is applied; no cited source gives one.
- **Range checked**: SPEC 3.1's design range. **Inside** compares the pooled value; with fewer than 10 matches a row is inconclusive.
- Rows marked *no published reference* have no target: SPEC 3 sets none and no paper cited in docs/REFERENCES.md is recorded there as printing one. They show the sim's distribution only. Nothing was filled in from memory or from datasets.
- *pending module A*: shot outcomes need a possession with the shot model on (`Scenario.shots`, module A); the default plan has none, so none is counted or invented.
- Held-out seeds: the plan was built on match 1, the demo match (SPEC 3.1). Open-play possessions take seeds keyed off the match seed, from 1,000,000 up, so they are never design or eval seeds. The hero possessions keep their demo seeds (blind_side_run 3, press_escape 0, corner_blind_side 0) and are the same in every match: only the open play varies between matches.

## Notes per row

- **Play per match (min)** — Length of the stitched clock: possession k starts on the frame after possession k − 1 ended, with no stoppages. Mean scenario possession: possession_play 50.8 s (n = 300), blind_side_run 6.6 s (n = 20), press_escape 5.8 s (n = 20), corner_blind_side 5.9 s (n = 20); possession_play runs until the ball goes out or the plan's cap (30–70 s, sim/match.py DEFAULT_PLAN).
- **Scenario possessions per match** — The plan (sim/match.py DEFAULT_PLAN) has 18: possession_play, blind_side_run seed 3, possession_play, possession_play, possession_play, possession_play, possession_play, press_escape seed 0, possession_play, possession_play, possession_play, possession_play, possession_play, corner_blind_side seed 0, possession_play, possession_play, possession_play, possession_play.
- **Passes attempted per 90 min** — Pass events; shots are not passes. 40 of 5,350 were chosen by the decision model (SPEC 3.5), the rest scripted (Scenario.forced_pass): possession_play holds the ball 0.6–1.6 s and plays an open teammate 8–35 m away, so its script sets the pass rate.
- **Passes completed per 90 min** — Received by a teammate of the passer, the intended receiver or another.
- **Pass completion (%)** — Completed over resolved passes (completed, intercepted or out of play). 162 passes were still rolling when their scenario possession was cut and are left out.
- **Possession changes per 90 min** — Interceptions, tackles and balls out of play. A cut between scenario possessions is an edit, not a change, and is not counted.
- **Possession changes by interception per 90 min** — An opponent of the passer controls the ball in flight (engine `interception`). Every `possession_change` event is an interception or a tackle (checked).
- **Possession changes by tackle per 90 min** — An opponent within the control radius of a carried ball wins it. Tackles are on in press_escape only (Scenario.tackles, SPEC 3.6).
- **Possession changes out of play per 90 min** — The ball crosses a line (engine `out`); the last kicker's team loses it, as the laws give the throw-in, goal kick or corner to the other side. The stitch does not hand it over: in 8 of the 17 restarts after an out, the next scenario possession starts with the team that put the ball out.
- **Team possessions per 90 min** — A team possession runs from the moment a team has the ball (the start of a scenario possession, or winning the ball) until it loses it or the scenario possession is cut; a free ball belongs to the team that last had it. A cut ends one even when the same team has the ball after it: the next scenario possession is a new passage of play.
- **Team possession length (s)** — How they ended: interception 1005, tackle 0, out 20, cut 340. Those that end at a cut are cut short by the edit, so for them the length is a lower bound.
- **Passes per team possession** — Passes the team in possession played in it; a lower bound too where it ends at a cut.
- **Home team's share of possession time (%)** — 340 of 360 scenario possessions start with the home team: possession_play gives the ball to H4, H5 or H6, and the hero scenarios are built around a home player. So the away team has the ball only after winning it, and at 156 of the 303 cuts the cut itself took the ball from the away team.
- **Shots per 90 min** — Shot events (engine `shot`, an option of the decision model). The hero possessions keep their demo seeds, so they decide the same in every match, and neither they nor possession_play have the shot model on (`Scenario.shots`), so no shot is taken.
- **Shot outcomes (goals, saves, misses)** — The shot model (`sim/shots.py`, `Scenario.shots`, module A) is on main, but no scenario of the default plan turns it on, so no outcome is counted or invented. The score counts goal events (0 here) and stays 0–0 without them (sim/match.py). SPEC 3.3's shot speed, roughly 80–130 km/h, is module A's as well and is not checked here.

## Sources

- **SPEC §3.1** — docs/SPEC.md: "A match is 15–25 scenario-driven possessions (§3.6) stitched together with restarts (kick-off, throw-in, goal kick, corner): 10–15 min of play in total, not 90 min of free play." and "Rates in the realism report are normalised per 90 min." Design targets of this project, not published values.

docs/REFERENCES.md records what each cited paper prints. None is recorded as printing per-match counts of passes, pass completion, possession changes, possessions or shots: they are about scanning (Jordet et al. 2013, 2020; Aksum et al. 2021; Kokubu et al. 2026), vision, pitch control, pressing and value models. Their full texts were not re-read for this report, so a per-match figure printed in one of them could have been missed; such a figure goes in only with its table or section.
