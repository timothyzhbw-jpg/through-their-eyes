# Scan calibration (SPEC 3.4, 3.8)

`uv run python -m eval.scan_calibration`. `possession_play` tuning seeds 0–99 (100), 45 s each; the realism report (eval/reports/realism.md) runs held-out seeds 100–199. Targets are values printed in the papers of docs/REFERENCES.md; the measurements are eval/realism.py's.

## Fitted values

| Parameter | Fitted | sim/config.py | Target |
|---|---|---|---|
| `scan_omega` (°/s) | 404.2 ± 50.7 (as printed) | same | Kokubu et al. (2026), Results 3.1: 404.2 ± 50.7 |
| `scan_dwell_s` (median s, log SD) | 0.019, 1.86 | 0.019, 1.86 | Aksum et al. (2021): 90.3% ≤ 0.66 s, SD 0.2842 s |
| `pressure_scan_factor` | 0.611 | 0.61 | Jordet et al. (2020): d = 0.57 (0–1 m vs 10+ m), SD 0.3, mean 0.44 scans/s |
| `ROLES['CB'].scan_rate` | 0.754 | 0.74 | central defenders: 0.413 scans/s at receptions |
| `ROLES['FB'].scan_rate` | 0.562 | 0.56 | side defenders: 0.353 scans/s at receptions |
| `ROLES['DM'].scan_rate` | 1.218 | 1.19 | central midfielders: 0.457 scans/s at receptions |
| `ROLES['CM'].scan_rate` | 1.218 | 1.19 | central midfielders: 0.457 scans/s at receptions |
| `ROLES['AM'].scan_rate` | 1.218 | 1.19 | central midfielders: 0.457 scans/s at receptions |
| `ROLES['W'].scan_rate` | 0.749 | 0.74 | wingers: 0.397 scans/s at receptions |
| `ROLES['ST'].scan_rate` | 0.670 | 0.66 | forwards: 0.332 scans/s at receptions |

Pressure factor: 0.57 × 0.3 = 0.171 scans/s lower at 0–1 m than at 10+ m, 39% of the mean, so the rate at 1 m is 0.61 of the rate at 10 m. This assumes the 10+ m bin sits near the overall mean and the SD within a bin near the overall SD; the paper prints neither. It also assumes the bins differ only in pressure: in `possession_play` they differ by role as well (eval/reports/realism.md, the pressure row's ablation).

## Dwell grid

Share of midfielders' scans off the ball with the ball out of an 82° frame for ≤ 0.66 s, and the SD of that duration. For each median, the log SD where the share is 90.3% (linear in between grid points); along that ridge, the median where the SD is 0.2842 s. The realism report checks the share against 88.3%–92.3%, the binomial 95% CI of the printed share (n = 869).

| Median (s) | Log SD | ≤ 0.66 s | SD (s) | Scans |
|---|---|---|---|---|
| 0.01 | 1.25 | 97.3% | 0.145 | 15693 |
| 0.01 | 1.50 | 96.3% | 0.157 | 15616 |
| 0.01 | 1.75 | 94.7% | 0.186 | 15510 |
| 0.01 | 2.00 | 92.8% | 0.242 | 15368 |
| 0.01 | 2.25 | 91.1% | 0.313 | 15213 |
| 0.01 | 2.50 | 89.2% | 0.389 | 14996 |
| 0.02 | 1.25 | 95.2% | 0.158 | 15496 |
| 0.02 | 1.50 | 93.2% | 0.191 | 15387 |
| 0.02 | 1.75 | 90.9% | 0.256 | 15229 |
| 0.02 | 2.00 | 88.6% | 0.338 | 15023 |
| 0.02 | 2.25 | 86.2% | 0.421 | 14753 |
| 0.02 | 2.50 | 84.0% | 0.500 | 14491 |
| 0.03 | 1.25 | 92.9% | 0.178 | 15330 |
| 0.03 | 1.50 | 90.3% | 0.236 | 15175 |
| 0.03 | 1.75 | 87.5% | 0.319 | 14986 |
| 0.03 | 2.00 | 84.9% | 0.409 | 14699 |
| 0.03 | 2.25 | 82.4% | 0.495 | 14435 |
| 0.03 | 2.50 | 80.4% | 0.568 | 14122 |
| 0.04 | 1.25 | 90.6% | 0.201 | 15196 |
| 0.04 | 1.50 | 87.4% | 0.278 | 15011 |
| 0.04 | 1.75 | 84.6% | 0.369 | 14743 |
| 0.04 | 2.00 | 81.7% | 0.464 | 14427 |
| 0.04 | 2.25 | 79.6% | 0.545 | 14124 |
| 0.04 | 2.50 | 77.5% | 0.626 | 13809 |

| Median (s) | Log SD at 90.3% | SD there (s) |
|---|---|---|
| 0.01 | 2.358 | 0.345 |
| 0.02 | 1.819 | 0.279 |
| 0.03 | 1.503 | 0.237 |
| 0.04 | 1.271 | 0.208 |
| **0.019** | **1.861** | **0.2842** |

## Role rates

Group targets: central midfielders highest, the other groups below by the least-squares offsets in pooled-SD units (central midfielders -0.000, central defenders -0.236, wingers -0.324, side defenders -0.562, forwards -0.676), all scaled so receptions average 3 scans in the last 10 s. Each iteration simulates every tuning seed and moves each rate by (target / measured)^(2.5 / (k + 1)) at iteration k.

| Iteration | CM rate | Scans in window | Pooled SD | central midfielders (measured → target) | central defenders (measured → target) | wingers (measured → target) | side defenders (measured → target) | forwards (measured → target) |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.190 | 2.97 | 0.184 | 0.450 → 0.457 | 0.410 → 0.413 | 0.392 → 0.397 | 0.351 → 0.353 | 0.329 → 0.332 |
| 1 | 1.233 | 3.02 | 0.187 | 0.461 → 0.458 | 0.415 → 0.414 | 0.409 → 0.397 | 0.356 → 0.353 | 0.337 → 0.332 |
| 2 | 1.221 | 3.00 | 0.185 | 0.457 → 0.457 | 0.413 → 0.413 | 0.392 → 0.397 | 0.352 → 0.353 | 0.331 → 0.332 |
| 3 | 1.220 | 3.00 | 0.185 | 0.457 → 0.457 | 0.412 → 0.413 | 0.392 → 0.397 | 0.353 → 0.353 | 0.331 → 0.332 |
| 4 | 1.219 | 3.00 | 0.185 | 0.457 → 0.457 | 0.413 → 0.413 | 0.402 → 0.397 | 0.353 → 0.353 | 0.331 → 0.332 |
| 5 | 1.219 | 3.00 | 0.184 | 0.457 → 0.457 | 0.413 → 0.413 | 0.392 → 0.397 | 0.353 → 0.353 | 0.330 → 0.332 |
| 6 | 1.218 | 3.00 | 0.185 | 0.457 → 0.457 | 0.413 → 0.413 | 0.399 → 0.397 | 0.353 → 0.353 | 0.331 → 0.332 |
| 7 | 1.218 | 3.00 | 0.185 | 0.457 → 0.457 | 0.413 → 0.413 | 0.392 → 0.397 | 0.353 → 0.353 | 0.331 → 0.332 |

Forwards receive rarely in `possession_play` (76 receptions here), so their measured mean is noisy.
