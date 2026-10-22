"""Per-persona rules and specs (SPEC 6, "Persona rules" and "Persona specs";
agents/persona_rules.py): palettes, required groups, number and line budgets, openers, the coach's
cue."""

import json

import pytest

from agents import persona_rules
from agents.context import MomentContext
from agents.persona_rules import problems, repair
from agents.schemas import ScriptLine
from agents.testing import FakeChatClient
from agents.workflow import breakdown
from explain.render import check_payload

PERSONAS = ("casual", "analyst", "player_fan", "coach", "audio_description")
HEROES = (("blind_side_run", 3), ("press_escape", 0), ("corner_blind_side", 0),
          ("far_post_finish", 4), ("keeper_switch", 0), ("cutback_scan", 0))  # fmt: skip
OPEN = {"casual": "Watch his head.", "player_fan": "Lovely from him.", "coach": "Coaching point."}
CUE = "Teach it: check your shoulder before the ball arrives."


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


@pytest.fixture(scope="module")
def pressure():
    return MomentContext.load("press_escape", seed=0)


def _line(ctx, cid, speaker="color", i=1, language="en", opener=None):
    if cid is None:
        return ScriptLine(id=f"L{i}", speaker="pbp", text="What did he see?", claims=[])
    if cid == "cue":
        return ScriptLine(id=f"L{i}", speaker="color", text=CUE, claims=[])
    text = ctx.claims[cid].template_for(language)
    if opener:
        text = f"{opener} {text}"
    return ScriptLine(id=f"L{i}", speaker=speaker, text=text, claims=[cid])


def _script(ctx, ids, language="en", opener=None):
    out = []
    for i, cid in enumerate(ids):
        first = opener if i == 0 else None
        out.append(_line(ctx, cid, i=i + 1, language=language, opener=first))
    return out


def _check(ctx, persona, ids, language="en", opener=True):
    phrase = OPEN.get(persona) if opener else None
    return problems(persona, _script(ctx, ids, language, phrase), ctx.supported,
                    ctx.card.selected_lens, language)  # fmt: skip


# --- the rules ------------------------------------------------------------------------------------


def test_every_hero_claim_is_placed_on_the_palettes():
    """A claim a builder adds must be placed on the palettes, or no persona's rules know it."""
    seen = set()
    for scenario, seed in HEROES:
        seen |= set(MomentContext.load(scenario, seed).claims)
    assert seen <= persona_rules.CLAIM_IDS


def test_casual_tells_the_story_with_no_jargon_and_the_counterfactual(ctx):
    assert _check(ctx, "casual", ["seen_in_scan", "runner_received", "cf_pass"]) == []
    found = _check(ctx, "casual", ["seen_in_scan", "cf_value"])
    assert found[0] == "not for casual: cf_value"
    assert found[1].startswith("missing the counterfactual") and "cf_pass" in found[1]
    # Off the casual palette: probabilities, scan counts, the space he saw.
    found = _check(ctx, "casual", ["seen_in_scan", "reception_zone", "cf_pass"])
    assert found == ["not for casual: reception_zone"]
    assert _check(ctx, "casual", ["pass_success", "cf_pass"])[0] == "not for casual: pass_success"
    # What he saw (or the press he felt) starts the story.
    found = _check(ctx, "casual", ["runner_received", "cf_pass"])
    assert [p.split(":")[0] for p in found] == ["missing what he saw (or the press he felt)"]


def test_casual_says_at_most_one_number_in_at_most_three_lines(ctx):
    ids = ["seen_in_scan", "pass_to_runner", "cf_lost_runner", "cf_pass"]
    supported = dict(ctx.supported)
    found = _check(ctx, "casual", ["seen_in_scan", "pass_to_runner", "cf_pass"])
    assert found == []  # one number: the pass's length
    found = problems("casual", _script(ctx, ["seen_in_scan", "pass_to_runner", "runner_received",
                                             "cf_pass"], opener=OPEN["casual"]), supported,
                     "scan", "en")  # fmt: skip
    assert found == ["4 lines, at most 3 for casual"]
    assert ids  # (cf_lost_runner is the marker's; it is on the palette but not on this moment)
    # scans_before_reception says two ("once", "2 seconds"): numeric slots, not digits, count.
    assert persona_rules.numbers(ctx.claims["scans_before_reception"], "en") == 2
    assert persona_rules.numbers(ctx.claims["reception_zone"], "en") == 0  # vocabulary slots


