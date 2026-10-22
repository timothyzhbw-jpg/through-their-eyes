# Hero flip — `keeper_switch`

Seeds 100–139 (40). Counterfactual: drop the key scan of `H1` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 26/40 (65%) | ≥ 60% |
| Factual decision is `pass:H3` | 32/40 (80%) | — |
| … and the pass is completed | 32/32 | — |
| Mean ΔxT (factual − counterfactual) | +0.034 | — |

| Seed | Factual | P(pass:H3) | Outcome | Counterfactual | P(pass:H3) | Belief error H3 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 100 | `pass:H3` | 0.86 | complete | `pass:H10` | 0.10 | 0.5 | 9.9 | +0.019 |
| 101 | `pass:H6` | 0.84 | complete | `pass:H6` | 0.08 | 0.8 | 10.0 | +0.000 |
| 102 | `pass:H3` | 0.86 | complete | `pass:H3` | 0.10 | 0.8 | 9.4 | +0.013 |
| 103 | `pass:H3` | 0.86 | complete | `pass:H3` | 0.10 | 0.4 | 9.5 | +0.013 |
| 104 | `pass:H3` | 0.84 | complete | `pass:H3` | 0.09 | 0.4 | 9.4 | +0.013 |
| 105 | `pass:H2` | 0.85 | complete | `pass:H2` | 0.10 | 0.6 | 9.8 | +0.000 |
| 106 | `pass:H3` | 0.85 | complete | `pass:H3` | 0.10 | 0.5 | 10.1 | +0.013 |
| 107 | `pass:H3` | 0.86 | complete | `pass:H9` | 0.11 | 0.9 | 9.8 | +0.008 |
| 108 | `pass:H6` | 0.86 | complete | `pass:H6` | 0.10 | 0.2 | 10.0 | +0.000 |
| 109 | `pass:H10` | 0.86 | intercepted | `pass:H10` | 0.09 | 0.5 | 9.6 | +0.000 |
| 110 | `pass:H3` | 0.86 | complete | `pass:H8` | 0.11 | 0.4 | 9.7 | +0.020 |
| 111 | `pass:H3` | 0.85 | complete | `pass:H8` | 0.10 | 0.4 | 9.5 | +0.021 |
| 112 | `pass:H3` | 0.86 | complete | `pass:H8` | 0.10 | 0.8 | 9.7 | +0.020 |
| 113 | `pass:H3` | 0.86 | complete | `pass:H3` | 0.09 | 0.5 | 9.7 | +0.013 |
| 114 | `pass:H3` | 0.86 | complete | `pass:H10` | 0.10 | 0.7 | 9.7 | +0.017 |
| 115 | `pass:H3` | 0.86 | complete | `pass:H2` | 0.09 | 0.8 | 9.6 | +0.131 |
| 116 | `pass:H3` | 0.86 | complete | `pass:H3` | 0.10 | 0.7 | 10.0 | +0.013 |
| 117 | `pass:H3` | 0.85 | complete | `pass:H2` | 0.09 | 0.6 | 10.2 | -0.000 |
| 118 | `pass:H3` | 0.86 | complete | `pass:H8` | 0.09 | 0.9 | 9.7 | +0.019 |
| 119 | `pass:H3` | 0.86 | complete | `pass:H8` | 0.10 | 1.0 | 9.4 | +0.019 |
| 120 | `pass:H3` | 0.85 | complete | `pass:H8` | 0.09 | 0.4 | 9.7 | +0.020 |
| 121 | `pass:H3` | 0.86 | complete | `pass:H2` | 0.10 | 0.6 | 10.2 | -0.000 |
| 122 | `pass:H3` | 0.86 | complete | `pass:H2` | 0.09 | 1.2 | 9.6 | +0.131 |
| 123 | `pass:H6` | 0.85 | complete | `pass:H6` | 0.10 | 0.7 | 9.6 | +0.000 |
| 124 | `pass:H8` | 0.84 | intercepted | `pass:H8` | 0.09 | 0.9 | 9.7 | +0.000 |
| 125 | `pass:H3` | 0.86 | complete | `pass:H2` | 0.10 | 0.4 | 9.9 | +0.141 |
| 126 | `pass:H9` | 0.85 | intercepted | `pass:H9` | 0.09 | 0.1 | 9.7 | +0.000 |
| 127 | `pass:H3` | 0.86 | complete | `pass:H7` | 0.11 | 1.1 | 9.5 | +0.151 |
| 128 | `pass:H3` | 0.75 | complete | `pass:H8` | 0.09 | 0.4 | 10.0 | +0.020 |
| 129 | `pass:H3` | 0.86 | complete | `pass:H9` | 0.10 | 0.4 | 9.8 | +0.008 |
| 130 | `pass:H3` | 0.86 | complete | `pass:H8` | 0.09 | 0.1 | 9.7 | +0.021 |
| 131 | `pass:H3` | 0.85 | complete | `pass:H10` | 0.09 | 0.5 | 9.8 | +0.019 |
| 132 | `pass:H7` | 0.86 | intercepted | `pass:H7` | 0.10 | 0.5 | 9.6 | +0.000 |
| 133 | `pass:H3` | 0.85 | complete | `pass:H7` | 0.10 | 0.2 | 9.9 | +0.144 |
| 134 | `pass:H3` | 0.86 | complete | `pass:H10` | 0.09 | 0.7 | 9.6 | +0.019 |
| 135 | `pass:H3` | 0.86 | complete | `pass:H8` | 0.10 | 0.7 | 9.9 | +0.021 |
| 136 | `pass:H3` | 0.86 | complete | `pass:H9` | 0.10 | 0.7 | 10.3 | +0.008 |
| 137 | `pass:H3` | 0.86 | complete | `pass:H7` | 0.09 | 0.2 | 9.6 | +0.146 |
| 138 | `pass:H3` | 0.86 | complete | `pass:H10` | 0.10 | 0.4 | 9.9 | +0.019 |
| 139 | `pass:H3` | 0.85 | complete | `pass:H7` | 0.10 | 0.4 | 9.4 | +0.150 |
