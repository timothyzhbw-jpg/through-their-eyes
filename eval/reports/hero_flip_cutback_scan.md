# Hero flip — `cutback_scan`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H7` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 38/40 (95%) | ≥ 60% |
| Factual decision is `pass:H8` | 38/40 (95%) | — |
| … and the pass is completed | 38/38 | — |
| Mean ΔxT (factual − counterfactual) | +0.144 | — |

| Seed | Factual | P(pass:H8) | Outcome | Counterfactual | P(pass:H8) | Belief error H8 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.133 |
| 101 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.134 |
| 102 | `pass:H8` | 0.87 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.141 |
| 103 | `pass:H8` | 0.87 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.139 |
| 104 | `pass:H8` | 0.90 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.136 |
| 105 | `pass:H8` | 0.96 | complete | `shot` | 0.00 | 0.0 | 6.4 | +0.206 |
| 106 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.142 |
| 107 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.8 | +0.137 |
| 108 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.1 | +0.136 |
| 109 | `pass:H8` | 0.90 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.134 |
| 110 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.132 |
| 111 | `carry` | 0.92 | carry | `carry` | 0.00 | 0.0 | 6.8 | +0.000 |
| 112 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 7.1 | +0.207 |
| 113 | `carry` | 0.92 | carry | `carry` | 0.00 | 0.0 | 6.5 | +0.000 |
| 114 | `pass:H8` | 0.88 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.137 |
| 115 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.141 |
| 116 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.139 |
| 117 | `pass:H8` | 0.95 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.135 |
| 118 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.132 |
| 119 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.134 |
| 120 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.138 |
| 121 | `pass:H8` | 0.97 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.137 |
| 122 | `pass:H8` | 0.92 | complete | `shot` | 0.00 | 0.0 | 6.9 | +0.207 |
| 123 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 7.0 | +0.140 |
| 124 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.137 |
| 125 | `pass:H8` | 0.91 | complete | `shot` | 0.00 | 0.0 | 6.8 | +0.208 |
| 126 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 6.1 | +0.207 |
| 127 | `pass:H8` | 0.95 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.138 |
| 128 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 6.7 | +0.207 |
| 129 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.140 |
| 130 | `pass:H8` | 0.89 | complete | `shot` | 0.00 | 0.0 | 6.1 | +0.207 |
| 131 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.137 |
| 132 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.133 |
| 133 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.140 |
| 134 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.141 |
| 135 | `pass:H8` | 0.97 | complete | `carry` | 0.00 | 0.0 | 6.0 | +0.140 |
| 136 | `pass:H8` | 0.89 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.139 |
| 137 | `pass:H8` | 0.96 | complete | `shot` | 0.00 | 0.0 | 6.0 | +0.207 |
| 138 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.140 |
| 139 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.139 |