def test_casual_player_fan_and_coach_open_with_their_own_phrase(ctx):
    ids = ["seen_in_scan", "runner_received", "cf_pass"]
    assert _check(ctx, "casual", ids, opener=False) == ['start with the opener "Watch his head."']
    found = _check(ctx, "player_fan", ["scan_side", "pass_to_runner"], opener=False)
    assert found == ['start with the opener "Lovely from him."']
    zh = problems("casual", _script(ctx, ids, "zh", "注意看他回头。"), ctx.supported, "scan", "zh")
    assert zh == []


def test_the_coach_ends_with_the_moments_teaching_cue(ctx, pressure):
    good = ["time_since_last_scan", "blind_side", "cf_pass", "cue"]
    assert _check(ctx, "coach", good) == []
    found = _check(ctx, "coach", good[:-1])
    assert found == [f'end with the cue "{CUE}"']
    assert persona_rules.cue("coach", "en", pressure.supported, "pressure") == (
        "Teach it: move the ball before the press arrives."
    )
    assert persona_rules.cue("casual", "en", ctx.supported, "scan") is None


def test_analyst_needs_xt_belief_scan_timing_chances_and_space_and_opens_on_a_number(ctx):
    full = ["scans_before_reception", "observed_share", "belief_error", "pass_success", "cf_value"]
    assert _check(ctx, "analyst", full) == []
    found = _check(ctx, "analyst", ["scan_before_reception", "cf_pass"])
    assert [p.split(":")[0] for p in found] == [
        "missing what the look was worth in expected threat",
        "missing his belief error",
        "missing when and how often he scanned",
        "missing the options' chances",
        "missing the space and the press around him",
        "start with a number",
    ]
    assert _check(ctx, "analyst", [None, *full]) == [
        "start with a number: the first line cites a claim that says one"
    ]


def test_scan_groups_bind_only_on_the_scan_lens(pressure):
    """The press escape is told by the pressure lens: no scan timing asked of the analyst."""
    assert pressure.card.selected_lens == "pressure"
    assert "scans_before_reception" in pressure.supported
    ids = ["pressure_at_pass", "pass_success", "cf_carry_lost", "cf_value"]
    assert _check(pressure, "analyst", ids) == []
    fan = ["heavy_pressure", "pass_to_runner", "pass_speed"]
    assert problems("player_fan", _script(pressure, fan, opener=OPEN["player_fan"]),
                    pressure.supported, "pressure", "en") == []  # fmt: skip
    found = problems("player_fan", _script(pressure, ["heavy_pressure", "presser_distance"],
                                           opener=OPEN["player_fan"]),
                     pressure.supported, "pressure", "en")  # fmt: skip
    assert [p.split(":")[0] for p in found] == ["missing his decision"]


def test_player_fan_hears_his_look_and_his_pass_and_no_what_ifs(ctx):
    assert _check(ctx, "player_fan", ["scan_side", "pass_to_runner", "pass_speed"]) == []
    found = _check(ctx, "player_fan", ["blind_side", "cf_pass"])
    assert [p.split(":")[0] for p in found] == [
        "not for player_fan",
        "missing his own look",
        "missing his decision",
    ]


def test_coach_needs_the_counterfactual_and_a_coaching_point(ctx):
    assert _check(ctx, "coach", ["time_since_last_scan", "cf_pass", "cue"]) == []
    found = _check(ctx, "coach", ["blind_side", "belief_error", "cue"])
    assert [p.split(":")[0] for p in found] == [
        "not for coach",
        "missing the coaching point",
        "missing the counterfactual",
    ]


def test_audio_description_starts_with_where_and_keeps_numbers_sparse(ctx):
    good = ["reception_zone", "blind_side", "scan_side", "pass_to_runner", "cf_pass"]
    assert _check(ctx, "audio_description", good) == []
    found = _check(ctx, "audio_description", ["pass_to_runner", "reception_zone", "cf_pass"])
    assert found == ["start with where it happened: cite one of reception_zone, scan_side, "
                     "blind_side first"]  # fmt: skip
    numbered = ["reception_zone", "presser_distance", "pass_to_runner", "gap_to_marker"]
    found = _check(ctx, "audio_description", numbered)
    assert found == ["3 numbers, at most 2 for audio_description"]
    assert _check(ctx, "audio_description", ["reception_zone", "cf_value"]) == [
        "not for audio_description: cf_value"
    ]


