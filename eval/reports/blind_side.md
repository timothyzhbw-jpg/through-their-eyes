# Blind-side alerts vs the sim's beliefs (SPEC 4.4)

`uv run python -m eval.blind_side`. Alerts: `analytics/blind_side.py` (observed head yaw and positions only). Truth: the sim's belief state.

| | Value |
|---|---|
| Chosen on tuning seeds | expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m; speed ≥ 4.0 m/s, range ≤ 35 m, on ≥ 0.4 s |
| Fresh held-out precision | **0.914** — ✅ meets the target ≥ 0.8 |
| Fresh held-out recall | **0.946** — ✅ meets the target ≥ 0.7 |
| `possession_play` alone (the general-play overlay) | precision **0.904**, recall 0.942 |
| Tuning seeds, same thresholds | precision 0.910, recall 0.935 |
| Fresh held-out data | `possession_play` 200–219 (20), `blind_side_run` 200–239 (40): 19.2 min of play, 2431 truth episodes, 2528 alerts |

**An upper bound for real tracking.** The truth is the sim's belief, which carries the last-seen velocity on for up to 1 s — the same constant-velocity extrapolation the alert's expectation (`expect_s`) uses. The alert and the truth share that model of what a player expects, so these numbers are an upper bound for real tracking, where nobody knows how a player extrapolates. The *best without expectation* rows do not share it.

## Fresh held-out seeds (acceptance)

`possession_play` 200–219 (20), `blind_side_run` 200–239 (40). No eval used these seeds before the parameters were chosen on the tuning seeds. Interval level (the unit a viewer sees) and frame level.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m | 0.914 | 0.946 | **0.930** | 2528 | 2431 | 0.903 | 0.747 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.853 | 0.931 | **0.890** | 2665 | 2431 | 0.850 | 0.740 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.704 | 0.955 | **0.811** | 3316 | 2431 | 0.711 | 0.781 |
| chosen, 25 m range for alert and truth | 0.912 | 0.946 | **0.929** | 1978 | 1898 | 0.866 | 0.751 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.839 | 0.977 | **0.903** | 2528 | 2194 | 0.572 | 0.901 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.918 | 0.379 | **0.536** | 2528 | 6327 | 0.824 | 0.370 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.904 | 0.942 | **0.923** | 2218 | 2122 | 0.901 | 0.736 |
| `possession_play`, best without expectation | 0.846 | 0.931 | **0.887** | 2344 | 2122 | 0.855 | 0.733 |
| `blind_side_run`, chosen | 0.981 | 0.977 | **0.979** | 310 | 309 | 0.916 | 0.852 |
| `blind_side_run`, best without expectation | 0.900 | 0.929 | **0.914** | 321 | 309 | 0.811 | 0.812 |

## What limits precision

Alerts that match no truth episode (fresh held-out, chosen thresholds):

| Reason | Alerts |
|---|---|
| the belief was never stale by > 3 m during the alert | 7 |
| stale only after the runner slowed below the run speed (the belief overshoots) | 6 |
| stale while watched for < 0.2 s (too short to be an episode) | 88 |
| stale only while the pair was not watched, or out of range | 117 |
| other | 0 |

- *Runner slowed:* he ran while unseen, the belief carried his velocity on, and it went stale only once he slowed — overshooting him. The truth counts an episode only if he runs while the belief is stale.
- *Never stale:* the belief stayed within 3 m of him for the whole alert.
- *Too short:* the pair was watched while the belief was stale for under 0.2 s.

## Old held-out seeds (seen during the design)

`possession_play` 100–119 (20), `blind_side_run` 100–139 (40). The truth episodes, the defender role hold and the expectation variant were settled after looking at these seeds, so they do not decide acceptance.

| Thresholds | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| **chosen**: expectation 1.0 s, unseen ≥ 1.2 s, moved ≥ 3.5 m | 0.917 | 0.940 | **0.928** | 2712 | 2645 | 0.913 | 0.734 |
| best without expectation: no expectation, unseen ≥ 1.5 s, moved ≥ 1.5 m | 0.859 | 0.926 | **0.891** | 2850 | 2645 | 0.861 | 0.725 |
| SPEC 4.4 starting values: no expectation, unseen ≥ 1.0 s, moved ≥ 3.0 m | 0.696 | 0.944 | **0.801** | 3589 | 2645 | 0.717 | 0.761 |
| chosen, 25 m range for alert and truth | 0.912 | 0.946 | **0.929** | 2141 | 2067 | 0.864 | 0.743 |
| chosen; truth variant: target ≥ 4.0 m/s on every frame | 0.849 | 0.972 | **0.906** | 2712 | 2402 | 0.581 | 0.902 |
| chosen; truth variant: target ≥ 2 m/s on every frame | 0.919 | 0.406 | **0.563** | 2712 | 6448 | 0.834 | 0.395 |

| Scenario | Precision | Recall | F1 | Alerts | Truth intervals | Frame P | Frame R |
|---|---|---|---|---|---|---|---|
| `possession_play`, chosen | 0.913 | 0.936 | **0.924** | 2432 | 2375 | 0.913 | 0.727 |
| `possession_play`, best without expectation | 0.851 | 0.927 | **0.888** | 2583 | 2375 | 0.862 | 0.722 |
| `blind_side_run`, chosen | 0.954 | 0.974 | **0.964** | 280 | 270 | 0.913 | 0.839 |
| `blind_side_run`, best without expectation | 0.936 | 0.911 | **0.924** | 267 | 270 | 0.852 | 0.775 |

