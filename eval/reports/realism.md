# Realism — sim vs published values (SPEC 3.8)

`uv run python -m eval.realism`. `possession_play` seeds 100–199 (100), 45 s of passing play each (a run ends early if the ball goes out). Synthetic data only: every published value below is a number printed in a paper cited in docs/REFERENCES.md; no dataset was used.

**11 inside, 5 outside, 0 inconclusive, 10 with no published reference.**

Outside the published range:

- Cohen's d of scan frequency, central midfielders vs forwards †: sim d = 0.90 (n = 485 vs 51); published d = 0.54.
- Cohen's d of scan frequency, central midfielders vs wingers †: sim d = 0.63 (n = 485 vs 55); published d = 0.33.
- Cohen's d of scan frequency, central defenders vs forwards †: sim d = 0.69 (n = 280 vs 51); published d = 0.51.
- Cohen's d of scan frequency, side defenders vs forwards †: sim d = 0.28 (n = 237 vs 51); published d = 0.20.
- Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception †: sim d = 0.15 (n = 257 vs 113); published d = 0.57 (lower under tight pressure).

| Metric | Sim (pooled) | Sim, 90% over seeds | Published | Range checked | Source | Inside |
|---|---|---|---|---|---|---|
| Scans in the 10 s before receiving † | 2.77 ± 1.66 (n = 1108) | 2.68 to 2.86 | 3.0 ± 2.1 | 0.90 to 5.10 (mean ± SD) | Jordet et al. (2020), Results › General | ✅ inside |
| Scan frequency before receiving (scans/s) | 0.40 ± 0.20 (n = 1108) | 0.39 to 0.41 | 0.44 ± 0.30 | 0.14 to 0.74 (mean ± SD) | Jordet et al. (2020), Results › General | ✅ inside |
| Scan frequency, midfielders and forwards receiving from a teammate nearer their goal (scans/s) | 0.42 ± 0.20 (n = 393) | 0.40 to 0.43 | 0.27 ± 0.22 (no major award); 0.33 ± 0.25 (award) | 0.05 to 0.58 (both groups' mean ± SD) | Jordet et al. (2013), Results, p. 3 | ✅ inside |
| Scan frequency, central midfielders (scans/s) | 0.46 ± 0.20 (n = 485) | 0.44 to 0.47 | no published reference | — | — | — |
| Scan frequency, central defenders (scans/s) | 0.40 ± 0.18 (n = 280) | 0.38 to 0.42 | no published reference | — | — | — |
| Scan frequency, wingers (scans/s) | 0.33 ± 0.18 (n = 55) | 0.29 to 0.38 | no published reference | — | — | — |
| Scan frequency, side defenders (scans/s) | 0.34 ± 0.21 (n = 237) | 0.31 to 0.36 | no published reference | — | — | — |
| Scan frequency, forwards (scans/s) | 0.28 ± 0.22 (n = 51) | 0.23 to 0.32 | no published reference | — | — | — |
| Positional order of scan frequency † | central midfielders 0.46 > central defenders 0.40 > side defenders 0.34 > wingers 0.33 > forwards 0.28 | order holds in 93% of resamples | central midfielders highest, forwards lowest | the same order at both ends | Jordet et al. (2020), Results › Positional Role | ✅ inside |
| Cohen's d of scan frequency, central midfielders vs forwards † | d = 0.90 (n = 485 vs 51) | 0.66 to 1.17 | d = 0.54 | 0.48 to 0.60 (95% CI) | Jordet et al. (2020), Figure 2 | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs side defenders † | d = 0.60 (n = 485 vs 237) | 0.45 to 0.74 | d = 0.56 | 0.51 to 0.61 (95% CI) | Jordet et al. (2020), Results › Positional Role; Figure 2 | ✅ inside |
| Cohen's d of scan frequency, central midfielders vs wingers † | d = 0.63 (n = 485 vs 55) | 0.40 to 0.87 | d = 0.33 | 0.27 to 0.39 (95% CI) | Jordet et al. (2020), Figure 2 | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs central defenders † | d = 0.29 (n = 485 vs 280) | 0.17 to 0.41 | d = 0.29 | 0.24 to 0.34 (95% CI) | Jordet et al. (2020), Figure 2 | ✅ inside |
| Cohen's d of scan frequency, central defenders vs forwards † | d = 0.69 (n = 280 vs 51) | 0.42 to 0.97 | d = 0.51 | 0.43 to 0.59 (95% CI) | Jordet et al. (2020), Figure 2 | ❌ outside |
| Cohen's d of scan frequency, central defenders vs side defenders † | d = 0.34 (n = 280 vs 237) | 0.18 to 0.50 | d = 0.37 | 0.31 to 0.43 (95% CI) | Jordet et al. (2020), Figure 2 | ✅ inside |
| Cohen's d of scan frequency, wingers vs forwards † | d = 0.29 (n = 55 vs 51) | −0.01 to 0.63 | d = 0.36 | 0.27 to 0.45 (95% CI) | Jordet et al. (2020), Figure 2 | ✅ inside |
| Cohen's d of scan frequency, side defenders vs forwards † | d = 0.28 (n = 237 vs 51) | 0.04 to 0.55 | d = 0.20 | 0.12 to 0.28 (95% CI) | Jordet et al. (2020), Figure 2 | ❌ outside |
| Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception † | d = 0.15 (n = 257 vs 113) | −0.06 to 0.36 | d = 0.57 (lower under tight pressure) | 0.49 to 0.65 (95% CI) | Jordet et al. (2020), Results › Opponent Pressure; Figure 3 | ❌ outside |
| Scan duration, ball out of the 82° scene-camera frame (s) † | 0.44 ± 0.28 (n = 15332) | 0.44 to 0.45 | 0.40 ± 0.28 (39.65 cs, SD 28.42 cs) | 0.11 to 0.68 (mean ± SD) | Aksum et al. (2021), Results › Scanning duration | ✅ inside |
| Scans with the ball out of frame for ≤ 0.66 s (%) † | 89.7% (n = 15332) | 89.3 to 90.2% | 90.3% (n = 869) | 88.3 to 92.3% (95% CI of the printed share) | Aksum et al. (2021), Results › Scanning duration; Fig 3 | ✅ inside |
| Peak head angular speed during a scan (°/s) † | 404 ± 51 (n = 33376) | 404 to 405 | 404.2 ± 50.7 | 354 to 455 (mean ± SD) | Kokubu et al. (2026), Results 3.1 | ✅ inside |
| Peak speed per outfield player per run (m/s) | 6.68 ± 1.22 (n = 2000) | 6.64 to 6.73 | no published reference | — | — | — |
| Peak acceleration per outfield player per run (m/s²) | 3.50 ± 0.00 (n = 2000) | 3.50 to 3.50 | no published reference | — | — | — |
| Peak deceleration per outfield player per run (m/s²) | 4.99 ± 0.06 (n = 2000) | 4.99 to 4.99 | no published reference | — | — | — |
| Pass launch speed (m/s) | 11.67 ± 3.56 (n = 1674) | 11.55 to 11.79 | no published reference | — | — | — |
| Pass average ball speed, kick to end of the pass (m/s) | 9.97 ± 2.93 (n = 1621) | 9.88 to 10.07 | no published reference | — | — | — |

## Team shape

**8 inside, 6 outside, 0 inconclusive, 23 with no published reference.**

Without the team shape (*Before: anchors*), the same seeds land inside on 4 of these 14: outside on team length (m), out of possession (43.2); team length (m), all phases (41.4); team width (m), out of possession (46.9); team width (m), all phases (47.3); defensive line height: deepest outfield player to own goal line (m), all phases (25.8); keeper to his nearest outfield team-mate (m), all phases (20.3); distance from the defensive to the midfield line (m), out of possession (15.6); distance from the midfield to the forward line (m), out of possession (18.4); defensive line height on the ball's distance from the goal defended: slope, out of possession (0.226); defensive line height on the ball's distance from the goal defended: intercept, out of possession (13.67).

Outside the published range:

- Team length (m), all phases: sim 34.0 ± 5.9 (134 team-min); published 36.854 ± 1.659.
- Team width (m), all phases: sim 39.2 ± 3.1 (134 team-min); published 43.423 ± 2.053.
- Defensive line height: deepest outfield player to own goal line (m), all phases: sim 32.6 ± 8.1 (134 team-min); published 37.323 ± 2.977.
- Keeper to his nearest outfield team-mate (m), all phases: sim 21.9 ± 5.1 (134 team-min); published 24.969 ± 1.716.
- Defensive line height on the ball's distance from the goal defended: slope, out of possession: sim 0.405 (r = 0.752, 20100 samples); published 0.46 (SE 0.003; r = 0.859).
- Defensive line height on the ball's distance from the goal defended: intercept, out of possession: sim 8.94 m (r = 0.752, 20100 samples); published 6.30 m (SE 0.209; r = 0.859).

| Metric | Phase | Sim (pooled) | Sim, 90% over seeds | Before: anchors | Published | Range checked | Source | Inside |
|---|---|---|---|---|---|---|---|---|
| Team length (m) † | in possession | 37.3 ± 4.3 (43 team-min) | 36.9 to 37.6 | 39.9 | 36.4 ± 6.8 and 36.2 ± 6.7 | 29.5 to 43.2 (both teams' mean ± SD) | Castellano et al. (2013), Table 1 | ✅ inside |
| Team length (m) † | out of possession | 32.2 ± 6.4 (43 team-min) | 31.7 to 32.8 | 43.2 | 32.49 ± 8.69 and 32.22 ± 9.16 | 23.1 to 41.4 (both groups' mean ± SD) | Forcher et al. (2024), Table 7.1 | ✅ inside |
| Team length (m) | just won the ball | 31.9 ± 5.6 (24 team-min) | 31.5 to 32.3 | 40.5 | no published reference | — | — | — |
| Team length (m) | just lost the ball | 33.4 ± 5.1 (24 team-min) | 33.1 to 33.7 | 41.3 | no published reference | — | — | — |
| Team length (m) | all phases | 34.0 ± 5.9 (134 team-min) | 33.7 to 34.3 | 41.4 | 36.854 ± 1.659 | 35.2 to 38.5 (mean ± match SD) | Errekagorri et al. (2024), Table 4 | ❌ outside |
| Team width (m) † | in possession | 41.3 ± 1.1 (43 team-min) | 41.3 to 41.4 | 48.5 | 41.0 ± 10.0 and 41.8 ± 10.0 | 31.0 to 51.8 (both teams' mean ± SD) | Castellano et al. (2013), Table 1 | ✅ inside |
| Team width (m) † | out of possession | 37.9 ± 3.5 (43 team-min) | 37.7 to 38.1 | 46.9 | 37.34 ± 4.83 and 37.14 ± 4.86 | 32.3 to 42.2 (both groups' mean ± SD) | Forcher et al. (2024), Table 7.1 | ✅ inside |
| Team width (m) | just won the ball | 38.3 ± 3.0 (24 team-min) | 38.1 to 38.5 | 46.2 | no published reference | — | — | — |
| Team width (m) | just lost the ball | 38.5 ± 2.9 (24 team-min) | 38.4 to 38.7 | 46.8 | no published reference | — | — | — |
| Team width (m) | all phases | 39.2 ± 3.1 (134 team-min) | 39.1 to 39.3 | 47.3 | 43.423 ± 2.053 | 41.4 to 45.5 (mean ± match SD) | Errekagorri et al. (2024), Table 4 | ❌ outside |
| Length per width | in possession | 0.90 ± 0.11 (43 team-min) | 0.89 to 0.91 | 0.83 | no published reference | — | — | — |
| Length per width | out of possession | 0.86 ± 0.18 (43 team-min) | 0.84 to 0.87 | 0.93 | no published reference | — | — | — |
| Length per width | just won the ball | 0.84 ± 0.15 (24 team-min) | 0.82 to 0.85 | 0.88 | no published reference | — | — | — |
| Length per width | just lost the ball | 0.87 ± 0.12 (24 team-min) | 0.86 to 0.88 | 0.89 | no published reference | — | — | — |
| Length per width | all phases | 0.87 ± 0.15 (134 team-min) | 0.86 to 0.88 | 0.88 | no published reference | — | — | — |
| Defensive line height: deepest outfield player to own goal line (m) † | in possession | 34.2 ± 9.5 (43 team-min) | 33.4 to 35.1 | 23.2 | 31.2 ± 13.3 and 36.2 ± 13.5 | 17.9 to 49.7 (both teams' mean ± SD) | Castellano et al. (2013), Results p. 440 | ✅ inside |
| Defensive line height: deepest outfield player to own goal line (m) † | out of possession | 30.4 ± 6.1 (43 team-min) | 29.8 to 30.9 | 28.4 | 31.0 ± 12.2 and 35.3 ± 13.1 | 18.8 to 48.4 (both teams' mean ± SD) | Castellano et al. (2013), Results p. 440 | ✅ inside |
| Defensive line height: deepest outfield player to own goal line (m) | just won the ball | 32.7 ± 8.0 (24 team-min) | 32.2 to 33.2 | 25.2 | no published reference | — | — | — |
| Defensive line height: deepest outfield player to own goal line (m) | just lost the ball | 33.4 ± 7.8 (24 team-min) | 33.0 to 33.9 | 26.3 | no published reference | — | — | — |
| Defensive line height: deepest outfield player to own goal line (m) | all phases | 32.6 ± 8.1 (134 team-min) | 32.4 to 32.7 | 25.8 | 37.323 ± 2.977 | 34.3 to 40.3 (mean ± match SD) | Errekagorri et al. (2024), Table 4 | ❌ outside |
| Keeper to his nearest outfield team-mate (m) | in possession | 24.1 ± 5.5 (43 team-min) | 23.6 to 24.5 | 19.2 | no published reference | — | — | — |
| Keeper to his nearest outfield team-mate (m) | out of possession | 19.3 ± 3.5 (43 team-min) | 19.0 to 19.5 | 21.3 | no published reference | — | — | — |
| Keeper to his nearest outfield team-mate (m) | just won the ball | 21.8 ± 4.9 (24 team-min) | 21.6 to 22.1 | 20.0 | no published reference | — | — | — |
| Keeper to his nearest outfield team-mate (m) | just lost the ball | 22.7 ± 4.8 (24 team-min) | 22.5 to 23.0 | 20.7 | no published reference | — | — | — |
| Keeper to his nearest outfield team-mate (m) | all phases | 21.9 ± 5.1 (134 team-min) | 21.8 to 22.0 | 20.3 | 24.969 ± 1.716 | 23.3 to 26.7 (mean ± match SD) | Errekagorri et al. (2024), Table 4 | ❌ outside |
| Distance from the defensive to the midfield line (m) | in possession | 15.8 ± 2.6 (43 team-min) | 15.6 to 16.0 | 16.6 | no published reference | — | — | — |
| Distance from the defensive to the midfield line (m) † | out of possession | 11.4 ± 3.4 (43 team-min) | 11.2 to 11.7 | 15.6 | 10.22 ± 3.76 and 10.16 ± 3.89 | 6.3 to 14.1 (both groups' mean ± SD) | Forcher et al. (2024), Table 7.1 | ✅ inside |
| Distance from the defensive to the midfield line (m) | just won the ball | 11.7 ± 3.7 (24 team-min) | 11.4 to 11.9 | 15.5 | no published reference | — | — | — |
| Distance from the defensive to the midfield line (m) | just lost the ball | 13.0 ± 3.5 (24 team-min) | 12.7 to 13.2 | 16.3 | no published reference | — | — | — |
| Distance from the defensive to the midfield line (m) | all phases | 13.1 ± 3.7 (134 team-min) | 13.0 to 13.3 | 16.0 | no published reference | — | — | — |
| Distance from the midfield to the forward line (m) | in possession | 15.4 ± 2.9 (43 team-min) | 15.2 to 15.7 | 16.9 | no published reference | — | — | — |
| Distance from the midfield to the forward line (m) † | out of possession | 14.3 ± 5.0 (43 team-min) | 14.0 to 14.7 | 18.4 | 13.30 ± 4.22 and 13.19 ± 4.21 | 9.0 to 17.5 (both groups' mean ± SD) | Forcher et al. (2024), Table 7.1 | ✅ inside |
| Distance from the midfield to the forward line (m) | just won the ball | 13.6 ± 3.9 (24 team-min) | 13.3 to 13.8 | 16.8 | no published reference | — | — | — |
| Distance from the midfield to the forward line (m) | just lost the ball | 13.1 ± 4.3 (24 team-min) | 12.8 to 13.4 | 16.5 | no published reference | — | — | — |
| Distance from the midfield to the forward line (m) | all phases | 14.3 ± 4.2 (134 team-min) | 14.1 to 14.5 | 17.3 | no published reference | — | — | — |
| Defensive line height on the ball's distance from the goal defended: slope | out of possession | 0.405 (r = 0.752, 20100 samples) | 0.392 to 0.420 | 0.226 | 0.46 (SE 0.003; r = 0.859) | 0.454 to 0.466 (95% CI from the printed SE) | Castellano & Álvarez (2013), Tabla 2 | ❌ outside |
| Defensive line height on the ball's distance from the goal defended: intercept | out of possession | 8.94 m (r = 0.752, 20100 samples) | 8.11 to 9.74 | 13.67 | 6.30 m (SE 0.209; r = 0.859) | 5.89 to 6.71 (95% CI from the printed SE) | Castellano & Álvarez (2013), Tabla 2 | ❌ outside |

How to read it:

- Each team's outfield players, sampled at 5 Hz after the first 5 s of a run (while they leave their setup spots), measured as analytics/team_shape.py defines it, from positions and possession only. **Sim (pooled)**: mean ± SD over the sampled team-frames, and how many team-minutes they make up; **90% over seeds** as above.
- **Phases.** *Just won the ball* and *just lost the ball* are the 5 s after a change of possession; *in possession* and *out of possession* are the rest, the settled phases. The five seconds are ours; Forcher et al. (2024) count settled defence from opponent possessions of three passes and five seconds or more.
- **Before: anchors**: the same seeds without the team shape (`Scenario.team_shape` off): every player's setup spot shifted with the ball, as every scenario still moves (the pooled mean).
- **Range checked**: every printed mean ± 1 SD (two teams, or successful and unsuccessful defending); for Errekagorri et al. (2024), whose values are per-match means, the mean ± the match-to-match SD; for the regression, the 95% CI computed from the printed standard error. **†**: the shape's parameters (sim/team_shape.py `ShapeParams`) were fitted by hand to these printed means on `possession_play` tuning seeds 0–39; the seeds here are held out. The rows without † were not fitted to.
- **All phases** pools every sampled team-frame, as a per-match mean does.
- **Length per width** is checked against nothing: no 11 v 11 source prints it (the youth small-sided Folgado et al. 2014 is read in abstract only, which prints none). The ratios of the printed means are 0.87–0.89 in possession and 0.87–0.93 out of it (docs/REFERENCES.md, Team shape); a ratio of means is not a mean of ratios.
- **Transitions** have no printed reference. Santos & Lago-Peñas (2019) print the shape of one team at the instant it wins the ball as regression intercepts, 35.451 m long and 34.604 m wide, for one reference condition: not a sample mean, so not checked.
- `possession_play` keeps the ball rather than going forward, so the ball sits nearer the team's own goal than in a real match, and that sets where its lines stand (the note on the defensive line in possession gives the numbers).

- **Team length (m) †, in possession** — EQ1, the reference team, and EQ2, its opponents: deepest to most advanced outfield player.
- **Team length (m) †, out of possession** — Settled defence, successful and unsuccessful defensive plays; the convex hull's length. Castellano et al. (2013, Table 1) print 33.1 ± 8.0 and 34.5 ± 7.1 out of possession.
- **Team length (m), all phases** — Per-match means over 5,518 team-matches, both phases together; the range is the mean ± the match-to-match SD within a team (the model's residual SD). Its teams are wider, longer and higher than Castellano et al.'s (2013) one team, to whose in and out of possession means the shape is fitted.
- **Team width (m) †, in possession** — EQ1, the reference team, and EQ2, its opponents: between the two widest outfield players.
- **Team width (m) †, out of possession** — Settled defence, successful and unsuccessful defensive plays. Castellano et al. (2013, Table 1) print 36.5 ± 7.0 and 37.0 ± 7.0 out of possession.
- **Team width (m), all phases** — Per-match means over 5,518 team-matches, both phases together; the range is the mean ± the match-to-match SD within a team (the model's residual SD). Its teams are wider, longer and higher than Castellano et al.'s (2013) one team, to whose in and out of possession means the shape is fitted.
- **Defensive line height: deepest outfield player to own goal line (m) †, in possession** — EQ1, the reference team, and EQ2, its opponents; the paper's defensive height. In possession the ball is a median 49.0 m from the team's own goal line: `possession_play` has no intent to go forward. In Castellano et al. it is 58 ± 23.9 m from the goal attacked on a 105.5 m pitch (p. 440), 47.5 m from its own.
- **Defensive line height: deepest outfield player to own goal line (m) †, out of possession** — EQ1, the reference team, and EQ2, its opponents; the paper's defensive height.
- **Defensive line height: deepest outfield player to own goal line (m), all phases** — Per-match means over 5,518 team-matches, both phases together; the range is the mean ± the match-to-match SD within a team (the model's residual SD). Its teams are wider, longer and higher than Castellano et al.'s (2013) one team, to whose in and out of possession means the shape is fitted. The paper's Height: the deepest outfield player to the goal line he defends.
- **Keeper to his nearest outfield team-mate (m), all phases** — Per-match means over 5,518 team-matches; the paper's GkDef, the keeper to the nearest defender of his team, read here as his nearest outfield team-mate. The sim's keeper stands at most 15.5 m out (sim/team_shape.py), so a high line leaves him far behind it.
- **Distance from the defensive to the midfield line (m) †, out of possession** — Settled defence, successful and unsuccessful defensive plays; lines by k-means on depth, as here.
- **Distance from the midfield to the forward line (m) †, out of possession** — Settled defence, successful and unsuccessful defensive plays; lines by k-means on depth, as here.
- **Defensive line height on the ball's distance from the goal defended: slope, out of possession** — Ordinary least squares on every sampled team-frame without the ball (settled and just lost), as the paper fits it on every touch with the opponents on the ball: the deepest outfield player's distance to the goal he defends on the ball's distance to it. The sim's defending line targets this regression (sim/team_shape.py), so the check is how much of it survives marking, pressing and the block's lag behind the ball.
- **Defensive line height on the ball's distance from the goal defended: intercept, out of possession** — Ordinary least squares on every sampled team-frame without the ball (settled and just lost), as the paper fits it on every touch with the opponents on the ball: the deepest outfield player's distance to the goal he defends on the ball's distance to it. The sim's defending line targets this regression (sim/team_shape.py), so the check is how much of it survives marking, pressing and the block's lag behind the ball.

## How to read it

- **Sim (pooled)**: all observations of all seeds pooled; mean ± SD of the observations and their number. **Sim, 90% over seeds**: the 5th–95th percentile of the pooled value over 1000 bootstrap resamples of the seeds (whole runs resampled), i.e. how much it depends on which matches were simulated.
- **Range checked**: the paper's printed 95% CI when it prints one; else the printed mean ± 1 SD — the spread of single situations, so *inside* means the sim's average is a typical real value, not that the means agree; else, for a printed share, its binomial 95% CI computed from the printed n. **Inside** compares the pooled value; a group with fewer than 10 observations is inconclusive.
- **†**: the sim's scan parameters (sim/config.py) were fitted to this printed value on `possession_play` tuning seeds 0–99 (SPEC 3.4). The seeds here are held out, so *inside* shows that the fit carries over to new matches, not independent agreement.
- Rows marked *no published reference* have no printed value in any cited paper; they show the sim's distribution only. Nothing was filled in from memory or from datasets.
- The populations differ from the sim's 22 synthetic players: one EPL club's 27 players (Jordet 2020), 118 EPL forwards and midfielders (Jordet 2013), four elite midfielders (Aksum 2021), twelve university players in a 6 v 6 game (Kokubu 2026).

## Notes per row

- **Scans in the 10 s before receiving †** — Sim `scan` events of the receiver with onset in the window; partial head turns are not scans. The window starts at the latest of 10 s before the reception, the moment the team won the ball, and the run start (the paper cuts it at turnovers and set plays). Mean window 7.0 s; 37% of receptions have the full 10 s. SPEC 3.8 asks for the mean within ±25% of the SPEC 3.4 target of ≈ 3 (2.25–3.75): met.
- **Scan frequency before receiving (scans/s)** — Scans divided by the window length, per reception, then averaged as the paper does. It sits far below the configured rates (sim/config.py ROLES), which hold while the head is free and no opponent is within 10 m: a scan in progress, its refractory time and partial head turns block new scans, and nearer opponents slow them.
- **Scan frequency, midfielders and forwards receiving from a teammate nearer their goal (scans/s)** — The 2013 sample: forwards and midfielders receiving a pass from a teammate closer to their own goal (along the attack direction, at the kick). The range spans both groups' mean ± SD. The paper's highest per-player means (0.62, two players) have no spread and are not checked.
- **Scan frequency, central midfielders (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: DM 1.19, CM 1.19, AM 1.19 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Scan frequency, central defenders (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: CB 0.74 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Scan frequency, wingers (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: W 0.74 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Scan frequency, side defenders (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: FB 0.56 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Scan frequency, forwards (scans/s)** — Configured rate while the head is free and no opponent is within 10 m: ST 0.66 per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so no value is checked; the effect sizes it prints are compared below, and the configured rates were fitted to them.
- **Positional order of scan frequency †** — Only the two ends of the order are printed in the text; the bars of Figure 2 are not read off. Central midfielders pool the sim's DM, CM and AM; by sim role: CB 0.40, FB 0.34, DM 0.48, CM 0.43, AM 0.45, W 0.33, ST 0.28.
- **Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception †** — The paper's bins are whole metres, so 0–1 m is read as < 1.5 m and 10+ m as ≥ 9.5 m. The sim slows scanning as the closest opponent nears (sim/config.py, pressure_scan_factor, set from this d in closed form), and possession_play marks, so a receiver at 0–1 m has usually been marked: an opponent within 3 m for a median 52% of his window (0% at 10+ m), 3.8 m away on average against 11.5 m. The bins also differ by role: 70 of the 113 receptions at 0–1 m are central midfielders, who scan most, against 46 of the 257 at 10+ m, where 207 are central or side defenders. With the pressure term off (factor 1) the same receptions give d = −0.21: that is the role mix. The pressure term moves d by +0.37, less than the paper's whole d. The closed-form factor assumed the bins differ only in pressure, and that a change in the configured rate shows in full in the measured one; scan dead time compresses it (eval/scan_calibration.py).
- **Scan duration, ball out of the 82° scene-camera frame (s) †** — Midfielders' scans off the ball, timed from the first 25 Hz frame with the ball more than 41° from the true head direction to the first frame back (the paper: from the first video frame without the ball to the first with it; micro scans that keep the ball in frame are excluded there as here). Vertical framing is ignored. Printed but not checked (no spread): median 0.34 s, most common 0.26 s, longest 3.28 s; sim median 0.40 s, longest 3.20 s. The median is set by the turn itself (70–150° out and back at about 404°/s); the dwell was fitted to the share and SD.
- **Scans with the ball out of frame for ≤ 0.66 s (%) †** — Same scans and timing as the row above. The range is the binomial 95% CI of the printed 90.3% with n = 869, computed here (normal approximation); the paper prints no interval.
- **Peak head angular speed during a scan (°/s) †** — Outfield scans; frame-to-frame yaw change of the true head at 25 Hz (the paper: yaw rate from a head-worn IMU at 200 Hz, scans detected at 250°/s). Each sim scan draws its peak speed from 404.2 ± 50.7°/s (sim/config.py scan_omega, this printed value), so inside is by construction. The paper does not say whether its SD is over scans or players.
- **Peak speed per outfield player per run (m/s)** — Highest 9.50 m/s; 40% of player-runs pass the SPEC 4.6 sprint threshold (7.0 m/s). Spearman (2018, §3.1.1) sets v = 5 m/s in its time-to-intercept model as an 'average sustainable speed': a model parameter, not a measured top speed, so it is not used here.
- **Peak acceleration per outfield player per run (m/s²)** — Rate of speed increase over one frame; the sim caps it at a_max. Spearman (2018, §3.1.1) sets a = 7 m/s² in its time-to-intercept model, a model parameter: not used.
- **Peak deceleration per outfield player per run (m/s²)** — Rate of speed decrease over one frame; the sim caps it at d_max.
- **Pass launch speed (m/s)** — Ground passes only (SPEC 3.3, M1). No cited paper prints pass or ball speeds; the average ball speed in Shaw's tutorial code is not a paper and is not used.
- **Pass average ball speed, kick to end of the pass (m/s)** — Straight-line distance over flight time, for passes that were received, intercepted or went out.

## Sources

- **Jordet et al. (2020)** — Scanning, contextual factors, and association with performance in English Premier League footballers: an investigation across a season. Frontiers in Psychology 11:553813. 27 players of one EPL club, 21 home games, 9,574 ball possessions, scans counted from close-up video. https://pmc.ncbi.nlm.nih.gov/articles/PMC7573254/
- **Jordet et al. (2013)** — Jordet, Bloomfield, Heijmerikx. The hidden foundation of field vision in English Premier League (EPL) soccer players. MIT Sloan Sports Analytics Conference. 118 players (63 forwards, 55 midfielders), 1,279 situations, from broadcast player-cam video. https://www.sloansportsconference.com/research-papers/the-hidden-foundation-of-field-vision-in-english-premier-league-epl-soccer-players
- **Aksum et al. (2021)** — Scanning activity of elite football players in 11 vs. 11 match play: an eye-tracking analysis on the duration and visual information of scanning. PLoS ONE 16(8):e0244118; by the author of the NIH thesis Visual Perception in Elite Football and the source of its '> 90% of scans last ≤ 0.66 s'. 4 elite midfielders, 869 scans, Tobii Pro Glasses 2. https://pmc.ncbi.nlm.nih.gov/articles/PMC8378692/
- **Kokubu et al. (2026)** — Correspondence between motion sensor kinematics and notational analysis of scanning in field-based football gameplay. Frontiers in Psychology 17:1785026. 12 university players, a 7-min 6 v 6 game, head-worn IMU at 200 Hz. https://pmc.ncbi.nlm.nih.gov/articles/PMC13441872/
- **Castellano et al. (2013)** — Castellano, Álvarez-Pastor, Blanco-Villaseñor. Análisis del espacio de interacción en fútbol. Revista de Psicología del Deporte 22(2):437–446 (in Spanish). Six La Liga matches of 2005-06 (AMISCO), 6,793 touches; one reference team (EQ1) and its six opponents (EQ2); goalkeepers excluded. https://ddd.uab.cat/pub/revpsidep/revpsidep_a2013v22n2/revpsidep_a2013v22n2p437.pdf
- **Castellano & Álvarez (2013)** — Castellano, Álvarez. Uso defensivo del espacio de interacción en fútbol. RICYDE 9(32):126–136, doi:10.5232/ricyde2013.03203 (in Spanish). The same six La Liga matches as Castellano et al. (2013), out of possession; goalkeepers excluded. https://doi.org/10.5232/ricyde2013.03203
- **Errekagorri et al. (2024)** — Errekagorri, Fernandez-Navarro, López-Del Campo, Resta, Castellano. An eight-season analysis of the teams' performance in the Spanish LaLiga according to the final league ranking. PLoS ONE 19(2):e0299242. 5,518 team-match performances, 2011–12 to 2018–19 (Mediacoach optical tracking); per-match means with the ball in play, goalkeepers excluded from width, length and height, both phases together. https://doi.org/10.1371/journal.pone.0299242
- **Forcher et al. (2024)** — Forcher, Forcher, Altmann, Jekauc, Kempe. Is a compact organization important for defensive success in elite soccer? International Journal of Sports Science & Coaching 19(2):757–768, read as reprinted in Forcher's dissertation (KIT 2024, ch. 7). 153 Bundesliga matches of 2020/21 (TRACAB 25 Hz); opponent possessions of three passes and five seconds or more; 2,889 successful and 12,899 unsuccessful defensive plays. https://doi.org/10.5445/IR/1000173445

Checked and not used: Bekkers (2026, *Wide Open Gazes*) prints its field-of-view model and model scores, no scan rates or head kinematics; Bekkers (*Pressing Intensity*) and Fernández, Bornn, Cervone (2021) print model parameters, no measured speeds; Spearman (2018) prints time-to-intercept parameters (v = 5 m/s, a = 7 m/s²), which are model choices; the summaries of Jordet et al. (2013) quoted in REFERENCES.md ("> 0.5 scans/s is very high") are not the paper, which prints the values used above.
