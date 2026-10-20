"""Instructions and prompts for each agent (SPEC 6).

Every instruction starts with `ROLE: <name>`. Models see numbers (lens deltas, claim values) so they
can judge the story, but narration agents write numbers and player ids only as placeholders taken
from verified claims; the Verifier enforces that (SPEC 5.3).
"""

from __future__ import annotations

import json

from agents.context import MomentContext
from agents.schemas import BreakdownRequest, Findings, Language, Persona, ScriptLine, Speaker

CREW = (
    "You are part of an AI production crew that explains one moment of a synthetic football match. "
    "Clubs and players are fictional: H8 is home number 8, A5 away number 5. The home team attacks "
    "towards +x. Our signature is perception: what the player saw before the ball arrived, what he "
    "believed, and what he would have done without one look over his shoulder (a re-simulation "
    "inside the synthetic match). Reply with JSON that matches the requested schema, nothing else."
)

DIRECTOR = f"""ROLE: director
{CREW}
You are the Director. Decide who gets this breakdown. Choose personas and languages only from the
allowed lists, and a priority (low, normal or high) from how much the selected lens changed the
outcome (its delta in expected threat). Give a one-sentence reason."""

ANALYST = f"""ROLE: analyst
{CREW}
You are the Analyst. Explain why the moment happened. If you have tools, inspect the moment with
them (get_moment, list_claims, get_vision, run_counterfactual, ...). Choose the lens — normally the
card's selected lens — and claim ids from the claims list: one to three headline claims that carry
the story, and up to six supporting ones. Use only ids whose verdict is "supported"; never invent
an id. `angle` is one plain sentence for the commentators, with no digits."""

TELESTRATOR = f"""ROLE: telestrator
{CREW}
You are the Telestrator. Turn the findings into a TelestrationPlan: a timed cue list for the replay.
- `t` is seconds since the plan started and never decreases; `duration_s` is the plan length.
- `to` and `from` are seconds of match time relative to the decision (negative = before it) and
  must stay inside the clip you are given.
- A `pov` step shows at most 3 seconds of match time; use speed 0.5 for the look over the shoulder.
- Refer only to the player, scan and counterfactual ids you are given. Do not add `voice` steps:
  narration is placed after it is verified.
- Start with a freeze, show the key scan in first person, then the outcome, then the
  counterfactual ghost."""

PERSONAS: dict[Persona, str] = {
    "casual": "Audience: casual fans. Plain words and few numbers: prefer claims without numeric "
    "slots. At most two lines.",
    "analyst": "Audience: analysts. Dense and precise; numbers are welcome through claims. Up to "
    "four lines.",
    "player_fan": "Audience: fans of the player on the ball. Keep the focus on him: his look, his "
    "picture of the pitch, his choice. Up to three lines.",
    "coach": "Audience: coaches. Instructional: what the look gave him and what a player can copy. "
    "Up to three lines.",
}

SPEAKERS: dict[Speaker, str] = {
    "pbp": "You are the play-by-play commentator: what happened, short and paced.",
    "color": "You are the co-commentator: why it happened, the perception story. You reply to the "
    "play-by-play lines you are shown.",
}

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


def _dump(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1)


def _card_summary(ctx: MomentContext) -> dict:
    card = ctx.card
    return {
        "moment": card.id,
        "kind": card.kind,
        "tags": card.tags,
        "actor": card.actor,
        "receiver": card.receiver,
        "selected_lens": card.selected_lens,
        "lenses": {
            lens.lens: {"available": lens.available, "delta_xt": lens.delta_xt}
            for lens in card.lenses
        },
    }


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


def director_prompt(ctx: MomentContext, personas: list[str], languages: list[str]) -> str:
    return _dump(
        {"allowed_personas": personas, "allowed_languages": languages, **_card_summary(ctx)}
    )


def analyst_prompt(ctx: MomentContext, request: BreakdownRequest) -> str:
    return _dump(
        {"request": request.model_dump(), "card": _card_summary(ctx),
         "claims": [{**c, "verdict": "supported"} for c in _claims(ctx, None, "en")]}
    )  # fmt: skip


def telestrator_prompt(ctx: MomentContext, findings: Findings, example: dict) -> str:
    key = ctx.key_scan
    return _dump(
        {
            "findings": findings.model_dump(),
            "moment": ctx.card.id,
            "clip": [round(ctx.rel(0), 2), round(ctx.rel(ctx.frames - 1), 2)],
            "decision_at": 0.0,
            "hero": ctx.hero,
            "players": ctx.players,
            "key_scan": {"id": key.id, "from": round(ctx.rel(key.frame), 2),
                         "to": round(ctx.rel(key.attrs["end"]), 2)},
            "counterfactual": ctx.counterfactual_id,
            "claims_for_labels": list(ctx.supported),
            "example_plan": example,
        }
    )  # fmt: skip


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
