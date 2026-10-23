"""The persona gate (SPEC 6, "Persona specs"; eval/persona_distinctness.py): the five audiences'
breakdowns of the served hero moments differ in what is said and what is shown, each within its
spec, with every line verified and no number a model wrote."""

import json

import pytest

from eval import persona_distinctness as pd


@pytest.fixture(scope="module")
def after():
    return pd.measure("this code", pd.offline_runs())


def test_the_personas_tell_different_stories(after):
    g = pd.gate(after)
    assert g.scripts == len(pd.HEROES) * len(pd.PERSONAS) * len(pd.LANGUAGES)
    assert g.mean_jaccard <= pd.MAX_MEAN_JACCARD, g
    assert g.max_pair_jaccard <= pd.MAX_PAIR_JACCARD, after.pair_means()
    assert g.distinct_openers == 1.0  # within the first line, every pair sounds different


def test_every_persona_sees_its_own_plan(after):
    assert pd.gate(after).distinct_plans == len(pd.PERSONAS)
    first = {s.persona: s.plan for s in after.scripts if s.language == "en"}
    assert first["analyst"]["first"][:4] == ["zone vision", "zone pitch_control", "zone options",
                                             "camera tactical"]  # fmt: skip
    assert first["player_fan"]["cameras"] == ["pov", "player_lock"]
    assert first["audio_description"]["cameras"] == ["broadcast"]
    assert first["audio_description"]["overlays"] == []


def test_every_script_is_within_its_spec_and_verified(after):
    bad = [(s.moment, s.persona, s.language, s.problems) for s in after.scripts if s.problems]
    assert bad == []
    assert all(s.verified for s in after.scripts)
    assert after.model_digits == 0
    for s in after.scripts:
        spec = pd.persona_rules.SPECS[s.persona]
        if spec.max_jargon_lines == 0:
            assert s.jargon_lines == 0, (s.persona, s.language, s.texts)


def test_the_before_measurement_fails_the_gate_the_after_passes(after):
    before = pd.Measurement.from_json(
        json.loads((pd.REPORTS / "persona_distinctness_before.json").read_text())
    )
    b, a = pd.gate(before), pd.gate(after)
    assert not b.passed and a.passed
    assert b.mean_jaccard > a.mean_jaccard and b.max_pair_jaccard > pd.MAX_PAIR_JACCARD
    assert b.distinct_plans == 1 and b.distinct_openers < 1.0
