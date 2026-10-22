"""Narration ablation (SPEC 6): the eval-only free-text mode, and the ablation pipeline offline.

The free-text mode is the narration the crew had before anchored lines (git d975277^). It lives in
eval/ and is used only by eval/narration_ablation.py; the shipped crew still narrates anchored
lines. The ablation runs on a FakeChatClient here, with the groundedness evaluator stubbed, so
these tests need neither a model nor azure-ai-evaluation.
"""

import ast
import asyncio
import inspect
from pathlib import Path

import pytest

from agents import prompts
from agents.context import MomentContext
from agents.schemas import NarrationDraft, ScriptLine
from agents.testing import FakeChatClient
from agents.workflow import BREAKDOWN, Narration, breakdown, build_workflow, run_breakdown

ROOT = Path(__file__).resolve().parents[1]
SHIPPED = ("agents", "analytics", "api", "explain", "sim")

ANCHORED_PBP = {"lines": [{"claim": "scan_before_reception", "connective": "Watch this."}]}
ANCHORED_COLOR = {"lines": [{"claim": "cf_pass", "connective": None}]}

# Free-text replies with the M0 failure modes: a malformed placeholder that would air as literal
# braces, a bare placeholder before "times", a player id and a digit written out, a judgement
# word, a line with no claim, and a claim the play-by-play already stated.
FREE_PBP = {"lines": [
    {"text": "{player} checked his shoulder before the ball reached him.",
     "claims": ["scan_before_reception"]},
    {"text": "{player} scanned {n} times in the {window_s|second} before receiving.",
     "claims": ["scans_before_reception"]},
    {"text": "H9 made the run.", "claims": []},
]}  # fmt: skip
FREE_COLOR = {"lines": [
    {"text": "It was a mistake by {player} to look 2 times.", "claims": ["cf_pass"]},
    {"text": "{player} checked his shoulder before the ball reached him.",
     "claims": ["scan_before_reception"]},
]}  # fmt: skip


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


def _crew_replies(pbp, color):
    from agents.plan import template_plan

    return lambda ctx: {
        "director": {"priority": "high", "reason": "The look decides the pass."},
        "analyst": {"lens": "scan", "headline": ["scan_before_reception", "belief_error"],
                    "supporting": ["cf_pass", "blind_side"], "angle": "He saw the runner."},
        "telestrator": template_plan(ctx).model_dump(by_alias=True),
        "pbp": pbp,
        "color": color,
    }  # fmt: skip


def _clients():
    return {
        "free_text": FakeChatClient({"pbp": FREE_PBP, "color": FREE_COLOR}),
        "anchored": FakeChatClient({"pbp": ANCHORED_PBP, "color": ANCHORED_COLOR}),
    }


# --- the shipped crew is unchanged: anchored lines, no free-text mode ----------------------------


def test_the_shipped_crew_narrates_anchored_lines(ctx):
    fake = FakeChatClient(_crew_replies(ANCHORED_PBP, ANCHORED_COLOR)(ctx))
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",))
    sent = fake.prompts["pbp"][0]
    assert sent == prompts.narration_prompt(ctx, r.findings, "analyst", "en", "pbp")
    assert "allowed_connectives" in sent and '"slots"' not in sent
    (script,) = r.scripts
    texts = [line.text for line in script.payload.lines]
    assert texts[0] == "Watch this. J. Ferriday checked his shoulder before the ball reached him."
    assert "Without that look, J. Ferriday would have passed to K. Annersley." in texts
    # The analyst's persona rules add their template lines (agents/persona_rules.py).
    assert {"cf_value", "belief_error"} <= {c for line in script.lines for c in line.claims}


def test_the_default_workflow_and_run_breakdown_use_the_shipped_narration():
    params = inspect.signature(build_workflow).parameters
    # No narration override: the story's, and the default story is the breakdown's.
    assert params["narration"].default is None and params["story"].default is BREAKDOWN
    assert BREAKDOWN.narration is Narration
    assert "narration" not in inspect.signature(run_breakdown).parameters


def test_a_free_text_reply_cannot_reach_the_shipped_crew(ctx):
    """The anchored schema has no `text` field, so a free-text reply fails validation and the
    voice falls back to its template; the model's own words never air."""
    fake = FakeChatClient(_crew_replies(FREE_PBP, FREE_COLOR)(ctx))
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",))
    steps = {s.step: s for s in r.trace}
    assert steps["narration"].source == "template"
    texts = " ".join(line.text for line in r.scripts[0].payload.lines)
    assert "mistake" not in texts and "{" not in texts and texts


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def test_shipped_code_never_imports_the_eval_package():
    offenders = [
        str(path.relative_to(ROOT))
        for package in SHIPPED
        for path in (ROOT / package).rglob("*.py")
        if any(name == "eval" or name.startswith("eval.") for name in _imports(path))
    ]
    assert offenders == []


