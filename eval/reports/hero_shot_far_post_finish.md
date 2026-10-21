# Shot hero — `far_post_finish`

Seeds 200–239 (40). Counterfactual: drop the key scan of `H9` and re-simulate from its start with keyed randomness. Default keeper reach speed: 3 m/s.

P_goal re-scores each run's chosen placement with `placed_shot_value` on `true_decision_context`: the true positions, velocities and ball at that run's decision frame, belief age zero, and the opponents' keeper (A1). The last incoming pass determines the near side exactly as in the engine. A pass or carry has zero immediate shot probability and is labelled `no shot`.

| Metric | Value | Target |
|---|---|---|
| Placement changed without the key scan | 38/40 (95%) | ≥ 60% |
| Median ΔP_goal on truth (factual − counterfactual) | +0.524 | ≥ 0.300 |
| Design rule: A1 unseen from frame 1 until the key scan (factual) and until the decision (counterfactual) | 38/40 (95%) | ≥ 90% |
| Shot outcome label changed (e.g. wide -> saved), reported | 32/40 (80%) | reported |
| Goal status changed (goal with the look vs without), reported | 23/40 (57%); lost without the look: 20; gained without it: 3 | reported |
| Placement changed, v_dive = 2.5 m/s (uncited, swept) | 38/40 (95%) | ≥ 60% |
| Placement changed, v_dive = 4.0 m/s (uncited, swept) | 38/40 (95%) | ≥ 60% |

Design visibility uses `player_visibility` < 0.5 on every frame in each stated interval, including the counterfactual decision frame; frame zero is excluded because everyone starts known. The sweep re-runs both decisions and restores the default keeper afterwards.

| Seed | Factual action | P_goal on truth | Factual outcome | Counterfactual action | P_goal on truth | Counterfactual outcome | Placement changed | ΔP_goal | Design rule | Goal status |
|---|---|---|---|---|---|---|---|---|---|---|
| 200 | `shot:far` | 0.796 | goal | `shot:far` | 0.796 | goal | no | +0.000 | no | goal → goal |
| 201 | `shot:far` | 0.773 | wide | `shot:near` | 0.251 | saved | yes | +0.521 | yes | no goal → no goal |
| 202 | `shot:far` | 0.807 | wide | `shot:near` | 0.279 | saved | yes | +0.528 | yes | no goal → no goal |
| 203 | `shot:far` | 0.761 | wide | `shot:near` | 0.258 | saved | yes | +0.503 | yes | no goal → no goal |
| 204 | `shot:far` | 0.787 | goal | `shot:near` | 0.270 | goal | yes | +0.517 | yes | goal → goal |
| 205 | `shot:far` | 0.789 | wide | `shot:near` | 0.253 | goal | yes | +0.536 | yes | no goal → goal |
| 206 | `shot:far` | 0.785 | wide | `shot:near` | 0.255 | saved | yes | +0.530 | yes | no goal → no goal |
| 207 | `shot:far` | 0.776 | goal | `shot:near` | 0.260 | goal | yes | +0.517 | yes | goal → goal |
| 208 | `shot:far` | 0.754 | goal | `shot:near` | 0.247 | saved | yes | +0.507 | yes | goal → no goal |
| 209 | `shot:far` | 0.776 | goal | `shot:near` | 0.250 | saved | yes | +0.526 | yes | goal → no goal |
| 210 | `shot:far` | 0.787 | wide | `shot:near` | 0.254 | goal | yes | +0.533 | yes | no goal → goal |
| 211 | `shot:far` | 0.800 | goal | `shot:near` | 0.258 | saved | yes | +0.541 | yes | goal → no goal |
| 212 | `shot:far` | 0.796 | goal | `shot:near` | 0.263 | goal | yes | +0.533 | yes | goal → goal |
| 213 | `shot:far` | 0.777 | wide | `shot:near` | 0.260 | saved | yes | +0.517 | yes | no goal → no goal |
| 214 | `shot:far` | 0.777 | wide | `shot:near` | 0.266 | saved | yes | +0.511 | yes | no goal → no goal |
| 215 | `shot:far` | 0.804 | goal | `shot:near` | 0.273 | wide | yes | +0.532 | yes | goal → no goal |
| 216 | `shot:far` | 0.794 | goal | `shot:near` | 0.263 | saved | yes | +0.531 | yes | goal → no goal |
| 217 | `shot:far` | 0.789 | goal | `shot:near` | 0.259 | wide | yes | +0.530 | yes | goal → no goal |
| 218 | `shot:far` | 0.784 | goal | `shot:near` | 0.268 | wide | yes | +0.517 | yes | goal → no goal |
| 219 | `shot:far` | 0.797 | goal | `shot:near` | 0.272 | wide | yes | +0.526 | yes | goal → no goal |
| 220 | `shot:far` | 0.801 | goal | `shot:near` | 0.262 | saved | yes | +0.539 | yes | goal → no goal |
| 221 | `shot:far` | 0.804 | goal | `shot:near` | 0.268 | saved | yes | +0.536 | yes | goal → no goal |
| 222 | `shot:far` | 0.788 | goal | `shot:near` | 0.285 | saved | yes | +0.503 | yes | goal → no goal |
| 223 | `shot:far` | 0.777 | goal | `shot:near` | 0.265 | saved | yes | +0.512 | yes | goal → no goal |
| 224 | `shot:far` | 0.780 | wide | `shot:near` | 0.268 | saved | yes | +0.512 | yes | no goal → no goal |
| 225 | `shot:far` | 0.790 | goal | `shot:near` | 0.270 | saved | yes | +0.521 | yes | goal → no goal |
| 226 | `shot:far` | 0.794 | goal | `shot:near` | 0.257 | saved | yes | +0.537 | yes | goal → no goal |
| 227 | `shot:far` | 0.763 | goal | `shot:near` | 0.258 | wide | yes | +0.505 | yes | goal → no goal |
| 228 | `shot:far` | 0.803 | goal | `shot:near` | 0.273 | goal | yes | +0.530 | yes | goal → goal |
| 229 | `shot:far` | 0.798 | goal | `shot:near` | 0.270 | goal | yes | +0.527 | yes | goal → goal |
| 230 | `shot:far` | 0.803 | wide | `shot:near` | 0.289 | saved | yes | +0.514 | yes | no goal → no goal |
| 231 | `shot:far` | 0.789 | goal | `shot:near` | 0.281 | saved | yes | +0.508 | yes | goal → no goal |
| 232 | `shot:far` | 0.794 | goal | `shot:near` | 0.257 | saved | yes | +0.536 | yes | goal → no goal |
| 233 | `shot:far` | 0.768 | wide | `shot:far` | 0.768 | wide | no | +0.000 | no | no goal → no goal |
| 234 | `shot:far` | 0.783 | goal | `shot:near` | 0.282 | saved | yes | +0.502 | yes | goal → no goal |
| 235 | `shot:far` | 0.777 | goal | `shot:near` | 0.272 | saved | yes | +0.504 | yes | goal → no goal |
| 236 | `shot:far` | 0.775 | goal | `shot:near` | 0.257 | goal | yes | +0.518 | yes | goal → goal |
| 237 | `shot:far` | 0.786 | goal | `shot:near` | 0.256 | saved | yes | +0.530 | yes | goal → no goal |
| 238 | `shot:far` | 0.788 | wide | `shot:near` | 0.252 | saved | yes | +0.536 | yes | no goal → no goal |
| 239 | `shot:far` | 0.790 | wide | `shot:near` | 0.255 | goal | yes | +0.534 | yes | no goal → goal |
