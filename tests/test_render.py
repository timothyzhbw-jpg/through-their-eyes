"""Verified rendering and the render check (SPEC 5.3, acceptance checks — explain).

- Only supported claims render; numbers come only from verified slot values.
- No caption, in any language, contains a number (digits or number words) not from a slot.
- Every lexicon term in a rendered line is backed by a supported claim on that line.
"""

import json

import pytest

from explain import lexicon
from explain.builders import HeroRefs
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.functions import EvalContext
from explain.numbers import number_tokens
from explain.render import (
    ScriptLine,
    SlotSpan,
    build_payload,
    check_caption,
    check_payload,
    render_claim,
    render_line,
)
from explain.verifier import Verifier
from sim.counterfactual import drop_scan_counterfactual
from sim.engine import Simulation

SCENARIO = "blind_side_run"
NAMES = {"H8": "Okafor", "H9": "Lindqvist", "H4": "Brandt", "A5": "Maric"}
NAMES_ZH = {"H8": "奥卡福", "H9": "林德奎斯特", "H4": "布兰特", "A5": "马里奇"}


@pytest.fixture(scope="module")
def run():
    return Simulation.from_scenario(SCENARIO, seed=3).run()


@pytest.fixture(scope="module")
def refs(run):
    return HeroRefs.of(run)


@pytest.fixture(scope="module")
def verifier(run):
    return Verifier(EvalContext(run))


def pass_claim(refs, receiver="H9", metres=None, cid="c1"):
    p = refs.hero_pass
    metres = round(p.attrs["distance"]) if metres is None else metres
    return Claim(
        id=cid,
        template="{passer} found {receiver} with a {dist}-metre pass.",
        templates={"zh": "{passer}一脚{dist}米的直塞找到了{receiver}。"},
        slots={"passer": Slot(ref="H8"), "receiver": Slot(ref=receiver),
               "dist": Slot(value=metres)},
        predicate=Predicate(op="all", args=[
            Predicate(op="eq", lhs=fn("event_attr", event=p.id, attr="player"),
                      rhs=slot("passer")),
            Predicate(op="eq", lhs=fn("event_attr", event=p.id, attr="to"),
                      rhs=slot("receiver")),
            Predicate(op="approx", lhs=fn("event_attr", event=p.id, attr="distance"),
                      rhs=slot("dist"), abs_tol=0.5),
        ]),
        evidence=[p.id],
    )  # fmt: skip


def scans_claim(refs, n, cid="c2"):
    return Claim(
        id=cid,
        template="{player} checked his shoulder {n:times} while the ball travelled.",
        templates={"zh": "球在路上时，{player}回头看了{n:times}。"},
        slots={"player": Slot(ref="H8"), "n": Slot(value=n)},
        predicate=Predicate(op="eq", rhs=slot("n"), lhs=fn(
            "count_events", type="scan", player=slot("player"),
            from_=-(refs.reception.frame - refs.kick.frame) * 0.04, to=0.0,
            anchor=refs.reception.id)),
    )  # fmt: skip


def unmarked_claim(refs, cid="c3"):
    return Claim(
        id=cid,
        template="{runner} was unmarked.",
        templates={"zh": "{runner}无人盯防。"},
        slots={"runner": Slot(ref="H9")},
        predicate=lexicon.unmarked(slot("runner"), anchor=refs.hero_pass.id),
        terms=["unmarked"],
    )


# --- only supported claims render, numbers from slots ------------------------------------


def test_a_supported_claim_renders_in_english_and_chinese(verifier, refs):
    claim = pass_claim(refs)
    v = verifier.verify(claim)
    assert v.status == "supported"
    metres = claim.slots["dist"].value
    en = render_claim(claim, v, "en", NAMES)
    assert en.ok, en.violations
    assert en.text == f"Okafor found Lindqvist with a {metres}-metre pass."
    zh = render_claim(claim, v, "zh", NAMES_ZH)
    assert zh.ok, zh.violations
    assert zh.text == f"奥卡福一脚{metres}米的直塞找到了林德奎斯特。"
    assert [(s.claim, s.slot) for s in zh.spans] == [("c1", "passer"), ("c1", "dist"),
                                                      ("c1", "receiver")]  # fmt: skip
    assert zh.text[zh.spans[1].start : zh.spans[1].end] == str(metres)


