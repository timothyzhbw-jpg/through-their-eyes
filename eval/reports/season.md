# Season — the pipeline on a season of stitched matches

These are properties of our simulator, whose perception and decision parameters come from published papers (docs/REFERENCES.md); they are not findings about real football.

`uv run python -m eval.season`: 380 matches from season seed 2026, each match-1's plan (`sim.match.DEFAULT_PLAN`) with its own match seed and fresh hero seeds (keyed off the match seed, ≥ 1,000,000: never a design or eval seed). Offline: no model calls; the crew runs its templates for every persona and language. Intervals are 95%: Wilson for shares, a bootstrap over matches (1000 resamples) for per-match means.

## Matches

| Per match | Mean (95% CI) |
|---|---|
| Possessions | 18.0 (18.0–18.0) |
| Minutes of play | 12.40 (12.33–12.46) |
| Goals | 0.00 (0.00–0.00) |
| Restarts: corner | 1.04 (1.03–1.07) |
| Restarts: cut | 14.03 (13.90–14.17) |
| Restarts: goal kick | 0.01 (0.00–0.02) |
| Restarts: throw-in | 1.91 (1.77–2.04) |

Goals come only from a shooting hero; match-1's plan has none yet, so the count is zero by construction, not a measurement. Restarts are counted after the kick-off: a cut follows every hero and every passage that reached its cap in play.

## 1. Moments

| Per match | Mean (95% CI) |
|---|---|
| All moments | 169.90 (167.73–171.97) |
| Kind `decision_after_scan` | 1.00 (1.00–1.00) |
| Kind `line_breaking_pass` | 37.72 (37.13–38.33) |
| Kind `marker_scan` | 1.20 (1.15–1.25) |
| Kind `pressed_decision` | 1.00 (1.00–1.00) |
| Kind `sprint` | 128.99 (127.15–131.00) |
| Selected lens `pressure` | 38.71 (38.12–39.30) |
| Selected lens `scan` | 2.02 (2.00–2.04) |
| Selected lens `space` | 0.02 (0.01–0.04) |
| No lens (live only or none available) | 129.16 (127.32–131.15) |

Hero moments, by scenario (the hero's decision or, for a marker, his look):

| Hero | Hero moment detected | Selected lens | Breakdown built | Failures |
|---|---|---|---|---|
| `blind_side_run` | 380/380 = 100.0% (99.0–100.0%) | scan 376, space 4 | 380/380 = 100.0% (99.0–100.0%) | 0 |
| `press_escape` | 380/380 = 100.0% (99.0–100.0%) | pressure 375, space 5 | 319/380 = 83.9% (79.9–87.3%) | 61 |
| `corner_blind_side` | 380/380 = 100.0% (99.0–100.0%) | scan 380 | 380/380 = 100.0% (99.0–100.0%) | 0 |

Breakdowns that failed:

- `press_escape` seed 904009532: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1811291785: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 146844577: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1186044885: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1053389533: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1429287199: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 466562860: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 99978600: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 685789832: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1212430382: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1656725592: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1142801909: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1002362939: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 564361177: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 881948639: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 720461559: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1670412688: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 248418889: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 917584294: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1373193967: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 48593548: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1797471346: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 803717288: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1210821933: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1240449603: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1364428982: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 592683598: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 772827907: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1341357307: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1095715498: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1090884169: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 219821598: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 90180462: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 673421504: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 405386352: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1006717139: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1359281419: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 553617506: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1467612133: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1266119863: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1340994584: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1329863855: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 2098336240: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 987714082: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 631071455: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 583625026: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 587113327: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1475734288: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 132824116: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 574786955: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1352272986: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1697408986: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 2083480042: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1450918613: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 683099279: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1211849943: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 2134600095: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 1086273493: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 464622391: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 62825483: StopIteration in runner_received (explain/builders.py:513): 
- `press_escape` seed 562857918: StopIteration in runner_received (explain/builders.py:513): 

## 2. Claims and the Verifier

- Breakdowns built: 1079, each with 5 personas × 2 languages: 10790 scripts.
- Claims checked by the Verifier: 18227 (supported 18227 = 100.0%).
- Claims on a viewer's payload that the Verifier did not support: 0 (target 0).
- Render violations when every payload is re-checked (`check_payload`: a number with no verified claim behind it, an unsupported term, a placeholder): 0 (target 0).
- Lines the checks dropped before a payload was built: 0; crew steps with an error: 0.

## 3. Does the intervention change the outcome?

| Moments | Measured on | Changed |
|---|---|---|
| Hero `blind_side_run` | decision | 374/380 = 98.4% (96.6–99.3%) |
| Hero `corner_blind_side` | man marked (≤ 5 m) as it arrives | 375/380 = 98.7% (97.0–99.4%) |
| Hero `press_escape` | possession | 319/319 = 100.0% (98.8–100.0%) |
| Open play `marker_scan` | scan lens | 0/10 = 0.0% (0.0–27.8%) |

Heroes: the scenario's own intervention (`MomentContext.cf`): the key scan dropped (the decision, or for a marker whether his man is marked as the ball arrives) or the forced action (the possession's result). Open play: the selected lens's counterfactual, which drops the most informative scan. Open play has no decisions on the ball (`possession_play` scripts its passes), so only a marker's look has an outcome to change there; 14143 open-play moments with a lens have no such counterfactual.

## 4. Determinism

Every 19th match built a second time: 20/20 byte-identical (`StitchedMatch.to_bytes`, SPEC 3.7).

## 5. Realism at season scale

