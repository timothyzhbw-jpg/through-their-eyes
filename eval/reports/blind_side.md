# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen on tuning seeds | expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Fresh held-out precision | **0.923** — ✅ meets the target ≥ 0.8 |
| Fresh held-out recall | **0.985** — ✅ meets the target ≥ 0.7 |
| `possession_play` alone (the general-play overlay) | precision **0.917**, recall 0.981 |
| Tuning seeds, same thresholds | precision 0.926, recall 0.965 |
| Fresh held-out data | `possession_play` 200–219 (20), `blind_side_run` 200–239 (40): 18.3 min of play, 1099 truth episodes, 1171 alerts |

**An upper bound for real tracking.** The truth is the sim's belief, which carries the last-seen velocity on for up to 1 s — the same constant-velocity extrapolation the alert's expectation (`expect_s`) uses. The alert and the truth share that model of what a player expects, so these numbers are an upper bound for real tracking, where nobody knows how a player extrapolates. The *best without expectation* rows do not share it.

## Fresh held-out seeds (acceptance)

`possession_play` 200–219 (20), `blind_side_run` 200–239 (40). No eval used these seeds before the parameters were chosen on the tuning seeds. Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.923 | 0.985 | **0.953** | 1171 | 1099 | 0.907 | 0.820 |
| best without expectation: no expectation, unseen ≥ 1.2 s, moved ≥ 1.5 m | 0.809 | 0.978 | **0.885** | 1327 | 1099 | 0.789 | 0.817 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.770 | 0.942 | **0.848** | 1342 | 1099 | 0.758 | 0.788 |
| chosen, 25 m range for alert and truth | 0.935 | 0.986 | **0.960** | 875 | 831 | 0.867 | 0.837 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.808 | 0.991 | **0.890** | 1171 | 965 | 0.437 | 0.956 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.927 | 0.311 | **0.465** | 1171 | 3853 | 0.683 | 0.350 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.917 | 0.981 | **0.948** | 830 | 780 | 0.906 | 0.793 |
| `possession_play`, best without expectation | 0.797 | 0.971 | **0.875** | 945 | 780 | 0.791 | 0.790 |
| `blind_side_run`, chosen | 0.938 | 0.997 | **0.967** | 341 | 319 | 0.913 | 0.936 |
| `blind_side_run`, best without expectation | 0.838 | 0.997 | **0.910** | 382 | 319 | 0.780 | 0.934 |

## What limits precision

