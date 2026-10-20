# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen on tuning seeds | expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Fresh held-out precision | **0.947** — ✅ meets the target ≥ 0.8 |
| Fresh held-out recall | **0.967** — ✅ meets the target ≥ 0.7 |
| `possession_play` alone (the general-play overlay) | precision **0.950**, recall 0.955 |
| Tuning seeds, same thresholds | precision 0.956, recall 0.979 |
| Fresh held-out data | `possession_play` 200–219 (20), `blind_side_run` 200–239 (40): 18.0 min of play, 794 truth episodes, 813 alerts |

**An upper bound for real tracking.** The truth is the sim's belief, which carries the last-seen velocity on for up to 1 s — the same constant-velocity extrapolation the alert's expectation (`expect_s`) uses. The alert and the truth share that model of what a player expects, so these numbers are an upper bound for real tracking, where nobody knows how a player extrapolates. The *best without expectation* rows do not share it.

## Fresh held-out seeds (acceptance)

`possession_play` 200–219 (20), `blind_side_run` 200–239 (40). No eval used these seeds before the parameters were chosen on the tuning seeds. Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.947 | 0.967 | **0.957** | 813 | 794 | 0.893 | 0.713 |
| best without expectation: no expectation, unseen ≥ 1.2 s, moved ≥ 1.5 m | 0.822 | 0.981 | **0.895** | 950 | 794 | 0.760 | 0.729 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.803 | 0.950 | **0.870** | 941 | 794 | 0.764 | 0.713 |
| chosen, 25 m range for alert and truth | 0.921 | 0.960 | **0.940** | 571 | 546 | 0.813 | 0.705 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.793 | 0.985 | **0.879** | 813 | 667 | 0.310 | 0.965 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.950 | 0.229 | **0.370** | 813 | 4050 | 0.554 | 0.250 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.950 | 0.955 | **0.953** | 519 | 516 | 0.879 | 0.667 |
| `possession_play`, best without expectation | 0.801 | 0.973 | **0.878** | 627 | 516 | 0.740 | 0.685 |
| `blind_side_run`, chosen | 0.942 | 0.989 | **0.965** | 294 | 278 | 0.950 | 0.959 |
| `blind_side_run`, best without expectation | 0.864 | 0.996 | **0.925** | 323 | 278 | 0.848 | 0.962 |

## What limits precision

