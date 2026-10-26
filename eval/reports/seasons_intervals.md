# Seasons — the pipeline on independent seasons

These are properties of our simulator, whose perception and decision parameters come from published papers (docs/REFERENCES.md); they are not findings about real football.

`uv run python -m eval.seasons`: 5 seasons of 380 stitched matches each, from root seeds 2027, 2028, 2029, 2030, 2031 (fresh: SPEC 3.6's seed registry), every one eval/season.py's season: match-1's plan with its own match seeds and fresh hero seeds, the whole pipeline offline. For every metric: each season's value with its own 95% interval (Wilson for a share, a bootstrap over that season's matches, 1000 resamples, for a per-match mean); the mean of the season values with a 95% t-interval over the 5 seasons (*across*: how much a result moves from one season's seeds to the next); and the value over all 1,900 matches pooled.

Means per match unless marked; a count is the season's total.

## Matches

| Metric | 2027 | 2028 | 2029 | 2030 | 2031 | Across seasons: mean (95% CI) | All matches pooled |
|---|---|---|---|---|---|---|---|
| Possessions | 19.00 (19.00–19.00) | 19.00 (19.00–19.00) | 19.00 (19.00–19.00) | 19.00 (19.00–19.00) | 19.00 (19.00–19.00) | 19.00 (19.00 to 19.00) | 19.00 (19.00–19.00) |
| Minutes of play | 13.46 (13.46–13.47) | 13.46 (13.45–13.47) | 13.46 (13.46–13.47) | 13.46 (13.46–13.47) | 13.46 (13.45–13.46) | 13.46 (13.46 to 13.46) | 13.46 (13.46–13.46) |
| Goals | 0.73 (0.68–0.77) | 0.72 (0.68–0.77) | 0.76 (0.72–0.80) | 0.72 (0.67–0.76) | 0.71 (0.67–0.76) | 0.73 (0.71 to 0.75) | 0.73 (0.71–0.75) |
| Restarts: corner | 1.01 (1.00–1.02) | 1.01 (1.00–1.02) | 1.01 (1.00–1.02) | 1.02 (1.01–1.03) | 1.02 (1.01–1.03) | 1.01 (1.01 to 1.02) | 1.01 (1.01–1.02) |
| Restarts: cut | 16.09 (16.06–16.13) | 16.07 (16.03–16.10) | 16.06 (16.03–16.09) | 16.10 (16.06–16.13) | 16.08 (16.04–16.12) | 16.08 (16.06 to 16.10) | 16.08 (16.06–16.10) |
| Restarts: goal kick | 0.16 (0.13–0.20) | 0.19 (0.15–0.23) | 0.16 (0.13–0.20) | 0.16 (0.13–0.20) | 0.17 (0.13–0.21) | 0.17 (0.15 to 0.18) | 0.17 (0.15–0.19) |
| Restarts: kick-off | 0.73 (0.68–0.77) | 0.72 (0.68–0.77) | 0.76 (0.72–0.80) | 0.72 (0.67–0.76) | 0.71 (0.67–0.76) | 0.73 (0.71 to 0.75) | 0.73 (0.71–0.75) |
| Restarts: throw-in | 0.01 (0.00–0.02) | 0.02 (0.01–0.03) | 0.01 (0.00–0.02) | 0.01 (0.00–0.02) | 0.02 (0.01–0.03) | 0.01 (0.01 to 0.02) | 0.01 (0.01–0.02) |

## Moments

| Metric | 2027 | 2028 | 2029 | 2030 | 2031 | Across seasons: mean (95% CI) | All matches pooled |
|---|---|---|---|---|---|---|---|
| All moments | 190.86 (189.00–192.79) | 189.96 (188.24–191.85) | 189.57 (187.86–191.13) | 190.02 (188.57–191.65) | 189.63 (187.80–191.57) | 190.01 (189.37 to 190.64) | 190.01 (189.20–190.83) |
| Kind `decision_after_scan` | 2.00 (2.00–2.00) | 2.00 (2.00–2.00) | 2.00 (2.00–2.00) | 2.00 (2.00–2.00) | 2.00 (2.00–2.00) | 2.00 (2.00 to 2.00) | 2.00 (2.00–2.00) |
| Kind `line_breaking_pass` | 42.74 (42.20–43.28) | 42.02 (41.43–42.59) | 41.97 (41.42–42.52) | 42.75 (42.19–43.29) | 42.34 (41.77–42.88) | 42.37 (41.90 to 42.83) | 42.37 (42.11–42.62) |
| Kind `marker_scan` | 1.43 (1.37–1.50) | 1.47 (1.41–1.54) | 1.40 (1.34–1.46) | 1.45 (1.38–1.52) | 1.45 (1.38–1.52) | 1.44 (1.41 to 1.47) | 1.44 (1.41–1.47) |
| Kind `pressed_decision` | 1.00 (1.00–1.00) | 0.99 (0.99–1.00) | 0.99 (0.98–1.00) | 0.99 (0.99–1.00) | 1.00 (1.00–1.00) | 1.00 (0.99 to 1.00) | 1.00 (0.99–1.00) |
| Kind `sprint` | 143.68 (141.94–145.45) | 143.47 (141.81–145.27) | 143.21 (141.65–144.66) | 142.83 (141.46–144.35) | 142.84 (141.08–144.68) | 143.21 (142.74 to 143.67) | 143.21 (142.47–143.94) |
| Selected lens `pressure` | 43.74 (43.19–44.28) | 43.01 (42.42–43.58) | 42.96 (42.41–43.51) | 43.75 (43.19–44.29) | 43.34 (42.77–43.88) | 43.36 (42.89 to 43.83) | 43.36 (43.11–43.61) |
| Selected lens `scan` | 2.87 (2.82–2.91) | 2.84 (2.80–2.89) | 2.86 (2.82–2.90) | 2.87 (2.82–2.92) | 2.88 (2.83–2.93) | 2.87 (2.85 to 2.88) | 2.87 (2.84–2.89) |
| Selected lens `space` | 0.18 (0.14–0.22) | 0.20 (0.16–0.24) | 0.18 (0.14–0.22) | 0.18 (0.14–0.22) | 0.19 (0.15–0.23) | 0.18 (0.17 to 0.20) | 0.18 (0.17–0.20) |
| No lens (live only or none available) | 144.07 (142.34–145.87) | 143.90 (142.23–145.71) | 143.57 (142.02–145.06) | 143.23 (141.86–144.76) | 143.23 (141.47–145.06) | 143.60 (143.12 to 144.08) | 143.60 (142.87–144.34) |

## Heroes

| Metric | 2027 | 2028 | 2029 | 2030 | 2031 | Across seasons: mean (95% CI) | All matches pooled |
|---|---|---|---|---|---|---|---|
| `blind_side_run`: hero moment detected | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (100.0 to 100.0%) | 1,900/1,900 = 100.0% (99.8–100.0%) |
| `blind_side_run`: breakdown built | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (100.0 to 100.0%) | 1,900/1,900 = 100.0% (99.8–100.0%) |
| `press_escape`: hero moment detected | 100.0% (99.0–100.0%) | 99.5% (98.1–99.9%) | 99.2% (97.7–99.7%) | 99.5% (98.1–99.9%) | 100.0% (99.0–100.0%) | 99.6% (99.2 to 100.1%) | 1,893/1,900 = 99.6% (99.2–99.8%) |
| `press_escape`: breakdown built | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (100.0 to 100.0%) | 1,893/1,893 = 100.0% (99.8–100.0%) |
| `far_post_finish`: hero moment detected | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (100.0 to 100.0%) | 1,900/1,900 = 100.0% (99.8–100.0%) |
| `far_post_finish`: breakdown built | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (100.0 to 100.0%) | 1,900/1,900 = 100.0% (99.8–100.0%) |
| `corner_blind_side`: hero moment detected | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (100.0 to 100.0%) | 1,900/1,900 = 100.0% (99.8–100.0%) |
| `corner_blind_side`: breakdown built | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (99.0–100.0%) | 100.0% (100.0 to 100.0%) | 1,900/1,900 = 100.0% (99.8–100.0%) |

## Claims and the Verifier

| Metric | 2027 | 2028 | 2029 | 2030 | 2031 | Across seasons: mean (95% CI) | All matches pooled |
|---|---|---|---|---|---|---|---|
| Breakdowns built (season total) | 1,520 | 1,518 | 1,517 | 1,518 | 1,520 | 1,518.6 (1,516.9 to 1,520.3) | 7,593 |
| Scripts (5 personas × 2 languages each) (season total) | 15,200 | 15,180 | 15,170 | 15,180 | 15,200 | 15,186.0 (15,169.3 to 15,202.7) | 75,930 |
| Claims checked by the Verifier (season total) | 25,982 | 25,910 | 25,916 | 25,876 | 25,844 | 25,905.6 (25,841.6 to 25,969.6) | 129,528 |
| Claims supported | 100.0% (100.0–100.0%) | 100.0% (100.0–100.0%) | 100.0% (100.0–100.0%) | 100.0% (100.0–100.0%) | 100.0% (100.0–100.0%) | 100.0% (100.0 to 100.0%) | 129,528/129,528 = 100.0% (100.0–100.0%) |
| Unsupported claims on a viewer's payload (target 0) (season total) | 0 | 0 | 0 | 0 | 0 | 0.0 (0.0 to 0.0) | 0 |
| Render violations, every payload re-checked (target 0) (season total) | 0 | 0 | 0 | 0 | 0 | 0.0 (0.0 to 0.0) | 0 |
| Lines dropped before a payload was built (season total) | 0 | 0 | 0 | 0 | 0 | 0.0 (0.0 to 0.0) | 0 |
| Crew steps with an error (season total) | 0 | 0 | 0 | 0 | 0 | 0.0 (0.0 to 0.0) | 0 |

## Does the intervention change the outcome?

| Metric | 2027 | 2028 | 2029 | 2030 | 2031 | Across seasons: mean (95% CI) | All matches pooled |
|---|---|---|---|---|---|---|---|
| Hero `blind_side_run` (decision) | 85.5% (81.6–88.7%) | 82.1% (77.9–85.6%) | 85.0% (81.1–88.2%) | 85.5% (81.6–88.7%) | 83.2% (79.1–86.6%) | 84.3% (82.3 to 86.2%) | 1,601/1,900 = 84.3% (82.6–85.8%) |
| Hero `press_escape` (possession) | 83.2% (79.1–86.6%) | 78.6% (74.2–82.4%) | 83.6% (79.5–87.0%) | 80.2% (75.8–83.9%) | 74.5% (69.9–78.6%) | 80.0% (75.4 to 84.6%) | 1,514/1,893 = 80.0% (78.1–81.7%) |
| Hero `far_post_finish` (decision) | 97.4% (95.2–98.6%) | 98.9% (97.3–99.6%) | 97.6% (95.6–98.7%) | 97.6% (95.6–98.7%) | 98.9% (97.3–99.6%) | 98.1% (97.1 to 99.1%) | 1,864/1,900 = 98.1% (97.4–98.6%) |
| Hero `corner_blind_side` (man marked (≤ 5 m) as it arrives) | 97.9% (95.9–98.9%) | 96.1% (93.6–97.6%) | 99.2% (97.7–99.7%) | 98.4% (96.6–99.3%) | 98.2% (96.2–99.1%) | 97.9% (96.5 to 99.4%) | 1,861/1,900 = 97.9% (97.2–98.5%) |
| Open play `marker_scan` | 0.0% (0.0–19.4%) | 0.0% (0.0–19.4%) | 0.0% (0.0–21.5%) | 0.0% (0.0–16.8%) | 0.0% (0.0–13.3%) | 0.0% (0.0 to 0.0%) | 0/90 = 0.0% (0.0–4.1%) |

## Determinism

| Metric | 2027 | 2028 | 2029 | 2030 | 2031 | Across seasons: mean (95% CI) | All matches pooled |
|---|---|---|---|---|---|---|---|
| Every 19th match re-built, byte-identical | 100.0% (83.9–100.0%) | 100.0% (83.9–100.0%) | 100.0% (83.9–100.0%) | 100.0% (83.9–100.0%) | 100.0% (83.9–100.0%) | 100.0% (100.0 to 100.0%) | 100/100 = 100.0% (96.3–100.0%) |

Goals come from the plan's shooting hero (`far_post_finish`, once per match) and, rarely, a ball that rolls into a goal in open play (Law 10.1 counts any ball, SPEC 3.9), so the count is not a measured scoring rate.

## Realism at season scale

eval/realism.py's rows on each season's open play (the bootstrap resamples matches), with the ranges and sources of [realism.md](realism.md). A season's cell is its pooled value and whether it is inside the published range; *across* is the mean of the season values with a t-interval, and how many seasons are inside.

| Rows | 2027 | 2028 | 2029 | 2030 | 2031 | Across seasons: mean (95% CI) | All matches pooled |
|---|---|---|---|---|---|---|---|
| Rows inside | 11 | 11 | 10 | 11 | 11 | 10.80 (10.24 to 11.36) | 11 |
| Rows outside | 5 | 5 | 6 | 5 | 5 | 5.20 (4.64 to 5.76) | 5 |
| Rows inconclusive | 0 | 0 | 0 | 0 | 0 | 0.00 (0.00 to 0.00) | 0 |

| Metric | 2027 | 2028 | 2029 | 2030 | 2031 | Across seasons: mean (95% CI) | All matches pooled | Published |
|---|---|---|---|---|---|---|---|---|
| Scans in the 10 s before receiving † | 2.75 ✅ | 2.74 ✅ | 2.75 ✅ | 2.75 ✅ | 2.75 ✅ | 2.75 (2.74 to 2.75); inside in 5/5 | 2.75 ± 1.66 (n = 373656) ✅ | 3.0 ± 2.1 |
| Scan frequency before receiving (scans/s) | 0.40 ✅ | 0.40 ✅ | 0.40 ✅ | 0.40 ✅ | 0.40 ✅ | 0.40 (0.40 to 0.40); inside in 5/5 | 0.40 ± 0.20 (n = 373656) ✅ | 0.44 ± 0.30 |
| Scan frequency, midfielders and forwards receiving from a teammate nearer their goal (scans/s) | 0.42 ✅ | 0.42 ✅ | 0.42 ✅ | 0.42 ✅ | 0.42 ✅ | 0.42 (0.42 to 0.42); inside in 5/5 | 0.42 ± 0.19 (n = 132080) ✅ | 0.27 ± 0.22 (no major award); 0.33 ± 0.25 (award) |
| Scan frequency, central midfielders (scans/s) | 0.45 | 0.45 | 0.45 | 0.45 | 0.45 | 0.45 (0.45 to 0.45) | 0.45 ± 0.20 (n = 165130) | no published reference |
| Scan frequency, central defenders (scans/s) | 0.39 | 0.39 | 0.39 | 0.39 | 0.39 | 0.39 (0.39 to 0.39) | 0.39 ± 0.18 (n = 95139) | no published reference |
| Scan frequency, wingers (scans/s) | 0.35 | 0.35 | 0.35 | 0.35 | 0.35 | 0.35 (0.35 to 0.35) | 0.35 ± 0.19 (n = 18299) | no published reference |
| Scan frequency, side defenders (scans/s) | 0.33 | 0.33 | 0.32 | 0.33 | 0.33 | 0.33 (0.32 to 0.33) | 0.33 ± 0.18 (n = 76073) | no published reference |
| Scan frequency, forwards (scans/s) | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 (0.30 to 0.30) | 0.30 ± 0.19 (n = 19015) | no published reference |
| Positional order of scan frequency † | — ✅ | — ✅ | — ✅ | — ✅ | — ✅ | —; inside in 5/5 | central midfielders 0.45 > central defenders 0.39 > wingers 0.35 > side defenders 0.33 > forwards 0.30 ✅ | central midfielders highest, forwards lowest |
| Cohen's d of scan frequency, central midfielders vs forwards † | 0.74 ❌ | 0.75 ❌ | 0.74 ❌ | 0.74 ❌ | 0.76 ❌ | 0.75 (0.73 to 0.76); inside in 0/5 | d = 0.75 (n = 165130 vs 19015) ❌ | d = 0.54 |
| Cohen's d of scan frequency, central midfielders vs side defenders † | 0.64 ❌ | 0.62 ❌ | 0.65 ❌ | 0.65 ❌ | 0.63 ❌ | 0.64 (0.62 to 0.65); inside in 0/5 | d = 0.64 (n = 165130 vs 76073) ❌ | d = 0.56 |
| Cohen's d of scan frequency, central midfielders vs wingers † | 0.50 ❌ | 0.49 ❌ | 0.50 ❌ | 0.51 ❌ | 0.51 ❌ | 0.50 (0.49 to 0.51); inside in 0/5 | d = 0.50 (n = 165130 vs 18299) ❌ | d = 0.33 |
| Cohen's d of scan frequency, central midfielders vs central defenders † | 0.33 ✅ | 0.33 ✅ | 0.31 ✅ | 0.32 ✅ | 0.32 ✅ | 0.32 (0.31 to 0.33); inside in 5/5 | d = 0.32 (n = 165130 vs 95139) ✅ | d = 0.29 |
| Cohen's d of scan frequency, central defenders vs forwards † | 0.47 ✅ | 0.49 ✅ | 0.49 ✅ | 0.49 ✅ | 0.51 ✅ | 0.49 (0.47 to 0.51); inside in 5/5 | d = 0.49 (n = 95139 vs 19015) ✅ | d = 0.51 |
| Cohen's d of scan frequency, central defenders vs side defenders † | 0.34 ✅ | 0.32 ✅ | 0.36 ✅ | 0.36 ✅ | 0.34 ✅ | 0.34 (0.32 to 0.36); inside in 5/5 | d = 0.35 (n = 95139 vs 76073) ✅ | d = 0.37 |
| Cohen's d of scan frequency, wingers vs forwards † | 0.24 ❌ | 0.26 ❌ | 0.25 ❌ | 0.25 ❌ | 0.26 ❌ | 0.25 (0.24 to 0.26); inside in 0/5 | d = 0.25 (n = 18299 vs 19015) ❌ | d = 0.36 |
| Cohen's d of scan frequency, side defenders vs forwards † | 0.13 ✅ | 0.16 ✅ | 0.12 ❌ | 0.13 ✅ | 0.16 ✅ | 0.14 (0.12 to 0.16); inside in 4/5 | d = 0.14 (n = 76073 vs 19015) ✅ | d = 0.20 |
| Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception † | 0.02 ❌ | 0.03 ❌ | −0.00 ❌ | 0.00 ❌ | −0.01 ❌ | 0.01 (-0.01 to 0.03); inside in 0/5 | d = 0.01 (n = 89557 vs 36412) ❌ | d = 0.57 (lower under tight pressure) |
| Scan duration, ball out of the 82° scene-camera frame (s) † | 0.44 ✅ | 0.44 ✅ | 0.44 ✅ | 0.44 ✅ | 0.44 ✅ | 0.44 (0.44 to 0.44); inside in 5/5 | 0.44 ± 0.29 (n = 5081740) ✅ | 0.40 ± 0.28 (39.65 cs, SD 28.42 cs) |
| Scans with the ball out of frame for ≤ 0.66 s (%) † | 89.9 ✅ | 89.9 ✅ | 89.9 ✅ | 89.9 ✅ | 89.9 ✅ | 89.90 (89.90 to 89.90); inside in 5/5 | 89.9% (n = 5081740) ✅ | 90.3% (n = 869) |
| Peak head angular speed during a scan (°/s) † | 404 ✅ | 404 ✅ | 404 ✅ | 404 ✅ | 404 ✅ | 404.00 (404.00 to 404.00); inside in 5/5 | 404 ± 51 (n = 11082988) ✅ | 404.2 ± 50.7 |
| Peak speed per outfield player per run (m/s) | 6.73 | 6.73 | 6.73 | 6.73 | 6.73 | 6.73 (6.73 to 6.73) | 6.73 ± 1.23 (n = 570000) | no published reference |
| Peak acceleration per outfield player per run (m/s²) | 3.50 | 3.50 | 3.50 | 3.50 | 3.50 | 3.50 (3.50 to 3.50) | 3.50 ± 0.00 (n = 570000) | no published reference |
| Peak deceleration per outfield player per run (m/s²) | 4.99 | 4.99 | 4.99 | 4.99 | 4.99 | 4.99 (4.99 to 4.99) | 4.99 ± 0.05 (n = 570000) | no published reference |
| Pass launch speed (m/s) | 11.66 | 11.66 | 11.65 | 11.65 | 11.65 | 11.65 (11.65 to 11.66) | 11.65 ± 3.53 (n = 553053) | no published reference |
| Pass average ball speed, kick to end of the pass (m/s) | 9.97 | 9.98 | 9.96 | 9.97 | 9.97 | 9.97 (9.96 to 9.98) | 9.97 ± 2.95 (n = 536574) | no published reference |

A row whose sim cell does not start with a number (the positional order) has no season value; its ✅ or ❌ still says whether the order held. † marks a value the sim was calibrated to on tuning seeds (sim/config.py). Open play here is `('possession_play', 'possession_play_away')`, run to the plan's caps.