def test_a_group_with_no_supported_claim_is_not_required(ctx):
    """Nothing the moment cannot say is ever asked for (blind_side_run has no cf_carry_lost, and
    the counterfactual group is satisfied by cf_pass alone)."""
    supported = {c: claim for c, claim in ctx.supported.items() if c != "cf_pass"}
    lines = _script(ctx, ["seen_in_scan", "runner_received"], opener=OPEN["casual"])
    assert problems("casual", lines, supported, "scan", "en") == []


def test_the_rules_fingerprint_is_stable_text():
    text = persona_rules.fingerprint()
    casual = sorted(persona_rules.RULES["casual"].forbidden)
    assert casual[:2] == ["cf_pass_success", "cf_shot_value"] and str(casual) in text  # sorted
    assert "Watch his head." in text and CUE in text
    assert text == persona_rules.fingerprint()


def test_openers_and_cues_are_lines_the_verifier_lets_air():
    from explain.lexicon import find_banned, find_terms, is_connective
    from explain.numbers import number_tokens

    for language in ("en", "zh"):
        for phrase in persona_rules.all_connectives(language):
            assert is_connective(phrase), phrase
            assert not find_terms(phrase) and not find_banned(phrase) and not number_tokens(phrase)


# --- the repair after the last rewrite ------------------------------------------------------------


def _ids(lines):
    return [line.claims[0] if line.claims else line.text for line in lines]


def _repair(ctx, persona, ids, language="en", opener=None):
    return repair(persona, _script(ctx, ids, language, opener), ctx.supported,
                  ctx.card.selected_lens, language)  # fmt: skip


def test_repair_drops_off_palette_lines_adds_the_counterfactual_and_the_opener(ctx):
    lines, dropped, notes = _repair(ctx, "casual", [None, "seen_in_scan", "cf_value"])
    assert _ids(lines) == ["seen_in_scan", "cf_pass"]
    assert lines[0].text.startswith("Watch his head. When J.") or lines[0].text.startswith(
        "Watch his head. When {"
    )
    assert [(d.id, why) for d, why in dropped] == [
        ("L3", "cf_value: not for casual"),
        ("L1", "casual opens with its opener"),
    ]
    assert lines[-1].speaker == "color" and lines[-1].id not in {"L1", "L2", "L3"}
    assert lines[-1].text == ctx.claims["cf_pass"].template_for("en")  # a verified template line
    assert notes[0] == f"{lines[-1].id} added: cf_pass (the counterfactual)"
    assert problems("casual", lines, ctx.supported, "scan", "en") == []


def test_repair_puts_added_lines_in_story_order_and_ends_with_the_cue(ctx):
    lines, _, notes = _repair(ctx, "coach", ["time_since_last_scan"])
    assert _ids(lines) == ["time_since_last_scan", "cf_pass", CUE]
    assert lines[0].text.startswith("Coaching point. ")
    assert notes[-1].endswith("added last: the cue")
    assert problems("coach", lines, ctx.supported, "scan", "en") == []


def test_repair_trims_numbers_and_lines_but_never_a_required_line(ctx):
    ids = ["seen_in_scan", "pass_to_runner", "unmarked", "runner_received", "cf_pass"]
    lines, dropped, _ = _repair(ctx, "casual", ids, opener=OPEN["casual"])
    assert _ids(lines) == ["seen_in_scan", "pass_to_runner", "cf_pass"]
    assert [why for _, why in dropped] == ["too many lines for casual"] * 2
    lines, dropped, _ = _repair(ctx, "audio_description",
                                ["reception_zone", "presser_distance", "pass_to_runner",
                                 "gap_to_marker"])  # fmt: skip
    assert _ids(lines) == ["reception_zone", "presser_distance", "pass_to_runner"]
    assert [why for _, why in dropped] == ["too many numbers for audio_description"]


def test_repair_brings_where_it_happened_first_for_audio_description(ctx):
    lines, _, notes = _repair(ctx, "audio_description", ["pass_to_runner", "reception_zone"])
    assert _ids(lines)[0] == "reception_zone" and "moved first" in notes[0]
    lines, _, notes = _repair(ctx, "audio_description", ["pass_to_runner", "cf_pass"])
    assert _ids(lines) == ["reception_zone", "pass_to_runner", "cf_pass"]


