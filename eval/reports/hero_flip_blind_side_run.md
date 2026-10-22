# Hero flip — `blind_side_run`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H8` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 33/40 (82%) | ≥ 60% |
| Factual decision is `pass:H9` | 34/40 (85%) | — |
| … and the pass is completed | 33/34 | — |
| Mean ΔxT (factual − counterfactual) | +0.115 | — |

| Seed | Factual | P(pass:H9) | Outcome | Counterfactual | P(pass:H9) | Belief error H9 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H9` | 0.93 | complete | `pass:H7` | 0.00 | 0.8 | 10.8 | +0.124 |
| 101 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 11.8 | +0.151 |
| 102 | `pass:H9` | 0.97 | complete | `pass:H4` | 0.00 | 0.4 | 12.4 | +0.153 |
| 103 | `pass:H9` | 0.94 | complete | `pass:H4` | 0.00 | 0.5 | 11.8 | +0.142 |
| 104 | `carry` | 0.90 | carry | `carry` | 0.00 | 0.4 | 11.6 | +0.000 |
| 105 | `pass:H9` | 0.17 | complete | `pass:H4` | 0.00 | 0.4 | 12.8 | +0.125 |
| 106 | `pass:H4` | 0.02 | complete | `pass:H4` | 0.00 | 0.6 | 13.0 | +0.000 |
| 107 | `pass:H1` | 0.02 | complete | `pass:H1` | 0.00 | 0.2 | 11.8 | -0.000 |
| 108 | `pass:H9` | 0.85 | complete | `pass:H2` | 0.00 | 0.3 | 12.6 | +0.141 |
| 109 | `pass:H9` | 0.96 | complete | `pass:H1` | 0.00 | 0.4 | 10.2 | +0.156 |
| 110 | `pass:H4` | 0.86 | complete | `pass:H4` | 0.00 | 0.4 | 10.5 | +0.000 |
| 111 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.2 | 13.7 | +0.115 |
| 112 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.6 | 12.3 | +0.158 |
| 113 | `pass:H9` | 0.98 | complete | `pass:H7` | 0.00 | 0.3 | 12.5 | +0.107 |
| 114 | `pass:H9` | 0.99 | complete | `pass:H7` | 0.00 | 0.4 | 12.5 | +0.141 |
| 115 | `pass:H9` | 0.98 | complete | `pass:H7` | 0.00 | 0.2 | 12.3 | +0.144 |
| 116 | `pass:H9` | 0.97 | complete | `pass:H1` | 0.00 | 0.4 | 12.0 | +0.137 |
| 117 | `pass:H9` | 0.89 | complete | `pass:H4` | 0.00 | 0.4 | 10.0 | +0.142 |
| 118 | `pass:H4` | 0.19 | complete | `pass:H4` | 0.00 | 0.3 | 13.0 | +0.000 |
| 119 | `pass:H9` | 0.01 | complete | `pass:H9` | 0.00 | 0.6 | 12.7 | +0.166 |
| 120 | `pass:H9` | 0.88 | complete | `pass:H1` | 0.00 | 0.5 | 10.7 | +0.159 |
| 121 | `pass:H9` | 0.99 | complete | `pass:H2` | 0.00 | 0.4 | 11.5 | +0.153 |
| 122 | `pass:H4` | 0.59 | complete | `pass:H4` | 0.00 | 0.5 | 12.3 | +0.000 |
| 123 | `pass:H9` | 0.30 | intercepted | `pass:H4` | 0.00 | 0.7 | 12.3 | -0.005 |
| 124 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.4 | 12.6 | +0.160 |
| 125 | `pass:H9` | 0.94 | complete | `carry` | 0.00 | 0.3 | 12.7 | +0.122 |
| 126 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.3 | 12.6 | +0.154 |
| 127 | `pass:H9` | 0.90 | complete | `pass:H4` | 0.00 | 0.4 | 10.9 | +0.151 |
| 128 | `pass:H9` | 0.95 | complete | `pass:H1` | 0.00 | 0.3 | 10.9 | +0.134 |
| 129 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.3 | 12.6 | +0.136 |
| 130 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 12.6 | +0.113 |
| 131 | `pass:H9` | 0.94 | complete | `pass:H4` | 0.00 | 0.4 | 13.0 | +0.116 |
| 132 | `pass:H9` | 0.96 | complete | `pass:H7` | 0.00 | 0.4 | 12.6 | +0.122 |
| 133 | `pass:H9` | 0.48 | complete | `pass:H1` | 0.00 | 0.3 | 12.3 | +0.119 |
| 134 | `pass:H9` | 0.82 | complete | `carry` | 0.00 | 0.6 | 11.1 | +0.141 |
| 135 | `pass:H9` | 0.93 | complete | `carry` | 0.00 | 0.2 | 9.7 | +0.155 |
| 136 | `pass:H9` | 0.93 | complete | `pass:H5` | 0.00 | 0.5 | 13.2 | +0.151 |
| 137 | `pass:H9` | 0.93 | complete | `pass:H1` | 0.00 | 0.5 | 12.3 | +0.154 |
| 138 | `pass:H9` | 0.95 | complete | `carry` | 0.00 | 0.4 | 10.5 | +0.133 |
| 139 | `pass:H9` | 0.96 | complete | `pass:H2` | 0.00 | 0.3 | 11.9 | +0.138 |
