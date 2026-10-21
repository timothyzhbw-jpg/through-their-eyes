# Hero flip — `cutback_scan`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H7` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 38/40 (95%) | ≥ 60% |
| Factual decision is `pass:H8` | 38/40 (95%) | — |
| … and the pass is completed | 38/38 | — |
| Mean ΔxT (factual − counterfactual) | +0.233 | — |

| Seed | Factual | P(pass:H8) | Outcome | Counterfactual | P(pass:H8) | Belief error H8 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.227 |
| 101 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.222 |
| 102 | `pass:H8` | 0.87 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.234 |
| 103 | `pass:H8` | 0.87 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.229 |
| 104 | `pass:H8` | 0.90 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.230 |
| 105 | `pass:H8` | 0.96 | complete | `shot` | 0.00 | 0.0 | 6.4 | +0.298 |
| 106 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.235 |
| 107 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.8 | +0.231 |
| 108 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.1 | +0.229 |
| 109 | `pass:H8` | 0.90 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.226 |
| 110 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.219 |
| 111 | `carry` | 0.92 | carry | `carry` | 0.00 | 0.0 | 6.8 | +0.000 |
| 112 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 7.1 | +0.303 |
| 113 | `carry` | 0.92 | carry | `carry` | 0.00 | 0.0 | 6.5 | +0.000 |
| 114 | `pass:H8` | 0.88 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.231 |
| 115 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.234 |
| 116 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.232 |
| 117 | `pass:H8` | 0.95 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.228 |
| 118 | `pass:H8` | 0.94 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.227 |
| 119 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.222 |
| 120 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.231 |
| 121 | `pass:H8` | 0.97 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.230 |
| 122 | `pass:H8` | 0.92 | complete | `shot` | 0.00 | 0.0 | 6.9 | +0.301 |
| 123 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 7.0 | +0.231 |
| 124 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.229 |
| 125 | `pass:H8` | 0.91 | complete | `shot` | 0.00 | 0.0 | 6.8 | +0.306 |
| 126 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 6.1 | +0.305 |
| 127 | `pass:H8` | 0.95 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.232 |
| 128 | `pass:H8` | 0.94 | complete | `shot` | 0.00 | 0.0 | 6.7 | +0.300 |
| 129 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.5 | +0.233 |
| 130 | `pass:H8` | 0.89 | complete | `shot` | 0.00 | 0.0 | 6.1 | +0.305 |
| 131 | `pass:H8` | 0.93 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.230 |
| 132 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.4 | +0.227 |
| 133 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.3 | +0.233 |
| 134 | `pass:H8` | 0.92 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.231 |
| 135 | `pass:H8` | 0.97 | complete | `carry` | 0.00 | 0.0 | 6.0 | +0.233 |
| 136 | `pass:H8` | 0.89 | complete | `carry` | 0.00 | 0.0 | 6.9 | +0.233 |
| 137 | `pass:H8` | 0.96 | complete | `shot` | 0.00 | 0.0 | 6.0 | +0.302 |
| 138 | `pass:H8` | 0.91 | complete | `carry` | 0.00 | 0.0 | 6.6 | +0.234 |
| 139 | `pass:H8` | 0.96 | complete | `carry` | 0.00 | 0.0 | 6.7 | +0.232 |