def test_repair_brings_a_number_first_for_the_analyst(ctx):
    ids = [None, "belief_error", "scans_before_reception", "observed_share", "pass_success",
           "cf_value"]  # fmt: skip
    lines, dropped, _ = _repair(ctx, "analyst", ids)
    assert _ids(lines)[0] == "belief_error" and dropped[0][1] == "analyst opens with a number"
    assert problems("analyst", lines, ctx.supported, "scan", "en") == []


@pytest.mark.parametrize("language", ["en", "zh"])
def test_repair_leaves_a_compliant_script_alone(ctx, language):
    opener = {"en": "Watch his head.", "zh": "注意看他回头。"}[language]
    for persona, ids, phrase in (
        ("casual", ["seen_in_scan", "runner_received", "cf_pass"], opener),
        ("analyst", ["scans_before_reception", "observed_share", "belief_error", "pass_success",
                     "cf_value"], None),
    ):  # fmt: skip
        script = _script(ctx, ids, language, phrase)
        lines, dropped, notes = repair(persona, script, ctx.supported, "scan", language)
        assert lines == script and dropped == [] and notes == []


# --- every script that airs follows its persona's rules and spec ---------------------------------


@pytest.fixture(scope="module")
def heroes():
    return {(s, seed): MomentContext.load(s, seed) for s, seed in HEROES}


@pytest.mark.parametrize("hero", HEROES)
def test_offline_scripts_follow_the_rules_on_every_hero(heroes, hero):
    hctx = heroes[hero]
    r = breakdown(hctx, client=None, personas=PERSONAS, languages=("en", "zh"))
    for script in r.scripts:
        found = problems(script.persona, script.lines, hctx.supported, hctx.card.selected_lens,
                         script.language)  # fmt: skip
        assert found == [], (hero, script.persona, script.language)
        assert check_payload(script.payload) == []
        assert script.dropped == []
        lo, hi = persona_rules.SPECS[script.persona].lines
        assert lo <= len(script.lines) <= hi, (hero, script.persona, script.language)


def test_the_schema_and_prompt_offer_only_the_personas_palette_and_phrases(ctx):
    from types import SimpleNamespace

    from agents.prompts import narration_prompt
    from agents.workflow import Narration

    narration = Narration.__new__(Narration)
    narration.crew = SimpleNamespace(ctx=ctx)

    def enum(persona):
        schema = narration.schema("en", persona).model_json_schema()
        return set(json.dumps(schema).split('"')) & set(ctx.supported)

    def connectives(persona):
        schema = json.dumps(narration.schema("en", persona).model_json_schema())
        return {c for c in persona_rules.all_connectives("en") if f'"{c}"' in schema}

    assert "cf_value" not in enum("casual") and "pass_success" not in enum("casual")
    assert "scans_before_reception" not in enum("casual") and "cf_pass" in enum("casual")
    assert {"cf_value", "pass_success", "observed_share"} <= enum("analyst")
    assert "cf_value" not in enum("audio_description")
    assert "cf_pass" not in enum("player_fan") and "pass_speed" in enum("player_fan")
    assert connectives("casual") == {"Watch his head.", "Look again."}
    assert connectives("coach") == {"Coaching point.", "Look again.", CUE}
    assert connectives("audio_description") == set()
    assert (
        "connective"
        in narration.schema("en", "audio_description").model_json_schema()["$defs"]["AnchoredLine"][
            "properties"
        ]
    )  # always null

    findings = SimpleNamespace(angle="He saw the runner.", headline=["cf_value", "cf_pass"],
                               supporting=["belief_error"])  # fmt: skip
    data = json.loads(narration_prompt(ctx, findings, "casual", "en", "pbp"))
    shown = {c["id"] for key in ("headline_claims", "supporting_claims", "other_claims")
             for c in data[key]}  # fmt: skip
    assert "cf_value" not in shown and "cf_pass" in shown and "belief_error" not in shown
    assert data["rules"]["must_include"] == [
        {"what": persona_rules.STORY.name, "one_of": ["seen_in_scan", "scan_before_reception"]},
        {"what": persona_rules.COUNTERFACTUAL.name, "one_of": ["cf_pass"]},
    ]
    assert data["rules"]["max_numbers"] == 1 and data["rules"]["max_lines"] == 3
    assert data["rules"]["opener"] == "Watch his head." and "still_missing" not in data["rules"]
    assert data["allowed_connectives"] == ["Watch his head.", "Look again."]
    pbp = [_line(ctx, "seen_in_scan", "pbp")]
    data = json.loads(narration_prompt(ctx, findings, "casual", "en", "color", pbp))
    assert [g["one_of"] for g in data["rules"]["still_missing"]] == [["cf_pass"]]
    pbp.append(_line(ctx, "cf_pass", "pbp", 2))
    data = json.loads(narration_prompt(ctx, findings, "casual", "en", "color", pbp))
    assert data["rules"]["still_missing"] == []
    coach = json.loads(narration_prompt(ctx, findings, "coach", "zh", "color", pbp))
    assert coach["rules"]["cue"] == "要教的就是这一点：球到之前，先回头看。"
    analyst = json.loads(narration_prompt(ctx, findings, "analyst", "en", "pbp"))
    assert analyst["rules"]["start_with_number"] is True and "opener" not in analyst["rules"]


