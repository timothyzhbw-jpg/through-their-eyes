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
| Mean realised ΔxT (factual − intervention) | +0.0342 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | pressure | +0.0018 | -0.0002 | +0.0761 | `pass:H3` | kept | `pass:H10` | lost | +0.019 |
| 101 | space | +0.0000 | -0.0184 | -0.0076 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 102 | pressure | +0.0013 | -0.0002 | +0.0972 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 103 | pressure | +0.0048 | -0.0002 | +0.0883 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 104 | pressure | +0.0020 | -0.0002 | +0.0814 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 105 | pressure | +0.0000 | -0.0031 | +0.1014 | `pass:H2` | kept | `pass:H2` | kept | +0.000 |
| 106 | pressure | +0.0036 | -0.0002 | +0.0959 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 107 | pressure | +0.0002 | -0.0002 | +0.0945 | `pass:H3` | kept | `pass:H9` | lost | +0.008 |
| 108 | space | +0.0000 | -0.0176 | +0.0168 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 109 | pressure | +0.0000 | -0.0021 | +0.0714 | `pass:H10` | lost | `pass:H10` | lost | +0.000 |
| 110 | pressure | +0.0022 | -0.0002 | +0.0968 | `pass:H3` | kept | `pass:H8` | lost | +0.020 |
| 111 | pressure | +0.0023 | -0.0002 | +0.0844 | `pass:H3` | kept | `pass:H8` | lost | +0.021 |
| 112 | pressure | +0.0022 | -0.0002 | +0.1032 | `pass:H3` | kept | `pass:H8` | lost | +0.020 |
| 113 | pressure | +0.0036 | -0.0002 | +0.0893 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 114 | pressure | +0.0018 | -0.0002 | +0.0966 | `pass:H3` | kept | `pass:H10` | lost | +0.017 |
| 115 | pressure | +0.0029 | -0.0002 | +0.1046 | `pass:H3` | kept | `pass:H2` | lost | +0.131 |
| 116 | pressure | +0.0023 | -0.0002 | +0.0950 | `pass:H3` | kept | `pass:H3` | lost | +0.013 |
| 117 | pressure | +0.0028 | -0.0002 | +0.0905 | `pass:H3` | kept | `pass:H2` | kept | -0.000 |
| 118 | pressure | +0.0021 | -0.0002 | +0.0928 | `pass:H3` | kept | `pass:H8` | lost | +0.019 |
| 119 | pressure | +0.0020 | -0.0002 | +0.0811 | `pass:H3` | kept | `pass:H8` | lost | +0.019 |
| 120 | pressure | +0.0022 | -0.0002 | +0.0984 | `pass:H3` | kept | `pass:H8` | lost | +0.020 |
| 121 | pressure | +0.0029 | -0.0002 | +0.1017 | `pass:H3` | kept | `pass:H2` | kept | -0.000 |
| 122 | pressure | +0.0029 | -0.0002 | +0.0979 | `pass:H3` | kept | `pass:H2` | lost | +0.131 |
| 123 | space | +0.0000 | -0.0177 | +0.0029 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 124 | pressure | +0.0000 | -0.0025 | +0.0552 | `pass:H8` | lost | `pass:H8` | lost | +0.000 |
| 125 | pressure | +0.0028 | -0.0002 | +0.0862 | `pass:H3` | kept | `pass:H2` | lost | +0.141 |
| 126 | pressure | +0.0000 | -0.0006 | +0.0824 | `pass:H9` | lost | `pass:H9` | lost | +0.000 |
| 127 | pressure | -0.0002 | -0.0002 | +0.0894 | `pass:H3` | kept | `pass:H7` | lost | +0.151 |
| 128 | pressure | +0.0022 | -0.0003 | +0.0874 | `pass:H3` | kept | `pass:H8` | lost | +0.020 |
| 129 | pressure | +0.0003 | -0.0002 | +0.0959 | `pass:H3` | kept | `pass:H9` | lost | +0.008 |
| 130 | pressure | +0.0023 | -0.0002 | +0.0916 | `pass:H3` | kept | `pass:H8` | lost | +0.021 |
| 131 | pressure | +0.0019 | -0.0002 | +0.0937 | `pass:H3` | kept | `pass:H10` | lost | +0.019 |
| 132 | pressure | +0.0000 | -0.0003 | -0.0648 | `pass:H7` | lost | `pass:H7` | lost | +0.000 |
| 133 | pressure | +0.0001 | -0.0002 | +0.0873 | `pass:H3` | kept | `pass:H7` | lost | +0.144 |
| 134 | pressure | +0.0019 | -0.0002 | +0.0862 | `pass:H3` | kept | `pass:H10` | lost | +0.019 |
| 135 | pressure | +0.0023 | -0.0003 | +0.1103 | `pass:H3` | kept | `pass:H8` | lost | +0.021 |
| 136 | pressure | +0.0005 | -0.0002 | +0.0813 | `pass:H3` | kept | `pass:H9` | lost | +0.008 |
| 137 | pressure | +0.0003 | -0.0002 | +0.0972 | `pass:H3` | kept | `pass:H7` | lost | +0.146 |
| 138 | pressure | +0.0019 | -0.0002 | +0.0891 | `pass:H3` | kept | `pass:H10` | lost | +0.019 |
| 139 | pressure | +0.0000 | -0.0002 | +0.0894 | `pass:H3` | kept | `pass:H7` | lost | +0.150 |
