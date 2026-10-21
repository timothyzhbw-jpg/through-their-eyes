# Hero flip — `blind_side_run`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H8` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 39/40 (98%) | ≥ 60% |
| Factual decision is `pass:H9` | 40/40 (100%) | — |
| … and the pass is completed | 40/40 | — |
| Mean ΔxT (factual − counterfactual) | +0.109 | — |

| Seed | Factual | P(pass:H9) | Outcome | Counterfactual | P(pass:H9) | Belief error H9 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H9` | 0.96 | complete | `pass:H7` | 0.00 | 0.1 | 12.8 | +0.099 |
| 101 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.4 | +0.112 |
| 102 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.4 | +0.102 |
| 103 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.7 | 12.6 | +0.107 |
| 104 | `pass:H9` | 1.00 | complete | `carry` | 0.00 | 0.5 | 13.3 | +0.107 |
| 105 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 13.0 | +0.100 |
| 106 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 14.1 | +0.132 |
| 107 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.1 | 12.0 | +0.107 |
| 108 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.1 | 13.0 | +0.099 |
| 109 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.4 | 12.5 | +0.113 |
| 110 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.5 | 12.6 | +0.102 |
| 111 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.4 | 13.7 | +0.105 |
| 112 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 12.3 | +0.133 |
| 113 | `pass:H9` | 0.97 | complete | `pass:H7` | 0.00 | 0.3 | 12.9 | +0.091 |
| 114 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.5 | 13.0 | +0.094 |
| 115 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.0 | 12.1 | +0.115 |
| 116 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.1 | 12.5 | +0.122 |
| 117 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 13.6 | +0.108 |
| 118 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.1 | 12.7 | +0.095 |
| 119 | `pass:H9` | 1.00 | complete | `pass:H9` | 0.00 | 0.1 | 13.4 | +0.121 |
| 120 | `pass:H9` | 1.00 | complete | `pass:H1` | 0.00 | 0.3 | 12.0 | +0.128 |
| 121 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.1 | 13.1 | +0.097 |
| 122 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.2 | 12.0 | +0.129 |
| 123 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.3 | 12.0 | +0.122 |
| 124 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.2 | 12.5 | +0.131 |
| 125 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.1 | 13.2 | +0.105 |
| 126 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.1 | 12.3 | +0.123 |
| 127 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.3 | 13.3 | +0.105 |
| 128 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.1 | 12.4 | +0.104 |
| 129 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.4 | 13.0 | +0.093 |
| 130 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 11.8 | +0.101 |
| 131 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 13.1 | +0.099 |
| 132 | `pass:H9` | 1.00 | complete | `pass:H7` | 0.00 | 0.3 | 14.0 | +0.095 |
| 133 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.3 | 12.2 | +0.107 |
| 134 | `pass:H9` | 0.98 | complete | `carry` | 0.00 | 0.7 | 13.6 | +0.118 |
| 135 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.1 | 11.7 | +0.124 |
| 136 | `pass:H9` | 1.00 | complete | `pass:H5` | 0.00 | 0.3 | 13.2 | +0.111 |
| 137 | `pass:H9` | 1.00 | complete | `pass:H3` | 0.00 | 0.5 | 13.4 | +0.100 |
| 138 | `pass:H9` | 0.99 | complete | `carry` | 0.00 | 0.5 | 12.9 | +0.103 |
| 139 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.2 | 11.8 | +0.105 |
