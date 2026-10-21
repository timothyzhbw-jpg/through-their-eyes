# analytics/ — the kernels (SPEC 4)

Pure numpy functions over tracking arrays: time to intercept, pitch control, pressing
intensity, vision, expected threat, the scan detector, blind-side alerts and the limb-tracking
adapter. The sim calls some of them inside its frame loop, the explain layer and the agents'
tools call them on finished runs, and two of them are drawn by shaders in `web/`. Each one is
reimplemented from its paper (`docs/REFERENCES.md`); no code is copied.

## Modules

| Module | Kernel | Used by |
|---|---|---|
| [`tti.py`](tti.py) | `time_to_intercept`: keep the current velocity for the reaction time (0.7 s), then run straight at `v_max` (5 m/s), after Spearman as simplified by Shaw | pitch control, pressing, the sim's decisions and defenders |
| [`pitch_control.py`](pitch_control.py) | `pitch_control`, `control_from_times`, `pitch_grid` (1 m cells): the closed-form logistic of the two teams' arrival times, σ = 0.45 s | the decision model, the lenses, the MCP tool `get_pitch_control`, the board's shader |
| [`pressing.py`](pressing.py) | `pressing_intensity`, `frame_pressing`, `pressure_over_frames`, `aggregate`: Bekkers (2025), targets led one second, heading penalty | the `pressure` lens, `pressed_decision` moments, the lexicon's "under heavy pressure" |
| [`vision.py`](vision.py) | `field_of_view`, `player_visibility`, `visibility`: a 120° cone around the head yaw, narrowed by speed, with distance decay and soft occlusion, after Bekkers (2026) | the sim's perception, `observed_share`, the board's vision-cone shader (cone and decay only) |
| [`xt.py`](xt.py) | `xt_prior`, `xt_for`: a smooth expected-threat surface; the fitted 16 × 12 grid of SPEC 4.5 is not on `main` yet | decisions, lenses, claims |
| [`scan_detector.py`](scan_detector.py) | `detect_scans`, `trace_scans`, `detect_all`: an onset faster than 200°/s that turns away from the ball, an excursion of at least 55°, a return | `sim.export` (the telemetry panel), the evals |
| [`blind_side.py`](blind_side.py) | `detect_alerts`: an observer has lost sight of a target on the move (unseen for 1.2 s, 3 m from where he was expected, running at 4 m/s or more, within 35 m) | `explain.moments` (blind-side moments), `sim.export` (the alerts the live stream and the views show) |
| [`keypoints.py`](keypoints.py) | `pose_from_keypoints`, `KeypointFrame`: position, head yaw and torso yaw from a COCO keypoint subset | `eval/keypoint_ingest.py`; nothing in the API or the app calls it yet |
| [`tactics.py`](tactics.py) | `tactics_cards`, `tactics_from_run`: the "why build from the back?" card (own-half passes with and without pressure on the passer, short and long, line-breaking, xT added and handed over, the decision model's recorded options) and the "why focus on set pieces?" card (corners, shots and distance xG after them, the best corner reception's xT against open play), from the live stats timeline | `explain.tactics` (the cards' verified sentences), `GET /api/matches/<id>/tactics`, the stats panel and the recap |

## Data flow

- **In:** numpy arrays in SI units and radians, pitch origin at the centre spot: positions and
  velocities `(N, 2)` or `(F, N, 2)`, head yaw `(F, N)`, the ball, target points `(M, 2)`.
- **Out:** arrays of times, probabilities, visibilities or detections; dataclasses for the scan
  detector and the alerts. No I/O, no global state.
- The package imports only numpy, pydantic (for `KeypointFrame`) and itself. Nothing here imports
  `sim/`, `explain/` or the rest of the repo, so the kernels can run on any tracking source.

## Invariants

- **A numpy reference with unit tests for every kernel** (SPEC 4). Parameters are module
  constants or frozen `*Params` dataclasses, so they can be swept and stay safe as defaults.
- **numpy ↔ GLSL parity.** The tactical board's pitch-control shader
  (`web/src/pitchControl/`) must match `pitch_control.py` within 0.02 on 10 fixed snapshots of
  the hero moment, at the centre of every 1 m cell (measured: about 5e-5, the reference's
  rounding to 1e-4). `uv run python -m eval.pitch_control_parity` writes the snapshots and the
  numpy values to `web/src/pitchControl/snapshots.json`; `tests/test_pitch_control_parity.py`
  checks that file against the kernel, and `web/src/pitchControl/pitchControl.gpu.test.ts` runs
  the shader in headless Chrome against it. Change the kernel or its parameters and you
  regenerate the snapshots and update the shader in the same PR. The vision-cone shader has no
  parity test yet.
- **Tracking only.** `scan_detector.py`, `blind_side.py` and `keypoints.py` take what a tracking
  system reports (head yaw, positions, keypoints) and never the sim's scan events or beliefs.
  Tests parse their imports and fail if one reaches into `sim`.
- **Thresholds are chosen in an eval, not by hand.** The scan detector's and the blind-side
  alert's defaults are the values their evals picked on tuning seeds; the reports show the
  held-out results (`eval/reports/scan_detector.md`, `blind_side.md`). A new default comes with a
  re-run of that eval.

## Tests

```bash
uv run pytest tests/test_analytics_kernels.py tests/test_pressing.py tests/test_scan_detector.py \
  tests/test_blind_side.py tests/test_keypoints.py tests/test_pitch_control_parity.py
cd web && npm test   # includes the GPU parity test; TTE_CHROME=<path> if Chrome is not found
```

- [`test_analytics_kernels.py`](../tests/test_analytics_kernels.py): TTI, pitch control sums to
  one and is symmetric under a team swap and pitch flip, vision behind the player and under
  occlusion, the xT prior.
- [`test_pressing.py`](../tests/test_pressing.py), [`test_scan_detector.py`](../tests/test_scan_detector.py)
  (including F1 ≥ 0.85 on held-out seeds with nuisance head motion on),
  [`test_blind_side.py`](../tests/test_blind_side.py), [`test_keypoints.py`](../tests/test_keypoints.py).
- Eval-backed: [`test_blind_side_eval.py`](../tests/test_blind_side_eval.py),
  [`test_keypoint_ingest_eval.py`](../tests/test_keypoint_ingest_eval.py).

## SPEC

[§4](../docs/SPEC.md#4-analytics-kernels-analytics): [4.1 TTI](../docs/SPEC.md#41-time-to-intercept-tti),
[4.2 pitch control](../docs/SPEC.md#42-pitch-control),
[4.3 pressing](../docs/SPEC.md#43-pressing-intensity-after-bekkers),
[4.4 vision and blind-side alerts](../docs/SPEC.md#44-vision-map-and-observed-space-metrics),
[4.5 xT](../docs/SPEC.md#45-expected-threat-xt), [4.7 scan detector and limb tracking](../docs/SPEC.md#47-scan-detector),
[acceptance checks](../docs/SPEC.md#acceptance-checks--analytics).
