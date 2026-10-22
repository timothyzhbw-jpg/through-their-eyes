# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen on tuning seeds | expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Fresh held-out precision | **0.917** — ✅ meets the target ≥ 0.8 |
| Fresh held-out recall | **0.984** — ✅ meets the target ≥ 0.7 |
| `possession_play` alone (the general-play overlay) | precision **0.917**, recall 0.981 |
| Tuning seeds, same thresholds | precision 0.919, recall 0.964 |
| Fresh held-out data | `possession_play` 200–219 (20), `blind_side_run` 200–239 (40): 18.4 min of play, 1054 truth episodes, 1130 alerts |

**An upper bound for real tracking.** The truth is the sim's belief, which carries the last-seen velocity on for up to 1 s — the same constant-velocity extrapolation the alert's expectation (`expect_s`) uses. The alert and the truth share that model of what a player expects, so these numbers are an upper bound for real tracking, where nobody knows how a player extrapolates. The *best without expectation* rows do not share it.

## Fresh held-out seeds (acceptance)

`possession_play` 200–219 (20), `blind_side_run` 200–239 (40). No eval used these seeds before the parameters were chosen on the tuning seeds. Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.917 | 0.984 | **0.949** | 1130 | 1054 | 0.909 | 0.813 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.884 | 0.913 | **0.898** | 1084 | 1054 | 0.829 | 0.706 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.762 | 0.942 | **0.843** | 1304 | 1054 | 0.758 | 0.784 |
| chosen, 25 m range for alert and truth | 0.910 | 0.983 | **0.945** | 831 | 769 | 0.841 | 0.826 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.796 | 0.988 | **0.882** | 1130 | 920 | 0.428 | 0.954 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.919 | 0.296 | **0.448** | 1130 | 3887 | 0.684 | 0.332 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.917 | 0.981 | **0.948** | 830 | 780 | 0.906 | 0.793 |
| `possession_play`, best without expectation | 0.864 | 0.891 | **0.877** | 800 | 780 | 0.816 | 0.684 |
| `blind_side_run`, chosen | 0.917 | 0.993 | **0.953** | 300 | 274 | 0.923 | 0.919 |
| `blind_side_run`, best without expectation | 0.940 | 0.974 | **0.957** | 284 | 274 | 0.893 | 0.821 |

## What limits precision

