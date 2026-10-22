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
| Median margin of `scan` over the next lens (xT) | 0.0140 | — |
| Mean realised ΔxT (factual − intervention) | +0.1153 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.1239 | +0.1136 | +0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.124 |
| 101 | scan | +0.1477 | +0.1340 | -0.0011 | `pass:H9` | kept | `pass:H4` | kept | +0.151 |
| 102 | scan | +0.1504 | +0.1365 | -0.0011 | `pass:H9` | kept | `pass:H4` | kept | +0.153 |
| 103 | scan | +0.1398 | +0.1277 | -0.0003 | `pass:H9` | kept | `pass:H4` | kept | +0.142 |
| 104 | space | +0.0000 | -0.1621 | -0.0002 | `carry` | kept | `carry` | kept | +0.000 |
| 105 | scan | +0.1218 | +0.1077 | -0.0002 | `pass:H9` | kept | `pass:H4` | kept | +0.125 |
| 106 | space | +0.0000 | -0.1569 | -0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 107 | space | -0.0000 | -0.1242 | +0.0000 | `pass:H1` | kept | `pass:H1` | kept | -0.000 |
| 108 | scan | +0.1398 | +0.1266 | -0.0002 | `pass:H9` | kept | `pass:H2` | kept | +0.141 |
| 109 | scan | +0.1555 | +0.1401 | -0.0004 | `pass:H9` | kept | `pass:H1` | kept | +0.156 |
| 110 | space | +0.0000 | -0.1512 | +0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 111 | scan | +0.1151 | +0.0984 | -0.0002 | `pass:H9` | kept | `pass:H1` | kept | +0.115 |
| 112 | scan | +0.1552 | +0.1405 | -0.0019 | `pass:H9` | kept | `pass:H4` | kept | +0.158 |
| 113 | scan | +0.1086 | +0.1023 | -0.0001 | `pass:H9` | kept | `pass:H7` | kept | +0.107 |
| 114 | scan | +0.1384 | +0.1258 | -0.0003 | `pass:H9` | kept | `pass:H7` | kept | +0.141 |
| 115 | scan | +0.1429 | +0.1305 | -0.0002 | `pass:H9` | kept | `pass:H7` | kept | +0.144 |
| 116 | scan | +0.1363 | +0.1234 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.137 |
| 117 | scan | +0.1417 | +0.1295 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.142 |
| 118 | space | +0.0000 | -0.1000 | -0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 119 | scan | +0.1616 | +0.1414 | -0.0018 | `pass:H9` | kept | `pass:H9` | lost | +0.166 |
| 120 | scan | +0.1585 | +0.1458 | -0.0010 | `pass:H9` | kept | `pass:H1` | kept | +0.159 |
| 121 | scan | +0.1506 | +0.1350 | -0.0003 | `pass:H9` | kept | `pass:H2` | kept | +0.153 |
| 122 | space | +0.0000 | -0.1317 | +0.0000 | `pass:H4` | kept | `pass:H4` | kept | +0.000 |
| 123 | scan | +0.1459 | +0.1311 | -0.0172 | `pass:H9` | lost | `pass:H4` | kept | -0.005 |
| 124 | scan | +0.1576 | +0.1438 | -0.0017 | `pass:H9` | kept | `pass:H2` | kept | +0.160 |
| 125 | scan | +0.1218 | +0.1089 | -0.0001 | `pass:H9` | kept | `carry` | kept | +0.122 |
| 126 | scan | +0.1523 | +0.1374 | -0.0012 | `pass:H9` | kept | `pass:H4` | kept | +0.154 |
| 127 | scan | +0.1507 | +0.1367 | -0.0012 | `pass:H9` | kept | `pass:H4` | kept | +0.151 |
| 128 | scan | +0.1333 | +0.1174 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.134 |
| 129 | scan | +0.1358 | +0.1188 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.137 |
| 130 | scan | +0.1131 | +0.0963 | -0.0002 | `pass:H9` | kept | `pass:H4` | kept | +0.113 |
| 131 | scan | +0.1171 | +0.1009 | -0.0002 | `pass:H9` | kept | `pass:H4` | kept | +0.116 |
| 132 | scan | +0.1224 | +0.1119 | -0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.122 |
| 133 | scan | +0.1149 | +0.1001 | -0.0001 | `pass:H9` | kept | `pass:H1` | kept | +0.119 |
| 134 | scan | +0.1362 | +0.1246 | -0.0004 | `pass:H9` | kept | `carry` | kept | +0.141 |
| 135 | scan | +0.1524 | +0.1405 | -0.0007 | `pass:H9` | kept | `carry` | kept | +0.155 |
| 136 | scan | +0.1479 | +0.1317 | -0.0004 | `pass:H9` | kept | `pass:H5` | kept | +0.151 |
| 137 | scan | +0.1511 | +0.1352 | -0.0011 | `pass:H9` | kept | `pass:H1` | kept | +0.155 |
| 138 | scan | +0.1352 | +0.1172 | -0.0000 | `pass:H9` | kept | `carry` | kept | +0.133 |
| 139 | scan | +0.1377 | +0.1243 | -0.0001 | `pass:H9` | kept | `pass:H2` | kept | +0.138 |
