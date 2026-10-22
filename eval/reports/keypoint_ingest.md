# Scan detector on limb tracking (SPEC 4.7)

`uv run python -m eval.keypoint_ingest`. Does the Ingest stage accept limb tracking? A synthetic keypoint stream (`sim/keypoints.py`: nose, ears, shoulders and hips, COCO names, metres on the pitch) goes through the adapter (`analytics/keypoints.py`), which recovers each player's position, head yaw and torso yaw; the scan detector (`analytics/scan_detector.py`, default parameters, unchanged) then runs on that head yaw and position instead of the sim's tracked ones.

| Input to the detector | Keypoint noise (per axis) | Head-yaw RMS error vs truth | TP | FP | FN | P | R | F1 |
|---|---|---|---|---|---|---|---|---|
| tracked head yaw (sim) | — | 2.00° | 7011 | 56 | 71 | 0.992 | 0.990 | **0.991** |
| keypoints, the sim's noise | 4.7 mm | 2.00° | 7006 | 57 | 76 | 0.992 | 0.989 | **0.991** |
| keypoints, 10 mm (stress) | 10.0 mm | 4.31° | 6993 | 132 | 89 | 0.981 | 0.987 | **0.984** |
| keypoints, 20 mm (stress) | 20.0 mm | 8.75° | 6932 | 395 | 150 | 0.946 | 0.979 | **0.962** |

## Reading

- **The matched row is a consistency check, not evidence.** The baseline and the keypoint route start from the same true head yaw at the same noise level (2° of sensor noise; the 4.7 mm per keypoint axis is chosen to give it), so equal F1 (0.991 vs 0.991) is expected by construction. It shows that the adapter adds no bias or extra noise on the way to the detector. The evidence that the ingest works is the round trip in `tests/test_keypoints.py` (exact without noise, a hand-built frame, collapsed and missing points) and the head-yaw RMS column here.
- **The stress rows test the detector, not the ingest.** From the sim's noise to 10 and 20 mm, false positives go 57 → 132 → 395 while recall goes 0.989 → 0.987 → 0.979: with more head-yaw noise, more noise-driven onsets clear the detector's excursion gate. No tracking system was measured to have this keypoint noise here; the rows show how much head-yaw noise the detector tolerates, not how any real system performs.
- Only the head and torso enter the schema. Limbs are not in the sim, so none are generated or claimed.

## Method

- Held-out seeds of the scan-detector eval: `possession_play` 100–119 (20), `blind_side_run` 100–139 (40), full head nuisance; 19.2 min of play, 22 players per run.
- Keypoints: placed from the run's true position, torso yaw and head yaw (upright body, no lean), with independent Gaussian noise on every coordinate, keyed by (match seed, `keypoint_noise`, frame) like every sim draw. Generating them changes nothing in the run or its exports.
- Matched noise: 4.67 mm, from the head-yaw variance of the adapter's fused estimate, σ² / (ear span² / 2 + nose offset² / 1.5), with a 15 cm ear span and the nose 10 cm ahead of the ear midpoint.
- Adapter: head yaw from the ear axis and the nose's offset from the ear midpoint, torso yaw from the shoulder and hip axes, each pair combined with inverse-variance weights; position at the hip midpoint. No sim state.
- Scoring as `eval/scan_detector.py`: sim `scan` events are the positives, `head_turn` events labelled negatives, onsets matched one to one within ±3 frames, the end guard applied.
