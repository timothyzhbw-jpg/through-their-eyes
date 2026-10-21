"""Scan detector on limb tracking (SPEC 4.7): F1 from keypoint-derived head yaw vs tracked head yaw.

    uv run python -m eval.keypoint_ingest

On the scan detector's held-out seeds (eval/scan_detector.py, full nuisance) the detector, with
its chosen defaults and unchanged, runs on:
- the sim's tracked head yaw (`head_yaw_observed`, 2 degrees of sensor noise) and positions: the
  baseline, the held-out F1 of eval/reports/scan_detector.md;
- the head yaw and positions that analytics/keypoints.py recovers from a synthetic keypoint
  stream (sim/keypoints.py) with the sim's noise carried into keypoint space (about 4.7 mm);
- the same at 10 and 20 mm of keypoint noise: a stress test, not calibrated to any system.
Scored as eval/scan_detector.py scores (same truth, matching and end guard). Writes
eval/reports/keypoint_ingest.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import numpy as np

from analytics.keypoints import keypoint_sigma, pose_from_keypoints
from analytics.scan_detector import DEFAULT_PARAMS
from analytics.vision import wrap_angle
from eval.scan_detector import (
    HELD_OUT,
    TOLERANCE_FRAMES,
    Counts,
    Sample,
    _seed_text,
    sample_of,
    scenario_params,
    score,
)
from sim.config import SimParams
from sim.engine import Simulation
from sim.keypoints import keypoint_stream

REPORTS = Path(__file__).parent / "reports"

BASELINE = "tracked head yaw (sim)"
MATCHED = "keypoints, the sim's noise"
# Route name -> keypoint noise (m): None is the baseline, "matched" the sim's own noise.
ROUTES: dict[str, float | str | None] = {
    BASELINE: None,
    MATCHED: "matched",
    "keypoints, 10 mm (stress)": 0.010,
    "keypoints, 20 mm (stress)": 0.020,
}


@dataclass
class Route:
    samples: list[Sample]
    errors: list[np.ndarray]  # head yaw minus true head yaw, rad, one array per run
    sigma: float | None  # keypoint noise, m; None for the baseline

    @cached_property
    def counts(self) -> Counts:
        return score(self.samples, DEFAULT_PARAMS)

    @property
    def rms_deg(self) -> float:
        flat = np.concatenate([e.ravel() for e in self.errors])
        return float(np.rad2deg(np.sqrt(np.mean(flat**2))))


def evaluate(seed_sets=HELD_OUT) -> dict[str, Route]:
    routes = {name: Route([], [], None if sigma is None else 0.0) for name, sigma in ROUTES.items()}
    for scenario, seeds in seed_sets:
        params = scenario_params(scenario)
        for seed in seeds:
            run = Simulation.from_scenario(scenario, seed, params=params).run()
            for name, sigma in ROUTES.items():
                route = routes[name]
                if sigma is None:
                    route.samples.append(sample_of(run))
                    route.errors.append(wrap_angle(run.head_yaw_observed - run.head_yaw))
                    continue
                stream = keypoint_stream(run, None if sigma == "matched" else sigma, params)
                pose = pose_from_keypoints(stream)
                route.sigma = stream.sigma
                route.samples.append(sample_of(run, head_yaw=pose.head_yaw, pos=pose.pos))
                route.errors.append(wrap_angle(pose.head_yaw - run.head_yaw))
    return routes


def _row(name: str, r: Route) -> str:
    c = r.counts
    noise = "—" if r.sigma is None else f"{r.sigma * 1000:.1f} mm"
    return (
        f"| {name} | {noise} | {r.rms_deg:.2f}° | {c.tp} | {c.fp} | {c.fn} | {c.precision:.3f} "
        f"| {c.recall:.3f} | **{c.f1:.3f}** |"
    )


def render(routes: dict[str, Route], seed_sets=HELD_OUT) -> str:
    base, matched = routes[BASELINE].counts, routes[MATCHED].counts
    stress = [name for name, sigma in ROUTES.items() if isinstance(sigma, float)]
    sensor = np.rad2deg(SimParams().sensor_noise)
    samples = routes[BASELINE].samples
    minutes = sum(s.seconds for s in samples) / 60
    lines = [
        "# Scan detector on limb tracking (SPEC 4.7)",
        "",
        "`uv run python -m eval.keypoint_ingest`. Does the Ingest stage accept limb tracking? A "
        "synthetic keypoint stream (`sim/keypoints.py`: nose, ears, shoulders and hips, COCO "
        "names, metres on the pitch) goes through the adapter (`analytics/keypoints.py`), which "
        "recovers each player's position, head yaw and torso yaw; the scan detector "
        "(`analytics/scan_detector.py`, default parameters, unchanged) then runs on that head "
        "yaw and position instead of the sim's tracked ones.",
        "",
        "| Input to the detector | Keypoint noise (per axis) | Head-yaw RMS error vs truth | TP "
        "| FP | FN | P | R | F1 |",
        "|---|---|---|---|---|---|---|---|---|",
        *(_row(name, r) for name, r in routes.items()),
        "",
        "## Reading",
        "",
        f"- **The matched row is a consistency check, not evidence.** The baseline and the "
        f"keypoint route start from the same true head yaw at the same noise level "
        f"({sensor:.0f}° of sensor noise; the {routes[MATCHED].sigma * 1000:.1f} mm per keypoint "
        f"axis is chosen to give it), so equal F1 ({matched.f1:.3f} vs {base.f1:.3f}) is expected "
        f"by construction. It shows that the adapter adds no bias or extra noise on the way to "
        f"the detector. The evidence that the ingest works is the round trip in "
        "`tests/test_keypoints.py` (exact without noise, a hand-built frame, collapsed and "
        "missing points) and the head-yaw RMS column here.",
        f"- **The stress rows test the detector, not the ingest.** From the sim's noise to 10 "
        f"and 20 mm, false positives go {matched.fp} → "
        + " → ".join(str(routes[n].counts.fp) for n in stress)
        + f" while recall goes {matched.recall:.3f} → "
        + " → ".join(f"{routes[n].counts.recall:.3f}" for n in stress)
        + ": with more head-yaw noise, more noise-driven onsets clear the detector's excursion "
        "gate. No tracking system was measured to have this keypoint noise here; the rows show "
        "how much head-yaw noise the detector tolerates, not how any real system performs.",
        "- Only the head and torso enter the schema. Limbs are not in the sim, so none are "
        "generated or claimed.",
        "",
        "## Method",
        "",
        f"- Held-out seeds of the scan-detector eval: {_seed_text(seed_sets)}, full head "
        f"nuisance; {minutes:.1f} min of play, {len(samples[0].truth) if samples else 0} players "
        "per run.",
        "- Keypoints: placed from the run's true position, torso yaw and head yaw (upright body, "
        "no lean), with independent Gaussian noise on every coordinate, keyed by (match seed, "
        "`keypoint_noise`, frame) like every sim draw. Generating them changes nothing in the "
        "run or its exports.",
        f"- Matched noise: {keypoint_sigma(SimParams().sensor_noise) * 1000:.2f} mm, from the "
        "head-yaw variance of the adapter's fused estimate, σ² / (ear span² / 2 + nose offset² / "
        "1.5), with a 15 cm ear span and the nose 10 cm ahead of the ear midpoint.",
        "- Adapter: head yaw from the ear axis and the nose's offset from the ear midpoint, torso "
        "yaw from the shoulder and hip axes, each pair combined with inverse-variance weights; "
        "position at the hip midpoint. No sim state.",
        f"- Scoring as `eval/scan_detector.py`: sim `scan` events are the positives, `head_turn` "
        f"events labelled negatives, onsets matched one to one within ±{TOLERANCE_FRAMES} "
        "frames, the end guard applied.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    routes = evaluate()
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "keypoint_ingest.md"
    path.write_text(render(routes))
    for name, r in routes.items():
        print(f"{name}: F1 {r.counts.f1:.3f}, head-yaw RMS {r.rms_deg:.2f} deg")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