## Tuning seeds

`possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Best (unseen, moved) per expectation horizon, by interval F1:

| Expectation (s) | Unseen ≥ (s) | Moved ≥ (m) | Precision | Recall | F1 |
|---|---|---|---|---|---|
| off | 1.5 | 1.5 | 0.840 | 0.925 | **0.880** |
| 0.5 | 1.5 | 3.0 | 0.863 | 0.916 | **0.889** |
| 1.0 ⬅ | 1.2 | 3.5 | 0.910 | 0.935 | **0.922** |
| 1.5 | 1.2 | 3.0 | 0.889 | 0.901 | **0.895** |

Interval F1, expectation off:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.586 | 0.605 | 0.642 | 0.676 | 0.712 | 0.735 | 0.759 |
| 0.6 | 0.657 | 0.656 | 0.662 | 0.685 | 0.717 | 0.737 | 0.759 |
| 0.8 | 0.733 | 0.732 | 0.729 | 0.732 | 0.742 | 0.752 | 0.764 |
| 1.0 | 0.785 | 0.783 | 0.778 | 0.778 | 0.779 | 0.774 | 0.768 |
| 1.2 | 0.837 | 0.835 | 0.830 | 0.828 | 0.826 | 0.816 | 0.793 |
| 1.5 | 0.880 | 0.879 | 0.873 | 0.870 | 0.865 | 0.854 | 0.822 |

Interval F1, expectation 0.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.732 | 0.763 | 0.798 | 0.827 | 0.848 | 0.857 | 0.824 |
| 0.6 | 0.732 | 0.763 | 0.798 | 0.827 | 0.848 | 0.857 | 0.824 |
| 0.8 | 0.742 | 0.765 | 0.798 | 0.827 | 0.848 | 0.857 | 0.824 |
| 1.0 | 0.786 | 0.790 | 0.803 | 0.828 | 0.848 | 0.857 | 0.824 |
| 1.2 | 0.838 | 0.841 | 0.843 | 0.850 | 0.858 | 0.861 | 0.826 |
| 1.5 | 0.882 | 0.885 | 0.886 | 0.889 | 0.883 | 0.872 | 0.822 |

Interval F1, expectation 1.0 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.820 | 0.854 | 0.880 | 0.914 | 0.922 | 0.899 | 0.810 |
| 0.6 | 0.820 | 0.854 | 0.880 | 0.914 | 0.922 | 0.899 | 0.810 |
| 0.8 | 0.820 | 0.854 | 0.880 | 0.914 | 0.922 | 0.899 | 0.810 |
| 1.0 | 0.829 | 0.855 | 0.880 | 0.914 | 0.922 | 0.899 | 0.810 |
| 1.2 | 0.855 | 0.867 | 0.884 | 0.914 | 0.922 | 0.899 | 0.810 |
| 1.5 | 0.882 | 0.887 | 0.895 | 0.908 | 0.908 | 0.889 | 0.807 |

Interval F1, expectation 1.5 s:

| Unseen ≥ (s) \ moved ≥ (m) | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|
| 0.4 | 0.840 | 0.869 | 0.887 | 0.895 | 0.880 | 0.849 | 0.776 |
| 0.6 | 0.840 | 0.869 | 0.887 | 0.895 | 0.880 | 0.849 | 0.776 |
| 0.8 | 0.840 | 0.869 | 0.887 | 0.895 | 0.880 | 0.849 | 0.776 |
| 1.0 | 0.850 | 0.869 | 0.887 | 0.895 | 0.880 | 0.849 | 0.776 |
| 1.2 | 0.873 | 0.881 | 0.887 | 0.895 | 0.880 | 0.849 | 0.776 |
| 1.5 | 0.887 | 0.888 | 0.886 | 0.881 | 0.870 | 0.848 | 0.776 |

## Method

- Truth: stale-belief episodes — watched pair, belief error > 3 m (the sim's extrapolated belief, sampled before every step), target within the alert's range — in which the target ran at ≥ 4.0 m/s at least once. Episodes: gaps ≤ 0.2 s bridged, episodes < 0.2 s dropped. In the truth the intended receiver is the pass event's `to`; the alert infers him from the ball's line.
- Why episodes: the alert's speed is an onset condition and it then holds until the target is seen. A truth that needs 4 m/s on every frame flickers when a runner slows while still unseen; one that needs only 2 m/s adds stale beliefs about joggers that the alert is not meant to raise. Both variants are in the results tables.
- Matching: same (observer, target), intervals overlapping within ±0.5 s. Precision = alerts that match a truth episode / alerts; recall = truth episodes matched by an alert / truth episodes.
- Tuned on the tuning seeds only: `expect_s` × `min_unseen_s` × `min_moved_m` by interval F1; ties go to the longer unseen time, then the larger move, then the shorter expectation. Fixed: speed, range and the 0.4 s hold, which also define the truth or come from SPEC 4.4.
- Range: 35 m for alert and truth (SPEC 4.4): on `blind_side_run` the runner H9 is 22–30 m from H8 when the alert should be on. The 25 m rows show the earlier SPEC value.