eval/realism.py's rows on the season's open play, pooled per match (the bootstrap resamples matches). Ranges and sources as in [realism.md](realism.md); *inside* compares the pooled value.

**12 inside, 4 outside, 0 inconclusive, 10 with no published reference.**

| Metric | Sim (pooled) | Sim, 90% over matches | Published | Range checked | Inside |
|---|---|---|---|---|---|
| Scans in the 10 s before receiving † | 3.05 ± 1.69 (n = 67302) | 3.04 to 3.06 | 3.0 ± 2.1 | 0.90 to 5.10 (mean ± SD) | ✅ inside |
| Scan frequency before receiving (scans/s) | 0.41 ± 0.19 (n = 67302) | 0.41 to 0.41 | 0.44 ± 0.30 | 0.14 to 0.74 (mean ± SD) | ✅ inside |
| Scan frequency, midfielders and forwards receiving from a teammate nearer their goal (scans/s) | 0.42 ± 0.18 (n = 27225) | 0.42 to 0.43 | 0.27 ± 0.22 (no major award); 0.33 ± 0.25 (award) | 0.05 to 0.58 (both groups' mean ± SD) | ✅ inside |
| Scan frequency, central midfielders (scans/s) | 0.46 ± 0.19 (n = 29658) | 0.46 to 0.46 | no published reference | — | — |
| Scan frequency, central defenders (scans/s) | 0.40 ± 0.17 (n = 18414) | 0.40 to 0.40 | no published reference | — | — |
| Scan frequency, wingers (scans/s) | 0.37 ± 0.17 (n = 2379) | 0.37 to 0.38 | no published reference | — | — |
| Scan frequency, side defenders (scans/s) | 0.34 ± 0.18 (n = 12270) | 0.34 to 0.34 | no published reference | — | — |
| Scan frequency, forwards (scans/s) | 0.31 ± 0.18 (n = 4581) | 0.30 to 0.31 | no published reference | — | — |
| Positional order of scan frequency † | central midfielders 0.46 > central defenders 0.40 > wingers 0.37 > side defenders 0.34 > forwards 0.31 | order holds in 100% of resamples | central midfielders highest, forwards lowest | the same order at both ends | ✅ inside |
| Cohen's d of scan frequency, central midfielders vs forwards † | d = 0.79 (n = 29658 vs 4581) | 0.77 to 0.82 | d = 0.54 | 0.48 to 0.60 (95% CI) | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs side defenders † | d = 0.62 (n = 29658 vs 12270) | 0.60 to 0.64 | d = 0.56 | 0.51 to 0.61 (95% CI) | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs wingers † | d = 0.45 (n = 29658 vs 2379) | 0.42 to 0.48 | d = 0.33 | 0.27 to 0.39 (95% CI) | ❌ outside |
| Cohen's d of scan frequency, central midfielders vs central defenders † | d = 0.31 (n = 29658 vs 18414) | 0.30 to 0.33 | d = 0.29 | 0.24 to 0.34 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, central defenders vs forwards † | d = 0.53 (n = 18414 vs 4581) | 0.50 to 0.56 | d = 0.51 | 0.43 to 0.59 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, central defenders vs side defenders † | d = 0.34 (n = 18414 vs 12270) | 0.32 to 0.36 | d = 0.37 | 0.31 to 0.43 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, wingers vs forwards † | d = 0.36 (n = 2379 vs 4581) | 0.32 to 0.40 | d = 0.36 | 0.27 to 0.45 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, side defenders vs forwards † | d = 0.19 (n = 12270 vs 4581) | 0.16 to 0.22 | d = 0.20 | 0.12 to 0.28 (95% CI) | ✅ inside |
| Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception † | d = −0.04 (n = 32765 vs 5512) | −0.07 to −0.02 | d = 0.57 (lower under tight pressure) | 0.49 to 0.65 (95% CI) | ❌ outside |
| Scan duration, ball out of the 82° scene-camera frame (s) † | 0.44 ± 0.29 (n = 948593) | 0.44 to 0.44 | 0.40 ± 0.28 (39.65 cs, SD 28.42 cs) | 0.11 to 0.68 (mean ± SD) | ✅ inside |
| Scans with the ball out of frame for ≤ 0.66 s (%) † | 90.1% (n = 948593) | 90.1 to 90.2% | 90.3% (n = 869) | 88.3 to 92.3% (95% CI of the printed share) | ✅ inside |
| Peak head angular speed during a scan (°/s) † | 404 ± 51 (n = 2104462) | 404 to 404 | 404.2 ± 50.7 | 354 to 455 (mean ± SD) | ✅ inside |
| Peak speed per outfield player per run (m/s) | 6.41 ± 1.52 (n = 114000) | 6.40 to 6.43 | no published reference | — | — |
| Peak acceleration per outfield player per run (m/s²) | 3.50 ± 0.00 (n = 114000) | 3.50 to 3.50 | no published reference | — | — |
| Peak deceleration per outfield player per run (m/s²) | 5.00 ± 0.04 (n = 114000) | 5.00 to 5.00 | no published reference | — | — |
| Pass launch speed (m/s) | 12.98 ± 3.92 (n = 94889) | 12.96 to 13.00 | no published reference | — | — |
| Pass average ball speed, kick to end of the pass (m/s) | 10.80 ± 3.16 (n = 91959) | 10.79 to 10.82 | no published reference | — | — |

Open play here runs to the plan's caps (30–70 s) instead of realism's 45 s, and a reception within a scan's length of a passage's end is not counted (as there).
