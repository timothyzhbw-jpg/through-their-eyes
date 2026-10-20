# Corruption eval — claims verifier

Scenario `blind_side_run`, seeds 0–19 (20): the factual run and the drop-key-scan counterfactual per seed. Claims come from `explain/builders.py` (19 facts); 100 perturbations, an equal share per type. Each perturbed sentence is judged by the verifier and by an independent ground-truth oracle (`eval/corruption.py`, plain numpy over the run, never through `explain/`). Numbers are true when the truth rounds to the shown value (half a display unit).

| Metric | Value | Target (SPEC 5.3) |
|---|---|---|
| Generated claims verified `supported` | 368/368 (100%) | all |
| Perturbations false under ground truth | 88 | — |
| … refuted by the verifier | **88/88 (100%)** | ≥ 98% |
| … blocked (refuted or inconclusive) | 88/88 (100%) | — |
| Perturbations still true (excluded) | 10 | reported |
| Perturbations the recording cannot decide (excluded) | 2 | reported |
| Still-true perturbations verified `supported` | 10/10 (100%) | — |
| Unsupported perturbed claims that rendered | 0 | 0 |
| Supported claims rendered in en + zh, render check clean | 736/736 (100%) | all |
| Render payloads (seed × language) re-checked clean | 40/40, 776 lines, 0 violations | all |
| Claims labelled observed / computed / counterfactual | 220 / 100 / 48 | every claim |
| Claims anchored on the moment card | 294/368 (80%) | — |
| Verdicts written to the audit log | 468/468 | all |

Result: PASS (refutation 100.0%).

## By perturbation

| Perturbation | n | False | Refuted | Still true | Undecidable |
|---|---|---|---|---|---|
| `number_pm1` | 25 | 25 | 25 | 0 | 0 |
| `number_pm20` | 25 | 25 | 25 | 0 | 0 |
| `swap_player` | 25 | 22 | 22 | 3 | 0 |
| `wrong_order` | 25 | 16 | 16 | 7 | 2 |

## By fact

| Fact | Kind | Generated | Supported | Perturbed | False | Refuted |
|---|---|---|---|---|---|---|
| `belief_error` | computed | 20 | 20 | 4 | 4 | 4 |
| `blind_side` | computed | 20 | 20 | 6 | 2 | 2 |
| `cf_pass` | counterfactual | 14 | 14 | 4 | 4 | 4 |
| `cf_pass_success` | counterfactual | 14 | 14 | 0 | 0 | 0 |
| `cf_value` | counterfactual | 20 | 20 | 4 | 4 | 4 |
| `gap_opened` | observed | 20 | 20 | 10 | 9 | 9 |
| `gap_to_marker` | observed | 20 | 20 | 13 | 7 | 7 |
| `gap_to_nearest_opponent` | observed | 20 | 20 | 5 | 5 | 5 |
| `key_scan_duration` | observed | 20 | 20 | 7 | 7 | 7 |
| `observed_share` | computed | 20 | 20 | 6 | 6 | 6 |
| `pass_speed` | observed | 20 | 20 | 2 | 2 | 2 |
| `pass_success` | computed | 20 | 20 | 0 | 0 | 0 |
| `pass_to_runner` | observed | 20 | 20 | 7 | 7 | 7 |
| `pressure_at_pass` | computed | 20 | 20 | 5 | 4 | 4 |
| `runner_received` | observed | 20 | 20 | 6 | 6 | 6 |
| `scan_before_reception` | observed | 20 | 20 | 5 | 5 | 5 |
| `scans_before_reception` | observed | 20 | 20 | 7 | 7 | 7 |
| `time_since_last_scan` | observed | 20 | 20 | 7 | 7 | 7 |
| `unmarked` | observed | 20 | 20 | 2 | 2 | 2 |

## False perturbations not refuted

None.

## Excluded: still true

