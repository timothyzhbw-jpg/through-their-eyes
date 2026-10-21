# Hero lens — `keeper_switch`

Seeds 100–139 (40). Intended lens `scan`; intervention `drop_scan` on `H1`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 0/40 (0%) | ≥ 60% |
| Intervention changes the outcome | 26/40 (65%) | ≥ 60% |
| … factual action kept the ball | 37/40 | — |
| … the ball is lost after the intervention | 30/40 | — |
| Selected lens: scan · space · pressure | 0 · 3 · 37 | — |
| Median margin of `scan` over the next lens (xT) | nan | — |
| Mean realised ΔxT (factual − intervention) | +0.0340 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | pressure | +0.0008 | -0.0011 | +0.0872 | `pass:H3` | kept | `pass:H10` | lost | +0.023 |
| 101 | space | +0.0000 | -0.0216 | -0.0126 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 102 | pressure | +0.0001 | -0.0011 | +0.1086 | `pass:H3` | kept | `pass:H3` | lost | +0.006 |
| 103 | pressure | +0.0033 | -0.0013 | +0.0993 | `pass:H3` | kept | `pass:H3` | lost | +0.006 |
| 104 | pressure | +0.0009 | -0.0013 | +0.0905 | `pass:H3` | kept | `pass:H3` | lost | +0.006 |
| 105 | pressure | +0.0000 | -0.0020 | +0.1121 | `pass:H2` | kept | `pass:H2` | kept | +0.000 |
| 106 | pressure | +0.0023 | -0.0010 | +0.1066 | `pass:H3` | kept | `pass:H3` | lost | +0.006 |
| 107 | pressure | -0.0008 | -0.0011 | +0.1065 | `pass:H3` | kept | `pass:H9` | kept | -0.001 |
| 108 | space | +0.0000 | -0.0206 | +0.0125 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 109 | pressure | +0.0000 | -0.0022 | +0.0777 | `pass:H10` | lost | `pass:H10` | lost | +0.000 |
| 110 | pressure | +0.0011 | -0.0012 | +0.1079 | `pass:H3` | kept | `pass:H8` | lost | +0.018 |
| 111 | pressure | +0.0012 | -0.0011 | +0.0948 | `pass:H3` | kept | `pass:H8` | lost | +0.019 |
| 112 | pressure | +0.0010 | -0.0011 | +0.1139 | `pass:H3` | kept | `pass:H8` | lost | +0.018 |
| 113 | pressure | +0.0022 | -0.0012 | +0.0996 | `pass:H3` | kept | `pass:H3` | lost | +0.006 |
| 114 | pressure | +0.0007 | -0.0011 | +0.1074 | `pass:H3` | kept | `pass:H10` | lost | +0.019 |
| 115 | pressure | +0.0010 | -0.0011 | +0.1158 | `pass:H3` | kept | `pass:H2` | lost | +0.136 |
| 116 | pressure | +0.0011 | -0.0011 | +0.1058 | `pass:H3` | kept | `pass:H3` | lost | +0.006 |
| 117 | pressure | +0.0009 | -0.0010 | +0.1012 | `pass:H3` | kept | `pass:H2` | kept | -0.001 |
| 118 | pressure | +0.0010 | -0.0011 | +0.1041 | `pass:H3` | kept | `pass:H8` | lost | +0.018 |
| 119 | pressure | +0.0009 | -0.0011 | +0.0926 | `pass:H3` | kept | `pass:H8` | lost | +0.017 |
| 120 | pressure | +0.0011 | -0.0011 | +0.1086 | `pass:H3` | kept | `pass:H8` | lost | +0.018 |
| 121 | pressure | +0.0010 | -0.0011 | +0.1140 | `pass:H3` | kept | `pass:H2` | kept | -0.001 |
| 122 | pressure | +0.0010 | -0.0011 | +0.1081 | `pass:H3` | kept | `pass:H2` | lost | +0.137 |
| 123 | space | +0.0000 | -0.0208 | -0.0009 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 124 | pressure | +0.0000 | -0.0022 | +0.0653 | `pass:H8` | lost | `pass:H8` | lost | +0.000 |
| 125 | pressure | +0.0009 | -0.0010 | +0.0962 | `pass:H3` | kept | `pass:H2` | lost | +0.149 |
| 126 | pressure | +0.0000 | -0.0005 | +0.0956 | `pass:H9` | kept | `pass:H9` | kept | +0.000 |
| 127 | pressure | -0.0013 | -0.0013 | +0.1003 | `pass:H3` | kept | `pass:H7` | lost | +0.161 |
| 128 | pressure | +0.0011 | -0.0010 | +0.0984 | `pass:H3` | kept | `pass:H8` | lost | +0.019 |
| 129 | pressure | -0.0007 | -0.0010 | +0.1068 | `pass:H3` | kept | `pass:H9` | kept | -0.001 |
| 130 | pressure | +0.0012 | -0.0010 | +0.1019 | `pass:H3` | kept | `pass:H8` | lost | +0.019 |
| 131 | pressure | +0.0009 | -0.0011 | +0.1050 | `pass:H3` | kept | `pass:H10` | lost | +0.023 |
| 132 | pressure | +0.0000 | -0.0001 | -0.0647 | `pass:H7` | lost | `pass:H7` | lost | +0.000 |
| 133 | pressure | -0.0009 | -0.0010 | +0.0971 | `pass:H3` | kept | `pass:H7` | lost | +0.152 |
| 134 | pressure | +0.0009 | -0.0012 | +0.0961 | `pass:H3` | kept | `pass:H10` | lost | +0.022 |
| 135 | pressure | +0.0012 | -0.0014 | +0.1216 | `pass:H3` | kept | `pass:H8` | lost | +0.019 |
| 136 | pressure | -0.0005 | -0.0010 | +0.0924 | `pass:H3` | kept | `pass:H9` | kept | -0.001 |
| 137 | pressure | -0.0008 | -0.0010 | +0.1075 | `pass:H3` | kept | `pass:H7` | lost | +0.155 |
| 138 | pressure | +0.0009 | -0.0012 | +0.0993 | `pass:H3` | kept | `pass:H10` | lost | +0.023 |
| 139 | pressure | -0.0011 | -0.0011 | +0.1004 | `pass:H3` | kept | `pass:H7` | lost | +0.160 |
