"""Claims that describe the moment to a listener (SPEC 1 audio description, 5.3): where the hero got
the ball, which way he looked, and whom that look showed him.

Expected values are computed here straight from the MatchRun arrays and the vision model in
analytics/, not through explain/, like tests/test_verifier.py.
"""

import numpy as np
import pytest

from analytics.vision import player_visibility, wrap_angle
from explain.builders import HeroRefs, hero_claims
from explain.claims import Slot
from explain.functions import EvalContext
from explain.moments import detect_moments
from explain.render import ScriptLine, check_caption, render_claim, render_line
from explain.verifier import Verifier
from sim.config import SimParams
from sim.counterfactual import drop_scan_counterfactual

DESCRIBING = ("reception_zone", "scan_side", "seen_in_scan")
SEEN = SimParams().perception_threshold


@pytest.fixture(scope="module")
def hero():
    return drop_scan_counterfactual("blind_side_run", seed=3)


@pytest.fixture(scope="module")
def ctx(hero):
    cards = {c.id: c for c in detect_moments(hero.factual)}
    return EvalContext(hero.factual, counterfactuals={hero.scan_id: hero}, cards=cards)


@pytest.fixture(scope="module")
def claims(ctx, hero):
    return hero_claims(ctx, hero)


@pytest.fixture(scope="module")
def refs(hero):
    return HeroRefs.of(hero.factual)


@pytest.fixture(scope="module")
def verifier(ctx):
    return Verifier(ctx)


def _visibility(run, observer: str, target: str, frames) -> list[float]:
    i, j = run.index(observer), run.index(target)
    return [
        float(player_visibility(run.pos[f], run.head_yaw[f],
                                np.linalg.norm(run.vel[f], axis=-1))[i, j])
        for f in frames
    ]  # fmt: skip


def test_the_hero_moment_has_the_describing_claims(claims, verifier):
    assert set(DESCRIBING) <= set(claims)
    assert {k: claims[k].kind for k in DESCRIBING} == {
        "reception_zone": "observed", "scan_side": "observed", "seen_in_scan": "computed",
    }  # fmt: skip
    assert {verifier.verify(claims[k]).status for k in DESCRIBING} == {"supported"}
    for k in DESCRIBING:  # anchored on the moment card (SPEC 5.1)
        assert ".reception" in claims[k].predicate.model_dump_json()


def test_whom_he_saw_says_when_he_looked_so_the_line_stands_alone(claims):
    """seen_in_scan may air before any line has told the look (two voices, or no scan line), so
    its sentence names the look itself, and its predicate checks the look came before the ball."""
    c = claims["seen_in_scan"]
    for text in (c.template, c.templates["zh"]):
        assert "that look" not in text and not text.startswith("回头那一眼")
    before = [p for p in c.predicate.args if p.op == "before"]
    assert len(before) == 1 and ".reception" in before[0].model_dump_json()


def test_where_he_received_the_ball_matches_the_tracking(claims, refs):
    run = refs.run
    x, y = run.pos[refs.reception.frame, run.index("H8")]
    assert 0 <= x < 105 / 6  # home attacks +x: the opponents' half, short of the final third
    assert -3 * 68 / 10 <= y < -68 / 10  # facing +x, right is -y: the lane right of the centre
    slots = claims["reception_zone"].slots
    assert slots["player"].ref == "H8"
    assert (slots["band"].value, slots["lane"].value) == ("opponents_half", "right_of_centre")


def test_which_way_he_looked_matches_the_head_yaw(claims, refs):
    run, scan = refs.run, refs.key_scan
    head = run.head_yaw[scan.frame : scan.attrs["end"] + 1, run.index("H8")]
    turned = np.cumsum(wrap_angle(np.diff(head)))
    assert turned[np.argmax(np.abs(turned))] < -np.pi / 2  # clockwise, away from the ball: right
    slots = claims["scan_side"].slots
    assert (slots["player"].ref, slots["scan"].ref, slots["side"].value) == ("H8", scan.id, "right")


