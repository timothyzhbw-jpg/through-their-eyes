"""The run without the look, told to a viewer (SPEC 5.3, 7; teammates' feedback 2026-10-21):
which look was removed, what losing it cost, and where his pass went in expected threat.

Expected values are read straight from the MatchRun events and `analytics.xt`, not through
explain/. Every claim must verify, render in en and zh with each number inside a slot, and be
refuted when a slot value is tampered with.
"""

import json
import re

import numpy as np
import pytest

from analytics.vision import wrap_angle
from analytics.xt import xt_for
from explain.functions import EvalContext
from explain.look_cost import LOOK_COST_BUILDERS, look_cost_claims, look_cost_payload
from explain.moments import detect_moments
from explain.render import check_payload, render_claim
from explain.verifier import Verifier
from sim.counterfactual import drop_scan_counterfactual, possession_result

SCENARIO, SEED = "blind_side_run", 3


@pytest.fixture(scope="module")
def hero():
    return drop_scan_counterfactual(SCENARIO, seed=SEED)


@pytest.fixture(scope="module")
def ctx(hero):
    cards = {c.id: c for c in detect_moments(hero.factual)}
    return EvalContext(hero.factual, counterfactuals={hero.scan_id: hero}, cards=cards)


@pytest.fixture(scope="module")
def claims(ctx, hero):
    return look_cost_claims(ctx, hero)


@pytest.fixture(scope="module")
def verifier(ctx):
    return Verifier(ctx)


def _pass_of(run, player, frame):
    return next(
        e for e in run.events if e.type == "pass" and e.player == player and e.frame == frame
    )


def test_all_three_claims_are_measured_and_supported(claims, verifier):
    assert set(claims) == set(LOOK_COST_BUILDERS) == {"removed_look", "look_cost", "pass_zones"}
    assert {k: verifier.verify(c).status for k, c in claims.items()} == {
        "removed_look": "supported",
        "look_cost": "supported",
        "pass_zones": "supported",
    }
    assert claims["removed_look"].kind == "observed"  # the look is an event of the replay
    assert claims["look_cost"].kind == "counterfactual"
    assert claims["pass_zones"].kind == "counterfactual"


def test_the_removed_look_is_the_dropped_scan_with_its_side_and_time(claims, hero):
    scan = hero.factual.event(hero.scan_id)
    reception = next(
        e for e in hero.factual.events if e.type == "reception" and e.player == hero.factual.hero
    )
    c = claims["removed_look"]
    assert c.slots["scan"].ref == hero.scan_id == "scan:H8:0050"
    assert c.slots["player"].ref == "H8"
    assert c.slots["before"].value == pytest.approx(round(reception.t - scan.t, 1)) == 0.8
    assert c.evidence == [hero.scan_id]
    # Which way his head turned away from the ball (as tests/test_described_claims.py measures it).
    head = hero.factual.head_yaw[scan.frame : scan.attrs["end"] + 1, hero.factual.index("H8")]
    turned = np.cumsum(wrap_angle(np.diff(head)))
    assert turned[np.argmax(np.abs(turned))] < -np.pi / 2  # clockwise: over his right shoulder
    assert c.slots["side"].value == "right"


def test_what_the_look_cost_him_without_it_he_plays_it_back(claims, hero):
    d = hero.counterfactual_decision
    assert d.chosen == "pass:H4"
    assert possession_result(hero.counterfactual) == "kept"
    alt = _pass_of(hero.counterfactual, d.player, d.frame)
    went = (np.array(alt.attrs["end_at"]) - hero.counterfactual.ball_pos[d.frame, :2])[0]
    assert went < -5  # home attacks +x: 16.7 m backwards
    c = claims["look_cost"]
    assert c.slots["cf_receiver"].ref == "H4" and c.slots["receiver"].ref == "H9"
    assert "back" in c.template and "back" not in c.slots


def test_where_the_pass_went_in_expected_threat(claims, hero):
    c = claims["pass_zones"]
    f = _pass_of(hero.factual, "H8", hero.factual_decision.frame)
    cf = _pass_of(hero.counterfactual, "H8", hero.counterfactual_decision.frame)
    assert c.slots["xt"].value == pytest.approx(
        round(float(xt_for(np.array(f.attrs["end_at"]), 1)), 3)
    )
    assert c.slots["cf_xt"].value == pytest.approx(
        round(float(xt_for(np.array(cf.attrs["end_at"]), 1)), 3)
    )
    assert (c.slots["band"].value, c.slots["lane"].value) == ("final_third", "right_of_centre")
    assert (c.slots["cf_band"].value, c.slots["cf_lane"].value) == ("own_half", "right_of_centre")
    # Their difference is the verdict's worth of the look, to the third decimal.
    assert c.slots["xt"].value - c.slots["cf_xt"].value == pytest.approx(hero.delta_xt, abs=1.5e-3)