def test_refuted_and_inconclusive_claims_never_render(verifier, refs):
    wrong = pass_claim(refs, receiver="H4")
    v = verifier.verify(wrong)
    assert v.status == "refuted"
    out = render_claim(wrong, v, "en", NAMES)
    assert not out.ok and out.text is None
    assert out.violations[0].kind == "unsupported_claim"
    pressed = Claim(id="c9", template="{player} was under heavy pressure.",
                    slots={"player": Slot(ref="H8")},
                    predicate=lexicon.under_heavy_pressure(slot("player"),
                                                           anchor=refs.hero_pass.id),
                    terms=["under heavy pressure"])  # fmt: skip
    v = verifier.verify(pressed)
    assert v.status == "refuted"  # nobody was close to him
    assert not render_claim(pressed, v, "en", NAMES).ok
    unknowable = Claim(
        id="c10", template="{player} misjudged {runner} by {err} metres.",
        slots={"player": Slot(ref="H8"), "runner": Slot(ref="H9"), "err": Slot(value=1)},
        predicate=Predicate(op="approx", rhs=slot("err"), abs_tol=0.5, lhs=fn(
            "metric_at", metric="belief_error", observer=slot("player"), target=slot("runner"),
            anchor=refs.reception.id)),
    )  # fmt: skip
    v = verifier.verify(unknowable)
    assert v.status == "inconclusive"  # beliefs are recorded at decisions only
    assert not render_claim(unknowable, v, "en", NAMES).ok


def test_a_claim_edited_after_verification_does_not_render(verifier, refs):
    claim = pass_claim(refs)
    v = verifier.verify(claim)
    edited = claim.model_copy(update={"slots": claim.slots | {"dist": Slot(value=55)}})
    out = render_claim(edited, v, "en", NAMES)
    assert not out.ok
    assert out.violations[0].kind == "stale_claim"


def test_slot_formats_times_words_and_plurals(verifier, refs):
    n = sum(
        e.type == "scan" and e.player == "H8" and refs.kick.frame <= e.frame <= refs.reception.frame
        for e in refs.run.events
    )
    assert n == 1  # the scene: H8 tracks the ball, the key scan is his only look away
    claim = scans_claim(refs, n)
    v = verifier.verify(claim)
    assert v.status == "supported"
    assert render_claim(claim, v, "en", NAMES).text == (
        "Okafor checked his shoulder once while the ball travelled."
    )
    assert render_claim(claim, v, "zh", NAMES_ZH).text == "球在路上时，奥卡福回头看了一次。"
    line = ScriptLine(id="L1", text="That was {c2.n:words|look|looks}, no more.", claims=["c2"])
    out = render_line(line, {"c2": claim}, {"c2": v}, "en", NAMES)
    assert out.ok, out.violations
    assert out.text == "That was one look, no more."
    zh = ScriptLine(id="L1", text="只看了{n:words}眼。", claims=["c2"])
    out = render_line(zh, {"c2": claim}, {"c2": v}, "zh", NAMES_ZH)
    assert out.ok, out.violations
    assert out.text == "只看了一眼。"


def test_a_script_line_fills_placeholders_from_several_verified_claims(verifier, refs):
    claims = {"c1": pass_claim(refs), "c3": unmarked_claim(refs)}
    verdicts = {cid: verifier.verify(c) for cid, c in claims.items()}
    metres = claims["c1"].slots["dist"].value
    line = ScriptLine(
        id="L2",
        text="One look was enough: {c3.runner} was unmarked, and {c1.passer} hit him from "
        "{c1.dist|metre|metres}.",
        claims=["c1", "c3"],
    )
    out = render_line(line, claims, verdicts, "en", NAMES)
    assert not out.ok  # "One" is a number word that did not come from a slot
    assert [v.kind for v in out.violations] == ["number"]
    line = line.model_copy(update={"text": line.text.replace("One look was enough", "Enough")})
    out = render_line(line, claims, verdicts, "en", NAMES)
    assert out.ok, out.violations
    assert out.text == f"Enough: Lindqvist was unmarked, and Okafor hit him from {metres} metres."


