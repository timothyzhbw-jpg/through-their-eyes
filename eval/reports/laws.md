# Laws of the Game audit (SPEC 3.9)

`uv run python -m eval.laws`. Every scenario on design seeds 0–99 and held-out seeds 100–139 and 200–239, each hero scenario's own intervention on the same seeds, and the stitched matches 1, 2, judged with `sim/laws.py` (IFAB Laws of the Game, cited by law; the rules are restated in our own words there). `possession_play` and `open_play` run 45 s. Runs: 900 design, 720 held-out, 1260 intervention, 19 match 1, 17 match 2 (2,916 in all).

A **breach** is something a law forbids; it is **called** when the referee stopped play for it and **unpunished** otherwise. A **wrong call** stops play or gives a goal where the Laws do not, an **early call** is the right call before the whole ball had crossed, and **not modelled** is what the sim has no physics for (the woodwork).

**218 unpunished breaches**, 0 called, 0 wrong calls, 116 early calls, 79 not modelled.

- `blind_side_run` 3 (in the stitched match): H9 offside offence, played the ball: H8's pass at frame 75, 2.84 m beyond the second-last opponent A4.
- `press_escape` 0 (in the stitched match): no breach.
- `far_post_finish` 11 (in the stitched match): no breach.
- `corner_blind_side` 0 (in the stitched match): no breach.

## By law

| Law | What is checked | Checked | Breaches | Called | Unpunished | Wrong calls | Early calls | Not modelled |
|---|---|---|---|---|---|---|---|---|
| 3.1 | line-ups: eleven a side, one keeper | 2,916 runs | 0 | 0 | 0 | 0 | 0 | 0 |
| 9.1 | frames in play: the whole ball over a line stops play | 815,341 frames | 0 | 0 | 0 | 0 | 77 | 0 |
| 10.1 | whole-ball crossings of a goal line, and every goal given | 841 goal-line crossings | 8 | 0 | 8 | 0 | 39 | 79 |
| 11.2 | passes and shots: offside position, then involvement | 11,788 kicks | 183 | 0 | 183 | 0 | 0 | 0 |
| 12.1 | keeper handling (saves) and tackles | 414 saves and tackles | 27 | 0 | 27 | 0 | 0 | 0 |
| 13-17 | simulated restarts: distances and the ball's place | 362 restarts | 0 | 0 | 0 | 0 | 0 | 0 |

## Every finding by kind and run set

| Finding | Law | Category | design | held-out | intervention | match 1 | match 2 |
|---|---|---|---|---|---|---|---|
| out called before the whole ball crossed | 9.1 | early call | 27 | 25 | 25 | 0 | 0 |
| goal not given | 10.1 | breach | 6 | 2 | 0 | 0 | 0 |
| goal given before the whole ball crossed | 10.1 | early call | 13 | 14 | 12 | 0 | 0 |
| ball through the woodwork, given as a goal | 10.1 | not modelled | 6 | 13 | 10 | 0 | 0 |
| ball through the woodwork, played on | 10.1 | not modelled | 10 | 12 | 28 | 0 | 0 |
| offside offence | 11.2 | breach | 100 | 80 | 0 | 2 | 1 |
| tackle through the man | 12.1 | breach | 15 | 12 | 0 | 0 | 0 |

## Unpunished breaches by scenario

Runs with at least one unpunished breach, of all runs, per scenario and run set; then the unpunished breaches per law.

