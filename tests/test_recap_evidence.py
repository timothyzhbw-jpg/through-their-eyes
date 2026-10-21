"""The end-of-match recap's evidence (SPEC 6, recap): claims about a whole stitched match, checked
by the same Verifier as every breakdown."""

from collections import Counter

import pytest

from agents.recap_context import MAX_CANDIDATES, RecapContext
from explain.claims import Slot
from explain.functions import EvalContext, Inconclusive
from explain.recap import impact, local_id, rank_moments, stitched_run
from explain.render import ScriptLine as RenderLine
from explain.render import build_payload, check_payload, render_claim
from explain.verifier import Verifier
from sim.match import build_match, global_id


@pytest.fixture(scope="module")
def match():
    return build_match(1)


@pytest.fixture(scope="module")
def rc():
    return RecapContext.for_match(1)


def _card(id_, lens, delta, frame, tags=(), live_only=False):
    lenses = [{"lens": lens, "delta_xt": delta}] if lens else []
    return {"id": id_, "selected_lens": lens, "lenses": lenses, "anchor_frame": frame,
            "tags": list(tags), "live_only": live_only}  # fmt: skip


def test_the_stitched_run_puts_every_possession_on_the_match_clock(match):
    run = stitched_run(match)
    assert len(run.owner) == match.frames == len(run.pos)
    assert len(run.events) == sum(len(p.run.events) for p in match.possessions)
    assert len({e.id for e in run.events}) == len(run.events)  # ids stay unique on one clock
    by_id = {e.id: e for e in run.events}
    for p in match.possessions:
        for local in p.run.events:
            lifted = by_id[global_id(local.id, p.start)]
            assert local_id(lifted.id, p.start) == local.id
            assert (lifted.frame, lifted.type, lifted.player, lifted.team) == (
                local.frame + p.start, local.type, local.player, local.team
            )  # fmt: skip
            if isinstance(local.attrs.get("end"), int):
                assert lifted.attrs["end"] == local.attrs["end"] + p.start
        assert (run.pos[p.start : p.end] == p.run.pos).all()


def test_the_stitched_run_is_byte_identical_for_the_same_seed(match):
    assert stitched_run(match).to_bytes() == stitched_run(build_match(1)).to_bytes()


def test_count_events_without_an_anchor_counts_the_whole_match(match):
    ctx = EvalContext(stitched_run(match), resimulate=False)
    passes = Counter(e.team for p in match.possessions for e in p.run.events if e.type == "pass")
    for team in (0, 1):
        got = ctx.value({"fn": "count_events", "args": {"type": "pass", "team": team}})
        assert got == passes[team]
    with pytest.raises(Inconclusive):  # a window needs somewhere to start
        ctx.value({"fn": "count_events", "args": {"type": "pass", "from": -2.0}})


def test_candidates_rank_by_counterfactual_impact_then_lens_then_match_order():
    cards = [
        _card("a", "pressure", -0.04, 300),
        _card("b", "scan", 0.04, 900),
        _card("c", "space", 0.04, 100),
        _card("d", "pressure", 0.10, 1700),
        _card("e", None, None, 50),
        _card("f", "pressure", 0.5, 10, live_only=True),  # a sprint: an overlay, never a moment
        _card("g", "pressure", 0.001, 2000, tags=["goal"]),  # a goal leads whatever its impact
    ]
    assert [c["id"] for c in rank_moments(cards)] == ["g", "d", "b", "c", "a", "e"]
    assert impact(cards[0]) == pytest.approx(0.04) and impact(cards[4]) == 0.0


def test_every_match_claim_is_supported_and_holds_the_true_totals(rc, match):
    assert rc.stats[0] == "final_score"
    assert rc.score == match.score
    events = Counter((e.type, e.team) for p in match.possessions for e in p.run.events)
    done = Counter(e.team for p in match.possessions for e in p.run.events
                   if e.type == "pass" and e.attrs.get("outcome") == "complete")  # fmt: skip
    for cid in rc.stats:
        assert rc.verdicts[cid].status == "supported", cid
    for team, side in ((0, "home"), (1, "away")):
        slots = rc.all_claims[f"passes_{side}"].slots
        assert (slots["passes"].value, slots["done"].value) == (events["pass", team], done[team])
        assert rc.all_claims[f"scans_{side}"].slots["n"].value == events["scan", team]


