# Hero lens — `cutback_scan`

Seeds 100–139 (40). Intended lens `scan`; intervention `drop_scan` on `H7`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 38/40 (95%) | ≥ 60% |
| Intervention changes the outcome | 38/40 (95%) | ≥ 60% |
| … factual action kept the ball | 40/40 | — |
| … the ball is lost after the intervention | 0/40 | — |
| Selected lens: scan · space · pressure | 38 · 2 · 0 | — |
| Median margin of `scan` over the next lens (xT) | 0.1014 | — |
| Mean realised ΔxT (factual − intervention) | +0.0924 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.1630 | -0.0163 | +0.0516 | `pass:H8` | kept | `carry` | kept | +0.072 |
| 101 | scan | +0.1580 | -0.0238 | +0.0302 | `pass:H8` | kept | `carry` | kept | +0.070 |
| 102 | scan | +0.1616 | -0.0131 | +0.0143 | `pass:H8` | kept | `carry` | kept | +0.080 |
| 103 | scan | +0.1641 | -0.0036 | +0.0371 | `pass:H8` | kept | `carry` | kept | +0.081 |
| 104 | scan | +0.1616 | +0.0102 | +0.0724 | `pass:H8` | kept | `carry` | kept | +0.075 |
| 105 | scan | +0.1067 | -0.0195 | +0.0235 | `pass:H8` | kept | `shot` | shot | +0.188 |
| 106 | scan | +0.1599 | -0.0229 | +0.0269 | `pass:H8` | kept | `carry` | kept | +0.077 |
| 107 | scan | +0.1596 | -0.0141 | +0.0577 | `pass:H8` | kept | `carry` | kept | +0.076 |
| 108 | scan | +0.1500 | -0.0060 | +0.0349 | `pass:H8` | kept | `carry` | kept | +0.068 |
| 109 | scan | +0.1519 | -0.0180 | +0.0521 | `pass:H8` | kept | `carry` | kept | +0.070 |
| 110 | scan | +0.1491 | -0.0061 | +0.0288 | `pass:H8` | kept | `carry` | kept | +0.064 |
| 111 | space | +0.0000 | -0.1689 | +0.0243 | `carry` | kept | `carry` | kept | +0.000 |
| 112 | scan | +0.1104 | +0.0011 | +0.0414 | `pass:H8` | kept | `shot` | shot | +0.193 |
| 113 | space | +0.0000 | -0.1733 | +0.0287 | `carry` | kept | `carry` | kept | +0.000 |
| 114 | scan | +0.1604 | -0.0116 | +0.0714 | `pass:H8` | kept | `carry` | kept | +0.077 |
| 115 | scan | +0.1578 | -0.0024 | +0.0314 | `pass:H8` | kept | `carry` | kept | +0.080 |
| 116 | scan | +0.1513 | -0.0123 | +0.0612 | `pass:H8` | kept | `carry` | kept | +0.075 |
| 117 | scan | +0.1592 | -0.0211 | +0.0291 | `pass:H8` | kept | `carry` | kept | +0.069 |
| 118 | scan | +0.1600 | -0.0011 | +0.0837 | `pass:H8` | kept | `carry` | kept | +0.073 |
| 119 | scan | +0.1539 | -0.0199 | +0.0402 | `pass:H8` | kept | `carry` | kept | +0.068 |
| 120 | scan | +0.1544 | -0.0235 | +0.0327 | `pass:H8` | kept | `carry` | kept | +0.070 |
| 121 | scan | +0.1512 | -0.0283 | +0.0576 | `pass:H8` | kept | `carry` | kept | +0.068 |
| 122 | scan | +0.1112 | -0.0254 | +0.0276 | `pass:H8` | kept | `shot` | shot | +0.192 |
| 123 | scan | +0.1548 | -0.0202 | +0.0421 | `pass:H8` | kept | `carry` | kept | +0.078 |
| 124 | scan | +0.1418 | -0.0040 | +0.0370 | `pass:H8` | kept | `carry` | kept | +0.069 |
| 125 | scan | +0.1109 | -0.0190 | +0.0411 | `pass:H8` | kept | `shot` | shot | +0.191 |
| 126 | scan | +0.1052 | -0.0215 | +0.0458 | `pass:H8` | kept | `shot` | shot | +0.186 |
| 127 | scan | +0.1576 | -0.0157 | +0.0698 | `pass:H8` | kept | `carry` | kept | +0.078 |
| 128 | scan | +0.1075 | -0.0025 | +0.0319 | `pass:H8` | kept | `shot` | shot | +0.191 |
| 129 | scan | +0.1524 | -0.0172 | +0.0561 | `pass:H8` | kept | `carry` | kept | +0.073 |
| 130 | scan | +0.1061 | -0.0052 | +0.0332 | `pass:H8` | kept | `shot` | shot | +0.187 |
| 131 | scan | +0.1479 | -0.0221 | +0.0445 | `pass:H8` | kept | `carry` | kept | +0.067 |
| 132 | scan | +0.1549 | -0.0111 | +0.0733 | `pass:H8` | kept | `carry` | kept | +0.067 |
| 133 | scan | +0.1456 | -0.0068 | +0.0345 | `pass:H8` | kept | `carry` | kept | +0.070 |
| 134 | scan | +0.1561 | -0.0096 | +0.0345 | `pass:H8` | kept | `carry` | kept | +0.077 |
| 135 | scan | +0.1568 | -0.0284 | +0.0400 | `pass:H8` | kept | `carry` | kept | +0.072 |
| 136 | scan | +0.1586 | -0.0220 | +0.0577 | `pass:H8` | kept | `carry` | kept | +0.075 |
| 137 | scan | +0.1024 | -0.0077 | +0.0182 | `pass:H8` | kept | `shot` | shot | +0.183 |
| 138 | scan | +0.1618 | -0.0126 | +0.0567 | `pass:H8` | kept | `carry` | kept | +0.076 |
| 139 | scan | +0.1535 | -0.0219 | +0.0730 | `pass:H8` | kept | `carry` | kept | +0.072 |