def test_whom_he_saw_in_that_look_matches_the_vision_model(claims, refs):
    run, scan = refs.run, refs.key_scan
    vis = _visibility(run, "H8", "H9", range(scan.frame, scan.attrs["end"] + 1))
    assert vis[0] < SEEN <= max(vis)  # out of sight as the look began, seen during it
    slots = claims["seen_in_scan"].slots
    assert (slots["player"].ref, slots["runner"].ref, slots["scan"].ref) == ("H8", "H9", scan.id)


@pytest.mark.parametrize(
    "kind, name, value",
    [
        ("reception_zone", "band", "own_half"),
        ("reception_zone", "band", "final_third"),
        ("reception_zone", "lane", "centre"),
        ("reception_zone", "lane", "left_of_centre"),
        ("reception_zone", "lane", "somewhere"),
        ("scan_side", "side", "left"),
    ],
)
def test_a_wrong_place_or_side_is_refuted(claims, verifier, kind, name, value):
    c = claims[kind]
    wrong = c.model_copy(update={"slots": c.slots | {name: Slot(value=value)}})
    assert verifier.verify(wrong).status == "refuted"


def test_someone_else_receiving_or_looking_is_refuted(claims, verifier):
    for kind in ("reception_zone", "scan_side", "seen_in_scan"):
        c = claims[kind]
        other = c.model_copy(update={"slots": c.slots | {"player": Slot(ref="H4")}})
        assert verifier.verify(other).status == "refuted", kind


def test_a_player_he_did_not_see_in_that_look_is_refuted(claims, verifier, refs):
    run, scan = refs.run, refs.key_scan
    frames = range(scan.frame, scan.attrs["end"] + 1)
    unseen = [p for p in run.ids if p != "H8" and max(_visibility(run, "H8", p, frames)) < SEEN]
    seen = [p for p in run.ids if p != "H8" and p not in unseen]
    assert unseen and "H9" in seen
    c = claims["seen_in_scan"]
    for p in run.ids:
        if p == "H8":
            continue
        v = verifier.verify(c.model_copy(update={"slots": c.slots | {"runner": Slot(ref=p)}}))
        assert v.status == ("supported" if p in seen else "refuted"), p


def test_describing_claims_render_their_words_from_verified_slots(claims, verifier):
    expected = {
        "reception_zone": ("H8 received the ball in the opponents' half, right of centre.",
                           "H8在对方半场中路偏右接球。"),
        "scan_side": ("Before the ball reached him, H8 looked over his right shoulder.",
                      "球到之前，H8扭头看向了右后方。"),
        "seen_in_scan": ("When H8 looked over his shoulder before the ball arrived, he saw H9.",
                         "球到之前回头的那一眼，H8看到了H9。"),
    }  # fmt: skip
    for kind, texts in expected.items():
        v = verifier.verify(claims[kind])
        out = [render_claim(claims[kind], v, lang) for lang in ("en", "zh")]
        assert all(o.ok for o in out), [o.violations for o in out]
        assert tuple(o.text for o in out) == texts
    # "half" is a number word: it may air only because a verified slot put it there.
    zone = render_claim(claims["reception_zone"], verifier.verify(claims["reception_zone"]), "en")
    band = next(s for s in zone.spans if s.slot == "band")
    assert zone.text[band.start : band.end] == "in the opponents' half"
    others = [s for s in zone.spans if s.slot != "band"]
    assert [v.kind for v in check_caption(zone.text, others)] == ["number"]


def test_the_vocab_format_speaks_only_known_words(claims, verifier):
    cid = "scans_before_reception"
    c, v = claims[cid], verifier.verify(claims[cid])
    for text in ("{player:vocab} scanned.", "He scanned {n:vocab}."):
        out = render_line(ScriptLine(id="L", text=text, claims=[cid]), {cid: c}, {cid: v}, "en")
        assert not out.ok and out.violations[0].kind == "placeholder", text
    zone = claims["reception_zone"]
    odd = zone.model_copy(update={"slots": zone.slots | {"lane": Slot(value="somewhere")}})
    out = render_claim(odd, verifier.verify(odd), "en")
    assert not out.ok and out.text is None
