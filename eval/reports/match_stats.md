# Match statistics — passes, possession changes and shots per match (SPEC 3.1, 9)

`uv run python -m eval.match_stats`. The stitched match of sim/match.py (`build_match`) on match seeds 100–119 (20). Synthetic data only: a target below is a design range of SPEC 3 or a number printed in a paper cited in docs/REFERENCES.md; no dataset was used.

**0 inside, 2 outside, 0 inconclusive, 13 with no published reference (1 of them pending module A).**

Outside the target range:

- Play per match (min): sim 2.12 ± 0.17 (n = 20 matches); target 10–15 (SPEC §3.1).
- Scenario possessions per match: sim 6.0 ± 0.0 (n = 20 matches); target 15–25 (SPEC §3.1).

| Metric | Sim (pooled) | Sim, 90% over seeds | Target | Range checked | Source | Inside |
|---|---|---|---|---|---|---|
| Play per match (min) | 2.12 ± 0.17 (n = 20 matches) | 2.06 to 2.18 | 10–15 | 10.00 to 15.00 (design range of the spec) | SPEC §3.1 | ❌ outside |
| Scenario possessions per match | 6.0 ± 0.0 (n = 20 matches) | 6.0 to 6.0 | 15–25 | 15.0 to 25.0 (design range of the spec) | SPEC §3.1 | ❌ outside |
| Passes attempted per 90 min | 1,841 (43.5 ± 4.4 per match, n = 20 matches) | 1,810 to 1,870 | no published reference | — | — | — |
| Passes completed per 90 min | 1,453 (34.3 ± 4.5 per match, n = 20 matches) | 1,411 to 1,493 | no published reference | — | — | — |
| Pass completion (%) | 82.7% (n = 830 resolved passes) | 80.4 to 85.0% | no published reference | — | — | — |
| Possession changes per 90 min | 305 (7.2 ± 2.8 per match, n = 20 matches) | 261 to 347 | no published reference | — | — | — |
| Possession changes by interception per 90 min | 290 (6.8 ± 2.8 per match, n = 20 matches) | 249 to 331 | no published reference | — | — | — |
| Possession changes by tackle per 90 min | 0 (0.0 ± 0.0 per match, n = 20 matches) | 0 to 0 | no published reference | — | — | — |
| Possession changes out of play per 90 min | 15 (0.3 ± 0.7 per match, n = 20 matches) | 6 to 26 | no published reference | — | — | — |
| Team possessions per 90 min | 544 (12.8 ± 2.8 per match, n = 20 matches) | 503 to 585 | no published reference | — | — | — |
| Team possession length (s) | 9.9 ± 8.0 (n = 257 team possessions) | 9.2 to 10.7 | no published reference | — | — | — |
| Passes per team possession | 3.38 ± 2.59 (n = 257 team possessions) | 3.15 to 3.65 | no published reference | — | — | — |
| Home team's share of possession time (%) | 66.3% (n = 2,549 s of team possession) | 61.1 to 71.0% | no published reference | — | — | — |
| Shots per 90 min | 0 (0.0 ± 0.0 per match, n = 20 matches) | 0 to 0 | no published reference | — | — | — |
| Shot outcomes (goals, saves, misses) | pending module A | — | no published reference | — | — | — |

## How to read it

- **Sim (pooled)**: counts are per 90 min of play (SPEC 3.1), all matches pooled: the total count over the total stitched clock, times 90 min; then the mean ± SD per match. Other rows: mean ± SD of the observations (matches or team possessions), or a pooled share. **Sim, 90% over seeds**: the 5th–95th percentile of the pooled value over 1000 bootstrap resamples of the match seeds (whole matches resampled).
- **90 min of play** is 90 min of the stitched clock. It has no stoppages: a cut skips the dead time between passages of play, so a per-90 figure here is per 90 min of the ball in play, not per 90 min of a match clock. No conversion is applied; no cited source gives one.
- **Range checked**: SPEC 3.1's design range. **Inside** compares the pooled value; with fewer than 10 matches a row is inconclusive.
- Rows marked *no published reference* have no target: SPEC 3 sets none and no paper cited in docs/REFERENCES.md is recorded there as printing one. They show the sim's distribution only. Nothing was filled in from memory or from datasets.
- *pending module A*: shot outcomes come with the shot outcome model being built as module A (`Scenario.shots`); until then none is counted or invented.
- Held-out seeds: the plan was built on match 1, the demo match (SPEC 3.1). Open-play possessions take seeds keyed off the match seed, from 1,000,000 up, so they are never design or eval seeds. The two hero possessions keep their demo seeds (blind_side_run 3, press_escape 0) and are the same in every match: only the open play varies between matches.

