# Laws of the Game audit (SPEC 3.9)

`uv run python -m eval.laws`. Every scenario on design seeds 0–99 and held-out seeds 100–139 and 200–239, each hero scenario's own intervention on the same seeds, and the stitched matches 1, 2 (each on its own plan, `sim.match.plan_for`), judged with `sim/laws.py`: the IFAB *Laws of the Game 2026/27* (theifab.com), each rule cited by law and section and restated in our own words there. `possession_play` and `open_play` run 45 s. Runs: 1000 design, 800 held-out, 1260 intervention, 19 match 1, 17 match 2 (3,096 in all).

A **breach** is something a law forbids; it is **called** when the referee stopped play for it and **unpunished** otherwise. A **wrong call** stops play or gives a goal where the Laws do not, an **early call** is the right call before the whole ball had crossed, and **not modelled** is what the sim has no physics for (the woodwork).

**0 unpunished breaches**, 0 called, 0 wrong calls, 0 early calls, 0 not modelled.

- `blind_side_run` 3 (in the stitched match): no breach.
- `press_escape` 0 (in the stitched match): no breach.
- `far_post_finish` 11 (in the stitched match): no breach.
- `corner_blind_side` 0 (in the stitched match): no breach.

## By law

| Law | What is checked | Checked | Breaches | Called | Unpunished | Wrong calls | Early calls | Not modelled |
|---|---|---|---|---|---|---|---|---|
| 3.1 | line-ups: eleven a side, one keeper | 3,096 runs | 0 | 0 | 0 | 0 | 0 | 0 |
| 9.1 | frames in play: the whole ball over a line stops play | 871,849 frames | 0 | 0 | 0 | 0 | 0 | 0 |
| 10.1 | whole-ball crossings of a goal line, and every goal given | 794 goal-line crossings | 0 | 0 | 0 | 0 | 0 | 0 |
| 11.2 | passes and shots: offside position, then involvement | 12,691 kicks | 0 | 0 | 0 | 0 | 0 | 0 |
| 12.1 | keeper handling (saves) and tackles | 388 saves and tackles | 0 | 0 | 0 | 0 | 0 | 0 |
| 13-17 | simulated restarts: distances and the ball's place | 362 restarts | 0 | 0 | 0 | 0 | 0 | 0 |

## Every finding by kind and run set

| Finding | Law | Category | design | held-out | intervention | match 1 | match 2 |
|---|---|---|---|---|---|---|---|
| none | | | 0 | 0 | 0 | 0 | 0 |

## Unpunished breaches by scenario

Runs with at least one unpunished breach, of all runs, per scenario and run set; then the unpunished breaches per law.

