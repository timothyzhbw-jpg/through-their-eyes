"""TelestrationPlan checks and the template plan (SPEC 6, 7).

The same two layers as web/src/plan/validate.ts: the shape (pydantic), then the meaning against
this moment (ids exist, times inside the clip, POV clips short, time never goes back). The template
plan ports web/src/plan/template.ts, so both sides fall back to the same breakdown.
"""

from __future__ import annotations

from dataclasses import dataclass
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


@dataclass(frozen=True)
class PlanError:
    """Why a plan cannot be played. `where` and `code` are ours: a field path, the step's kind and a
    fixed reason. Only they are public (the trace, `plan_errors`); `detail` quotes what the model
    wrote, which may hold a number, so it stays in tests and debugging (SPEC 5.3, 6)."""

    where: str
    code: str
    detail: str

    @property
    def public(self) -> str:
        return f"{self.where}: {self.code}"

    def __str__(self) -> str:
        return f"{self.where}: {self.detail}"


def shape_errors(e: ValidationError) -> list[PlanError]:
    """Field and error type, like `agents.llm.describe`: pydantic's message may quote the input,
    and a key the model added (extra_forbidden) is its own text, so it is not named."""
    errors = []
    for err in e.errors():
        loc = err["loc"][:-1] if err["type"] == "extra_forbidden" else err["loc"]
        errors.append(PlanError(".".join(map(str, loc)) or "plan", err["type"], err["msg"]))
    return errors


def validate_plan(
    candidate: TelestrationPlan | dict[str, Any], ctx: MomentContext, script: set[str] | None = None
) -> list[PlanError]:
    """Reasons the plan cannot be played; empty when it is valid. `script`: known line ids."""
    if isinstance(candidate, TelestrationPlan):
        plan = candidate
    else:
        try:
            plan = TelestrationPlan.model_validate(candidate)
        except ValidationError as e:
            return shape_errors(e)
    errors: list[PlanError] = []
    first, last = ctx.rel(0), ctx.rel(ctx.frames - 1)
    lines = script or set()

    def fail(where: str, code: str, detail: str) -> None:
        errors.append(PlanError(where, code, detail))

    def in_clip(where: str, rel: float) -> None:
        if rel < first - EPS or rel > last + EPS:
            fail(where, "outside_clip", f"{rel} s is outside the clip [{first:.2f}, {last:.2f}]")

    def known_player(where: str, pid: str) -> None:
        if pid not in ctx.players:
            fail(where, "unknown_player", f"unknown player {pid}")

    if plan.moment != ctx.card.id:
        fail("moment", "wrong_moment", f"plan is for {plan.moment}, not {ctx.card.id}")
    previous = 0.0
    for k, step in enumerate(plan.steps):
        where = f"steps.{k} ({step.do})"
        if step.t < previous - EPS:
            fail(where, "goes_back_in_time", f"t = {step.t} goes back in time")
        if step.t > plan.duration_s + EPS:
            fail(where, "after_the_end", f"t = {step.t} is after the end")
        previous = max(previous, step.t)
        if isinstance(step, Rewind | Play):
            in_clip(f"{where}.to", step.to)
        elif isinstance(step, Pov):
            known_player(where, step.player)
            in_clip(f"{where}.from", step.from_)
            in_clip(f"{where}.to", step.to)
            if step.to <= step.from_:
                fail(where, "empty_pov_clip", "empty POV clip")
            elif step.to - step.from_ > MAX_POV_CLIP_S + EPS:
                length = step.to - step.from_
                fail(where, "pov_too_long",
                     f"POV clip of {length:.2f} s is longer than {MAX_POV_CLIP_S} s")  # fmt: skip
        elif isinstance(step, ScanMarker):
            if step.scan not in ctx.scans:
                fail(where, "unknown_scan", f"unknown scan {step.scan}")
            if step.label_claim is not None and step.label_claim not in ctx.supported:
                fail(where, "unsupported_claim",
                     f"unknown or unsupported claim {step.label_claim}")  # fmt: skip
        elif isinstance(step, Zone):
            known_player(where, step.player)
        elif isinstance(step, Ghost):
            if step.kind == "counterfactual" and step.cf != ctx.counterfactual_id:
                fail(where, "unknown_counterfactual", f"unknown counterfactual {step.cf}")
        elif isinstance(step, Voice) and step.line not in lines:
            fail(where, "unknown_line", f"no script line {step.line}")
    return errors


def template_plan(ctx: MomentContext) -> TelestrationPlan:
    """Freeze, rewind before the key scan, POV through it, mark it, show beliefs, play the
    outcome, then the counterfactual ghost. Without a key scan (a pressure hero), the POV runs up
    to the decision instead and there is no scan marker. Valid by construction for any seed."""

    def r(x: float) -> float:
        return round(x, 2)

    first, last = ctx.rel(0), ctx.rel(ctx.frames - 1)
    decision = ctx.rel(ctx.card.anchor_frame)
    key = ctx.key_scan
    key_start = ctx.rel(key.frame) if key is not None else decision - POV_MAX_S + POV_LEAD_S
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
        *([ScanMarker(t=1.4, do="scan_marker", scan=key.id, label_claim=None)] if key else []),
        Ghost(t=1.6, do="ghost", kind="belief", cf=None),
        Camera(t=r(pov_end + 0.4), do="camera", mode="split"),
        Play(t=play_start, do="play", to=play_to, speed=1.0),
        Ghost(t=r(play_end + 0.4), do="ghost", kind="counterfactual", cf=ctx.counterfactual_id),
    ]
    return TelestrationPlan(moment=ctx.card.id, duration_s=r(play_end + 3.0), steps=steps)


