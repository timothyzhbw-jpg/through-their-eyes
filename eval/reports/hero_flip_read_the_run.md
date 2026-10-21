# Hero flip — `read_the_run`

Seeds 200–239 (40). Counterfactual: drop the key scan of `H5` and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).

| Metric | Value | Target (SPEC) |
|---|---|---|
| Decision changed without the key scan | 28/40 (70%) | ≥ 60% |
| Factual decision is `cut:A9` | 34/40 (85%) | — |
| … and he wins the ball | 21/34 | — |
| Mean ΔxT (factual − counterfactual) | +0.078 | — |

| Seed | Factual | P(cut:A9) | Outcome | Counterfactual | P(cut:A9) | Belief error A9 F (m) | CF (m) | ΔxT |
|---|---|---|---|---|---|---|---|---|
| 200 | `cut:A9` | 0.90 | won | `hold` | 0.12 | 0.0 | 10.9 | +0.000 |
| 201 | `hold` | 0.53 | complete (A9) | `hold` | 0.12 | 0.1 | 8.9 | +0.000 |
| 202 | `cut:A9` | 0.90 | won | `cut:A9` | 0.12 | 0.0 | 11.5 | +0.192 |
| 203 | `cut:A9` | 0.97 | complete (A9) | `hold` | 0.12 | 0.0 | 10.5 | +0.000 |
| 204 | `cut:A9` | 0.96 | won | `hold` | 0.12 | 0.0 | 11.5 | +0.202 |
| 205 | `hold` | 0.67 | complete (A9) | `hold` | 0.12 | 0.1 | 9.9 | +0.000 |
| 206 | `cut:A9` | 0.89 | complete (A9) | `hold` | 0.12 | 0.1 | 9.6 | +0.000 |
| 207 | `cut:A9` | 0.96 | complete (A9) | `hold` | 0.12 | 0.0 | 9.9 | +0.000 |
| 208 | `cut:A9` | 0.92 | won | `hold` | 0.12 | 0.0 | 9.6 | +0.208 |
| 209 | `cut:A9` | 0.93 | complete (A9) | `cut:A9` | 0.12 | 0.0 | 9.3 | +0.000 |
| 210 | `cut:A9` | 0.67 | won | `hold` | 0.12 | 0.2 | 9.3 | +0.000 |
| 211 | `hold` | 0.87 | complete (A9) | `hold` | 0.12 | 0.0 | 10.5 | +0.000 |
| 212 | `cut:A9` | 0.83 | complete (A9) | `hold` | 0.12 | 0.0 | 10.9 | +0.000 |
| 213 | `hold` | 0.86 | complete (A9) | `hold` | 0.12 | 0.1 | 9.9 | +0.000 |
| 214 | `cut:A9` | 0.92 | won | `hold` | 0.12 | 0.1 | 10.2 | +0.186 |
| 215 | `cut:A9` | 0.91 | won | `hold` | 0.12 | 0.0 | 10.9 | +0.188 |
| 216 | `cut:A9` | 0.88 | won | `cut:A9` | 0.12 | 0.1 | 9.9 | +0.000 |
| 217 | `cut:A9` | 0.93 | won | `hold` | 0.12 | 0.0 | 9.6 | +0.000 |
| 218 | `cut:A9` | 0.95 | won | `hold` | 0.12 | 0.0 | 10.5 | +0.195 |
| 219 | `cut:A9` | 0.91 | complete (A9) | `cut:A9` | 0.12 | 0.0 | 11.2 | +0.000 |
| 220 | `cut:A9` | 0.87 | complete (A9) | `cut:A9` | 0.12 | 0.0 | 11.2 | +0.000 |
| 221 | `cut:A9` | 0.91 | won | `cut:A9` | 0.12 | 0.0 | 11.5 | +0.198 |
| 222 | `cut:A9` | 0.97 | complete (A9) | `hold` | 0.12 | 0.0 | 11.5 | +0.000 |
| 223 | `cut:A9` | 0.92 | complete (A9) | `hold` | 0.12 | 0.2 | 10.2 | +0.000 |
| 224 | `cut:A9` | 0.95 | won | `hold` | 0.12 | 0.0 | 10.5 | +0.216 |
| 225 | `cut:A9` | 0.92 | won | `hold` | 0.12 | 0.0 | 10.9 | +0.209 |
| 226 | `cut:A9` | 0.88 | won | `hold` | 0.12 | 0.0 | 10.9 | +0.190 |
| 227 | `cut:A9` | 0.96 | complete (A9) | `hold` | 0.12 | 0.2 | 9.6 | +0.000 |
| 228 | `cut:A9` | 0.86 | won | `hold` | 0.12 | 0.0 | 11.2 | +0.177 |
| 229 | `cut:A9` | 0.91 | won | `hold` | 0.12 | 0.0 | 10.5 | +0.200 |
| 230 | `hold` | 0.00 | complete (A9) | `hold` | 0.12 | 0.0 | 11.2 | +0.000 |
| 231 | `cut:A9` | 0.96 | complete (A9) | `hold` | 0.12 | 0.0 | 11.8 | +0.000 |
| 232 | `cut:A9` | 0.92 | complete (A9) | `hold` | 0.12 | 0.0 | 9.9 | +0.000 |
| 233 | `cut:A9` | 0.86 | won | `hold` | 0.12 | 0.1 | 9.3 | +0.211 |
| 234 | `cut:A9` | 0.96 | complete (A9) | `hold` | 0.12 | 0.0 | 11.5 | +0.000 |
| 235 | `cut:A9` | 0.95 | won | `hold` | 0.12 | 0.0 | 9.9 | +0.000 |
| 236 | `cut:A9` | 0.87 | won | `hold` | 0.12 | 0.1 | 9.6 | +0.183 |
| 237 | `hold` | 0.87 | complete (A9) | `hold` | 0.12 | 0.0 | 9.6 | +0.000 |
| 238 | `cut:A9` | 0.83 | won | `hold` | 0.12 | 0.0 | 9.3 | +0.166 |
| 239 | `cut:A9` | 0.44 | won | `hold` | 0.12 | 0.1 | 9.6 | +0.187 |
