"""Qualitative lexicon (SPEC 5.3): words like "unmarked" are claims too."""

import numpy as np
import pytest

from analytics.vision import VisionParams, wrap_angle
from explain import lexicon
from explain.builders import HeroRefs
from explain.claims import Claim, Predicate, fn
from explain.functions import EvalContext
from explain.verifier import Verifier
from sim.engine import Simulation

SCENARIO = "blind_side_run"


@pytest.fixture(scope="module")
def run():
    return Simulation.from_scenario(SCENARIO, seed=3).run()


@pytest.fixture(scope="module")
def ctx(run):
    return EvalContext(run)


def verdict(ctx, predicate, terms=()):
    claim = Claim(id="t", template="", predicate=predicate, terms=list(terms))
    return Verifier(ctx).verify(claim)


def nearest_opponent(run, player, frame):
    i = run.index(player)
    opp = [j for j, p in enumerate(run.players) if p.team != run.players[i].team]
    return float(np.linalg.norm(run.pos[frame, opp] - run.pos[frame, i], axis=1).min())


def test_unmarked_means_nearest_opponent_beyond_five_metres(ctx, run):
    p = HeroRefs.of(run).hero_pass
    for player in ("H9", "H8", "H4", "H10"):
        expected = nearest_opponent(run, player, p.frame) > 5.0
        v = verdict(ctx, lexicon.unmarked(player, anchor=p.id), terms=["unmarked"])
        assert v.status == ("supported" if expected else "refuted"), player
        assert v.terms == (["unmarked"] if expected else [])
    assert verdict(ctx, lexicon.unmarked("H9", anchor=p.id)).status == "supported"


def test_blind_side_means_outside_the_cone_when_the_last_scan_began(ctx, run):
    refs = HeroRefs.of(run)
    k = refs.key_scan
    f, i, j = k.frame, run.index("H8"), run.index("H9")
    rel = run.pos[f, j] - run.pos[f, i]
    offset = abs(wrap_angle(np.arctan2(rel[1], rel[0]) - run.head_yaw[f, i]))
    vp = VisionParams()
    half = max(
        vp.min_half_cone, vp.half_cone - vp.narrowing_per_mps * np.linalg.norm(run.vel[f, i])
    )
    assert offset > half  # the scene is built that way; the verifier must agree
    v = verdict(ctx, lexicon.blind_side("H8", "H9", anchor=refs.reception.id), ["blind side"])
    assert v.status == "supported"
    assert v.terms == ["blind side"]
    # H8's passer stands in front of him, where he is looking.
    v = verdict(ctx, lexicon.blind_side("H8", "H4", anchor=refs.reception.id), ["blind side"])
    assert v.status == "refuted"


def test_under_heavy_pressure_waits_for_the_pressing_kernel(ctx, run):
    p = HeroRefs.of(run).hero_pass
    v = verdict(ctx, lexicon.under_heavy_pressure("H8", anchor=p.id), ["under heavy pressure"])
    assert v.status == "inconclusive"
    assert "TODO" in v.reason and "4.3" in v.reason
    assert v.terms == []


def test_a_term_is_backed_only_by_its_own_definition(ctx, run):
    p = HeroRefs.of(run).hero_pass
    exact = lexicon.unmarked("H9", anchor=p.id)
    assert lexicon.backs("unmarked", exact)
    weaker = exact.model_copy(update={"rhs": 1.0})
    assert not lexicon.backs("unmarked", weaker)
    other = Predicate(op="gt", lhs=fn("distance", a="H9", b="A5", anchor=p.id), rhs=5.0)
    assert not lexicon.backs("unmarked", other)
    assert not lexicon.backs("blind side", exact)
    both = Predicate(op="all", args=[other, exact])
    assert lexicon.backs("unmarked", both)
    v = verdict(ctx, weaker, terms=["unmarked"])
    assert v.status == "supported" and v.terms == []


@pytest.mark.parametrize(
    ("text", "terms"),
    [
        ("H9 was unmarked.", ["unmarked"]),
        ("He ran on the blind side, then the blind-side run paid off.", ["blind side"] * 2),
        ("He was under heavy pressure.", ["under heavy pressure"]),
        ("Under intense pressure, he turned.", ["under heavy pressure"]),
        ("H9 无人盯防。", ["unmarked"]),
        ("H9 跑进了 H8 的盲区。", ["blind side"]),
        ("他在重压之下出球。", ["under heavy pressure"]),
        ("He was marked tightly; pressure was light.", []),
    ],
)
def test_find_terms_in_english_and_chinese(text, terms):
    assert [t.key for t in lexicon.find_terms(text)] == terms
