"""Deterministic templates for every agent (SPEC 6 failure policy).

Used when no model is configured (offline), and as the fallback after a timeout, an error or an
invalid output. Templates only use verified claims, so their output always passes the Verifier.
"""

from __future__ import annotations

from agents.context import MomentContext
from agents.schemas import (
    BreakdownRequest,
    DraftLine,
    Findings,
    Language,
    Persona,
    Priority,
    Speaker,
)

CONNECTIVE: dict[Language, str] = {"en": "What did he see?", "zh": "他看到了什么？"}

HEADLINE = {
    "scan": ["scan_before_reception", "belief_error", "cf_pass"],
    "space": ["pass_to_runner", "gap_to_marker", "unmarked"],
    "pressure": ["pressure_at_pass", "pass_to_runner"],
}
SUPPORTING = ["blind_side", "unmarked", "cf_value", "runner_received", "scans_before_reception",
              "gap_opened", "observed_share", "pass_to_runner"]  # fmt: skip

# Per persona: the lines in speaking order, (speaker, claim id or None for the connective). A tuple
# of ids is one line: the first of them that is supported.
SEQUENCES: dict[Persona, list[tuple[Speaker, str | tuple[str, ...] | None]]] = {
    "casual": [("pbp", None), ("pbp", "scan_before_reception"), ("color", "blind_side"),
               ("color", "cf_pass"), ("pbp", "runner_received")],
    "analyst": [("pbp", None), ("pbp", "scans_before_reception"), ("color", "observed_share"),
                ("color", "belief_error"), ("pbp", "pass_to_runner"), ("color", "cf_pass"),
                ("color", "cf_value")],
    "player_fan": [("pbp", None), ("pbp", "scan_before_reception"), ("color", "belief_error"),
                   ("color", "cf_pass"), ("pbp", "runner_received")],
    "coach": [("pbp", "scans_before_reception"), ("pbp", "time_since_last_scan"),
              ("color", "belief_error"), ("color", "cf_pass")],
    # Told for listeners, in the order it happened: where, who he could not see, which way he
    # looked, whom he saw, what he did with it. No connectives, no xT or probabilities.
    "audio_description": [("pbp", "reception_zone"), ("color", "blind_side"),
                          ("pbp", ("scan_side", "scan_before_reception")),
                          ("color", "seen_in_scan"), ("pbp", ("pass_to_runner", "runner_received")),
                          ("color", "cf_pass")],
}  # fmt: skip


def priority_for(ctx: MomentContext) -> Priority:
    lens = ctx.card.lens(ctx.card.selected_lens) if ctx.card.selected_lens else None
    delta = abs(lens.delta_xt or 0.0) if lens is not None else 0.0
    return "high" if delta >= 0.05 else "normal" if delta >= 0.01 else "low"


def director(
    ctx: MomentContext, personas: list[Persona], languages: list[Language]
) -> BreakdownRequest:
    return BreakdownRequest(
        moment=ctx.card.id,
        personas=list(personas),
        languages=list(languages),
        priority=priority_for(ctx),
        reason=f"Template: the {ctx.card.selected_lens} lens explains the moment best.",
    )


def analyst(ctx: MomentContext) -> Findings:
    lens = ctx.card.selected_lens or "scan"
    supported = ctx.supported
    headline = [c for c in HEADLINE[lens] if c in supported]
    supporting = [c for c in SUPPORTING if c in supported and c not in headline]
    angle = {
        "scan": "One look over the shoulder showed him the runner; without it he plays safe.",
        "space": "The run opened a space the pass could reach.",
        "pressure": "He moved the ball before the press arrived.",
    }[lens]
    return Findings(moment=ctx.card.id, lens=lens, headline=headline, supporting=supporting,
                    angle=angle)  # fmt: skip


def narration(
    ctx: MomentContext, persona: Persona, language: Language, speaker: Speaker | None = None
) -> list[tuple[Speaker, DraftLine]]:
    """Template lines in speaking order; only one speaker's lines when `speaker` is given."""
    out = []
    for who, ids in SEQUENCES[persona]:
        if speaker is not None and who != speaker:
            continue
        if ids is None:
            out.append((who, DraftLine(text=CONNECTIVE[language], claims=[])))
            continue
        cid = next((c for c in (ids if isinstance(ids, tuple) else (ids,)) if c in ctx.supported),
                   None)  # fmt: skip
        if cid is not None:
            out.append((who, DraftLine(text=ctx.claims[cid].template_for(language), claims=[cid])))
    return out
