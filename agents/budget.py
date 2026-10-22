"""What the Director's priority buys a breakdown (SPEC 6: the Director rate-limits breakdowns and
picks replay slots).

The Director's priority is the breakdown's budget, read by the agents after it:
- the Analyst inspects the moment through our MCP tools only at high priority; at normal and low
  it answers from the claims in its prompt, one model request instead of a tool loop;
- the replay gets a slot: the Telestrator's plan must end within it, or the template plan airs
  (reason code `duration_s: over_slot`). A slot is never shorter than the moment's template plan,
  so the fallback always fits.
The priority comes from the Director's reply, or from the rule on the lens delta when the Director
runs on its template (`agents.fallbacks.priority_for`).
"""

from __future__ import annotations

from dataclasses import dataclass

from agents.context import MomentContext
from agents.plan import EPS, PlanError, template_plan
from agents.schemas import Priority, TelestrationPlan


@dataclass(frozen=True)
class Budget:
    analyst_tools: bool  # the Analyst may call the MCP tools
    replay_slot_s: float  # the longest plan the replay may run


BUDGETS: dict[Priority, Budget] = {
    "high": Budget(analyst_tools=True, replay_slot_s=20.0),
    "normal": Budget(analyst_tools=False, replay_slot_s=16.0),
    "low": Budget(analyst_tools=False, replay_slot_s=12.0),
}


def budget(priority: Priority) -> Budget:
    return BUDGETS[priority]


def replay_slot(ctx: MomentContext, priority: Priority) -> float:
    """Seconds the replay may run at this priority: never less than the template plan's."""
    return max(BUDGETS[priority].replay_slot_s, template_plan(ctx).duration_s)


def replay_slots(ctx: MomentContext) -> dict[Priority, float]:
    return {p: replay_slot(ctx, p) for p in BUDGETS}


def slot_errors(plan: TelestrationPlan, slot_s: float) -> list[PlanError]:
    """A plan longer than its slot cannot air in it."""
    if plan.duration_s > slot_s + EPS:
        return [PlanError("duration_s", "over_slot", f"{plan.duration_s} s > {slot_s} s")]
    return []