Alerts that match no truth episode (fresh held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 3 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 2 |
| stale while watched for < 0.2 s (too short to be an episode) | 85 |
| stale only while the pair was not watched, or out of range | 4 |
| other | 0 |

- *Runner slowed:* he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale.
- *Never stale:* the belief stayed within 3 m of him for the whole alert.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Old held-out seeds (seen during the design)

`possession_play` 100–119 (20), `blind_side_run` 100–139 (40). The truth episodes, the defender role hold and the expectation variant were settled after looking at these seeds, so they do not decide acceptance.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.934 | 0.980 | **0.956** | 1237 | 1178 | 0.892 | 0.833 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.861 | 0.902 | **0.881** | 1235 | 1178 | 0.791 | 0.743 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.748 | 0.920 | **0.825** | 1451 | 1178 | 0.729 | 0.786 |
| chosen, 25 m range for alert and truth | 0.922 | 0.972 | **0.947** | 913 | 864 | 0.829 | 0.833 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.795 | 0.990 | **0.882** | 1237 | 1013 | 0.396 | 0.964 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.939 | 0.311 | **0.468** | 1237 | 4241 | 0.661 | 0.352 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.935 | 0.975 | **0.955** | 957 | 917 | 0.884 | 0.815 |
| `possession_play`, best without expectation | 0.834 | 0.882 | **0.857** | 970 | 917 | 0.774 | 0.730 |
| `blind_side_run`, chosen | 0.929 | 0.996 | **0.961** | 280 | 261 | 0.944 | 0.957 |
| `blind_side_run`, best without expectation | 0.958 | 0.973 | **0.966** | 265 | 261 | 0.915 | 0.827 |

## Tuning seeds

`possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Best (unseen, moved) per expectation horizon, by interval F1:

| Expectation (s) | Unseen ≥ (s) | Moved ≥ (m) | Precision | Recall | F1 |
|---|---|---|---|---|---|
| off | 1.5 | 1.5 | 0.884 | 0.883 | **0.883** |
| 0.5 | 1.2 | 3.0 | 0.855 | 0.953 | **0.901** |
| 1.0 ⬅ | 1.2 | 3.0 | 0.919 | 0.964 | **0.941** |
| 1.5 | 1.2 | 3.0 | 0.925 | 0.893 | **0.909** |

Interval F1, expectation off:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.629 | 0.656 | 0.684 | 0.713 | 0.732 | 0.748 | 0.752 |
| 0.6 | 0.703 | 0.701 | 0.708 | 0.729 | 0.738 | 0.751 | 0.752 |
| 0.8 | 0.770 | 0.766 | 0.761 | 0.772 | 0.766 | 0.766 | 0.753 |
| 1.0 | 0.826 | 0.822 | 0.817 | 0.819 | 0.802 | 0.798 | 0.770 |
| 1.2 | 0.881 | 0.877 | 0.871 | 0.869 | 0.841 | 0.831 | 0.791 |
| 1.5 | 0.883 | 0.879 | 0.872 | 0.866 | 0.837 | 0.824 | 0.774 |

Interval F1, expectation 0.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.763 | 0.795 | 0.825 | 0.871 | 0.862 | 0.854 | 0.806 |
| 0.6 | 0.763 | 0.795 | 0.825 | 0.871 | 0.862 | 0.854 | 0.806 |
| 0.8 | 0.775 | 0.797 | 0.825 | 0.871 | 0.862 | 0.854 | 0.806 |
| 1.0 | 0.826 | 0.831 | 0.839 | 0.875 | 0.862 | 0.854 | 0.806 |
| 1.2 | 0.881 | 0.886 | 0.887 | 0.901 | 0.877 | 0.859 | 0.805 |
| 1.5 | 0.883 | 0.888 | 0.890 | 0.897 | 0.873 | 0.843 | 0.791 |

Interval F1, expectation 1.0 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.819 | 0.857 | 0.902 | 0.941 | 0.912 | 0.888 | 0.767 |
| 0.6 | 0.819 | 0.857 | 0.902 | 0.941 | 0.912 | 0.888 | 0.767 |
| 0.8 | 0.819 | 0.857 | 0.902 | 0.941 | 0.912 | 0.888 | 0.767 |
| 1.0 | 0.832 | 0.857 | 0.902 | 0.941 | 0.912 | 0.888 | 0.767 |
| 1.2 | 0.881 | 0.887 | 0.910 | 0.941 | 0.912 | 0.888 | 0.767 |
| 1.5 | 0.882 | 0.889 | 0.906 | 0.919 | 0.901 | 0.877 | 0.767 |

Interval F1, expectation 1.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.820 | 0.855 | 0.893 | 0.909 | 0.888 | 0.857 | 0.763 |
| 0.6 | 0.820 | 0.855 | 0.893 | 0.909 | 0.888 | 0.857 | 0.763 |
| 0.8 | 0.820 | 0.855 | 0.893 | 0.909 | 0.888 | 0.857 | 0.763 |
| 1.0 | 0.833 | 0.855 | 0.893 | 0.909 | 0.888 | 0.857 | 0.763 |
| 1.2 | 0.882 | 0.882 | 0.895 | 0.909 | 0.888 | 0.857 | 0.763 |
| 1.5 | 0.884 | 0.881 | 0.894 | 0.896 | 0.881 | 0.856 | 0.763 |

## Method

- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the results tables.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth episode / alerts; recall = truth episodes matched by an alert / truth episodes.
- Tuned on the tuning seeds only: `expect_s` × `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move, then the shorter expectation. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: 35 m for alert and truth (SPEC 4.4): on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on. The 25 m rows show the earlier SPEC value.
