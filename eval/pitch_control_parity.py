"""Numpy half of the pitch-control shader parity test (SPEC 4, 4.2).

    uv run python -m eval.pitch_control_parity

Takes 10 fixed snapshots of the hero moment (blind_side_run, seed 3, factual run): both teams'
positions and velocities at the moment's anchor frames (first pass, key scan, reception,
decision, pass received) and at evenly spaced frames between them. For each it evaluates
`analytics.pitch_control` for the home team on the backend grid (105 x 68 cells of 1 m) and writes
both to web/src/pitchControl/snapshots.json. `web/src/pitchControl/pitchControl.gpu.test.ts`
renders the tactical board's shader on the same inputs in headless Chromium and compares.

Inputs are stored as integer mm and mm/s and the reference is computed from those rounded
values, so it is exact for what the shader is fed. Control is stored in units of 1e-4.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from analytics.pitch_control import PITCH_LENGTH, PITCH_WIDTH, SIGMA_S, pitch_control, pitch_grid
from analytics.tti import REACTION_S, V_MAX
from sim.engine import Simulation
from sim.run import MatchRun

SCENARIO, SEED = "blind_side_run", 3
SNAPSHOTS = 10
CELL = 1.0
FIXTURE = Path(__file__).parents[1] / "web" / "src" / "pitchControl" / "snapshots.json"
NOTE = (
    "Numpy half of the pitch-control shader parity test (SPEC 4). Written by "
    "`uv run python -m eval.pitch_control_parity`; do not edit by hand."
)


def model_params() -> dict[str, float]:
    return {"sigma": SIGMA_S, "reaction": REACTION_S, "v_max": V_MAX}


def grid_spec() -> dict[str, Any]:
    nx, ny = round(PITCH_LENGTH / CELL), round(PITCH_WIDTH / CELL)
    return {"cell": CELL, "nx": nx, "ny": ny, "order": "x fastest, from (-x, -y)"}


def snapshot_frames(run: MatchRun) -> list[tuple[int, str]]:
    """The moment's anchor frames, then evenly spaced frames between the first and the last."""
    decision = run.hero_decision()
    if decision is None:
        raise ValueError(f"{run.scenario} seed {run.seed}: the hero makes no decision")
    passes = [e for e in run.events if e.type == "pass"]
    receptions = [e for e in run.events if e.type == "reception"]
    key = run.key_scan()
    anchors = {
        passes[0].frame: "first pass",
        key.frame: "key scan starts",
        next(e.frame for e in receptions if e.player == run.hero): "hero receives",
        decision.frame: "decision",
        next(e.frame for e in receptions if e.frame > decision.frame): "pass received",
    }
    start, end = min(anchors), max(anchors)
    fill = np.linspace(start, end, SNAPSHOTS - len(anchors) + 2)[1:-1]
    frames = dict(anchors)
    for f in np.rint(fill).astype(int):
        f = int(f)
        while f in frames:
            f += 1
        frames[f] = "between"
    return sorted(frames.items())


def reference(home: np.ndarray, away: np.ndarray) -> np.ndarray:
    """P(home controls) on the grid, in 1e-4, from rows of [x, y, vx, vy] in mm and mm/s."""
    h, a = np.asarray(home, float) / 1000.0, np.asarray(away, float) / 1000.0
    p = pitch_control(pitch_grid(CELL), h[:, :2], h[:, 2:], a[:, :2], a[:, 2:])
    return np.rint(p * 1e4).astype(int)


def build_fixture() -> dict[str, Any]:
    run = Simulation.from_scenario(SCENARIO, SEED).run()
    team = np.array([p.team for p in run.players])
    home, away = team == 0, team == 1
    snapshots = []
    for f, label in snapshot_frames(run):
        rows = np.rint(np.concatenate([run.pos[f], run.vel[f]], axis=1) * 1000.0).astype(int)
        snapshots.append(
            {
                "frame": f,
                "label": label,
                "home": rows[home].tolist(),
                "away": rows[away].tolist(),
                "control": reference(rows[home], rows[away]).tolist(),
            }
        )
    ids = run.ids
    return {
        "note": NOTE,
        "scenario": SCENARIO,
        "seed": SEED,
        "run": "factual",
        "dt": run.dt,
        "model": model_params(),
        "grid": grid_spec(),
        "units": {"position": "mm", "velocity": "mm/s", "control": "1e-4"},
        "players": {
            "home": [ids[j] for j in np.flatnonzero(home)],
            "away": [ids[j] for j in np.flatnonzero(away)],
        },
        "snapshots": snapshots,
    }


def field(key: str, value: Any, indent: str) -> str:
    return f"{indent}{json.dumps(key)}: {json.dumps(value, separators=(',', ':'))}"


def fixture_json(fixture: dict[str, Any]) -> str:
    """One line per field, so a regenerated file diffs per snapshot."""
    lines = ["{"]
    lines += [field(k, v, "  ") + "," for k, v in fixture.items() if k != "snapshots"]
    lines.append('  "snapshots": [')
    shots = fixture["snapshots"]
    for i, s in enumerate(shots):
        fields = ",\n".join(field(k, v, "      ") for k, v in s.items())
        lines.append("    {\n" + fields + "\n    }" + ("," if i < len(shots) - 1 else ""))
    lines += ["  ]", "}"]
    return "\n".join(lines) + "\n"


def main() -> None:
    fixture = build_fixture()
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(fixture_json(fixture))
    frames = ", ".join(f"{s['frame']} ({s['label']})" for s in fixture["snapshots"])
    print(f"wrote {FIXTURE}: frames {frames}")


if __name__ == "__main__":
    main()
