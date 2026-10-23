"""Chinese narration as a Chinese viewer reads and hears it (zh-qa, SPEC 5.3, 6).

Players go by their Chinese names in zh text and speech (`sim.roster.ZH_NAMES`): the zh voices
read "J. Ferriday" as "G Faraday". No Latin letter is left in a zh line, not even "xT" (the voice
read "（xT）" as "Baxtee"): expected threat is 预期威胁. Counts of up to ten are words (一次,
两次). A wording or name change re-keys the cached texts it changes
(`explain.render.render_fingerprint`).
"""

import asyncio
import json
import re
from pathlib import Path

import pytest

from agents import whatif
from agents.context import MomentContext
from agents.workflow import breakdown
from explain import lexicon
from explain.claims import Slot
from explain.numbers import ZH_NUMERALS
from explain.render import ScriptLine, format_slot, render_fingerprint, render_line
from explain.tactics import view_for_run
from sim.roster import ROSTER, ZH_NAMES, name_forms, short_name

DATA = Path(__file__).resolve().parents[1] / "web" / "public" / "data"
HEROES = [("blind_side_run", 3), ("press_escape", 0), ("far_post_finish", 11),
          ("corner_blind_side", 0)]  # fmt: skip
PERSONAS = ("casual", "analyst", "player_fan", "coach", "audio_description")
PLAYER_ID = re.compile(r"(?<![A-Za-z0-9_])[HA](?:1[01]|[1-9])(?![A-Za-z0-9_])")
ENGLISH = re.compile(r"[A-Za-z]+")  # a zh line holds no Latin letter at all


def _english(text: str) -> list[str]:
    return ENGLISH.findall(text)


@pytest.fixture(scope="module", params=HEROES, ids=lambda h: f"{h[0]}-{h[1]}")
def ctx(request):
    return MomentContext.load(*request.param)


@pytest.fixture(scope="module")
def zh(ctx):
    return breakdown(ctx, client=None, personas=PERSONAS, languages=("zh",))


def test_every_player_has_one_chinese_name_that_reads_as_no_other_word():
    assert set(ZH_NAMES) == set(ROSTER)
    assert len(set(ZH_NAMES.values())) == len(ZH_NAMES)
    for pid, name in ZH_NAMES.items():
        assert short_name(pid, "zh") == name and short_name(pid) != name
        assert name in name_forms(pid) and short_name(pid) in name_forms(pid)
        assert not set(name) & set(ZH_NUMERALS), name  # never read as a number
        assert not lexicon.find_terms(name) and not lexicon.find_banned(name), name
        others = [o for o in ZH_NAMES.values() if o != name]
        assert not any(name in o for o in others), name  # one name is never inside another


def test_every_template_line_in_chinese_names_players_in_chinese_and_holds_no_english(ctx, zh):
    for script in zh.scripts:
        assert script.payload.lines, script.persona
        assert not script.dropped, script.dropped
        for line in script.payload.lines:
            assert not PLAYER_ID.search(line.text), line.text
            assert not _english(line.text), (script.persona, line.text)
        for cue in script.voice:
            words = re.sub(r"<[^>]+>", " ", cue.ssml)
            assert not ENGLISH.findall(words), (script.persona, words)
    texts = [line.text for s in zh.scripts for line in s.payload.lines]
    assert any(short_name(ctx.hero, "zh") in t for t in texts)


def test_every_supported_claim_reads_without_english_in_chinese(ctx):
    for cid, claim in ctx.supported.items():
        out = render_line(ScriptLine(id=cid, text=claim.template_for("zh"), claims=[cid]),
                          ctx.claims, ctx.verdicts, "zh", ctx.names)  # fmt: skip
        assert out.ok, (cid, out.violations)
        assert not _english(out.text), (cid, out.text)


@pytest.mark.parametrize("written", ["J. Ferriday", "Ferriday", "费里迪", "H8"])
def test_a_name_in_any_form_outside_a_slot_is_an_entity_in_chinese(written):
    ctx = MomentContext.load("blind_side_run", 3)
    line = ScriptLine(id="L1", text=f"球到之前，{written}先回头看了一眼。",
                      claims=["scan_before_reception"])  # fmt: skip
    bad = render_line(line, ctx.claims, ctx.verdicts, "zh", ctx.names)
    assert not bad.ok
    assert [v.detail for v in bad.violations if v.kind == "entity"] == [written]


def test_a_chinese_count_of_up_to_ten_is_said_in_words():
    said = {n: format_slot(Slot(value=n), "zh", fmt="times") for n in (1, 2, 3, 10, 11, 3079)}
    assert said == {1: "一次", 2: "两次", 3: "三次", 10: "十次", 11: "11次", 3079: "3079次"}
    assert format_slot(Slot(value=2), "en", fmt="times") == "twice"


def test_a_chinese_wording_change_rekeys_chinese_text_only():
    ctx = MomentContext.load("blind_side_run", 3)
    zh, en = (render_fingerprint([lang], ctx.claims, ctx.names) for lang in ("zh", "en"))
    changed = dict(ctx.claims)
    claim = changed["cf_pass"]
    reworded = {"zh": "没有那一眼，{player}会传给{cf_receiver}。"}
    changed["cf_pass"] = claim.model_copy(update={"templates": reworded})
    assert render_fingerprint(["zh"], changed, ctx.names) != zh
    assert render_fingerprint(["en"], changed, ctx.names) == en
    renamed = {**ctx.names, "H8": "Somebody"}
    assert render_fingerprint(["en"], ctx.claims, renamed) != en


def test_a_what_if_question_may_name_the_player_in_chinese():
    ctx = MomentContext.load("blind_side_run", 3)
    for question in ("如果他传给安纳斯利呢？", "如果他传给K. Annersley呢？"):
        assert asyncio.run(whatif.map_question(ctx, question)) == ("pass:H4", "template")


def test_the_tactics_cards_name_players_and_clubs_never_ids_or_home_and_away():
    from sim.engine import Simulation

    run = Simulation.from_scenario("corner_blind_side", 0).run()
    view = view_for_run(run, "corner_blind_side-0")
    texts = {lang: [line.text for line in p.lines] for lang, p in view.lines.items()}
    for lines in texts.values():
        for text in lines:
            assert not PLAYER_ID.search(text), text
            assert not re.search(r"\bHome\b|\bAway\b|主队|客队", text), text
    for text in texts["zh"]:
        assert not _english(text), text


@pytest.mark.parametrize("path", sorted(DATA.glob("*.json")), ids=lambda p: p.name)
def test_the_bundled_chinese_lines_hold_no_english_and_no_latin_names(path):
    zh = []

    def walk(node, lang=None):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, "zh" if k == "zh" else lang)
        elif isinstance(node, list):
            for v in node:
                walk(v, lang)
        elif isinstance(node, str) and lang == "zh" and re.search(r"[一-鿿]", node):
            zh.append(node)

    walk(json.loads(path.read_text()))
    for text in zh:
        assert not _english(text), text
        assert not PLAYER_ID.search(text), text
