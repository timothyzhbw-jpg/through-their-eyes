# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen on tuning seeds | expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Fresh held-out precision | **0.937** — ✅ meets the target ≥ 0.8 |
| Fresh held-out recall | **0.973** — ✅ meets the target ≥ 0.7 |
| `possession_play` alone (the general-play overlay) | precision **0.947**, recall 0.964 |
| Tuning seeds, same thresholds | precision 0.900, recall 0.986 |
| Fresh held-out data | `possession_play` 200–219 (20), `blind_side_run` 200–239 (40): 17.9 min of play, 736 truth episodes, 761 alerts |

**An upper bound for real tracking.** The truth is the sim's belief, which carries the last-seen velocity on for up to 1 s — the same constant-velocity extrapolation the alert's expectation (`expect_s`) uses. The alert and the truth share that model of what a player expects, so these numbers are an upper bound for real tracking, where nobody knows how a player extrapolates. The *best without expectation* rows do not share it.

## Fresh held-out seeds (acceptance)

`possession_play` 200–219 (20), `blind_side_run` 200–239 (40). No eval used these seeds before the parameters were chosen on the tuning seeds. Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.937 | 0.973 | **0.955** | 761 | 736 | 0.916 | 0.749 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 2.5 m | 0.898 | 0.876 | **0.887** | 715 | 736 | 0.866 | 0.635 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.781 | 0.957 | **0.860** | 899 | 736 | 0.765 | 0.732 |
| chosen, 25 m range for alert and truth | 0.911 | 0.965 | **0.937** | 538 | 511 | 0.814 | 0.718 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.779 | 0.987 | **0.871** | 761 | 611 | 0.340 | 0.967 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.942 | 0.243 | **0.386** | 761 | 3468 | 0.589 | 0.264 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.947 | 0.964 | **0.955** | 472 | 466 | 0.912 | 0.704 |
| `possession_play`, best without expectation | 0.865 | 0.828 | **0.846** | 444 | 466 | 0.851 | 0.588 |
| `blind_side_run`, chosen | 0.920 | 0.989 | **0.953** | 289 | 270 | 0.933 | 0.949 |
| `blind_side_run`, best without expectation | 0.952 | 0.959 | **0.956** | 271 | 270 | 0.916 | 0.846 |

## What limits precision

