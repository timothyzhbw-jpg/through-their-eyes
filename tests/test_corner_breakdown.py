"""The set-piece hero in the app (SPEC 3.6, 5, 6): a marker's look, with no decision on the ball.

`corner_blind_side` has a hero, the marker H5, who never has the ball. His moment is a
`marker_scan` card; the scan lens, claims, narration, tools, what-if and API all work on it, and
none of the other heroes' moments, claims or breakdowns change.
"""

import asyncio
import json
import math

import pytest
from fastapi.testclient import TestClient

from agents import tools
from agents.context import MomentContext
from agents.delivery import ANALYST_NUMBERS
from agents.plan import template_plan, validate_plan
from agents.whatif import NO_DECISION_REFUSAL, answer_question
from agents.workflow import run_breakdown
from api.main import create_app
from api.settings import Settings
from explain import lexicon
from explain.lenses import explain_moments
from explain.moments import detect_marker_scans, detect_moments, hero_card
from sim.engine import Simulation
from sim.match import build_match

SCENARIO, DEMO, HERO, RUNNER = "corner_blind_side", 0, "H5", "A9"
PERSONAS = ("casual", "analyst", "player_fan", "coach", "audio_description")
MARKER_CLAIMS = {"marker_unseen", "blind_side", "marker_scan", "seen_in_scan", "scan_side",
                 "runner_received", "reception_zone", "stayed_with_runner", "runner_pressure",
                 "cf_lost_runner", "cf_unmarked", "cf_belief_error", "cf_value"}  # fmt: skip


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load(SCENARIO, DEMO)


@pytest.fixture(scope="module")
def breakdown(ctx):
    return asyncio.run(run_breakdown(ctx, client=None, personas=PERSONAS, languages=("en", "zh")))


# --- detection ---------------------------------------------------------------------------


@pytest.mark.parametrize("seed", range(6))
def test_the_markers_look_is_one_moment_on_the_key_scan(seed):
    run = Simulation.from_scenario(SCENARIO, seed).run()
    (card,) = detect_marker_scans(run)
    assert (card.kind, card.actor, card.receiver) == ("marker_scan", HERO, RUNNER)
    assert card.anchors["scan"] == run.key_scan().id
    assert run.event(card.anchors["pass"]).attrs["to"] == RUNNER
    assert card.anchor_frame == run.event(card.anchors["completion"]).frame
    assert hero_card(run, detect_moments(run)) is not None


def test_no_other_hero_moment_is_a_markers_look():
    """The other heroes' runs have no marker's look. Open play can have one, as it should: a
    defender checking the man he marks before a pass to him (the 20-possession match-1 has one)."""
    runs = [Simulation.from_scenario(s, seed).run()
            for s, seeds in (("blind_side_run", range(20)), ("press_escape", range(20)),
                             ("possession_play", range(20)))
            for seed in seeds]  # fmt: skip
    assert not [c.id for run in runs for c in detect_marker_scans(run)]


def test_a_markers_look_in_open_play_is_not_a_hero_card():
    for p in build_match(1).possessions:
        card = hero_card(p.run, detect_moments(p.run))
        assert card is None or card.kind != "marker_scan" or p.scenario == SCENARIO


def test_a_decision_hero_keeps_his_decision_card():
    run = Simulation.from_scenario("blind_side_run", 3).run()
    d = run.hero_decision()
    card = hero_card(run, detect_moments(run))
    assert (card.actor, card.anchor_frame) == (d.player, d.frame)
    assert card.kind != "marker_scan"


# --- the lens ----------------------------------------------------------------------------------


def test_only_the_scan_lens_reads_a_markers_look(ctx):
    card = ctx.card
    assert card.kind == "marker_scan" and card.selected_lens == "scan"
    scan, space, pressure = (card.lens(k) for k in ("scan", "space", "pressure"))
    assert scan.available and scan.delta_xt > 0
    assert not space.available and not pressure.available
    assert "no decision on the ball" in space.note and "no decision on the ball" in pressure.note
    m = scan.metrics
    assert m["key_scan"] and m["scan_id"] == ctx.key_scan.id
    assert m["separation_with_scan_m"] < 5.0 < m["separation_without_scan_m"]
    assert m["pressure_with_scan"] > m["pressure_without_scan"]
    assert m["belief_error_without_scan_m"] > m["belief_error_with_scan_m"]


# --- claims and narration ------------------------------------------------------------------


def test_every_marker_claim_is_built_and_supported(ctx):
    assert set(ctx.claims) == MARKER_CLAIMS
    assert all(v.status == "supported" for v in ctx.verdicts.values())
    kinds = {cid: c.kind for cid, c in ctx.claims.items()}
    assert kinds["marker_scan"] == "observed" and kinds["stayed_with_runner"] == "observed"
    assert kinds["seen_in_scan"] == "computed" and kinds["marker_unseen"] == "computed"
    assert {cid for cid, k in kinds.items() if k == "counterfactual"} == {
        "cf_lost_runner", "cf_unmarked", "cf_belief_error", "cf_value"
    }  # fmt: skip


