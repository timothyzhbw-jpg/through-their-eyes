"""The end-of-match recap (SPEC 6, recap): the crew's graph on a whole stitched match."""

import asyncio
import json
from typing import get_args

import pytest

from agents import prompts
from agents.delivery import ANALYST_NUMBERS
from agents.recap import (
    DIRECTOR,
    MAX_MOMENTS,
    MIN_MOMENTS,
    MOMENT_LINES,
    PERSONAS,
    RECAP_CONNECTIVES,
    RECAP_SEQUENCES,
    CueSheet,
    run_recap,
    timecode,
)
from agents.recap_context import RecapContext
from agents.schemas import Persona
from agents.testing import Call, FakeChatClient, ToolCallingFakeChatClient
from agents.workflow import PIPELINE_VERSION, STEPS
from explain import lexicon
from explain.recap import base_id
from explain.render import check_payload

ALL = tuple(get_args(Persona))


@pytest.fixture(scope="module")
def rc():
    return RecapContext.for_match(1)


@pytest.fixture(scope="module")
def offline(rc):
    return asyncio.run(run_recap(rc, personas=ALL, languages=("en", "zh")))


def _recap(rc, **kwargs):
    return asyncio.run(run_recap(rc, **kwargs))


def _replies(rc, picked):
    """A model crew that picks `picked` (candidate ids) and narrates from their claims."""
    focused = rc.focused(picked)
    first = focused.moments[0]
    return {
        "director": {"moments": picked, "priority": "high", "reason": "The looks decided it."},
        "analyst": {"headline": ["final_score", first.claims[0]], "supporting": ["passes_home"],
                    "angle": "Looks over the shoulder shaped the match."},
        "telestrator": {"clips": [{"moment": m.id, "camera": "tactical", "speed": 1.0}
                                  for m in focused.moments]},
        "pbp": {"lines": [{"claim": "final_score", "connective": None},
                          {"claim": first.claims[0], "connective": "Let's go back."}]},
        "color": {"lines": [{"claim": "passes_home", "connective": None}]},
    }  # fmt: skip


def test_every_persona_has_a_recap_template_and_a_brief():
    assert set(RECAP_SEQUENCES) == set(MOMENT_LINES) == set(PERSONAS) == set(ALL)
    for persona in ALL:
        assert sum(item == "<key moments>" for _, item in RECAP_SEQUENCES[persona]) == 1
    for language, connectives in RECAP_CONNECTIVES.items():
        assert all(lexicon.is_connective(c) for c in connectives), language


def test_recap_prompts_leave_breakdown_cache_keys_alone():
    # Recap instructions have their own version: a breakdown's key must not move with them.
    # Moved on purpose with the Director's budget (agents/budget.py) and the persona rules
    # (agents/persona_rules.py): PIPELINE_VERSION 6.
    assert prompts.PROMPT_VERSION == "451f64ac88e9" and PIPELINE_VERSION == 6


def test_an_offline_recap_runs_the_whole_crew_graph(rc, offline):
    assert [s.step for s in offline.trace] == list(STEPS)
    assert {s.source for s in offline.trace if s.step not in ("verifier", "voice")} == {"template"}
    assert MIN_MOMENTS <= len(offline.moments) <= MAX_MOMENTS
    frames = [m.anchor_frame for m in offline.moments]
    assert frames == sorted(frames)  # the reel plays them in match order
    top = [c.id for c in rc.candidates[: len(offline.moments)]]
    assert {m.id for m in offline.moments} == set(top)  # the largest impacts
    assert [c.moment for c in offline.reel.clips] == offline.request.moments
    assert offline.score == {"home": rc.score[0], "away": rc.score[1]}
    assert {(s.persona, s.language) for s in offline.scripts} == {
        (p, lg) for p in ALL for lg in ("en", "zh")
    }


def test_the_ranking_is_told_as_editorial_not_pure_impact(rc, offline):
    """Hero moments lead the candidates (explain.recap.rank_moments); the template's reason and
    the Director's instructions say so, so the trace never presents it as an impact ranking."""
    assert [c.hero for c in rc.candidates[:3]] == [True] * 3
    assert offline.request.reason.startswith("Template: the hero moments first")
    assert "editorial order" in DIRECTOR and "hero moments" in DIRECTOR


def test_every_number_on_air_and_on_the_card_comes_from_a_verified_slot(rc, offline):
    for script in offline.scripts:
        for payload in (script.payload, script.card):
            assert check_payload(payload, rc.names) == [], (script.persona, script.language)
            assert payload.lines
            for claim in payload.claims:
                assert rc.verdicts[claim.id].status == "supported"
        assert not script.dropped


def test_audio_description_never_hears_xt_or_probabilities(offline):
    for script in offline.scripts:
        if script.persona != "audio_description":
            continue
        for payload in (script.payload, script.card):
            heard = {base_id(c) for line in payload.lines for c in line.claims}
            assert not heard & ANALYST_NUMBERS


