# Scan calibration (SPEC 3.4, 3.8)

`uv run python -m eval.scan_calibration`. `possession_play` tuning seeds 0–99 (100), 45 s each; the realism report (eval/reports/realism.md) runs held-out seeds 100–199. Targets are values printed in the papers of docs/REFERENCES.md; the measurements are eval/realism.py's.

## Fitted values

| Parameter | Fitted | sim/config.py | Target |
|---|---|---|---|
| `scan_omega` (°/s) | 404.2 ± 50.7 (as printed) | same | Kokubu et al. (2026), Results 3.1: 404.2 ± 50.7 |
| `scan_dwell_s` (median s, log SD) | 0.016, 1.97 | 0.019, 1.86 | Aksum et al. (2021): 90.3% ≤ 0.66 s, SD 0.2842 s |
| `pressure_scan_factor` | 0.611 | 0.61 | Jordet et al. (2020): d = 0.57 (0–1 m vs 10+ m), SD 0.3, mean 0.44 scans/s |
| `ROLES['CB'].scan_rate` | 0.967 | 0.74 | central defenders: 0.443 scans/s at receptions |
| `ROLES['FB'].scan_rate` | 0.789 | 0.56 | side defenders: 0.380 scans/s at receptions |
| `ROLES['DM'].scan_rate` | 1.386 | 1.19 | central midfielders: 0.490 scans/s at receptions |
| `ROLES['CM'].scan_rate` | 1.386 | 1.19 | central midfielders: 0.490 scans/s at receptions |
| `ROLES['AM'].scan_rate` | 1.386 | 1.19 | central midfielders: 0.490 scans/s at receptions |
| `ROLES['W'].scan_rate` | 0.991 | 0.74 | wingers: 0.426 scans/s at receptions |
| `ROLES['ST'].scan_rate` | 0.955 | 0.66 | forwards: 0.358 scans/s at receptions |

Pressure factor: 0.57 × 0.3 = 0.171 scans/s lower at 0–1 m than at 10+ m, 39% of the mean, so the rate at 1 m is 0.61 of the rate at 10 m. This assumes the 10+ m bin sits near the overall mean and the SD within a bin near the overall SD; the paper prints neither. It also assumes the bins differ only in pressure: in `possession_play` they differ by role as well (eval/reports/realism.md, the pressure row's ablation).

## Dwell grid

Share of midfielders' scans off the ball with the ball out of an 82° frame for ≤ 0.66 s, and the SD of that duration. For each median, the log SD where the share is 90.3% (linear in between grid points); along that ridge, the median where the SD is 0.2842 s. The realism report checks the share against 88.3%–92.3%, the binomial 95% CI of the printed share (n = 869).

| Median (s) | Log SD | ≤ 0.66 s | SD (s) | Scans |
|---|---|---|---|---|
| 0.01 | 1.25 | 97.1% | 0.148 | 16075 |
| 0.01 | 1.50 | 96.0% | 0.160 | 16008 |
| 0.01 | 1.75 | 94.5% | 0.188 | 15920 |
| 0.01 | 2.00 | 92.6% | 0.242 | 15781 |
| 0.01 | 2.25 | 90.7% | 0.306 | 15605 |
| 0.01 | 2.50 | 88.8% | 0.382 | 15392 |
| 0.02 | 1.25 | 94.9% | 0.162 | 15914 |
| 0.02 | 1.50 | 92.9% | 0.193 | 15808 |
| 0.02 | 1.75 | 90.4% | 0.256 | 15641 |
| 0.02 | 2.00 | 88.2% | 0.331 | 15441 |
| 0.02 | 2.25 | 85.9% | 0.416 | 15159 |
| 0.02 | 2.50 | 83.8% | 0.498 | 14885 |
| 0.03 | 1.25 | 92.7% | 0.180 | 15771 |
| 0.03 | 1.50 | 89.9% | 0.233 | 15606 |
| 0.03 | 1.75 | 87.1% | 0.314 | 15406 |
| 0.03 | 2.00 | 84.5% | 0.403 | 15109 |
| 0.03 | 2.25 | 82.3% | 0.492 | 14832 |
| 0.03 | 2.50 | 80.1% | 0.571 | 14534 |
| 0.04 | 1.25 | 90.0% | 0.201 | 15622 |
| 0.04 | 1.50 | 86.8% | 0.276 | 15424 |
| 0.04 | 1.75 | 84.1% | 0.363 | 15166 |
| 0.04 | 2.00 | 81.6% | 0.459 | 14841 |
| 0.04 | 2.25 | 79.3% | 0.547 | 14537 |
| 0.04 | 2.50 | 77.5% | 0.621 | 14232 |

| Median (s) | Log SD at 90.3% | SD there (s) |
|---|---|---|
| 0.01 | 2.305 | 0.323 |
| 0.02 | 1.765 | 0.260 |
| 0.03 | 1.463 | 0.225 |
| 0.04 | 1.229 | 0.201 |
| **0.016** | **1.972** | **0.2842** |

## Role rates

Group targets: central midfielders highest, the other groups below by the least-squares offsets in pooled-SD units (central midfielders -0.000, central defenders -0.240, wingers -0.326, side defenders -0.567, forwards -0.680), all scaled so receptions average 3 scans in the last 10 s. Each iteration simulates every tuning seed and moves each rate by (target / measured)^(2.5 / (k + 1)) at iteration k.

| Iteration | CM rate | Scans in window | Pooled SD | central midfielders (measured → target) | central defenders (measured → target) | wingers (measured → target) | side defenders (measured → target) | forwards (measured → target) |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.190 | 2.67 | 0.198 | 0.452 → 0.491 | 0.399 → 0.444 | 0.339 → 0.426 | 0.314 → 0.379 | 0.286 → 0.356 |
| 1 | 1.463 | 3.12 | 0.193 | 0.501 → 0.489 | 0.442 → 0.443 | 0.485 → 0.426 | 0.417 → 0.380 | 0.408 → 0.358 |
| 2 | 1.422 | 3.03 | 0.195 | 0.494 → 0.489 | 0.443 → 0.442 | 0.457 → 0.425 | 0.382 → 0.378 | 0.364 → 0.356 |
| 3 | 1.411 | 3.02 | 0.195 | 0.494 → 0.489 | 0.442 → 0.443 | 0.442 → 0.426 | 0.379 → 0.379 | 0.357 → 0.357 |
| 4 | 1.403 | 3.01 | 0.195 | 0.494 → 0.490 | 0.444 → 0.443 | 0.438 → 0.426 | 0.379 → 0.379 | 0.357 → 0.357 |
| 5 | 1.397 | 3.02 | 0.195 | 0.494 → 0.490 | 0.444 → 0.443 | 0.443 → 0.426 | 0.379 → 0.379 | 0.357 → 0.357 |
| 6 | 1.393 | 3.01 | 0.195 | 0.494 → 0.490 | 0.442 → 0.443 | 0.436 → 0.426 | 0.379 → 0.379 | 0.357 → 0.357 |
| 7 | 1.389 | 3.01 | 0.195 | 0.493 → 0.490 | 0.443 → 0.443 | 0.430 → 0.426 | 0.379 → 0.380 | 0.357 → 0.358 |

Forwards receive rarely in `possession_play` (59 receptions here), so their measured mean is noisy.