Alerts that match no truth episode (fresh held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 4 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 2 |
| stale while watched for < 0.2 s (too short to be an episode) | 80 |
| stale only while the pair was not watched, or out of range | 4 |
| other | 0 |

- *Runner slowed:* he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale.
- *Never stale:* the belief stayed within 3 m of him for the whole alert.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Old held-out seeds (seen during the design)

`possession_play` 100–119 (20), `blind_side_run` 100–139 (40). The truth episodes, the defender role hold and the expectation variant were settled after looking at these seeds, so they do not decide acceptance.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.0 m | 0.936 | 0.977 | **0.956** | 1262 | 1203 | 0.889 | 0.828 |
| best without expectation: no expectation, unseen ≥ 1.2 s, moved ≥ 1.5 m | 0.790 | 0.972 | **0.872** | 1487 | 1203 | 0.740 | 0.829 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.761 | 0.919 | **0.833** | 1459 | 1203 | 0.728 | 0.780 |
| chosen, 25 m range for alert and truth | 0.931 | 0.973 | **0.952** | 947 | 899 | 0.841 | 0.832 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.797 | 0.988 | **0.883** | 1262 | 1032 | 0.396 | 0.961 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.941 | 0.317 | **0.475** | 1262 | 4230 | 0.657 | 0.356 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.935 | 0.975 | **0.955** | 957 | 917 | 0.884 | 0.815 |
| `possession_play`, best without expectation | 0.762 | 0.967 | **0.852** | 1166 | 917 | 0.728 | 0.815 |
| `blind_side_run`, chosen | 0.938 | 0.983 | **0.960** | 305 | 286 | 0.917 | 0.912 |
| `blind_side_run`, best without expectation | 0.894 | 0.986 | **0.938** | 321 | 286 | 0.821 | 0.916 |

## Tuning seeds

`possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Best (unseen, moved) per expectation horizon, by interval F1:

| Expectation (s) | Unseen ≥ (s) | Moved ≥ (m) | Precision | Recall | F1 |
|---|---|---|---|---|---|
| off | 1.2 | 1.5 | 0.815 | 0.971 | **0.887** |
| 0.5 | 1.2 | 3.0 | 0.865 | 0.953 | **0.907** |
| 1.0 ⬅ | 1.2 | 3.0 | 0.926 | 0.965 | **0.945** |
| 1.5 | 1.2 | 3.0 | 0.928 | 0.911 | **0.919** |

Interval F1, expectation off:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.629 | 0.655 | 0.683 | 0.714 | 0.735 | 0.753 | 0.754 |
| 0.6 | 0.706 | 0.704 | 0.711 | 0.733 | 0.744 | 0.757 | 0.754 |
| 0.8 | 0.779 | 0.775 | 0.770 | 0.781 | 0.777 | 0.776 | 0.761 |
| 1.0 | 0.829 | 0.825 | 0.819 | 0.822 | 0.806 | 0.801 | 0.771 |
| 1.2 | 0.887 | 0.883 | 0.876 | 0.875 | 0.848 | 0.837 | 0.792 |
| 1.5 | 0.886 | 0.882 | 0.874 | 0.869 | 0.841 | 0.828 | 0.772 |

Interval F1, expectation 0.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.771 | 0.802 | 0.830 | 0.872 | 0.867 | 0.861 | 0.804 |
| 0.6 | 0.771 | 0.802 | 0.830 | 0.872 | 0.867 | 0.861 | 0.804 |
| 0.8 | 0.784 | 0.805 | 0.830 | 0.872 | 0.867 | 0.861 | 0.804 |
| 1.0 | 0.828 | 0.833 | 0.842 | 0.877 | 0.868 | 0.861 | 0.804 |
| 1.2 | 0.886 | 0.891 | 0.891 | 0.907 | 0.884 | 0.867 | 0.806 |
| 1.5 | 0.885 | 0.891 | 0.891 | 0.899 | 0.876 | 0.847 | 0.788 |

Interval F1, expectation 1.0 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.821 | 0.863 | 0.907 | 0.945 | 0.917 | 0.894 | 0.770 |
| 0.6 | 0.821 | 0.863 | 0.907 | 0.945 | 0.917 | 0.894 | 0.770 |
| 0.8 | 0.822 | 0.863 | 0.907 | 0.945 | 0.917 | 0.894 | 0.770 |
| 1.0 | 0.836 | 0.863 | 0.907 | 0.945 | 0.917 | 0.894 | 0.770 |
| 1.2 | 0.886 | 0.892 | 0.913 | 0.945 | 0.917 | 0.894 | 0.770 |
| 1.5 | 0.885 | 0.891 | 0.906 | 0.918 | 0.901 | 0.876 | 0.765 |

Interval F1, expectation 1.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.826 | 0.865 | 0.907 | 0.919 | 0.893 | 0.855 | 0.752 |
| 0.6 | 0.826 | 0.865 | 0.907 | 0.919 | 0.893 | 0.855 | 0.752 |
| 0.8 | 0.826 | 0.865 | 0.907 | 0.919 | 0.893 | 0.855 | 0.752 |
| 1.0 | 0.840 | 0.866 | 0.907 | 0.919 | 0.893 | 0.855 | 0.752 |
| 1.2 | 0.889 | 0.893 | 0.908 | 0.919 | 0.893 | 0.855 | 0.752 |
| 1.5 | 0.886 | 0.884 | 0.897 | 0.900 | 0.884 | 0.854 | 0.752 |

## Method

- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the results tables.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth episode / alerts; recall = truth episodes matched by an alert / truth episodes.
- Tuned on the tuning seeds only: `expect_s` × `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move, then the shorter expectation. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: 35 m for alert and truth (SPEC 4.4): on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on. The 25 m rows show the earlier SPEC value.
