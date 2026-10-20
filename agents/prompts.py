"""Instructions and prompts for each agent (SPEC 6).

Every instruction starts with `ROLE: <name>`. Models see numbers (lens deltas, claim values) so they
can judge the story, but narration agents write numbers and player ids only as placeholders taken
from verified claims; the Verifier enforces that (SPEC 5.3).
"""

from __future__ import annotations

import json

from agents.context import MomentContext
from agents.schemas import (
    CONNECTIVES,
    BreakdownRequest,
    Findings,
    Language,
    Persona,
    ScriptLine,
    Speaker,
)

CREW = (
    "You are part of an AI production crew that explains one moment of a synthetic football match. "
    "Clubs and players are fictional: H8 is home number 8, A5 away number 5. The home team attacks "
    "towards +x. Our signature is perception: what the player saw before the ball arrived, what he "
    "believed, and what he would have done without one look over his shoulder (a re-simulation "
    "inside the synthetic match). Some moments are explained instead by the space he found or the "
    "press he escaped; the card's selected lens says which. Reply with JSON that matches the "
    "requested schema, nothing else."
)

DIRECTOR = f"""ROLE: director
{CREW}
You are the Director. The audiences (personas and languages) are fixed by the request. Set the
breakdown's priority (low, normal or high) from how much the selected lens changed the outcome (its
delta in expected threat), and give a one-sentence reason in plain words, with no digits or number
words: numbers reach viewers only through verified claims."""

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
- Start with a freeze, show the key scan in first person (when there is no key scan, the moments
  before the decision), then the outcome, then the counterfactual ghost."""

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

NARRATION_RULES = """How to build the script:
- Each line is either one claim id (its verified sentence is spoken exactly as written) or one of
  the allowed connectives. You choose which claims, their order, and where a connective helps the
  rhythm (at most two connectives per voice); you never write sentences yourself.
- Use each claim at most once in the whole script. The co-commentator never repeats a claim the
  play-by-play already used; it adds the claims that explain why.
- Keep to the persona's length."""


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
        out.append({"id": cid, "kind": claim.kind, "sentence": claim.template_for(language)})
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
            "key_scan": None if key is None else {
                "id": key.id, "from": round(ctx.rel(key.frame), 2),
                "to": round(ctx.rel(key.attrs["end"]), 2)},
            "counterfactual": ctx.counterfactual_id,
            "intervention": ctx.intervention,
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
        "other_claims": _claims(
            ctx,
            [c for c in ctx.supported if c not in findings.headline + findings.supporting],
            language,
        ),
        "allowed_connectives": list(CONNECTIVES[language]),
    }
    if pbp_lines:
        data["play_by_play_used"] = [
            {"claim": line.claims[0] if line.claims else None, "text": line.text}
            for line in pbp_lines
        ]
    return _dump(data)


def rewrite_prompt(base: str, failed: list[tuple[ScriptLine, list[str]]]) -> str:
    rejected = [
        {"claim": line.claims[0] if line.claims else None, "text": line.text, "problems": problems}
        for line, problems in failed
    ]
    return (
        base
        + "\n\nThe Verifier rejected these lines. Rewrite each of them, in the same order, so it "
        "follows the rules; return exactly one line per rejected line.\n" + _dump(rejected)
    )


def _prompt_version() -> str:
    """Changes whenever any instruction changes; part of the breakdown cache key (SPEC 2)."""
    import hashlib

    texts = [CREW, DIRECTOR, ANALYST, TELESTRATOR, NARRATION_RULES, *PERSONAS.values(),
             *SPEAKERS.values()]  # fmt: skip
    return hashlib.sha256("\n".join(texts).encode()).hexdigest()[:12]


PROMPT_VERSION = _prompt_version()