def test_placeholders_must_resolve_to_a_referenced_claim(verifier, refs):
    claims = {"c1": pass_claim(refs), "c3": unmarked_claim(refs)}
    verdicts = {cid: verifier.verify(c) for cid, c in claims.items()}
    unreferenced = ScriptLine(id="L", text="{c1.dist} metres.", claims=["c3"])
    assert render_line(unreferenced, claims, verdicts).violations[0].kind == "placeholder"
    ambiguous = ScriptLine(id="L", text="{passer} and {runner}.", claims=["c1", "c3"])
    out = render_line(ambiguous, claims, verdicts, "en", NAMES)
    assert out.ok, out.violations  # each bare name is in exactly one referenced claim
    both = {"c1": pass_claim(refs), "c4": pass_claim(refs, cid="c4")}
    v2 = {cid: verifier.verify(c) for cid, c in both.items()}
    clash = ScriptLine(id="L", text="{dist} metres.", claims=["c1", "c4"])
    assert render_line(clash, both, v2).violations[0].kind == "placeholder"
    unknown = ScriptLine(id="L", text="{c9.dist} metres.", claims=["c9"])
    assert render_line(unknown, claims, verdicts).violations[0].kind == "unsupported_claim"


def test_a_malformed_placeholder_never_airs_as_literal_braces(verifier, refs):
    """Seen with a real model: `{window_s|second}` is not placeholder syntax, so it was left in."""
    claims = {"c1": pass_claim(refs)}
    verdicts = {"c1": verifier.verify(claims["c1"])}
    line = ScriptLine(id="L", text="{passer} found him {window_s|second} later.", claims=["c1"])
    out = render_line(line, claims, verdicts, "en", NAMES)
    assert not out.ok and "placeholder" in {v.kind for v in out.violations}
    assert [v.kind for v in check_caption("Look {again}.", spans=[])] == ["placeholder"] * 2


# --- the render check: numbers ------------------------------------------------------------


@pytest.mark.parametrize(
    "caption",
    [
        "He scanned 3 times.",
        "A 41-metre pass.",
        "He saw 0.4 of the space.",
        "His shirt says H8.",
        "He scanned three times.",
        "He scanned Three times.",
        "Twenty-one metres out.",
        "He looked twice.",
        "He looked thrice.",
        "He looked once before the ball arrived.",
        "Half a second later he played it.",
        "A dozen yards.",
        "A hundred metres.",
        "His fourth scan.",
        "Nil chances.",
        "他扫视了3次。",
        "他扫视了３次。",
        "他扫视了三次。",
        "两名后卫都没跟上。",
        "五米开外。",
        "十五秒之后。",
        "他的第三次扫视。",
        "他回头看了一次。",
        "二十一个人。",
        "半秒之后。",
        "他看到了一半的空间。",
        "百分之四十的空间。",
    ],
)
def test_the_render_check_rejects_numbers_not_from_slots(caption):
    violations = check_caption(caption, spans=[])
    assert violations and all(v.kind == "number" for v in violations), caption


@pytest.mark.parametrize(
    "caption",
    [
        "He checked his shoulder before the ball arrived.",
        "No one tracked the run.",
        "A one-two around the press.",
        "He drifted into the half-space.",
        "It was a third-man run.",
        "Someone had to cover; nobody did. Anyone could see it.",
        "Often, he looks at the ball; tonight he looked away.",
        "他回头看了一眼。",
        "一脚直塞。",
        "他停了一下。",
        "一个漂亮的转身。",
        "他和上一次一样冷静。",
        "这一脚十分关键。",
        "他在对方半场接球。",
        "第三人跑位。",
    ],
)
def test_the_render_check_allows_idioms_without_numbers(caption):
    assert check_caption(caption, spans=[]) == []


