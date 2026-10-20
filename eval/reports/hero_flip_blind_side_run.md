# Hero flip — `blind_side_run`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H8` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 39/40 (98%) | ≥ 60% |
| Factual decision is `pass:H9` | 40/40 (100%) | — |
| … and the pass is completed | 40/40 | — |
| Mean ΔxT (factual − counterfactual) | +0.103 | — |

| Seed | Factual | P(pass:H9) | Outcome | Counterfactual | P(pass:H9) | Belief error H9 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H9` | 0.98 | complete | `pass:H7` | 0.00 | 0.1 | 12.8 | +0.092 |
| 101 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.4 | +0.105 |
| 102 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.4 | +0.095 |
| 103 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.7 | 12.6 | +0.102 |
| 104 | `pass:H9` | 1.00 | complete | `carry` | 0.00 | 0.5 | 13.3 | +0.095 |
| 105 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.0 | +0.093 |
| 106 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 14.1 | +0.127 |
| 107 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.1 | 12.0 | +0.100 |
| 108 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.1 | 13.0 | +0.093 |
| 109 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.4 | 12.5 | +0.108 |
| 110 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 12.6 | +0.095 |
| 111 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.4 | 13.7 | +0.100 |
| 112 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 12.3 | +0.129 |
| 113 | `pass:H9` | 0.97 | complete | `pass:H7` | 0.00 | 0.3 | 12.9 | +0.086 |
| 114 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.5 | 13.0 | +0.088 |
| 115 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.0 | 12.1 | +0.108 |
| 116 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.1 | 12.5 | +0.116 |
| 117 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 13.6 | +0.101 |
| 118 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.1 | 12.7 | +0.089 |
| 119 | `pass:H9` | 1.00 | complete | `pass:H9` | 0.00 | 0.1 | 13.4 | +0.117 |
| 120 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.3 | 12.0 | +0.123 |
| 121 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.1 | 13.1 | +0.091 |
| 122 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.2 | 12.0 | +0.124 |
| 123 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.3 | 12.0 | +0.117 |
| 124 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.2 | 12.5 | +0.127 |
| 125 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.1 | 13.2 | +0.094 |
| 126 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.1 | 12.3 | +0.118 |
| 127 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.3 | 13.3 | +0.098 |
| 128 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.1 | 12.4 | +0.097 |
| 129 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.4 | 13.0 | +0.088 |
| 130 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 11.8 | +0.095 |
| 131 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 13.1 | +0.093 |
| 132 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.3 | 14.0 | +0.088 |
| 133 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.3 | 12.2 | +0.099 |
| 134 | `pass:H9` | 0.98 | complete | `carry` | 0.00 | 0.7 | 13.6 | +0.111 |
| 135 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.1 | 11.7 | +0.116 |
| 136 | `pass:H9` | 1.00 | complete | `pass:H5` | 0.00 | 0.3 | 13.2 | +0.104 |
| 137 | `pass:H9` | 1.00 | complete | `pass:H3` | 0.00 | 0.5 | 13.4 | +0.093 |
| 138 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.5 | 12.9 | +0.093 |
| 139 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.2 | 11.8 | +0.098 |
