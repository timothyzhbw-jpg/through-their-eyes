"""Per-persona required and forbidden claims (SPEC 6, "Persona rules"; agents/persona_rules.py)."""

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
          ("far_post_finish", 4), ("keeper_switch", 0))  # fmt: skip


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


@pytest.fixture(scope="module")
def pressure():
    return MomentContext.load("press_escape", seed=0)


def _line(ctx, cid, speaker="color", i=1, language="en"):
    if cid is None:
        return ScriptLine(id=f"L{i}", speaker="pbp", text="What did he see?", claims=[])
    return ScriptLine(id=f"L{i}", speaker=speaker, text=ctx.claims[cid].template_for(language),
                      claims=[cid])  # fmt: skip


def _script(ctx, ids, language="en"):
    return [_line(ctx, cid, i=i + 1, language=language) for i, cid in enumerate(ids)]


def _check(ctx, persona, ids, language="en"):
    return problems(persona, _script(ctx, ids, language), ctx.supported, ctx.card.selected_lens,
                    language)  # fmt: skip


# --- the rules ------------------------------------------------------------------------------------


def test_casual_never_hears_xt_and_always_hears_the_counterfactual(ctx):
    assert _check(ctx, "casual", [None, "scan_before_reception", "cf_pass"]) == []
    found = _check(ctx, "casual", [None, "scan_before_reception", "cf_value"])
    assert found[0] == "not for casual: cf_value"
    assert found[1].startswith("missing the counterfactual") and "cf_pass" in found[1]
    assert _check(ctx, "casual", ["pass_success", "cf_pass"]) == ["not for casual: pass_success"]


def test_casual_says_at_most_two_numbers(ctx):
    # belief_error, time_since_last_scan and pass_to_runner say one number each.
    ids = ["time_since_last_scan", "belief_error", "pass_to_runner", "cf_pass"]
    assert _check(ctx, "casual", ids) == ["3 numbers, at most 2 for casual"]
    assert _check(ctx, "casual", ids[1:]) == []
    # scans_before_reception says two ("once", "2 seconds"): numeric slots, not digits, count.
    assert persona_rules.numbers(ctx.claims["scans_before_reception"], "en") == 2
    assert persona_rules.numbers(ctx.claims["reception_zone"], "en") == 0  # vocabulary slots


def test_analyst_needs_xt_belief_error_and_scan_timing(ctx):
    full = ["scans_before_reception", "belief_error", "cf_pass", "cf_value"]
    assert _check(ctx, "analyst", full) == []
    found = _check(ctx, "analyst", ["scan_before_reception", "cf_pass"])
    assert [p.split(":")[0] for p in found] == [
        "missing what the look was worth in expected threat",
        "missing his belief error",
        "missing when and how often he scanned",
    ]


def test_scan_groups_bind_only_on_the_scan_lens(pressure):
    """The press escape is told by the pressure lens: no scan timing asked of the analyst."""
    assert pressure.card.selected_lens == "pressure"
    assert "scans_before_reception" in pressure.supported
    ids = ["pressure_at_pass", "cf_carry_lost", "cf_value"]
    assert _check(pressure, "analyst", ids) == []
    assert _check(pressure, "player_fan", ["heavy_pressure", "runner_received"]) == []
    found = _check(pressure, "player_fan", ["heavy_pressure", "presser_distance"])
    assert [p.split(":")[0] for p in found] == ["missing his decision"]


def test_player_fan_needs_his_look_and_his_decision(ctx):
    assert _check(ctx, "player_fan", [None, "scan_before_reception", "runner_received"]) == []
    found = _check(ctx, "player_fan", [None, "blind_side", "cf_pass"])
    assert [p.split(":")[0] for p in found] == ["missing his own look", "missing his decision"]


def test_coach_needs_the_counterfactual_and_a_coaching_point(ctx):
    assert _check(ctx, "coach", ["time_since_last_scan", "cf_pass"]) == []
    found = _check(ctx, "coach", ["blind_side", "belief_error"])
    assert [p.split(":")[0] for p in found] == [
        "missing the counterfactual",
        "missing a coaching point",
    ]