def test_numbers_inside_slot_spans_pass_and_digits_next_to_them_do_not():
    text = "He scanned 3 times in the 2 seconds."
    spans = [SlotSpan(11, 12, "c1", "n"), SlotSpan(26, 27, "c1", "w")]
    assert check_caption(text, spans) == []
    assert [v.detail for v in check_caption(text, spans[:1])] == ["2"]
    padded = "He scanned 30 times."
    assert check_caption(padded, [SlotSpan(11, 12, "c1", "n")])[0].detail == "30"
    zh = "他扫视了三次。"
    assert check_caption(zh, [SlotSpan(4, 6, "c1", "n")]) == []
    assert check_caption(zh, [SlotSpan(4, 5, "c1", "n")]) == []  # the numeral itself is a slot
    assert check_caption("他扫视了十三次。", [SlotSpan(5, 6, "c1", "n")])[0].detail == "十三次"


def test_number_tokens_report_kind_and_position():
    tokens = number_tokens("Okafor scanned twice, 3 times in all; 两名后卫, 一眼.")
    assert [(t.text, t.kind) for t in tokens] == [
        ("twice", "en_word"), ("3", "digit"), ("两名", "zh_numeral")
    ]  # fmt: skip


# --- the render check: lexicon and entities -----------------------------------------------


def test_a_lexicon_term_needs_a_supported_claim_on_the_same_line(verifier, refs):
    claims = {"c1": pass_claim(refs), "c3": unmarked_claim(refs)}
    verdicts = {cid: verifier.verify(c) for cid, c in claims.items()}
    assert verdicts["c3"].terms == ["unmarked"]
    bare = ScriptLine(id="L", text="{c1.receiver} was unmarked.", claims=["c1"])
    out = render_line(bare, claims, verdicts, "en", NAMES)
    assert [v.kind for v in out.violations] == ["lexicon"]
    backed = ScriptLine(id="L", text="{c3.runner} was unmarked.", claims=["c3"])
    assert render_line(backed, claims, verdicts, "en", NAMES).ok
    zh_bare = ScriptLine(id="L", text="{c1.receiver}无人盯防。", claims=["c1"])
    assert [v.kind for v in render_line(zh_bare, claims, verdicts, "zh", NAMES_ZH).violations] == [
        "lexicon"
    ]
    assert render_claim(claims["c3"], verdicts["c3"], "zh", NAMES_ZH).text == "林德奎斯特无人盯防。"
    connective = ScriptLine(id="L", text="And then, the blind side.", claims=[])
    assert [v.kind for v in render_line(connective, claims, verdicts).violations] == [
        "unbacked_line", "lexicon"
    ]  # fmt: skip


def test_player_names_must_come_from_slots(verifier, refs):
    claims = {"c1": pass_claim(refs)}
    verdicts = {"c1": verifier.verify(claims["c1"])}
    line = ScriptLine(id="L", text="Okafor again: {c1.passer} to {c1.receiver}.", claims=["c1"])
    out = render_line(line, claims, verdicts, "en", NAMES)
    assert [v.kind for v in out.violations] == ["entity"]


# --- banned terms and claimless lines (SPEC 5.3) ------------------------------------------


@pytest.mark.parametrize(
    ("lang", "text"),
    [
        ("en", "A mistake let {c1.receiver} in: {c1.passer} found him."),
        ("en", "{c1.receiver} should have been tracked; {c1.passer} found him."),
        ("zh", "后卫失误，{c1.passer}找到了{c1.receiver}。"),
        ("zh", "{c1.passer}本该回传，却找到了{c1.receiver}。"),
    ],
)
def test_banned_evaluative_terms_never_render(verifier, refs, lang, text):
    claims = {"c1": pass_claim(refs)}
    verdicts = {"c1": verifier.verify(claims["c1"])}
    out = render_line(ScriptLine(id="L", text=text, claims=["c1"]), claims, verdicts, lang)
    assert [v.kind for v in out.violations] == ["banned"]


def test_a_line_without_claims_must_be_a_connective_phrase():
    assert render_line(ScriptLine(id="L", text="Watch this.", claims=[]), {}, {}).ok
    assert render_line(ScriptLine(id="L", text="他看到了什么？", claims=[]), {}, {}, "zh").ok
    out = render_line(ScriptLine(id="L", text="He beat the offside trap.", claims=[]), {}, {})
    assert [v.kind for v in out.violations] == ["unbacked_line"]


# --- render payload (SPEC 5.3): what a viewer receives ------------------------------------