Alerts that match no truth episode (fresh held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 2 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 2 |
| stale while watched for < 0.2 s (too short to be an episode) | 42 |
| stale only while the pair was not watched, or out of range | 1 |
| other | 1 |

- *Runner slowed:* he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale.
- *Never stale:* the belief stayed within 3 m of him for the whole alert.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Old held-out seeds (seen during the design)

`possession_play` 100–119 (20), `blind_side_run` 100–139 (40). The truth episodes, the defender role hold and the expectation variant were settled after looking at these seeds, so they do not decide acceptance.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.938 | 0.982 | **0.960** | 759 | 727 | 0.928 | 0.810 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 2.5 m | 0.908 | 0.883 | **0.895** | 705 | 727 | 0.831 | 0.691 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.758 | 0.938 | **0.839** | 897 | 727 | 0.760 | 0.778 |
| chosen, 25 m range for alert and truth | 0.912 | 0.984 | **0.947** | 524 | 487 | 0.868 | 0.839 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.809 | 0.987 | **0.889** | 759 | 629 | 0.324 | 0.965 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.942 | 0.243 | **0.387** | 759 | 3482 | 0.573 | 0.265 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.947 | 0.974 | **0.960** | 473 | 462 | 0.925 | 0.780 |
| `possession_play`, best without expectation | 0.880 | 0.833 | **0.856** | 435 | 462 | 0.810 | 0.662 |
| `blind_side_run`, chosen | 0.923 | 0.996 | **0.958** | 286 | 265 | 0.940 | 0.954 |
| `blind_side_run`, best without expectation | 0.952 | 0.970 | **0.961** | 270 | 265 | 0.917 | 0.826 |

## Tuning seeds

`possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Best (unseen, moved) per expectation horizon, by interval F1:

| Expectation (s) | Unseen ≥ (s) | Moved ≥ (m) | Precision | Recall | F1 |
|---|---|---|---|---|---|
| off | 1.5 | 2.5 | 0.876 | 0.878 | **0.877** |
| 0.5 | 1.5 | 3.0 | 0.923 | 0.871 | **0.897** |
| 1.0 ⬅ | 1.2 | 3.0 | 0.900 | 0.986 | **0.941** |
| 1.5 | 1.2 | 3.0 | 0.925 | 0.895 | **0.910** |

Interval F1, expectation off:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.600 | 0.628 | 0.672 | 0.710 | 0.716 | 0.724 | 0.712 |
| 0.6 | 0.677 | 0.680 | 0.699 | 0.729 | 0.729 | 0.727 | 0.712 |
| 0.8 | 0.757 | 0.757 | 0.763 | 0.773 | 0.759 | 0.748 | 0.716 |
| 1.0 | 0.812 | 0.814 | 0.818 | 0.819 | 0.797 | 0.782 | 0.734 |
| 1.2 | 0.861 | 0.863 | 0.866 | 0.863 | 0.834 | 0.813 | 0.750 |
| 1.5 | 0.872 | 0.875 | 0.877 | 0.862 | 0.831 | 0.807 | 0.744 |

Interval F1, expectation 0.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.740 | 0.782 | 0.813 | 0.866 | 0.852 | 0.834 | 0.756 |
| 0.6 | 0.740 | 0.782 | 0.813 | 0.866 | 0.852 | 0.834 | 0.756 |
| 0.8 | 0.762 | 0.786 | 0.813 | 0.866 | 0.852 | 0.834 | 0.756 |
| 1.0 | 0.812 | 0.818 | 0.827 | 0.872 | 0.852 | 0.834 | 0.756 |
| 1.2 | 0.860 | 0.865 | 0.869 | 0.894 | 0.863 | 0.842 | 0.757 |
| 1.5 | 0.871 | 0.877 | 0.881 | 0.897 | 0.860 | 0.829 | 0.750 |

Interval F1, expectation 1.0 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.817 | 0.842 | 0.887 | 0.941 | 0.902 | 0.862 | 0.746 |
| 0.6 | 0.817 | 0.842 | 0.887 | 0.941 | 0.902 | 0.862 | 0.746 |
| 0.8 | 0.817 | 0.842 | 0.887 | 0.941 | 0.902 | 0.862 | 0.746 |
| 1.0 | 0.823 | 0.843 | 0.887 | 0.941 | 0.902 | 0.862 | 0.746 |
| 1.2 | 0.864 | 0.868 | 0.890 | 0.941 | 0.902 | 0.862 | 0.746 |
| 1.5 | 0.871 | 0.877 | 0.892 | 0.918 | 0.881 | 0.853 | 0.746 |

Interval F1, expectation 1.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.821 | 0.847 | 0.881 | 0.910 | 0.880 | 0.841 | 0.755 |
| 0.6 | 0.821 | 0.847 | 0.881 | 0.910 | 0.880 | 0.841 | 0.755 |
| 0.8 | 0.821 | 0.847 | 0.881 | 0.910 | 0.880 | 0.841 | 0.755 |
| 1.0 | 0.827 | 0.849 | 0.881 | 0.910 | 0.880 | 0.841 | 0.755 |
| 1.2 | 0.864 | 0.865 | 0.884 | 0.910 | 0.880 | 0.841 | 0.755 |
| 1.5 | 0.870 | 0.868 | 0.880 | 0.894 | 0.870 | 0.841 | 0.755 |

## Method

- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the results tables.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth episode / alerts; recall = truth episodes matched by an alert / truth episodes.
- Tuned on the tuning seeds only: `expect_s` × `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move, then the shorter expectation. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: 35 m for alert and truth (SPEC 4.4): on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on. The 25 m rows show the earlier SPEC value.