def test_the_card_has_one_verified_sentence_per_key_moment(rc, offline):
    for script in offline.scripts:
        lines = {line.id: line for line in script.card.lines}
        assert lines["S"].claims == ["final_score"]
        assert set(script.card_moments) == {m.id for m in offline.moments}
        for moment, line_id in script.card_moments.items():
            assert line_id is not None, (script.persona, moment)
            (cid,) = lines[line_id].claims
            assert rc.moment_of(cid).id == moment
        stats = [line.claims[0] for line in script.card.lines if line.id.startswith("T")]
        assert stats == offline.stats and set(stats) <= set(rc.stats)


def test_the_cue_sheet_is_timed_machine_readable_and_only_says_verified_lines(rc, offline):
    for script in offline.scripts:
        sheet = CueSheet.model_validate_json(script.cues.model_dump_json())
        assert sheet == script.cues
        cues = sheet.cues
        assert [c.t for c in cues] == sorted(c.t for c in cues)
        assert len({c.id for c in cues}) == len(cues)
        for c in cues:
            assert 0 <= c.t <= c.until <= sheet.duration_s
            assert (c.tc, c.tc_out) == (timecode(c.t), timecode(c.until))
        said = {line.text for line in script.payload.lines + script.card.lines}
        assert all(c.text in said for c in cues if c.text is not None)
        captions = [c for c in cues if c.type == "caption"]
        assert [c.line for c in captions] == [line.id for line in script.payload.lines]
        clips = [c for c in cues if c.type == "clip"]
        assert [c.moment for c in clips] == offline.request.moments
        for clip in clips:
            m = rc.candidate(clip.moment)
            assert m.start <= clip.data["match_frame_in"] <= m.anchor_frame
            assert clip.data["match_frame_out"] < m.end
        bug = cues[0]
        assert bug.type == "score_bug" and (bug.t, bug.until) == (0.0, sheet.duration_s)
        assert (bug.data["home"], bug.data["away"]) == rc.score


def test_voice_cues_sit_on_the_reel_clock_with_their_captions(offline):
    for script in offline.scripts:
        captions = {c.line: c.t for c in script.cues.cues if c.type == "caption"}
        times = [v.t for v in script.voice]
        assert times == sorted(times)
        assert all(v.t == captions[v.line] for v in script.voice)


def test_the_offline_recap_is_deterministic(rc, offline):
    again = _recap(rc, personas=ALL, languages=("en", "zh"))

    def stable(r):
        data = r.model_dump(mode="json")
        data["total_ms"] = data["trace_id"] = None
        for step in data["trace"]:
            step["ms"] = 0
        return data

    assert stable(again) == stable(offline)


def test_the_model_crew_picks_the_moments_the_reel_and_the_stats(rc):
    picked = [rc.candidates[1].id, rc.candidates[0].id, rc.candidates[3].id]
    fake = FakeChatClient(_replies(rc, picked))
    r = _recap(rc, client=fake, personas=("analyst",), languages=("en",))
    assert r.request.moments == [m.id for m in rc.focused(picked).moments]
    assert r.request.reason == "The looks decided it." and r.request.priority == "high"
    assert {s.step: s.source for s in r.trace}["director"] == "llm"
    assert r.reel_source == "agent" and {c.camera for c in r.reel.clips} == {"tactical"}
    assert r.stats == ["passes_home"]  # the card shows the stats the Analyst picked
    (script,) = r.scripts
    texts = [line.text for line in script.payload.lines]
    # In the recap's order, whichever voice said it: the result, the moments, the stats.
    home, away = rc.score
    assert texts[0] == f"Full time: Home {home}, Away {away}." and texts[-1].startswith(
        "Home completed"
    )
    assert texts[1].startswith("Let's go back. ")


def test_the_voices_lines_air_in_the_recaps_order(rc):
    """A moment told by both voices keeps its play-by-play line first, even when only the
    co-commentator speaks about an earlier moment (the voices interleave line by line)."""
    r = _recap(rc, personas=("casual",), languages=("en",), down=("narration",))
    (script,) = r.scripts
    order = {m.id: k for k, m in enumerate(r.moments)}
    told = [rc.moment_of(line.claims[0]) for line in script.payload.lines if line.claims]
    groups = [order[m.id] for m in told if m is not None]
    assert groups == sorted(groups)
    voices: dict[str, list[str]] = {}
    for line in script.lines:
        moment = rc.moment_of(line.claims[0]) if line.claims else None
        if moment is not None:
            voices.setdefault(moment.id, []).append(line.speaker)
    both = [said for said in voices.values() if {"pbp", "color"} <= set(said)]
    assert both and all(said[0] == "pbp" for said in both)
    texts = [line.text for line in script.payload.lines]
    seen = next(i for i, t in enumerate(texts) if "he saw N. Varnhall" in t)
    assert "Without that look" in texts[seen + 1]
    assert [line.id for line in script.payload.lines] == [f"L{n + 1}" for n in range(len(texts))]


