# xT fit — Markov expected threat on synthetic open play

`uv run python -m eval.xt_fit` (6 min). Grid 16 × 12 for a team attacking +x, fitted by value iteration on `xT(z) = s(z)·g(z) + m(z)·Σ T(z→z')·xT(z')` (Singh 2019; our own implementation in `analytics/xt.py`, socceraction is not used). Cached in `analytics/xt_grid.json` for sim version `ac5d84f031d53bb3`.

## Data

`open_play` seeds 0–1999, 45 s each: `possession_play`'s shape, pressing and marking, but every ball carrier decides with the decision model on his belief (SPEC 3.5), so play moves toward goal and some possessions end in shots. A shot scores its expected goals under the sim's shot model (the decision model's xG; the engine has no shot outcome model). A lost ball is worth 0. The decision model values options with the smooth prior, not this grid: the grid is fitted on the play it drives.

The scripted scenarios cannot carry the fit: they have no shots at all.

| Scenario (seeds) | Played (s) | Decisions | Passes complete / lost | Carries | Shots | Expected goals | Actions from the box |
|---|---|---|---|---|---|---|---|
| `open_play` (0–1999) | 79279 | 41236 | 27910 / 2428 | 9439 | 333 | 40.3 | 693 |
| `possession_play` (0–99) | 4504 | 0 | 1217 / 412 | 0 | 0 | 0.0 | 1 |
| `blind_side_run` (0–99) | 631 | 100 | 193 / 0 | 7 | 0 | 0.0 | 0 |

Fit: 39936 actions, 333 shots, each also counted mirrored across the long axis (open play is symmetric in y: mirror-image shapes, jitter and physics). 174/192 cells have at least 20 actions (their own plus their mirror image's) and are fitted. The rest keep the smooth prior, moved down to the lowest fitted value: the prior's floor of 0.02 is a guess, and the fit measures it. At least 30 shots are needed for any fit. Status: **fitted**.

## Acceptance checks (SPEC 4)

| Check | Value | Pass |
|---|---|---|
| Values in [0, 1] | 0.0013 – 0.2791 | yes |
| Column means never drop by more than 0.01 toward goal | worst step -0.0001 | yes |
| Central-lane means never drop by more than 0.02 toward goal | worst step -0.0000 | yes |
| Last 3 columns minus first 3 columns ≥ 0.05 | +0.1010 | yes |
| Every lane: near goal ≥ own half − 0.01 | worst +0.0069 | yes |
| Near goal: central lanes ≥ wings, each of the last 3 columns | smallest margin +0.1795 | yes |

Sanity plot: [xt_fit.svg](xt_fit.svg). Tested by [tests/test_xt.py](../../tests/test_xt.py) on the cached grid.

![Fitted xT grid and column means](xt_fit.svg)

## Grid

Rows are lanes (y, metres from the long axis), columns run toward the attacked goal (x of the cell centre). *Italic*: too little data, the prior at the fitted floor.

| lane \ x (m) | -49 | -43 | -36 | -30 | -23 | -16 | -10 | -3 | +3 | +10 | +16 | +23 | +30 | +36 | +43 | +49 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| +31.2 | *0.001* | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.003 | 0.006 | 0.008 | 0.009 | 0.008 | 0.009 | 0.010 |
| +25.5 | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.004 | 0.009 | 0.017 | 0.021 | 0.023 | 0.024 | 0.024 |
| +19.8 | 0.002 | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.003 | 0.007 | 0.014 | 0.023 | 0.039 | 0.046 | 0.047 | 0.049 |
| +14.2 | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.009 | 0.020 | 0.046 | 0.078 | 0.101 | 0.104 | 0.105 |
| +8.5 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.006 | 0.026 | 0.079 | 0.131 | 0.186 | 0.200 | 0.226 |
| +2.8 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.008 | 0.028 | 0.107 | 0.181 | 0.204 | 0.206 | *0.279* |
| -2.8 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.008 | 0.028 | 0.107 | 0.181 | 0.204 | 0.206 | *0.279* |
| -8.5 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.006 | 0.026 | 0.079 | 0.131 | 0.186 | 0.200 | 0.226 |
| -14.2 | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.009 | 0.020 | 0.046 | 0.078 | 0.101 | 0.104 | 0.105 |
| -19.8 | 0.002 | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.003 | 0.007 | 0.014 | 0.023 | 0.039 | 0.046 | 0.047 | 0.049 |
| -25.5 | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.004 | 0.009 | 0.017 | 0.021 | 0.023 | 0.024 | 0.024 |
| -31.2 | *0.001* | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.003 | 0.006 | 0.008 | 0.009 | 0.008 | 0.009 | 0.010 |

Column means: 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.004, 0.006, 0.017, 0.047, 0.076, 0.095, 0.098, 0.115.

## Stability

The same fit on each half of the seeds (0–999 and 1000–1999).

| | First half | Second half |
|---|---|---|
| Shots | 181 | 152 |
| Fitted cells | 168 | 162 |
| All checks pass | yes | yes |
| Column means | 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.003, 0.004, 0.007, 0.019, 0.048, 0.076, 0.093, 0.098, 0.116 | 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.003, 0.005, 0.015, 0.043, 0.077, 0.096, 0.100, 0.116 |
| The look's ΔxT on `blind_side_run` seed 3 (narrated) | 0.1544 (0.15) | 0.1578 (0.16) |
| Actions in the cell where that pass ends, (14, 4) | 55 (fitted) | 46 (fitted) |

Cell by cell, where both halves fit the cell (162 cells): mean |Δ| 0.0034, 95th percentile 0.0151, max 0.0340. Column means differ by at most 0.0044. The hero's pass ends at (40.8, -10.8) m, where play in the sim is thin: the whole fit has 101 (fitted) actions in that cell, each half alone too few, so the halves' look values lean on the prior there.

## What changes downstream

Analytics and explain read the fitted grid (`analytics.xt.xt_for`): possession value after an action (`sim.counterfactual`, the ΔxT of a counterfactual), the lens values (`explain.lenses`), pass xT gain (`explain.moments`) and the Analyst's `get_xt` tool. The sim's decisions do not change, so neither does any run.

Hero moment (`blind_side_run` seed 3: `pass:H9`, without the look `pass:H4`; unchanged):

| Number | Prior | Fitted grid | Narrated |
|---|---|---|---|
| The look's ΔxT (“That look was worth … in expected threat”) | 0.0975 | 0.1554 | 0.10 → 0.16 |
| Lens `scan` Δ | +0.0903 | +0.1541 | not narrated |
| Lens `space` Δ | +0.0868 | +0.1379 | not narrated |
| Lens `pressure` Δ | -0.0008 | -0.0010 | not narrated |
| Selected lens | `scan` | `scan` | — |

Lens selection on `blind_side_run` seeds 0–39 and 100–139 (80, SPEC 5.2):

| | `scan` selected | Median Δscan − Δspace | Δscan ≥ Δspace |
|---|---|---|---|
| Prior | 69/80 | 0.0030 | 80/80 |
| Fitted grid | 69/80 | 0.0144 | 80/80 |
