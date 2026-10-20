# Corruption eval — claims verifier

Scenario `blind_side_run`, seeds 0–19 (20): the factual run and the drop-key-scan counterfactual per seed. Claims come from `explain/builders.py` (24 facts); 100 perturbations, an equal share per type. Each perturbed sentence is judged by the verifier and by an independent ground-truth oracle (`eval/corruption.py`, plain numpy over the run, never through `explain/`). Numbers are true when the truth rounds to the shown value (half a display unit).

| Metric | Value | Target (SPEC 5.3) |
|---|---|---|
| Generated claims verified `supported` | 468/468 (100%) | all |
| Perturbations false under ground truth | 90 | — |
| … refuted by the verifier | **90/90 (100%)** | ≥ 98% |
| … blocked (refuted or inconclusive) | 90/90 (100%) | — |
| Perturbations still true (excluded) | 6 | reported |
| Perturbations the recording cannot decide (excluded) | 4 | reported |
| Still-true perturbations verified `supported` | 6/6 (100%) | — |
| Unsupported perturbed claims that rendered | 0 | 0 |
| Supported claims rendered in en + zh, render check clean | 936/936 (100%) | all |
| Render payloads (seed × language) re-checked clean | 40/40, 976 lines, 0 violations | all |
| Claims labelled observed / computed / counterfactual | 280 / 140 / 48 | every claim |
| Claims anchored on the moment card | 374/468 (80%) | — |
| Verdicts written to the audit log | 568/568 | all |

Result: PASS (refutation 100.0%).

## By perturbation

| Perturbation | n | False | Refuted | Still true | Undecidable |
|---|---|---|---|---|---|
| `number_pm1` | 25 | 25 | 25 | 0 | 0 |
| `number_pm20` | 25 | 25 | 25 | 0 | 0 |
| `swap_player` | 25 | 21 | 21 | 3 | 1 |
| `wrong_order` | 25 | 19 | 19 | 3 | 3 |

## By fact

| Fact | Kind | Generated | Supported | Perturbed | False | Refuted |
|---|---|---|---|---|---|---|
| `belief_error` | computed | 20 | 20 | 9 | 9 | 9 |
| `blind_side` | computed | 20 | 20 | 8 | 4 | 4 |
| `cf_pass` | counterfactual | 14 | 14 | 3 | 3 | 3 |
| `cf_pass_success` | counterfactual | 14 | 14 | 0 | 0 | 0 |
| `cf_value` | counterfactual | 20 | 20 | 3 | 3 | 3 |
| `gap_opened` | observed | 20 | 20 | 5 | 4 | 4 |
| `gap_to_marker` | observed | 20 | 20 | 7 | 5 | 5 |
| `gap_to_nearest_opponent` | observed | 20 | 20 | 5 | 5 | 5 |
| `key_scan_duration` | observed | 20 | 20 | 6 | 6 | 6 |
| `observed_share` | computed | 20 | 20 | 6 | 6 | 6 |
| `pass_speed` | observed | 20 | 20 | 4 | 4 | 4 |
| `pass_success` | computed | 20 | 20 | 0 | 0 | 0 |
| `pass_to_runner` | observed | 20 | 20 | 9 | 9 | 9 |
| `presser_distance` | observed | 20 | 20 | 3 | 3 | 3 |
| `pressure_at_pass` | computed | 20 | 20 | 5 | 4 | 4 |
| `receiver_pressure` | computed | 20 | 20 | 2 | 2 | 2 |
| `reception_zone` | observed | 20 | 20 | 3 | 3 | 3 |
| `runner_received` | observed | 20 | 20 | 3 | 3 | 3 |
| `scan_before_reception` | observed | 20 | 20 | 4 | 4 | 4 |
| `scan_side` | observed | 20 | 20 | 1 | 1 | 1 |
| `scans_before_reception` | observed | 20 | 20 | 2 | 1 | 1 |
| `seen_in_scan` | computed | 20 | 20 | 3 | 2 | 2 |
| `time_since_last_scan` | observed | 20 | 20 | 7 | 7 | 7 |
| `unmarked` | observed | 20 | 20 | 2 | 2 | 2 |

## False perturbations not refuted

None.

## Excluded: still true

| Seed | Fact | Perturbation | Change | Verifier | Reason |
|---|---|---|---|---|---|
| 19 | `blind_side` | `swap_player` | player: H8 → H10 | supported | eq(True, True) holds |
| 3 | `scans_before_reception` | `swap_player` | player: H8 → H11 | supported | eq(1, 1) holds |
| 2 | `seen_in_scan` | `swap_player` | runner: H9 → H4 | supported | all 4 conditions hold |
| 16 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(12.976511842370128, 13.0) holds |
| 9 | `gap_opened` | `wrong_order` | runner ↔ marker | supported | all 2 conditions hold |
| 17 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(11.640219119516154, 11.6) holds |

