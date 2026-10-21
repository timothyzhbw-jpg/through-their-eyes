# Hero lens — `screened_shot`

Seeds 300–339 (40). `H1` has no decision on the ball: his moment is his step for a sightline before the shot (`keeper_step`, `explain.moments`). Intended lens `sight`; intervention `drop_step`, re-simulated from the step (keyed randomness). The `sight` lens's Δ is P(save) with the step minus without it (the save model, Module A); the scan, space and pressure lenses do not apply. A shot blocked before the save model has no Δ.

| Metric | Value | Target |
|---|---|---|
| Hero's step detected as a `keeper_step` moment | 40/40 (100%) | ≥ 95% |
| `sight` lens selected | 35/40 (88%) | ≥ 60% |
| Sight lens Δ > 0 | 32/40 (80%) | ≥ 60% |
| … Δ ≥ 0.4 (the hero gate of `eval/hero_save.py`) | 28/40 (70%) | — |
| … shots blocked before the save model (no Δ) | 5/40 | — |
| Realised save → goal without the step | 17/40 (42%) | — |
| Median sight lens Δ | +0.676 | — |

| Seed | Selected | Δsight | P(save) with / without | Outcome with / without |
|---|---|---|---|---|
| 300 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 301 | sight | +0.5359 | 0.536 / 0.000 | wide / wide |
| 302 | sight | +0.6905 | 0.700 / 0.009 | saved / goal |
| 303 | sight | +0.6174 | 0.700 / 0.083 | saved / goal |
| 304 | sight | +0.0000 | 0.000 / 0.000 | wide / wide |
| 305 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 306 | sight | +0.0000 | 0.000 / 0.000 | wide / wide |
| 307 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 308 | sight | +0.5922 | 0.592 / 0.000 | wide / wide |
| 309 | — | — | — | — |
| 310 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 311 | sight | +0.6661 | 0.666 / 0.000 | goal / goal |
| 312 | — | — | — | — |
| 313 | sight | +0.6716 | 0.672 / 0.000 | saved / goal |
| 314 | sight | +0.6759 | 0.676 / 0.000 | goal / goal |
| 315 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 316 | — | — | — | — |
| 317 | sight | +0.4568 | 0.457 / 0.000 | wide / wide |
| 318 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 319 | sight | +0.6863 | 0.700 / 0.014 | goal / goal |
| 320 | — | — | — | — |
| 321 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 322 | sight | +0.7000 | 0.700 / 0.000 | goal / goal |
| 323 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 324 | sight | +0.2153 | 0.215 / 0.000 | wide / wide |
| 325 | sight | +0.5797 | 0.580 / 0.000 | saved / goal |
| 326 | sight | +0.6698 | 0.700 / 0.030 | saved / goal |
| 327 | sight | +0.4780 | 0.478 / 0.000 | wide / wide |
| 328 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 329 | — | — | — | — |
| 330 | sight | +0.7000 | 0.700 / 0.000 | goal / goal |
| 331 | sight | +0.4745 | 0.474 / 0.000 | wide / wide |
| 332 | sight | +0.0000 | 0.000 / 0.000 | wide / wide |
| 333 | sight | +0.3263 | 0.326 / 0.000 | wide / wide |
| 334 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
| 335 | sight | +0.3974 | 0.397 / 0.000 | wide / wide |
| 336 | sight | +0.1638 | 0.164 / 0.000 | wide / wide |
| 337 | sight | +0.6927 | 0.693 / 0.000 | saved / goal |
| 338 | sight | +0.7000 | 0.700 / 0.000 | goal / goal |
| 339 | sight | +0.7000 | 0.700 / 0.000 | saved / goal |
