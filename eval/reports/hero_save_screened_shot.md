# Save hero — `screened_shot`

Seeds 300–339 (40). Factual run: `H1` makes the key step. Counterfactual: drop that step and re-simulate from its start. The third run keeps the step but forces first sight (`SightAt`) to the frame the no-step run first saw the ball. Default keeper reach speed: 3 m/s.

P_save is the shot event's `p_save`. delta_sight is P(step) minus P(step, late sight). delta_position is P(step, late sight) minus P(no step). A missing `p_save` (the shot was blocked before the save model ran) fails the gates that need it. Delay is the time from the strike to first sight.

| Metric | Value | Target |
|---|---|---|
| Without the step, first sight ≥ 0.25 s later | 35/40 (88%) | ≥ 90% |
| P_save(step) − P_save(no step) ≥ 0.4 | 28/40 (70%) | ≥ 60% |
| delta_sight > delta_position | 30/40 (75%) | ≥ 80% |
| Realised save to goal when the step is removed | 17/40 (42%) | reported |
| P_save gap ≥ 0.4, v_dive = 2.5 m/s | 28/40 (70%) | ≥ 60% |
| P_save gap ≥ 0.4, v_dive = 4 m/s | 29/40 (72%) | ≥ 60% |
| Shots blocked before the save model (no `p_save`) | 5/40 | reported |
| … first sight ≥ 0.25 s later, shots not blocked | 35/35 | reported |
| … delta_sight > delta_position, shots not blocked and not both 0 | 30/32 | reported |
| … P_save gap ≥ 0.4, shots on target with the step (saved or goal) | 23/23 | reported |
| … P_save gap ≥ 0.4, shots wide with the step | 5/28 of the gate's passes | reported |

The rows marked … are reported only. A blocked shot fails every gate that needs `p_save`. A wide shot still has a `p_save`: the save model at the point where it crosses the goal line, outside the posts. So it counts in the hard gate as the keeper's reach, even though no save was needed. delta_sight and delta_position are both 0 when the shot is beyond the keeper's reach with or without the step; that tie fails the decomposition.

The sweep re-simulates the step and the dropped step only, then restores the default keeper. It does not re-run the late-sight decomposition.

| Seed | Delay step (s) | Delay no step (s) | P_save step | P_save no step | P_save step+late | Δsight | Δposition | Outcome step | Outcome no step | Outcome late | ≥0.25 s later | Gap ≥ 0.4 | Sight > position | Save→goal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 300 | 0.000 | 0.520 | 0.700 | 0.000 | 0.047 | 0.653 | 0.047 | saved | goal | goal | yes | yes | yes | yes |
| 301 | 0.000 | 0.480 | 0.536 | 0.000 | 0.000 | 0.536 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 302 | 0.000 | 0.640 | 0.700 | 0.009 | 0.372 | 0.328 | 0.362 | saved | goal | saved | yes | yes | no | yes |
| 303 | 0.000 | 0.600 | 0.700 | 0.083 | 0.424 | 0.276 | 0.342 | saved | goal | goal | yes | yes | no | yes |
| 304 | 0.000 | 0.520 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 305 | 0.000 | 0.600 | 0.700 | 0.000 | 0.000 | 0.700 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 306 | 0.000 | 0.520 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 307 | 0.000 | 0.600 | 0.700 | 0.000 | 0.092 | 0.608 | 0.092 | saved | goal | goal | yes | yes | yes | yes |
| 308 | 0.000 | 0.560 | 0.592 | 0.000 | 0.000 | 0.592 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 309 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 310 | 0.000 | 0.600 | 0.700 | 0.000 | 0.324 | 0.376 | 0.324 | saved | goal | saved | yes | yes | yes | yes |
| 311 | 0.000 | 0.520 | 0.666 | 0.000 | 0.000 | 0.666 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 312 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 313 | 0.000 | 0.520 | 0.672 | 0.000 | 0.000 | 0.672 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 314 | 0.000 | 0.480 | 0.676 | 0.000 | 0.000 | 0.676 | 0.000 | goal | goal | goal | yes | yes | yes | no |
| 315 | 0.000 | 0.520 | 0.700 | 0.000 | 0.257 | 0.443 | 0.257 | saved | goal | goal | yes | yes | yes | yes |
| 316 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 317 | 0.000 | 0.520 | 0.457 | 0.000 | 0.000 | 0.457 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 318 | 0.000 | 0.600 | 0.700 | 0.000 | 0.101 | 0.599 | 0.101 | saved | goal | goal | yes | yes | yes | yes |
| 319 | 0.000 | 0.520 | 0.700 | 0.014 | 0.347 | 0.353 | 0.334 | goal | goal | goal | yes | yes | yes | no |
| 320 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 321 | 0.000 | 0.600 | 0.700 | 0.000 | 0.142 | 0.558 | 0.142 | saved | goal | goal | yes | yes | yes | yes |
| 322 | 0.000 | 0.600 | 0.700 | 0.000 | 0.178 | 0.522 | 0.178 | goal | goal | goal | yes | yes | yes | no |
| 323 | 0.000 | 0.520 | 0.700 | 0.000 | 0.215 | 0.485 | 0.215 | saved | goal | goal | yes | yes | yes | yes |
| 324 | 0.000 | 0.560 | 0.215 | 0.000 | 0.000 | 0.215 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 325 | 0.000 | 0.560 | 0.580 | 0.000 | 0.000 | 0.580 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 326 | 0.000 | 0.520 | 0.700 | 0.030 | 0.363 | 0.337 | 0.333 | saved | goal | goal | yes | yes | yes | yes |
| 327 | 0.000 | 0.560 | 0.478 | 0.000 | 0.000 | 0.478 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 328 | 0.000 | 0.600 | 0.700 | 0.000 | 0.126 | 0.574 | 0.126 | saved | goal | goal | yes | yes | yes | yes |
| 329 | never | never | — | — | — | — | — | blocked | blocked | blocked | no | no | no | no |
| 330 | 0.000 | 0.480 | 0.700 | 0.000 | 0.040 | 0.660 | 0.040 | goal | goal | goal | yes | yes | yes | no |
| 331 | 0.000 | 0.520 | 0.474 | 0.000 | 0.000 | 0.474 | 0.000 | wide | wide | wide | yes | yes | yes | no |
| 332 | 0.000 | 0.480 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | wide | wide | wide | yes | no | no | no |
| 333 | 0.000 | 0.520 | 0.326 | 0.000 | 0.000 | 0.326 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 334 | 0.000 | 0.640 | 0.700 | 0.000 | 0.289 | 0.411 | 0.289 | saved | goal | saved | yes | yes | yes | yes |
| 335 | 0.000 | 0.440 | 0.397 | 0.000 | 0.000 | 0.397 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 336 | 0.000 | 0.480 | 0.164 | 0.000 | 0.000 | 0.164 | 0.000 | wide | wide | wide | yes | no | yes | no |
| 337 | 0.000 | 0.560 | 0.693 | 0.000 | 0.000 | 0.693 | 0.000 | saved | goal | goal | yes | yes | yes | yes |
| 338 | 0.000 | 0.600 | 0.700 | 0.000 | 0.230 | 0.470 | 0.230 | goal | goal | goal | yes | yes | yes | no |
| 339 | 0.000 | 0.560 | 0.700 | 0.000 | 0.181 | 0.519 | 0.181 | saved | goal | goal | yes | yes | yes | yes |
