"""Verified rendering and the render check (SPEC 5.3, acceptance checks — explain).

- Only supported claims render; numbers come only from verified slot values.
- No caption, in any language, contains a number (digits or number words) not from a slot.
- Every lexicon term in a rendered line is backed by a supported claim on that line.
"""

import pytest

from explain import lexicon
from explain.builders import HeroRefs
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.functions import EvalContext
from explain.numbers import number_tokens
from explain.render import ScriptLine, SlotSpan, check_caption, render_claim, render_line
from explain.verifier import Verifier
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
    todo = Claim(id="c9", template="{player} was under heavy pressure.",
                 slots={"player": Slot(ref="H8")},
                 predicate=lexicon.under_heavy_pressure(slot("player"),
                                                        anchor=refs.hero_pass.id),
                 terms=["under heavy pressure"])  # fmt: skip
    v = verifier.verify(todo)
    assert v.status == "inconclusive"
    assert not render_claim(todo, v, "en", NAMES).ok


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
    assert render_claim(claim, v, "zh", NAMES_ZH).text == "球在路上时，奥卡福回头看了1次。"
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
    assert [v.kind for v in render_line(connective, claims, verdicts).violations] == ["lexicon"]


def test_player_names_must_come_from_slots(verifier, refs):
    claims = {"c1": pass_claim(refs)}
    verdicts = {"c1": verifier.verify(claims["c1"])}
    line = ScriptLine(id="L", text="Okafor again: {c1.passer} to {c1.receiver}.", claims=["c1"])
    out = render_line(line, claims, verdicts, "en", NAMES)
    assert [v.kind for v in out.violations] == ["entity"]
