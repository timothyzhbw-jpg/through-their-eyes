# Archetypes — one midfielder's perception traits within published ranges

These are properties of our simulator under published parameter ranges; they are not findings about real players.

`uv run python -m eval.archetypes`: 1000 `open_play` runs (45 s cap) per archetype, the same seeds for every archetype (keyed off seed 2026, ≥ 1,000,000), with only H8's perception changed (`sim.model.PlayerTraits`). Intervals are 95%: a bootstrap over runs (1000 resamples, paired across archetypes) for rates and means, Wilson for the hero's shares.

## The archetypes

| Archetype | Placed at | Basis | Configured scans/s | Head speed in a scan | Measured (his receptions) |
|---|---|---|---|---|---|
| A: low scanner | 0.14 scans/s | Jordet et al. (2020) mean − 1 SD | 0.22 | 404.2°/s (SimParams) | 0.136 (0.124–0.148) |
| B: typical scanner | the sim's own | the sim's central midfielder as calibrated in sim/config.py (no override) | 1.19 (sim/config.py CM) | 404.2°/s (SimParams) | 0.445 (0.430–0.460) |
| C: high scanner | 0.74 scans/s | Jordet et al. (2020) mean + 1 SD | 5.66 | 404.2°/s (SimParams) | 0.753 (0.737–0.768) |
| D: very high scanner | 1.04 scans/s (not reached) | Jordet et al. (2020) mean + 2 SD | 16.00 | 404.2°/s (SimParams) | 0.838 (0.825–0.852) |
| E: high scanner, slow head | 0.74 scans/s (not reached) | C's rate, Jordet et al. (2020) mean + 1 SD; head speed Kokubu et al. (2026) mean − 2 SD | 16.00 | 302.8°/s | 0.725 (0.712–0.738) |

The calibration curve (tuning seeds, the three central midfielders, 120 runs per point) rises to 0.83 measured scans/s at 16 configured: scans take time (a turn out, a dwell, a turn back, then a 0.3 s refractory pause) and tight pressure slows them (SPEC 3.4). An archetype placed above the curve's top is run at its top and marked *not reached*; its measured rate is what the comparisons below are about.

## Comparison (focal player H8)

| Metric | A | B | C | D | E |
|---|---|---|---|---|---|
| Scans in the 10 s before receiving, per second | 0.136 (0.124 to 0.148), n = 480 | 0.445 (0.430 to 0.460), n = 479 | 0.753 (0.737 to 0.768), n = 499 | 0.838 (0.825 to 0.852), n = 485 | 0.725 (0.712 to 0.738), n = 494 |
| Belief error about opponents within 20 m at his decision | 4.04 m (3.57 m to 4.70 m), n = 656 | 2.56 m (2.38 m to 2.76 m), n = 620 | 1.79 m (1.64 m to 1.95 m), n = 619 | 1.54 m (1.41 m to 1.67 m), n = 608 | 1.82 m (1.66 m to 1.98 m), n = 637 |
| Pass completion | 86.5% (83.5% to 89.3%), n = 502 | 87.4% (84.5% to 90.1%), n = 500 | 89.7% (86.9% to 92.2%), n = 515 | 89.9% (86.9% to 92.4%), n = 504 | 89.7% (86.9% to 92.3%), n = 516 |
| Turnovers under heavy pressure (pressing ≥ 0.7), share of those passes | 14.9% (6.6% to 24.7%), n = 74 | 13.0% (5.5% to 21.9%), n = 77 | 12.3% (3.9% to 22.0%), n = 57 | 13.5% (4.8% to 23.2%), n = 74 | 13.3% (5.2% to 23.0%), n = 75 |
| Progressive passes (complete, ≥ 10 m toward goal), share of passes | 5.8% (3.8% to 7.8%), n = 502 | 5.0% (3.1% to 6.8%), n = 500 | 5.8% (4.0% to 7.9%), n = 515 | 3.8% (2.1% to 5.7%), n = 504 | 5.2% (3.4% to 7.4%), n = 516 |
| xT added per pass | -0.0032 (-0.0057 to -0.0013), n = 502 | -0.0027 (-0.0045 to -0.0013), n = 500 | -0.0020 (-0.0040 to -0.0004), n = 515 | -0.0018 (-0.0034 to -0.0007), n = 504 | -0.0013 (-0.0029 to -0.0003), n = 516 |
| Decisions changed by dropping his last scan before them | 13.3% (10.0% to 16.6%), n = 415 | 13.8% (11.0% to 16.8%), n = 601 | 17.7% (14.9% to 20.8%), n = 609 | 16.1% (13.5% to 19.2%), n = 591 | 19.0% (15.8% to 22.2%), n = 621 |

Differences from B (paired over runs; an interval that excludes 0 is a difference the runs resolve):

