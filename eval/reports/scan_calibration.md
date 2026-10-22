# Scan calibration (SPEC 3.4, 3.8)

`uv run python -m eval.scan_calibration`. `possession_play` tuning seeds 0–99 (100), 45 s each; the realism report (eval/reports/realism.md) runs held-out seeds 100–199. Targets are values printed in the papers of docs/REFERENCES.md; the measurements are eval/realism.py's.

## Fitted values

| Parameter | Fitted | sim/config.py | Target |
|---|---|---|---|
| `scan_omega` (°/s) | 404.2 ± 50.7 (as printed) | same | Kokubu et al. (2026), Results 3.1: 404.2 ± 50.7 |
| `scan_dwell_s` (median s, log SD) | 0.016, 1.98 | 0.019, 1.86 | Aksum et al. (2021): 90.3% ≤ 0.66 s, SD 0.2842 s |
| `pressure_scan_factor` | 0.611 | 0.61 | Jordet et al. (2020): d = 0.57 (0–1 m vs 10+ m), SD 0.3, mean 0.44 scans/s |
| `ROLES['CB'].scan_rate` | 0.952 | 0.74 | central defenders: 0.443 scans/s at receptions |
| `ROLES['FB'].scan_rate` | 0.790 | 0.56 | side defenders: 0.379 scans/s at receptions |
| `ROLES['DM'].scan_rate` | 1.381 | 1.19 | central midfielders: 0.490 scans/s at receptions |
| `ROLES['CM'].scan_rate` | 1.381 | 1.19 | central midfielders: 0.490 scans/s at receptions |
| `ROLES['AM'].scan_rate` | 1.381 | 1.19 | central midfielders: 0.490 scans/s at receptions |
| `ROLES['W'].scan_rate` | 0.989 | 0.74 | wingers: 0.426 scans/s at receptions |
| `ROLES['ST'].scan_rate` | 0.953 | 0.66 | forwards: 0.357 scans/s at receptions |

Pressure factor: 0.57 × 0.3 = 0.171 scans/s lower at 0–1 m than at 10+ m, 39% of the mean, so the rate at 1 m is 0.61 of the rate at 10 m. This assumes the 10+ m bin sits near the overall mean and the SD within a bin near the overall SD; the paper prints neither. It also assumes the bins differ only in pressure: in `possession_play` they differ by role as well (eval/reports/realism.md, the pressure row's ablation).

## Dwell grid

Share of midfielders' scans off the ball with the ball out of an 82° frame for ≤ 0.66 s, and the SD of that duration. For each median, the log SD where the share is 90.3% (linear in between grid points); along that ridge, the median where the SD is 0.2842 s. The realism report checks the share against 88.3%–92.3%, the binomial 95% CI of the printed share (n = 869).

| Median (s) | Log SD | ≤ 0.66 s | SD (s) | Scans |
|---|---|---|---|---|
| 0.01 | 1.25 | 97.1% | 0.147 | 16089 |
| 0.01 | 1.50 | 96.0% | 0.160 | 16022 |
| 0.01 | 1.75 | 94.5% | 0.187 | 15934 |
| 0.01 | 2.00 | 92.6% | 0.241 | 15794 |
| 0.01 | 2.25 | 90.7% | 0.305 | 15617 |
| 0.01 | 2.50 | 88.8% | 0.382 | 15406 |
| 0.02 | 1.25 | 94.9% | 0.162 | 15928 |
| 0.02 | 1.50 | 92.9% | 0.192 | 15821 |
| 0.02 | 1.75 | 90.4% | 0.255 | 15654 |
| 0.02 | 2.00 | 88.2% | 0.331 | 15455 |
| 0.02 | 2.25 | 85.9% | 0.416 | 15173 |
| 0.02 | 2.50 | 83.8% | 0.497 | 14900 |
| 0.03 | 1.25 | 92.7% | 0.179 | 15784 |
| 0.03 | 1.50 | 89.9% | 0.232 | 15619 |
| 0.03 | 1.75 | 87.1% | 0.313 | 15420 |
| 0.03 | 2.00 | 84.5% | 0.403 | 15123 |
| 0.03 | 2.25 | 82.3% | 0.492 | 14844 |
| 0.03 | 2.50 | 80.1% | 0.571 | 14546 |
| 0.04 | 1.25 | 90.0% | 0.201 | 15633 |
| 0.04 | 1.50 | 86.8% | 0.275 | 15435 |
| 0.04 | 1.75 | 84.1% | 0.362 | 15177 |
| 0.04 | 2.00 | 81.6% | 0.459 | 14854 |
| 0.04 | 2.25 | 79.3% | 0.546 | 14549 |
| 0.04 | 2.50 | 77.5% | 0.620 | 14245 |

| Median (s) | Log SD at 90.3% | SD there (s) |
|---|---|---|
| 0.01 | 2.306 | 0.322 |
| 0.02 | 1.765 | 0.259 |
| 0.03 | 1.465 | 0.225 |
| 0.04 | 1.230 | 0.201 |
| **0.016** | **1.978** | **0.2842** |

## Role rates

Group targets: central midfielders highest, the other groups below by the least-squares offsets in pooled-SD units (central midfielders -0.000, central defenders -0.240, wingers -0.326, side defenders -0.567, forwards -0.680), all scaled so receptions average 3 scans in the last 10 s. Each iteration simulates every tuning seed and moves each rate by (target / measured)^(2.5 / (k + 1)) at iteration k.

| Iteration | CM rate | Scans in window | Pooled SD | central midfielders (measured → target) | central defenders (measured → target) | wingers (measured → target) | side defenders (measured → target) | forwards (measured → target) |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.190 | 2.67 | 0.197 | 0.454 → 0.491 | 0.400 → 0.444 | 0.339 → 0.427 | 0.314 → 0.379 | 0.286 → 0.357 |
| 1 | 1.444 | 3.11 | 0.195 | 0.494 → 0.489 | 0.444 → 0.442 | 0.485 → 0.426 | 0.419 → 0.379 | 0.410 → 0.357 |
| 2 | 1.425 | 3.04 | 0.195 | 0.497 → 0.489 | 0.444 → 0.442 | 0.457 → 0.426 | 0.379 → 0.379 | 0.360 → 0.356 |
| 3 | 1.407 | 3.02 | 0.196 | 0.495 → 0.490 | 0.444 → 0.443 | 0.440 → 0.426 | 0.379 → 0.379 | 0.357 → 0.356 |
| 4 | 1.398 | 3.01 | 0.195 | 0.494 → 0.490 | 0.443 → 0.443 | 0.438 → 0.426 | 0.379 → 0.379 | 0.357 → 0.357 |
| 5 | 1.392 | 3.02 | 0.195 | 0.494 → 0.490 | 0.444 → 0.443 | 0.440 → 0.426 | 0.379 → 0.379 | 0.357 → 0.357 |
| 6 | 1.387 | 3.01 | 0.195 | 0.494 → 0.490 | 0.443 → 0.443 | 0.438 → 0.426 | 0.379 → 0.379 | 0.357 → 0.357 |
| 7 | 1.384 | 3.01 | 0.195 | 0.493 → 0.490 | 0.443 → 0.443 | 0.436 → 0.426 | 0.379 → 0.379 | 0.357 → 0.357 |

Forwards receive rarely in `possession_play` (59 receptions here), so their measured mean is noisy.
