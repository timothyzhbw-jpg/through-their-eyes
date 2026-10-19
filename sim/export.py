"""Export a hero moment for viewers (SPEC 7).

Both runs of the key-scan counterfactual, plus what the hero believed and could see on every
frame. Positions in integer mm, angles in integer 1e-4 rad; pitch origin at the centre spot, home
attacks +x.

    uv run python -m sim.export --scenario blind_side_run --seed 3 --out out/hero_seed3.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from analytics.vision import player_visibility
from sim.config import DT
from sim.counterfactual import possession_value
from sim.engine import Simulation
from sim.overrides import DropScan
from sim.run import MatchRun, _plain


class _Trace:
    """Per-frame belief ghosts and visibility of one observer."""

    def __init__(self, observer: int) -> None:
        self.observer = observer
        self.ghosts: list[np.ndarray] = []
        self.seen: list[int] = []

    def sample(self, sim: Simulation) -> None:
        i = self.observer
        pos, _, _ = sim.beliefs.estimate(i, sim.frame, DT, sim.params.belief_horizon_s)
        pos[i] = sim.pos[i]
        self.ghosts.append(pos)
        speed = np.linalg.norm(sim.vel, axis=-1)
        visible = (
            player_visibility(sim.pos, sim.head_yaw, speed)[i] >= sim.params.perception_threshold
        )
        self.seen.append(int(sum(1 << j for j in np.flatnonzero(visible))))

    def copy(self) -> _Trace:
        other = _Trace(self.observer)
        other.ghosts, other.seen = list(self.ghosts), list(self.seen)
        return other


def _mm(a: np.ndarray) -> list:
    return np.rint(np.asarray(a) * 1000).astype(np.int64).reshape(len(a), -1).tolist()


def _rad(a: np.ndarray) -> list:
    return np.rint(np.asarray(a) * 1e4).astype(np.int64).tolist()


def _encode(run: MatchRun, trace: _Trace) -> dict[str, Any]:
    decision = run.hero_decision()
    hero_action = None
    if decision is not None:
        hero_action = next(
            (e for e in run.events if e.player == decision.player and e.frame == decision.frame
             and e.type in ("pass", "shot")),
            None,
        )  # fmt: skip
    return {
        "frames": len(run.owner),
        "pos": _mm(run.pos),
        "head": _rad(run.head_yaw),
        "body": _rad(run.body_yaw),
        "ball": _mm(run.ball_pos[:, :2]),
        "owner": run.owner.tolist(),
        "ghost": _mm(np.array(trace.ghosts)),
        "seen": trace.seen,
        "events": [
            _plain(
                {"id": e.id, "type": e.type, "frame": e.frame, "player": e.player, "attrs": e.attrs}
            )
            for e in sorted(run.events, key=lambda e: (e.frame, e.id))
        ],
        "decision": None
        if decision is None
        else _plain(
            {
                "frame": decision.frame,
                "player": decision.player,
                "chosen": decision.chosen,
                "options": [
                    {
                        "action": o.action,
                        "target": o.target,
                        "p_success": o.p_success,
                        "value": o.value,
                        "prob": o.prob,
                    }
                    for o in sorted(decision.options, key=lambda o: -o.prob)
                ],
                "belief_error": decision.belief_error,
                "belief_age": decision.belief_age,
            }
        ),  # fmt: skip
        "action": None
        if hero_action is None
        else _plain(hero_action.attrs | {"frame": hero_action.frame}),
        "possession_value": possession_value(run),
    }


def export_hero(scenario: str, seed: int) -> dict[str, Any]:
    key = Simulation.from_scenario(scenario, seed).run().key_scan()
    sim = Simulation.from_scenario(scenario, seed)
    hero = sim.index(sim.scenario.hero)
    trace = _Trace(hero)
    while sim.frame < key.frame:
        trace.sample(sim)
        sim.step()
    snap = sim.snapshot()
    runs = {}
    for name, overrides in (("factual", []), ("counterfactual", [DropScan(key.id)])):
        s, t = Simulation.resume(snap, overrides), trace.copy()
        while not s.done:
            t.sample(s)
            s.step()
        t.sample(s)
        runs[name] = _encode(s.result(), t)
    return {
        "scenario": scenario,
        "seed": seed,
        "dt": DT,
        "units": {"position": "mm", "angle": "1e-4 rad"},
        "hero": sim.scenario.hero,
        "runner": getattr(sim.scenario, "runner", None),
        "players": [
            {"id": p.id, "team": p.team, "role": p.role, "number": p.number} for p in sim.players
        ],
        "key_scan": {"id": key.id, "start": key.frame, "end": key.attrs["end"]},
        "delta_xt": runs["factual"]["possession_value"]
        - runs["counterfactual"]["possession_value"],
        "runs": runs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a hero moment for viewers.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    data = export_hero(args.scenario, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {args.out} ({args.out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
