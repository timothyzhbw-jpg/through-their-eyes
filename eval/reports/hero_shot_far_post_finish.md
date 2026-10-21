# Shot hero — `far_post_finish`

Seeds 200–239 (40). Counterfactual: drop the key scan of `H9` and re-simulate from its start with keyed randomness. Default keeper reach speed: 3 m/s.

P_goal re-scores each run's chosen placement using `_placed_shot` on the true positions, velocities and ball at that run's decision frame, with belief age zero and keeper A1. The last incoming pass determines the near side exactly as in the engine. A pass or carry has zero immediate shot probability and is labelled `no shot`.

| Metric | Value | Target |
|---|---|---|
| Placement changed without the key scan | 38/40 (95%) | ≥ 60% |
| Median ΔP_goal on truth (factual − counterfactual) | +0.524 | ≥ 0.300 |
| Design rule: A1 unseen from frame 1 until the key scan (factual) and until the decision (counterfactual) | 38/40 (95%) | ≥ 90% |
| Realised shot outcome changed | 32/40 (80%) | reported |
| Placement changed, v_dive = 2.5 m/s | 38/40 (95%) | ≥ 60% |
| Placement changed, v_dive = 4 m/s | 38/40 (95%) | ≥ 60% |

Design visibility uses `player_visibility` < 0.5 on every frame in each stated interval, including the counterfactual decision frame; frame zero is excluded because everyone starts known. The sweep re-runs both decisions and restores the default keeper afterwards.

| Seed | Factual action | P_goal on truth | Factual outcome | Counterfactual action | P_goal on truth | Counterfactual outcome | Placement changed | ΔP_goal | Design rule |
|---|---|---|---|---|---|---|---|---|---|
| 200 | `shot:far` | 0.796 | goal | `shot:far` | 0.796 | goal | no | +0.000 | no |
| 201 | `shot:far` | 0.773 | wide | `shot:near` | 0.251 | saved | yes | +0.521 | yes |
| 202 | `shot:far` | 0.807 | wide | `shot:near` | 0.279 | saved | yes | +0.528 | yes |
| 203 | `shot:far` | 0.761 | wide | `shot:near` | 0.258 | saved | yes | +0.503 | yes |
| 204 | `shot:far` | 0.787 | goal | `shot:near` | 0.270 | goal | yes | +0.517 | yes |
| 205 | `shot:far` | 0.789 | wide | `shot:near` | 0.253 | goal | yes | +0.536 | yes |
| 206 | `shot:far` | 0.785 | wide | `shot:near` | 0.255 | saved | yes | +0.530 | yes |
| 207 | `shot:far` | 0.776 | goal | `shot:near` | 0.260 | goal | yes | +0.517 | yes |
| 208 | `shot:far` | 0.754 | goal | `shot:near` | 0.247 | saved | yes | +0.507 | yes |
| 209 | `shot:far` | 0.776 | goal | `shot:near` | 0.250 | saved | yes | +0.526 | yes |
| 210 | `shot:far` | 0.787 | wide | `shot:near` | 0.254 | goal | yes | +0.533 | yes |
| 211 | `shot:far` | 0.800 | goal | `shot:near` | 0.258 | saved | yes | +0.541 | yes |
| 212 | `shot:far` | 0.796 | goal | `shot:near` | 0.263 | goal | yes | +0.533 | yes |
| 213 | `shot:far` | 0.777 | wide | `shot:near` | 0.260 | saved | yes | +0.517 | yes |
| 214 | `shot:far` | 0.777 | wide | `shot:near` | 0.266 | saved | yes | +0.511 | yes |
| 215 | `shot:far` | 0.804 | goal | `shot:near` | 0.273 | wide | yes | +0.532 | yes |
| 216 | `shot:far` | 0.794 | goal | `shot:near` | 0.263 | saved | yes | +0.531 | yes |
| 217 | `shot:far` | 0.789 | goal | `shot:near` | 0.259 | wide | yes | +0.530 | yes |
| 218 | `shot:far` | 0.784 | goal | `shot:near` | 0.268 | wide | yes | +0.517 | yes |
| 219 | `shot:far` | 0.797 | goal | `shot:near` | 0.272 | wide | yes | +0.526 | yes |
| 220 | `shot:far` | 0.801 | goal | `shot:near` | 0.262 | saved | yes | +0.539 | yes |
| 221 | `shot:far` | 0.804 | goal | `shot:near` | 0.268 | saved | yes | +0.536 | yes |
| 222 | `shot:far` | 0.788 | goal | `shot:near` | 0.285 | saved | yes | +0.503 | yes |
| 223 | `shot:far` | 0.777 | goal | `shot:near` | 0.265 | saved | yes | +0.512 | yes |
| 224 | `shot:far` | 0.780 | wide | `shot:near` | 0.268 | saved | yes | +0.512 | yes |
| 225 | `shot:far` | 0.790 | goal | `shot:near` | 0.270 | saved | yes | +0.521 | yes |
| 226 | `shot:far` | 0.794 | goal | `shot:near` | 0.257 | saved | yes | +0.537 | yes |
| 227 | `shot:far` | 0.763 | goal | `shot:near` | 0.258 | wide | yes | +0.505 | yes |
| 228 | `shot:far` | 0.803 | goal | `shot:near` | 0.273 | goal | yes | +0.530 | yes |
| 229 | `shot:far` | 0.798 | goal | `shot:near` | 0.270 | goal | yes | +0.527 | yes |
| 230 | `shot:far` | 0.803 | wide | `shot:near` | 0.289 | saved | yes | +0.514 | yes |
| 231 | `shot:far` | 0.789 | goal | `shot:near` | 0.281 | saved | yes | +0.508 | yes |
| 232 | `shot:far` | 0.794 | goal | `shot:near` | 0.257 | saved | yes | +0.536 | yes |
| 233 | `shot:far` | 0.768 | wide | `shot:far` | 0.768 | wide | no | +0.000 | no |
| 234 | `shot:far` | 0.783 | goal | `shot:near` | 0.282 | saved | yes | +0.502 | yes |
| 235 | `shot:far` | 0.777 | goal | `shot:near` | 0.272 | saved | yes | +0.504 | yes |
| 236 | `shot:far` | 0.775 | goal | `shot:near` | 0.257 | goal | yes | +0.518 | yes |
| 237 | `shot:far` | 0.786 | goal | `shot:near` | 0.256 | saved | yes | +0.530 | yes |
| 238 | `shot:far` | 0.788 | wide | `shot:near` | 0.252 | saved | yes | +0.536 | yes |
| 239 | `shot:far` | 0.790 | wide | `shot:near` | 0.255 | goal | yes | +0.534 | yes |
