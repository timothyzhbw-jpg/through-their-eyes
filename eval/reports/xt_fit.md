# xT fit — Markov expected threat on synthetic open play

`uv run python -m eval.xt_fit` (31 min). Grid 16 × 12 for a team attacking +x, fitted by value iteration on `xT(z) = s(z)·g(z) + m(z)·Σ T(z→z')·xT(z')` (Singh 2019; our own implementation in `analytics/xt.py`, socceraction is not used). Cached in `analytics/xt_grid.json` for sim version `7dcb2042b8f3a3e1`.

## Data

`open_play` seeds 0–5999, 45 s each: `possession_play`'s shape, pressing and marking, but every ball carrier decides with the decision model on his belief (SPEC 3.5), so play moves toward goal and some possessions end in shots. A shot scores its expected goals under the sim's shot model (the decision model's xG; the engine has no shot outcome model). A lost ball is worth 0. The decision model values options with the smooth prior, not this grid: the grid is fitted on the play it drives.

The scripted scenarios cannot carry the fit: they have no shots at all.

| Scenario (seeds) | Played (s) | Decisions | Passes complete / lost | Carries | Shots | Expected goals | Actions from the box |
|---|---|---|---|---|---|---|---|
| `open_play` (0–5999) | 238945 | 123915 | 83844 / 7345 | 28323 | 997 | 117.0 | 1995 |
| `possession_play` (0–99) | 4504 | 0 | 1217 / 412 | 0 | 0 | 0.0 | 1 |
| `blind_side_run` (0–99) | 631 | 100 | 193 / 0 | 7 | 0 | 0.0 | 0 |

Fit: 119984 actions, 997 shots, each also counted mirrored across the long axis (open play is symmetric in y: mirror-image shapes, jitter and physics). 186/192 cells have at least 20 actions (their own plus their mirror image's) and are fitted. The rest keep the smooth prior, moved down to the lowest fitted value: the prior's floor of 0.02 is a guess, and the fit measures it. At least 30 shots are needed for any fit. Status: **fitted**.

## Acceptance checks (SPEC 4)

| Check | Value | Pass |
|---|---|---|
| Values in [0, 1] | 0.0018 – 0.3355 | yes |
| Column means never drop by more than 0.01 toward goal | worst step +0.0000 | yes |
| Central-lane means never drop by more than 0.02 toward goal | worst step -0.0000 | yes |
| Last 3 columns minus first 3 columns ≥ 0.05 | +0.1053 | yes |
| Every lane: near goal ≥ own half − 0.01 | worst +0.0155 | yes |
| Near goal: central lanes ≥ wings, each of the last 3 columns | smallest margin +0.1706 | yes |

Sanity plot: [xt_fit.svg](xt_fit.svg). Tested by [tests/test_xt.py](../../tests/test_xt.py) on the cached grid.

![Fitted xT grid and column means](xt_fit.svg)

## Grid

Rows are lanes (y, metres from the long axis), columns run toward the attacked goal (x of the cell centre). *Italic*: too little data, the prior at the fitted floor.

| lane \ x (m) | -49 | -43 | -36 | -30 | -23 | -16 | -10 | -3 | +3 | +10 | +16 | +23 | +30 | +36 | +43 | +49 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| +31.2 | *0.002* | *0.002* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.004 | 0.006 | 0.011 | 0.014 | 0.016 | 0.018 | 0.019 |
| +25.5 | *0.002* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.004 | 0.009 | 0.017 | 0.023 | 0.023 | 0.024 | 0.024 |
| +19.8 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.007 | 0.012 | 0.024 | 0.040 | 0.045 | 0.047 | 0.048 |
| +14.2 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.006 | 0.018 | 0.046 | 0.079 | 0.105 | 0.108 | 0.110 |
| +8.5 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.006 | 0.020 | 0.067 | 0.128 | 0.180 | 0.199 | 0.222 |
| +2.8 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.007 | 0.025 | 0.104 | 0.173 | 0.201 | 0.209 | 0.336 |
| -2.8 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.007 | 0.025 | 0.104 | 0.173 | 0.201 | 0.209 | 0.336 |
| -8.5 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.006 | 0.020 | 0.067 | 0.128 | 0.180 | 0.199 | 0.222 |
| -14.2 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.006 | 0.018 | 0.046 | 0.079 | 0.105 | 0.108 | 0.110 |
| -19.8 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.007 | 0.012 | 0.024 | 0.040 | 0.045 | 0.047 | 0.048 |
| -25.5 | *0.002* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.004 | 0.009 | 0.017 | 0.023 | 0.023 | 0.024 | 0.024 |
| -31.2 | *0.002* | *0.002* | 0.002 | 0.002 | 0.002 | 0.002 | 0.002 | 0.003 | 0.003 | 0.004 | 0.006 | 0.011 | 0.014 | 0.016 | 0.018 | 0.019 |

Column means: 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.003, 0.006, 0.015, 0.045, 0.076, 0.095, 0.101, 0.126.

## Stability

The same fit on each half of the seeds (0–2999 and 3000–5999).

| | First half | Second half |
|---|---|---|
| Shots | 508 | 489 |
| Fitted cells | 178 | 176 |
| All checks pass | yes | yes |
| Column means | 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.004, 0.007, 0.016, 0.045, 0.076, 0.095, 0.100, 0.117 | 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.005, 0.014, 0.044, 0.075, 0.095, 0.101, 0.117 |
| The look's ΔxT on `blind_side_run` seed 3 (narrated) | 0.1548 (0.15) | 0.1555 (0.16) |
| Actions in the cell where that pass ends, (14, 4) | 144 (fitted) | 124 (fitted) |

Cell by cell, where both halves fit the cell (174 cells): mean |Δ| 0.0018, 95th percentile 0.0081, max 0.0114. Column means differ by at most 0.0024. The hero's pass ends at (40.8, -10.8) m, where play in the sim is thin: the whole fit has 268 (fitted) actions in that cell, each half alone too few, so the halves' look values lean on the prior there.

## What changes downstream

Analytics and explain read the fitted grid (`analytics.xt.xt_for`): possession value after an action (`sim.counterfactual`, the ΔxT of a counterfactual), the lens values (`explain.lenses`), pass xT gain (`explain.moments`) and the Analyst's `get_xt` tool. The sim's decisions do not change, so neither does any run.

Hero moment (`blind_side_run` seed 3: `pass:H9`, without the look `pass:H4`; unchanged):

| Number | Prior | Fitted grid | Narrated |
|---|---|---|---|
| The look's ΔxT (“That look was worth … in expected threat”) | 0.0975 | 0.1552 | 0.10 → 0.16 |
| Lens `scan` Δ | +0.0903 | +0.1535 | not narrated |
| Lens `space` Δ | +0.0868 | +0.1365 | not narrated |
| Lens `pressure` Δ | -0.0008 | -0.0010 | not narrated |
| Selected lens | `scan` | `scan` | — |

Lens selection on `blind_side_run` seeds 0–39 and 100–139 (80, SPEC 5.2):

| | `scan` selected | Median Δscan − Δspace | Δscan ≥ Δspace |
|---|---|---|---|
| Prior | 69/80 | 0.0030 | 80/80 |
| Fitted grid | 69/80 | 0.0143 | 80/80 |
