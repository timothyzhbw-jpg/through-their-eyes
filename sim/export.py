"""Export a hero moment for viewers (SPEC 7).

Both runs of the key-scan counterfactual, plus what the hero believed and what every player could
see on every frame. Positions in integer mm, angles in integer 1e-4 rad; pitch origin at the centre
spot, home attacks +x.

Schema changes are additive and bump VERSION; `demo/` reads version 1 fields only.
Version 3 adds, for every option of the hero's decision, P(success) on the true state ("it was"
against "he thought", SPEC 5.1) and the believed and true positions of the receiver. The decision
block is in metres, like the decision model. Version 4 adds each run's blind-side alerts
(SPEC 4.4) with how long each target has gone unseen. Version 5 adds the scan detector at work
(SPEC 4.7): its parameters, and per run and player its head angular velocity, candidate onsets
and accepted scans, computed on the tracked head yaw as eval/scan_detector.py runs it.

Without a new version, two additive variants of version 4:
- a hero whose intervention is not a dropped scan (`press_escape`, SPEC 3.6) has `key_scan: null`
  and `counterfactual: {"id": "cf1", "intervention": "force_action", "action": "carry"}`; its
  counterfactual run is the hero forced to take that action. A scan hero's export is unchanged.
- `export_match` writes a stitched match (SPEC 3.1): `kind: "match"`, the same `runs.factual`
  tracking, events and blind-side alerts over the whole match clock (no ghosts or decision: those
  belong to a hero export), plus a `match` block (possessions, restarts, score) and `moments`.
    uv run python -m sim.export --match 1 --out out/match_seed1.json

`render_payload_fixture` derives a SPEC 5.3 render payload for the hero moment from the export,
so the viewer can be built before the verifier's payloads exist. It is marked as a fixture.

    uv run python -m sim.export --scenario blind_side_run --seed 3 \
        --out web/public/data/hero_seed3.json \
        --payload-fixture web/public/data/fixture_payload_seed3.json \
        --what-if web/public/data/whatif_seed3.json

`export_what_ifs` precomputes every option's "What if…?" answer (SPEC 6, 7) for the viewer.

`export_looks` precomputes Take his eyes (SPEC 3.7, 7): every look of the grid re-simulated, with
its verified lines. Its own schema (LOOK_VERSION):
    uv run python -m sim.export --scenario blind_side_run --seed 3 \
        --looks web/public/data/look_seed3.json
    uv run python -m sim.export --scenario press_escape --seed 0 \
        --looks web/public/data/look_press_escape_seed0.json

`export_steps` writes the scan step-through (SPEC 7): each look of the hero before the ball reaches
him and his decision, per run, with every player's sim velocity at those frames and the verified
lines (`agents.steps`). Its own schema (`agents.steps.STEPS_VERSION`):
    uv run python -m sim.export --scenario blind_side_run --seed 3 \
        --steps web/public/data/steps_seed3.json
    uv run python -m sim.export --scenario press_escape --seed 0 \
        --steps web/public/data/steps_press_escape_seed0.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from analytics.blind_side import visible_mask
from analytics.scan_detector import DEFAULT_PARAMS as DETECTOR
from analytics.scan_detector import trace_scans
from analytics.stats import display
from analytics.vision import VisionParams, player_visibility, wrap_angle
from explain.functions import same_target_on_truth, true_options
from explain.moments import blind_side_alerts
from sim.config import DT
from sim.counterfactual import (
    CounterfactualResult,
    look_counterfactual,
    look_overrides,
    possession_result,
    possession_value,
)
from sim.engine import Simulation
from sim.match import Possession, StitchedMatch, build_match, global_id
from sim.model import Decision, Event
from sim.overrides import DropScan, ForceAction
from sim.roster import short_name
from sim.run import MatchRun, _plain

VERSION = 5


def _bitmask(row: np.ndarray) -> int:
    return int(sum(1 << j for j in np.flatnonzero(row)))


class _Trace:
    """Per-frame belief ghosts of one observer, and who every player can see."""

    def __init__(self, observer: int) -> None:
        self.observer = observer
        self.ghosts: list[np.ndarray] = []
        self.seen: list[int] = []
        self.seen_by: list[list[int]] = []
        self.decided: dict[int, np.ndarray] = {}  # frame -> belief the decisions saw

    def sample(self, sim: Simulation) -> None:
        i = self.observer
        pos, _, _ = sim.beliefs.estimate(i, sim.frame, DT, sim.params.belief_horizon_s)
        pos[i] = sim.pos[i]
        self.ghosts.append(pos)
        speed = np.linalg.norm(sim.vel, axis=-1)
        visible = player_visibility(sim.pos, sim.head_yaw, speed) >= sim.params.perception_threshold
        self.seen.append(_bitmask(visible[i]))
        self.seen_by.append([_bitmask(row) for row in visible])

    def step(self, sim: Simulation) -> None:
        """Advance one frame, keeping the belief a decision at this frame used: a step perceives
        first and decides after, so it is read after the step, at the frame the step started."""
        f = sim.frame
        sim.step()
        pos, _, _ = sim.beliefs.estimate(self.observer, f, DT, sim.params.belief_horizon_s)
        self.decided[f] = pos

    def copy(self) -> _Trace:
        other = _Trace(self.observer)
        other.ghosts, other.seen = list(self.ghosts), list(self.seen)
        other.seen_by, other.decided = list(self.seen_by), dict(self.decided)
        return other


def _mm(a: np.ndarray) -> list:
    return np.rint(np.asarray(a) * 1000).astype(np.int64).reshape(len(a), -1).tolist()


def _rad(a: np.ndarray) -> list:
    return np.rint(np.asarray(a) * 1e4).astype(np.int64).tolist()


def _options(run: MatchRun, decision: Decision, believed: np.ndarray) -> list[dict[str, Any]]:
    """The options he weighed, best first: on his belief, and the same options on the truth."""
    f = decision.frame
    truth = true_options(run, decision)
    out = []
    for o in sorted(decision.options, key=lambda o: -o.prob):
        t = truth.get(o.action)
        j = run.index(o.target_player) if o.kind == "pass" else None
        out.append(
            {
                "action": o.action,
                "target": o.target,
                "p_success": o.p_success,
                "value": o.value,
                "prob": o.prob,
                # The same option re-scored on the true state (target along the true run).
                "p_success_true": None if t is None else t.p_success,
                "value_true": None if t is None else t.value,
                "target_true": None if t is None else t.target,
                # His target held fixed on the true state.
                "p_success_true_same_target": same_target_on_truth(run, decision, o),
                "receiver": o.target_player,
                "receiver_believed": None if j is None else believed[j].tolist(),
                "receiver_true": None if j is None else run.pos[f, j].tolist(),
            }
        )
    return out


def _blind_side(run: MatchRun) -> dict[str, Any]:
    """Blind-side alerts (SPEC 4.4) from `explain.moments.blind_side_alerts`, and how long each
    alert's target has gone unseen. The module does not expose the last sighting, so it is
    recomputed here from the same inputs (`visible_mask`: observed head yaw, V < 0.5 is unseen;
    everyone counts as seen at the first frame, as in the module).

    `frames[f]` lists the alerts on at frame f as [observer, target, frames unseen] (indices).
    Frames unseen is 0 when the target is in sight but the module still holds the alert on for
    its minimum duration.
    """
    alerts = blind_side_alerts(run)
    seen = visible_mask(run.head_yaw_observed, run.pos, run.vel)
    last = np.zeros(seen.shape[1:], dtype=np.int64)
    frames = []
    for f, active in enumerate(alerts.per_frame):
        last[seen[f]] = f
        frames.append([[o, t, f - int(last[o, t])] for o, t in active])
    return {
        "intervals": [
            {
                "observer": run.ids[a.observer],
                "target": run.ids[a.target],
                "start": a.start,
                "end": a.end,
            }
            for a in alerts.intervals
        ],  # fmt: skip
        "frames": frames,
    }


def _scan_detector(run: MatchRun) -> dict[str, Any]:
    """The scan detector (SPEC 4.7) on this run, as eval/scan_detector.py runs it: on the tracked
    head yaw (`head_yaw_observed`, with sensor noise; not the true `head` above), the players'
    and the ball's positions, with the default parameters.

    `omega[t][j]`: player j's head angular velocity from frame t to t + 1 (frames - 1 rows,
    1e-4 rad/s, signed, counter-clockwise positive). `onsets[j]`: frames where |omega| reaches
    the threshold while the head turns away from the ball, the candidates the detector looks at.
    `scans[j]`: the candidates that passed the excursion gate and came back (amplitude 1e-4 rad).
    """
    ball = run.ball_pos[:, :2]
    traces = [
        trace_scans(run.head_yaw_observed[:, j], run.pos[:, j], ball, run.dt, DETECTOR)
        for j in range(len(run.players))
    ]
    return {
        "omega": _rad(np.stack([t.omega for t in traces], axis=-1)),
        "onsets": [t.onsets.tolist() for t in traces],
        "scans": [
            [
                {
                    "start": s.start,
                    "end": s.end,
                    "peak": s.peak,
                    "amplitude": round(s.amplitude * 1e4),
                    "side": s.side,
                }
                for s in t.scans
            ]
            for t in traces
        ],
    }


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
                "options": _options(run, decision, trace.decided[decision.frame]),
                "belief_error": decision.belief_error,
                "belief_age": decision.belief_age,
            }
        ),  # fmt: skip
        "action": None
        if hero_action is None
        else _plain(hero_action.attrs | {"frame": hero_action.frame}),
        "possession_value": possession_value(run),
        "blind_side": _blind_side(run),
        "scan_detector": _scan_detector(run),
    }


def _vision_params() -> dict[str, int]:
    """The FOV cone the sim used, so viewers draw the same cone (angles 1e-4 rad, lengths mm)."""
    v = VisionParams()
    rad = ("half_cone", "edge_sigma", "narrowing_per_mps", "min_half_cone")
    return {k: round(getattr(v, k) * 1e4) for k in rad} | {
        "distance_sigma": round(v.distance_sigma * 1000)
    }


def _detector_params() -> dict[str, Any]:
    """The scan detector's parameters (angles 1e-4 rad, angular velocity 1e-4 rad/s)."""
    p = DETECTOR
    return {
        "omega_threshold": round(p.omega_threshold * 1e4),
        "min_excursion": round(p.min_excursion * 1e4),
        "return_tolerance": round(p.return_tolerance * 1e4),
        "onset_frames": p.onset_frames,
        "max_duration_s": p.max_duration_s,
    }