| Scenario | Run set | Runs with one | Runs | 3.1 | 9.1 | 10.1 | 11.2 | 12.1 | 13-17 |
|---|---|---|---|---|---|---|---|---|---|
| `blind_side_run` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `blind_side_run` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `blind_side_run` | intervention | 0 | 180 | 0 | 0 | 0 | 0 | 0 | 0 |
| `blind_side_run` | match 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `blind_side_run` | match 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `corner_blind_side` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `corner_blind_side` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `corner_blind_side` | intervention | 0 | 180 | 0 | 0 | 0 | 0 | 0 | 0 |
| `corner_blind_side` | match 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `corner_blind_side` | match 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `cutback_scan` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `cutback_scan` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `cutback_scan` | intervention | 0 | 180 | 0 | 0 | 0 | 0 | 0 | 0 |
| `far_post_finish` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `far_post_finish` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `far_post_finish` | intervention | 0 | 180 | 0 | 0 | 0 | 0 | 0 | 0 |
| `far_post_finish` | match 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `keeper_switch` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `keeper_switch` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `keeper_switch` | intervention | 0 | 180 | 0 | 0 | 0 | 0 | 0 | 0 |
| `open_play` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `open_play` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play` | match 1 | 0 | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play` | match 2 | 0 | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play_away` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play_away` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play_away` | match 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `press_escape` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `press_escape` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `press_escape` | intervention | 0 | 180 | 0 | 0 | 0 | 0 | 0 | 0 |
| `press_escape` | match 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `press_escape` | match 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `screened_shot` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `screened_shot` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `screened_shot` | intervention | 0 | 180 | 0 | 0 | 0 | 0 | 0 | 0 |

## Hero moments on their demo seeds

Every pass and shot of the factual run. Margin: how far the intended receiver stood beyond the offside line when the ball was played (m; ≤ 0 is onside). Seeds: the demo seeds of the stitched match, 0 for the heroes it does not play.

| Run | Frame | Kick | Restart | Receiver's margin | Line set by | Offence |
|---|---|---|---|---|---|---|
| `blind_side_run` 3 | 15 | H4 → H8 (pass) | — | -24.32 | A4 | — |
| `blind_side_run` 3 | 75 | H8 → H9 (pass) | — | -1.50 | A4 | — |
| `corner_blind_side` 0 | 11 | A7 → A11 (pass) | corner | -6.41 | ball | — |
| `corner_blind_side` 0 | 65 | A11 → A9 (pass) | — | -8.73 | H3 | — |
| `cutback_scan` 0 | 107 | H2 → H7 (pass) | — | -1.97 | A3 | — |
| `far_post_finish` 11 | 12 | H3 → H6 (pass) | — | -27.72 | A5 | — |
| `far_post_finish` 11 | 79 | H6 → H7 (pass) | — | -15.32 | A5 | — |
| `far_post_finish` 11 | 143 | H7 → H9 (pass) | — | -8.30 | A5 | — |
| `far_post_finish` 11 | 198 | H9 (shot) | — | — | A5 | — |
| `keeper_switch` 0 | 67 | H4 → H1 (pass) | — | -45.13 | halfway | — |
| `keeper_switch` 0 | 121 | H1 → H3 (pass) | — | -36.77 | halfway | — |
| `press_escape` 0 | 14 | H6 → H4 (pass) | — | -44.29 | A5 | — |
| `press_escape` 0 | 66 | H4 → H7 (pass) | — | -11.83 | A4 | — |
| `screened_shot` 0 | 25 | A8 → A10 (pass) | — | -14.40 | H4 | — |
| `screened_shot` 0 | 35 | A10 (shot) | — | — | H4 | — |

Hero scenarios over all their seeds: factual runs with an offside offence anywhere in the run, and runs where the offender is the hero or the player the hero passed to.

| Scenario | Run set | Runs | With an offside offence | Hero or his receiver |
|---|---|---|---|---|
| `blind_side_run` | design | 100 | 0 | 0 |
| `blind_side_run` | held-out | 80 | 0 | 0 |
| `blind_side_run` | intervention | 180 | 0 | 0 |
| `corner_blind_side` | design | 100 | 0 | 0 |
| `corner_blind_side` | held-out | 80 | 0 | 0 |
| `corner_blind_side` | intervention | 180 | 0 | 0 |
| `cutback_scan` | design | 100 | 0 | 0 |
| `cutback_scan` | held-out | 80 | 0 | 0 |
| `cutback_scan` | intervention | 180 | 0 | 0 |
| `far_post_finish` | design | 100 | 0 | 0 |
| `far_post_finish` | held-out | 80 | 0 | 0 |
| `far_post_finish` | intervention | 180 | 0 | 0 |
| `keeper_switch` | design | 100 | 0 | 0 |
| `keeper_switch` | held-out | 80 | 0 | 0 |
| `keeper_switch` | intervention | 180 | 0 | 0 |
| `press_escape` | design | 100 | 0 | 0 |
| `press_escape` | held-out | 80 | 0 | 0 |
| `press_escape` | intervention | 180 | 0 | 0 |
| `screened_shot` | design | 100 | 0 | 0 |
| `screened_shot` | held-out | 80 | 0 | 0 |
| `screened_shot` | intervention | 180 | 0 | 0 |

## Stitched matches: restarts

How each possession of a match begins (its label), what the Laws award after the previous possession and to whom, which team has the ball in the possession's first frame, and whether the restart is played in the sim. Only a set-piece scenario plays one; every other stitch is an edit (SPEC 3.1).

| Match | Restarts | Label as the Laws award | Played in the sim | Edits | … to the awarded team |
|---|---|---|---|---|---|
| 1 | 2 of 19 stitches | 18/19 | 0 | 2 | 2/2 |
| 2 | 1 of 17 stitches | 16/17 | 0 | 1 | 1/1 |

| Match | # | Scenario | Label | The Laws award | To team | First team on the ball | Played |
|---|---|---|---|---|---|---|---|
| 1 | 0 | `possession_play` | kick_off | kick_off | — | 0 | no (edit) |
| 1 | 12 | `possession_play_away` | kick_off | kick_off | 1 | 1 | no (edit) |
| 1 | 14 | `corner_blind_side` | corner | cut | — | 1 | yes |
| 2 | 0 | `possession_play` | kick_off | kick_off | — | 0 | no (edit) |
| 2 | 6 | `corner_blind_side` | corner | cut | — | 1 | yes |

## Players off the field while the ball is in play (informational)

Not a breach by itself: players may leave the field in the course of play, and for offside they count as on the line (Law 11.1). Runs where any player stood beyond the outer edge of a line, the furthest, and who.

| Scenario | Run set | Runs with one | Runs | Furthest (m) | Who |
|---|---|---|---|---|---|

## Examples

Up to five per finding, in run order.

## Static checks

| Law | Check | Holds |
|---|---|---|
| 1 | pitch 105 × 68 m (sim.config) | yes |
| 1 | goal 7.32 m between the posts (sim.shots) | yes |
| 1 | goal line at x = ±52.5 m (analytics.xt) | yes |
| 2 | ball radius 0.110 m in 0.1082–0.1114 m (68–70 cm round) | yes |

Not checked here: the web app's pitch markings (`web/src/views`), drawn from its own literals.
