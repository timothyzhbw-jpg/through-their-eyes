"""Tools the Analyst may call (SPEC 6), as plain functions over a MomentContext.

The MCP server (agents/mcp_server.py) exposes exactly these. Every tool returns compact JSON. Claims
come back already verified; the Analyst picks among them by id and never writes a number itself.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from agents.context import MomentContext
from analytics.live_stats import StatsTimeline, stats_from_run
from analytics.pitch_control import pitch_control
from analytics.pressing import frame_pressing
from analytics.vision import player_visibility
from analytics.xt import xt_for
from sim.counterfactual import drop_scan_counterfactual, what_if_id

NO_DECISION = (
    "no decision on the ball in this moment: the hero is a marker, and his look is the story"
)


def _dump(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


# One timeline per context. The context is held so its id cannot be reused for another object.
_MATCH_STATS: dict[int, tuple[MomentContext, StatsTimeline]] = {}


def _frame(ctx: MomentContext, frame: int) -> int:
    return int(min(max(frame, 0), ctx.frames - 1))


def get_moment(ctx: MomentContext, moment_id: str | None = None) -> str:
    card = ctx.cards.get(moment_id or ctx.card.id, ctx.card)
    return card.model_dump_json()


def list_claims(ctx: MomentContext, language: str = "en") -> str:
    out = []
    for cid, claim in ctx.claims.items():
        out.append(
            {
                "id": cid,
                "kind": claim.kind,
                "verdict": ctx.verdicts[cid].status,
                "template": claim.template_for(language),
                "slots": sorted(claim.slots),
                "values": {
                    k: s.value if s.value is not None else s.ref for k, s in claim.slots.items()
                },
                "evidence": claim.evidence,
            }
        )
    return _dump(out)


def get_vision(ctx: MomentContext, player: str, frame: int) -> str:
    f, run = _frame(ctx, frame), ctx.run
    i = run.index(player)
    speed = np.linalg.norm(run.vel[f], axis=-1)
    v = player_visibility(run.pos[f], run.head_yaw[f], speed)[i]
    seen = [pid for j, pid in enumerate(run.ids) if j != i and v[j] >= 0.5]
    return _dump(
        {"frame": f, "player": player, "in_sight": seen,
         "visibility": {pid: round(float(v[j]), 2) for j, pid in enumerate(run.ids) if j != i}}
    )  # fmt: skip


def get_pitch_control(ctx: MomentContext, x: float, y: float, frame: int) -> str:
    f, run = _frame(ctx, frame), ctx.run
    team = np.array([p.team for p in run.players])
    home = team == 0
    p = pitch_control(
        np.array([[x, y]]), run.pos[f][home], run.vel[f][home], run.pos[f][~home], run.vel[f][~home]
    )[0]
    return _dump({"frame": f, "point": [x, y], "home": round(float(p), 3),
                  "away": round(1.0 - float(p), 3)})  # fmt: skip


def get_xt(ctx: MomentContext, x: float, y: float, team: int = 0) -> str:
    sign = 1 if team == 0 else -1
    return _dump(
        {"point": [x, y], "team": team, "xt": round(float(xt_for(np.array([x, y]), sign)), 4)}
    )


def get_pressing(ctx: MomentContext, frame: int) -> str:
    f, run = _frame(ctx, frame), ctx.run
    carrier = int(run.owner[f])
    if carrier < 0:
        return _dump({"frame": f, "carrier": None, "on_carrier": None})
    team = np.array([p.team for p in run.players])
    pf = frame_pressing(run.pos[f], run.vel[f], team, run.ball_pos[f], carrier)
    return _dump(
        {"frame": f, "carrier": run.ids[carrier], "on_carrier": round(float(pf.on_carrier), 3)}
    )


def run_counterfactual(ctx: MomentContext, scan_id: str | None = None) -> str:
    """The moment's own counterfactual (by default), or the run without another scan."""
    if scan_id in (None, ctx.cf.scan_id):
        cf, intervention = ctx.cf, ctx.intervention
    elif scan_id not in ctx.scans:
        # Seen live: a model passed an id that is not a scan, which raised inside the re-sim.
        hero_scans = [s for s in ctx.scans if ctx.run.event(s).player == ctx.hero]
        key_scan = ctx.key_scan.id if ctx.key_scan is not None else None
        return _dump({"error": f"{scan_id} is not a scan id", "key_scan": key_scan,
                      "hero_scans": hero_scans})  # fmt: skip
    else:
        cf, intervention = drop_scan_counterfactual(ctx.scenario, ctx.seed, scan_id), "drop_scan"
    if cf.factual_decision is None:  # a marker's look: no decision on the ball to compare
        lens = ctx.card.lens("scan")
        metrics = lens.metrics if lens is not None and lens.available else {}
        keep = (
            "separation_with_scan_m",
            "separation_without_scan_m",
            "pressure_with_scan",
            "pressure_without_scan",
            "outcome_with_scan",
            "outcome_without_scan",
        )
        return _dump(
            {"intervention": intervention, "dropped_scan": cf.scan_id,
             "factual_action": None, "counterfactual_action": None,
             "delta_xt": lens.delta_xt if metrics else None,
             **{k: metrics[k] for k in keep if k in metrics and cf.scan_id == metrics["scan_id"]}}
        )  # fmt: skip
    return _dump(
        {"intervention": intervention,
         "dropped_scan": cf.scan_id if intervention == "drop_scan" else None,
         "factual_action": cf.factual_action, "counterfactual_action": cf.counterfactual_action,
         "delta_xt": round(cf.delta_xt, 4)}
    )  # fmt: skip


