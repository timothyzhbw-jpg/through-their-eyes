# Corruption eval — claims verifier

Scenario `blind_side_run`, seeds 0–19 (20): the factual run and the drop-key-scan counterfactual per seed. Claims come from `explain/builders.py` (17 facts); 100 perturbations, an equal share per type. Each perturbed sentence is judged by the verifier and by an independent ground-truth oracle (`eval/corruption.py`, plain numpy over the run, never through `explain/`). Numbers are true when the truth rounds to the shown value (half a display unit).

| Metric | Value | Target (SPEC 5.3) |
|---|---|---|
| Generated claims verified `supported` | 335/335 (100%) | all |
| Perturbations false under ground truth | 89 | — |
| … refuted by the verifier | **89/89 (100%)** | ≥ 98% |
| … blocked (refuted or inconclusive) | 89/89 (100%) | — |
| Perturbations still true (excluded) | 9 | reported |
| Perturbations the recording cannot decide (excluded) | 2 | reported |
| Still-true perturbations verified `supported` | 9/9 (100%) | — |
| Unsupported perturbed claims that rendered | 0 | 0 |
| Supported claims rendered in en + zh, render check clean | 670/670 (100%) | all |
| Render payloads (seed × language) re-checked clean | 40/40, 710 lines, 0 violations | all |
| Claims labelled observed / computed / counterfactual | 220 / 80 / 35 | every claim |
| Claims anchored on the moment card | 260/335 (78%) | — |
| Verdicts written to the audit log | 435/435 | all |

Result: PASS (refutation 100.0%).

## By perturbation

| Perturbation | n | False | Refuted | Still true | Undecidable |
|---|---|---|---|---|---|
| `number_pm1` | 25 | 25 | 25 | 0 | 0 |
| `number_pm20` | 25 | 25 | 25 | 0 | 0 |
| `swap_player` | 25 | 22 | 22 | 3 | 0 |
| `wrong_order` | 25 | 17 | 17 | 6 | 2 |

## By fact

| Fact | Kind | Generated | Supported | Perturbed | False | Refuted |
|---|---|---|---|---|---|---|
| `belief_error` | computed | 20 | 20 | 3 | 3 | 3 |
| `blind_side` | computed | 20 | 20 | 6 | 2 | 2 |
| `cf_pass` | counterfactual | 15 | 15 | 2 | 2 | 2 |
| `cf_value` | counterfactual | 20 | 20 | 4 | 4 | 4 |
| `gap_opened` | observed | 20 | 20 | 11 | 9 | 9 |
| `gap_to_marker` | observed | 20 | 20 | 11 | 7 | 7 |
| `gap_to_nearest_opponent` | observed | 20 | 20 | 5 | 5 | 5 |
| `key_scan_duration` | observed | 20 | 20 | 6 | 6 | 6 |
| `observed_share` | computed | 20 | 20 | 6 | 6 | 6 |
| `pass_speed` | observed | 20 | 20 | 2 | 2 | 2 |
| `pass_to_runner` | observed | 20 | 20 | 6 | 6 | 6 |
| `pressure_at_pass` | computed | 20 | 20 | 5 | 5 | 5 |
| `runner_received` | observed | 20 | 20 | 8 | 8 | 8 |
| `scan_before_reception` | observed | 20 | 20 | 8 | 8 | 8 |
| `scans_before_reception` | observed | 20 | 20 | 8 | 7 | 7 |
| `time_since_last_scan` | observed | 20 | 20 | 7 | 7 | 7 |
| `unmarked` | observed | 20 | 20 | 2 | 2 | 2 |

## False perturbations not refuted

None.

## Excluded: still true

| Seed | Fact | Perturbation | Change | Verifier | Reason |
|---|---|---|---|---|---|
| 16 | `scans_before_reception` | `swap_player` | player: H8 → A3 | supported | eq(1, 1) holds |
| 11 | `blind_side` | `swap_player` | runner: H9 → A3 | supported | eq(True, True) holds |
| 10 | `blind_side` | `swap_player` | runner: H9 → H10 | supported | eq(True, True) holds |
| 19 | `gap_opened` | `wrong_order` | runner ↔ marker | supported | all 2 conditions hold |
| 5 | `gap_opened` | `wrong_order` | runner ↔ marker | supported | all 2 conditions hold |
| 11 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(12.882016819024095, 12.9) holds |
| 12 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(13.5026439845338, 13.5) holds |
| 19 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(11.882355153926314, 11.9) holds |
| 2 | `gap_to_marker` | `wrong_order` | runner ↔ marker | supported | approx(10.74324669501875, 10.7) holds |

## Excluded: not decidable from the recording

| Seed | Fact | Perturbation | Change | Verifier | Reason |
|---|---|---|---|---|---|
| 4 | `blind_side` | `wrong_order` | runner ↔ player | inconclusive | no scan by H9 recorded up to frame 66 |
| 9 | `blind_side` | `wrong_order` | runner ↔ player | inconclusive | no scan by H9 recorded up to frame 68 |

## Rendered claims, seed 0

Player ids stand in for display names.

| Fact | en | zh |
|---|---|---|
| `belief_error` | When he played the pass, H8's picture of H9 was off by 0.3 metres. | 出球时，H8对H9位置的判断只差0.3米。 |
| `blind_side` | H9's run was on H8's blind side. | H9的跑位在H8的盲区。 |
| `cf_pass` | Without that look, H8 would have passed to H1. | 如果没有那一眼，H8会把球传给H1。 |
| `cf_value` | That look was worth 0.09 in expected threat. | 那一眼带来了0.09的预期威胁（xT）。 |
| `gap_opened` | While the ball travelled to H8, H9 opened up 6.9 metres on A5. | 球传向H8的途中，H9把与A5的距离拉开了6.9米。 |
| `gap_to_marker` | H9 was 10.5 metres clear of A5 when the pass was played. | 出球时，H9与A5相距10.5米。 |
| `gap_to_nearest_opponent` | H9 had 10.5 metres to the nearest opponent when the pass was played. | 出球时，H9离最近的对手有10.5米。 |
| `key_scan_duration` | H8's look over his shoulder lasted 0.56 seconds. | H8这一眼回头持续了0.56秒。 |
| `observed_share` | In the 1 second before receiving, H8 saw 64% of the space the opponents controlled. | 接球前1秒内，H8看到了对手控制区域的64%。 |
| `pass_speed` | H8's pass left his foot at 81 km/h. | H8这脚传球的出球时速为81公里。 |
| `pass_to_runner` | H8 found H9 with a 40-metre pass. | H8一脚40米的传球找到了H9。 |
| `pressure_at_pass` | Pressing intensity on H8 was 2% when he released the ball. | 出球时，H8承受的逼抢强度为2%。 |
| `runner_received` | H9 took the pass from H8. | H9接到了H8的传球。 |
| `scan_before_reception` | H8 checked his shoulder before the ball reached him. | 球到之前，H8先回头看了一眼。 |
| `scans_before_reception` | H8 scanned once in the 2 seconds before receiving. | 接球前2秒内，H8扫视了1次。 |
| `time_since_last_scan` | H8 had last checked his shoulder 0.8 seconds before the ball arrived. | 球到脚下时，H8距上次回头观察已过去0.8秒。 |
| `unmarked` | H9 was unmarked when H8 released the ball. | H8出球时，H9无人盯防。 |

Verdicts on all perturbations: {'inconclusive': 2, 'refuted': 89, 'supported': 9}.
