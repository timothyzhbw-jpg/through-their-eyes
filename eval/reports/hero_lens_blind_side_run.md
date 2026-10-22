# Hero lens — `blind_side_run`

Seeds 100–139 (40). Intended lens `scan`; intervention `drop_scan` on `H8`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 34/40 (85%) | ≥ 60% |
| Intervention changes the outcome | 33/40 (82%) | ≥ 60% |
| … factual action kept the ball | 39/40 | — |
| … the ball is lost after the intervention | 1/40 | — |
| Selected lens: scan · space · pressure | 34 · 6 · 0 | — |
| Median margin of `scan` over the next lens (xT) | 0.0126 | — |
| Mean realised ΔxT (factual − intervention) | +0.1205 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.1284 | +0.1179 | +0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.130 |
| 101 | scan | +0.1574 | +0.1450 | -0.0004 | `pass:H9` | kept | `pass:H4` | kept | +0.164 |
| 102 | scan | +0.1456 | +0.1331 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.144 |
| 103 | scan | +0.1466 | +0.1361 | -0.0005 | `pass:H9` | kept | `pass:H4` | kept | +0.152 |
| 104 | space | +0.0000 | -0.1615 | -0.0002 | `carry` | kept | `carry` | kept | +0.000 |
| 105 | scan | +0.1313 | +0.1173 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.131 |
| 106 | space | +0.0000 | -0.1534 | -0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 107 | space | +0.0000 | -0.1282 | +0.0000 | `pass:H1` | kept | `pass:H1` | kept | -0.000 |
| 108 | scan | +0.1477 | +0.1369 | -0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.151 |
| 109 | scan | +0.1701 | +0.1560 | -0.0002 | `pass:H9` | kept | `pass:H4` | kept | +0.169 |
| 110 | space | +0.0000 | -0.1640 | +0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 111 | scan | +0.1180 | +0.1049 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.118 |
| 112 | scan | +0.1670 | +0.1510 | -0.0003 | `pass:H9` | kept | `pass:H4` | kept | +0.173 |
| 113 | scan | +0.1097 | +0.1035 | -0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.110 |
| 114 | scan | +0.1481 | +0.1370 | -0.0002 | `pass:H9` | kept | `pass:H7` | kept | +0.154 |
| 115 | scan | +0.1554 | +0.1431 | -0.0001 | `pass:H9` | kept | `pass:H7` | kept | +0.157 |
| 116 | scan | +0.1428 | +0.1317 | +0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.145 |
| 117 | scan | +0.1508 | +0.1395 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.150 |
| 118 | space | +0.0000 | -0.1027 | -0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 119 | scan | +0.1595 | +0.1376 | -0.0005 | `pass:H9` | kept | `pass:H9` | lost | +0.158 |
| 120 | space | +0.0000 | -0.1739 | +0.0000 | `pass:H1` | kept | `pass:H1` | kept | +0.000 |
| 121 | scan | +0.1602 | +0.1476 | -0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.165 |
| 122 | scan | +0.1461 | +0.1361 | -0.0001 | `pass:H9` | kept | `pass:H4` | kept | +0.146 |
| 123 | scan | +0.1632 | +0.1502 | -0.0215 | `pass:H9` | lost | `pass:H4` | kept | -0.005 |
| 124 | scan | +0.1718 | +0.1601 | -0.0001 | `pass:H9` | kept | `pass:H2` | kept | +0.175 |
| 125 | scan | +0.1236 | +0.1134 | +0.0000 | `pass:H9` | kept | `carry` | kept | +0.125 |
| 126 | scan | +0.1659 | +0.1525 | -0.0001 | `pass:H9` | kept | `pass:H4` | kept | +0.169 |
| 127 | scan | +0.1645 | +0.1490 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.163 |
| 128 | scan | +0.1382 | +0.1247 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.140 |
| 129 | scan | +0.1433 | +0.1291 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.145 |
| 130 | scan | +0.1153 | +0.0982 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.116 |
| 131 | scan | +0.1192 | +0.1050 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.120 |
| 132 | scan | +0.1262 | +0.1191 | -0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.129 |
| 133 | scan | +0.1225 | +0.1095 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.123 |
| 134 | scan | +0.1205 | +0.1106 | -0.0000 | `pass:H9` | kept | `carry` | kept | +0.122 |
| 135 | scan | +0.1612 | +0.1484 | -0.0002 | `pass:H9` | kept | `carry` | kept | +0.166 |
| 136 | scan | +0.1597 | +0.1454 | -0.0005 | `pass:H9` | kept | `pass:H5` | kept | +0.164 |
| 137 | scan | +0.1608 | +0.1481 | -0.0002 | `pass:H9` | kept | `pass:H3` | kept | +0.168 |
| 138 | scan | +0.1429 | +0.1273 | -0.0001 | `pass:H9` | kept | `carry` | kept | +0.138 |
| 139 | scan | +0.1439 | +0.1335 | -0.0001 | `pass:H9` | kept | `pass:H2` | kept | +0.146 |
