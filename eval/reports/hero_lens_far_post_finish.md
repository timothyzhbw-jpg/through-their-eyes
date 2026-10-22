# Hero lens — `far_post_finish`

Seeds 200–239 (40). Intended lens `scan`; intervention `drop_scan` on `H9`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 38/40 (95%) | ≥ 60% |
| Intervention changes the outcome | 38/40 (95%) | ≥ 60% |
| … factual action kept the ball | 0/40 | — |
| … the ball is lost after the intervention | 0/40 | — |
| Selected lens: scan · space · pressure | 38 · 2 · 0 | — |
| Median margin of `scan` over the next lens (xT) | 0.0000 | — |
| Mean realised ΔxT (factual − intervention) | +0.4259 | — |
| The scan lens's scan (the most informative) is the key scan | 40/40 (100%) | ≥ 90% |
| … Δscan equals Δspace (the tie goes to `scan`, §5.2) | 38/40 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 200 | space | +0.0000 | +0.5302 | +0.0098 | `shot:far` | goal | `shot:far` | goal | +0.000 |
| 201 | scan | +0.5213 | +0.5213 | +0.0076 | `shot:far` | wide | `shot:near` | saved | +0.000 |
| 202 | scan | +0.5280 | +0.5280 | +0.0084 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 203 | scan | +0.5027 | +0.5027 | +0.0184 | `shot:far` | wide | `shot:near` | saved | +0.000 |
| 204 | scan | +0.5174 | +0.5174 | +0.0097 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 205 | scan | +0.5362 | +0.5362 | +0.0040 | `shot:far` | wide | `shot:near` | goal | -1.002 |
| 206 | scan | +0.5301 | +0.5301 | +0.0055 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 207 | scan | +0.5166 | +0.5166 | +0.0185 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 208 | scan | +0.5068 | +0.5068 | +0.0105 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 209 | scan | +0.5264 | +0.5264 | +0.0044 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 210 | scan | +0.5331 | +0.5331 | +0.0053 | `shot:far` | wide | `shot:near` | goal | -1.002 |
| 211 | scan | +0.5415 | +0.5415 | +0.0079 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 212 | scan | +0.5333 | +0.5333 | +0.0075 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 213 | scan | +0.5167 | +0.5167 | +0.0110 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 214 | scan | +0.5114 | +0.5114 | +0.0054 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 215 | scan | +0.5316 | +0.5316 | +0.0146 | `shot:far` | goal | `shot:near` | wide | +1.002 |
| 216 | scan | +0.5308 | +0.5308 | +0.0138 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 217 | scan | +0.5297 | +0.5297 | +0.0052 | `shot:far` | goal | `shot:near` | post | +1.002 |
| 218 | scan | +0.5166 | +0.5166 | +0.0113 | `shot:far` | goal | `shot:near` | post | +1.002 |
| 219 | scan | +0.5257 | +0.5257 | +0.0123 | `shot:far` | goal | `shot:near` | post | +1.002 |
| 220 | scan | +0.5388 | +0.5388 | +0.0167 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 221 | scan | +0.5359 | +0.5359 | +0.0139 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 222 | scan | +0.5027 | +0.5027 | +0.0143 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 223 | scan | +0.5122 | +0.5122 | +0.0099 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 224 | scan | +0.5125 | +0.5125 | +0.0098 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 225 | scan | +0.5205 | +0.5205 | +0.0133 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 226 | scan | +0.5373 | +0.5373 | +0.0074 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 227 | scan | +0.5051 | +0.5051 | +0.0113 | `shot:far` | goal | `shot:near` | wide | +1.002 |
| 228 | scan | +0.5298 | +0.5298 | +0.0178 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 229 | scan | +0.5274 | +0.5274 | +0.0148 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 230 | scan | +0.5138 | +0.5138 | +0.0157 | `shot:far` | wide | `shot:near` | saved | +0.000 |
| 231 | scan | +0.5079 | +0.5079 | +0.0115 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 232 | scan | +0.5365 | +0.5365 | +0.0059 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 233 | space | +0.0000 | +0.5042 | +0.0156 | `shot:far` | wide | `shot:far` | wide | +0.000 |
| 234 | scan | +0.5016 | +0.5016 | +0.0131 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 235 | scan | +0.5045 | +0.5045 | +0.0168 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 236 | scan | +0.5184 | +0.5184 | +0.0092 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 237 | scan | +0.5299 | +0.5299 | +0.0056 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 238 | scan | +0.5363 | +0.5363 | +0.0083 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 239 | scan | +0.5342 | +0.5342 | +0.0075 | `shot:far` | wide | `shot:near` | goal | -1.002 |
