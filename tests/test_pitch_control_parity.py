"""Numpy half of the pitch-control shader parity test (SPEC 4, 4.2).

The GLSL half is web/src/pitchControl/pitchControl.gpu.test.ts: it renders the tactical board's
shader on the committed snapshots and compares it with the reference checked here. Regenerate the
snapshots with `uv run python -m eval.pitch_control_parity`.
"""

import json
from pathlib import Path

import numpy as np

from analytics.pitch_control import pitch_grid
from eval.pitch_control_parity import (
    CELL,
    FIXTURE,
    SCENARIO,
    SEED,
    SNAPSHOTS,
    build_fixture,
    grid_spec,
    model_params,
    reference,
)
from sim.engine import Simulation

HERO_EXPORT = Path(__file__).parents[1] / "web" / "public" / "data" / "hero_seed3.json"


def test_the_committed_reference_is_the_numpy_kernel_on_its_snapshots():
    fixture = json.loads(FIXTURE.read_text())
    assert fixture["model"] == model_params(), "kernel parameters changed: regenerate the snapshots"
    assert fixture["grid"] == grid_spec()
    assert len(fixture["snapshots"]) == SNAPSHOTS
    cells = len(pitch_grid(CELL))
    for s in fixture["snapshots"]:
        committed = np.array(s["control"])
        assert committed.shape == (cells,)
        # 1 unit of 1e-4: a value on a rounding boundary may round either way across platforms.
        diff = np.abs(reference(s["home"], s["away"]) - committed).max()
        assert diff <= 1, f"frame {s['frame']}: committed reference is off by {diff}e-4"


def test_the_snapshots_cover_the_hero_moment():
    fixture = build_fixture()
    shots = fixture["snapshots"]
    frames = [s["frame"] for s in shots]
    assert len(set(frames)) == SNAPSHOTS and frames == sorted(frames)
    labels = {s["label"] for s in shots}
    assert {"first pass", "key scan starts", "hero receives", "decision", "pass received"} <= labels
    assert all(len(s["home"]) == 11 and len(s["away"]) == 11 for s in shots)
    # Away cells are everything home does not control (the board shows both teams).
    p = np.array(shots[0]["control"]) / 1e4
    assert 0.0 <= p.min() < 0.01 and 0.99 < p.max() <= 1.0


def test_backward_differences_of_the_web_export_are_the_sim_velocities():
    """The export carries positions only; the board derives velocities as (pos[f] - pos[f-1]) / dt.

    The sim steps with semi-implicit Euler (pos[f] = pos[f-1] + vel[f] * dt, sim/movement.py), so
    that difference is the sim's own velocity up to the export's rounding. The export rounds to
    1 mm; where it was generated on another platform a position can be off by one more unit, so
    the bound is 2 mm per frame.
    """
    export = json.loads(HERO_EXPORT.read_text())
    run = Simulation.from_scenario(SCENARIO, SEED).run()
    factual = export["runs"]["factual"]
    frames, n = factual["frames"], len(export["players"])
    assert frames == len(run.pos)
    pos = np.array(factual["pos"], float).reshape(frames, n, 2) / 1000.0
    vel = np.diff(pos, axis=0) / export["dt"]
    assert np.abs(vel - run.vel[1:]).max() <= 2e-3 / export["dt"]
