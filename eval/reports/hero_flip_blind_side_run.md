# Hero flip — `blind_side_run`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H8` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 33/40 (82%) | ≥ 60% |
| Factual decision is `pass:H9` | 34/40 (85%) | — |
| … and the pass is completed | 33/34 | — |
| Mean ΔxT (factual − counterfactual) | +0.121 | — |

| Seed | Factual | P(pass:H9) | Outcome | Counterfactual | P(pass:H9) | Belief error H9 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H9` | 0.94 | complete | `pass:H7` | 0.00 | 0.8 | 10.8 | +0.130 |
| 101 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 11.8 | +0.164 |
| 102 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.4 | 12.4 | +0.144 |
| 103 | `pass:H9` | 0.94 | complete | `pass:H4` | 0.00 | 0.5 | 11.8 | +0.152 |
| 104 | `carry` | 0.95 | carry | `carry` | 0.00 | 0.4 | 11.6 | +0.000 |
| 105 | `pass:H9` | 0.28 | complete | `pass:H4` | 0.00 | 0.4 | 12.8 | +0.131 |
| 106 | `pass:H4` | 0.02 | complete | `pass:H4` | 0.00 | 0.6 | 13.0 | +0.000 |
| 107 | `pass:H1` | 0.02 | complete | `pass:H1` | 0.00 | 0.2 | 11.8 | -0.000 |
| 108 | `pass:H9` | 0.88 | complete | `pass:H2` | 0.00 | 0.3 | 12.6 | +0.151 |
| 109 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.4 | 10.2 | +0.169 |
| 110 | `pass:H4` | 0.93 | complete | `pass:H4` | 0.00 | 0.4 | 10.5 | +0.000 |
| 111 | `pass:H9` | 0.99 | complete | `pass:H1` | 0.00 | 0.2 | 13.7 | +0.118 |
| 112 | `pass:H9` | 1.00 | complete | `pass:H4` | 0.00 | 0.6 | 12.3 | +0.173 |
| 113 | `pass:H9` | 0.98 | complete | `pass:H7` | 0.00 | 0.3 | 12.5 | +0.110 |
| 114 | `pass:H9` | 0.99 | complete | `pass:H7` | 0.00 | 0.4 | 12.5 | +0.154 |
| 115 | `pass:H9` | 0.99 | complete | `pass:H7` | 0.00 | 0.2 | 12.3 | +0.157 |
| 116 | `pass:H9` | 0.97 | complete | `pass:H1` | 0.00 | 0.4 | 12.0 | +0.145 |
| 117 | `pass:H9` | 0.92 | complete | `pass:H4` | 0.00 | 0.4 | 10.0 | +0.150 |
| 118 | `pass:H4` | 0.26 | complete | `pass:H4` | 0.00 | 0.3 | 13.0 | +0.000 |
| 119 | `pass:H9` | 0.01 | complete | `pass:H9` | 0.00 | 0.6 | 12.7 | +0.158 |
| 120 | `pass:H1` | 0.79 | complete | `pass:H1` | 0.00 | 0.5 | 10.7 | +0.000 |
| 121 | `pass:H9` | 0.99 | complete | `pass:H2` | 0.00 | 0.4 | 11.5 | +0.165 |
| 122 | `pass:H9` | 0.87 | complete | `pass:H4` | 0.00 | 0.5 | 12.3 | +0.146 |
| 123 | `pass:H9` | 0.30 | intercepted | `pass:H4` | 0.00 | 0.7 | 12.3 | -0.005 |
| 124 | `pass:H9` | 1.00 | complete | `pass:H2` | 0.00 | 0.4 | 12.6 | +0.175 |
| 125 | `pass:H9` | 0.95 | complete | `carry` | 0.00 | 0.3 | 12.7 | +0.125 |
| 126 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.3 | 12.6 | +0.169 |
| 127 | `pass:H9` | 0.92 | complete | `pass:H4` | 0.00 | 0.4 | 10.9 | +0.163 |
| 128 | `pass:H9` | 0.96 | complete | `pass:H1` | 0.00 | 0.3 | 10.9 | +0.140 |
| 129 | `pass:H9` | 0.98 | complete | `pass:H4` | 0.00 | 0.3 | 12.6 | +0.145 |
| 130 | `pass:H9` | 0.99 | complete | `pass:H4` | 0.00 | 0.4 | 12.6 | +0.116 |
| 131 | `pass:H9` | 0.95 | complete | `pass:H4` | 0.00 | 0.4 | 13.0 | +0.120 |
| 132 | `pass:H9` | 0.96 | complete | `pass:H7` | 0.00 | 0.4 | 12.6 | +0.129 |
| 133 | `pass:H9` | 0.72 | complete | `pass:H1` | 0.00 | 0.3 | 12.3 | +0.123 |
| 134 | `pass:H9` | 0.83 | complete | `carry` | 0.00 | 0.6 | 11.1 | +0.122 |
| 135 | `pass:H9` | 0.93 | complete | `carry` | 0.00 | 0.2 | 9.7 | +0.166 |
| 136 | `pass:H9` | 0.94 | complete | `pass:H5` | 0.00 | 0.5 | 13.2 | +0.164 |
| 137 | `pass:H9` | 0.91 | complete | `pass:H3` | 0.00 | 0.5 | 12.3 | +0.168 |
| 138 | `pass:H9` | 0.97 | complete | `carry` | 0.00 | 0.4 | 10.5 | +0.138 |
| 139 | `pass:H9` | 0.98 | complete | `pass:H2` | 0.00 | 0.3 | 11.9 | +0.146 |