@dataclass(frozen=True)
class View:
    """What one audience sees during the replay (SPEC 6, "Persona specs"; SPEC 7)."""

    main: str  # the camera every non-POV camera step becomes
    pov_camera: str = "pov"  # what a POV camera step becomes: the POV full, or beside the board
    pov: bool = True  # the first-person clip; False plays the same match time on `main`
    zones: tuple[str, ...] = ()  # overlay layers turned on where the plan turns on its first
    belief: bool = True  # the belief ghost (by default the runner's: the one highlighted player)
    counterfactual: bool = True  # the ghost of the run without the look
    counterfactual_early: bool = False  # shown as the POV ends, beside the outcome
    scan_marker: bool = True


# casual: his eyes, the runner highlighted, the outcome on the broadcast camera; analyst: the
# tactical board from the first second, with pitch control and his pass options, his eyes in the
# corner; coach: POV and board side by side, the look marked, the run without the look shown as
# soon as the look is; player fan: his eyes, then the camera locked on him; audio description: as
# little as possible, on the broadcast camera.
VIEWS: dict[str, View] = {
    "casual": View("broadcast", scan_marker=False),
    "analyst": View("tactical", "tactical", zones=("vision", "pitch_control", "options")),
    "coach": View("split", "split", zones=("vision", "options"), counterfactual_early=True),
    "player_fan": View("player_lock", zones=("vision",), belief=False, counterfactual=False),
    "audio_description": View("broadcast", pov=False, belief=False, counterfactual=False,
                              scan_marker=False),
}  # fmt: skip


def persona_plan(plan: TelestrationPlan, persona: str, ctx: MomentContext) -> TelestrationPlan:
    """The plan re-cut for one audience, in code: camera modes and overlay steps change; times,
    the replayed match time and the plan's length do not, so a valid plan stays valid. A persona
    without a view plays the plan as it is."""
    view = VIEWS.get(persona)
    if view is None:
        return plan
    steps: list = []
    zoned = False

    def zones(t: float) -> list[Zone]:
        return [Zone(t=t, do="zone", layer=layer, player=ctx.hero) for layer in view.zones
                if layer != "vision"]  # fmt: skip

    for step in plan.steps:
        if isinstance(step, Camera):
            mode = view.pov_camera if step.mode == "pov" and view.pov else view.main
            last = next((s for s in reversed(steps) if isinstance(s, Camera)), None)
            if last is None or last.mode != mode:  # the same camera again is no cut
                steps.append(step.model_copy(update={"mode": mode}))
        elif isinstance(step, Pov) and not view.pov:
            steps += [Rewind(t=step.t, do="rewind", to=step.from_),
                      Play(t=step.t, do="play", to=step.to, speed=step.speed)]  # fmt: skip
        elif isinstance(step, Zone):
            if step.layer == "vision" and "vision" in view.zones:
                steps.append(step)
            if not zoned:
                steps += zones(step.t)
                zoned = True
        elif isinstance(step, Ghost):
            if view.belief if step.kind == "belief" else view.counterfactual:
                steps.append(step)
        elif isinstance(step, ScanMarker):
            if view.scan_marker:
                steps.append(step)
        else:
            steps.append(step)
    if not zoned and view.zones:
        at = next((i for i, s in enumerate(steps) if isinstance(s, Rewind)), 0)
        steps[at + 1 : at + 1] = zones(steps[at].t if steps else 0.0)
        if "vision" in view.zones:
            t = steps[at].t if steps else 0.0
            steps.insert(at + 1, Zone(t=t, do="zone", layer="vision", player=ctx.hero))
    if view.counterfactual and view.counterfactual_early:
        ghost = next((s for s in steps if isinstance(s, Ghost) and s.kind == "counterfactual"),
                     None)  # fmt: skip
        pov_end = _pov_end(plan)
        if ghost is not None and pov_end is not None and pov_end < ghost.t:
            steps.remove(ghost)
            steps.append(ghost.model_copy(update={"t": pov_end}))
    steps.sort(key=lambda s: s.t)  # stable: at equal times the order above stays
    return plan.model_copy(update={"steps": steps})


def _pov_end(plan: TelestrationPlan) -> float | None:
    """When the plan's first POV clip ends on the plan clock, rounded as the template rounds."""
    pov = next((s for s in plan.steps if isinstance(s, Pov)), None)
    if pov is None:
        return None
    return round(pov.t + (pov.to - pov.from_) / pov.speed, 2)


def voice_times(plan: TelestrationPlan, n: int) -> list[float]:
    """Spread n lines over the plan: after the freeze, before the last second."""
    if n == 0:
        return []
    start, end = 0.2, max(0.4, plan.duration_s - 1.0)
    step = (end - start) / n
    return [round(start + i * step, 2) for i in range(n)]
