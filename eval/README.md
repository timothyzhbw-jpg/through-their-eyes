# eval/ — eval suites and their reports (SPEC 3–6)

Each SPEC acceptance check that needs many seeds is an eval here: a module that runs the sim and
the explain layer over a seed range, scores the result against a target written in the SPEC
before the code, and writes a Markdown report to [`reports/`](reports/). The reports are
committed, and a number quoted from an eval anywhere else (the README, the SPEC, the video) is
copied from its report. [docs/EVALS.md](../docs/EVALS.md) is the index, with each headline
result.

`eval/` is not in the API image; nothing in `api/` imports it.

## The suites

| Module | Question | Seeds (default) | Report | Time |
|---|---|---|---|---|
| [`hero_flip.py`](hero_flip.py) | Without the key scan, does the hero decide differently? | held out 100–139 | `hero_flip_<scenario>.md` | |
| [`hero_lens.py`](hero_lens.py) | Is the moment explained by the lens its scenario is built for, and does the intervention change the outcome? | held out 100–139; 200–239 for `press_escape` | `hero_lens_<scenario>.md` | |
| [`hero_marking.py`](hero_marking.py) | Set-piece hero: without the marker's look, is the runner unmarked at the cutback? | held out 100–139 (design 0–39) | `hero_marking_corner_blind_side.md` | ~15 s |
| [`hero_shot.py`](hero_shot.py) | Shot hero: without the striker's look, does his placement change, and how much scoring chance does he lose? With the keeper's `v_dive` sweep | held out 200–239 (design 0–39) | `hero_shot_far_post_finish.md` | ~1 min |
| [`scan_detector.py`](scan_detector.py) | Threshold sweep of the tracking-only scan detector against sim scan events, nuisance on and off | tuning, then held out (from 100) | `scan_detector.md` | a few min |
| [`keypoint_ingest.py`](keypoint_ingest.py) | The same detector on head yaw recovered from synthetic keypoints | the detector's held-out seeds | `keypoint_ingest.md` | ~20 s |
| [`blind_side.py`](blind_side.py) | Tracking-only blind-side alerts against the sim's stale beliefs | tuning, then fresh held out (from 200) | `blind_side.md` | ~2 min |
| [`corruption.py`](corruption.py) | Does the Verifier refute perturbed claims that are false under an independent ground-truth oracle? Do final payloads pass the render check? | 0–19, 100 perturbations | `corruption.md` | |
| [`realism.py`](realism.py) | Sim scan, head-turn, speed and pass-speed statistics against values printed in the cited papers | held out 100–199 | `realism.md` | ~40 s |
| [`scan_calibration.py`](scan_calibration.py) | Fits scan dwell, the pressure factor and role scan rates to printed values | tuning 0–99 | `scan_calibration.md` | ~3 min |
| [`pitch_control_parity.py`](pitch_control_parity.py) | The numpy half of the shader parity test: 10 snapshots and the kernel's values | blind_side_run seed 3 | `web/src/pitchControl/snapshots.json` | |
| [`narration_ablation.py`](narration_ablation.py) | Free-text vs anchored narration on Foundry, scored by the Verifier and `GroundednessEvaluator` | `--seeds 3,100-103` | `narration_ablation.md` | ~30 model calls per seed |

[`free_text.py`](free_text.py) is the pre-anchoring narration, recovered from git for the
ablation only; `run_breakdown` and the API never use it.

## Run them

```bash
uv run python -m eval.hero_flip --seeds 100-139
uv run python -m eval.hero_lens --scenario blind_side_run
uv run python -m eval.hero_lens --scenario press_escape
uv run python -m eval.hero_marking
uv run python -m eval.hero_shot
uv run python -m eval.scan_detector
uv run python -m eval.keypoint_ingest
uv run python -m eval.blind_side
uv run python -m eval.corruption
uv run python -m eval.realism
uv run python -m eval.scan_calibration
uv run python -m eval.pitch_control_parity
uv run --group eval --env-file .env python -m eval.narration_ablation --seeds 3,100-103   # Foundry
```

Run with `APPLICATIONINSIGHTS_CONNECTION_STRING=` (empty) so nothing sends spans to production.
Everything but the narration ablation is offline and deterministic. The ablation caches each
seed's model answers in `out/narration_ablation/`, so its report can be rewritten without model
calls, and `--max-calls` stops it before a seed that would pass the budget.

## Rules

- **Targets before code.** Each eval scores against a target the SPEC states (for example "≥ 60%
  of held-out seeds"); outcomes are supported, a counterexample, or inconclusive, and
  inconclusive is not done.
- **Design seeds and held-out seeds never mix.** A scenario or a threshold is tuned on design or
  tuning seeds; the report runs held-out seeds. Seeds that were looked at while fixing something
  are no longer fresh: the report says so and moves to new ones (`press_escape` 200–239,
  `far_post_finish` 200–239), and the seen run is kept under its seed range
  (`hero_lens_press_escape_100-139.md`, `hero_shot_far_post_finish_100-139.md`).
- **Reports are deterministic.** The same code gives the same report byte for byte (on the
  platform that wrote it). A PR that touches `sim/`, `analytics/` or `explain/` re-runs the evals
  and either leaves `reports/` unchanged or explains every diff
  ([docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md#eval-before-merge)).
- **Only printed numbers.** `realism.py` and `scan_calibration.py` compare with values printed
  in a paper cited in `docs/REFERENCES.md`; a statistic with no printed value is marked "no
  published reference", never filled in. No real dataset is used, not even for calibration.
- **Fitted values go to `sim/config.py` by hand.** After `scan_calibration` changes, copy the
  values into `sim/config.py`, then re-run every scan eval and `sim.export`.

## Tests

The evals' own logic is tested on small seed sets, so a broken eval fails CI before anyone reads
its report:

```bash
uv run pytest tests/test_verifier_corruption.py tests/test_blind_side_eval.py tests/test_realism.py \
  tests/test_scan_calibration.py tests/test_hero_lens_seeds.py tests/test_keypoint_ingest_eval.py \
  tests/test_narration_ablation.py tests/test_pitch_control_parity.py
```

CI does not re-run the full evals; the reports are generated locally and committed.

## SPEC

Hero evals: [§3.6](../docs/SPEC.md#36-scenario-templates-hero-moments) and
[§5.2](../docs/SPEC.md#52-lens-selection-by-counterfactual-impact); realism and calibration:
[§3.4](../docs/SPEC.md#34-perception-the-hero-feature); detector, keypoints, blind side and
parity: [§4](../docs/SPEC.md#4-analytics-kernels-analytics); corruption:
[§5.3](../docs/SPEC.md#53-claims-and-verifier); narration ablation:
[§6](../docs/SPEC.md#6-agents-agents). Each acceptance check in the SPEC links its report.
