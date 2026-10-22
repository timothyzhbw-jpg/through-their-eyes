# Scan calibration (SPEC 3.4, 3.8)

`uv run python -m eval.scan_calibration`. `possession_play` tuning seeds 0–99 (100), 45 s each; the realism report (eval/reports/realism.md) runs held-out seeds 100–199. Targets are values printed in the papers of docs/REFERENCES.md; the measurements are eval/realism.py's.

## Fitted values

| Parameter | Fitted | sim/config.py | Target |
|---|---|---|---|
| `scan_omega` (°/s) | 404.2 ± 50.7 (as printed) | same | Kokubu et al. (2026), Results 3.1: 404.2 ± 50.7 |
| `scan_dwell_s` (median s, log SD) | 0.016, 1.98 | 0.019, 1.86 | Aksum et al. (2021): 90.3% ≤ 0.66 s, SD 0.2842 s |
| `pressure_scan_factor` | 0.611 | 0.61 | Jordet et al. (2020): d = 0.57 (0–1 m vs 10+ m), SD 0.3, mean 0.44 scans/s |
| `ROLES['CB'].scan_rate` | 0.969 | 0.74 | central defenders: 0.442 scans/s at receptions |
| `ROLES['FB'].scan_rate` | 0.793 | 0.56 | side defenders: 0.378 scans/s at receptions |
| `ROLES['DM'].scan_rate` | 1.396 | 1.19 | central midfielders: 0.489 scans/s at receptions |
| `ROLES['CM'].scan_rate` | 1.396 | 1.19 | central midfielders: 0.489 scans/s at receptions |
| `ROLES['AM'].scan_rate` | 1.396 | 1.19 | central midfielders: 0.489 scans/s at receptions |
| `ROLES['W'].scan_rate` | 0.968 | 0.74 | wingers: 0.425 scans/s at receptions |
| `ROLES['ST'].scan_rate` | 0.963 | 0.66 | forwards: 0.356 scans/s at receptions |

Pressure factor: 0.57 × 0.3 = 0.171 scans/s lower at 0–1 m than at 10+ m, 39% of the mean, so the rate at 1 m is 0.61 of the rate at 10 m. This assumes the 10+ m bin sits near the overall mean and the SD within a bin near the overall SD; the paper prints neither. It also assumes the bins differ only in pressure: in `possession_play` they differ by role as well (eval/reports/realism.md, the pressure row's ablation).

## Dwell grid

Share of midfielders' scans off the ball with the ball out of an 82° frame for ≤ 0.66 s, and the SD of that duration. For each median, the log SD where the share is 90.3% (linear in between grid points); along that ridge, the median where the SD is 0.2842 s. The realism report checks the share against 88.3%–92.3%, the binomial 95% CI of the printed share (n = 869).

| Median (s) | Log SD | ≤ 0.66 s | SD (s) | Scans |
|---|---|---|---|---|
| 0.01 | 1.25 | 97.1% | 0.147 | 16086 |
| 0.01 | 1.50 | 96.0% | 0.160 | 16019 |
| 0.01 | 1.75 | 94.5% | 0.187 | 15931 |
| 0.01 | 2.00 | 92.5% | 0.241 | 15791 |
| 0.01 | 2.25 | 90.7% | 0.305 | 15619 |
| 0.01 | 2.50 | 88.8% | 0.382 | 15403 |
| 0.02 | 1.25 | 94.9% | 0.162 | 15924 |
| 0.02 | 1.50 | 92.9% | 0.192 | 15817 |
| 0.02 | 1.75 | 90.4% | 0.255 | 15654 |
| 0.02 | 2.00 | 88.2% | 0.331 | 15451 |
| 0.02 | 2.25 | 85.9% | 0.415 | 15180 |
| 0.02 | 2.50 | 83.7% | 0.496 | 14901 |
| 0.03 | 1.25 | 92.6% | 0.180 | 15777 |
| 0.03 | 1.50 | 89.9% | 0.232 | 15619 |
| 0.03 | 1.75 | 87.1% | 0.313 | 15420 |
| 0.03 | 2.00 | 84.4% | 0.403 | 15129 |
| 0.03 | 2.25 | 82.3% | 0.491 | 14839 |
| 0.03 | 2.50 | 80.1% | 0.570 | 14549 |
| 0.04 | 1.25 | 90.0% | 0.201 | 15628 |
| 0.04 | 1.50 | 86.7% | 0.275 | 15435 |
| 0.04 | 1.75 | 84.1% | 0.362 | 15181 |
| 0.04 | 2.00 | 81.5% | 0.458 | 14856 |
| 0.04 | 2.25 | 79.3% | 0.545 | 14550 |
| 0.04 | 2.50 | 77.5% | 0.620 | 14253 |

| Median (s) | Log SD at 90.3% | SD there (s) |
|---|---|---|
| 0.01 | 2.304 | 0.322 |
| 0.02 | 1.766 | 0.260 |
| 0.03 | 1.462 | 0.224 |
| 0.04 | 1.227 | 0.201 |
| **0.016** | **1.978** | **0.2842** |

## Role rates

Group targets: central midfielders highest, the other groups below by the least-squares offsets in pooled-SD units (central midfielders -0.000, central defenders -0.240, wingers -0.326, side defenders -0.567, forwards -0.681), all scaled so receptions average 3 scans in the last 10 s. Each iteration simulates every tuning seed and moves each rate by (target / measured)^(2.5 / (k + 1)) at iteration k.

| Iteration | CM rate | Scans in window | Pooled SD | central midfielders (measured → target) | central defenders (measured → target) | wingers (measured → target) | side defenders (measured → target) | forwards (measured → target) |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.190 | 2.67 | 0.197 | 0.452 → 0.491 | 0.399 → 0.444 | 0.353 → 0.427 | 0.317 → 0.379 | 0.291 → 0.357 |
| 1 | 1.467 | 3.10 | 0.192 | 0.499 → 0.488 | 0.441 → 0.442 | 0.466 → 0.426 | 0.407 → 0.379 | 0.398 → 0.357 |
| 2 | 1.427 | 3.03 | 0.195 | 0.494 → 0.488 | 0.441 → 0.442 | 0.447 → 0.425 | 0.381 → 0.378 | 0.355 → 0.356 |
| 3 | 1.413 | 3.02 | 0.195 | 0.490 → 0.488 | 0.442 → 0.441 | 0.445 → 0.424 | 0.380 → 0.377 | 0.357 → 0.355 |
| 4 | 1.409 | 3.01 | 0.195 | 0.492 → 0.489 | 0.441 → 0.442 | 0.431 → 0.425 | 0.380 → 0.378 | 0.355 → 0.356 |
| 5 | 1.405 | 3.01 | 0.195 | 0.492 → 0.488 | 0.442 → 0.442 | 0.431 → 0.425 | 0.377 → 0.378 | 0.355 → 0.356 |
| 6 | 1.401 | 3.00 | 0.194 | 0.491 → 0.489 | 0.441 → 0.442 | 0.431 → 0.425 | 0.377 → 0.379 | 0.355 → 0.357 |
| 7 | 1.398 | 3.01 | 0.194 | 0.491 → 0.489 | 0.442 → 0.442 | 0.431 → 0.425 | 0.377 → 0.378 | 0.357 → 0.356 |

Forwards receive rarely in `possession_play` (58 receptions here), so their measured mean is noisy.
