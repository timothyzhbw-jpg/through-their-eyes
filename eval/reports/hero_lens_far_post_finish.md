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
| 200 | space | +0.0000 | +0.5300 | +0.0071 | `shot:far` | goal | `shot:far` | goal | +0.000 |
| 201 | scan | +0.5213 | +0.5213 | +0.0058 | `shot:far` | wide | `shot:near` | saved | +0.000 |
| 202 | scan | +0.5278 | +0.5278 | +0.0060 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 203 | scan | +0.5026 | +0.5026 | +0.0148 | `shot:far` | wide | `shot:near` | saved | +0.000 |
| 204 | scan | +0.5172 | +0.5172 | +0.0073 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 205 | scan | +0.5363 | +0.5363 | +0.0029 | `shot:far` | wide | `shot:near` | goal | -1.002 |
| 206 | scan | +0.5301 | +0.5301 | +0.0040 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 207 | scan | +0.5163 | +0.5163 | +0.0141 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 208 | scan | +0.5068 | +0.5068 | +0.0084 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 209 | scan | +0.5264 | +0.5264 | +0.0032 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 210 | scan | +0.5331 | +0.5331 | +0.0039 | `shot:far` | wide | `shot:near` | goal | -1.002 |
| 211 | scan | +0.5415 | +0.5415 | +0.0057 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 212 | scan | +0.5333 | +0.5333 | +0.0054 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 213 | scan | +0.5166 | +0.5166 | +0.0083 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 214 | scan | +0.5116 | +0.5116 | +0.0045 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 215 | scan | +0.5316 | +0.5316 | +0.0104 | `shot:far` | goal | `shot:near` | wide | +1.002 |
| 216 | scan | +0.5308 | +0.5308 | +0.0099 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 217 | scan | +0.5297 | +0.5297 | +0.0038 | `shot:far` | goal | `shot:near` | post | +1.002 |
| 218 | scan | +0.5161 | +0.5161 | +0.0084 | `shot:far` | goal | `shot:near` | post | +1.002 |
| 219 | scan | +0.5257 | +0.5257 | +0.0090 | `shot:far` | goal | `shot:near` | post | +1.002 |
| 220 | scan | +0.5387 | +0.5387 | +0.0119 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 221 | scan | +0.5357 | +0.5357 | +0.0100 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 222 | scan | +0.5034 | +0.5034 | +0.0111 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 223 | scan | +0.5122 | +0.5122 | +0.0075 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 224 | scan | +0.5125 | +0.5125 | +0.0074 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 225 | scan | +0.5203 | +0.5203 | +0.0097 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 226 | scan | +0.5373 | +0.5373 | +0.0054 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 227 | scan | +0.5051 | +0.5051 | +0.0088 | `shot:far` | goal | `shot:near` | wide | +1.002 |
| 228 | scan | +0.5301 | +0.5301 | +0.0129 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 229 | scan | +0.5274 | +0.5274 | +0.0107 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 230 | scan | +0.5138 | +0.5138 | +0.0119 | `shot:far` | wide | `shot:near` | saved | +0.000 |
| 231 | scan | +0.5074 | +0.5074 | +0.0087 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 232 | scan | +0.5365 | +0.5365 | +0.0042 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 233 | space | +0.0000 | +0.5040 | +0.0121 | `shot:far` | wide | `shot:far` | wide | +0.000 |
| 234 | scan | +0.5022 | +0.5022 | +0.0101 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 235 | scan | +0.5046 | +0.5046 | +0.0129 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 236 | scan | +0.5192 | +0.5192 | +0.0069 | `shot:far` | goal | `shot:near` | goal | +0.000 |
| 237 | scan | +0.5299 | +0.5299 | +0.0041 | `shot:far` | goal | `shot:near` | saved | +1.002 |
| 238 | scan | +0.5363 | +0.5363 | +0.0060 | `shot:far` | post | `shot:near` | saved | +0.000 |
| 239 | scan | +0.5342 | +0.5342 | +0.0054 | `shot:far` | wide | `shot:near` | goal | -1.002 |
