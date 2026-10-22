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
| Median margin of `scan` over the next lens (xT) | 0.1650 | — |
| Mean realised ΔxT (factual − intervention) | +0.1454 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.1929 | +0.0031 | +0.0191 | `pass:H8` | kept | `carry` | kept | +0.134 |
| 101 | scan | +0.1922 | -0.0008 | -0.0027 | `pass:H8` | kept | `carry` | kept | +0.135 |
| 102 | scan | +0.1913 | +0.0050 | -0.0115 | `pass:H8` | kept | `carry` | kept | +0.142 |
| 103 | scan | +0.1918 | +0.0123 | +0.0101 | `pass:H8` | kept | `carry` | kept | +0.140 |
| 104 | scan | +0.1909 | +0.0157 | +0.0414 | `pass:H8` | kept | `carry` | kept | +0.137 |
| 105 | scan | +0.1480 | +0.0021 | -0.0096 | `pass:H8` | kept | `shot` | shot | +0.208 |
| 106 | scan | +0.1928 | -0.0009 | +0.0008 | `pass:H8` | kept | `carry` | kept | +0.144 |
| 107 | scan | +0.1902 | +0.0035 | +0.0238 | `pass:H8` | kept | `carry` | kept | +0.138 |
| 108 | scan | +0.1883 | +0.0095 | +0.0007 | `pass:H8` | kept | `carry` | kept | +0.137 |
| 109 | scan | +0.1876 | +0.0022 | +0.0161 | `pass:H8` | kept | `carry` | kept | +0.135 |
| 110 | scan | +0.1890 | +0.0133 | -0.0117 | `pass:H8` | kept | `carry` | kept | +0.133 |
| 111 | space | +0.0000 | -0.1865 | +0.0155 | `carry` | kept | `carry` | kept | +0.000 |
| 112 | scan | +0.1473 | +0.0113 | +0.0093 | `pass:H8` | kept | `shot` | shot | +0.208 |
| 113 | space | +0.0000 | -0.1892 | +0.0177 | `carry` | kept | `carry` | kept | +0.000 |
| 114 | scan | +0.1899 | +0.0037 | +0.0401 | `pass:H8` | kept | `carry` | kept | +0.138 |
| 115 | scan | +0.1886 | +0.0094 | +0.0055 | `pass:H8` | kept | `carry` | kept | +0.142 |
| 116 | scan | +0.1872 | +0.0086 | +0.0293 | `pass:H8` | kept | `carry` | kept | +0.140 |
| 117 | scan | +0.1929 | +0.0025 | -0.0014 | `pass:H8` | kept | `carry` | kept | +0.136 |
| 118 | scan | +0.1896 | +0.0151 | +0.0502 | `pass:H8` | kept | `carry` | kept | +0.133 |
| 119 | scan | +0.1910 | +0.0062 | +0.0041 | `pass:H8` | kept | `carry` | kept | +0.135 |
| 120 | scan | +0.1915 | +0.0035 | +0.0036 | `pass:H8` | kept | `carry` | kept | +0.139 |
| 121 | scan | +0.1902 | -0.0018 | +0.0290 | `pass:H8` | kept | `carry` | kept | +0.138 |
| 122 | scan | +0.1490 | -0.0067 | +0.0023 | `pass:H8` | kept | `shot` | shot | +0.208 |
| 123 | scan | +0.1883 | -0.0023 | +0.0101 | `pass:H8` | kept | `carry` | kept | +0.141 |
| 124 | scan | +0.1842 | +0.0086 | +0.0034 | `pass:H8` | kept | `carry` | kept | +0.138 |
| 125 | scan | +0.1491 | +0.0010 | +0.0114 | `pass:H8` | kept | `shot` | shot | +0.209 |
| 126 | scan | +0.1488 | +0.0028 | +0.0162 | `pass:H8` | kept | `shot` | shot | +0.208 |
| 127 | scan | +0.1886 | +0.0011 | +0.0409 | `pass:H8` | kept | `carry` | kept | +0.139 |
| 128 | scan | +0.1467 | +0.0106 | -0.0014 | `pass:H8` | kept | `shot` | shot | +0.208 |
| 129 | scan | +0.1891 | +0.0048 | +0.0255 | `pass:H8` | kept | `carry` | kept | +0.141 |
| 130 | scan | +0.1480 | +0.0114 | +0.0001 | `pass:H8` | kept | `shot` | shot | +0.208 |
| 131 | scan | +0.1881 | +0.0032 | +0.0057 | `pass:H8` | kept | `carry` | kept | +0.138 |
| 132 | scan | +0.1908 | +0.0087 | +0.0400 | `pass:H8` | kept | `carry` | kept | +0.134 |
| 133 | scan | +0.1870 | +0.0082 | -0.0002 | `pass:H8` | kept | `carry` | kept | +0.141 |
| 134 | scan | +0.1896 | +0.0097 | +0.0022 | `pass:H8` | kept | `carry` | kept | +0.142 |
| 135 | scan | +0.1932 | -0.0029 | +0.0117 | `pass:H8` | kept | `carry` | kept | +0.141 |
| 136 | scan | +0.1912 | -0.0018 | +0.0312 | `pass:H8` | kept | `carry` | kept | +0.140 |
| 137 | scan | +0.1480 | +0.0150 | -0.0187 | `pass:H8` | kept | `shot` | shot | +0.208 |
| 138 | scan | +0.1935 | +0.0082 | +0.0309 | `pass:H8` | kept | `carry` | kept | +0.141 |
| 139 | scan | +0.1908 | +0.0021 | +0.0425 | `pass:H8` | kept | `carry` | kept | +0.140 |
