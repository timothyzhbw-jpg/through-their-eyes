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
# A pressure story does not open on what he saw.
PRESSURE_CONNECTIVE: dict[Language, str] = {"en": "Watch this.", "zh": "注意看。"}

HEADLINE = {
    "scan": ["scan_before_reception", "belief_error", "cf_pass"],
    "space": ["pass_to_runner", "gap_to_marker", "unmarked"],
    "pressure": ["heavy_pressure", "cf_carry_lost", "pressure_at_pass"],
}
SUPPORTING = ["blind_side", "unmarked", "cf_value", "runner_received", "scans_before_reception",
              "gap_opened", "observed_share", "pass_to_runner", "presser_distance",
              "receiver_pressure", "pressure_at_pass"]  # fmt: skip

# Per persona: the lines in speaking order, (speaker, claim id or None for the connective).
SEQUENCES: dict[Persona, list[tuple[Speaker, str | None]]] = {
    "casual": [("pbp", None), ("pbp", "scan_before_reception"), ("color", "blind_side"),
               ("color", "cf_pass"), ("pbp", "runner_received")],
    "analyst": [("pbp", None), ("pbp", "scans_before_reception"), ("color", "observed_share"),
                ("color", "belief_error"), ("pbp", "pass_to_runner"), ("color", "cf_pass"),
                ("color", "cf_value")],
    "player_fan": [("pbp", None), ("pbp", "scan_before_reception"), ("color", "belief_error"),
                   ("color", "cf_pass"), ("pbp", "runner_received")],
    "coach": [("pbp", "scans_before_reception"), ("pbp", "time_since_last_scan"),
              ("color", "belief_error"), ("color", "cf_pass")],
}  # fmt: skip
# The same for a moment the pressure lens explains (SPEC 5.2): the press, the escape, and what
# keeping the ball would have cost.
PRESSURE_SEQUENCES: dict[Persona, list[tuple[Speaker, str | None]]] = {
    "casual": [("pbp", None), ("pbp", "heavy_pressure"), ("pbp", "runner_received"),
               ("color", "cf_carry_lost")],
    "analyst": [("pbp", None), ("pbp", "pressure_at_pass"), ("color", "presser_distance"),
                ("pbp", "pass_to_runner"), ("color", "receiver_pressure"),
                ("color", "cf_carry_lost"), ("color", "cf_value")],
    "player_fan": [("pbp", None), ("pbp", "heavy_pressure"), ("color", "presser_distance"),
                   ("pbp", "runner_received"), ("color", "cf_carry_lost")],
    "coach": [("pbp", "pressure_at_pass"), ("color", "presser_distance"),
              ("color", "cf_carry_lost"), ("color", "cf_value")],
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
    pressure = ctx.card.selected_lens == "pressure"
    sequence = (PRESSURE_SEQUENCES if pressure else SEQUENCES)[persona]
    connective = (PRESSURE_CONNECTIVE if pressure else CONNECTIVE)[language]
    out = []
    for who, cid in sequence:
        if speaker is not None and who != speaker:
            continue
        if cid is None:
            out.append((who, DraftLine(text=connective, claims=[])))
        elif cid in ctx.supported:
            out.append((who, DraftLine(text=ctx.claims[cid].template_for(language), claims=[cid])))
    return out
