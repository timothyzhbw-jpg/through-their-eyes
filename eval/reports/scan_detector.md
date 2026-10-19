# Scan detector — threshold sweep (SPEC 4.7)

`uv run python -m eval.scan_detector`. Detector: `analytics/scan_detector.py` (head yaw plus player and ball positions only, no sim state).

| | Value |
|---|---|
| Chosen threshold (tuning seeds, nuisance on) | **300°/s** |
| Chosen minimum excursion | **60°** |
| Held-out F1, nuisance on | **0.997** — ✅ meets the SPEC target ≥ 0.85 |
| Held-out F1, sensor noise only / clean | 0.999 / 0.998 |
| Held-out data, nuisance on | 17.9 min of play, 22 players, 5486 scans, 2707 partial scans |

## Reading

- **The threshold barely matters once the excursion gate is in.** Held-out F1 stays between 0.996 and 0.997 over 125–300°/s. Every genuine sim scan turns at the head's speed cap (688°/s) within a frame, so the threshold only decides which noise-driven onsets get looked at; the choice of 300°/s is weakly determined (it wins the tie-break).
- **The literature's over-count is reproduced without the gate**: a velocity-only detector finds 4.59 detections per true scan at 125°/s and 1.45 at 300°/s (sensor noise and partial scans).
- **What limits the score is the sim, not the detector.** Partial scans turn 10–50° and full scans at least 70°, and the tuned 60° gate sits in that gap. Close the gap and F1 falls (worst stress row: 0.913, partial scans up to 90° (overlap full scans)). Real tracking has no such gap by construction, so read 0.997 as the score on this sim, not as a claim about real data.

## Method

- Tuning seeds: `possession_play` 0–9 (10), `blind_side_run` 0–19 (20). Held-out seeds: `possession_play` 100–119 (20), `blind_side_run` 100–139 (40). `possession_play` runs 45 s (ends early if the ball goes out); `blind_side_run` is the ~6 s hero scenario.
- Ground truth: sim `scan` events. Partial (aborted) scans are not scans — the head comes straight back before the ball leaves the binocular cone — so a detection on one is a false positive.
- Matching: same player, onset frames at most ±3 frames (120 ms) apart, one to one, closest pairs first. Onsets in the last 1 s of a run are not scored: the sim emits a scan only once the head is back, so scans under way when a run stops are missing from the truth.
- Tuning grid: threshold 125–300°/s in steps of 25 × minimum excursion 20–80° in steps of 5. Highest F1 wins; ties go to the higher threshold, then the lower excursion. Other detector constants are fixed: return tolerance 15°, the head must pass it within 2 frames of the onset, at most 1.5 s from onset to return.
- Conditions (held-out only; same seeds, so the same plays):
  - *full nuisance*: default sim: sensor noise (2°), partial scans, slow drift, ball tracking
  - *sensor noise only*: no partial scans or drift: the sim before head nuisance was added
  - *clean*: no head nuisance and no sensor noise

## Held-out sweep at minimum excursion 60°

| Threshold (°/s) | P | R | F1 — full nuisance | P | R | F1 — sensor noise only | P | R | F1 — clean |
|---|---|---|---|---|---|---|---|---|---|
| 125 | 0.996 | 0.995 | **0.996** | 0.997 | 0.999 | **0.998** | 0.998 | 0.998 | **0.998** |
| 150 | 0.997 | 0.995 | **0.996** | 0.998 | 0.999 | **0.998** | 0.998 | 0.998 | **0.998** |
| 175 | 0.998 | 0.995 | **0.996** | 0.999 | 0.999 | **0.999** | 0.998 | 0.998 | **0.998** |
| 200 | 0.998 | 0.995 | **0.997** | 0.999 | 0.999 | **0.999** | 0.998 | 0.998 | **0.998** |
| 225 | 0.998 | 0.995 | **0.997** | 0.999 | 0.999 | **0.999** | 0.998 | 0.998 | **0.998** |
| 250 | 0.998 | 0.995 | **0.997** | 0.999 | 0.999 | **0.999** | 0.998 | 0.998 | **0.998** |
| 275 | 0.999 | 0.995 | **0.997** | 1.000 | 0.999 | **0.999** | 0.998 | 0.998 | **0.998** |
| 300 ⬅ | 0.999 | 0.995 | **0.997** | 1.000 | 0.999 | **0.999** | 0.999 | 0.998 | **0.998** |

## Tuning seeds: best minimum excursion per threshold (nuisance on)

| Threshold (°/s) | Best min. excursion (°) | P | R | F1 |
|---|---|---|---|---|
| 125 | 60 | 0.995 | 0.997 | **0.996** |
| 150 | 60 | 0.997 | 0.997 | **0.997** |
| 175 | 60 | 0.997 | 0.997 | **0.997** |
| 200 | 60 | 0.997 | 0.996 | **0.997** |
| 225 | 60 | 0.997 | 0.996 | **0.997** |
| 250 | 60 | 0.999 | 0.996 | **0.997** |
| 275 | 60 | 0.999 | 0.996 | **0.998** |
| 300 | 60 | 0.999 | 0.996 | **0.998** |

## Ablation: velocity threshold only (held-out, nuisance on)

No excursion gate: any turn away from the ball faster than the threshold that comes back within 1.5 s (return tolerance 2°, about the sensor noise) counts as a scan — the reading under which the literature's 125°/s over-counts.

| Threshold (°/s) | P | R | F1 | Detections per true scan |
|---|---|---|---|---|
| 125 | 0.210 | 0.963 | **0.345** | 4.59 |
| 150 | 0.331 | 0.978 | **0.494** | 2.96 |
| 175 | 0.468 | 0.988 | **0.635** | 2.11 |
| 200 | 0.580 | 0.994 | **0.733** | 1.71 |
| 225 | 0.641 | 0.997 | **0.780** | 1.56 |
| 250 | 0.666 | 0.997 | **0.799** | 1.50 |
| 275 | 0.680 | 0.998 | **0.809** | 1.47 |
| 300 | 0.686 | 0.998 | **0.813** | 1.45 |

## Chosen detector (300°/s, 60°): matching tolerance and scenarios (held-out, nuisance on)

| Tolerance (frames) | P | R | F1 |
|---|---|---|---|
| ±1 | 0.998 | 0.995 | **0.996** |
| ±2 | 0.999 | 0.995 | **0.997** |
| ±3 | 0.999 | 0.995 | **0.997** |
| ±5 | 0.999 | 0.995 | **0.997** |

| Scenario | Scans | P | R | F1 |
|---|---|---|---|---|
| `possession_play` | 4336 | 0.998 | 0.995 | **0.997** |
| `blind_side_run` | 1150 | 1.000 | 0.996 | **0.998** |

## Stress test: harder head motion (held-out, chosen detector, not re-tuned)

Each row changes one setting of the default (full nuisance) sim.

| Change | P | R | F1 |
|---|---|---|---|
| partial scans up to 70° (the smallest full scan) | 0.928 | 0.995 | **0.960** |
| partial scans up to 90° (overlap full scans) | 0.844 | 0.995 | **0.913** |
| twice as many partial scans | 0.998 | 0.996 | **0.997** |
| drift std 15° | 0.991 | 0.961 | **0.976** |
| sensor noise 5° | 0.992 | 0.995 | **0.993** |

## Where the errors are (chosen detector, held-out, nuisance on)

| | Count | On a partial scan | Ball moving > 2 m/s |
|---|---|---|---|
| False positives | 7 | 3 | 6 |
| Missed scans | 26 | — | 17 |