Alerts that match no truth episode (fresh held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 1 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 1 |
| stale while watched for < 0.2 s (too short to be an episode) | 40 |
| stale only while the pair was not watched, or out of range | 0 |
| other | 1 |

- *Runner slowed:* he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale.
- *Never stale:* the belief stayed within 3 m of him for the whole alert.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Old held-out seeds (seen during the design)

`possession_play` 100–119 (20), `blind_side_run` 100–139 (40). The truth episodes, the defender role hold and the expectation variant were settled after looking at these seeds, so they do not decide acceptance.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.946 | 0.981 | **0.964** | 822 | 796 | 0.904 | 0.793 |
| best without expectation: no expectation, unseen ≥ 1.2 s, moved ≥ 1.5 m | 0.796 | 0.984 | **0.880** | 983 | 796 | 0.737 | 0.792 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.791 | 0.942 | **0.860** | 947 | 796 | 0.757 | 0.766 |
| chosen, 25 m range for alert and truth | 0.925 | 0.982 | **0.953** | 577 | 546 | 0.838 | 0.815 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.828 | 0.986 | **0.900** | 822 | 701 | 0.292 | 0.961 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.950 | 0.241 | **0.384** | 822 | 4088 | 0.533 | 0.265 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.946 | 0.976 | **0.961** | 521 | 508 | 0.893 | 0.763 |
| `possession_play`, best without expectation | 0.748 | 0.978 | **0.848** | 660 | 508 | 0.711 | 0.760 |
| `blind_side_run`, chosen | 0.947 | 0.990 | **0.968** | 301 | 288 | 0.953 | 0.947 |
| `blind_side_run`, best without expectation | 0.892 | 0.993 | **0.940** | 323 | 288 | 0.864 | 0.950 |

## Tuning seeds

`possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Best (unseen, moved) per expectation horizon, by interval F1:

| Expectation (s) | Unseen ≥ (s) | Moved ≥ (m) | Precision | Recall | F1 |
|---|---|---|---|---|---|
| off | 1.2 | 1.5 | 0.847 | 0.994 | **0.915** |
| 0.5 | 1.2 | 3.0 | 0.911 | 0.973 | **0.941** |
| 1.0 ⬅ | 1.2 | 3.0 | 0.956 | 0.979 | **0.968** |
| 1.5 | 1.2 | 3.0 | 0.965 | 0.912 | **0.938** |

Interval F1, expectation off:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.677 | 0.695 | 0.728 | 0.759 | 0.771 | 0.774 | 0.757 |
| 0.6 | 0.741 | 0.735 | 0.750 | 0.771 | 0.776 | 0.779 | 0.757 |
| 0.8 | 0.820 | 0.813 | 0.816 | 0.827 | 0.815 | 0.806 | 0.762 |
| 1.0 | 0.873 | 0.867 | 0.868 | 0.872 | 0.853 | 0.838 | 0.785 |
| 1.2 | 0.915 | 0.909 | 0.909 | 0.909 | 0.883 | 0.860 | 0.796 |
| 1.5 | 0.907 | 0.900 | 0.901 | 0.894 | 0.862 | 0.837 | 0.775 |

Interval F1, expectation 0.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.807 | 0.848 | 0.875 | 0.919 | 0.896 | 0.876 | 0.786 |
| 0.6 | 0.807 | 0.848 | 0.875 | 0.919 | 0.896 | 0.876 | 0.786 |
| 0.8 | 0.823 | 0.850 | 0.875 | 0.919 | 0.896 | 0.876 | 0.786 |
| 1.0 | 0.873 | 0.877 | 0.888 | 0.925 | 0.896 | 0.876 | 0.786 |
| 1.2 | 0.915 | 0.919 | 0.926 | 0.941 | 0.904 | 0.879 | 0.786 |
| 1.5 | 0.907 | 0.912 | 0.920 | 0.924 | 0.883 | 0.850 | 0.770 |

Interval F1, expectation 1.0 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.881 | 0.903 | 0.932 | 0.968 | 0.921 | 0.877 | 0.758 |
| 0.6 | 0.881 | 0.903 | 0.932 | 0.968 | 0.921 | 0.877 | 0.758 |
| 0.8 | 0.881 | 0.903 | 0.932 | 0.968 | 0.921 | 0.877 | 0.758 |
| 1.0 | 0.886 | 0.905 | 0.932 | 0.968 | 0.921 | 0.877 | 0.758 |
| 1.2 | 0.917 | 0.922 | 0.935 | 0.968 | 0.921 | 0.877 | 0.758 |
| 1.5 | 0.908 | 0.913 | 0.925 | 0.939 | 0.900 | 0.871 | 0.758 |

Interval F1, expectation 1.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.870 | 0.883 | 0.918 | 0.938 | 0.887 | 0.848 | 0.759 |
| 0.6 | 0.870 | 0.883 | 0.918 | 0.938 | 0.887 | 0.848 | 0.759 |
| 0.8 | 0.870 | 0.883 | 0.918 | 0.938 | 0.887 | 0.848 | 0.759 |
| 1.0 | 0.875 | 0.886 | 0.918 | 0.938 | 0.887 | 0.848 | 0.759 |
| 1.2 | 0.904 | 0.905 | 0.920 | 0.938 | 0.887 | 0.848 | 0.759 |
| 1.5 | 0.897 | 0.900 | 0.910 | 0.919 | 0.881 | 0.848 | 0.759 |

## Method

- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the results tables.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth episode / alerts; recall = truth episodes matched by an alert / truth episodes.
- Tuned on the tuning seeds only: `expect_s` × `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move, then the shorter expectation. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: 35 m for alert and truth (SPEC 4.4): on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on. The 25 m rows show the earlier SPEC value.