| Seed | Fact | Perturbation | Change | Verifier | Reason |
|---|---|---|---|---|---|
| 18 | `pressure_at_pass` | `swap_player` | player: H8 → H1 | supported | approx(6.661338147750939e-16, 0.0) holds |
| 11 | `blind_side` | `swap_player` | runner: H9 → A3 | supported | eq(True, True) holds |
| 10 | `blind_side` | `swap_player` | runner: H9 → H10 | supported | eq(True, True) holds |
| 14 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(11.969774147898589, 12.0) holds |
| 5 | `gap_opened` | `wrong_order` | runner ↔ marker | supported | all 2 conditions hold |
| 15 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(10.726468688150169, 10.7) holds |
| 11 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(12.882016819024093, 12.9) holds |
| 12 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(13.502643984533806, 13.5) holds |
| 19 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(11.882355153926314, 11.9) holds |
| 2 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(10.743246695018742, 10.7) holds |

## Excluded: not decidable from the recording

| Seed | Fact | Perturbation | Change | Verifier | Reason |
|---|---|---|---|---|---|
| 4 | `blind_side` | `wrong_order` | runner ↔ player | inconclusive | no scan by H9 recorded up to frame 66 |
| 9 | `blind_side` | `wrong_order` | runner ↔ player | inconclusive | no scan by H9 recorded up to frame 68 |

## Rendered claims, seed 0

Player ids stand in for display names.

| Fact | en | zh |
|---|---|---|
| `belief_error` | When he played the pass, H8's picture of H9 was off by 0.5 metres. | 出球时，H8对H9位置的判断只差0.5米。 |
| `blind_side` | H9's run was on H8's blind side. | H9的跑位在H8的盲区。 |
| `cf_pass` | Without that look, H8 would have passed to H1. | 如果没有那一眼，H8会把球传给H1。 |
| `cf_pass_success` | Without that look, H8 thought the pass to H9 had a 0.07 chance of arriving; it was 0.90. | 如果没有那一眼，H8以为传给H9的球到达的概率是0.07，实际是0.90。 |
| `cf_value` | That look was worth 0.13 in expected threat. | 那一眼带来了0.13的预期威胁（xT）。 |
| `gap_opened` | While the ball travelled to H8, H9 opened up 6.9 metres on A5. | 球传向H8的途中，H9把与A5的距离拉开了6.9米。 |
| `gap_to_marker` | H9 was 10.5 metres clear of A5 when the pass was played. | 出球时，H9与A5相距10.5米。 |
| `gap_to_nearest_opponent` | H9 had 10.5 metres to the nearest opponent when the pass was played. | 出球时，H9离最近的对手有10.5米。 |
| `key_scan_duration` | H8's look over his shoulder lasted 0.80 seconds. | H8这一眼回头持续了0.80秒。 |
| `observed_share` | In the 1 second before receiving, H8 saw 65% of the space the opponents controlled. | 接球前1秒内，H8看到了对手控制区域的65%。 |
| `pass_speed` | H8's pass left his foot at 82 km/h. | H8这脚传球的出球时速为82公里。 |
| `pass_success` | H8 thought the pass to H9 had a 0.83 chance of arriving; it was 0.90. | H8以为传给H9的球到达的概率是0.83，实际是0.90。 |
| `pass_to_runner` | H8 found H9 with a 41-metre pass. | H8一脚41米的传球找到了H9。 |
| `pressure_at_pass` | Pressing intensity on H8 was 0% when he released the ball. | 出球时，H8承受的逼抢强度为0%。 |
| `runner_received` | H9 took the pass from H8. | H9接到了H8的传球。 |
| `scan_before_reception` | H8 checked his shoulder before the ball reached him. | 球到之前，H8先回头看了一眼。 |
| `scans_before_reception` | H8 scanned once in the 2 seconds before receiving. | 接球前2秒内，H8扫视了1次。 |
| `time_since_last_scan` | H8 had last checked his shoulder 0.8 seconds before the ball arrived. | 球到脚下时，H8距上次回头观察已过去0.8秒。 |
| `unmarked` | H9 was unmarked when H8 released the ball. | H8出球时，H9无人盯防。 |

Verdicts on all perturbations: {'inconclusive': 2, 'refuted': 88, 'supported': 10}.