| Scenario | Run set | Runs with one | Runs | 3.1 | 9.1 | 10.1 | 11.2 | 12.1 | 13-17 |
|---|---|---|---|---|---|---|---|---|---|
| `blind_side_run` | design | 100 | 100 | 0 | 0 | 0 | 100 | 0 | 0 |
| `blind_side_run` | held-out | 80 | 80 | 0 | 0 | 0 | 80 | 0 | 0 |
| `blind_side_run` | intervention | 0 | 180 | 0 | 0 | 0 | 0 | 0 | 0 |
| `blind_side_run` | match 1 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| `blind_side_run` | match 2 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
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
| `open_play` | design | 6 | 100 | 0 | 0 | 6 | 0 | 0 | 0 |
| `open_play` | held-out | 2 | 80 | 0 | 0 | 2 | 0 | 0 | 0 |
| `possession_play` | design | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play` | held-out | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| `possession_play` | match 1 | 1 | 15 | 0 | 0 | 0 | 1 | 0 | 0 |
| `possession_play` | match 2 | 0 | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| `press_escape` | design | 15 | 100 | 0 | 0 | 0 | 0 | 15 | 0 |
| `press_escape` | held-out | 12 | 80 | 0 | 0 | 0 | 0 | 12 | 0 |
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
| `blind_side_run` 3 | 75 | H8 → H9 (pass) | — | +2.84 | A4 | H9: played the ball |
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
| `blind_side_run` | design | 100 | 100 | 100 |
| `blind_side_run` | held-out | 80 | 80 | 80 |
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
| 1 | 2 of 19 stitches | 18/19 | 0 | 2 | 1/2 |
| 2 | 1 of 17 stitches | 16/17 | 0 | 1 | 1/1 |

| Match | # | Scenario | Label | The Laws award | To team | First team on the ball | Played |
|---|---|---|---|---|---|---|---|
| 1 | 0 | `possession_play` | kick_off | kick_off | — | 0 | no (edit) |
| 1 | 12 | `possession_play` | kick_off | kick_off | 1 | 0 | no (edit) |
| 1 | 14 | `corner_blind_side` | corner | cut | — | 1 | yes |
| 2 | 0 | `possession_play` | kick_off | kick_off | — | 0 | no (edit) |
| 2 | 6 | `corner_blind_side` | corner | cut | — | 1 | yes |

## Players off the field while the ball is in play (informational)

Not a breach by itself: players may leave the field in the course of play, and for offside they count as on the line (Law 11.1). Runs where any player stood beyond the outer edge of a line, the furthest, and who.

| Scenario | Run set | Runs with one | Runs | Furthest (m) | Who |
|---|---|---|---|---|---|

## Examples

Up to five per finding, in run order.

**out called before the whole ball crossed** (Law 9.1, early call)

- far_post_finish 28, frame 216 H9: centre 0.017 m beyond the line (the whole ball: 0.11 m)
- far_post_finish 32, frame 210 H9: centre 0.030 m beyond the line (the whole ball: 0.11 m)
- far_post_finish 34, frame 211 H9: centre 0.071 m beyond the line (the whole ball: 0.11 m)
- far_post_finish 39 (drop_scan), frame 208 H9: centre 0.041 m beyond the line (the whole ball: 0.11 m)
- far_post_finish 40 (drop_scan), frame 203 H9: centre 0.061 m beyond the line (the whole ball: 0.11 m)

**goal not given** (Law 10.1, breach)

- open_play 41, frame 1035: whole ball over the goal line at y +0.07 m (inside the posts: |y| ≤ 3.55); a goal for team 0
- open_play 51, frame 273: whole ball over the goal line at y -0.79 m (inside the posts: |y| ≤ 3.55); a goal for team 1
- open_play 54, frame 635: whole ball over the goal line at y -0.03 m (inside the posts: |y| ≤ 3.55); a goal for team 1
- open_play 55, frame 855: whole ball over the goal line at y +0.60 m (inside the posts: |y| ≤ 3.55); a goal for team 1
- open_play 62, frame 868: whole ball over the goal line at y -0.49 m (inside the posts: |y| ≤ 3.55); a goal for team 0

**goal given before the whole ball crossed** (Law 10.1, early call)

- far_post_finish 13, frame 203 H9: centre 0.102 m beyond the line (the whole ball: 0.11 m)
- far_post_finish 18, frame 207 H9: centre 0.058 m beyond the line (the whole ball: 0.11 m)
- far_post_finish 20, frame 203 H9: centre 0.043 m beyond the line (the whole ball: 0.11 m)
- far_post_finish 24, frame 211 H9: centre 0.046 m beyond the line (the whole ball: 0.11 m)
- far_post_finish 31, frame 214 H9: centre 0.033 m beyond the line (the whole ball: 0.11 m)

**ball through the woodwork, given as a goal** (Law 10.1, not modelled)

- far_post_finish 12 (drop_scan), frame 207: centre at y -3.58 m as it crosses: part of the ball meets a post
- far_post_finish 25, frame 214: centre at y +3.60 m as it crosses: part of the ball meets a post
- far_post_finish 47 (drop_scan), frame 211: centre at y -3.63 m as it crosses: part of the ball meets a post
- far_post_finish 49, frame 209: centre at y +3.70 m as it crosses: part of the ball meets a post
- far_post_finish 87, frame 210: centre at y +3.66 m as it crosses: part of the ball meets a post

**ball through the woodwork, played on** (Law 10.1, not modelled)

- far_post_finish 4 (drop_scan), frame 201: centre at y -3.66 m as it crosses: part of the ball meets a post
- far_post_finish 10 (drop_scan), frame 207: centre at y -3.65 m as it crosses: part of the ball meets a post
- far_post_finish 19 (drop_scan), frame 211: centre at y -3.83 m as it crosses: part of the ball meets a post
- far_post_finish 36 (drop_scan), frame 206: centre at y -3.77 m as it crosses: part of the ball meets a post
- far_post_finish 37 (drop_scan), frame 209: centre at y -3.82 m as it crosses: part of the ball meets a post

**offside offence** (Law 11.2, breach)

- blind_side_run 0, frame 137 H9: played the ball: H8's pass at frame 76, 3.43 m beyond the second-last opponent A2
- blind_side_run 1, frame 134 H9: played the ball: H8's pass at frame 73, 2.37 m beyond the second-last opponent A2
- blind_side_run 2, frame 142 H9: played the ball: H8's pass at frame 75, 2.17 m beyond the second-last opponent A4
- blind_side_run 3, frame 139 H9: played the ball: H8's pass at frame 75, 2.84 m beyond the second-last opponent A4
- blind_side_run 4, frame 132 H9: played the ball: H8's pass at frame 71, 1.97 m beyond the second-last opponent A4

**tackle through the man** (Law 12.1, breach)

- press_escape 2, frame 115 A3: won it from H7: 0.84 m from the ball, 0.54 m from him
- press_escape 20, frame 116 H7: won it from A3: 0.78 m from the ball, 0.52 m from him
- press_escape 26, frame 123 A3: won it from H7: 0.97 m from the ball, 0.67 m from him
- press_escape 35, frame 122 A3: won it from H7: 0.70 m from the ball, 0.41 m from him
- press_escape 44, frame 119 H7: won it from A3: 0.55 m from the ball, 0.26 m from him

## Static checks

| Law | Check | Holds |
|---|---|---|
| 1 | pitch 105 × 68 m (sim.config) | yes |
| 1 | goal 7.32 m between the posts (sim.shots) | yes |
| 1 | goal line at x = ±52.5 m (analytics.xt) | yes |
| 2 | ball radius 0.110 m in 0.1082–0.1114 m (68–70 cm round) | yes |

Not checked here: the web app's pitch markings (`web/src/views`), drawn from its own literals.