def test_audio_description_starts_with_where_and_keeps_numbers_sparse(ctx):
    good = ["reception_zone", "blind_side", "scan_side", "pass_to_runner", "cf_pass"]
    assert _check(ctx, "audio_description", good) == []
    found = _check(ctx, "audio_description", ["pass_to_runner", "reception_zone", "cf_pass"])
    assert found == ["start with where it happened: cite one of reception_zone, scan_side, "
                     "blind_side first"]  # fmt: skip
    numbered = ["reception_zone", "belief_error", "pass_to_runner", "gap_to_marker"]
    found = _check(ctx, "audio_description", numbered)
    assert found == ["3 numbers, at most 2 for audio_description"]
    assert _check(ctx, "audio_description", ["reception_zone", "cf_value"]) == [
        "not for audio_description: cf_value"
    ]


def test_a_group_with_no_supported_claim_is_not_required(ctx):
    """Nothing the moment cannot say is ever asked for (blind_side_run has no cf_carry_lost, and
    the counterfactual group is satisfied by cf_pass alone)."""
    supported = {c: claim for c, claim in ctx.supported.items() if c != "cf_pass"}
    lines = _script(ctx, [None, "scan_before_reception"])
    assert problems("casual", lines, supported, "scan", "en") == []


def test_the_rules_fingerprint_is_stable_text():
    text = persona_rules.fingerprint()
    casual = sorted(persona_rules.RULES["casual"].forbidden)
    assert casual[:2] == ["cf_pass_success", "cf_shot_value"] and str(casual) in text  # sorted
    assert text == persona_rules.fingerprint()


# --- the repair after the last rewrite ------------------------------------------------------------


def _ids(lines):
    return [line.claims[0] if line.claims else None for line in lines]


def _repair(ctx, persona, ids, language="en"):
    return repair(persona, _script(ctx, ids, language), ctx.supported, ctx.card.selected_lens,
                  language)  # fmt: skip


def test_repair_drops_forbidden_and_adds_the_missing_counterfactual_in_story_order(ctx):
    lines, dropped, notes = _repair(ctx, "casual", [None, "scan_before_reception", "cf_value"])
    assert _ids(lines) == [None, "scan_before_reception", "cf_pass"]
    assert [(d.id, why) for d, why in dropped] == [("L3", "cf_value: not for casual")]
    assert lines[-1].speaker == "color" and lines[-1].id not in {"L1", "L2", "L3"}
    assert lines[-1].text == ctx.claims["cf_pass"].template_for("en")  # a verified template line
    assert notes == [f"{lines[-1].id} added: cf_pass (the counterfactual)"]
    assert problems("casual", lines, ctx.supported, "scan", "en") == []


def test_repair_puts_added_lines_before_the_value_line(ctx):
    lines, _, _ = _repair(ctx, "coach", ["time_since_last_scan", "cf_value"])
    assert _ids(lines) == ["time_since_last_scan", "cf_pass", "cf_value"]


def test_repair_trims_numbers_but_never_a_required_line(ctx):
    ids = ["time_since_last_scan", "belief_error", "pass_to_runner", "cf_pass"]
    lines, dropped, _ = _repair(ctx, "casual", ids)
    assert _ids(lines) == ["time_since_last_scan", "belief_error", "cf_pass"]
    assert [why for _, why in dropped] == ["too many numbers for casual"]


def test_repair_brings_where_it_happened_first_for_audio_description(ctx):
    lines, _, notes = _repair(ctx, "audio_description", ["pass_to_runner", "reception_zone"])
    assert _ids(lines)[0] == "reception_zone" and "moved first" in notes[0]
    lines, _, notes = _repair(ctx, "audio_description", ["pass_to_runner", "cf_pass"])
    assert _ids(lines) == ["reception_zone", "pass_to_runner", "cf_pass"]


@pytest.mark.parametrize("language", ["en", "zh"])
def test_repair_leaves_a_compliant_script_alone(ctx, language):
    for persona, ids in {
        "casual": [None, "scan_before_reception", "blind_side", "cf_pass"],
        "analyst": [None, "scans_before_reception", "belief_error", "cf_pass", "cf_value"],
    }.items():
        script = _script(ctx, ids, language)
        lines, dropped, notes = repair(persona, script, ctx.supported, "scan", language)
        assert lines == script and dropped == [] and notes == []


# --- every script that airs follows its persona's rules ------------------------------------------


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


