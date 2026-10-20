# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen on tuning seeds | expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Fresh held-out precision | **0.920** — ✅ meets the target ≥ 0.8 |
| Fresh held-out recall | **0.984** — ✅ meets the target ≥ 0.7 |
| `possession_play` alone (the general-play overlay) | precision **0.922**, recall 0.983 |
| Tuning seeds, same thresholds | precision 0.914, recall 0.966 |
| Fresh held-out data | `possession_play` 200–219 (20), `blind_side_run` 200–239 (40): 18.2 min of play, 1015 truth episodes, 1081 alerts |

**An upper bound for real tracking.** The truth is the sim's belief, which carries the last-seen velocity on for up to 1 s — the same constant-velocity extrapolation the alert's expectation (`expect_s`) uses. The alert and the truth share that model of what a player expects, so these numbers are an upper bound for real tracking, where nobody knows how a player extrapolates. The *best without expectation* rows do not share it.

## Fresh held-out seeds (acceptance)

`possession_play` 200–219 (20), `blind_side_run` 200–239 (40). No eval used these seeds before the parameters were chosen on the tuning seeds. Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.920 | 0.984 | **0.951** | 1081 | 1015 | 0.909 | 0.819 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.882 | 0.909 | **0.895** | 1042 | 1015 | 0.826 | 0.707 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.765 | 0.942 | **0.844** | 1247 | 1015 | 0.762 | 0.789 |
| chosen, 25 m range for alert and truth | 0.909 | 0.983 | **0.944** | 800 | 743 | 0.842 | 0.831 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.800 | 0.989 | **0.885** | 1081 | 886 | 0.422 | 0.954 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.923 | 0.291 | **0.442** | 1081 | 3831 | 0.678 | 0.325 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.922 | 0.983 | **0.951** | 794 | 749 | 0.905 | 0.794 |
| `possession_play`, best without expectation | 0.861 | 0.888 | **0.874** | 768 | 749 | 0.811 | 0.680 |
| `blind_side_run`, chosen | 0.916 | 0.989 | **0.951** | 287 | 266 | 0.927 | 0.946 |
| `blind_side_run`, best without expectation | 0.942 | 0.970 | **0.956** | 274 | 266 | 0.900 | 0.846 |

## What limits precision

