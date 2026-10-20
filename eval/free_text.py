"""Free-text narration: the crew's narration before anchored lines, kept for the ablation only.

Recovered from git d975277^ (agents/prompts.py and agents/workflow.py before "agents: anchored
narration and enum-constrained claim ids"). Each voice writes its own sentences with slot
placeholders and lists the claims a line states (`NarrationDraft`: text + claims); the Verifier
then checks every line, as it does for anchored lines. Only the narration rules, the claims as the
model sees them (template and slot names), the co-commentator's view of the play-by-play and the
rewrite request differ from what ships; the crew text, personas and speakers are shared and
imported from agents/prompts.py, which has not changed them since.

`FreeTextNarration` replaces the shipped `Narration` executor in eval/narration_ablation.py and
nowhere else: `run_breakdown` and the API never use it, and the API image does not contain eval/.
"""

from __future__ import annotations

from typing import Any

from agents.context import MomentContext
from agents.prompts import CREW, PERSONAS, SPEAKERS, _dump
from agents.schemas import (
    DraftLine,
    Findings,
    Language,
    NarrationDraft,
    Persona,
    ScriptLine,
    Speaker,
)
from agents.workflow import Narration

NARRATION_RULES = """Rules for every line:
- `claims` lists the ids of the claims the line states; the line states nothing else.
- Write numbers and player ids only as placeholders from those claims' slots, exactly as in their
  templates, e.g. {player}, {runner}, {n:times}, {secs|second|seconds}. Never write a digit, a
  number word or a player id yourself.
- No judgement words: mistake, error, dominated, controlled the game, certain goal, should have,
  lazy, world-class; in Chinese 失误, 统治比赛, 必进, 本该, 偷懒.
- A line without claims may only be a short connective such as "What did he see?" or
  "他看到了什么？".
- One sentence per line."""


def narration_instructions(speaker: Speaker) -> str:
    return f"ROLE: {speaker}\n{CREW}\n{SPEAKERS[speaker]}\n{NARRATION_RULES}"


def _claims(ctx: MomentContext, ids: list[str] | None, language: Language) -> list[dict]:
    out = []
    for cid, claim in ctx.supported.items():
        if ids is not None and cid not in ids:
            continue
        out.append(
            {"id": cid, "kind": claim.kind, "template": claim.template_for(language),
             "slots": sorted(claim.slots)}
        )  # fmt: skip
    return out


def narration_prompt(
    ctx: MomentContext,
    findings: Findings,
    persona: Persona,
    language: Language,
    speaker: Speaker,
    pbp_lines: list[ScriptLine] | None = None,
) -> str:
    data = {
        "language": language,
        "persona": PERSONAS[persona],
        "angle": findings.angle,
        "headline_claims": _claims(ctx, findings.headline, language),
        "supporting_claims": _claims(ctx, findings.supporting, language),
    }
    if pbp_lines:
        data["play_by_play_lines"] = [
            {"text": line.text, "claims": line.claims} for line in pbp_lines
        ]
    return _dump(data)


def rewrite_prompt(base: str, failed: list[tuple[ScriptLine, list[str]]]) -> str:
    rejected = [
        {"text": line.text, "claims": line.claims, "problems": problems}
        for line, problems in failed
    ]
    return (
        base
        + "\n\nThe Verifier rejected these lines. Rewrite each of them, in the same order, so it "
        "follows the rules; return exactly one line per rejected line.\n" + _dump(rejected)
    )


class FreeTextNarration(Narration):
    """The shipped narration executor with the pre-anchoring prompts and schema."""

    def instructions(self, speaker: Speaker) -> str:
        return narration_instructions(speaker)

    def prompt(
        self,
        findings: Findings,
        persona: Persona,
        language: Language,
        speaker: Speaker,
        pbp: list[ScriptLine] | None = None,
    ) -> str:
        return narration_prompt(self.crew.ctx, findings, persona, language, speaker, pbp)

    def rewrite_prompt(self, base: str, failed: list[tuple[ScriptLine, list[str]]]) -> str:
        return rewrite_prompt(base, failed)

    def schema(self, language: Language) -> type[NarrationDraft]:
        return NarrationDraft

    def to_lines(self, value: Any, language: Language) -> list[DraftLine]:
        return list(value.lines)