def test_a_director_reply_outside_the_candidates_falls_back_to_the_template(rc, offline):
    replies = _replies(rc, [c.id for c in rc.candidates[:3]])
    replies["director"] = {"moments": ["m:goal:H9:0001"], "priority": "high", "reason": "Why."}
    fake = FakeChatClient(replies)
    r = _recap(rc, client=fake, personas=("casual",), languages=("en",))
    assert r.request.moments == offline.request.moments
    assert {s.step: s.source for s in r.trace}["director"] == "template"


def test_a_reel_that_skips_a_key_moment_falls_back_with_a_reason_code(rc):
    picked = [c.id for c in rc.candidates[:3]]
    replies = _replies(rc, picked)
    clips = replies["telestrator"]["clips"]
    replies["telestrator"] = {"clips": [clips[0], clips[0], clips[2]]}
    r = _recap(rc, client=FakeChatClient(replies), personas=("casual",), languages=("en",))
    assert r.reel_source == "template" and r.reel_errors == ["clips: not_the_key_moments_in_order"]
    telestrator = next(s for s in r.trace if s.step == "telestrator")
    assert telestrator.notes == ["invalid reel, template used: clips: not_the_key_moments_in_order"]


def test_a_narration_line_about_another_moment_never_airs(rc):
    """The model may cite only the picked moments' claims (an enum): anything else fails the
    schema, and the voice falls back to its template."""
    picked = [c.id for c in rc.candidates[:3]]
    other = rc.candidates[3].claims[0]
    replies = _replies(rc, picked)
    replies["pbp"] = {"lines": [{"claim": other, "connective": None}]}
    r = _recap(rc, client=FakeChatClient(replies), personas=("casual",), languages=("en",))
    (script,) = r.scripts
    assert all(other not in line.claims for line in script.payload.lines)
    focused = {c for m in rc.focused(picked).moments for c in m.claims} | set(rc.stats)
    assert all(c in focused for line in script.payload.lines for c in line.claims)


def test_the_recap_analyst_reads_the_match_through_mcp(rc, tmp_path):
    path = tmp_path / "evidence.json"
    path.write_text(json.dumps(rc.evidence()))
    with_file = rc.focused([c.id for c in rc.candidates])  # a copy that knows its file
    with_file.focus, with_file.evidence_path = None, str(path)
    replies = _replies(rc, [c.id for c in rc.candidates[:3]])
    replies["analyst"] = [Call("get_match_stats"), Call("list_key_moments"), replies["analyst"]]
    fake = ToolCallingFakeChatClient(replies=replies)
    r = _recap(with_file, client=fake, personas=("analyst",), languages=("en",), use_mcp=True)
    analyst = next(s for s in r.trace if s.step == "analyst")
    assert analyst.source == "llm"
    assert analyst.notes == ["MCP tools called: get_match_stats, list_key_moments"]
    stats, moments = (json.loads(json.loads(t)["result"])
                      for t in fake.tool_results["analyst"].values())  # fmt: skip
    assert stats["score"] == {"home": rc.score[0], "away": rc.score[1]}
    assert stats["stats"][0]["id"] == "final_score"
    assert [m["moment"] for m in moments] == [c.id for c in rc.candidates]


def test_a_match_with_a_goal_leads_its_recap_with_it():
    from agents.context import MomentContext
    from explain.match import match_moments
    from sim.match import PossessionSpec, build_match

    plan = (PossessionSpec("possession_play", max_s=10.0),
            PossessionSpec("far_post_finish", 4))  # fmt: skip
    match = build_match(7, plan)
    heroes = {p.index: MomentContext.load(p.scenario, p.seed)
              for p in match.possessions if p.run.hero}  # fmt: skip
    cards = match_moments(match, {k: list(c.cards.values()) for k, c in heroes.items()})
    rc = RecapContext.build("match-7", match, cards, heroes)
    r = _recap(rc, personas=("casual", "audio_description"), languages=("en",))
    assert r.score == {"home": 1, "away": 0} and r.tier in ("excited", "clutch")
    # The recap lists its moments in match order; the goal is the one it ranks first.
    assert "goal" in min(r.moments, key=lambda m: m.rank).tags
    for script in r.scripts:
        texts = [line.text for line in script.payload.lines]
        assert texts[0] == "Full time: Home 1, Away 0." and "N. Varnhall scored." in texts
        assert check_payload(script.payload, rc.names) == []
        bug = script.cues.cues[0]
        assert (bug.data["home"], bug.data["away"]) == (1, 0)
