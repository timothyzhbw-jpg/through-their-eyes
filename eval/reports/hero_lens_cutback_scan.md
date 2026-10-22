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
| Median margin of `scan` over the next lens (xT) | 0.1638 | — |
| Mean realised ΔxT (factual − intervention) | +0.1444 | — |

Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no scan before the decision). Result: `kept` or `lost` possession after the hero's action.

| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention | Result | ΔxT |
|---|---|---|---|---|---|---|---|---|---|
| 100 | scan | +0.1918 | +0.0003 | +0.0192 | `pass:H8` | kept | `carry` | kept | +0.133 |
| 101 | scan | +0.1911 | -0.0036 | -0.0025 | `pass:H8` | kept | `carry` | kept | +0.134 |
| 102 | scan | +0.1903 | +0.0023 | -0.0113 | `pass:H8` | kept | `carry` | kept | +0.141 |
| 103 | scan | +0.1907 | +0.0104 | +0.0102 | `pass:H8` | kept | `carry` | kept | +0.139 |
| 104 | scan | +0.1898 | +0.0146 | +0.0413 | `pass:H8` | kept | `carry` | kept | +0.136 |
| 105 | scan | +0.1469 | -0.0009 | -0.0109 | `pass:H8` | kept | `shot` | shot | +0.206 |
| 106 | scan | +0.1917 | -0.0037 | +0.0009 | `pass:H8` | kept | `carry` | kept | +0.142 |
| 107 | scan | +0.1891 | +0.0007 | +0.0239 | `pass:H8` | kept | `carry` | kept | +0.137 |
| 108 | scan | +0.1872 | +0.0084 | -0.0033 | `pass:H8` | kept | `carry` | kept | +0.136 |
| 109 | scan | +0.1865 | -0.0007 | +0.0162 | `pass:H8` | kept | `carry` | kept | +0.134 |
| 110 | scan | +0.1879 | +0.0122 | -0.0114 | `pass:H8` | kept | `carry` | kept | +0.132 |
| 111 | space | +0.0000 | -0.1883 | +0.0155 | `carry` | kept | `carry` | kept | +0.000 |
| 112 | scan | +0.1462 | +0.0102 | +0.0094 | `pass:H8` | kept | `shot` | shot | +0.207 |
| 113 | space | +0.0000 | -0.1881 | +0.0177 | `carry` | kept | `carry` | kept | +0.000 |
| 114 | scan | +0.1888 | +0.0008 | +0.0401 | `pass:H8` | kept | `carry` | kept | +0.137 |
| 115 | scan | +0.1875 | +0.0083 | +0.0056 | `pass:H8` | kept | `carry` | kept | +0.141 |
| 116 | scan | +0.1861 | +0.0059 | +0.0293 | `pass:H8` | kept | `carry` | kept | +0.139 |
| 117 | scan | +0.1918 | -0.0003 | -0.0013 | `pass:H8` | kept | `carry` | kept | +0.135 |
| 118 | scan | +0.1885 | +0.0140 | +0.0502 | `pass:H8` | kept | `carry` | kept | +0.132 |
| 119 | scan | +0.1899 | +0.0036 | +0.0043 | `pass:H8` | kept | `carry` | kept | +0.134 |
| 120 | scan | +0.1904 | +0.0009 | +0.0017 | `pass:H8` | kept | `carry` | kept | +0.138 |
| 121 | scan | +0.1891 | -0.0046 | +0.0290 | `pass:H8` | kept | `carry` | kept | +0.137 |
| 122 | scan | +0.1479 | -0.0096 | +0.0024 | `pass:H8` | kept | `shot` | shot | +0.207 |
| 123 | scan | +0.1872 | -0.0052 | +0.0102 | `pass:H8` | kept | `carry` | kept | +0.140 |
| 124 | scan | +0.1831 | +0.0075 | +0.0035 | `pass:H8` | kept | `carry` | kept | +0.137 |
| 125 | scan | +0.1480 | -0.0017 | +0.0114 | `pass:H8` | kept | `shot` | shot | +0.208 |
| 126 | scan | +0.1477 | -0.0001 | +0.0146 | `pass:H8` | kept | `shot` | shot | +0.207 |
| 127 | scan | +0.1875 | -0.0017 | +0.0409 | `pass:H8` | kept | `carry` | kept | +0.138 |
| 128 | scan | +0.1456 | +0.0095 | -0.0012 | `pass:H8` | kept | `shot` | shot | +0.207 |
| 129 | scan | +0.1880 | +0.0020 | +0.0256 | `pass:H8` | kept | `carry` | kept | +0.140 |
| 130 | scan | +0.1469 | +0.0103 | +0.0003 | `pass:H8` | kept | `shot` | shot | +0.207 |
| 131 | scan | +0.1870 | +0.0003 | +0.0059 | `pass:H8` | kept | `carry` | kept | +0.137 |
| 132 | scan | +0.1897 | +0.0075 | +0.0400 | `pass:H8` | kept | `carry` | kept | +0.133 |
| 133 | scan | +0.1859 | +0.0071 | -0.0000 | `pass:H8` | kept | `carry` | kept | +0.140 |
| 134 | scan | +0.1885 | +0.0069 | +0.0024 | `pass:H8` | kept | `carry` | kept | +0.141 |
| 135 | scan | +0.1921 | -0.0058 | +0.0118 | `pass:H8` | kept | `carry` | kept | +0.140 |
| 136 | scan | +0.1901 | -0.0045 | +0.0312 | `pass:H8` | kept | `carry` | kept | +0.139 |
| 137 | scan | +0.1469 | +0.0139 | -0.0184 | `pass:H8` | kept | `shot` | shot | +0.207 |
| 138 | scan | +0.1924 | +0.0055 | +0.0309 | `pass:H8` | kept | `carry` | kept | +0.140 |
| 139 | scan | +0.1897 | -0.0008 | +0.0425 | `pass:H8` | kept | `carry` | kept | +0.139 |