## Notes per row

- **Play per match (min)** — Length of the stitched clock: possession k starts on the frame after possession k − 1 ended, with no stoppages. Mean scenario possession: possession_play 28.8 s (n = 80), blind_side_run 6.6 s (n = 20), press_escape 5.8 s (n = 20); possession_play runs to 30 s (sim/match.py POSSESSION_S) unless the ball goes out.
- **Scenario possessions per match** — The plan (sim/match.py DEFAULT_PLAN) has 6: possession_play, blind_side_run seed 3, possession_play, press_escape seed 0, possession_play, possession_play. SPEC 3.1 records it as 5–8 possessions for now.
- **Passes attempted per 90 min** — Pass events; shots are not passes. 40 of 869 were chosen by the decision model (SPEC 3.5), the rest scripted (Scenario.forced_pass): possession_play holds the ball 0.6–1.6 s and plays an open teammate 8–35 m away, so its script sets the pass rate.
- **Passes completed per 90 min** — Received by a teammate of the passer, the intended receiver or another.
- **Pass completion (%)** — Completed over resolved passes (completed, intercepted or out of play). 39 passes were still rolling when their scenario possession was cut and are left out.
- **Possession changes per 90 min** — Interceptions, tackles and balls out of play. A cut between scenario possessions is an edit, not a change, and is not counted.
- **Possession changes by interception per 90 min** — An opponent of the passer controls the ball in flight (engine `interception`). Every `possession_change` event is an interception or a tackle (checked).
- **Possession changes by tackle per 90 min** — An opponent within the control radius of a carried ball wins it. Tackles are on in press_escape only (Scenario.tackles, SPEC 3.6).
- **Possession changes out of play per 90 min** — The ball crosses a line (engine `out`); the last kicker's team loses it, as the laws give the throw-in, goal kick or corner to the other side. The stitch does not hand it over: in 2 of the 4 restarts after an out, the next scenario possession starts with the team that put the ball out.
- **Team possessions per 90 min** — A team possession runs from the moment a team has the ball (the start of a scenario possession, or winning the ball) until it loses it or the scenario possession is cut; a free ball belongs to the team that last had it. A cut ends one even when the same team has the ball after it: the next scenario possession is a new passage of play.
- **Team possession length (s)** — How they ended: interception 137, tackle 0, out 7, cut 113. Those that end at a cut are cut short by the edit, so for them the length is a lower bound.
- **Passes per team possession** — Passes the team in possession played in it; a lower bound too where it ends at a cut.
- **Home team's share of possession time (%)** — 120 of 120 scenario possessions start with the home team: possession_play gives the ball to H4, H5 or H6, and both hero scenarios are built around a home player. So the away team has the ball only after winning it, and at 34 of the 96 cuts the cut itself took the ball from the away team.
- **Shots per 90 min** — Shot events (engine `shot`, an option of the decision model). The hero possessions keep their demo seeds, so they decide the same in every match, and possession_play never shoots.
- **Shot outcomes (goals, saves, misses)** — The shot outcome model (`Scenario.shots`, module A) is not on main, so no outcome is counted or invented. The score counts goal events (0 here) and stays 0–0 without them (sim/match.py). SPEC 3.3's shot speed, roughly 80–130 km/h, is module A's as well and is not checked here.

## Sources

- **SPEC §3.1** — docs/SPEC.md: "A match is 15–25 scenario-driven possessions (§3.6) stitched together with restarts (kick-off, throw-in, goal kick, corner): 10–15 min of play in total, not 90 min of free play." and "Rates in the realism report are normalised per 90 min." Design targets of this project, not published values.

docs/REFERENCES.md records what each cited paper prints. None is recorded as printing per-match counts of passes, pass completion, possession changes, possessions or shots: they are about scanning (Jordet et al. 2013, 2020; Aksum et al. 2021; Kokubu et al. 2026), vision, pitch control, pressing and value models. Their full texts were not re-read for this report, so a per-match figure printed in one of them could have been missed; such a figure goes in only with its table or section.
