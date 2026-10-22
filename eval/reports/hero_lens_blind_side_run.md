# Hero lens — `blind_side_run`

Seeds 100–139 (40). Intended lens `scan`; intervention `drop_scan` on `H8`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 40/40 (100%) | ≥ 60% |
| Intervention changes the outcome | 39/40 (98%) | ≥ 60% |
| … factual action kept the ball | 40/40 | — |
| … the ball is lost after the intervention | 1/40 | — |
| Selected lens: scan · space · pressure | 40 · 0 · 0 | — |
| Median margin of `scan` over the next lens (xT) | 0.0128 | — |
| Mean realised ΔxT (factual − intervention) | +0.1091 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.0974 | +0.0869 | +0.0001 | `pass:H9` | kept | `pass:H7` | kept | +0.099 |
| 101 | scan | +0.1116 | +0.0993 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.112 |
| 102 | scan | +0.0977 | +0.0852 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.102 |
| 103 | scan | +0.1059 | +0.0955 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.107 |
| 104 | scan | +0.1007 | +0.0918 | -0.0000 | `pass:H9` | kept | `carry` | kept | +0.107 |
| 105 | scan | +0.0962 | +0.0822 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.100 |
| 106 | scan | +0.1315 | +0.1179 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.132 |
| 107 | scan | +0.1075 | +0.0940 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.107 |
| 108 | scan | +0.0974 | +0.0866 | -0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.099 |
| 109 | scan | +0.1066 | +0.0927 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.113 |
| 110 | scan | +0.0989 | +0.0851 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.102 |
| 111 | scan | +0.1048 | +0.0916 | +0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.105 |
| 112 | scan | +0.1361 | +0.1201 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.133 |
| 113 | scan | +0.0908 | +0.0846 | -0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.091 |
| 114 | scan | +0.0917 | +0.0807 | +0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.094 |
| 115 | scan | +0.1113 | +0.0990 | -0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.115 |
| 116 | scan | +0.1222 | +0.1112 | +0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.122 |
| 117 | scan | +0.1061 | +0.0948 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.108 |
| 118 | scan | +0.0937 | +0.0799 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.095 |
| 119 | scan | +0.1180 | +0.0960 | -0.0000 | `pass:H9` | kept | `pass:H9` | lost | +0.121 |
| 120 | scan | +0.1226 | +0.1115 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.128 |
| 121 | scan | +0.0949 | +0.0823 | +0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.097 |
| 122 | scan | +0.1278 | +0.1178 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.129 |
| 123 | scan | +0.1227 | +0.1097 | +0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.122 |
| 124 | scan | +0.1303 | +0.1187 | -0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.131 |
| 125 | scan | +0.1057 | +0.0959 | -0.0000 | `pass:H9` | kept | `carry` | kept | +0.105 |
| 126 | scan | +0.1202 | +0.1068 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.123 |
| 127 | scan | +0.1027 | +0.0874 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.105 |
| 128 | scan | +0.1045 | +0.0910 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.104 |
| 129 | scan | +0.0907 | +0.0765 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.093 |
| 130 | scan | +0.1011 | +0.0840 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.101 |
| 131 | scan | +0.0996 | +0.0853 | -0.0000 | `pass:H9` | kept | `pass:H4` | kept | +0.099 |
| 132 | scan | +0.0944 | +0.0872 | -0.0000 | `pass:H9` | kept | `pass:H7` | kept | +0.095 |
| 133 | scan | +0.1070 | +0.0940 | -0.0000 | `pass:H9` | kept | `pass:H1` | kept | +0.107 |
| 134 | scan | +0.1158 | +0.1046 | -0.0000 | `pass:H9` | kept | `carry` | kept | +0.118 |
| 135 | scan | +0.1296 | +0.1119 | +0.0000 | `pass:H9` | kept | `carry` | kept | +0.124 |
| 136 | scan | +0.1110 | +0.0967 | -0.0000 | `pass:H9` | kept | `pass:H5` | kept | +0.111 |
| 137 | scan | +0.0958 | +0.0831 | -0.0000 | `pass:H9` | kept | `pass:H3` | kept | +0.100 |
| 138 | scan | +0.1091 | +0.0905 | +0.0000 | `pass:H9` | kept | `carry` | kept | +0.103 |
| 139 | scan | +0.1049 | +0.0944 | -0.0000 | `pass:H9` | kept | `pass:H2` | kept | +0.105 |
