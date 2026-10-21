"""The save hero in the app (SPEC 3.6, 5, 6): the keeper's step for a sightline.

`screened_shot`'s hero H1 has no decision on the ball. His moment is his step before the shot
(`keeper_step`), explained by the `sight` lens: P(save) with the step minus without it.
"""

import asyncio
import json
import math

import pytest
from fastapi.testclient import TestClient

from agents.context import MomentContext
from agents.delivery import ANALYST_NUMBERS
from agents.plan import template_plan, validate_plan
from agents.whatif import NO_DECISION_REFUSAL, answer_question
from agents.workflow import run_breakdown
from api.main import create_app
from api.settings import Settings
from explain.moments import detect_keeper_steps, detect_moments, hero_card
from sim.engine import Simulation
from sim.export import export_hero
from sim.match import build_match

SCENARIO, DEMO, HERO, SHOOTER = "screened_shot", 0, "H1", "A10"
PERSONAS = ("casual", "analyst", "player_fan", "coach", "audio_description")
KEEPER_CLAIMS = {"keeper_step", "first_sight", "shot_end", "cf_first_sight", "cf_shot_end",
                 "cf_save_chance"}  # fmt: skip


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load(SCENARIO, DEMO)


@pytest.mark.parametrize("seed", range(4))
def test_the_keepers_step_is_one_moment(seed):
    run = Simulation.from_scenario(SCENARIO, seed).run()
    (card,) = detect_keeper_steps(run)
    assert (card.kind, card.actor) == ("keeper_step", HERO)
    assert card.anchors["step"] == run.key_step().id
    assert run.event(card.anchors["shot"]).player == SHOOTER
    assert card.candidate_lenses == ["sight"]
    assert hero_card(run, detect_moments(run)) is not None


def test_no_other_run_has_a_keepers_step():
    runs = [Simulation.from_scenario(s, seed).run()
            for s in ("blind_side_run", "press_escape", "far_post_finish", "corner_blind_side")
            for seed in range(5)]  # fmt: skip
    runs += [p.run for p in build_match(1).possessions]
    assert not [c.id for run in runs for c in detect_keeper_steps(run)]


def test_the_sight_lens_is_the_save_models_difference(ctx):
    assert ctx.card.selected_lens == "sight" and ctx.intervention == "drop_step"
    lens = ctx.card.lens("sight")
    m = lens.metrics
    assert lens.delta_xt == pytest.approx(m["p_save_with_step"] - m["p_save_without_step"])
    assert lens.delta_xt >= 0.4
    assert m["first_sight_without_step_s"] > m["first_sight_with_step_s"]
    assert (m["outcome_with_step"], m["outcome_without_step"]) == ("saved", "goal")
    assert ctx.key_scan is None and ctx.key_step.id == m["step_id"]


def test_every_keeper_claim_is_built_and_supported(ctx):
    assert set(ctx.claims) == KEEPER_CLAIMS
    assert all(v.status == "supported" for v in ctx.verdicts.values())
    kinds = {cid: c.kind for cid, c in ctx.claims.items()}
    assert kinds["keeper_step"] == kinds["first_sight"] == kinds["shot_end"] == "observed"
    assert {c for c, k in kinds.items() if k == "counterfactual"} == {
        "cf_first_sight", "cf_shot_end", "cf_save_chance"
    }  # fmt: skip
    assert ctx.claims["cf_shot_end"].template == "Without the step, {shooter} scores."


def test_every_persona_tells_the_step_in_both_languages(ctx):
    result = asyncio.run(run_breakdown(ctx, client=None, personas=PERSONAS,
                                       languages=("en", "zh")))  # fmt: skip
    assert result.findings.lens == "sight" and result.findings.headline[0] == "keeper_step"
    for script in result.scripts:
        claims = {c for line in script.payload.lines for c in line.claims}
        assert script.payload.lines and not script.dropped, (script.persona, script.language)
        assert "keeper_step" in claims
        if script.persona == "audio_description":
            assert not claims & ANALYST_NUMBERS


def test_the_plan_follows_the_keeper_without_a_scan_marker(ctx):
    plan = template_plan(ctx)
    assert not validate_plan(plan, ctx, set())
    assert not any(s.do == "scan_marker" for s in plan.steps)
    assert next(s for s in plan.steps if s.do == "pov").player == HERO


@pytest.mark.parametrize("language", ["en", "zh"])
def test_a_what_if_is_refused_for_the_keepers_step(ctx, language):
    answer = asyncio.run(answer_question(ctx, "What if he had stayed?", language))
    assert answer.action is None and answer.refusal == NO_DECISION_REFUSAL[language]


def test_the_export_names_the_step_and_its_counterfactual():
    data = export_hero(SCENARIO, DEMO)
    assert data["key_scan"] is None
    assert data["key_step"]["id"].startswith("step:H1:") and data["key_step"]["key"] is True
    assert data["counterfactual"] == {"id": "cf1", "intervention": "drop_step",
                                      "step": data["key_step"]["id"]}  # fmt: skip


def test_the_api_serves_the_keepers_moment(tmp_path, monkeypatch):
    monkeypatch.setenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "")
    mid = f"{SCENARIO}-{DEMO}"
    with TestClient(create_app(Settings(matches=[(SCENARIO, DEMO)], cache_dir=tmp_path))) as c:
        info = c.get(f"/api/matches/{mid}").json()
        assert info["hero_moment"].startswith("m:keeper_step:H1:")
        export = c.get(f"/api/matches/{mid}/export")
        assert export.status_code == 200
        delta = json.loads(export.text)["delta_xt"]  # no decision: no possession value
        assert delta is None or math.isnan(delta)
        out = c.post("/api/breakdowns", json={"match": mid, "personas": ["casual"],
                                              "languages": ["en"]}).json()  # fmt: skip
        assert out["result"]["findings"]["lens"] == "sight"
        assert out["result"]["scripts"][0]["payload"]["lines"]