# --- the eval-only free-text mode is the pre-anchoring narration ---------------------------------


def test_free_text_mode_sends_the_pre_anchoring_prompt_and_schema(ctx):
    from eval import free_text
    from eval.narration_ablation import run_mode

    fake = FakeChatClient({"pbp": FREE_PBP, "color": FREE_COLOR})
    scripts, _ = asyncio.run(run_mode(ctx, "free_text", fake, ("analyst",), ("en",)))
    assert free_text.FreeTextNarration.schema(None, "en") is NarrationDraft
    first = fake.prompts["pbp"][0]
    assert '"slots"' in first and '"template"' in first and "allowed_connectives" not in first
    assert "Write numbers and player ids only as placeholders" in free_text.NARRATION_RULES
    color = fake.prompts["color"][0]
    assert '"play_by_play_lines"' in color  # the co-commentator replies to the pbp text
    (script,) = scripts
    assert script.mode == "free_text" and not script.fell_back


def test_free_text_lines_are_scored_by_violation_kind(ctx):
    from eval.narration_ablation import run_mode

    fake = FakeChatClient({"pbp": FREE_PBP, "color": FREE_COLOR})
    (s,), calls = asyncio.run(run_mode(ctx, "free_text", fake, ("analyst",), ("en",)))
    assert len(s.drafted) == 5
    assert s.repeats == 1  # the co-commentator restated the play-by-play's claim
    assert s.restored == 1  # a bare {n} given its template's {n:times}
    assert len(s.first_pass) == 4
    failing = [line for line in s.first_pass if line.kinds]
    assert len(failing) == 3
    v = s.violations
    assert v["placeholder"] >= 1  # {window_s|second}: literal braces
    assert v["number"] >= 1 and v["banned"] >= 1 and v["entity"] >= 1 and v["unbacked_line"] >= 1
    assert v["lexicon"] == 0 and v["unsupported_claim"] == 0 and v["stale_claim"] == 0
    # The digit of a written-out id counts once, as the entity, not also as a number.
    (h9,) = [line for line in s.first_pass if line.text == "H9 made the run."]
    assert h9.kinds == ["unbacked_line", "entity"]
    # Not shown any values, the model guessed: no cited claim holds H9 or 2.
    assert h9.made_up == ["H9"]
    (mistake,) = [line for line in s.first_pass if "mistake" in line.text]
    assert mistake.made_up == ["2"]
    assert mistake.truth == ["Without that look, J. Ferriday would have passed to K. Annersley."]
    assert s.made_up == 2
    # The same reply comes back on each rewrite, so the judgement line is dropped after two.
    assert s.rewrites == 2
    assert [d.kinds[0] for d in s.dropped] == ["number"]
    assert all("{" not in text and "mistake" not in text for text in s.aired)
    # The rewrites replaced the failing lines with a line that already airs, twice.
    assert s.aired == ["J. Ferriday checked his shoulder before the ball reached him."] * 3
    assert s.aired_repeats == 2 and all(a.verbatim for a in s.aired_lines)
    assert calls == fake.calls["pbp"] + fake.calls["color"] == 6


def test_anchored_lines_pass_the_first_round(ctx):
    from eval.narration_ablation import run_mode

    fake = FakeChatClient({"pbp": ANCHORED_PBP, "color": ANCHORED_COLOR})
    (s,), calls = asyncio.run(run_mode(ctx, "anchored", fake, ("analyst",), ("en",)))
    assert calls == 2 and s.rewrites == 0 and s.dropped == [] and s.repeats == 0
    assert all(not line.kinds for line in s.first_pass) and sum(s.violations.values()) == 0
    assert s.made_up == 0 and s.aired_repeats == 0 and all(a.verbatim for a in s.aired_lines)
    assert s.aired == [
        "Watch this. J. Ferriday checked his shoulder before the ball reached him.",
        "Without that look, J. Ferriday would have passed to K. Annersley.",
    ]
    assert s.headline == ["scan_before_reception", "belief_error", "cf_pass"]
    assert s.headline_spoken == ["scan_before_reception", "cf_pass"]
    assert s.context == [
        "J. Ferriday checked his shoulder before the ball reached him.",
        "Without that look, J. Ferriday would have passed to K. Annersley.",
    ]


# --- the ablation end to end, offline -------------------------------------------------------------


def _stub_judge(seen: list):
    def judge(response: str, context: str) -> tuple[float, str]:
        seen.append((response, context))
        grounded = all(line in context or line.startswith("Watch") for line in response.split("\n"))
        return (5.0 if grounded else 2.0), "stub"

    return judge


