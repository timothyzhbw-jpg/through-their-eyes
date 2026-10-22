# Scan calibration (SPEC 3.4, 3.8)

`uv run python -m eval.scan_calibration`. `possession_play` tuning seeds 0–99 (100), 45 s each; the realism report (eval/reports/realism.md) runs held-out seeds 100–199. Targets are values printed in the papers of docs/REFERENCES.md; the measurements are eval/realism.py's.

## Fitted values

| Parameter | Fitted | sim/config.py | Target |
|---|---|---|---|
| `scan_omega` (°/s) | 404.2 ± 50.7 (as printed) | same | Kokubu et al. (2026), Results 3.1: 404.2 ± 50.7 |
| `scan_dwell_s` (median s, log SD) | 0.016, 1.96 | 0.019, 1.86 | Aksum et al. (2021): 90.3% ≤ 0.66 s, SD 0.2842 s |
| `pressure_scan_factor` | 0.611 | 0.61 | Jordet et al. (2020): d = 0.57 (0–1 m vs 10+ m), SD 0.3, mean 0.44 scans/s |
| `ROLES['CB'].scan_rate` | 0.847 | 0.74 | central defenders: 0.440 scans/s at receptions |
| `ROLES['FB'].scan_rate` | 0.779 | 0.56 | side defenders: 0.377 scans/s at receptions |
| `ROLES['DM'].scan_rate` | 1.419 | 1.19 | central midfielders: 0.485 scans/s at receptions |
| `ROLES['CM'].scan_rate` | 1.419 | 1.19 | central midfielders: 0.485 scans/s at receptions |
| `ROLES['AM'].scan_rate` | 1.419 | 1.19 | central midfielders: 0.485 scans/s at receptions |
| `ROLES['W'].scan_rate` | 1.034 | 0.74 | wingers: 0.423 scans/s at receptions |
| `ROLES['ST'].scan_rate` | 0.890 | 0.66 | forwards: 0.356 scans/s at receptions |

Pressure factor: 0.57 × 0.3 = 0.171 scans/s lower at 0–1 m than at 10+ m, 39% of the mean, so the rate at 1 m is 0.61 of the rate at 10 m. This assumes the 10+ m bin sits near the overall mean and the SD within a bin near the overall SD; the paper prints neither. It also assumes the bins differ only in pressure: in `possession_play` they differ by role as well (eval/reports/realism.md, the pressure row's ablation).

## Dwell grid

Share of midfielders' scans off the ball with the ball out of an 82° frame for ≤ 0.66 s, and the SD of that duration. For each median, the log SD where the share is 90.3% (linear in between grid points); along that ridge, the median where the SD is 0.2842 s. The realism report checks the share against 88.3%–92.3%, the binomial 95% CI of the printed share (n = 869).

| Median (s) | Log SD | ≤ 0.66 s | SD (s) | Scans |
|---|---|---|---|---|
| 0.01 | 1.25 | 97.2% | 0.147 | 16048 |
| 0.01 | 1.50 | 96.0% | 0.159 | 15982 |
| 0.01 | 1.75 | 94.5% | 0.186 | 15897 |
| 0.01 | 2.00 | 92.7% | 0.239 | 15766 |
| 0.01 | 2.25 | 90.8% | 0.308 | 15587 |
| 0.01 | 2.50 | 88.9% | 0.384 | 15375 |
| 0.02 | 1.25 | 95.0% | 0.160 | 15898 |
| 0.02 | 1.50 | 93.0% | 0.191 | 15788 |
| 0.02 | 1.75 | 90.5% | 0.253 | 15633 |
| 0.02 | 2.00 | 88.3% | 0.333 | 15407 |
| 0.02 | 2.25 | 86.0% | 0.416 | 15162 |
| 0.02 | 2.50 | 83.8% | 0.493 | 14872 |
| 0.03 | 1.25 | 92.7% | 0.179 | 15758 |
| 0.03 | 1.50 | 89.9% | 0.231 | 15584 |
| 0.03 | 1.75 | 87.2% | 0.313 | 15382 |
| 0.03 | 2.00 | 84.6% | 0.405 | 15102 |
| 0.03 | 2.25 | 82.4% | 0.488 | 14798 |
| 0.03 | 2.50 | 80.3% | 0.566 | 14503 |
| 0.04 | 1.25 | 90.1% | 0.200 | 15605 |
| 0.04 | 1.50 | 87.0% | 0.272 | 15433 |
| 0.04 | 1.75 | 84.2% | 0.364 | 15164 |
| 0.04 | 2.00 | 81.8% | 0.457 | 14825 |
| 0.04 | 2.25 | 79.5% | 0.542 | 14522 |
| 0.04 | 2.50 | 77.5% | 0.614 | 14220 |

| Median (s) | Log SD at 90.3% | SD there (s) |
|---|---|---|
| 0.01 | 2.313 | 0.327 |
| 0.02 | 1.776 | 0.261 |
| 0.03 | 1.465 | 0.223 |
| 0.04 | 1.235 | 0.200 |
| **0.016** | **1.964** | **0.2842** |

## Role rates

Group targets: central midfielders highest, the other groups below by the least-squares offsets in pooled-SD units (central midfielders -0.000, central defenders -0.241, wingers -0.327, side defenders -0.569, forwards -0.683), all scaled so receptions average 3 scans in the last 10 s. Each iteration simulates every tuning seed and moves each rate by (target / measured)^(2.5 / (k + 1)) at iteration k.

| Iteration | CM rate | Scans in window | Pooled SD | central midfielders (measured → target) | central defenders (measured → target) | wingers (measured → target) | side defenders (measured → target) | forwards (measured → target) |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.190 | 2.68 | 0.194 | 0.447 → 0.489 | 0.408 → 0.442 | 0.342 → 0.425 | 0.311 → 0.378 | 0.328 → 0.356 |
| 1 | 1.487 | 3.13 | 0.190 | 0.496 → 0.485 | 0.452 → 0.439 | 0.452 → 0.423 | 0.424 → 0.377 | 0.341 → 0.355 |
| 2 | 1.447 | 3.04 | 0.189 | 0.489 → 0.484 | 0.447 → 0.438 | 0.450 → 0.422 | 0.381 → 0.376 | 0.349 → 0.355 |
| 3 | 1.434 | 3.03 | 0.189 | 0.488 → 0.485 | 0.444 → 0.439 | 0.453 → 0.423 | 0.378 → 0.377 | 0.347 → 0.356 |
| 4 | 1.428 | 3.02 | 0.188 | 0.489 → 0.485 | 0.442 → 0.440 | 0.440 → 0.423 | 0.379 → 0.378 | 0.354 → 0.356 |
| 5 | 1.422 | 3.01 | 0.189 | 0.486 → 0.485 | 0.442 → 0.439 | 0.430 → 0.423 | 0.378 → 0.377 | 0.352 → 0.356 |
| 6 | 1.421 | 3.01 | 0.189 | 0.486 → 0.485 | 0.443 → 0.440 | 0.428 → 0.423 | 0.377 → 0.377 | 0.352 → 0.356 |
| 7 | 1.420 | 3.01 | 0.190 | 0.487 → 0.485 | 0.443 → 0.440 | 0.428 → 0.423 | 0.377 → 0.377 | 0.359 → 0.356 |

Forwards receive rarely in `possession_play` (52 receptions here), so their measured mean is noisy.
