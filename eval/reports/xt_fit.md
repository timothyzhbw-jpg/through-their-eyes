# xT fit — Markov expected threat on synthetic open play

`uv run python -m eval.xt_fit` (5 min). Grid 16 × 12 for a team attacking +x, fitted by value iteration on `xT(z) = s(z)·g(z) + m(z)·Σ T(z→z')·xT(z')` (Singh 2019; our own implementation in `analytics/xt.py`, socceraction is not used). Cached in `analytics/xt_grid.json` for sim version `cee3a4c309248ead`.

## Data

`open_play` seeds 0–1999, 45 s each: `possession_play`'s shape, pressing and marking, but every ball carrier decides with the decision model on his belief (SPEC 3.5), so play moves toward goal and some possessions end in shots. A shot scores its expected goals under the sim's shot model (the decision model's xG; the engine has no shot outcome model). A lost ball is worth 0. The decision model values options with the smooth prior, not this grid: the grid is fitted on the play it drives.

The scripted scenarios cannot carry the fit: they have no shots at all.

| Scenario (seeds) | Played (s) | Decisions | Passes complete / lost | Carries | Shots | Expected goals | Actions from the box |
|---|---|---|---|---|---|---|---|
| `open_play` (0–1999) | 73173 | 37510 | 25250 / 2435 | 8657 | 269 | 39.3 | 718 |
| `possession_play` (0–99) | 4266 | 0 | 1132 / 287 | 0 | 0 | 0.0 | 1 |
| `blind_side_run` (0–99) | 644 | 100 | 200 / 0 | 0 | 0 | 0.0 | 0 |

Fit: 36471 actions, 269 shots, each also counted mirrored across the long axis (open play is symmetric in y: mirror-image shapes, jitter and physics). 172/192 cells have at least 20 actions (their own plus their mirror image's) and are fitted. The rest keep the smooth prior, moved down to the lowest fitted value: the prior's floor of 0.02 is a guess, and the fit measures it. At least 30 shots are needed for any fit. Status: **fitted**.

## Acceptance checks (SPEC 4)

| Check | Value | Pass |
|---|---|---|
| Values in [0, 1] | 0.0009 – 0.3729 | yes |
| Column means never drop by more than 0.01 toward goal | worst step +0.0000 | yes |
| Central-lane means never drop by more than 0.02 toward goal | worst step -0.0000 | yes |
| Last 3 columns minus first 3 columns ≥ 0.05 | +0.1200 | yes |
| Every lane: near goal ≥ own half − 0.01 | worst +0.0066 | yes |
| Near goal: central lanes ≥ wings, each of the last 3 columns | smallest margin +0.2292 | yes |

Sanity plot: [xt_fit.svg](xt_fit.svg). Tested by [tests/test_xt.py](../../tests/test_xt.py) on the cached grid.

![Fitted xT grid and column means](xt_fit.svg)

## Grid

Rows are lanes (y, metres from the long axis), columns run toward the attacked goal (x of the cell centre). *Italic*: too little data, the prior at the fitted floor.

| lane \ x (m) | -49 | -43 | -36 | -30 | -23 | -16 | -10 | -3 | +3 | +10 | +16 | +23 | +30 | +36 | +43 | +49 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| +31.2 | *0.001* | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.004 | 0.005 | 0.005 | 0.006 | *0.007* | *0.010* | 0.008 |
| +25.5 | *0.001* | *0.001* | 0.001 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.004 | 0.005 | 0.009 | 0.016 | 0.015 | 0.021 | *0.022* | 0.019 |
| +19.8 | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.008 | 0.014 | 0.022 | 0.041 | 0.049 | 0.054 | 0.055 |
| +14.2 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.002 | 0.003 | 0.004 | 0.005 | 0.018 | 0.042 | 0.076 | 0.100 | 0.110 | 0.110 |
| +8.5 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.005 | 0.007 | 0.028 | 0.083 | 0.143 | 0.195 | 0.227 | 0.229 |
| +2.8 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.005 | 0.026 | 0.123 | 0.245 | 0.292 | 0.308 | 0.373 |
| -2.8 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.005 | 0.026 | 0.123 | 0.245 | 0.292 | 0.308 | 0.373 |
| -8.5 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.005 | 0.007 | 0.028 | 0.083 | 0.143 | 0.195 | 0.227 | 0.229 |
| -14.2 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.002 | 0.003 | 0.004 | 0.005 | 0.018 | 0.042 | 0.076 | 0.100 | 0.110 | 0.110 |
| -19.8 | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.008 | 0.014 | 0.022 | 0.041 | 0.049 | 0.054 | 0.055 |
| -25.5 | *0.001* | *0.001* | 0.001 | 0.002 | 0.002 | 0.002 | 0.003 | 0.004 | 0.004 | 0.005 | 0.009 | 0.016 | 0.015 | 0.021 | *0.022* | 0.019 |
| -31.2 | *0.001* | *0.001* | *0.001* | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.004 | 0.005 | 0.005 | 0.006 | *0.007* | *0.010* | 0.008 |

Column means: 0.001, 0.001, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.004, 0.006, 0.017, 0.049, 0.088, 0.110, 0.122, 0.132.

## Stability

The same fit on each half of the seeds (0–999 and 1000–1999).

| | First half | Second half |
|---|---|---|
| Shots | 132 | 137 |
| Fitted cells | 156 | 158 |
| All checks pass | yes | yes |
| Column means | 0.001, 0.001, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.004, 0.006, 0.015, 0.040, 0.078, 0.100, 0.111, 0.117 | 0.001, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.003, 0.004, 0.016, 0.045, 0.078, 0.098, 0.113, 0.118 |
| The look's ΔxT on `blind_side_run` seed 3 (narrated) | 0.1235 (0.12) | 0.1364 (0.14) |
| Actions in the cell where that pass ends, (14, 3) | 21 (fitted) | 28 (fitted) |

Cell by cell, where both halves fit the cell (150 cells): mean |Δ| 0.0032, 95th percentile 0.0190, max 0.0248. Column means differ by at most 0.0050. The hero's pass ends at (43.8, -13.1) m, where play in the sim is thin: the whole fit has 49 (fitted) actions in that cell, each half alone too few, so the halves' look values lean on the prior there.

## What changes downstream

Analytics and explain read the fitted grid (`analytics.xt.xt_for`): possession value after an action (`sim.counterfactual`, the ΔxT of a counterfactual), the lens values (`explain.lenses`), pass xT gain (`explain.moments`) and the Analyst's `get_xt` tool. The sim's decisions do not change, so neither does any run.

Hero moment (`blind_side_run` seed 3: `pass:H9`, without the look `pass:H4`; unchanged):

| Number | Prior | Fitted grid | Narrated |
|---|---|---|---|
| The look's ΔxT (“That look was worth … in expected threat”) | 0.1007 | 0.1303 | 0.10 → 0.13 |
| Lens `scan` Δ | +0.0988 | +0.1309 | not narrated |
| Lens `space` Δ | +0.0953 | +0.1161 | not narrated |
| Lens `pressure` Δ | +0.0000 | +0.0000 | not narrated |
| Selected lens | `scan` | `scan` | — |

Lens selection on `blind_side_run` seeds 0–39 and 100–139 (80, SPEC 5.2):

| | `scan` selected | Median Δscan − Δspace | Δscan ≥ Δspace |
|---|---|---|---|
| Prior | 80/80 | 0.0029 | 80/80 |
| Fitted grid | 80/80 | 0.0126 | 80/80 |