def test_the_ablation_runs_end_to_end_offline(tmp_path):
    from eval import narration_ablation as na

    seen: list = []
    results = asyncio.run(
        na.ablate([3], _clients(), _stub_judge(seen), personas=("casual", "analyst"),
                  languages=("en",), cache_dir=tmp_path)
    )  # fmt: skip
    (seed,) = results
    assert seed.seed == 3 and {s.mode for s in seed.scripts} == {"free_text", "anchored"}
    assert len(seed.scripts) == 4
    assert len(seen) == 4  # one groundedness call per aired script
    assert seed.calls == {"free_text": 12, "anchored": 4, "judge": 4}
    for s in seed.scripts:
        assert s.groundedness is not None and s.groundedness_reason == "stub"
        response, context = seen[seed.scripts.index(s)]
        assert response == "\n".join(s.aired) and context == "\n".join(s.context)

    meta = na.Meta(model="fake", date="2026-10-20", evaluator="stub", seeds=[3],
                   personas=["casual", "analyst"], languages=["en"])  # fmt: skip
    text = na.report(results, meta)
    assert "# Narration ablation" in text
    assert "| free text |" in text and "| anchored |" in text
    assert "{window_s|second}" in text  # a verbatim free-text failure
    assert "Seeds: 3" in text and "fake" in text and "2026-10-20" in text


def test_number_values_and_own_words(ctx):
    from eval.narration_ablation import _aired, number_value
    from explain.render import PayloadLine

    assert [number_value(t) for t in ("0.08", "two", "twice", "两米", "十五秒", "1.2", "半秒")] == [
        0.08, 2.0, 2.0, 2.0, 15.0, 1.2, 0.5,
    ]  # fmt: skip
    own = PayloadLine(id="L1", text="The midfielder spotted a teammate open.",
                      claims=["scan_before_reception"])  # fmt: skip
    assert not _aired(ctx, own, "en").verbatim
    template = PayloadLine(id="L2", text="Watch this. J. Ferriday checked his shoulder before the "
                           "ball reached him.", claims=["scan_before_reception"])  # fmt: skip
    assert _aired(ctx, template, "en").verbatim
    assert _aired(ctx, PayloadLine(id="L3", text="注意看。", claims=[]), "zh").verbatim


def test_the_grammar_check_flags_count_words_that_do_not_agree():
    from eval.narration_ablation import GRAMMAR

    broken = ["H8 scanned 1 times in the 2 before receiving.", "He scanned once times.",
              "a 6.6 metres-metre gap", "接球前2秒内，H8扫视了1次次。"]  # fmt: skip
    fine = ["H9 opened up 8.1 metres on A5.", "H8 scanned once in the 2 seconds before receiving.",
            "It lasted 1 second.", "H8扫视了1次。"]  # fmt: skip
    assert all(GRAMMAR.search(t) for t in broken)
    assert not any(GRAMMAR.search(t) for t in fine)


def test_a_written_out_id_counts_once_as_an_entity_in_both_languages(ctx):
    """The Verifier rejects a written-out H8 as an entity (in zh too, next to a Chinese
    character) and its digit as a number; the ablation counts it once, as the entity it is."""
    from eval.narration_ablation import _check

    for language, text in (("en", "H8 checked his shoulder before the ball reached him."),
                           ("zh", "球到之前，H8先回头看了一眼。")):  # fmt: skip
        line = ScriptLine(id="L1", speaker="pbp", text=text, claims=["scan_before_reception"])
        checked = _check(ctx, line, language)
        assert checked.kinds == ["entity"] and checked.details == ["H8"]
        assert checked.made_up == []  # H8 is the claim's player: right, but not from a slot
    wrong = ScriptLine(id="L2", speaker="pbp", text="如果没有那一眼，H8会把球传给A5。",
                       claims=["cf_pass"])  # fmt: skip
    checked = _check(ctx, wrong, "zh")
    assert checked.kinds == ["entity", "entity"] and checked.made_up == ["A5"]
    assert checked.truth == ["如果没有那一眼，费里迪会把球传给安纳斯利。"]


def test_the_ablation_reuses_cached_seeds_and_keeps_to_the_call_budget(tmp_path):
    from eval import narration_ablation as na

    first = asyncio.run(na.ablate([3], _clients(), _stub_judge([]), personas=("analyst",),
                                  languages=("en",), cache_dir=tmp_path))  # fmt: skip
    clients = _clients()
    again = asyncio.run(na.ablate([3], clients, _stub_judge([]), personas=("analyst",),
                                  languages=("en",), cache_dir=tmp_path))  # fmt: skip
    assert again == first and all(sum(c.calls.values()) == 0 for c in clients.values())

    # One seed costs 6 + 2 narration calls and 2 judge calls: a budget of 15 stops after it.
    clients = _clients()
    results = asyncio.run(na.ablate([100, 101], clients, _stub_judge([]), personas=("analyst",),
                                    languages=("en",), max_calls=15))  # fmt: skip
    assert [r.seed for r in results] == [100]
