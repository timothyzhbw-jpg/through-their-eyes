# Season — the pipeline on a season of stitched matches

These are properties of our simulator, whose perception and decision parameters come from published papers (docs/REFERENCES.md); they are not findings about real football.

`uv run python -m eval.season`: 380 matches from season seed 2026, each match-1's plan (`sim.match.DEFAULT_PLAN`) with its own match seed and fresh hero seeds (keyed off the match seed, ≥ 1,000,000: never a design or eval seed). Offline: no model calls; the crew runs its templates for every persona and language. Intervals are 95%: Wilson for shares, a bootstrap over matches (1000 resamples) for per-match means.

## Matches

| Per match | Mean (95% CI) |
|---|---|
| Possessions | 19.0 (19.0–19.0) |
| Minutes of play | 13.11 (13.07–13.15) |
| Goals | 0.79 (0.75–0.83) |
| Restarts: corner | 1.04 (1.02–1.06) |
| Restarts: cut | 15.15 (15.05–15.24) |
| Restarts: goal kick | 0.13 (0.10–0.17) |
| Restarts: kick-off | 0.79 (0.75–0.83) |
| Restarts: throw-in | 0.89 (0.80–0.98) |

Goals come from the plan's shooting hero (`far_post_finish`, once per match) and, rarely, a ball that rolls into a goal in open play (Law 10.1 counts any ball, SPEC 3.9), so the count is not a measured scoring rate. Restarts are counted after the kick-off: a cut follows every hero and every passage that reached its cap in play.

## 1. Moments

| Per match | Mean (95% CI) |
|---|---|
| All moments | 179.66 (177.59–181.85) |
| Kind `decision_after_scan` | 2.00 (2.00–2.00) |
| Kind `line_breaking_pass` | 39.70 (39.11–40.31) |
| Kind `marker_scan` | 1.19 (1.14–1.23) |
| Kind `pressed_decision` | 1.00 (1.00–1.00) |
| Kind `sprint` | 135.77 (133.89–137.79) |
| Selected lens `pressure` | 40.70 (40.11–41.31) |
| Selected lens `scan` | 2.85 (2.81–2.89) |
| Selected lens `space` | 0.18 (0.14–0.22) |
| No lens (live only or none available) | 135.93 (134.08–137.95) |

Hero moments, by scenario (the hero's decision or, for a marker, his look):

| Hero | Hero moment detected | Selected lens | Breakdown built | Failures |
|---|---|---|---|---|
| `blind_side_run` | 380/380 = 100.0% (99.0–100.0%) | pressure 1, scan 317, space 62 | 380/380 = 100.0% (99.0–100.0%) | 0 |
| `press_escape` | 380/380 = 100.0% (99.0–100.0%) | pressure 379, space 1 | 380/380 = 100.0% (99.0–100.0%) | 0 |
| `far_post_finish` | 380/380 = 100.0% (99.0–100.0%) | scan 375, space 5 | 380/380 = 100.0% (99.0–100.0%) | 0 |
| `corner_blind_side` | 380/380 = 100.0% (99.0–100.0%) | scan 380 | 380/380 = 100.0% (99.0–100.0%) | 0 |

Every detected hero moment's breakdown built without an error.

## 2. Claims and the Verifier

- Breakdowns built: 1520, each with 5 personas × 2 languages: 15200 scripts.
- Claims checked by the Verifier: 25971 (supported 25971 = 100.0%).
- Claims on a viewer's payload that the Verifier did not support: 0 (target 0).
- Render violations when every payload is re-checked (`check_payload`: a number with no verified claim behind it, an unsupported term, a placeholder): 0 (target 0).
- Lines the checks dropped before a payload was built: 0; crew steps with an error: 0.

## 3. Does the intervention change the outcome?

| Moments | Measured on | Changed |
|---|---|---|
| Hero `blind_side_run` | decision | 322/380 = 84.7% (80.8–88.0%) |
| Hero `press_escape` | possession | 319/380 = 83.9% (79.9–87.3%) |
| Hero `far_post_finish` | decision | 375/380 = 98.7% (97.0–99.4%) |
| Hero `corner_blind_side` | man marked (≤ 5 m) as it arrives | 373/380 = 98.2% (96.2–99.1%) |
| Open play `marker_scan` | scan lens | 0/10 = 0.0% (0.0–27.8%) |

Heroes: the scenario's own intervention (`MomentContext.cf`): the key scan dropped (the decision, or for a marker whether his man is marked as the ball arrives) or the forced action (the possession's result). Open play: the selected lens's counterfactual, which drops the most informative scan. Open play has no decisions on the ball (`possession_play` scripts its passes), so only a marker's look has an outcome to change there; 14896 open-play moments with a lens have no such counterfactual.

## 4. Determinism

Every 19th match built a second time: 20/20 byte-identical (`StitchedMatch.to_bytes`, SPEC 3.7).

## 5. Realism at season scale

eval/realism.py's rows on the season's open play, pooled per match (the bootstrap resamples matches). Ranges and sources as in [realism.md](realism.md); *inside* compares the pooled value.

**12 inside, 4 outside, 0 inconclusive, 10 with no published reference.**