# --- the crew: a script that breaks the rules is rewritten, then repaired ------------------------


def _replies(ctx, pbp, color):
    from agents.plan import template_plan

    return {
        "director": {"priority": "high", "reason": "The look over the shoulder decides the pass."},
        "analyst": {"lens": "scan", "headline": ["scan_before_reception", "cf_pass"],
                    "supporting": ["cf_value", "blind_side"], "angle": "He saw the runner."},
        "telestrator": template_plan(ctx).model_dump(by_alias=True),
        "pbp": pbp,
        "color": color,
    }  # fmt: skip


def _lines(*ids, connective=None):
    out = [{"claim": cid, "connective": None} for cid in ids]
    if connective:
        out[0]["connective"] = connective
    return {"lines": out}


def test_a_casual_script_without_the_counterfactual_is_drafted_again(ctx):
    """The cached-model failure the red team found: casual got xT and no counterfactual. Now the
    schema has no xT for casual, and a script without the counterfactual goes back, whole."""
    pbp = _lines("seen_in_scan", connective="Watch his head.")
    color = [_lines("runner_received"), _lines("runner_received", "cf_pass")]
    fake = FakeChatClient(_replies(ctx, pbp, color))
    r = breakdown(ctx, client=fake, personas=("casual",), languages=("en",))
    (script,) = r.scripts
    assert [c for line in script.lines for c in line.claims] == [
        "seen_in_scan",
        "runner_received",
        "cf_pass",
    ]
    assert script.lines[0].text.startswith("Watch his head. ")
    assert script.rewrites == 1 and script.dropped == []
    assert fake.calls["pbp"] == 2 and fake.calls["color"] == 2  # both voices drafted again
    rewrite = fake.prompts["color"][1]
    assert "rejected the whole script" in rewrite and "missing the counterfactual" in rewrite
    assert "cf_value" not in fake.prompts["pbp"][0]  # never offered to the casual voices
    verifier = next(s for s in r.trace if s.step == "verifier")
    assert verifier.attempts == 2


def test_a_script_that_never_complies_is_repaired_with_template_lines(ctx):
    pbp = _lines("seen_in_scan", connective="Look again.")
    color = _lines("runner_received")
    fake = FakeChatClient(_replies(ctx, pbp, color))
    r = breakdown(ctx, client=fake, personas=("casual", "coach"), languages=("en",))
    by = {s.persona: s for s in r.scripts}
    for persona, script in by.items():
        assert script.rewrites == 2
        assert problems(persona, script.lines, ctx.supported, "scan", "en") == []
        assert check_payload(script.payload) == []
    casual = by["casual"]
    assert [c for line in casual.lines for c in line.claims][-1] == "cf_pass"
    assert casual.lines[0].text.startswith("Watch his head. ")
    coach = [c for line in by["coach"].lines for c in line.claims]
    assert "cf_pass" in coach and "time_since_last_scan" in coach
    assert by["coach"].lines[-1].text == CUE
    verifier = next(s for s in r.trace if s.step == "verifier")
    assert any("added: cf_pass" in note for note in verifier.notes)


def test_tidy_drops_a_line_off_the_personas_palette(ctx):
    """Defence in depth behind the schema: tidy drops a forbidden line before the Verifier."""
    from agents.workflow import tidy

    lines = _script(ctx, [None, "seen_in_scan", "cf_value", "cf_pass"])
    kept, notes = tidy(ctx, lines, "en", "casual")
    assert _ids(kept) == ["What did he see?", "seen_in_scan", "cf_pass"]
    assert notes == ["L3 dropped: cf_value not for casual"]
    kept, _ = tidy(ctx, lines, "en", "analyst")
    assert _ids(kept) == _ids(lines)