@pytest.mark.parametrize(
    ("kind", "slot", "wrong"),
    [
        ("removed_look", "side", "left"),
        ("removed_look", "before", 1.6),
        ("look_cost", "cf_receiver", "H9"),
        ("pass_zones", "xt", 0.21),
        ("pass_zones", "cf_band", "final_third"),
    ],
)
def test_a_tampered_value_is_refuted(claims, verifier, kind, slot, wrong):
    c = claims[kind]
    raw = c.slots[slot].model_dump(exclude_none=True)
    key = "ref" if "ref" in raw else "value"
    bad = c.model_copy(
        update={"slots": {**c.slots, slot: c.slots[slot].model_copy(update={key: wrong})}}
    )
    assert verifier.verify(bad).status == "refuted"


@pytest.mark.parametrize("lang", ["en", "zh"])
def test_each_claim_renders_with_every_number_in_a_slot(claims, verifier, lang):
    for c in claims.values():
        out = render_claim(c, verifier.verify(c), lang)
        assert out.ok, (c.id, lang, out.violations)
    en = {c.id: render_claim(c, verifier.verify(c), "en").text for c in claims.values()}
    assert en["removed_look"] == (
        "Removed: H8's look over his right shoulder, 0.8 seconds before the ball reached him."
    )
    assert en["look_cost"] == (
        "Without that look, H8 would have played it back to H4 instead of forward to H9."
    )
    assert en["pass_zones"].startswith("H8's pass reached H9 in the final third, right of centre")


@pytest.mark.parametrize("lang", ["en", "zh"])
def test_the_payload_passes_every_render_check_and_seeks_into_the_replay(ctx, hero, lang):
    payload = look_cost_payload(ctx, hero, lang)
    assert payload.language == lang
    assert [line.id for line in payload.lines] == ["removed_look", "look_cost", "pass_zones"]
    assert check_payload(payload) == []
    seek = {c.id: c.seek_frame for c in payload.claims}
    assert seek["removed_look"] == 50  # the scan's first frame
    assert all(f is not None for f in seek.values())
    json.dumps(payload.model_dump(mode="json"))  # what the web bundle holds


def test_no_claim_for_a_hero_whose_run_is_a_forced_option():
    """press_escape's other run forces a carry (a what-if): no look was removed."""
    from sim.counterfactual import hero_counterfactual

    forced = hero_counterfactual("press_escape", 0)
    run = forced.factual
    ctx = EvalContext(run, counterfactuals={forced.scan_id: forced},
                      cards={c.id: c for c in detect_moments(run)})  # fmt: skip
    assert look_cost_claims(ctx, forced) == {}


def test_the_bundle_holds_both_languages_the_removed_scan_and_the_grid():
    from analytics.xt import NX, NY, fitted_grid
    from sim.export import WITHOUT_LOOK_VERSION, export_without_look

    data = export_without_look(SCENARIO, SEED)
    assert data["version"] == WITHOUT_LOOK_VERSION
    assert data["moment"] == "m:decision_after_scan:H8:0075"
    assert data["removed"] == {"id": "scan:H8:0050", "start": 50, "end": 70}
    assert set(data["answers"]) == {"en", "zh"}
    for payload in data["answers"].values():
        assert [line["id"] for line in payload["lines"]] == [
            "removed_look",
            "look_cost",
            "pass_zones",
        ]
    # Players by their fictional names, as everywhere on screen (SPEC 4.6); ids stay the data.
    (look_cost,) = [x for x in data["answers"]["en"]["lines"] if x["id"] == "look_cost"]
    assert look_cost["text"] == (
        "Without that look, J. Ferriday would have played it back to K. Annersley instead of "
        "forward to N. Varnhall."
    )
    texts = [x["text"] for p in data["answers"].values() for x in p["lines"]]
    assert not any(re.search(r"(?<![A-Za-z0-9_:])[HA]\d+(?![A-Za-z0-9_:])", t) for t in texts)
    xt = data["xt"]
    assert (xt["cols"], xt["rows"], len(xt["grid"]), len(xt["grid"][0])) == (NX, NY, 16, 12)
    assert xt["fitted"] is True
    assert np.allclose(np.array(xt["grid"]) / 1e4, fitted_grid(), atol=0.5e-4)


def test_no_bundle_for_a_hero_whose_other_run_forces_an_option():
    from sim.export import export_without_look

    with pytest.raises(ValueError, match="not a look removed"):
        export_without_look("press_escape", 0)
