# Hero lens — `keeper_switch`

Seeds 100–139 (40). Intended lens `scan`; intervention `drop_scan` on `H1`, re-simulated from the frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed when the decision changes.

| Metric | Value | Target |
|---|---|---|
| Hero decision detected as a moment | 40/40 | — |
| `scan` lens selected | 0/40 (0%) | ≥ 60% |
| Intervention changes the outcome | 26/40 (65%) | ≥ 60% |
| … factual action kept the ball | 37/40 | — |
| … the ball is lost after the intervention | 30/40 | — |
| Selected lens: scan · space · pressure | 0 · 0 · 40 | — |
| Median margin of `scan` over the next lens (xT) | nan | — |
| Mean realised ΔxT (factual − intervention) | +0.0430 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | pressure | +0.0079 | +0.0000 | +0.0722 | `pass:H3` | kept | `pass:H10` | lost | +0.043 |
| 101 | pressure | +0.0000 | -0.0103 | +0.0286 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 102 | pressure | +0.0025 | +0.0000 | +0.0920 | `pass:H3` | kept | `pass:H3` | lost | +0.041 |
| 103 | pressure | +0.0079 | +0.0000 | +0.0852 | `pass:H3` | kept | `pass:H3` | lost | +0.041 |
| 104 | pressure | +0.0035 | +0.0000 | +0.0756 | `pass:H3` | kept | `pass:H3` | lost | +0.041 |
| 105 | pressure | +0.0000 | -0.0082 | +0.0966 | `pass:H2` | kept | `pass:H2` | kept | +0.000 |
| 106 | pressure | +0.0059 | +0.0000 | +0.0922 | `pass:H3` | kept | `pass:H3` | lost | +0.041 |
| 107 | pressure | +0.0046 | +0.0000 | +0.0910 | `pass:H3` | kept | `pass:H9` | kept | -0.000 |
| 108 | pressure | +0.0000 | -0.0101 | +0.0481 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 109 | pressure | +0.0000 | -0.0080 | +0.0427 | `pass:H10` | lost | `pass:H10` | lost | +0.000 |
| 110 | pressure | +0.0080 | +0.0000 | +0.0939 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 111 | pressure | +0.0080 | +0.0000 | +0.0808 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 112 | pressure | +0.0080 | +0.0000 | +0.1000 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 113 | pressure | +0.0062 | +0.0000 | +0.0869 | `pass:H3` | kept | `pass:H3` | lost | +0.041 |
| 114 | pressure | +0.0079 | +0.0000 | +0.0938 | `pass:H3` | kept | `pass:H10` | lost | +0.043 |
| 115 | pressure | +0.0082 | +0.0000 | +0.1004 | `pass:H3` | kept | `pass:H2` | lost | +0.123 |
| 116 | pressure | +0.0040 | +0.0000 | +0.0918 | `pass:H3` | kept | `pass:H3` | lost | +0.041 |
| 117 | pressure | +0.0082 | +0.0000 | +0.0849 | `pass:H3` | kept | `pass:H2` | kept | -0.000 |
| 118 | pressure | +0.0080 | +0.0000 | +0.0896 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 119 | pressure | +0.0079 | +0.0000 | +0.0774 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 120 | pressure | +0.0080 | +0.0000 | +0.0928 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 121 | pressure | +0.0082 | +0.0000 | +0.0971 | `pass:H3` | kept | `pass:H2` | kept | -0.000 |
| 122 | pressure | +0.0082 | +0.0000 | +0.0951 | `pass:H3` | kept | `pass:H2` | lost | +0.126 |
| 123 | pressure | +0.0000 | -0.0101 | +0.0353 | `pass:H6` | kept | `pass:H6` | kept | +0.000 |
| 124 | pressure | +0.0000 | -0.0080 | +0.0296 | `pass:H8` | lost | `pass:H8` | lost | +0.000 |
| 125 | pressure | +0.0081 | +0.0000 | +0.0837 | `pass:H3` | kept | `pass:H2` | lost | +0.131 |
| 126 | pressure | +0.0000 | -0.0056 | +0.0514 | `pass:H9` | kept | `pass:H9` | kept | +0.000 |
| 127 | pressure | +0.0021 | +0.0000 | +0.0852 | `pass:H3` | kept | `pass:H7` | lost | +0.126 |
| 128 | pressure | +0.0080 | +0.0000 | +0.0829 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 129 | pressure | +0.0050 | +0.0000 | +0.0925 | `pass:H3` | kept | `pass:H9` | kept | -0.000 |
| 130 | pressure | +0.0080 | +0.0000 | +0.0875 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 131 | pressure | +0.0079 | +0.0000 | +0.0907 | `pass:H3` | kept | `pass:H10` | lost | +0.043 |
| 132 | pressure | +0.0000 | -0.0042 | -0.0420 | `pass:H7` | lost | `pass:H7` | lost | +0.000 |
| 133 | pressure | +0.0045 | +0.0000 | +0.0810 | `pass:H3` | kept | `pass:H7` | lost | +0.119 |
| 134 | pressure | +0.0079 | +0.0000 | +0.0827 | `pass:H3` | kept | `pass:H10` | lost | +0.043 |
| 135 | pressure | +0.0080 | +0.0000 | +0.1045 | `pass:H3` | kept | `pass:H8` | lost | +0.043 |
| 136 | pressure | +0.0068 | +0.0000 | +0.0785 | `pass:H3` | kept | `pass:H9` | kept | -0.000 |
| 137 | pressure | +0.0053 | +0.0000 | +0.0916 | `pass:H3` | kept | `pass:H7` | lost | +0.122 |
| 138 | pressure | +0.0080 | +0.0000 | +0.0857 | `pass:H3` | kept | `pass:H10` | lost | +0.043 |
| 139 | pressure | +0.0035 | +0.0000 | +0.0846 | `pass:H3` | kept | `pass:H7` | lost | +0.124 |
