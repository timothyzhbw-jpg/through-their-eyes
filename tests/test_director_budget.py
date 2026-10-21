"""The Director's priority is the breakdown's budget (SPEC 6, agents/budget.py).

The agents after the Director read it: the Analyst gets the MCP tools only at high priority, and
the Telestrator's plan must end within the replay slot the priority buys, or the template plan
airs. Scripted replies (agents/testing.py); no model is called.
"""

import json
import re

import pytest

from agents import prompts
from agents.budget import BUDGETS, replay_slot, slot_errors
from agents.context import MomentContext
from agents.plan import template_plan, validate_plan
from agents.testing import ToolCallingFakeChatClient
from agents.workflow import breakdown

ANCHORED = {"lines": [{"claim": "scan_before_reception", "connective": None}]}


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


def replies(ctx, priority="high", plan=None):
    return {
        "director": {"priority": priority, "reason": "The look decides the pass."},
        "analyst": {"lens": "scan", "headline": ["scan_before_reception"],
                    "supporting": ["blind_side"], "angle": "He saw the runner."},
        "telestrator": plan or template_plan(ctx).model_dump(by_alias=True),
        "pbp": ANCHORED,
        "color": {"lines": [{"claim": "cf_pass", "connective": None}]},
    }  # fmt: skip


def run(ctx, fake, **kwargs):
    return breakdown(ctx, client=fake, personas=("analyst",), languages=("en",), **kwargs)


def test_only_a_high_priority_breakdown_gives_the_analyst_the_mcp_tools(ctx):
    high = ToolCallingFakeChatClient(replies=replies(ctx, "high"))
    run(ctx, high, use_mcp=True)
    assert "list_claims" in high.tools["analyst"]
    normal = ToolCallingFakeChatClient(replies=replies(ctx, "normal"))
    r = run(ctx, normal, use_mcp=True)
    assert normal.tools["analyst"] == []
    (analyst,) = [e for e in r.trace if e.step == "analyst"]
    assert "no MCP tools at normal priority (the Director's budget)" in analyst.notes


def test_the_telestrator_is_given_the_slot_its_priority_buys(ctx):
    for priority in BUDGETS:
        fake = ToolCallingFakeChatClient(replies=replies(ctx, priority))
        run(ctx, fake)
        sent = json.loads(fake.prompts["telestrator"][0])
        assert sent["replay_slot_s"] == replay_slot(ctx, priority)
    assert replay_slot(ctx, "low") < replay_slot(ctx, "normal") < replay_slot(ctx, "high")


def test_a_plan_longer_than_its_slot_does_not_air(ctx):
    plan = template_plan(ctx).model_dump(by_alias=True)
    plan["duration_s"] = 18.0  # fits the high slot, not the normal one
    assert not validate_plan(template_plan(ctx).model_copy(update={"duration_s": 18.0}), ctx)
    high = run(ctx, ToolCallingFakeChatClient(replies=replies(ctx, "high", plan)))
    assert high.plan_source == "agent" and high.plan.duration_s == 18.0
    normal = run(ctx, ToolCallingFakeChatClient(replies=replies(ctx, "normal", plan)))
    assert normal.plan_source == "template" and normal.plan_errors == ["duration_s: over_slot"]


def test_the_director_on_its_template_sets_the_budget_by_the_rule(ctx):
    """Director down: the rule on the lens delta sets the priority (high here), and the budget
    follows it: the Analyst still gets the tools."""
    fake = ToolCallingFakeChatClient(replies=replies(ctx))
    r = run(ctx, fake, use_mcp=True, down=["director"])
    assert r.request.priority == "high" and "director" not in fake.calls
    assert "list_claims" in fake.tools["analyst"]


@pytest.mark.parametrize(
    "scenario", ["blind_side_run", "press_escape", "corner_blind_side", "far_post_finish"]
)
def test_the_template_plan_fits_every_slot(scenario):
    ctx = MomentContext.load(scenario, 0)
    template = template_plan(ctx)
    for priority in BUDGETS:
        assert not slot_errors(template, replay_slot(ctx, priority))


def test_the_director_is_told_what_its_priority_buys():
    for b in BUDGETS.values():
        assert re.search(rf"\b{b.replay_slot_s:.0f}\b", prompts.DIRECTOR)
    assert "MCP" in prompts.DIRECTOR and "seconds" in prompts.DIRECTOR
