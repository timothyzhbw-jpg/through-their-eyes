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
| Median margin of `scan` over the next lens (xT) | 0.0139 | — |
| Mean realised ΔxT (factual − intervention) | +0.1152 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.1236 | +0.1132 | +0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.124 |
| 101 | scan | +0.1476 | +0.1337 | -0.0011 | `pass:H9` | kept | `pass:H4` | kept | +0.151 |
| 102 | scan | +0.1503 | +0.1362 | -0.0011 | `pass:H9` | kept | `pass:H4` | kept | +0.153 |
| 103 | scan | +0.1397 | +0.1274 | -0.0003 | `pass:H9` | kept | `pass:H4` | kept | +0.142 |
| 104 | space | +0.0000 | -0.1620 | -0.0002 | `carry` | kept | `carry` | kept | +0.000 |
| 105 | scan | +0.1215 | +0.1076 | -0.0002 | `pass:H9` | kept | `pass:H4` | kept | +0.125 |
| 106 | space | +0.0000 | -0.1568 | -0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 107 | space | -0.0000 | -0.1240 | +0.0000 | `pass:H1` | kept | `pass:H1` | kept | -0.000 |
| 108 | scan | +0.1397 | +0.1263 | -0.0002 | `pass:H9` | kept | `pass:H2` | kept | +0.141 |
| 109 | scan | +0.1554 | +0.1399 | -0.0004 | `pass:H9` | kept | `pass:H1` | kept | +0.156 |
| 110 | space | +0.0000 | -0.1511 | +0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 111 | scan | +0.1148 | +0.0982 | -0.0002 | `pass:H9` | kept | `pass:H1` | kept | +0.115 |
| 112 | scan | +0.1551 | +0.1406 | -0.0019 | `pass:H9` | kept | `pass:H4` | kept | +0.158 |
| 113 | scan | +0.1085 | +0.1019 | -0.0001 | `pass:H9` | kept | `pass:H7` | kept | +0.107 |
| 114 | scan | +0.1383 | +0.1256 | -0.0003 | `pass:H9` | kept | `pass:H7` | kept | +0.141 |
| 115 | scan | +0.1427 | +0.1302 | -0.0002 | `pass:H9` | kept | `pass:H7` | kept | +0.144 |
| 116 | scan | +0.1362 | +0.1232 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.137 |
| 117 | scan | +0.1416 | +0.1292 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.142 |
| 118 | space | +0.0000 | -0.0997 | -0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 119 | scan | +0.1615 | +0.1415 | -0.0018 | `pass:H9` | kept | `pass:H9` | lost | +0.166 |
| 120 | scan | +0.1584 | +0.1456 | -0.0010 | `pass:H9` | kept | `pass:H1` | kept | +0.159 |
| 121 | scan | +0.1505 | +0.1348 | -0.0003 | `pass:H9` | kept | `pass:H2` | kept | +0.153 |
| 122 | space | +0.0000 | -0.1315 | +0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 123 | scan | +0.1451 | +0.1302 | -0.0172 | `pass:H9` | lost | `pass:H4` | kept | -0.005 |
| 124 | scan | +0.1575 | +0.1436 | -0.0017 | `pass:H9` | kept | `pass:H2` | kept | +0.160 |
| 125 | scan | +0.1217 | +0.1086 | -0.0001 | `pass:H9` | kept | `carry` | kept | +0.122 |
| 126 | scan | +0.1522 | +0.1371 | -0.0012 | `pass:H9` | kept | `pass:H4` | kept | +0.154 |
| 127 | scan | +0.1506 | +0.1367 | -0.0012 | `pass:H9` | kept | `pass:H4` | kept | +0.151 |
| 128 | scan | +0.1332 | +0.1172 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.134 |
| 129 | scan | +0.1357 | +0.1185 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.136 |
| 130 | scan | +0.1128 | +0.0960 | -0.0002 | `pass:H9` | kept | `pass:H4` | kept | +0.113 |
| 131 | scan | +0.1169 | +0.1006 | -0.0002 | `pass:H9` | kept | `pass:H4` | kept | +0.116 |
| 132 | scan | +0.1222 | +0.1117 | -0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.122 |
| 133 | scan | +0.1146 | +0.0997 | -0.0001 | `pass:H9` | kept | `pass:H1` | kept | +0.119 |
| 134 | scan | +0.1361 | +0.1243 | -0.0004 | `pass:H9` | kept | `carry` | kept | +0.141 |
| 135 | scan | +0.1523 | +0.1405 | -0.0007 | `pass:H9` | kept | `carry` | kept | +0.155 |
| 136 | scan | +0.1478 | +0.1315 | -0.0004 | `pass:H9` | kept | `pass:H5` | kept | +0.151 |
| 137 | scan | +0.1510 | +0.1349 | -0.0011 | `pass:H9` | kept | `pass:H1` | kept | +0.154 |
| 138 | scan | +0.1350 | +0.1169 | -0.0000 | `pass:H9` | kept | `carry` | kept | +0.133 |
| 139 | scan | +0.1376 | +0.1241 | -0.0001 | `pass:H9` | kept | `pass:H2` | kept | +0.138 |
