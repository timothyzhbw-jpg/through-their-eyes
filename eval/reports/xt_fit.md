# xT fit — Markov expected threat on synthetic open play

`uv run python -m eval.xt_fit` (8 min). Grid 16 × 12 for a team attacking +x, fitted by value iteration on `xT(z) = s(z)·g(z) + m(z)·Σ T(z→z')·xT(z')` (Singh 2019; our own implementation in `analytics/xt.py`, socceraction is not used). Cached in `analytics/xt_grid.json` for sim version `22ceae8566fd10b9`.

## Data

`open_play` seeds 0–999, 45 s each: `possession_play`'s shape, pressing and marking, but every ball carrier decides with the decision model on his belief (SPEC 3.5), so play moves toward goal and some possessions end in shots. A shot scores its expected goals under the sim's shot model (the decision model's xG; the engine has no shot outcome model). A lost ball is worth 0. The decision model values options with the smooth prior, not this grid: the grid is fitted on the play it drives.

The scripted scenarios cannot carry the fit: they have no shots at all.

| Scenario (seeds) | Played (s) | Decisions | Passes complete / lost | Carries | Shots | Expected goals | Actions from the box |
|---|---|---|---|---|---|---|---|
| `open_play` (0–999) | 35673 | 18741 | 12105 / 1299 | 4733 | 184 | 35.7 | 561 |
| `possession_play` (0–99) | 4323 | 0 | 1142 / 291 | 0 | 0 | 0.0 | 1 |
| `blind_side_run` (0–99) | 644 | 100 | 200 / 0 | 0 | 0 | 0.0 | 0 |

Fit: 18256 actions, 184 shots, each also counted mirrored across the long axis (open play is symmetric in y: mirror-image shapes, jitter and physics). 166/192 cells have at least 20 actions (their own plus their mirror image's) and are fitted. The rest keep the smooth prior, moved down to the lowest fitted value: the prior's floor of 0.02 is a guess, and the fit measures it. At least 30 shots are needed for any fit. Status: **fitted**.

## Acceptance checks (SPEC 4)

| Check | Value | Pass |
|---|---|---|
| Values in [0, 1] | 0.0006 – 0.3813 | yes |
| Column means never drop by more than 0.01 toward goal | worst step +0.0001 | yes |
| Central-lane means never drop by more than 0.02 toward goal | worst step -0.0001 | yes |
| Last 3 columns minus first 3 columns ≥ 0.05 | +0.1272 | yes |
| Every lane: near goal ≥ own half − 0.01 | worst +0.0053 | yes |
| Near goal: central lanes ≥ wings, each of the last 3 columns | smallest margin +0.2717 | yes |

Sanity plot: [xt_fit.svg](xt_fit.svg). Tested by [tests/test_xt.py](../../tests/test_xt.py) on the cached grid.

![Fitted xT grid and column means](xt_fit.svg)

## Grid

Rows are lanes (y, metres from the long axis), columns run toward the attacked goal (x of the cell centre). *Italic*: too little data, the prior at the fitted floor.

| lane \ x (m) | -49 | -43 | -36 | -30 | -23 | -16 | -10 | -3 | +3 | +10 | +16 | +23 | +30 | +36 | +43 | +49 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| +31.2 | *0.001* | *0.001* | *0.001* | 0.003 | 0.003 | 0.004 | 0.003 | 0.003 | 0.005 | 0.005 | 0.007 | 0.003 | *0.004* | *0.007* | *0.010* | 0.006 |
| +25.5 | *0.001* | *0.001* | *0.001* | 0.003 | 0.004 | 0.004 | 0.005 | 0.005 | 0.004 | 0.005 | 0.006 | 0.008 | 0.014 | 0.017 | *0.022* | 0.027 |
| +19.8 | *0.001* | *0.001* | 0.003 | 0.003 | 0.004 | 0.004 | 0.004 | 0.004 | 0.005 | 0.011 | 0.017 | 0.027 | 0.042 | 0.053 | 0.055 | 0.056 |
| +14.2 | *0.001* | 0.003 | 0.003 | 0.004 | 0.004 | 0.004 | 0.004 | 0.004 | 0.005 | 0.012 | 0.030 | 0.063 | 0.091 | 0.099 | 0.103 | 0.105 |
| +8.5 | 0.003 | 0.003 | 0.003 | 0.004 | 0.004 | 0.004 | 0.004 | 0.004 | 0.010 | 0.013 | 0.039 | 0.092 | 0.193 | 0.237 | 0.235 | 0.242 |
| +2.8 | 0.003 | 0.003 | 0.003 | 0.004 | 0.003 | 0.004 | 0.004 | 0.004 | 0.008 | 0.016 | 0.080 | 0.240 | 0.308 | 0.330 | 0.340 | 0.381 |
| -2.8 | 0.003 | 0.003 | 0.003 | 0.004 | 0.003 | 0.004 | 0.004 | 0.004 | 0.008 | 0.016 | 0.080 | 0.240 | 0.308 | 0.330 | 0.340 | 0.381 |
| -8.5 | 0.003 | 0.003 | 0.003 | 0.004 | 0.004 | 0.004 | 0.004 | 0.004 | 0.010 | 0.013 | 0.039 | 0.092 | 0.193 | 0.237 | 0.235 | 0.242 |
| -14.2 | *0.001* | 0.003 | 0.003 | 0.004 | 0.004 | 0.004 | 0.004 | 0.004 | 0.005 | 0.012 | 0.030 | 0.063 | 0.091 | 0.099 | 0.103 | 0.105 |
| -19.8 | *0.001* | *0.001* | 0.003 | 0.003 | 0.004 | 0.004 | 0.004 | 0.004 | 0.005 | 0.011 | 0.017 | 0.027 | 0.042 | 0.053 | 0.055 | 0.056 |
| -25.5 | *0.001* | *0.001* | *0.001* | 0.003 | 0.004 | 0.004 | 0.005 | 0.005 | 0.004 | 0.005 | 0.006 | 0.008 | 0.014 | 0.017 | *0.022* | 0.027 |
| -31.2 | *0.001* | *0.001* | *0.001* | 0.003 | 0.003 | 0.004 | 0.003 | 0.003 | 0.005 | 0.005 | 0.007 | 0.003 | *0.004* | *0.007* | *0.010* | 0.006 |

Column means: 0.001, 0.002, 0.002, 0.003, 0.004, 0.004, 0.004, 0.004, 0.006, 0.010, 0.030, 0.072, 0.108, 0.124, 0.128, 0.136.

## Stability

The same fit on each half of the seeds (0–499 and 500–999).

| | First half | Second half |
|---|---|---|
| Shots | 84 | 100 |
| Fitted cells | 138 | 140 |
| All checks pass | yes | yes |
| Column means | 0.001, 0.001, 0.001, 0.002, 0.002, 0.002, 0.003, 0.003, 0.004, 0.007, 0.021, 0.051, 0.081, 0.101, 0.113, 0.120 | 0.001, 0.002, 0.002, 0.003, 0.004, 0.004, 0.004, 0.004, 0.006, 0.008, 0.024, 0.064, 0.095, 0.112, 0.124, 0.138 |
| The look's ΔxT on `blind_side_run` seed 3 (narrated) | 0.1168 (0.12) | 0.1103 (0.11) |
| Actions in the cell where that pass ends, (14, 3) | 19 (prior at the floor) | 16 (prior at the floor) |

Cell by cell, where both halves fit the cell (134 cells): mean |Δ| 0.0091, 95th percentile 0.0803, max 0.1080. Column means differ by at most 0.0177. The hero's pass ends at (43.8, -13.1) m, where play in the sim is thin: the whole fit has 35 (fitted) actions in that cell, each half alone too few, so the halves' look values lean on the prior there.

## What changes downstream

Analytics and explain read the fitted grid (`analytics.xt.xt_for`): possession value after an action (`sim.counterfactual`, the ΔxT of a counterfactual), the lens values (`explain.lenses`), pass xT gain (`explain.moments`) and the Analyst's `get_xt` tool. The sim's decisions do not change, so neither does any run.

Hero moment (`blind_side_run` seed 3: `pass:H9`, without the look `pass:H4`; unchanged):

| Number | Prior | Fitted grid | Narrated |
|---|---|---|---|
| The look's ΔxT (“That look was worth … in expected threat”) | 0.1007 | 0.1256 | 0.10 → 0.13 |
| Lens `scan` Δ | +0.0988 | +0.1260 | not narrated |
| Lens `space` Δ | +0.0953 | +0.1174 | not narrated |
| Lens `pressure` Δ | +0.0000 | +0.0000 | not narrated |
| Selected lens | `scan` | `scan` | — |

Lens selection on `blind_side_run` seeds 0–39 and 100–139 (80, SPEC 5.2):

| | `scan` selected | Median Δscan − Δspace | Δscan ≥ Δspace |
|---|---|---|---|
| Prior | 80/80 | 0.0028 | 80/80 |
| Fitted grid | 80/80 | 0.0176 | 80/80 |
