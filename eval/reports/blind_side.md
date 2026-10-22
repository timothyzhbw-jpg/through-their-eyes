# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen on tuning seeds | expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Fresh held-out precision | **0.915** — ✅ meets the target ≥ 0.8 |
| Fresh held-out recall | **0.943** — ✅ meets the target ≥ 0.7 |
| `possession_play` alone (the general-play overlay) | precision **0.906**, recall 0.941 |
| Tuning seeds, same thresholds | precision 0.910, recall 0.937 |
| Fresh held-out data | `possession_play` 200–219 (20), `blind_side_run` 200–239 (40): 19.2 min of play, 2435 truth episodes, 2521 alerts |

**An upper bound for real tracking.** The truth is the sim's belief, which carries the last-seen velocity on for up to 1 s — the same constant-velocity extrapolation the alert's expectation (`expect_s`) uses. The alert and the truth share that model of what a player expects, so these numbers are an upper bound for real tracking, where nobody knows how a player extrapolates. The *best without expectation* rows do not share it.

## Fresh held-out seeds (acceptance)

`possession_play` 200–219 (20), `blind_side_run` 200–239 (40). No eval used these seeds before the parameters were chosen on the tuning seeds. Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m | 0.915 | 0.943 | **0.929** | 2521 | 2435 | 0.903 | 0.748 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.859 | 0.932 | **0.894** | 2655 | 2435 | 0.853 | 0.743 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.707 | 0.958 | **0.814** | 3316 | 2435 | 0.713 | 0.785 |
| chosen, 25 m range for alert and truth | 0.912 | 0.944 | **0.928** | 1977 | 1902 | 0.867 | 0.751 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.843 | 0.977 | **0.905** | 2521 | 2196 | 0.571 | 0.902 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.919 | 0.380 | **0.538** | 2521 | 6297 | 0.824 | 0.372 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.906 | 0.941 | **0.923** | 2206 | 2116 | 0.902 | 0.738 |
| `possession_play`, best without expectation | 0.849 | 0.931 | **0.888** | 2329 | 2116 | 0.856 | 0.736 |
| `blind_side_run`, chosen | 0.978 | 0.959 | **0.968** | 315 | 319 | 0.915 | 0.837 |
| `blind_side_run`, best without expectation | 0.926 | 0.940 | **0.933** | 326 | 319 | 0.830 | 0.817 |

## What limits precision

