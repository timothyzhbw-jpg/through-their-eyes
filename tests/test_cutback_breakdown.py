"""The cutback hero in the app (SPEC 3.6, 6): the winger's look into the box.

`cutback_scan`'s hero H7 is an ordinary scan hero with a decision on the ball. Without the look
he keeps the ball (a carry, or a legacy shot), which `cf_carry` says in words.
"""

import asyncio

import pytest

from agents.context import MomentContext
from agents.workflow import run_breakdown

SCENARIO, DEMO = "cutback_scan", 7
PERSONAS = ("casual", "analyst", "player_fan", "coach", "audio_description")


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load(SCENARIO, DEMO)


def test_the_look_is_told_through_the_scan_lens(ctx):
    assert ctx.card.selected_lens == "scan"
    assert ctx.card.lens("scan").metrics["scan_id"] == ctx.key_scan.id
    assert all(v.status == "supported" for v in ctx.verdicts.values())


@pytest.mark.parametrize("seed,did", [(7, "carried the ball"), (9, "shot")])
def test_without_the_look_he_keeps_the_ball(seed, did):
    ctx = MomentContext.load(SCENARIO, seed)
    claim = ctx.claims["cf_carry"]
    assert ctx.verdicts["cf_carry"].status == "supported"
    assert claim.kind == "counterfactual" and claim.template.endswith(f"would have {did}.")
    assert "cf_pass" not in ctx.claims


def test_every_persona_tells_the_cutback_in_both_languages(ctx):
    result = asyncio.run(run_breakdown(ctx, client=None, personas=PERSONAS,
                                       languages=("en", "zh")))  # fmt: skip
    for script in result.scripts:
        claims = {c for line in script.payload.lines for c in line.claims}
        assert script.payload.lines and not script.dropped, (script.persona, script.language)
        assert "cf_carry" in claims, (script.persona, script.language)


def test_a_seed_whose_hero_shot_and_lost_it_still_loads():
    """Seed 3: H7 takes the legacy shot and it is intercepted (no runner_received claim)."""
    ctx = MomentContext.load(SCENARIO, 3)
    assert "runner_received" not in ctx.claims
    assert all(v.status == "supported" for v in ctx.verdicts.values())
