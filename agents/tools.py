"""Tools the Analyst may call (SPEC 6), as plain functions over a MomentContext.

The MCP server (agents/mcp_server.py) exposes exactly these. Every tool returns compact JSON. Claims
come back already verified; the Analyst picks among them by id and never writes a number itself.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from agents.context import MomentContext
from analytics.pitch_control import pitch_control
from analytics.pressing import frame_pressing
from analytics.vision import player_visibility
from analytics.xt import xt_for
from sim.counterfactual import drop_scan_counterfactual


def _dump(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


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
    cf = (
        ctx.cf
        if scan_id in (None, ctx.cf.scan_id)
        else drop_scan_counterfactual(ctx.scenario, ctx.seed, scan_id)
    )
    return _dump(
        {"dropped_scan": cf.scan_id, "factual_action": cf.factual_action,
         "counterfactual_action": cf.counterfactual_action, "delta_xt": round(cf.delta_xt, 4)}
    )  # fmt: skip


TOOLS = {
    "get_moment": get_moment,
    "list_claims": list_claims,
    "get_vision": get_vision,
    "get_pitch_control": get_pitch_control,
    "get_xt": get_xt,
    "get_pressing": get_pressing,
    "run_counterfactual": run_counterfactual,
}