Alerts that match no truth episode (fresh held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 3 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 2 |
| stale while watched for < 0.2 s (too short to be an episode) | 77 |
| stale only while the pair was not watched, or out of range | 4 |
| other | 0 |

- *Runner slowed:* he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale.
- *Never stale:* the belief stayed within 3 m of him for the whole alert.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Old held-out seeds (seen during the design)

`possession_play` 100–119 (20), `blind_side_run` 100–139 (40). The truth episodes, the defender role hold and the expectation variant were settled after looking at these seeds, so they do not decide acceptance.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.935 | 0.980 | **0.957** | 1228 | 1171 | 0.896 | 0.829 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.861 | 0.901 | **0.881** | 1225 | 1171 | 0.797 | 0.730 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.746 | 0.918 | **0.823** | 1442 | 1171 | 0.736 | 0.777 |
| chosen, 25 m range for alert and truth | 0.921 | 0.973 | **0.946** | 900 | 851 | 0.824 | 0.829 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.799 | 0.988 | **0.883** | 1228 | 1007 | 0.395 | 0.965 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.940 | 0.311 | **0.467** | 1228 | 4229 | 0.660 | 0.347 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.937 | 0.975 | **0.955** | 948 | 910 | 0.888 | 0.810 |
| `possession_play`, best without expectation | 0.834 | 0.880 | **0.857** | 960 | 910 | 0.779 | 0.716 |
| `blind_side_run`, chosen | 0.929 | 0.996 | **0.961** | 280 | 261 | 0.944 | 0.957 |
| `blind_side_run`, best without expectation | 0.958 | 0.973 | **0.966** | 265 | 261 | 0.917 | 0.827 |

## Tuning seeds

`possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Best (unseen, moved) per expectation horizon, by interval F1:

| Expectation (s) | Unseen ≥ (s) | Moved ≥ (m) | Precision | Recall | F1 |
|---|---|---|---|---|---|
| off | 1.5 | 1.5 | 0.883 | 0.885 | **0.884** |
| 0.5 | 1.2 | 3.0 | 0.848 | 0.956 | **0.899** |
| 1.0 ⬅ | 1.2 | 3.0 | 0.914 | 0.966 | **0.939** |
| 1.5 | 1.2 | 3.0 | 0.928 | 0.901 | **0.914** |

Interval F1, expectation off:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.621 | 0.646 | 0.673 | 0.701 | 0.719 | 0.729 | 0.738 |
| 0.6 | 0.698 | 0.696 | 0.700 | 0.719 | 0.728 | 0.732 | 0.738 |
| 0.8 | 0.763 | 0.759 | 0.753 | 0.761 | 0.755 | 0.750 | 0.740 |
| 1.0 | 0.822 | 0.817 | 0.811 | 0.811 | 0.793 | 0.783 | 0.758 |
| 1.2 | 0.880 | 0.876 | 0.869 | 0.864 | 0.835 | 0.819 | 0.779 |
| 1.5 | 0.884 | 0.879 | 0.872 | 0.862 | 0.831 | 0.815 | 0.766 |

Interval F1, expectation 0.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.755 | 0.789 | 0.821 | 0.867 | 0.859 | 0.848 | 0.794 |
| 0.6 | 0.755 | 0.789 | 0.821 | 0.867 | 0.859 | 0.848 | 0.794 |
| 0.8 | 0.768 | 0.791 | 0.821 | 0.867 | 0.859 | 0.848 | 0.794 |
| 1.0 | 0.821 | 0.826 | 0.836 | 0.871 | 0.860 | 0.848 | 0.794 |
| 1.2 | 0.880 | 0.885 | 0.887 | 0.899 | 0.875 | 0.853 | 0.793 |
| 1.5 | 0.883 | 0.888 | 0.891 | 0.896 | 0.871 | 0.841 | 0.781 |

Interval F1, expectation 1.0 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.816 | 0.854 | 0.902 | 0.939 | 0.917 | 0.891 | 0.767 |
| 0.6 | 0.816 | 0.854 | 0.902 | 0.939 | 0.917 | 0.891 | 0.767 |
| 0.8 | 0.816 | 0.854 | 0.902 | 0.939 | 0.917 | 0.891 | 0.767 |
| 1.0 | 0.829 | 0.855 | 0.902 | 0.939 | 0.917 | 0.891 | 0.767 |
| 1.2 | 0.881 | 0.887 | 0.910 | 0.939 | 0.917 | 0.891 | 0.767 |
| 1.5 | 0.883 | 0.889 | 0.908 | 0.919 | 0.904 | 0.880 | 0.767 |

Interval F1, expectation 1.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.816 | 0.857 | 0.896 | 0.914 | 0.892 | 0.861 | 0.765 |
| 0.6 | 0.816 | 0.857 | 0.896 | 0.914 | 0.892 | 0.861 | 0.765 |
| 0.8 | 0.816 | 0.857 | 0.896 | 0.914 | 0.892 | 0.861 | 0.765 |
| 1.0 | 0.829 | 0.859 | 0.896 | 0.914 | 0.892 | 0.861 | 0.765 |
| 1.2 | 0.882 | 0.885 | 0.899 | 0.914 | 0.892 | 0.861 | 0.765 |
| 1.5 | 0.885 | 0.884 | 0.897 | 0.900 | 0.885 | 0.861 | 0.765 |

## Method

- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the results tables.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth episode / alerts; recall = truth episodes matched by an alert / truth episodes.
- Tuned on the tuning seeds only: `expect_s` × `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move, then the shorter expectation. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: 35 m for alert and truth (SPEC 4.4): on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on. The 25 m rows show the earlier SPEC value.
