# Hero flip — `cutback_scan`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H7` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 38/40 (95%) | ≥ 60% |
| Factual decision is `pass:H8` | 38/40 (95%) | — |
| … and the pass is completed | 38/38 | — |
| Mean ΔxT (factual − counterfactual) | +0.092 | — |

| Seed | Factual | P(pass:H8) | Outcome | Counterfactual | P(pass:H8) | Belief error H8 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.072 |
| 101 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.070 |
| 102 | `pass:H8` | 0.87 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.080 |
| 103 | `pass:H8` | 0.87 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.081 |
| 104 | `pass:H8` | 0.90 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.075 |
| 105 | `pass:H8` | 0.96 | complete | `shot` | 0.00 | 0.0 | 6.4 | +0.188 |
| 106 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.077 |
| 107 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.8 | +0.076 |
| 108 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.1 | +0.068 |
| 109 | `pass:H8` | 0.90 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.070 |
| 110 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.064 |
| 111 | `carry` | 0.92 | carry | `carry` | 0.00 | 0.0 | 6.8 | +0.000 |
| 112 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 7.1 | +0.193 |
| 113 | `carry` | 0.92 | carry | `carry` | 0.00 | 0.0 | 6.5 | +0.000 |
| 114 | `pass:H8` | 0.88 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.077 |
| 115 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.080 |
| 116 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.075 |
| 117 | `pass:H8` | 0.95 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.069 |
| 118 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.073 |
| 119 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.068 |
| 120 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.070 |
| 121 | `pass:H8` | 0.97 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.068 |
| 122 | `pass:H8` | 0.92 | complete | `shot` | 0.00 | 0.0 | 6.9 | +0.192 |
| 123 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 7.0 | +0.078 |
| 124 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.069 |
| 125 | `pass:H8` | 0.91 | complete | `shot` | 0.00 | 0.0 | 6.8 | +0.191 |
| 126 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 6.1 | +0.186 |
| 127 | `pass:H8` | 0.95 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.078 |
| 128 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 6.7 | +0.191 |
| 129 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.073 |
| 130 | `pass:H8` | 0.89 | complete | `shot` | 0.00 | 0.0 | 6.1 | +0.187 |
| 131 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.067 |
| 132 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.067 |
| 133 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.070 |
| 134 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.077 |
| 135 | `pass:H8` | 0.97 | complete | `carry` | 0.00 | 0.0 | 6.0 | +0.072 |
| 136 | `pass:H8` | 0.89 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.075 |
| 137 | `pass:H8` | 0.96 | complete | `shot` | 0.00 | 0.0 | 6.0 | +0.183 |
| 138 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.076 |
| 139 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.072 |
