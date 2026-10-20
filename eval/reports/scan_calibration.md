# Scan calibration (SPEC 3.4, 3.8)

`uv run python -m eval.scan_calibration`. `possession_play` tuning seeds 0–99 (100), 45 s each; the realism report (eval/reports/realism.md) runs held-out seeds 100–199. Targets are values printed in the papers of docs/REFERENCES.md; the measurements are eval/realism.py's.

## Fitted values

| Parameter | Fitted | sim/config.py | Target |
|---|---|---|---|
| `scan_omega` (°/s) | 404.2 ± 50.7 (as printed) | same | Kokubu et al. (2026), Results 3.1: 404.2 ± 50.7 |
| `scan_dwell_s` (median s, log SD) | 0.019, 1.87 | 0.019, 1.86 | Aksum et al. (2021): 90.3% ≤ 0.66 s, SD 0.2842 s |
| `pressure_scan_factor` | 0.611 | 0.61 | Jordet et al. (2020): d = 0.57 (0–1 m vs 10+ m), SD 0.3, mean 0.44 scans/s |
| `ROLES['CB'].scan_rate` | 0.739 | 0.74 | central defenders: 0.410 scans/s at receptions |
| `ROLES['FB'].scan_rate` | 0.561 | 0.56 | side defenders: 0.350 scans/s at receptions |
| `ROLES['DM'].scan_rate` | 1.193 | 1.19 | central midfielders: 0.454 scans/s at receptions |
| `ROLES['CM'].scan_rate` | 1.193 | 1.19 | central midfielders: 0.454 scans/s at receptions |
| `ROLES['AM'].scan_rate` | 1.193 | 1.19 | central midfielders: 0.454 scans/s at receptions |
| `ROLES['W'].scan_rate` | 0.747 | 0.74 | wingers: 0.394 scans/s at receptions |
| `ROLES['ST'].scan_rate` | 0.660 | 0.66 | forwards: 0.329 scans/s at receptions |

Pressure factor: 0.57 × 0.3 = 0.171 scans/s lower at 0–1 m than at 10+ m, 39% of the mean, so the rate at 1 m is 0.61 of the rate at 10 m. This assumes the 10+ m bin sits near the overall mean and the SD within a bin near the overall SD; the paper prints neither. It also assumes the bins differ only in pressure: in `possession_play` they differ by role as well (eval/reports/realism.md, the pressure row's ablation).

## Dwell grid

Share of midfielders' scans off the ball with the ball out of an 82° frame for ≤ 0.66 s, and the SD of that duration. For each median, the log SD where the share is 90.3% (linear in between grid points); along that ridge, the median where the SD is 0.2842 s. The realism report checks the share against 88.3%–92.3%, the binomial 95% CI of the printed share (n = 869).

| Median (s) | Log SD | ≤ 0.66 s | SD (s) | Scans |
|---|---|---|---|---|
| 0.01 | 1.25 | 97.3% | 0.145 | 15282 |
| 0.01 | 1.50 | 96.3% | 0.158 | 15206 |
| 0.01 | 1.75 | 94.7% | 0.186 | 15104 |
| 0.01 | 2.00 | 92.8% | 0.241 | 14963 |
| 0.01 | 2.25 | 91.1% | 0.311 | 14816 |
| 0.01 | 2.50 | 89.3% | 0.387 | 14607 |
| 0.02 | 1.25 | 95.2% | 0.158 | 15084 |
| 0.02 | 1.50 | 93.2% | 0.190 | 14982 |
| 0.02 | 1.75 | 90.9% | 0.255 | 14825 |
| 0.02 | 2.00 | 88.7% | 0.336 | 14627 |
| 0.02 | 2.25 | 86.3% | 0.419 | 14372 |
| 0.02 | 2.50 | 84.0% | 0.498 | 14112 |
| 0.03 | 1.25 | 92.8% | 0.178 | 14922 |
| 0.03 | 1.50 | 90.3% | 0.235 | 14767 |
| 0.03 | 1.75 | 87.5% | 0.318 | 14586 |
| 0.03 | 2.00 | 84.9% | 0.406 | 14320 |
| 0.03 | 2.25 | 82.3% | 0.492 | 14059 |
| 0.03 | 2.50 | 80.3% | 0.566 | 13755 |
| 0.04 | 1.25 | 90.5% | 0.201 | 14787 |
| 0.04 | 1.50 | 87.4% | 0.277 | 14606 |
| 0.04 | 1.75 | 84.6% | 0.367 | 14350 |
| 0.04 | 2.00 | 81.6% | 0.462 | 14055 |
| 0.04 | 2.25 | 79.5% | 0.543 | 13763 |
| 0.04 | 2.50 | 77.4% | 0.625 | 13457 |

| Median (s) | Log SD at 90.3% | SD there (s) |
|---|---|---|
| 0.01 | 2.358 | 0.344 |
| 0.02 | 1.817 | 0.277 |
| 0.03 | 1.500 | 0.235 |
| 0.04 | 1.268 | 0.207 |
| **0.019** | **1.874** | **0.2842** |

## Role rates

Group targets: central midfielders highest, the other groups below by the least-squares offsets in pooled-SD units (central midfielders -0.000, central defenders -0.236, wingers -0.324, side defenders -0.561, forwards -0.675), all scaled so receptions average 3 scans in the last 10 s. Each iteration simulates every tuning seed and moves each rate by (target / measured)^(2.5 / (k + 1)) at iteration k.

| Iteration | CM rate | Scans in window | Pooled SD | central midfielders (measured → target) | central defenders (measured → target) | wingers (measured → target) | side defenders (measured → target) | forwards (measured → target) |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.190 | 2.99 | 0.184 | 0.453 → 0.454 | 0.411 → 0.411 | 0.391 → 0.394 | 0.349 → 0.351 | 0.329 → 0.330 |
| 1 | 1.198 | 3.01 | 0.185 | 0.457 → 0.454 | 0.411 → 0.411 | 0.407 → 0.394 | 0.353 → 0.351 | 0.331 → 0.329 |
| 2 | 1.190 | 3.00 | 0.185 | 0.453 → 0.454 | 0.410 → 0.410 | 0.390 → 0.394 | 0.353 → 0.350 | 0.331 → 0.329 |
| 3 | 1.193 | 3.00 | 0.185 | 0.454 → 0.454 | 0.411 → 0.410 | 0.391 → 0.394 | 0.350 → 0.350 | 0.331 → 0.329 |
| 4 | 1.193 | 3.00 | 0.184 | 0.454 → 0.454 | 0.410 → 0.410 | 0.391 → 0.394 | 0.351 → 0.350 | 0.329 → 0.329 |
| 5 | 1.193 | 3.00 | 0.184 | 0.454 → 0.454 | 0.410 → 0.410 | 0.391 → 0.394 | 0.350 → 0.350 | 0.329 → 0.329 |
| 6 | 1.193 | 3.00 | 0.184 | 0.454 → 0.454 | 0.410 → 0.410 | 0.391 → 0.394 | 0.350 → 0.350 | 0.329 → 0.329 |
| 7 | 1.193 | 3.00 | 0.184 | 0.454 → 0.454 | 0.411 → 0.410 | 0.391 → 0.394 | 0.350 → 0.350 | 0.331 → 0.329 |

Forwards receive rarely in `possession_play` (76 receptions here), so their measured mean is noisy.