def test_every_candidate_is_a_moment_with_something_verified_to_say(rc):
    assert 3 <= len(rc.candidates) <= MAX_CANDIDATES
    ranks = [c.rank for c in rc.candidates]
    assert ranks == sorted(ranks)
    for c in rc.candidates:
        assert c.claims and all(rc.verdicts[cid].supported for cid in c.claims)
        assert all(cid.startswith(f"{c.prefix}.") for cid in c.claims)
        assert c.start <= c.anchor_frame < c.end
        assert rc.moment_of(c.claims[0]) is c
    assert rc.moment_of("final_score") is None
    heroes = [c for c in rc.candidates if c.hero]
    assert {c.lens for c in heroes} == {"scan", "pressure"}  # the two heroes of match-1


def test_hero_claims_are_verified_again_under_their_recap_ids(rc):
    hero = next(c for c in rc.candidates if c.hero and c.lens == "scan")
    cid = f"{hero.prefix}.cf_pass"
    assert cid in hero.claims
    claim, verdict = rc.all_claims[cid], rc.verdicts[cid]
    assert verdict.fingerprint == claim.fingerprint() and verdict.claim_id == cid
    assert claim.kind == "counterfactual"
    # The audit log has a record for the renamed claim, as for every verdict.
    records = rc.audit.recent("blind_side_run:3", 500)
    assert any(r.claim["id"] == cid for r in records)


def test_a_changed_number_in_any_recap_claim_is_refuted(rc):
    whole = EvalContext(stitched_run(build_match(1)), resimulate=False)
    checked = 0
    for cid in rc.stats:
        claim = rc.all_claims[cid]
        for name, s in claim.slots.items():
            if isinstance(s.value, int) and not isinstance(s.value, bool):
                wrong = claim.model_copy(
                    update={"slots": {**claim.slots, name: Slot(value=s.value + 1)}}
                )
                assert Verifier(whole).verify(wrong).status == "refuted", (cid, name)
                checked += 1
    assert checked >= 5


def test_every_claim_renders_in_english_and_chinese_with_numbers_only_from_slots(rc):
    for cid, claim in rc.all_claims.items():
        if not rc.verdicts[cid].supported:
            continue
        for lang in ("en", "zh"):
            out = render_claim(claim, rc.verdicts[cid], lang, rc.names)
            assert out.ok, (cid, lang, out.violations)
    lines = [RenderLine(id=f"L{i}", text=rc.all_claims[c].template_for("zh"), claims=[c])
             for i, c in enumerate(rc.supported)]  # fmt: skip
    built = build_payload("recap", "analyst", "zh", lines, rc.claims, rc.verdicts, rc.names)
    assert not built.rejected and check_payload(built.payload, rc.names) == []


def test_focusing_on_the_key_moments_keeps_only_their_claims(rc):
    picked = [c.id for c in rc.candidates[:3]]
    focused = rc.focused(list(reversed(picked)))
    assert [m.id for m in focused.moments] == sorted(
        picked, key=lambda m: rc.candidate(m).anchor_frame
    )
    allowed = set(rc.stats) | {cid for m in focused.moments for cid in m.claims}
    assert set(focused.supported) == allowed
    other = rc.candidates[3].claims[0]
    assert other in rc.supported and other not in focused.claims
    with pytest.raises(ValueError):
        rc.focused(["m:not_a_moment:H1:0001"])


def test_lift_moves_evidence_and_seek_frames_to_the_match_clock(rc, match):
    run = stitched_run(match)
    ids = {e.id for e in run.events}
    for m in rc.candidates:
        cid = m.claims[0]
        line = RenderLine(id="L1", text=rc.all_claims[cid].template, claims=[cid])
        built = build_payload("recap", "casual", "en", [line], rc.claims, rc.verdicts, rc.names)
        lifted = rc.lift(built.payload).claims[0]
        assert all(e in ids for e in lifted.evidence), (cid, lifted.evidence)
        if lifted.seek_frame is not None:
            assert m.start <= lifted.seek_frame < m.end


def test_the_recap_evidence_is_deterministic(rc):
    again = RecapContext.for_match(1)
    assert again.content_hash() == rc.content_hash()
    assert [c.id for c in again.candidates] == [c.id for c in rc.candidates]
    assert again.evidence() == rc.evidence()
