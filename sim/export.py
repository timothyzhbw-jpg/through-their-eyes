"""Export a hero moment for viewers (SPEC 7).

Both runs of the key-scan counterfactual, plus what the hero believed and what every player could
see on every frame. Positions in integer mm, angles in integer 1e-4 rad; pitch origin at the centre
spot, home attacks +x.

Schema changes are additive and bump VERSION; `demo/` reads version 1 fields only.

`render_payload_fixture` derives a SPEC 5.3 render payload for the hero moment from the export,
so the viewer can be built before the verifier's payloads exist. It is marked as a fixture.

    uv run python -m sim.export --scenario blind_side_run --seed 3 \
        --out web/public/data/hero_seed3.json \
        --payload-fixture web/public/data/fixture_payload_seed3.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from analytics.vision import VisionParams, player_visibility
from sim.config import DT
from sim.counterfactual import possession_value
from sim.engine import Simulation
from sim.overrides import DropScan
from sim.run import MatchRun, _plain

VERSION = 2


def _bitmask(row: np.ndarray) -> int:
    return int(sum(1 << j for j in np.flatnonzero(row)))


class _Trace:
    """Per-frame belief ghosts of one observer, and who every player can see."""

    def __init__(self, observer: int) -> None:
        self.observer = observer
        self.ghosts: list[np.ndarray] = []
        self.seen: list[int] = []
        self.seen_by: list[list[int]] = []

    def sample(self, sim: Simulation) -> None:
        i = self.observer
        pos, _, _ = sim.beliefs.estimate(i, sim.frame, DT, sim.params.belief_horizon_s)
        pos[i] = sim.pos[i]
        self.ghosts.append(pos)
        speed = np.linalg.norm(sim.vel, axis=-1)
        visible = player_visibility(sim.pos, sim.head_yaw, speed) >= sim.params.perception_threshold
        self.seen.append(_bitmask(visible[i]))
        self.seen_by.append([_bitmask(row) for row in visible])

    def copy(self) -> _Trace:
        other = _Trace(self.observer)
        other.ghosts, other.seen = list(self.ghosts), list(self.seen)
        other.seen_by = list(self.seen_by)
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
        "seen_by": trace.seen_by,
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


def _vision_params() -> dict[str, int]:
    """The FOV cone the sim used, so viewers draw the same cone (angles 1e-4 rad, lengths mm)."""
    v = VisionParams()
    rad = ("half_cone", "edge_sigma", "narrowing_per_mps", "min_half_cone")
    return {k: round(getattr(v, k) * 1e4) for k in rad} | {
        "distance_sigma": round(v.distance_sigma * 1000)
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
        "version": VERSION,
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
        "counterfactual": {"id": "cf1", "intervention": "drop_scan", "scan": key.id},
        "vision": _vision_params(),
        "delta_xt": runs["factual"]["possession_value"]
        - runs["counterfactual"]["possession_value"],
        "runs": runs,
    }


FIXTURE_NOTE = (
    "Fixture, not verifier output: claim values are computed from the sim export by "
    "sim.export.render_payload_fixture and no verifier has checked them."
)


def _times(n: int) -> str:
    return {1: "once", 2: "twice"}.get(n, f"{n} times")


def _amount(x: float, one: str, many: str) -> str:
    return f"{x} {one if x == 1 else many}"


def _frame_of(event_id: str) -> int:
    return int(event_id.rsplit(":", 1)[1])


def render_payload_fixture(data: dict[str, Any]) -> dict[str, Any]:
    """A render payload (SPEC 5.3) for the hero moment, computed from `export_hero` output.

    It follows `explain.builders` (claim ids, value slots, evidence, rounding) and
    `explain.render` (verdicts, seek_frame = earliest evidence frame), so the real payload can
    replace it. Claims of each kind: observed (scans before reception, the completed pass),
    computed (belief error on the runner at the decision), counterfactual (belief error, pass
    and value without the key scan: re-simulated, so causal only inside the sim).
    """
    f, c = data["runs"]["factual"], data["runs"]["counterfactual"]
    hero, runner, key = data["hero"], data["runner"], data["key_scan"]["id"]
    decision, cf_decision = f["decision"], c["decision"]

    reception = next(e for e in f["events"] if e["type"] == "reception" and e["player"] == hero)
    window_s = 2
    lo = reception["frame"] - round(window_s / data["dt"])
    scans = [
        e["id"] for e in f["events"]
        if e["type"] == "scan" and e["player"] == hero and lo <= e["frame"] <= reception["frame"]
    ]  # fmt: skip
    action = next(
        e for e in f["events"]
        if e["type"] == "pass" and e["player"] == hero and e["frame"] == decision["frame"]
    )  # fmt: skip
    receiver = action["attrs"]["receiver"]
    received = next(
        e for e in f["events"]
        if e["type"] == "reception" and e["player"] == receiver and e["frame"] >= action["frame"]
    )  # fmt: skip
    cf_receiver = cf_decision["chosen"].removeprefix("pass:")
    err = round(decision["belief_error"][runner], 1)
    cf_err = round(cf_decision["belief_error"][runner], 1)
    dxt = round(data["delta_xt"], 2)

    def claim(cid: str, kind: str, values: dict, evidence: list[str]) -> dict[str, Any]:
        return {
            "id": cid,
            "kind": kind,
            "verdict": "supported",
            "values": values,
            "evidence": evidence,
            "seek_frame": min(_frame_of(e) for e in evidence),
        }

    claims = [
        claim("scans_before_reception", "observed", {"n": len(scans), "window_s": window_s},
              scans or [reception["id"]]),
        claim("belief_error", "computed", {"err": err}, [action["id"]]),
        claim("cf_belief_error", "counterfactual", {"err": cf_err}, [key]),
        claim("runner_received", "observed", {}, [action["id"], received["id"]]),
        claim("cf_pass", "counterfactual", {}, [key]),
        claim("cf_value", "counterfactual", {"dxt": dxt}, [key]),
    ]  # fmt: skip
    lines = [
        ("L1", "What did he see?", []),
        (
            "L2",
            f"{hero} scanned {_times(len(scans))} in the "
            f"{_amount(window_s, 'second', 'seconds')} before receiving.",
            ["scans_before_reception"],
        ),
        (
            "L3",
            f"When he played the pass, {hero}'s picture of {runner} was off by "
            f"{_amount(err, 'metre', 'metres')}. Without that look, it would have been off by "
            f"{_amount(cf_err, 'metre', 'metres')}.",
            ["belief_error", "cf_belief_error"],
        ),
        ("L4", f"{receiver} took the pass from {hero}.", ["runner_received"]),
        (
            "L5",
            f"Without that look, {hero} would have passed to {cf_receiver}. "
            f"That look was worth {dxt} in expected threat.",
            ["cf_pass", "cf_value"],
        ),
    ]
    return {
        "fixture": True,
        "note": FIXTURE_NOTE,
        "moment": f"m:decision_after_scan:{hero}:{decision['frame']:04d}",
        "persona": "casual",
        "language": "en",
        "lines": [{"id": i, "text": t, "claims": cl} for i, t, cl in lines],
        "claims": claims,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a hero moment for viewers.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--payload-fixture", type=Path, help="also write a render-payload fixture")
    args = parser.parse_args()
    data = export_hero(args.scenario, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {args.out} ({args.out.stat().st_size / 1024:.0f} KB)")
    if args.payload_fixture:
        payload = render_payload_fixture(data)
        args.payload_fixture.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.payload_fixture} (fixture)")


if __name__ == "__main__":
    main()
