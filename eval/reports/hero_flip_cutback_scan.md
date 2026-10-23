# Hero flip — `cutback_scan`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H7` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 38/40 (95%) | ≥ 60% |
| Factual decision is `pass:H8` | 38/40 (95%) | — |
| … and the pass is completed | 38/38 | — |
| Mean ΔxT (factual − counterfactual) | +0.145 | — |

| Seed | Factual | P(pass:H8) | Outcome | Counterfactual | P(pass:H8) | Belief error H8 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.134 |
| 101 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.135 |
| 102 | `pass:H8` | 0.87 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.142 |
| 103 | `pass:H8` | 0.87 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.140 |
| 104 | `pass:H8` | 0.90 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.137 |
| 105 | `pass:H8` | 0.96 | complete | `shot` | 0.00 | 0.0 | 6.4 | +0.208 |
| 106 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.144 |
| 107 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.8 | +0.138 |
| 108 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.1 | +0.137 |
| 109 | `pass:H8` | 0.90 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.135 |
| 110 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.133 |
| 111 | `carry` | 0.92 | carry | `carry` | 0.00 | 0.0 | 6.8 | +0.000 |
| 112 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 7.1 | +0.208 |
| 113 | `carry` | 0.92 | carry | `carry` | 0.00 | 0.0 | 6.5 | +0.000 |
| 114 | `pass:H8` | 0.88 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.138 |
| 115 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.142 |
| 116 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.140 |
| 117 | `pass:H8` | 0.95 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.136 |
| 118 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.133 |
| 119 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.135 |
| 120 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.139 |
| 121 | `pass:H8` | 0.97 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.138 |
| 122 | `pass:H8` | 0.92 | complete | `shot` | 0.00 | 0.0 | 6.9 | +0.208 |
| 123 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 7.0 | +0.141 |
| 124 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.138 |
| 125 | `pass:H8` | 0.91 | complete | `shot` | 0.00 | 0.0 | 6.8 | +0.209 |
| 126 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 6.1 | +0.208 |
| 127 | `pass:H8` | 0.95 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.139 |
| 128 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 6.7 | +0.208 |
| 129 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.141 |
| 130 | `pass:H8` | 0.89 | complete | `shot` | 0.00 | 0.0 | 6.1 | +0.208 |
| 131 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.138 |
| 132 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.134 |
| 133 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.141 |
| 134 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.142 |
| 135 | `pass:H8` | 0.97 | complete | `carry` | 0.00 | 0.0 | 6.0 | +0.141 |
| 136 | `pass:H8` | 0.89 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.140 |
| 137 | `pass:H8` | 0.96 | complete | `shot` | 0.00 | 0.0 | 6.0 | +0.208 |
| 138 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.141 |
| 139 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.140 |