def list_options(ctx: MomentContext) -> str:
    """The options the hero evaluated at his decision, on his belief."""
    decision = ctx.run.hero_decision()
    if decision is None:
        return _dump({"error": NO_DECISION, "moment": ctx.card.kind})
    return _dump([
        {"action": o.action, "prob": round(o.prob, 3), "p_success": round(o.p_success, 3),
         "value": round(o.value, 4), "chosen": o.action == decision.chosen}
        for o in decision.options
    ])  # fmt: skip


def get_live_stats(
    ctx: MomentContext,
    player: str | None = None,
    frame: int | None = None,
    stats: StatsTimeline | None = None,
    limit: int = 20,
) -> str:
    """Live match stats measured from tracking, not verified claims (SPEC 4.6)."""
    timeline = stats
    if timeline is None:
        cached = _MATCH_STATS.get(id(ctx))
        if cached is None or cached[0] is not ctx:
            timeline = stats_from_run(ctx.run, f"{ctx.scenario}-{ctx.seed}")
            _MATCH_STATS[id(ctx)] = (ctx, timeline)
        else:
            timeline = cached[1]
    data = timeline.snapshot(frame).model_dump(mode="json")
    if player is not None:
        data["players"] = [p for p in data["players"] if p["id"] == player]
        data["cues"] = [
            c for c in data["cues"] if c.get("player") == player or c.get("receiver") == player
        ]
    data["cues"] = data["cues"][-limit:]
    return _dump(data)


def what_if(ctx: MomentContext, action: str) -> str:
    """Re-simulate the hero's decision with `action` forced (SPEC 3.7)."""
    decision = ctx.run.hero_decision()
    if decision is None:
        return _dump({"error": NO_DECISION, "action": action})
    if action not in {o.action for o in decision.options}:
        return _dump({"error": f"{action} is not one of his options", "action": action})
    result = ctx.evaluator.counterfactual(what_if_id(decision.player, decision.frame, action))
    passes = [
        e for e in result.counterfactual.events
        if e.type == "pass" and e.player == decision.player and e.frame == decision.frame
    ]  # fmt: skip
    outcome = passes[0].attrs if passes else {}
    return _dump(
        {"what_if": result.id, "factual_action": result.factual_action,
         "counterfactual_action": result.counterfactual_action,
         "outcome": outcome.get("outcome"), "receiver": outcome.get("receiver"),
         "delta_xt": round(result.delta_xt, 4)}
    )  # fmt: skip


# --- the recap's tools (SPEC 6, recap): over its verified evidence, `RecapContext.evidence()` ----


def get_match_stats(evidence: dict[str, Any]) -> str:
    """The match's verified totals: the final score, then per team passes, scans, balls won back."""
    return _dump({"match": evidence["match"], "score": evidence["score"],
                  "duration_s": evidence["duration_s"], "stats": evidence["stats"]})  # fmt: skip


def list_key_moments(evidence: dict[str, Any]) -> str:
    """The key-moment candidates, most important first, without their claims' sentences."""
    keys = ("moment", "rank", "kind", "tags", "actor", "receiver", "lens", "impact", "hero",
            "possession")  # fmt: skip
    moments = [{k: m[k] for k in keys} | {"claims": [c["id"] for c in m["claims"]]}
               for m in evidence["moments"]]  # fmt: skip
    return _dump(moments)


def list_recap_claims(evidence: dict[str, Any]) -> str:
    """Every claim the recap may air, already verified: the match's, then each moment's."""
    claims = evidence["stats"] + [
        {**c, "moment": m["moment"]} for m in evidence["moments"] for c in m["claims"]
    ]
    return _dump(claims)


RECAP_TOOLS = {
    "get_match_stats": get_match_stats,
    "list_key_moments": list_key_moments,
    "list_recap_claims": list_recap_claims,
}


TOOLS = {
    "get_moment": get_moment,
    "list_claims": list_claims,
    "get_vision": get_vision,
    "get_pitch_control": get_pitch_control,
    "get_xt": get_xt,
    "get_pressing": get_pressing,
    "get_live_stats": get_live_stats,
    "run_counterfactual": run_counterfactual,
    "list_options": list_options,
    "what_if": what_if,
}
