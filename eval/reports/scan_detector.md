# Scan detector — threshold sweep (SPEC 4.7)

`uv run python -m eval.scan_detector`. Detector: `analytics/scan_detector.py` (head yaw plus player and ball positions only, no sim state).

| | Value |
|---|---|
| Chosen threshold (tuning seeds, nuisance on) | **200°/s** |
| Chosen minimum excursion | **55°** |
| Held-out F1, nuisance on | **0.994** — ✅ meets the SPEC target ≥ 0.85 |
| Held-out F1, sensor noise only / clean | 0.999 / 0.999 |
| Held-out data, nuisance on | 17.9 min of play, 22 players, 6547 scans, 3377 head turns (partial scans) |

## Reading

- **The threshold barely matters once the excursion gate is in.** Held-out F1 stays between 0.991 and 0.994 over 125–300°/s. Every genuine sim scan turns at its own peak speed, 404 ± 51°/s and never below 250°/s (Kokubu et al. 2026), so below that floor the threshold only decides which noise-driven onsets get looked at, and above it the slowest scans start to be missed; the choice of 200°/s is weakly determined (it wins the tie-break).
- **The literature's over-count is reproduced without the gate**: a velocity-only detector finds 3.10 detections per true scan at 125°/s and 1.46 at 300°/s (sensor noise and partial scans).
- **What limits the score is the sim, not the detector.** Partial scans turn 10–50° and full scans at least 70°, and the tuned 55° gate sits in that gap. Close the gap and F1 falls (worst stress row: 0.902, partial scans up to 90° (overlap full scans)). Real tracking has no such gap by construction, so read 0.994 as the score on this sim, not as a claim about real data.

## Method

- Tuning seeds: `possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Held-out seeds: `possession_play` 100–119 (20), `blind_side_run` 100–139 (40). `possession_play` runs 45 s (ends early if the ball goes out); `blind_side_run` is the ~6 s hero scenario.
- Ground truth: sim `scan` events are the positives. Partial (aborted) scans are not scans — the head comes straight back before the ball leaves the binocular cone — and the sim emits them as `head_turn` events: labelled negatives, so a detection on one is a false positive.
- Matching: same player, onset frames at most ±3 frames (120 ms) apart, one to one, closest pairs first. Onsets in the last 4.2 s of a run are not scored: the sim emits a scan only once the head is back, so scans under way when a run stops are missing from the truth.
- Tuning grid: threshold 125–300°/s in steps of 25 × minimum excursion 20–80° in steps of 5. Highest F1 wins; ties go to the higher threshold, then the lower excursion. Other detector constants are fixed: return tolerance 15°, the head must pass it within 2 frames of the onset, at most 4.0 s from onset to return.
- Conditions (held-out only; same seeds, so the same plays):
  - *full nuisance*: default sim: sensor noise (2°), partial scans, slow drift, ball tracking
  - *sensor noise only*: no partial scans or drift: the sim before head nuisance was added
  - *clean*: no head nuisance and no sensor noise

## Held-out sweep at minimum excursion 55°

| Threshold (°/s) | P | R | F1 — full nuisance | P | R | F1 — sensor noise only | P | R | F1 — clean |
|---|---|---|---|---|---|---|---|---|---|
| 125 | 0.993 | 0.993 | **0.993** | 0.998 | 0.998 | **0.998** | 0.999 | 0.998 | **0.998** |
| 150 | 0.994 | 0.993 | **0.994** | 0.998 | 0.998 | **0.998** | 0.999 | 0.998 | **0.999** |
| 175 | 0.994 | 0.993 | **0.994** | 0.999 | 0.998 | **0.999** | 0.999 | 0.998 | **0.999** |
| 200 ⬅ | 0.994 | 0.993 | **0.994** | 0.999 | 0.998 | **0.999** | 0.999 | 0.998 | **0.999** |
| 225 | 0.995 | 0.993 | **0.994** | 0.999 | 0.998 | **0.999** | 0.999 | 0.998 | **0.999** |
| 250 | 0.995 | 0.993 | **0.994** | 0.999 | 0.998 | **0.999** | 0.999 | 0.997 | **0.998** |
| 275 | 0.995 | 0.992 | **0.993** | 0.999 | 0.997 | **0.998** | 0.999 | 0.993 | **0.996** |
| 300 | 0.994 | 0.989 | **0.991** | 0.998 | 0.995 | **0.997** | 0.999 | 0.978 | **0.988** |

## Tuning seeds: best minimum excursion per threshold (nuisance on)

| Threshold (°/s) | Best min. excursion (°) | P | R | F1 |
|---|---|---|---|---|
| 125 | 55 | 0.994 | 0.994 | **0.994** |
| 150 | 55 | 0.995 | 0.994 | **0.995** |
| 175 | 55 | 0.995 | 0.994 | **0.995** |
| 200 | 55 | 0.996 | 0.994 | **0.995** |
| 225 | 55 | 0.996 | 0.994 | **0.995** |
| 250 | 55 | 0.996 | 0.993 | **0.995** |
| 275 | 55 | 0.996 | 0.992 | **0.994** |
| 300 | 55 | 0.995 | 0.989 | **0.992** |

## Ablation: velocity threshold only (held-out, nuisance on)

No excursion gate: any turn away from the ball faster than the threshold that comes back within 4.0 s (return tolerance 2°, about the sensor noise) counts as a scan — the reading under which the literature's 125°/s over-counts.

| Threshold (°/s) | P | R | F1 | Detections per true scan |
|---|---|---|---|---|
| 125 | 0.292 | 0.905 | **0.441** | 3.10 |
| 150 | 0.406 | 0.931 | **0.566** | 2.29 |
| 175 | 0.514 | 0.950 | **0.667** | 1.85 |
| 200 | 0.586 | 0.960 | **0.728** | 1.64 |
| 225 | 0.624 | 0.967 | **0.759** | 1.55 |
| 250 | 0.645 | 0.970 | **0.775** | 1.50 |
| 275 | 0.658 | 0.974 | **0.785** | 1.48 |
| 300 | 0.669 | 0.975 | **0.794** | 1.46 |

## Chosen detector (200°/s, 55°): matching tolerance and scenarios (held-out, nuisance on)

| Tolerance (frames) | P | R | F1 |
|---|---|---|---|
| ±1 | 0.993 | 0.991 | **0.992** |
| ±2 | 0.994 | 0.993 | **0.994** |
| ±3 | 0.994 | 0.993 | **0.994** |
| ±5 | 0.994 | 0.993 | **0.994** |

| Scenario | Scans | P | R | F1 |
|---|---|---|---|---|
| `possession_play` | 5782 | 0.994 | 0.993 | **0.994** |
| `blind_side_run` | 765 | 0.995 | 1.000 | **0.997** |

## Stress test: harder head motion (held-out, chosen detector, not re-tuned)

Each row changes one setting of the default (full nuisance) sim.

| Change | P | R | F1 |
|---|---|---|---|
| partial scans up to 70° (the smallest full scan) | 0.900 | 0.993 | **0.944** |
| partial scans up to 90° (overlap full scans) | 0.826 | 0.994 | **0.902** |
| twice as many partial scans | 0.992 | 0.993 | **0.993** |
| drift std 15° | 0.954 | 0.943 | **0.948** |
| sensor noise 5° | 0.981 | 0.993 | **0.987** |

## Where the errors are (chosen detector, held-out, nuisance on)

| | Count | On a `head_turn` | Ball moving > 2 m/s |
|---|---|---|---|
| False positives | 36 | 15 | 32 |
| Missed scans | 43 | — | 31 |