Alerts that match no truth episode (fresh held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 7 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 6 |
| stale while watched for < 0.2 s (too short to be an episode) | 88 |
| stale only while the pair was not watched, or out of range | 113 |
| other | 0 |

- *Runner slowed:* he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale.
- *Never stale:* the belief stayed within 3 m of him for the whole alert.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Old held-out seeds (seen during the design)

`possession_play` 100–119 (20), `blind_side_run` 100–139 (40). The truth episodes, the defender role hold and the expectation variant were settled after looking at these seeds, so they do not decide acceptance.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m | 0.920 | 0.941 | **0.931** | 2679 | 2616 | 0.912 | 0.735 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.860 | 0.922 | **0.890** | 2809 | 2616 | 0.859 | 0.725 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.696 | 0.943 | **0.801** | 3551 | 2616 | 0.714 | 0.761 |
| chosen, 25 m range for alert and truth | 0.916 | 0.947 | **0.931** | 2121 | 2051 | 0.865 | 0.745 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.853 | 0.973 | **0.909** | 2679 | 2381 | 0.580 | 0.900 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.922 | 0.406 | **0.564** | 2679 | 6393 | 0.832 | 0.393 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.915 | 0.938 | **0.926** | 2387 | 2330 | 0.912 | 0.728 |
| `possession_play`, best without expectation | 0.851 | 0.925 | **0.887** | 2530 | 2330 | 0.860 | 0.722 |
| `blind_side_run`, chosen | 0.966 | 0.969 | **0.967** | 292 | 286 | 0.916 | 0.842 |
| `blind_side_run`, best without expectation | 0.935 | 0.895 | **0.915** | 279 | 286 | 0.842 | 0.775 |

## Tuning seeds

`possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Best (unseen, moved) per expectation horizon, by interval F1:

| Expectation (s) | Unseen ≥ (s) | Moved ≥ (m) | Precision | Recall | F1 |
|---|---|---|---|---|---|
| off | 1.5 | 1.5 | 0.842 | 0.925 | **0.881** |
| 0.5 | 1.5 | 3.0 | 0.864 | 0.917 | **0.890** |
| 1.0 ⬅ | 1.2 | 3.5 | 0.910 | 0.937 | **0.923** |
| 1.5 | 1.2 | 3.0 | 0.889 | 0.902 | **0.895** |

Interval F1, expectation off:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.590 | 0.609 | 0.645 | 0.681 | 0.714 | 0.737 | 0.759 |
| 0.6 | 0.661 | 0.660 | 0.667 | 0.691 | 0.720 | 0.738 | 0.759 |
| 0.8 | 0.734 | 0.732 | 0.730 | 0.734 | 0.742 | 0.752 | 0.764 |
| 1.0 | 0.787 | 0.785 | 0.781 | 0.782 | 0.781 | 0.776 | 0.769 |
| 1.2 | 0.837 | 0.836 | 0.832 | 0.831 | 0.826 | 0.816 | 0.793 |
| 1.5 | 0.881 | 0.880 | 0.875 | 0.873 | 0.866 | 0.854 | 0.823 |

Interval F1, expectation 0.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.734 | 0.764 | 0.798 | 0.829 | 0.850 | 0.857 | 0.827 |
| 0.6 | 0.734 | 0.764 | 0.798 | 0.829 | 0.850 | 0.857 | 0.827 |
| 0.8 | 0.742 | 0.766 | 0.798 | 0.829 | 0.850 | 0.857 | 0.827 |
| 1.0 | 0.788 | 0.791 | 0.804 | 0.830 | 0.850 | 0.857 | 0.827 |
| 1.2 | 0.839 | 0.842 | 0.843 | 0.851 | 0.861 | 0.862 | 0.829 |
| 1.5 | 0.883 | 0.886 | 0.887 | 0.890 | 0.885 | 0.873 | 0.826 |

Interval F1, expectation 1.0 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.821 | 0.855 | 0.880 | 0.913 | 0.923 | 0.902 | 0.812 |
| 0.6 | 0.821 | 0.855 | 0.880 | 0.913 | 0.923 | 0.902 | 0.812 |
| 0.8 | 0.821 | 0.855 | 0.880 | 0.913 | 0.923 | 0.902 | 0.812 |
| 1.0 | 0.830 | 0.855 | 0.880 | 0.913 | 0.923 | 0.902 | 0.812 |
| 1.2 | 0.856 | 0.867 | 0.884 | 0.913 | 0.923 | 0.902 | 0.812 |
| 1.5 | 0.884 | 0.888 | 0.895 | 0.908 | 0.909 | 0.891 | 0.809 |

Interval F1, expectation 1.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.840 | 0.871 | 0.888 | 0.895 | 0.881 | 0.851 | 0.780 |
| 0.6 | 0.840 | 0.871 | 0.888 | 0.895 | 0.881 | 0.851 | 0.780 |
| 0.8 | 0.841 | 0.871 | 0.888 | 0.895 | 0.881 | 0.851 | 0.780 |
| 1.0 | 0.850 | 0.871 | 0.888 | 0.895 | 0.881 | 0.851 | 0.780 |
| 1.2 | 0.874 | 0.882 | 0.888 | 0.895 | 0.881 | 0.851 | 0.780 |
| 1.5 | 0.888 | 0.889 | 0.887 | 0.881 | 0.873 | 0.851 | 0.780 |

## Method

- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the results tables.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth episode / alerts; recall = truth episodes matched by an alert / truth episodes.
- Tuned on the tuning seeds only: `expect_s` × `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move, then the shorter expectation. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: 35 m for alert and truth (SPEC 4.4): on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on. The 25 m rows show the earlier SPEC value.
