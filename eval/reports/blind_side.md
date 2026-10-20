# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen thresholds (tuning seeds) | unseen ≥ **1.2 s**, moved ≥ **1.5 m**; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Held-out precision | **0.796** ❌ target ≥ 0.8 |
| Held-out recall | **0.984** ✅ target ≥ 0.7 |
| Tuning seeds, same thresholds | precision 0.847, recall 0.994 |
| Held-out data | 17.9 min of play, 796 truth intervals, 983 alerts |

## What limits precision

Alerts that match no truth episode (held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 45 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 91 |
| stale while watched for < 0.2 s (too short to be an episode) | 52 |
| stale only while the pair was not watched, or out of range | 12 |
| other | 1 |

- *Runner slowed* (the largest group): he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale; a truth that also counted a run *since he was last seen* would accept these. That is a definition choice, left as is.
- *Never stale:* the belief stayed within 3 m — either he moved less than 3 m (the tuned move threshold is lower), or the last sighting already showed the run and the sim's belief carries that velocity on for up to 1 s. SPEC 4.4 measures the move from the last sighting and cannot tell.
- The *expectation* variant measures the move from where he would be at his last-seen velocity (≤ 1 s) and reaches precision 0.946, recall 0.981 on held-out seeds. But that is the same constant-velocity assumption the sim's belief makes, so part of the gain is circular. It is a variant (`expect_s`), off by default.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Held-out results

Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| chosen (1.2 s, 1.5 m) | 0.796 | 0.984 | **0.880** | 983 | 796 | 0.737 | 0.792 |
| SPEC values (1.0 s, 3.0 m) | 0.791 | 0.942 | **0.860** | 947 | 796 | 0.757 | 0.766 |
| chosen, 25 m range for alert and truth (SPEC 4.4 text) | 0.761 | 0.984 | **0.858** | 706 | 546 | 0.679 | 0.807 |
| variant: expectation 1 s, tuned (1.2 s, 3.0 m) | 0.946 | 0.981 | **0.964** | 822 | 796 | 0.904 | 0.793 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.697 | 0.989 | **0.817** | 983 | 701 | 0.239 | 0.963 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.901 | 0.280 | **0.427** | 983 | 4088 | 0.477 | 0.290 |

| Scenario (chosen) | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play` | 0.748 | 0.978 | **0.848** | 660 | 508 | 0.711 | 0.760 |
| `blind_side_run` | 0.892 | 0.993 | **0.940** | 323 | 288 | 0.864 | 0.950 |

## Tuning grid (interval F1, tuning seeds)

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.677 | 0.695 | 0.728 | 0.759 | 0.771 | 0.774 | 0.757 |
| 0.6 | 0.741 | 0.735 | 0.750 | 0.771 | 0.776 | 0.779 | 0.757 |
| 0.8 | 0.820 | 0.813 | 0.816 | 0.827 | 0.815 | 0.806 | 0.762 |
| 1.0 | 0.873 | 0.867 | 0.868 | 0.872 | 0.853 | 0.838 | 0.785 |
| 1.2 | 0.915 | 0.909 | 0.909 | 0.909 | 0.883 | 0.860 | 0.796 |
| 1.5 | 0.907 | 0.900 | 0.901 | 0.894 | 0.862 | 0.837 | 0.775 |

## Method

- Tuning seeds: `possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Held-out seeds: `possession_play` 100–119 (20), `blind_side_run` 100–139 (40). `possession_play` runs 45 s; `blind_side_run` is the ~6 s hero scenario.
- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the last two results rows.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth interval / alerts; recall = truth intervals matched by an alert / truth intervals.
- Tuned: `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: SPEC 4.4 says 25 m, but on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on, so the default is 35 m for both alert and truth. The 25 m row shows the SPEC text.