def export_hero(scenario: str, seed: int) -> dict[str, Any]:
    probe = Simulation.from_scenario(scenario, seed)
    intervention = probe.scenario.intervention or "drop_scan"
    factual = probe.run()
    if intervention == "drop_scan":
        key = factual.key_scan()
        at, override = key.frame, DropScan(key.id)
        key_scan = {"id": key.id, "start": key.frame, "end": key.attrs["end"]}
        counterfactual = {"id": "cf1", "intervention": "drop_scan", "scan": key.id}
    else:  # "force:<action>": the hero takes that action at his decision (SPEC 3.7)
        action = intervention.removeprefix("force:")
        decision = factual.hero_decision()
        at, override = decision.frame, ForceAction(decision.player, decision.frame, action)
        key_scan = None
        counterfactual = {"id": "cf1", "intervention": "force_action", "action": action}
    sim = Simulation.from_scenario(scenario, seed)
    hero = sim.index(sim.scenario.hero)
    trace = _Trace(hero)
    while sim.frame < at:
        trace.sample(sim)
        trace.step(sim)
    snap = sim.snapshot()
    runs = {}
    for name, overrides in (("factual", []), ("counterfactual", [override])):
        s, t = Simulation.resume(snap, overrides), trace.copy()
        while not s.done:
            t.sample(s)
            t.step(s)
        t.sample(s)
        runs[name] = _encode(s.result(), t)
    return {
        "version": VERSION,
        "scenario": scenario,
        "seed": seed,
        "dt": DT,
        "units": {"position": "mm", "angle": "1e-4 rad", "angular_velocity": "1e-4 rad/s"},
        "hero": sim.scenario.hero,
        "runner": getattr(sim.scenario, "runner", None),
        "players": [
            {"id": p.id, "team": p.team, "role": p.role, "number": p.number} for p in sim.players
        ],
        "key_scan": key_scan,
        "counterfactual": counterfactual,
        "vision": _vision_params(),
        "scan_detector": _detector_params(),
        "delta_xt": runs["factual"]["possession_value"]
        - runs["counterfactual"]["possession_value"],
        "runs": runs,
    }