| Metric | A − B | C − B | D − B | E − B |
|---|---|---|---|---|
| Scans in the 10 s before receiving, per second | -0.309 (-0.325 to -0.293) | +0.308 (+0.288 to +0.329) | +0.393 (+0.374 to +0.413) | +0.280 (+0.262 to +0.299) |
| Belief error about opponents within 20 m at his decision | +1.49 m (+1.01 m to +2.14 m) | -0.76 m (-0.97 m to -0.57 m) | -1.01 m (-1.24 m to -0.81 m) | -0.74 m (-0.95 m to -0.52 m) |
| Pass completion | -0.9 pp (-4.0 pp to +1.7 pp) | +2.3 pp (-0.5 pp to +5.1 pp) | +2.5 pp (-0.4 pp to +5.5 pp) | +2.3 pp (-0.8 pp to +5.4 pp) |
| Turnovers under heavy pressure (pressing ≥ 0.7), share of those passes | +1.9 pp (-5.8 pp to +10.5 pp) | -0.7 pp (-9.7 pp to +9.2 pp) | +0.5 pp (-11.5 pp to +11.6 pp) | +0.3 pp (-10.6 pp to +10.4 pp) |
| Progressive passes (complete, ≥ 10 m toward goal), share of passes | +0.8 pp (-0.9 pp to +2.6 pp) | +0.8 pp (-1.3 pp to +3.1 pp) | -1.2 pp (-3.3 pp to +0.9 pp) | +0.2 pp (-2.1 pp to +2.6 pp) |
| xT added per pass | -0.0005 (-0.0024 to +0.0009) | +0.0007 (-0.0010 to +0.0024) | +0.0009 (-0.0000 to +0.0023) | +0.0014 (+0.0002 to +0.0029) |
| Decisions changed by dropping his last scan before them | -0.6 pp (-4.1 pp to +3.3 pp) | +3.9 pp (+0.0 pp to +7.6 pp) | +2.3 pp (-1.9 pp to +6.1 pp) | +5.2 pp (+1.2 pp to +9.4 pp) |

- Belief error: the mean distance between where he believes each opponent within 20 m is and where that opponent is, at his decision (the sim's belief, SPEC 3.4).
- Heavy pressure: the lexicon's pressing intensity ≥ 0.7 on him at his decision (SPEC 4.3, 5.3); a turnover is a pass that did not reach a teammate (open_play has no tackles).
- xT added: his team's xT where the pass ended, or minus the opponent's xT where they won it, against his team's xT where he played it (analytics/xt.py, the fitted grid).
- Changed decisions: the scan is dropped (`DropScan`) and the run re-simulated from its first frame to the decision; every other player's draws are unchanged (SPEC 3.7).

## The scan hero (`blind_side_run`, H8)

The scenario scripts the hero's look: his spontaneous scans are suppressed until he acts, and the key scan's timing and dwell are drawn by the scenario. An archetype changes only how fast that look turns, so A to D, whose heads turn at the same speed, play the same runs. Fresh seeds (200 per archetype, keyed, ≥ 1,000,000), the key scan dropped:

| Archetype | Decision changed without the key scan |
|---|---|
| A: low scanner | 198/200 = 99.0% (96.4–99.7%) |
| B: typical scanner | 198/200 = 99.0% (96.4–99.7%) |
| C: high scanner | 198/200 = 99.0% (96.4–99.7%) |
| D: very high scanner | 198/200 = 99.0% (96.4–99.7%) |
| E: high scanner, slow head | 198/200 = 99.0% (96.4–99.7%) |

## Validation against Jordet et al. (2020)

The sim's open play with the typical archetype: every outfield player's reception, the scans in the 10 s before it, and his next pass (10,787 passes in 1000 runs). The paper: 27 players of one club, 9,574 possessions, scans from close-up video. A match in direction and size is a property of the sim's parameters, which come from such papers; it is not evidence about players.

| Relationship | Published | Sim (95% CI) | Match |
|---|---|---|---|
| Pass completion vs scan frequency, log-odds per SD | 0.16 (95% HDI 0.03 to 0.28); 0.13 with pass difficulty in the model | -0.01 (-0.08 to 0.06) | inconclusive (the interval includes 0) |
| Scans/s before receiving, pass reached a teammate vs not | 0.46 vs 0.40, d = 0.15 | 0.39 vs 0.39, d = -0.01 (-0.08 to 0.06) | inconclusive (the interval includes 0) |
| Scans/s before receiving, forward vs backward pass | 0.46 vs 0.42, d = 0.06–0.12 | 0.39 vs 0.39, d = -0.02 (-0.06 to 0.02) | inconclusive (the interval includes 0) |
| The archetypes' own slope: H8's pass completion, log-odds per 0.30 scans/s | 0.16 (observational) | 0.16 (0.03 to 0.29), the same player with his scan rate set | ✅ direction and size |

- The paper's possession-kept comparison (0.46 vs 0.37 scans/s, d = 0.20) needs the outcome of every action, carries included; open play here has no tackles, so a carry never loses the ball and that row is not comparable.
- *Size* matches when the sim's interval overlaps the published interval, or for a printed d, its range (or ± 0.1 around a single value). The published coefficient is a group-level estimate from a hierarchical Bayesian model; the sim's is a pooled logistic regression with a bootstrap over runs.
- The last row is a controlled comparison, the sim's own counterfactual, set beside an observational estimate: they need not agree, and the sim's says nothing about whether scanning causes completion in real football.

## What is held fixed

- The decision model, its temperature included, and every other perception parameter (the field of view, belief extrapolation, scan amplitude and dwell): no paper in docs/REFERENCES.md prints a per-player range for them.
- Every other player: his role's rates (sim/config.py). The archetype is one fictional player's traits, not a team's.
- No archetype is a real player or modelled on one, and nothing here is fitted to real match data (CLAUDE.md, hard constraint 2).
