# Hero lens — `keeper_switch`

Seeds 100–139 (40). Intended lens `scan`; intervention `drop_scan` on `H1`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 0/40 (0%) | ≥ 60% |
| Intervention changes the outcome | 26/40 (65%) | ≥ 60% |
| … factual action kept the ball | 36/40 | — |
| … the ball is lost after the intervention | 34/40 | — |
| Selected lens: scan · space · pressure | 0 · 3 · 37 | — |
| Median margin of `scan` over the next lens (xT) | nan | — |
| Mean realised ΔxT (factual − intervention) | +0.0344 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | pressure | +0.0019 | -0.0001 | +0.0761 | `pass:H3` | kept | `pass:H10` | lost | +0.019 |
| 101 | space | +0.0000 | -0.0185 | -0.0080 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 102 | pressure | +0.0013 | -0.0002 | +0.0972 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 103 | pressure | +0.0049 | -0.0001 | +0.0882 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 104 | pressure | +0.0021 | -0.0001 | +0.0814 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 105 | pressure | +0.0000 | -0.0031 | +0.1013 | `pass:H2` | kept | `pass:H2` | kept | +0.000 |
| 106 | pressure | +0.0037 | -0.0001 | +0.0958 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 107 | pressure | +0.0002 | -0.0002 | +0.0945 | `pass:H3` | kept | `pass:H9` | lost | +0.008 |
| 108 | space | +0.0000 | -0.0176 | +0.0156 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 109 | pressure | +0.0000 | -0.0022 | +0.0713 | `pass:H10` | lost | `pass:H10` | lost | +0.000 |
| 110 | pressure | +0.0023 | -0.0002 | +0.0967 | `pass:H3` | kept | `pass:H8` | lost | +0.020 |
| 111 | pressure | +0.0024 | -0.0001 | +0.0844 | `pass:H3` | kept | `pass:H8` | lost | +0.021 |
| 112 | pressure | +0.0023 | -0.0001 | +0.1031 | `pass:H3` | kept | `pass:H8` | lost | +0.020 |
| 113 | pressure | +0.0037 | -0.0001 | +0.0892 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 114 | pressure | +0.0019 | -0.0001 | +0.0965 | `pass:H3` | kept | `pass:H10` | lost | +0.018 |
| 115 | pressure | +0.0030 | -0.0002 | +0.1045 | `pass:H3` | kept | `pass:H2` | lost | +0.131 |
| 116 | pressure | +0.0024 | -0.0002 | +0.0949 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 117 | pressure | +0.0029 | -0.0002 | +0.0905 | `pass:H3` | kept | `pass:H2` | kept | -0.000 |
| 118 | pressure | +0.0022 | -0.0002 | +0.0927 | `pass:H3` | kept | `pass:H8` | lost | +0.019 |
| 119 | pressure | +0.0021 | -0.0001 | +0.0810 | `pass:H3` | kept | `pass:H8` | lost | +0.019 |
| 120 | pressure | +0.0023 | -0.0002 | +0.0983 | `pass:H3` | kept | `pass:H8` | lost | +0.020 |
| 121 | pressure | +0.0029 | -0.0002 | +0.1016 | `pass:H3` | kept | `pass:H2` | kept | -0.000 |
| 122 | pressure | +0.0030 | -0.0002 | +0.0979 | `pass:H3` | kept | `pass:H2` | lost | +0.132 |
| 123 | space | +0.0000 | -0.0178 | +0.0032 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 124 | pressure | +0.0000 | -0.0026 | +0.0549 | `pass:H8` | lost | `pass:H8` | lost | +0.000 |
| 125 | pressure | +0.0029 | -0.0001 | +0.0862 | `pass:H3` | kept | `pass:H2` | lost | +0.141 |
| 126 | pressure | +0.0000 | -0.0006 | +0.0821 | `pass:H9` | lost | `pass:H9` | lost | +0.000 |
| 127 | pressure | -0.0001 | -0.0002 | +0.0893 | `pass:H3` | kept | `pass:H7` | lost | +0.152 |
| 128 | pressure | +0.0023 | -0.0002 | +0.0873 | `pass:H3` | kept | `pass:H8` | lost | +0.020 |
| 129 | pressure | +0.0003 | -0.0001 | +0.0958 | `pass:H3` | kept | `pass:H9` | lost | +0.009 |
| 130 | pressure | +0.0024 | -0.0001 | +0.0916 | `pass:H3` | kept | `pass:H8` | lost | +0.021 |
| 131 | pressure | +0.0019 | -0.0002 | +0.0936 | `pass:H3` | kept | `pass:H10` | lost | +0.019 |
| 132 | pressure | +0.0000 | -0.0003 | -0.0649 | `pass:H7` | lost | `pass:H7` | lost | +0.000 |
| 133 | pressure | +0.0002 | -0.0001 | +0.0873 | `pass:H3` | kept | `pass:H7` | lost | +0.144 |
| 134 | pressure | +0.0020 | -0.0002 | +0.0861 | `pass:H3` | kept | `pass:H10` | lost | +0.019 |
| 135 | pressure | +0.0024 | -0.0002 | +0.1103 | `pass:H3` | kept | `pass:H8` | lost | +0.021 |
| 136 | pressure | +0.0006 | -0.0002 | +0.0812 | `pass:H3` | kept | `pass:H9` | lost | +0.009 |
| 137 | pressure | +0.0003 | -0.0001 | +0.0972 | `pass:H3` | kept | `pass:H7` | lost | +0.147 |
| 138 | pressure | +0.0020 | -0.0001 | +0.0890 | `pass:H3` | kept | `pass:H10` | lost | +0.020 |
| 139 | pressure | +0.0001 | -0.0001 | +0.0893 | `pass:H3` | kept | `pass:H7` | lost | +0.151 |
