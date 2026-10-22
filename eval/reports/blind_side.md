# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen on tuning seeds | expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Fresh held-out precision | **0.910** — ✅ meets the target ≥ 0.8 |
| Fresh held-out recall | **0.946** — ✅ meets the target ≥ 0.7 |
| `possession_play` alone (the general-play overlay) | precision **0.905**, recall 0.941 |
| Tuning seeds, same thresholds | precision 0.916, recall 0.923 |
| Fresh held-out data | `possession_play` 200–219 (20), `blind_side_run` 200–239 (40): 19.3 min of play, 2647 truth episodes, 2760 alerts |

**An upper bound for real tracking.** The truth is the sim's belief, which carries the last-seen velocity on for up to 1 s — the same constant-velocity extrapolation the alert's expectation (`expect_s`) uses. The alert and the truth share that model of what a player expects, so these numbers are an upper bound for real tracking, where nobody knows how a player extrapolates. The *best without expectation* rows do not share it.

## Fresh held-out seeds (acceptance)

`possession_play` 200–219 (20), `blind_side_run` 200–239 (40). No eval used these seeds before the parameters were chosen on the tuning seeds. Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m | 0.910 | 0.946 | **0.927** | 2760 | 2647 | 0.906 | 0.750 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.858 | 0.932 | **0.893** | 2881 | 2647 | 0.858 | 0.745 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.698 | 0.952 | **0.806** | 3625 | 2647 | 0.714 | 0.788 |
| chosen, 25 m range for alert and truth | 0.903 | 0.944 | **0.923** | 2129 | 2027 | 0.864 | 0.751 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.834 | 0.974 | **0.899** | 2760 | 2395 | 0.577 | 0.898 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.913 | 0.404 | **0.560** | 2760 | 6482 | 0.829 | 0.399 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.905 | 0.941 | **0.922** | 2472 | 2373 | 0.904 | 0.741 |
| `possession_play`, best without expectation | 0.849 | 0.927 | **0.886** | 2597 | 2373 | 0.855 | 0.739 |
| `blind_side_run`, chosen | 0.951 | 0.989 | **0.970** | 288 | 274 | 0.928 | 0.859 |
| `blind_side_run`, best without expectation | 0.940 | 0.974 | **0.957** | 284 | 274 | 0.893 | 0.821 |

## What limits precision