## Excluded: not decidable from the recording

| Seed | Fact | Perturbation | Change | Verifier | Reason |
|---|---|---|---|---|---|
| 15 | `pressure_at_pass` | `swap_player` | player: H8 → A6 | inconclusive | A6 is not on the team in possession at frame 75 |
| 7 | `blind_side` | `wrong_order` | runner ↔ player | inconclusive | no scan by H9 recorded up to frame 67 |
| 1 | `blind_side` | `wrong_order` | runner ↔ player | inconclusive | no scan by H9 recorded up to frame 68 |
| 8 | `blind_side` | `wrong_order` | runner ↔ player | inconclusive | no scan by H9 recorded up to frame 68 |

## Rendered claims, seed 0

Player ids stand in for display names.

| Fact | en | zh |
|---|---|---|
| `belief_error` | When he played the pass, H8's picture of H9 was off by 0.5 metres. | 出球时，H8对H9位置的判断只差0.5米。 |
| `blind_side` | H9's run was on H8's blind side. | H9的跑位在H8的盲区。 |
| `cf_pass` | Without that look, H8 would have passed to H1. | 如果没有那一眼，H8会把球传给H1。 |
| `cf_pass_success` | Without that look, H8 thought the pass to H9 had a 0.07 chance of arriving; it was 0.90. | 如果没有那一眼，H8以为传给H9的球到达的概率是0.07，实际是0.90。 |
| `cf_value` | That look was worth 0.09 in expected threat. | 那一眼带来了0.09的预期威胁（xT）。 |
| `gap_opened` | While the ball travelled to H8, H9 opened up 6.9 metres on A5. | 球传向H8的途中，H9把与A5的距离拉开了6.9米。 |
| `gap_to_marker` | H9 was 10.5 metres clear of A5 when the pass was played. | 出球时，H9与A5相距10.5米。 |
| `gap_to_nearest_opponent` | H9 had 10.5 metres to the nearest opponent when the pass was played. | 出球时，H9离最近的对手有10.5米。 |
| `key_scan_duration` | H8's look over his shoulder lasted 0.80 seconds. | H8这一眼回头持续了0.80秒。 |
| `observed_share` | In the 1 second before receiving, H8 saw 65% of the space the opponents controlled. | 接球前1秒内，H8看到了对手控制区域的65%。 |
| `pass_speed` | H8's pass left his foot at 82 km/h. | H8这脚传球的出球时速为82公里。 |
| `pass_success` | H8 thought the pass to H9 had a 0.83 chance of arriving; it was 0.90. | H8以为传给H9的球到达的概率是0.83，实际是0.90。 |
| `pass_to_runner` | H8 found H9 with a 41-metre pass. | H8一脚41米的传球找到了H9。 |
| `presser_distance` | The nearest opponent, A8, was 9.8 metres from H8 when he released the ball. | H8出球时，离他最近的对手是A8，相距9.8米。 |
| `pressure_at_pass` | Pressing intensity on H8 was 0% when he released the ball. | 出球时，H8承受的逼抢强度为0%。 |
| `receiver_pressure` | When the pass reached H9, pressing intensity on him was 0%. | 球到H9脚下时，他承受的逼抢强度为0%。 |
| `reception_zone` | H8 received the ball in the opponents' half, right of centre. | H8在对方半场中路偏右接球。 |
| `runner_received` | H9 took the pass from H8. | H9接到了H8的传球。 |
| `scan_before_reception` | H8 checked his shoulder before the ball reached him. | 球到之前，H8先回头看了一眼。 |
| `scan_side` | Before the ball reached him, H8 looked over his right shoulder. | 球到之前，H8扭头看向了右后方。 |
| `scans_before_reception` | H8 scanned once in the 2 seconds before receiving. | 接球前2秒内，H8扫视了1次。 |
| `seen_in_scan` | When H8 looked over his shoulder before the ball arrived, he saw H9. | 球到之前回头的那一眼，H8看到了H9。 |
| `time_since_last_scan` | H8 had last checked his shoulder 0.8 seconds before the ball arrived. | 球到脚下时，H8距上次回头观察已过去0.8秒。 |
| `unmarked` | H9 was unmarked when H8 released the ball. | H8出球时，H9无人盯防。 |

Verdicts on all perturbations: {'inconclusive': 4, 'refuted': 90, 'supported': 6}.
