"""Instructions and prompts for each agent (SPEC 6).

Every instruction starts with `ROLE: <name>`. Models see numbers (lens deltas, claim values) so they
can judge the story, but narration agents write numbers and player ids only as placeholders taken
from verified claims; the Verifier enforces that (SPEC 5.3).
"""

from __future__ import annotations

import json

from agents import persona_rules
from agents.budget import BUDGETS
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

_SLOTS = {p: f"{b.replay_slot_s:.0f}" for p, b in BUDGETS.items()}

DIRECTOR = f"""ROLE: director
{CREW}
You are the Director. The audiences (personas and languages) are fixed by the request. Set the
breakdown's priority (low, normal or high) from how much the selected lens changed the outcome (its
delta in expected threat), and give a one-sentence reason in plain words, with no digits or number
words: numbers reach viewers only through verified claims.
The priority is the breakdown's budget. At high, the Analyst inspects the moment with our MCP
tools and the replay may run up to {_SLOTS["high"]} seconds; at normal and low, the Analyst answers
from the claims alone and the replay gets at most {_SLOTS["normal"]} and {_SLOTS["low"]} seconds."""

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
- `t` is seconds since the plan started and never decreases; `duration_s` is the plan length,
  at most `replay_slot_s`: the slot the Director gave this replay.
- `to` and `from` are seconds of match time relative to the decision (negative = before it) and
  must stay inside the clip you are given.
- A `pov` step shows at most 3 seconds of match time; use speed 0.5 for the look over the shoulder.
- Refer only to the player, scan and counterfactual ids you are given. Do not add `voice` steps:
  narration is placed after it is verified.
- Start with a freeze, show the key scan in first person (when there is no key scan, the moments
  before the decision), then the outcome, then the counterfactual ghost."""

PERSONAS: dict[Persona, str] = {
    "casual": "Audience: casual fans. Plain words and few numbers: prefer claims without numeric "
    "slots, never expected threat or probabilities, and always say what he would have done "
    "without the look (the counterfactual). At most two lines.",
    "analyst": "Audience: analysts. Dense and precise; numbers are welcome through claims: what "
    "the look was worth in expected threat, his belief error, and when he scanned. Up to four "
    "lines.",
    "player_fan": "Audience: fans of the player on the ball. Keep the focus on him: his own "
    "look, his picture of the pitch, his decision. Up to three lines.",
    "coach": "Audience: coaches. Instructional: the counterfactual, and one coaching point a "
    "player can copy (when he scanned, or how close the press was). Up to three lines.",
    "audio_description": "Audience: blind and low-vision viewers, who hear the moment instead of "
    "seeing it (audio description). Tell it in the order it happened: who has the ball and where, "
    "who he could not see, which way he looked, whom the look showed him, what he did. Use the "
    "preferred claims, in their order; leave out expected threat and probabilities. Calm and "
    "clear; no connectives; start with where it happened; numbers sparingly. Up to six lines.",
}

# Claims a persona should build from, in telling order; the narration prompt lists the supported
# ones as `preferred_claims`. Audio description: who, where, which way he looked, what he could
# and could not see, then what he did with it.
PREFERRED_CLAIMS: dict[Persona, tuple[str, ...]] = {
    "audio_description": ("reception_zone", "blind_side", "scan_side", "scan_before_reception",
                          "seen_in_scan", "pass_to_runner", "runner_received", "gap_to_marker",
                          "unmarked", "cf_pass"),
}  # fmt: skip

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
- Follow `rules`, which a check enforces on the whole script (both voices): cite one claim from
  every `must_include` group, keep the numbers the chosen claims say within `max_numbers`, and
  start with a `start_with` claim when given. The co-commentator covers whatever the play-by-play
  left in `still_missing`.
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


def _claims(
    ctx: MomentContext, ids: list[str] | None, language: Language, ordered: bool = False
) -> list[dict]:
    """Supported claims as the models see them: in context order, or in the order of `ids`."""
    supported = ctx.supported
    order = [c for c in ids if c in supported] if ordered and ids is not None else supported
    out = []
    for cid in order:
        if ids is not None and cid not in ids:
            continue
        claim = supported[cid]
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


def telestrator_prompt(
    ctx: MomentContext, findings: Findings, example: dict, replay_slot_s: float
) -> str:
    key = ctx.key_scan
    return _dump(
        {
            "findings": findings.model_dump(),
            "moment": ctx.card.id,
            "replay_slot_s": replay_slot_s,
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


def _rules(
    ctx: MomentContext, persona: Persona, language: Language, pbp_lines: list[ScriptLine] | None
) -> dict:
    """The persona's rules for this moment (agents/persona_rules.py), as the narrators see them."""
    rule = persona_rules.RULES.get(persona)
    if rule is None:
        return {}
    lens = ctx.card.selected_lens
    groups = persona_rules.missing(persona, [], ctx.supported, lens)
    out: dict = {"must_include": [{"what": g.name, "one_of": ids} for g, ids in groups]}
    if rule.max_numbers is not None:
        numbered = [
            c for c in ctx.supported
            if c not in rule.forbidden and persona_rules.numbers(ctx.supported[c], language)
        ]  # fmt: skip
        out["max_numbers"] = rule.max_numbers
        out["claims_with_numbers"] = {
            c: persona_rules.numbers(ctx.supported[c], language) for c in numbered
        }
    if rule.spatial_first and (spatial := [c for c in persona_rules.SPATIAL if c in ctx.supported]):
        out["start_with"] = spatial
    if pbp_lines is not None:
        left = persona_rules.missing(persona, pbp_lines, ctx.supported, lens)
        out["still_missing"] = [{"what": g.name, "one_of": ids} for g, ids in left]
    return out


