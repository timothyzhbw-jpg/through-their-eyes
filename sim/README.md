# sim/ — the synthetic match engine (SPEC 3)

A numpy simulator of 22 fictional players and a ball at 25 Hz. Every player turns his head,
scans, sees only what falls in his field of view, keeps a belief about everyone else, and the
ball carrier decides on that belief. Scenario templates set up the hero moments; keyed
randomness makes every run reproducible and lets a moment be re-simulated with one intervention
(a dropped scan, a forced action) while every other draw stays the same.

Everything here is synthetic: no real match data, and no parameter fitted to a dataset. The
parameters come from published papers (`docs/REFERENCES.md`).

## Modules

| Module | What it holds |
|---|---|
| [`engine.py`](engine.py) | `Simulation`: the frame loop (perception, then scripted actions and due decisions, heads and scans, movement, ball, record), `snapshot()` and `resume(snapshot, overrides)` |
| [`rng.py`](rng.py) | `KeyedRng`: every draw from a fresh Philox generator keyed by `(seed, purpose, frame, entity)` |
| [`config.py`](config.py) | `SimParams` (head, scan, perception and run-length parameters), `ROLES` (speed limit, fitted scan rate and softmax temperature per role), pitch size and `FPS` |
| [`perception.py`](perception.py) | `HeadModel` (gaze on the ball, scans, partial scans, drift) and `BeliefStore` (each player's last sighting of everyone, extrapolated) |
| [`decision.py`](decision.py) | options valued on the carrier's belief (pass, carry, shot), Gumbel-max choice |
| [`movement.py`](movement.py), [`ball.py`](ball.py) | steering with speed and acceleration limits; the closed-form rolling ball with drag |
| [`shots.py`](shots.py) | placed shots, the keeper's reach and the save model; only in scenarios with `Scenario.shots` |
| [`overrides.py`](overrides.py) | interventions for `resume`: `DropScan`, `FreezeBelief`, `ForceAction` |
| [`counterfactual.py`](counterfactual.py) | `drop_scan_counterfactual`, `force_action_counterfactual`, `hero_counterfactual` (the scenario's own intervention), possession value and result |
| [`run.py`](run.py), [`model.py`](model.py) | `MatchRun` (a finished run as arrays plus events and decisions) and its canonical bytes; `PlayerInfo`, `Event`, `Decision` |
| [`match.py`](match.py) | a stitched match: scenario possessions back to back on one clock, with restarts and the score |
| [`export.py`](export.py) | the JSON the viewer reads: both runs of a hero moment, sight, beliefs, options, blind-side alerts, the scan detector's output; also the render-payload fixture and the precomputed what-ifs |
| [`dataset.py`](dataset.py) | the downloadable dataset: stitched matches on fresh seeds as events (CSV/Parquet), 25 Hz tracking (Parquet), metadata (JSON), per-reception scans and beliefs; datasheet [docs/DATASET.md](../docs/DATASET.md) |
| [`keypoints.py`](keypoints.py) | a synthetic limb-tracking stream for `analytics/keypoints.py` |
| [`scenarios/`](scenarios/) | `Scenario` (the hooks a template may override) and the templates, registered in `SCENARIOS` |

Scenarios on `main` (the registry in [`scenarios/__init__.py`](scenarios/__init__.py) is the
authority; each class names its hero, lens and intervention):

| Scenario | Hero | Lens | Intervention | Notes |
|---|---|---|---|---|
| `blind_side_run` | H8 | `scan` | `drop_scan` | the deployed hero, seed 3 |
| `press_escape` | H4 | `pressure` | `force:carry` | `tackles` on |
| `corner_blind_side` | H5 | `scan` | `drop_scan` | markers mark where they *believe* their man is; no decision on the ball |
| `far_post_finish` | H9 | `scan` | `drop_scan` | `shots` on |
| `possession_play` | — | — | — | open play for evals that need volume, and the open-play possessions of a stitched match |

## Data flow

- **In:** a scenario name and a seed (`Simulation.from_scenario(name, seed)`), optionally
  `SimParams` and overrides. Nothing is read from disk.
- **Out:** a `MatchRun`: per frame and player `pos`, `vel`, `body_yaw`, `head_yaw` and
  `head_yaw_observed` (with sensor noise, the tracking output), the ball and its owner; events
  (`pass`, `reception`, `scan`, `head_turn`, `shot`, …) with ids `<type>:<player>:<frame>`; and
  the decisions with every option's value and its keyed noise.
- `analytics/` kernels are called inside the loop (vision for perception; time to intercept,
  pitch control and the xT prior for decisions). `explain/` and `agents/` read finished runs.
  `export.py` and `dataset.py` reach up into them, to write the viewer's files and the dataset.
- Scan events are ground truth. The analytics scan detector must find them from tracking alone
  (SPEC 4.7); partial turns are `head_turn` events, never `scan` events.

## Invariants

- **Keyed randomness, never a shared stream** (SPEC 3.7). Every draw is keyed by
  `(seed, purpose, frame, entity)`, and each frame draws a fixed shape (one value per player)
  whether or not it is used. An intervention therefore cannot shift any other draw, so factual and
  counterfactual runs share common random numbers and differ only through the intervention.
- **Decisions are Gumbel-max over keyed noise per (player, frame, option)** (SPEC 3.5): an option
  whose value did not change keeps its noise in a counterfactual. Decisions read the carrier's
  belief, never the true state.
- **Same seed, same environment, same bytes.** `MatchRun.to_bytes()` quantises tracking to mm,
  mm/s and 1e-4 rad; two runs with one seed on one platform and numpy version hash the same.
  Cross-platform identity is not promised (numpy's SIMD maths differs between ARM and x86).
- **`resume(snapshot(t))` without overrides reproduces the run from t exactly**, and forcing the
  action that was actually chosen reproduces it byte for byte. Forcing an action that was not an
  option raises; it is never mapped to the nearest one.
- **Feature flags keep old runs.** `Scenario.tackles`, `Scenario.shots` and
  `Scenario.ends_on_pass` default to the old behaviour, so a scenario that does not use them runs
  byte for byte as before.
- **Committed exports stay current.** `web/public/data/` and `demo/hero.html` are generated from
  here. After any change to `sim/`, `analytics/` or `explain/`, regenerate them (the commands in
  [web/README.md](../web/README.md#data), then `uv run python -m demo.build --seed 3`) and re-run
  the evals ([docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md#eval-before-merge)).

## Run it

```bash
uv run python -m sim.match --seed 1                                   # summary of the stitched match
uv run python -m sim.export --match 1 --out out/match_seed1.json      # its export
uv run python -m sim.export --scenario blind_side_run --seed 3 --out out/hero_seed3.json
```

```python
from sim.engine import Simulation
from sim.counterfactual import drop_scan_counterfactual

run = Simulation.from_scenario("blind_side_run", 3).run()
cf = drop_scan_counterfactual("blind_side_run", 3)  # factual vs without the key scan
print(cf.factual_action, cf.counterfactual_action)
```

## Tests

```bash
uv run pytest tests/test_sim_m1.py tests/test_ball.py tests/test_match.py tests/test_export.py \
  tests/test_committed_exports.py tests/test_whatif.py tests/test_shots.py tests/test_dataset.py
```

- [`test_sim_m1.py`](../tests/test_sim_m1.py): determinism (same seed twice, resume without
  overrides, an override on one player leaves every draw of the others alone), speed and energy
  limits, beliefs, and the key scan flipping the decision on held-out seeds.
- [`test_committed_exports.py`](../tests/test_committed_exports.py): the files in
  `web/public/data/` are what `sim.export` writes now (byte for byte on macOS arm64, where they
  are generated; structurally elsewhere, CI included).
- Per mechanism: [`test_decision_run_in.py`](../tests/test_decision_run_in.py),
  [`test_option_success.py`](../tests/test_option_success.py),
  [`test_head_turns.py`](../tests/test_head_turns.py), [`test_nuisance.py`](../tests/test_nuisance.py),
  [`test_marking.py`](../tests/test_marking.py); per scenario:
  [`test_press_escape.py`](../tests/test_press_escape.py),
  [`test_corner_blind_side.py`](../tests/test_corner_blind_side.py),
  [`test_shots.py`](../tests/test_shots.py); [`test_keypoints.py`](../tests/test_keypoints.py) for
  the keypoint stream; [`test_export_whatif.py`](../tests/test_export_whatif.py) for the what-ifs.

The scenario-level acceptance checks are evals with committed reports
([docs/EVALS.md](../docs/EVALS.md)): `hero_flip`, `hero_lens`, `hero_marking`, `hero_shot`,
`realism`, `scan_calibration`.

## SPEC

[§3](../docs/SPEC.md#3-synthetic-match-engine-sim): [3.1 state and schema, the stitched match](../docs/SPEC.md#31-state-and-schema),
[3.2 movement](../docs/SPEC.md#32-movement), [3.3 ball, shots and keepers](../docs/SPEC.md#33-ball-physics),
[3.4 perception](../docs/SPEC.md#34-perception-the-hero-feature),
[3.5 decisions](../docs/SPEC.md#35-decision-model),
[3.6 scenarios](../docs/SPEC.md#36-scenario-templates-hero-moments),
[3.7 determinism and counterfactuals](../docs/SPEC.md#37-determinism-and-counterfactuals),
[acceptance checks](../docs/SPEC.md#acceptance-checks--sim).
