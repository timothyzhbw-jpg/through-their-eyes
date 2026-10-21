# Pass difficulty: does it separate failed passes from completed ones?

`uv run python -m eval.pass_difficulty --seeds 300-399` — `possession_play`, 100 seeds, up to 45 s each.

The formula (SPEC 4.6) was fixed before this run and is not tuned on it:
`difficulty = 0.4·lane + 0.2·passer + 0.2·receiver + 0.2·min(d / 50 m, 1)`.

## Result

- Passes: 1439 resolved, 309 failed (intercepted or out), 1130 completed.
- **AUC 0.737** (95% bootstrap interval 0.712–0.763, 2000 resamples of passes): **supported** (criterion set before the run: lower bound above 0.5).
- Mean difficulty: failed 0.484, completed 0.320.

## Each part alone

| Part | Weight | AUC | Mean, failed | Mean, completed |
|---|---:|---:|---:|---:|
| lane | 0.4 | 0.808 | 0.771 | 0.326 |
| passer | 0.2 | 0.603 | 0.446 | 0.324 |
| receiver | 0.2 | 0.516 | 0.167 | 0.194 |
| distance | 0.2 | 0.257 | 0.269 | 0.429 |

## Completion by band

| Band | Passes | Completed | Completion |
|---|---:|---:|---:|
| routine | 540 | 523 | 97% |
| moderate | 472 | 334 | 71% |
| hard | 377 | 233 | 62% |
| very hard | 50 | 40 | 80% |

## How to read it

- AUC 0.5 is no separation; 1.0 would rank every failed pass above every completed one.
- The sim decides pass outcomes with the same motion model the lane term reuses (time to intercept and the run-in, SPEC 3.5), so this checks that the rating is consistent with how passes fail in the sim. It is not evidence about real passes.
- The lane term reads the ball's tracked path, which for an intercepted pass ends where an opponent won it, so part of the lane's separation is built in: that opponent could, by definition, reach the path. The rating describes the pass as played, not a forecast made at the kick. The passer, receiver and distance parts have no such link.
- The same cut-off works against the distance part: an intercepted pass is measured to where it was won, so failed passes look short, and the distance part alone can rank them below completed ones (AUC under 0.5). It stays as set before the run; measuring the intended length instead would be a new formula, to be checked on new fresh seeds.
- A band with few passes (fewer than about 100) has a wide completion interval; read its rate with that in mind.
