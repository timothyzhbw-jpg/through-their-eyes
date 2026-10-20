"""TelestrationPlan checks and the template plan (SPEC 6, 7).

The same two layers as web/src/plan/validate.ts: the shape (pydantic), then the meaning against
this moment (ids exist, times inside the clip, POV clips short, time never goes back). The template
plan ports web/src/plan/template.ts, so both sides fall back to the same breakdown.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from agents.context import MomentContext
from agents.schemas import (
    Camera,
    Freeze,
    Ghost,
    Play,
    Pov,
    Rewind,
    ScanMarker,
    TelestrationPlan,
    Voice,
    Zone,
)

MAX_POV_CLIP_S = 3.0  # SPEC 7: POV clips <= 3 s, against motion sickness
EPS = 1e-9

POV_SPEED = 0.5
POV_LEAD_S = 0.6  # POV starts this long before the key scan
POV_MAX_S = 2.4  # below MAX_POV_CLIP_S
OUTCOME_S = 2.0  # match time shown after the decision


def validate_plan(
    candidate: TelestrationPlan | dict[str, Any], ctx: MomentContext, script: set[str] | None = None
) -> list[str]:
    """Reasons the plan cannot be played; empty when it is valid. `script`: known line ids."""
    if isinstance(candidate, TelestrationPlan):
        plan = candidate
    else:
        try:
            plan = TelestrationPlan.model_validate(candidate)
        except ValidationError as e:
            return [
                f"{'.'.join(map(str, err['loc'])) or 'plan'}: {err['msg']}" for err in e.errors()
            ]
    errors: list[str] = []
    first, last = ctx.rel(0), ctx.rel(ctx.frames - 1)
    lines = script or set()

    def in_clip(where: str, rel: float) -> None:
        if rel < first - EPS or rel > last + EPS:
            errors.append(f"{where}: {rel} s is outside the clip [{first:.2f}, {last:.2f}]")

    def known_player(where: str, pid: str) -> None:
        if pid not in ctx.players:
            errors.append(f"{where}: unknown player {pid}")

    if plan.moment != ctx.card.id:
        errors.append(f"moment: plan is for {plan.moment}, not {ctx.card.id}")
    previous = 0.0
    for k, step in enumerate(plan.steps):
        where = f"steps.{k} ({step.do})"
        if step.t < previous - EPS:
            errors.append(f"{where}: t = {step.t} goes back in time")
        if step.t > plan.duration_s + EPS:
            errors.append(f"{where}: t = {step.t} is after the end")
        previous = max(previous, step.t)
        if isinstance(step, Rewind | Play):
            in_clip(where, step.to)
        elif isinstance(step, Pov):
            known_player(where, step.player)
            in_clip(where, step.from_)
            in_clip(where, step.to)
            if step.to <= step.from_:
                errors.append(f"{where}: empty POV clip")
            elif step.to - step.from_ > MAX_POV_CLIP_S + EPS:
                length = step.to - step.from_
                errors.append(
                    f"{where}: POV clip of {length:.2f} s is longer than {MAX_POV_CLIP_S} s"
                )
        elif isinstance(step, ScanMarker):
            if step.scan not in ctx.scans:
                errors.append(f"{where}: unknown scan {step.scan}")
            if step.label_claim is not None and step.label_claim not in ctx.supported:
                errors.append(f"{where}: unknown or unsupported claim {step.label_claim}")
        elif isinstance(step, Zone):
            known_player(where, step.player)
        elif isinstance(step, Ghost):
            if step.kind == "counterfactual" and step.cf != ctx.counterfactual_id:
                errors.append(f"{where}: unknown counterfactual {step.cf}")
        elif isinstance(step, Voice) and step.line not in lines:
            errors.append(f"{where}: no script line {step.line}")
    return errors


def template_plan(ctx: MomentContext) -> TelestrationPlan:
    """Freeze, rewind before the key scan, POV through it, mark it, show beliefs, play the
    outcome, then the counterfactual ghost. Valid by construction for any seed."""

    def r(x: float) -> float:
        return round(x, 2)

    first, last = ctx.rel(0), ctx.rel(ctx.frames - 1)
    key_start = ctx.rel(ctx.key_scan.frame)
    decision = ctx.rel(ctx.card.anchor_frame)
    start = r(max(first, key_start - POV_LEAD_S))
    end = r(min(last, start + POV_MAX_S, max(decision, start + 0.4)))
    play_to = r(min(last, max(end, decision + OUTCOME_S)))
    pov_start = 1.2
    pov_end = r(pov_start + (end - start) / POV_SPEED)
    play_start = r(pov_end + 0.6)
    play_end = r(play_start + (play_to - end))
    steps = [
        Freeze(t=0.0, do="freeze"),
        Rewind(t=0.4, do="rewind", to=start),
        Zone(t=0.6, do="zone", layer="vision", player=ctx.hero),
        Camera(t=0.8, do="camera", mode="pov"),
        Pov(t=pov_start, do="pov", player=ctx.hero, from_=start, to=end, speed=POV_SPEED),
        ScanMarker(t=1.4, do="scan_marker", scan=ctx.key_scan.id, label_claim=None),
        Ghost(t=1.6, do="ghost", kind="belief", cf=None),
        Camera(t=r(pov_end + 0.4), do="camera", mode="split"),
        Play(t=play_start, do="play", to=play_to, speed=1.0),
        Ghost(t=r(play_end + 0.4), do="ghost", kind="counterfactual", cf=ctx.counterfactual_id),
    ]
    return TelestrationPlan(moment=ctx.card.id, duration_s=r(play_end + 3.0), steps=steps)


def voice_times(plan: TelestrationPlan, n: int) -> list[float]:
    """Spread n lines over the plan: after the freeze, before the last second."""
    if n == 0:
        return []
    start, end = 0.2, max(0.4, plan.duration_s - 1.0)
    step = (end - start) / n
    return [round(start + i * step, 2) for i in range(n)]