| Metric | Sim (pooled) | Sim, 90% over matches | Published | Range checked | Inside |
|---|---|---|---|---|---|
| Scans in the 10 s before receiving † | 3.05 ± 1.69 (n = 70702) | 3.04 to 3.06 | 3.0 ± 2.1 | 0.90 to 5.10 (mean ± SD) | ✅ inside |
| Scan frequency before receiving (scans/s) | 0.41 ± 0.19 (n = 70702) | 0.41 to 0.41 | 0.44 ± 0.30 | 0.14 to 0.74 (mean ± SD) | ✅ inside |
| Scan frequency, midfielders and forwards receiving from a teammate nearer their goal (scans/s) | 0.42 ± 0.18 (n = 28570) | 0.42 to 0.42 | 0.27 ± 0.22 (no major award); 0.33 ± 0.25 (award) | 0.05 to 0.58 (both groups' mean ± SD) | ✅ inside |
| Scan frequency, central midfielders (scans/s) | 0.46 ± 0.19 (n = 31006) | 0.46 to 0.46 | no published reference | — | — |
| Scan frequency, central defenders (scans/s) | 0.40 ± 0.17 (n = 19226) | 0.40 to 0.40 | no published reference | — | — |
| Scan frequency, wingers (scans/s) | 0.37 ± 0.17 (n = 2676) | 0.37 to 0.38 | no published reference | — | — |
| Scan frequency, side defenders (scans/s) | 0.34 ± 0.18 (n = 12999) | 0.34 to 0.34 | no published reference | — | — |
| Scan frequency, forwards (scans/s) | 0.31 ± 0.18 (n = 4795) | 0.31 to 0.31 | no published reference | — | — |
| Positional order of scan frequency † | central midfielders 0.46 > central defenders 0.40 > wingers 0.37 > side defenders 0.34 > forwards 0.31 | order holds in 100% of resamples | central midfielders highest, forwards lowest | the same order at both ends | ✅ inside |
| Cohen's d of scan frequency, central midfielders vs forwards † | d = 0.78 (n = 31006 vs 4795) | 0.76 to 0.81 | d = 0.54 | 0.48 to 0.60 (95% CI) | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs side defenders † | d = 0.63 (n = 31006 vs 12999) | 0.61 to 0.64 | d = 0.56 | 0.51 to 0.61 (95% CI) | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs wingers † | d = 0.46 (n = 31006 vs 2676) | 0.43 to 0.49 | d = 0.33 | 0.27 to 0.39 (95% CI) | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs central defenders † | d = 0.32 (n = 31006 vs 19226) | 0.30 to 0.33 | d = 0.29 | 0.24 to 0.34 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, central defenders vs forwards † | d = 0.52 (n = 19226 vs 4795) | 0.49 to 0.55 | d = 0.51 | 0.43 to 0.59 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, central defenders vs side defenders † | d = 0.34 (n = 19226 vs 12999) | 0.32 to 0.36 | d = 0.37 | 0.31 to 0.43 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, wingers vs forwards † | d = 0.34 (n = 2676 vs 4795) | 0.30 to 0.38 | d = 0.36 | 0.27 to 0.45 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, side defenders vs forwards † | d = 0.17 (n = 12999 vs 4795) | 0.14 to 0.20 | d = 0.20 | 0.12 to 0.28 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception † | d = −0.06 (n = 34487 vs 5737) | −0.08 to −0.03 | d = 0.57 (lower under tight pressure) | 0.49 to 0.65 (95% CI) | ❌ outside |
| Scan duration, ball out of the 82° scene-camera frame (s) † | 0.44 ± 0.29 (n = 993135) | 0.44 to 0.44 | 0.40 ± 0.28 (39.65 cs, SD 28.42 cs) | 0.11 to 0.68 (mean ± SD) | ✅ inside |
| Scans with the ball out of frame for ≤ 0.66 s (%) † | 90.1% (n = 993135) | 90.1 to 90.2% | 90.3% (n = 869) | 88.3 to 92.3% (95% CI of the printed share) | ✅ inside |
| Peak head angular speed during a scan (°/s) † | 404 ± 51 (n = 2202617) | 404 to 404 | 404.2 ± 50.7 | 354 to 455 (mean ± SD) | ✅ inside |
| Peak speed per outfield player per run (m/s) | 6.50 ± 1.50 (n = 114000) | 6.49 to 6.51 | no published reference | — | — |
| Peak acceleration per outfield player per run (m/s²) | 3.50 ± 0.00 (n = 114000) | 3.50 to 3.50 | no published reference | — | — |
| Peak deceleration per outfield player per run (m/s²) | 5.00 ± 0.02 (n = 114000) | 5.00 to 5.00 | no published reference | — | — |
| Pass launch speed (m/s) | 12.97 ± 3.92 (n = 99194) | 12.95 to 12.99 | no published reference | — | — |
| Pass average ball speed, kick to end of the pass (m/s) | 10.79 ± 3.15 (n = 95997) | 10.77 to 10.81 | no published reference | — | — |

Open play here runs to the plan's caps (30–70 s) instead of realism's 45 s, and a reception within a scan's length of a passage's end is not counted (as there).