Alerts that match no truth episode (fresh held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 6 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 6 |
| stale while watched for < 0.2 s (too short to be an episode) | 102 |
| stale only while the pair was not watched, or out of range | 134 |
| other | 1 |

- *Runner slowed:* he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale.
- *Never stale:* the belief stayed within 3 m of him for the whole alert.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Old held-out seeds (seen during the design)

`possession_play` 100–119 (20), `blind_side_run` 100–139 (40). The truth episodes, the defender role hold and the expectation variant were settled after looking at these seeds, so they do not decide acceptance.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m | 0.913 | 0.942 | **0.928** | 2392 | 2321 | 0.903 | 0.727 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.855 | 0.927 | **0.890** | 2515 | 2321 | 0.845 | 0.719 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.682 | 0.939 | **0.790** | 3203 | 2321 | 0.697 | 0.763 |
| chosen, 25 m range for alert and truth | 0.909 | 0.944 | **0.926** | 1878 | 1812 | 0.864 | 0.733 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.834 | 0.977 | **0.900** | 2392 | 2065 | 0.558 | 0.898 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.915 | 0.367 | **0.524** | 2392 | 6233 | 0.826 | 0.356 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.908 | 0.936 | **0.922** | 2122 | 2060 | 0.899 | 0.714 |
| `possession_play`, best without expectation | 0.843 | 0.921 | **0.880** | 2250 | 2060 | 0.839 | 0.711 |
| `blind_side_run`, chosen | 0.959 | 0.992 | **0.976** | 270 | 261 | 0.948 | 0.892 |
| `blind_side_run`, best without expectation | 0.958 | 0.973 | **0.966** | 265 | 261 | 0.915 | 0.827 |

## Tuning seeds

`possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Best (unseen, moved) per expectation horizon, by interval F1:

| Expectation (s) | Unseen ≥ (s) | Moved ≥ (m) | Precision | Recall | F1 |
|---|---|---|---|---|---|
| off | 1.5 | 1.5 | 0.864 | 0.915 | **0.889** |
| 0.5 | 1.5 | 2.5 | 0.874 | 0.912 | **0.892** |
| 1.0 ⬅ | 1.2 | 3.5 | 0.916 | 0.923 | **0.919** |
| 1.5 | 1.5 | 1.5 | 0.887 | 0.903 | **0.895** |

Interval F1, expectation off:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.601 | 0.620 | 0.654 | 0.692 | 0.718 | 0.741 | 0.759 |
| 0.6 | 0.675 | 0.671 | 0.677 | 0.702 | 0.723 | 0.742 | 0.759 |
| 0.8 | 0.740 | 0.736 | 0.733 | 0.739 | 0.744 | 0.755 | 0.759 |
| 1.0 | 0.791 | 0.786 | 0.782 | 0.784 | 0.781 | 0.777 | 0.766 |
| 1.2 | 0.835 | 0.830 | 0.826 | 0.826 | 0.819 | 0.812 | 0.787 |
| 1.5 | 0.889 | 0.883 | 0.879 | 0.876 | 0.867 | 0.855 | 0.821 |

Interval F1, expectation 0.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.742 | 0.768 | 0.804 | 0.833 | 0.844 | 0.861 | 0.829 |
| 0.6 | 0.742 | 0.768 | 0.804 | 0.833 | 0.844 | 0.861 | 0.829 |
| 0.8 | 0.750 | 0.769 | 0.804 | 0.833 | 0.844 | 0.861 | 0.829 |
| 1.0 | 0.791 | 0.795 | 0.811 | 0.834 | 0.844 | 0.861 | 0.829 |
| 1.2 | 0.836 | 0.837 | 0.839 | 0.847 | 0.852 | 0.865 | 0.829 |
| 1.5 | 0.889 | 0.891 | 0.892 | 0.891 | 0.880 | 0.873 | 0.831 |

Interval F1, expectation 1.0 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.824 | 0.860 | 0.887 | 0.918 | 0.919 | 0.892 | 0.799 |
| 0.6 | 0.824 | 0.860 | 0.887 | 0.918 | 0.919 | 0.892 | 0.799 |
| 0.8 | 0.824 | 0.860 | 0.887 | 0.918 | 0.919 | 0.892 | 0.799 |
| 1.0 | 0.832 | 0.860 | 0.887 | 0.918 | 0.919 | 0.892 | 0.799 |
| 1.2 | 0.855 | 0.869 | 0.888 | 0.918 | 0.919 | 0.892 | 0.799 |
| 1.5 | 0.890 | 0.895 | 0.902 | 0.913 | 0.908 | 0.885 | 0.799 |

Interval F1, expectation 1.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.847 | 0.874 | 0.878 | 0.887 | 0.880 | 0.848 | 0.773 |
| 0.6 | 0.847 | 0.874 | 0.878 | 0.887 | 0.880 | 0.848 | 0.773 |
| 0.8 | 0.847 | 0.874 | 0.878 | 0.887 | 0.880 | 0.848 | 0.773 |
| 1.0 | 0.855 | 0.874 | 0.878 | 0.887 | 0.880 | 0.848 | 0.773 |
| 1.2 | 0.875 | 0.881 | 0.879 | 0.887 | 0.880 | 0.848 | 0.773 |
| 1.5 | 0.895 | 0.893 | 0.887 | 0.878 | 0.873 | 0.848 | 0.773 |

## Method

- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the results tables.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth episode / alerts; recall = truth episodes matched by an alert / truth episodes.
- Tuned on the tuning seeds only: `expect_s` × `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move, then the shorter expectation. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: 35 m for alert and truth (SPEC 4.4): on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on. The 25 m rows show the earlier SPEC value.