@pytest.fixture(scope="module")
def payload_parts(run, refs):
    cf = drop_scan_counterfactual(SCENARIO, seed=3)
    ctx = EvalContext(run, counterfactuals={cf.scan_id: cf})
    claims = {"c1": pass_claim(refs), "c2": scans_claim(refs, 1), "c3": unmarked_claim(refs),
              "c4": pass_claim(refs, receiver="H4", cid="c4"),
              "c5": Claim(id="c5", template="That look was worth {dxt} in expected threat.",
                          slots={"dxt": Slot(value=round(cf.delta_xt, 2), decimals=2)},
                          predicate=Predicate(op="approx", rhs=slot("dxt"), abs_tol=0.005,
                                              lhs=fn("cf_delta", of="possession_value",
                                                     scan=cf.scan_id)),
                          evidence=[cf.scan_id])}  # fmt: skip
    verdicts = Verifier(ctx).verify_all(claims.values())
    lines = [
        ScriptLine(id="L1", text="What did he see?"),
        ScriptLine(id="L2", text="{player} checked his shoulder {n:times}.", claims=["c2"]),
        ScriptLine(id="L3", text="{runner} was unmarked; {passer} found him from {dist} metres.",
                   claims=["c3", "c1"]),
        ScriptLine(id="L4", text="{passer} found {receiver}.", claims=["c4"]),  # refuted
        ScriptLine(id="L5", text="He beat the offside trap."),  # no claim
        ScriptLine(id="L6", text="Without it: {dxt} xT less.", claims=["c5"]),
    ]  # fmt: skip
    return claims, verdicts, lines


def test_the_payload_carries_only_lines_that_passed_and_their_claims(payload_parts, refs):
    claims, verdicts, lines = payload_parts
    built = build_payload("m12", "analyst", "en", lines, claims, verdicts, NAMES)
    p = built.payload
    assert [line.id for line in p.lines] == ["L1", "L2", "L3", "L6"]
    assert sorted(r.line_id for r in built.rejected) == ["L4", "L5"]
    assert [line.text for line in p.lines][:2] == [
        "What did he see?", "Okafor checked his shoulder once."
    ]  # fmt: skip
    by_id = {c.id: c for c in p.claims}
    assert sorted(by_id) == ["c1", "c2", "c3", "c5"]
    assert {c.verdict for c in p.claims} == {"supported"}
    assert by_id["c2"].kind == "observed" and by_id["c2"].values == {"n": 1}
    assert by_id["c3"].kind == "observed" and by_id["c3"].terms == ["unmarked"]
    assert by_id["c5"].kind == "counterfactual"
    assert by_id["c5"].seek_frame == refs.key_scan.frame
    assert by_id["c1"].evidence == [refs.hero_pass.id]
    assert by_id["c1"].seek_frame == refs.hero_pass.frame
    assert check_payload(p, NAMES) == []
    wire = json.loads(p.model_dump_json())  # exactly the SPEC 5.3 shape the web app reads
    assert set(wire) == {"moment", "persona", "language", "lines", "claims"}
    assert {tuple(sorted(line)) for line in wire["lines"]} == {("claims", "id", "text")}
    assert {tuple(sorted(c)) for c in wire["claims"]} == {
        ("evidence", "id", "kind", "seek_frame", "values", "verdict")
    }
    assert wire["lines"][1] == {
        "id": "L2", "text": "Okafor checked his shoulder once.", "claims": ["c2"]
    }  # fmt: skip


def test_check_payload_catches_tampering_after_render(payload_parts):
    claims, verdicts, lines = payload_parts
    p = build_payload("m12", "analyst", "zh", lines, claims, verdicts, NAMES_ZH).payload
    assert check_payload(p, NAMES_ZH) == []
    tampered = p.model_copy(deep=True)
    tampered.lines[1].text += "三次"
    tampered.lines[2].text += "这是失误。"
    tampered.lines[0].text = "他进球了。"
    tampered.claims = [c for c in tampered.claims if c.id != "c5"]
    found = {(v.line, v.kind) for v in check_payload(tampered, NAMES_ZH)}
    assert found == {("L1", "unbacked_line"), ("L2", "number"), ("L3", "banned"),
                     ("L6", "unsupported_claim"), ("L6", "placeholder")}  # fmt: skip