def test_the_lost_man_and_unmarked_lines_back_their_terms(ctx):
    lost, free = ctx.claims["cf_lost_runner"], ctx.claims["cf_unmarked"]
    assert lost.terms == ["lost his man"] and lexicon.backs("lost his man", lost.predicate)
    assert free.terms == ["unmarked"] and lexicon.backs("unmarked", free.predicate)
    assert [m.key for m in lexicon.find_terms(lost.template_for("zh"))] == ["lost his man"]


def test_the_claims_numbers_match_the_lens(ctx):
    m = ctx.card.lens("scan").metrics
    assert ctx.claims["stayed_with_runner"].slots["gap"].value == round(
        m["separation_with_scan_m"], 1
    )
    assert ctx.claims["cf_lost_runner"].slots["gap"].value == round(
        m["separation_without_scan_m"], 1
    )
    assert ctx.claims["cf_value"].slots["dxt"].value == round(ctx.card.lens("scan").delta_xt, 2)


def test_ball_watching_is_banned():
    assert lexicon.find_banned("He was ball-watching.") and lexicon.find_banned("他盯球不盯人。")


def test_every_persona_tells_the_look_in_both_languages(ctx, breakdown):
    assert breakdown.findings.lens == "scan"
    assert breakdown.findings.headline[0] == "marker_scan"
    for script in breakdown.scripts:
        lines = script.payload.lines
        claims = {c for line in lines for c in line.claims}
        assert lines and not script.dropped, (script.persona, script.language)
        # Each audience hears the look and what it did, in its own claims (SPEC 6).
        assert claims & {"marker_scan", "seen_in_scan", "scan_side", "marker_unseen"}
        assert claims & {"stayed_with_runner", "cf_unmarked", "cf_lost_runner"}
        if script.persona == "audio_description":
            assert not claims & ANALYST_NUMBERS
            assert "blind_side" in claims


def test_the_plan_is_valid_and_marks_the_look(ctx):
    plan = template_plan(ctx)
    assert not validate_plan(plan, ctx, set())
    marker = next(s for s in plan.steps if s.do == "scan_marker")
    assert marker.scan == ctx.key_scan.id
    assert next(s for s in plan.steps if s.do == "pov").player == HERO


# --- tools and what-if -----------------------------------------------------------------------


def test_the_tools_say_there_is_no_decision(ctx):
    assert "no decision on the ball" in json.loads(tools.list_options(ctx))["error"]
    assert "no decision on the ball" in json.loads(tools.what_if(ctx, "pass:A9"))["error"]
    cf = json.loads(tools.run_counterfactual(ctx))
    assert cf["dropped_scan"] == ctx.key_scan.id and cf["factual_action"] is None
    assert math.isfinite(cf["delta_xt"]) and cf["delta_xt"] > 0
    assert cf["separation_without_scan_m"] > cf["separation_with_scan_m"]


@pytest.mark.parametrize("language", ["en", "zh"])
def test_a_what_if_is_refused_for_a_markers_look(ctx, language):
    answer = asyncio.run(answer_question(ctx, "What if he had stayed?", language))
    assert answer.action is None and answer.refusal == NO_DECISION_REFUSAL[language]


# --- the API -----------------------------------------------------------------------------------


def test_the_api_serves_the_markers_moment_and_its_breakdown(tmp_path, monkeypatch):
    monkeypatch.setenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "")
    mid = f"{SCENARIO}-{DEMO}"
    settings = Settings(matches=[(SCENARIO, DEMO)], cache_dir=tmp_path)
    with TestClient(create_app(settings)) as c:
        info = c.get(f"/api/matches/{mid}").json()
        assert info["hero_moment"].startswith("m:marker_scan:H5:")
        moments = c.get(f"/api/matches/{mid}/moments").json()
        assert info["hero_moment"] in {m["id"] for m in moments}
        out = c.post("/api/breakdowns", json={"match": mid, "personas": ["casual"],
                                              "languages": ["en", "zh"]}).json()  # fmt: skip
        for script in out["result"]["scripts"]:
            assert script["payload"]["lines"] and not script["dropped"]
            assert all(cl["verdict"] == "supported" for cl in script["payload"]["claims"])
        refused = c.post("/api/whatif", json={"match": mid, "question": "What if he passed?"})
        assert refused.json()["answer"]["refusal"] == NO_DECISION_REFUSAL["en"]


def test_explain_moments_of_the_other_heroes_have_no_marker_card():
    for scenario, seed in (("blind_side_run", 3), ("press_escape", 0)):
        run = Simulation.from_scenario(scenario, seed).run()
        assert all(c.kind != "marker_scan" for c in explain_moments(run))