def test_the_schema_and_prompt_leave_out_what_the_persona_must_not_hear(ctx):
    from types import SimpleNamespace

    from agents.prompts import narration_prompt
    from agents.workflow import Narration

    narration = Narration.__new__(Narration)
    narration.crew = SimpleNamespace(ctx=ctx)

    def enum(persona):
        schema = narration.schema("en", persona).model_json_schema()
        return set(json.dumps(schema).split('"')) & set(ctx.supported)

    assert "cf_value" not in enum("casual") and "pass_success" not in enum("casual")
    assert "cf_pass" in enum("casual")
    assert {"cf_value", "pass_success"} <= enum("analyst")
    assert "cf_value" not in enum("audio_description")

    findings = SimpleNamespace(angle="He saw the runner.", headline=["cf_value", "cf_pass"],
                               supporting=["belief_error"])  # fmt: skip
    data = json.loads(narration_prompt(ctx, findings, "casual", "en", "pbp"))
    shown = {c["id"] for key in ("headline_claims", "supporting_claims", "other_claims")
             for c in data[key]}  # fmt: skip
    assert "cf_value" not in shown and "cf_pass" in shown
    assert data["rules"]["must_include"] == [
        {"what": persona_rules.COUNTERFACTUAL.name, "one_of": ["cf_pass"]}
    ]
    assert data["rules"]["max_numbers"] == 2 and "still_missing" not in data["rules"]
    pbp = [_line(ctx, "scan_before_reception", "pbp")]
    data = json.loads(narration_prompt(ctx, findings, "casual", "en", "color", pbp))
    assert [g["one_of"] for g in data["rules"]["still_missing"]] == [["cf_pass"]]
    pbp.append(_line(ctx, "cf_pass", "pbp", 2))
    data = json.loads(narration_prompt(ctx, findings, "casual", "en", "color", pbp))
    assert data["rules"]["still_missing"] == []


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
    pbp = _lines("scan_before_reception", connective="What did he see?")
    color = [_lines("blind_side"), _lines("blind_side", "cf_pass")]
    fake = FakeChatClient(_replies(ctx, pbp, color))
    r = breakdown(ctx, client=fake, personas=("casual",), languages=("en",))
    (script,) = r.scripts
    assert [c for line in script.lines for c in line.claims] == [
        "scan_before_reception",
        "blind_side",
        "cf_pass",
    ]
    assert script.rewrites == 1 and script.dropped == []
    assert fake.calls["pbp"] == 2 and fake.calls["color"] == 2  # both voices drafted again
    rewrite = fake.prompts["color"][1]
    assert "rejected the whole script" in rewrite and "missing the counterfactual" in rewrite
    assert "cf_value" not in fake.prompts["pbp"][0]  # never offered to the casual voices
    verifier = next(s for s in r.trace if s.step == "verifier")
    assert verifier.attempts == 2


def test_a_script_that_never_complies_is_repaired_with_template_lines(ctx):
    pbp = _lines("scan_before_reception", connective="What did he see?")
    color = _lines("blind_side")
    fake = FakeChatClient(_replies(ctx, pbp, color))
    r = breakdown(ctx, client=fake, personas=("casual", "coach"), languages=("en",))
    by = {s.persona: s for s in r.scripts}
    for persona, script in by.items():
        assert script.rewrites == 2
        assert problems(persona, script.lines, ctx.supported, "scan", "en") == []
        assert check_payload(script.payload) == []
    assert [c for line in by["casual"].lines for c in line.claims][-1] == "cf_pass"
    coach = [c for line in by["coach"].lines for c in line.claims]
    assert "cf_pass" in coach and "time_since_last_scan" in coach
    verifier = next(s for s in r.trace if s.step == "verifier")
    assert any("added: cf_pass" in note for note in verifier.notes)


def test_tidy_drops_a_line_the_persona_must_not_hear(ctx):
    """Defence in depth behind the schema: tidy drops a forbidden line before the Verifier."""
    from agents.workflow import tidy

    lines = _script(ctx, [None, "scan_before_reception", "cf_value", "cf_pass"])
    kept, notes = tidy(ctx, lines, "en", "casual")
    assert _ids(kept) == [None, "scan_before_reception", "cf_pass"]
    assert notes == ["L3 dropped: cf_value not for casual"]
    kept, _ = tidy(ctx, lines, "en", "analyst")
    assert _ids(kept) == _ids(lines)
