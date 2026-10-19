# Hero flip — `blind_side_run`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H8` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 39/40 (98%) | ≥ 60% |
| Factual decision is `pass:H9` | 40/40 (100%) | — |
| … and the pass is completed | 40/40 | — |
| Mean ΔxT (factual − counterfactual) | +0.085 | — |

| Seed | Factual | P(pass:H9) | Outcome | Counterfactual | P(pass:H9) | Belief error H9 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H9` | 0.98 | complete | `carry` | 0.00 | 0.2 | 12.8 | +0.077 |
| 101 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.2 | 13.4 | +0.088 |
| 102 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.3 | 13.4 | +0.081 |
| 103 | `pass:H9` | 0.97 | complete | `pass:H4` | 0.00 | 0.5 | 12.6 | +0.071 |
| 104 | `pass:H9` | 1.00 | complete | `carry` | 0.00 | 0.8 | 13.3 | +0.081 |
| 105 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.1 | 13.0 | +0.078 |
| 106 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.1 | 14.1 | +0.087 |
| 107 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.2 | 12.0 | +0.072 |
| 108 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.2 | 13.0 | +0.080 |
| 109 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.7 | 12.5 | +0.086 |
| 110 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.3 | 12.6 | +0.079 |
| 111 | `pass:H9` | 0.98 | complete | `pass:H1` | 0.00 | 0.8 | 13.7 | +0.065 |
| 112 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.8 | 12.3 | +0.107 |
| 113 | `pass:H9` | 0.96 | complete | `pass:H7` | 0.00 | 0.1 | 12.9 | +0.069 |
| 114 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.8 | 13.0 | +0.070 |
| 115 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.3 | 12.1 | +0.093 |
| 116 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.2 | 12.5 | +0.075 |
| 117 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.9 | 13.6 | +0.083 |
| 118 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.3 | 12.7 | +0.073 |
| 119 | `pass:H9` | 1.00 | complete | `pass:H9` | 0.00 | 0.3 | 13.4 | +0.138 |
| 120 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.01 | 0.1 | 8.7 | +0.090 |
| 121 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.3 | 13.1 | +0.087 |
| 122 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.4 | 12.0 | +0.100 |
| 123 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.6 | 12.0 | +0.089 |
| 124 | `pass:H9` | 1.00 | complete | `pass:H10` | 0.00 | 0.7 | 12.5 | +0.142 |
| 125 | `pass:H9` | 0.98 | complete | `carry` | 0.00 | 0.3 | 13.2 | +0.085 |
| 126 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 12.3 | +0.095 |
| 127 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.2 | 13.3 | +0.095 |
| 128 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.3 | 12.4 | +0.077 |
| 129 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.3 | 13.0 | +0.068 |
| 130 | `pass:H9` | 0.97 | complete | `pass:H4` | 0.02 | 0.2 | 10.1 | +0.070 |
| 131 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.0 | 13.1 | +0.074 |
| 132 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.01 | 0.0 | 11.9 | +0.078 |
| 133 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.7 | 12.2 | +0.093 |
| 134 | `pass:H9` | 0.98 | complete | `carry` | 0.00 | 0.8 | 13.6 | +0.082 |
| 135 | `pass:H9` | 0.98 | complete | `carry` | 0.00 | 0.4 | 11.7 | +0.085 |
| 136 | `pass:H9` | 1.00 | complete | `pass:H5` | 0.00 | 0.5 | 13.2 | +0.095 |
| 137 | `pass:H9` | 1.00 | complete | `pass:H3` | 0.00 | 0.1 | 13.4 | +0.081 |
| 138 | `pass:H9` | 0.98 | complete | `carry` | 0.01 | 0.2 | 10.4 | +0.083 |
| 139 | `pass:H9` | 0.99 | complete | `pass:H2` | 0.00 | 0.5 | 11.8 | +0.082 |
