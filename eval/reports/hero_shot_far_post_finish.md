# Shot hero — `far_post_finish`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H9` and re-simulate from its start with keyed randomness. Default keeper reach speed: 3 m/s.

P_goal re-scores each run's chosen placement using `_placed_shot` on the true positions, velocities and ball at that run's decision frame, with belief age zero and keeper A1. The last incoming pass determines the near side exactly as in the engine. A pass or carry has zero immediate shot probability and is labelled `no shot`.

| Metric | Value | Target |
|---|---|---|
| Placement changed without the key scan | 40/40 (100%) | ≥ 60% |
| Median ΔP_goal on truth (factual − counterfactual) | +0.524 | ≥ 0.300 |
| Design rule: A1 unseen from frame 1 until the key scan (factual) and until the decision (counterfactual) | 40/40 (100%) | ≥ 90% |
| Realised shot outcome changed | 35/40 (88%) | reported |
| Placement changed, v_dive = 2.5 m/s | 40/40 (100%) | ≥ 60% |
| Placement changed, v_dive = 4 m/s | 40/40 (100%) | ≥ 60% |

Design visibility uses `player_visibility` < 0.5 on every frame in each stated interval, including the counterfactual decision frame; frame zero is excluded because everyone starts known. The sweep re-runs both decisions and restores the default keeper afterwards.

| Seed | Factual action | P_goal on truth | Factual outcome | Counterfactual action | P_goal on truth | Counterfactual outcome | Placement changed | ΔP_goal | Design rule |
|---|---|---|---|---|---|---|---|---|---|
| 100 | `shot:far` | 0.796 | goal | `shot:near` | 0.275 | saved | yes | +0.521 | yes |
| 101 | `shot:far` | 0.760 | wide | `shot:near` | 0.256 | saved | yes | +0.504 | yes |
| 102 | `shot:far` | 0.789 | wide | `shot:near` | 0.252 | saved | yes | +0.537 | yes |
| 103 | `shot:far` | 0.773 | goal | `shot:near` | 0.274 | saved | yes | +0.499 | yes |
| 104 | `shot:far` | 0.791 | goal | `shot:near` | 0.254 | saved | yes | +0.537 | yes |
| 105 | `shot:far` | 0.786 | goal | `shot:near` | 0.275 | wide | yes | +0.511 | yes |
| 106 | `shot:far` | 0.794 | goal | `shot:near` | 0.257 | saved | yes | +0.538 | yes |
| 107 | `shot:far` | 0.800 | goal | `shot:near` | 0.259 | saved | yes | +0.541 | yes |
| 108 | `shot:far` | 0.798 | goal | `shot:near` | 0.259 | saved | yes | +0.539 | yes |
| 109 | `shot:far` | 0.790 | goal | `shot:near` | 0.254 | saved | yes | +0.536 | yes |
| 110 | `shot:far` | 0.796 | goal | `shot:near` | 0.282 | saved | yes | +0.514 | yes |
| 111 | `shot:far` | 0.778 | goal | `shot:near` | 0.251 | wide | yes | +0.527 | yes |
| 112 | `shot:far` | 0.785 | goal | `shot:near` | 0.255 | wide | yes | +0.530 | yes |
| 113 | `shot:far` | 0.781 | wide | `shot:near` | 0.254 | saved | yes | +0.527 | yes |
| 114 | `shot:far` | 0.802 | goal | `shot:near` | 0.269 | saved | yes | +0.533 | yes |
| 115 | `shot:far` | 0.791 | goal | `shot:near` | 0.256 | saved | yes | +0.535 | yes |
| 116 | `shot:far` | 0.796 | goal | `shot:near` | 0.266 | saved | yes | +0.530 | yes |
| 117 | `shot:far` | 0.791 | goal | `shot:near` | 0.265 | saved | yes | +0.525 | yes |
| 118 | `shot:far` | 0.812 | goal | `shot:near` | 0.284 | saved | yes | +0.528 | yes |
| 119 | `shot:far` | 0.775 | goal | `shot:near` | 0.261 | saved | yes | +0.515 | yes |
| 120 | `shot:far` | 0.803 | goal | `shot:near` | 0.282 | goal | yes | +0.521 | yes |
| 121 | `shot:far` | 0.787 | goal | `shot:near` | 0.253 | saved | yes | +0.534 | yes |
| 122 | `shot:far` | 0.783 | goal | `shot:near` | 0.258 | goal | yes | +0.525 | yes |
| 123 | `shot:far` | 0.790 | goal | `shot:near` | 0.252 | wide | yes | +0.539 | yes |
| 124 | `shot:far` | 0.782 | wide | `shot:near` | 0.267 | saved | yes | +0.515 | yes |
| 125 | `shot:far` | 0.777 | goal | `shot:near` | 0.269 | saved | yes | +0.508 | yes |
| 126 | `shot:far` | 0.800 | goal | `shot:near` | 0.278 | saved | yes | +0.522 | yes |
| 127 | `shot:far` | 0.791 | wide | `shot:near` | 0.292 | saved | yes | +0.499 | yes |
| 128 | `shot:far` | 0.782 | wide | `shot:near` | 0.260 | saved | yes | +0.523 | yes |
| 129 | `shot:far` | 0.783 | wide | `shot:near` | 0.263 | saved | yes | +0.520 | yes |
| 130 | `shot:far` | 0.794 | goal | `shot:near` | 0.259 | goal | yes | +0.535 | yes |
| 131 | `shot:far` | 0.785 | goal | `shot:near` | 0.268 | saved | yes | +0.517 | yes |
| 132 | `shot:far` | 0.798 | wide | `shot:near` | 0.273 | goal | yes | +0.525 | yes |
| 133 | `shot:far` | 0.791 | wide | `shot:near` | 0.270 | saved | yes | +0.521 | yes |
| 134 | `shot:far` | 0.764 | goal | `shot:near` | 0.255 | saved | yes | +0.509 | yes |
| 135 | `shot:far` | 0.794 | goal | `shot:near` | 0.280 | goal | yes | +0.514 | yes |
| 136 | `shot:far` | 0.758 | goal | `shot:near` | 0.270 | goal | yes | +0.487 | yes |
| 137 | `shot:far` | 0.806 | wide | `shot:near` | 0.260 | saved | yes | +0.546 | yes |
| 138 | `shot:far` | 0.800 | goal | `shot:near` | 0.285 | saved | yes | +0.516 | yes |
| 139 | `shot:far` | 0.767 | goal | `shot:near` | 0.250 | saved | yes | +0.517 | yes |