def narration_prompt(
    ctx: MomentContext,
    findings: Findings,
    persona: Persona,
    language: Language,
    speaker: Speaker,
    pbp_lines: list[ScriptLine] | None = None,
) -> str:
    off = persona_rules.forbidden(persona)  # not in the schema's enum either

    def allowed(ids: list[str]) -> list[str]:
        return [c for c in ids if c not in off]

    data = {
        "language": language,
        "persona": PERSONAS[persona],
        "angle": findings.angle,
        "headline_claims": _claims(ctx, allowed(findings.headline), language),
        "supporting_claims": _claims(ctx, allowed(findings.supporting), language),
        "other_claims": _claims(
            ctx,
            allowed([c for c in ctx.supported if c not in findings.headline + findings.supporting]),
            language,
        ),
        "allowed_connectives": list(CONNECTIVES[language]),
    }
    if rules := _rules(ctx, persona, language, pbp_lines if speaker == "color" else None):
        data["rules"] = rules
    if persona in PREFERRED_CLAIMS:
        preferred = [c for c in PREFERRED_CLAIMS[persona] if c in ctx.supported and c not in off]
        data["preferred_claims"] = _claims(ctx, preferred, language, ordered=True)
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


def script_rewrite_prompt(base: str, problems: list[str]) -> str:
    return (
        base
        + "\n\nThe Verifier rejected the whole script for this audience, for these reasons. Draft "
        "your lines again so the script follows `rules`.\n" + _dump(problems)
    )


def _prompt_version() -> str:
    """Changes whenever any instruction changes; part of the breakdown cache key (SPEC 2)."""
    import hashlib

    texts = [CREW, DIRECTOR, ANALYST, TELESTRATOR, NARRATION_RULES, *PERSONAS.values(),
             *SPEAKERS.values(), *(" ".join(ids) for ids in PREFERRED_CLAIMS.values()),
             persona_rules.fingerprint()]  # fmt: skip
    return hashlib.sha256("\n".join(texts).encode()).hexdigest()[:12]


PROMPT_VERSION = _prompt_version()