def _match_event(e: Event, p: Possession) -> dict[str, Any]:
    attrs = dict(e.attrs)
    if isinstance(attrs.get("end"), int):  # pass, scan and head-turn ends are frames
        attrs["end"] += p.start
    if e.type in ("shot", "dive") and isinstance(attrs.get("seen"), int):
        attrs["seen"] += p.start
    if e.type == "save" and isinstance(attrs.get("shot"), str):  # a local event id
        attrs["shot"] = global_id(attrs["shot"], p.start)
    lifted = {"id": global_id(e.id, p.start), "type": e.type, "frame": e.frame + p.start,
              "player": e.player, "attrs": attrs, "possession": p.index}  # fmt: skip
    return _plain(lifted)


def export_match(
    seed: int, match: StitchedMatch | None = None, moments: list[dict] | None = None
) -> dict[str, Any]:
    """A stitched match for the live stream (SPEC 2, 3.1): the hero export's run schema over the
    whole match clock, its possessions, restarts and score, and its moments in match time."""
    from explain.match import match_moments  # explain builds on sim; imported when used

    m = match or build_match(seed)
    cards = moments if moments is not None else match_moments(m)
    pos, head, body, ball, owner, events, intervals, alerts = [], [], [], [], [], [], [], []
    for p in m.possessions:
        run = p.run
        pos += _mm(run.pos)
        head += _rad(run.head_yaw)
        body += _rad(run.body_yaw)
        ball += _mm(run.ball_pos[:, :2])
        owner += run.owner.tolist()
        events += [_match_event(e, p) for e in sorted(run.events, key=lambda e: (e.frame, e.id))]
        bs = _blind_side(run)
        intervals += [
            {**a, "start": a["start"] + p.start, "end": a["end"] + p.start, "possession": p.index}
            for a in bs["intervals"]
        ]
        alerts += bs["frames"]
    hero_moments = {c["possession"]: c["id"] for c in cards if c["hero"]}
    return {
        "version": VERSION,
        "kind": "match",
        "scenario": "match",
        "seed": seed,
        "dt": DT,
        "units": {"position": "mm", "angle": "1e-4 rad"},
        "hero": None,
        "players": [
            {"id": p.id, "team": p.team, "role": p.role, "number": p.number} for p in m.players
        ],
        "match": {
            "duration_s": round(m.duration_s, 2),
            "score": {"home": m.score[0], "away": m.score[1]},
            "possessions": [
                {
                    "index": p.index,
                    "scenario": p.scenario,
                    "seed": p.seed,
                    "start": p.start,
                    "frames": p.frames,
                    "restart": p.restart,
                    "score_before": {"home": p.score_before[0], "away": p.score_before[1]},
                    "hero": p.run.hero,
                    "hero_moment": hero_moments.get(p.index),
                }
                for p in m.possessions
            ],
        },
        "runs": {
            "factual": {
                "frames": m.frames,
                "pos": pos,
                "head": head,
                "body": body,
                "ball": ball,
                "owner": owner,
                "events": events,
                "blind_side": {"intervals": intervals, "frames": alerts},
            }
        },
        "moments": cards,
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
    computed (belief error on the runner at the decision; he thought vs it was for the chosen
    pass), counterfactual (belief error, pass, value and he thought vs it was for the runner's
    option without the key scan: re-simulated, so causal only inside the sim).
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
    err = display(decision["belief_error"][runner], 1)
    cf_err = display(cf_decision["belief_error"][runner], 1)
    dxt = display(data["delta_xt"], 2)

    def thought_vs_was(dec: dict, action: str) -> dict[str, float]:
        o = next(o for o in dec["options"] if o["action"] == action)
        return {"p_belief": display(o["p_success"], 2), "p_true": display(o["p_success_true"], 2)}

    chosen = thought_vs_was(decision, decision["chosen"])
    cf_runner = thought_vs_was(cf_decision, f"pass:{runner}")

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
        claim("pass_success", "computed", chosen, [action["id"]]),
        claim("cf_pass_success", "counterfactual", cf_runner, [action["id"]]),
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
        (
            "L6",
            f"{hero} thought the pass to {receiver} had a {chosen['p_belief']:.2f} chance of "
            f"arriving; it was {chosen['p_true']:.2f}.",
            ["pass_success"],
        ),
        (
            "L7",
            f"Without that look, {hero} thought the pass to {runner} had a "
            f"{cf_runner['p_belief']:.2f} chance of arriving; it was {cf_runner['p_true']:.2f}.",
            ["cf_pass_success"],
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


WHAT_IF_VERSION = 1
WHAT_IF_LANGUAGES = ("en", "zh")


def what_if_question(action: str, language: str) -> str:
    """The suggested question for an option, in words the what-if parser maps back to it. A
    player goes by his short name, as everywhere on screen (SPEC 4.6)."""
    if action.startswith("pass:"):
        target = short_name(action.removeprefix("pass:"))
        return f"What if he passed to {target}?" if language == "en" else f"如果他传给{target}呢？"
    if action == "carry":
        return "What if he carried it?" if language == "en" else "如果他带球呢？"
    if action == "shot":
        return "What if he shot?" if language == "en" else "如果他射门呢？"
    if action in ("shot:near", "shot:far"):  # a placed shot (Module A)
        post = action.removeprefix("shot:")
        zh = {"near": "近角", "far": "远角"}[post]
        return f"What if he shot at the {post} post?" if language == "en" else f"如果他射{zh}呢？"
    raise ValueError(f"no question for {action!r}")


def export_what_ifs(scenario: str, seed: int) -> dict[str, Any]:
    """Every option of the hero's decision forced and re-simulated (SPEC 3.7, 6, 7 "What if…?").

    For each option he did not choose: the suggested question in en and zh, the verified answer
    from `agents.whatif.answer_question` (a SPEC 5.3 render payload), and the forced run from the
    decision on (players and ball in integer mm, events) for the ghost path. A static stand-in for
    the api's live what-if, so the demo works without the service.
    """
    import asyncio

    from agents.context import MomentContext  # the crew's evidence; heavy, so imported here
    from agents.whatif import REFUSAL, answer_question

    ctx = MomentContext.load(scenario, seed)
    decision = ctx.run.hero_decision()
    start = decision.frame
    options = []
    for o in sorted(decision.options, key=lambda o: -o.prob):
        entry: dict[str, Any] = {"action": o.action, "factual": o.action == decision.chosen}
        entry["question"] = {lang: what_if_question(o.action, lang) for lang in WHAT_IF_LANGUAGES}
        if not entry["factual"]:
            answers = {}
            for lang in WHAT_IF_LANGUAGES:
                a = asyncio.run(answer_question(ctx, entry["question"][lang], lang))
                if a.action != o.action or a.payload is None:
                    raise RuntimeError(f"{entry['question'][lang]!r} did not map to {o.action}")
                answers[lang] = a.payload.model_dump(mode="json")
            forced = ctx.evaluator.counterfactual(a.counterfactual).counterfactual
            entry |= {
                "id": a.counterfactual,
                "frames": len(forced.owner) - start,
                "pos": _mm(forced.pos[start:]),
                "ball": _mm(forced.ball_pos[start:, :2]),
                "events": [
                    _plain(
                        {
                            "id": e.id,
                            "type": e.type,
                            "frame": e.frame,
                            "player": e.player,
                            "attrs": e.attrs,
                        }
                    )
                    for e in sorted(forced.events, key=lambda e: (e.frame, e.id))
                    if e.frame >= start
                ],  # fmt: skip
                "answers": answers,
            }
        options.append(entry)
    return {
        "version": WHAT_IF_VERSION,
        "scenario": scenario,
        "seed": seed,
        "units": {"position": "mm"},
        "moment": ctx.card.id,
        "hero": decision.player,
        "decision_frame": start,
        "start": start,
        "factual_action": decision.chosen,
        "refusal": REFUSAL,
        "options": options,
    }


WITHOUT_LOOK_VERSION = 1


def export_without_look(scenario: str, seed: int) -> dict[str, Any]:
    """The run without the look, told (SPEC 5.3, 7): which look was removed, what losing it cost
    and where the pass went in expected threat, as verified payloads in en and zh
    (`explain.look_cost`), with the xT grid the explainer draws (16 x 12, 1e-4, attacking +x).
    For a hero whose other run is a look removed; a static file, so no model call and no cache."""
    from agents.context import MomentContext  # the crew's evidence; heavy, so imported here
    from analytics.xt import LENGTH, NX, NY, WIDTH, fitted_grid, xt_prior_for
    from explain.look_cost import look_cost_payload

    ctx = MomentContext.load(scenario, seed)
    cf = ctx.cf
    if not isinstance(cf, CounterfactualResult) or not cf.scan_id.startswith("scan:"):
        raise ValueError(f"{scenario} {seed}: the other run is not a look removed")
    answers = {}
    for lang in WHAT_IF_LANGUAGES:
        payload = look_cost_payload(ctx.evaluator, cf, lang, ctx.names)  # by name (SPEC 4.6)
        if not payload.lines:
            raise ValueError(f"{scenario} {seed}: no line about the removed look in {lang}")
        answers[lang] = payload.model_dump(mode="json")
    scan = cf.factual.event(cf.scan_id)
    grid = fitted_grid()
    fitted = grid is not None
    if grid is None:
        x = (np.arange(NX) + 0.5) / NX * LENGTH - LENGTH / 2
        y = (np.arange(NY) + 0.5) / NY * WIDTH - WIDTH / 2
        grid = xt_prior_for(np.stack(np.meshgrid(x, y, indexing="ij"), axis=-1), 1)
    return {
        "version": WITHOUT_LOOK_VERSION,
        "scenario": scenario,
        "seed": seed,
        "moment": ctx.card.id,
        "hero": scan.player,
        "removed": {"id": scan.id, "start": scan.frame, "end": int(scan.attrs["end"])},
        "answers": answers,
        "xt": {
            "units": "1e-4",
            "cols": NX,
            "rows": NY,
            "fitted": fitted,  # False: the smooth prior (no cached fit)
            "grid": np.rint(np.asarray(grid) * 1e4).astype(int).tolist(),
        },
    }


def without_look_json(data: dict[str, Any]) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


LOOK_VERSION = 1
# The look grid (SPEC 3.7, 7 "Take his eyes"): directions in whole degrees from the ball,
# counter-clockwise positive: to his left, over his left shoulder, over his right shoulder, to his
# right (150 deg is the widest a scan turns, SimParams.scan_amplitude). Times: every
# LOOK_SPACING_S back from the reception while the ball is on its way to him.
LOOK_OFFSETS = (90, 150, -150, -90)
LOOK_SPACING_S = 0.4
LOOK_MOVED_MM = 10  # a look's belief ghost lists the players it moved by more than this


def look_grid_frames(start: int, reception: int) -> list[int]:
    """The grid's look frames: the reception, then every LOOK_SPACING_S before it from `start`."""
    step = round(LOOK_SPACING_S / DT)
    return sorted(range(reception, start - 1, -step))


def _traced_look(scenario: str, seed: int, hero: int, start: int, overrides: list):
    """The run with these look overrides from `start`, and his belief and sight on every frame."""
    sim = Simulation.from_scenario(scenario, seed)
    trace = _Trace(hero)
    while sim.frame < start:
        trace.sample(sim)
        trace.step(sim)
    sim = Simulation.resume(sim, overrides)
    while not sim.done:
        trace.sample(sim)
        trace.step(sim)
    trace.sample(sim)
    return sim.result(), trace


def _look_entry(
    result, run: MatchRun, trace: _Trace, factual: MatchRun, base: np.ndarray | None
) -> dict:
    """One look (or no look, `base` None) for the web: his head and sight over the window, his
    belief (no look: on every frame of the window; a look: from its first frame, and only the
    players it changes against `base`, the no-look belief), his events in the window, his
    decision as the hero export has it, and what came of it."""
    start, end = result.window
    hero = run.index(result.player)
    decision = run.hero_decision()
    upto = end + 1
    # The web draws a look over the factual run: nothing else may differ before the decision.
    for name in ("pos", "ball_pos", "body_yaw", "owner"):
        if not np.array_equal(getattr(run, name)[:upto], getattr(factual, name)[:upto]):
            raise RuntimeError(f"{result.id}: {name} differs from the factual run before {end}")
    others = lambda r: sorted((e.id, e.frame) for e in r.events  # noqa: E731
                              if e.player != result.player and e.frame < end)  # fmt: skip
    if others(run) != others(factual):
        raise RuntimeError(f"{result.id}: another player's events differ before {end}")
    ghost = np.rint(np.array(trace.ghosts[start:upto]) * 1000).astype(np.int64)  # (F, N, 2) mm
    if base is None:
        belief: Any = ghost.reshape(len(ghost), -1).tolist()
    else:
        first = result.frame - start
        # Moved by more than a centimetre: a last-unit difference on another platform (SPEC 3.7)
        # must not change which players are listed.
        moved = np.any(np.abs(ghost[first:] - base[first:]) > LOOK_MOVED_MM, axis=(0, 2))
        belief = {run.ids[j]: ghost[first:, j].tolist() for j in np.flatnonzero(moved)}
    action = _action_of(run, decision)
    return {
        "id": result.id,
        "head": _rad(run.head_yaw[start:upto, hero]),
        "seen": trace.seen[start:upto],
        "ghost": belief,
        "events": [
            _event(e)
            for e in sorted(run.events, key=lambda e: (e.frame, e.id))
            if e.player == result.player and start <= e.frame < end
        ],  # fmt: skip
        "decision": _plain(
            {
                "frame": decision.frame,
                "player": decision.player,
                "chosen": decision.chosen,
                "options": _options(run, decision, trace.decided[decision.frame]),
                "belief_error": decision.belief_error,
                "belief_age": decision.belief_age,
            }
        ),
        "action": None if action is None else _plain(action.attrs | {"frame": action.frame}),
        "outcome": possession_result(run),
        "possession_value": possession_value(run),
        "delta_xt": result.delta_xt,
        "changed": decision.chosen != result.factual_action,
    }, ghost


ON_THE_BALL = ("pass", "reception", "carry", "shot", "interception", "tackle")


def _action_of(run: MatchRun, decision: Decision) -> Event | None:
    return next(
        (e for e in run.events if e.player == decision.player and e.frame == decision.frame
         and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip


def _event(e: Event) -> dict[str, Any]:
    return _plain({"id": e.id, "type": e.type, "frame": e.frame, "player": e.player,
                   "attrs": e.attrs})  # fmt: skip


def export_looks(scenario: str, seed: int) -> dict[str, Any]:
    """Take his eyes (SPEC 3.7, 7): every look of the grid re-simulated, for the viewer.

    The hero looks only where the viewer says, from the pass to him to his decision
    (`sim.counterfactual.look_counterfactual`). Per look: his head yaw and his sight over the
    window, his belief from the look on (before it, the no-look run's), his decision with its
    options on his belief and on the truth (as `export_hero`), what came of it, and its verified
    lines in en and zh (`agents.look.answer_look`). The runs after the decision go in `runs`, each
    once, in the what-ifs' format (`export_what_ifs`). Before the decision every look's run is the
    factual one but for his head and what he believes: the export refuses one that is not.
    """
    from agents.context import MomentContext  # the crew's evidence; heavy, so imported here
    from agents.look import answer_look

    ctx = MomentContext.load(scenario, seed)
    factual = ctx.run
    hero_id = factual.hero
    hero = factual.index(hero_id)
    decision = factual.hero_decision()
    (start, end), own, _ = look_overrides(factual, hero_id, None, None)
    reception = max(
        e.frame for e in factual.events
        if e.type == "reception" and e.player == hero_id and e.frame <= end
    )  # fmt: skip
    runs: list[dict[str, Any]] = []
    keys: dict[str, int] = {}

    def after(run: MatchRun) -> int:
        """The run from the decision on, stored once: the ball, and the players on the ball in it
        (passer, target, receiver or interceptor, tackler), the ghosts the board draws."""
        events = [e for e in sorted(run.events, key=lambda e: (e.frame, e.id)) if e.frame >= end]
        involved = {hero_id} | {e.player for e in events if e.type in ON_THE_BALL}
        involved |= {e.attrs[k] for e in events if e.type in ON_THE_BALL
                     for k in ("to", "receiver") if isinstance(e.attrs.get(k), str)}  # fmt: skip
        players = [pid for pid in run.ids if pid in involved]
        idx = [run.index(pid) for pid in players]
        entry = {
            "start": end,
            "frames": len(run.owner) - end,
            "players": players,
            "pos": _mm(run.pos[end:, idx]),
            "ball": _mm(run.ball_pos[end:, :2]),
            "events": [_event(e) for e in events],
        }
        key = json.dumps(entry, separators=(",", ":"))
        if key not in keys:
            keys[key] = len(runs)
            runs.append(entry)
        return keys[key]

    def entry(result, base: np.ndarray | None) -> tuple[dict[str, Any], np.ndarray]:
        _, _, overrides = look_overrides(factual, hero_id, result.frame, _deg(result))
        run, trace = _traced_look(scenario, seed, hero, start, overrides)
        if run.to_bytes() != result.counterfactual.to_bytes():
            raise RuntimeError(f"{result.id}: the traced run is not the look's run")
        out, ghost = _look_entry(result, run, trace, factual, base)
        out["run"] = after(run)
        answer = answer_look(ctx, result, none)
        out["answers"] = {lang: p.model_dump(mode="json") for lang, p in answer.payloads.items()}
        if any(len(p.lines) != len(answer.claims) for p in answer.payloads.values()):
            raise RuntimeError(f"{result.id}: a line did not verify")
        return out, ghost

    none = look_counterfactual(scenario, seed, None, None)
    no_look, base = entry(none, None)
    frames = look_grid_frames(start, reception)
    cells = []
    for f in frames:
        for offset in LOOK_OFFSETS:
            try:
                result = look_counterfactual(scenario, seed, f, offset)
            except ValueError as err:
                cells.append({"id": None, "frame": f, "offset": offset, "unavailable": str(err)})
                continue
            look = result.look
            cell = {"frame": f, "offset": offset, "unavailable": None}
            cell["look"] = {"start": look.frame, "end": look.attrs["end"],
                            "direction": round(look.attrs["direction"] * 1e4),
                            "amplitude": round(look.attrs["amplitude"] * 1e4)}  # fmt: skip
            cells.append(cell | entry(result, base)[0])

    def off_ball(e: Event) -> int:
        """Whole degrees his own scan turned from the ball, counter-clockwise positive."""
        to_ball = factual.ball_pos[e.frame, :2] - factual.pos[e.frame, hero]
        turn = wrap_angle(e.attrs["direction"] - np.arctan2(to_ball[1], to_ball[0]))
        return round(float(np.rad2deg(turn)))

    available = [c for c in cells if c["unavailable"] is None]
    return {
        "version": LOOK_VERSION,
        "scenario": scenario,
        "seed": seed,
        "dt": DT,
        "units": {"position": "mm", "angle": "1e-4 rad", "offset": "deg"},
        "moment": ctx.card.id,
        "hero": hero_id,
        "window": [start, end],
        "reception": reception,
        "decision_frame": decision.frame,
        "spacing_s": LOOK_SPACING_S,
        "frames": frames,
        "offsets": list(LOOK_OFFSETS),
        "own_looks": [
            {"id": e.id, "start": e.frame, "end": e.attrs["end"], "offset": off_ball(e)}
            for e in own
        ],  # fmt: skip
        "factual": {
            "chosen": decision.chosen,
            "outcome": possession_result(factual),
            "possession_value": possession_value(factual),
        },  # fmt: skip
        "no_look": no_look,
        "cells": cells,
        "runs": runs,
        "summary": {
            "cells": len(cells),
            "available": len(available),
            "changed": sum(c["changed"] for c in available),
            "differ_from_no_look": sum(
                c["decision"]["chosen"] != no_look["decision"]["chosen"] for c in available
            ),
        },
    }


def export_steps(scenario: str, seed: int) -> dict[str, Any]:
    """The scan step-through (SPEC 7) of a hero moment with a decision on the ball, per run: his
    looks before the ball reaches him (a step each, the run without the key scan showing it as
    missing) and his decision, with every player's velocity from the sim at each freeze frame
    (mm/s) and the verified lines in en and zh. The options a step can show are the decision
    record's, in the hero export. Refuses a line that does not verify."""
    from agents.context import MomentContext  # the crew's evidence; heavy, so imported here
    from agents.steps import STEPS_VERSION, answer_steps

    ctx = MomentContext.load(scenario, seed)
    answer = answer_steps(ctx)
    runs: dict[str, Any] = {}
    for name, rs in answer.runs.items():
        payloads = answer.payloads[name]
        for lang, payload in payloads.items():
            if len(payload.lines) != len(rs.claims):
                kept = {line.id for line in payload.lines}
                lost = [c.id for c in rs.claims if c.id not in kept]
                raise RuntimeError(f"{name} ({lang}): lines did not verify: {', '.join(lost)}")
        runs[name] = {
            "reception": rs.reception.frame,
            "decision": rs.decision.frame,
            "intro": rs.lines["intro"],
            "steps": [
                {
                    "id": s.scan.id,
                    "start": s.scan.frame,
                    "end": int(s.scan.attrs["end"]),
                    "frame": s.frame,
                    "side": s.side,
                    "over": s.over,
                    "missing": s.missing,
                    "sight": s.sight,
                    "lines": rs.lines[s.scan.id],
                    "vel": _mm(rs.run.vel[s.frame]),
                }
                for s in rs.steps
            ],
            "final": {
                "frame": rs.decision.frame,
                "chosen": rs.decision.chosen,
                "forced": rs.forced,
                "focus": list(rs.focus),
                "lines": rs.lines["final"],
                "vel": _mm(rs.run.vel[rs.decision.frame]),
            },
            "answers": {lang: p.model_dump(mode="json") for lang, p in payloads.items()},
        }
    return {
        "version": STEPS_VERSION,
        "scenario": scenario,
        "seed": seed,
        "dt": DT,
        "units": {"velocity": "mm/s"},
        "moment": ctx.card.id,
        "hero": ctx.run.hero_decision().player,
        "runs": runs,
    }


def steps_json(data: dict[str, Any]) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def _deg(result) -> int | None:
    return None if result.offset is None else round(float(np.rad2deg(result.offset)))


def looks_json(data: dict[str, Any]) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


# How each file is written, byte for byte: the tests compare the committed files with these.


def hero_json(data: dict[str, Any]) -> str:
    return json.dumps(data, separators=(",", ":"))


def payload_fixture_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def what_ifs_json(data: dict[str, Any]) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a hero moment for viewers.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--match", type=int, help="export the stitched match with this seed")
    parser.add_argument("--out", type=Path, help="the hero (or match) export")
    parser.add_argument("--payload-fixture", type=Path, help="also write a render-payload fixture")
    parser.add_argument("--what-if", type=Path, help="also write every option's what-if answer")
    parser.add_argument(
        "--without-look", type=Path, help="also write the lines of the run without the look"
    )
    parser.add_argument("--looks", type=Path, help="also write the Take his eyes look grid")
    parser.add_argument("--steps", type=Path, help="also write the scan step-through")
    args = parser.parse_args()
    if args.steps:
        steps = export_steps(args.scenario, args.seed)
        args.steps.parent.mkdir(parents=True, exist_ok=True)
        args.steps.write_text(steps_json(steps))
        count = {name: len(r["steps"]) for name, r in steps["runs"].items()}
        print(f"wrote {args.steps} ({args.steps.stat().st_size / 1024:.0f} KB): steps per run "
              f"{count}")  # fmt: skip
    if args.looks:
        looks = export_looks(args.scenario, args.seed)
        args.looks.parent.mkdir(parents=True, exist_ok=True)
        args.looks.write_text(looks_json(looks))
        s = looks["summary"]
        size = args.looks.stat().st_size / 1024
        print(f"wrote {args.looks} ({size:.0f} KB): {s['available']}/{s['cells']} looks, "
              f"{s['changed']} change his decision")  # fmt: skip
    if args.without_look:
        data = export_without_look(args.scenario, args.seed)
        args.without_look.parent.mkdir(parents=True, exist_ok=True)
        args.without_look.write_text(without_look_json(data))
        lines = [line["id"] for line in data["answers"]["en"]["lines"]]
        print(f"wrote {args.without_look}: {', '.join(lines)}")
        if args.out is None and not args.looks:
            return
    if args.out is None:
        if not (args.looks or args.steps):
            parser.error("--out is required, unless only --looks or --steps is written")
        return
    if args.match is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(hero_json(export_match(args.match)))
        print(f"wrote {args.out} ({args.out.stat().st_size / 1024:.0f} KB)")
        return
    data = export_hero(args.scenario, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(hero_json(data))
    print(f"wrote {args.out} ({args.out.stat().st_size / 1024:.0f} KB)")
    if args.payload_fixture:
        payload = render_payload_fixture(data)
        args.payload_fixture.write_text(payload_fixture_json(payload))
        print(f"wrote {args.payload_fixture} (fixture)")
    if args.what_if:
        what_ifs = export_what_ifs(args.scenario, args.seed)
        args.what_if.write_text(what_ifs_json(what_ifs))
        print(f"wrote {args.what_if} ({args.what_if.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
