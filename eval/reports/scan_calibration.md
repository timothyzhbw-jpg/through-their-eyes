# Scan calibration (SPEC 3.4, 3.8)

`uv run python -m eval.scan_calibration`. `possession_play` tuning seeds 0–99 (100), 45 s each; the realism report (eval/reports/realism.md) runs held-out seeds 100–199. Targets are values printed in the papers of docs/REFERENCES.md; the measurements are eval/realism.py's.

## Fitted values

| Parameter | Fitted | sim/config.py | Target |
|---|---|---|---|
| `scan_omega` (°/s) | 404.2 ± 50.7 (as printed) | same | Kokubu et al. (2026), Results 3.1: 404.2 ± 50.7 |
| `scan_dwell_s` (median s, log SD) | 0.019, 1.88 | 0.019, 1.86 | Aksum et al. (2021): 90.3% ≤ 0.66 s, SD 0.2842 s |
| `pressure_scan_factor` | 0.611 | 0.61 | Jordet et al. (2020): d = 0.57 (0–1 m vs 10+ m), SD 0.3, mean 0.44 scans/s |
| `ROLES['CB'].scan_rate` | 0.713 | 0.71 | central defenders: 0.387 scans/s at receptions |
| `ROLES['FB'].scan_rate` | 0.562 | 0.56 | side defenders: 0.330 scans/s at receptions |
| `ROLES['DM'].scan_rate` | 0.998 | 1.00 | central midfielders: 0.430 scans/s at receptions |
| `ROLES['CM'].scan_rate` | 0.998 | 1.00 | central midfielders: 0.430 scans/s at receptions |
| `ROLES['AM'].scan_rate` | 0.998 | 1.00 | central midfielders: 0.430 scans/s at receptions |
| `ROLES['W'].scan_rate` | 0.682 | 0.68 | wingers: 0.373 scans/s at receptions |
| `ROLES['ST'].scan_rate` | 0.624 | 0.62 | forwards: 0.310 scans/s at receptions |

Pressure factor: 0.57 × 0.3 = 0.171 scans/s lower at 0–1 m than at 10+ m, 39% of the mean, so the rate at 1 m is 0.61 of the rate at 10 m. This assumes the 10+ m bin sits near the overall mean and the SD within a bin near the overall SD; the paper prints neither.

## Dwell grid

Share of midfielders' scans off the ball with the ball out of an 82° frame for ≤ 0.66 s, and the SD of that duration. For each median, the log SD where the share is 90.3% (linear in between grid points); along that ridge, the median where the SD is 0.2842 s. The realism report checks the share against 88.3%–92.3%, the binomial 95% CI of the printed share (n = 869).

| Median (s) | Log SD | ≤ 0.66 s | SD (s) | Scans |
|---|---|---|---|---|
| 0.01 | 1.25 | 97.8% | 0.143 | 14604 |
| 0.01 | 1.50 | 96.7% | 0.156 | 14540 |
| 0.01 | 1.75 | 95.0% | 0.186 | 14467 |
| 0.01 | 2.00 | 93.1% | 0.242 | 14334 |
| 0.01 | 2.25 | 91.1% | 0.309 | 14160 |
| 0.01 | 2.50 | 89.3% | 0.383 | 13971 |
| 0.02 | 1.25 | 95.5% | 0.158 | 14454 |
| 0.02 | 1.50 | 93.4% | 0.190 | 14357 |
| 0.02 | 1.75 | 90.9% | 0.255 | 14195 |
| 0.02 | 2.00 | 88.7% | 0.334 | 13999 |
| 0.02 | 2.25 | 86.2% | 0.415 | 13748 |
| 0.02 | 2.50 | 84.0% | 0.498 | 13514 |
| 0.03 | 1.25 | 93.0% | 0.176 | 14302 |
| 0.03 | 1.50 | 90.3% | 0.233 | 14160 |
| 0.03 | 1.75 | 87.7% | 0.317 | 13980 |
| 0.03 | 2.00 | 84.8% | 0.403 | 13701 |
| 0.03 | 2.25 | 82.5% | 0.491 | 13439 |
| 0.03 | 2.50 | 80.5% | 0.570 | 13187 |
| 0.04 | 1.25 | 90.6% | 0.199 | 14170 |
| 0.04 | 1.50 | 87.6% | 0.276 | 13999 |
| 0.04 | 1.75 | 84.4% | 0.365 | 13766 |
| 0.04 | 2.00 | 81.9% | 0.460 | 13450 |
| 0.04 | 2.25 | 79.7% | 0.547 | 13171 |
| 0.04 | 2.50 | 77.6% | 0.626 | 12886 |

| Median (s) | Log SD at 90.3% | SD there (s) |
|---|---|---|
| 0.01 | 2.362 | 0.342 |
| 0.02 | 1.820 | 0.277 |
| 0.03 | 1.496 | 0.232 |
| 0.04 | 1.272 | 0.206 |
| **0.019** | **1.878** | **0.2842** |

## Role rates

Group targets: central midfielders highest, the other groups below by the least-squares offsets in pooled-SD units (central midfielders -0.000, central defenders -0.251, wingers -0.330, side defenders -0.582, forwards -0.692), all scaled so receptions average 3 scans in the last 10 s. Each iteration simulates every tuning seed and moves each rate by (target / measured)^(2.5 / (k + 1)) at iteration k.

| Iteration | CM rate | Scans in window | Pooled SD | central midfielders (measured → target) | central defenders (measured → target) | wingers (measured → target) | side defenders (measured → target) | forwards (measured → target) |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.000 | 3.00 | 0.173 | 0.431 → 0.430 | 0.386 → 0.387 | 0.373 → 0.373 | 0.328 → 0.329 | 0.303 → 0.310 |
| 1 | 0.993 | 3.01 | 0.174 | 0.429 → 0.430 | 0.389 → 0.387 | 0.373 → 0.373 | 0.334 → 0.329 | 0.319 → 0.310 |
| 2 | 0.999 | 3.00 | 0.173 | 0.431 → 0.430 | 0.386 → 0.387 | 0.373 → 0.373 | 0.328 → 0.329 | 0.319 → 0.310 |
| 3 | 0.997 | 2.99 | 0.173 | 0.430 → 0.430 | 0.386 → 0.387 | 0.373 → 0.373 | 0.328 → 0.330 | 0.303 → 0.311 |
| 4 | 0.998 | 3.00 | 0.173 | 0.431 → 0.430 | 0.387 → 0.387 | 0.373 → 0.373 | 0.328 → 0.330 | 0.314 → 0.310 |
| 5 | 0.997 | 3.00 | 0.173 | 0.430 → 0.430 | 0.387 → 0.387 | 0.373 → 0.373 | 0.328 → 0.330 | 0.314 → 0.310 |
| 6 | 0.998 | 3.00 | 0.173 | 0.431 → 0.430 | 0.387 → 0.387 | 0.373 → 0.373 | 0.328 → 0.329 | 0.314 → 0.310 |
| 7 | 0.997 | 3.00 | 0.173 | 0.430 → 0.430 | 0.387 → 0.387 | 0.373 → 0.373 | 0.328 → 0.330 | 0.303 → 0.310 |

Forwards receive rarely in `possession_play` (19 receptions here), so their measured mean is noisy.
