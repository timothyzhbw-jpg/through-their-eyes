# Hero flip — `blind_side_run`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H8` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 39/40 (98%) | ≥ 60% |
| Factual decision is `pass:H9` | 40/40 (100%) | — |
| … and the pass is completed | 40/40 | — |
| Mean ΔxT (factual − counterfactual) | +0.083 | — |

| Seed | Factual | P(pass:H9) | Outcome | Counterfactual | P(pass:H9) | Belief error H9 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H9` | 0.98 | complete | `pass:H7` | 0.00 | 0.1 | 12.8 | +0.076 |
| 101 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.4 | +0.086 |
| 102 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.4 | +0.078 |
| 103 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.7 | 12.6 | +0.071 |
| 104 | `pass:H9` | 1.00 | complete | `carry` | 0.00 | 0.5 | 13.3 | +0.085 |
| 105 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.0 | +0.072 |
| 106 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 14.1 | +0.096 |
| 107 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.1 | 12.0 | +0.079 |
| 108 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.1 | 13.0 | +0.077 |
| 109 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.4 | 12.5 | +0.081 |
| 110 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 12.6 | +0.075 |
| 111 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.4 | 13.7 | +0.069 |
| 112 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 12.3 | +0.105 |
| 113 | `pass:H9` | 0.97 | complete | `pass:H7` | 0.00 | 0.3 | 12.9 | +0.065 |
| 114 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.5 | 13.0 | +0.064 |
| 115 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.0 | 12.1 | +0.089 |
| 116 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.1 | 12.5 | +0.090 |
| 117 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 13.6 | +0.084 |
| 118 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.1 | 12.7 | +0.070 |
| 119 | `pass:H9` | 1.00 | complete | `pass:H9` | 0.00 | 0.1 | 13.4 | +0.135 |
| 120 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.3 | 12.0 | +0.089 |
| 121 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.1 | 13.1 | +0.082 |
| 122 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.2 | 12.0 | +0.096 |
| 123 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.3 | 12.0 | +0.085 |
| 124 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.2 | 12.5 | +0.099 |
| 125 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.1 | 13.2 | +0.082 |
| 126 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.1 | 12.3 | +0.088 |
| 127 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.3 | 13.3 | +0.090 |
| 128 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.1 | 12.4 | +0.084 |
| 129 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.4 | 13.0 | +0.068 |
| 130 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 11.8 | +0.067 |
| 131 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 13.1 | +0.070 |
| 132 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.3 | 14.0 | +0.074 |
| 133 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.3 | 12.2 | +0.087 |
| 134 | `pass:H9` | 0.98 | complete | `carry` | 0.00 | 0.7 | 13.6 | +0.082 |
| 135 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.1 | 11.7 | +0.091 |
| 136 | `pass:H9` | 1.00 | complete | `pass:H5` | 0.00 | 0.3 | 13.2 | +0.093 |
| 137 | `pass:H9` | 1.00 | complete | `pass:H3` | 0.00 | 0.5 | 13.4 | +0.077 |
| 138 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.5 | 12.9 | +0.078 |
| 139 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.2 | 11.8 | +0.078 |
