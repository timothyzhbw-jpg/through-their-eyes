"""Deterministic templates for every agent (SPEC 6 failure policy).

Used when no model is configured (offline), and as the fallback after a timeout, an error or an
invalid output. Templates only use verified claims, so their output always passes the Verifier.
"""

from __future__ import annotations

from agents import persona_rules
from agents.context import MomentContext
from agents.schemas import (
    BreakdownRequest,
    DraftLine,
    Findings,
    Language,
    Persona,
    Priority,
    ScriptLine,
    Speaker,
)

HEADLINE = {
    "scan": ["scan_before_reception", "belief_error", "cf_pass"],
    "space": ["pass_to_runner", "gap_to_marker", "unmarked"],
    "pressure": ["heavy_pressure", "cf_carry_lost", "pressure_at_pass"],
}
SUPPORTING = ["blind_side", "unmarked", "cf_value", "runner_received", "scans_before_reception",
              "gap_opened", "observed_share", "pass_to_runner", "presser_distance",
              "receiver_pressure", "pressure_at_pass"]  # fmt: skip

# Per persona: the lines in speaking order, (speaker, claim id, or None for the persona's own
# connective, `persona_rules.EXTRA_CONNECTIVES`). A tuple of ids is one line: the first of them
# that is supported. Each persona tells its own story (SPEC 6, "Persona specs"); `repair` then adds
# its opener and the coach's teaching cue, and keeps it within its rules:
# - casual: what he saw, what came of it, what he would have done without the look; no number;
# - analyst: how often he scanned, the space he saw, his belief error, the alternative with its
#   chance, the look's value; opens on a number;
# - player fan: his own look, his pass and its numbers, praise;
# - coach: when he looked against the ball, the cue that called for it, the run without the look
#   as the lesson, then what to teach;
# - audio description: told for listeners, in the order it happened: where, who he could not see,
#   which way he looked, whom he saw, what he did with it. No connectives, no xT or probabilities.
SEQUENCES: dict[Persona, list[tuple[Speaker, str | tuple[str, ...] | None]]] = {
    "casual": [("pbp", ("seen_in_scan", "scan_before_reception")),
               ("pbp", ("runner_received", "pass_to_runner", "scan_before_reception")),
               ("color", ("cf_pass", "blind_side", "unmarked"))],
    "analyst": [("pbp", "scans_before_reception"), ("color", "observed_share"),
                ("color", ("belief_error", "time_since_last_scan")),
                ("color", ("pass_success", "gap_opened")),
                ("color", ("cf_pass_success", "key_scan_duration")), ("color", "cf_value")],
    "player_fan": [("pbp", ("scan_side", "scan_before_reception")),
                   ("pbp", ("pass_to_runner", "scan_before_reception")),
                   ("color", ("pass_speed", "reception_zone")), ("color", None)],
    "coach": [("pbp", "time_since_last_scan"), ("color", ("blind_side", "scan_side")),
              ("color", ("cf_pass", "scan_side"))],
    "audio_description": [("pbp", "reception_zone"), ("color", "blind_side"),
                          ("pbp", ("scan_side", "scan_before_reception")),
                          ("color", "seen_in_scan"), ("pbp", ("pass_to_runner", "runner_received")),
                          ("color", "cf_pass")],
}  # fmt: skip
# The same for a moment the pressure lens explains (SPEC 5.2): the press, the escape, and what
# keeping the ball would have cost.
PRESSURE_SEQUENCES: dict[Persona, list[tuple[Speaker, str | tuple[str, ...] | None]]] = {
    "casual": [("pbp", ("heavy_pressure", "seen_in_scan")), ("pbp", "runner_received"),
               ("color", ("cf_carry_lost", "cf_pass"))],
    "analyst": [("pbp", "pressure_at_pass"), ("color", "presser_distance"),
                ("color", "pass_success"), ("color", "receiver_pressure"),
                ("color", ("cf_carry_lost", "cf_pass")), ("color", "cf_value")],
    "player_fan": [("pbp", ("heavy_pressure", "scan_side")), ("pbp", "pass_to_runner"),
                   ("color", "pass_speed"), ("color", None)],
    "coach": [("pbp", "presser_distance"), ("color", "time_since_last_scan"),
              ("color", ("cf_carry_lost", "cf_pass"))],
    # For listeners, in the order it happened: where, the press, who was closing, the escape, what
    # keeping the ball would have cost. No connectives, no xT or pressing percentages.
    "audio_description": [("pbp", "reception_zone"), ("color", ("heavy_pressure", "blind_side")),
                          ("color", "presser_distance"),
                          ("pbp", ("pass_to_runner", "runner_received")),
                          ("color", ("cf_carry_lost", "cf_pass"))],
}  # fmt: skip

# A marker's look (`marker_scan`, no decision on the ball): his man on his blind side, the look,
# whether he stayed with him, and the run without it.
MARKER_HEADLINE = ["marker_scan", "stayed_with_runner", "cf_lost_runner"]
MARKER_SUPPORTING = ["blind_side", "seen_in_scan", "marker_unseen", "runner_pressure",
                     "cf_unmarked", "cf_belief_error", "cf_value", "runner_received"]  # fmt: skip
MARKER_SEQUENCES: dict[Persona, list[tuple[Speaker, str | tuple[str, ...] | None]]] = {
    "casual": [("color", "blind_side"), ("pbp", "seen_in_scan"),
               ("color", ("cf_unmarked", "cf_lost_runner"))],
    "analyst": [("pbp", "marker_unseen"), ("pbp", "stayed_with_runner"),
                ("color", "runner_pressure"), ("color", "cf_belief_error"),
                ("color", "cf_lost_runner"), ("color", "cf_value")],
    "player_fan": [("pbp", ("scan_side", "marker_scan")), ("pbp", "stayed_with_runner"),
                   ("color", None)],
    "coach": [("pbp", "marker_scan"), ("color", "blind_side"),
              ("color", ("cf_lost_runner", "cf_unmarked"))],
    # For listeners, in the order it happened: his man out of sight, which way he looked, whom he
    # saw, where the ball went, how close he was, and the run without the look. No connectives,
    # no xT or pressing percentages.
    "audio_description": [("color", "blind_side"), ("pbp", ("scan_side", "marker_scan")),
                          ("color", "seen_in_scan"),
                          ("pbp", ("reception_zone", "runner_received")),
                          ("color", "stayed_with_runner"),
                          ("color", ("cf_lost_runner", "cf_unmarked"))],
}  # fmt: skip

# A placed shot (Module A, `far_post_finish`): the look at the goal, the keeper it showed him, the
# placement and its result, and the shot without the look.
SHOT_HEADLINE = ["keeper_seen_in_scan", "shot_placement", "cf_shot"]
SHOT_SUPPORTING = ["scan_at_goal", "keeper_near_side", "shot_scored", "shot_saved", "shot_wide",
                   "shot_thought_vs_was", "cf_keeper_age", "cf_shot_value",
                   "shot_speed"]  # fmt: skip
_RESULT = ("shot_scored", "shot_saved", "shot_wide")
SHOT_SEQUENCES: dict[Persona, list[tuple[Speaker, str | tuple[str, ...] | None]]] = {
    "casual": [("pbp", "keeper_seen_in_scan"), ("pbp", _RESULT), ("color", "cf_shot")],
    "analyst": [("pbp", "scans_before_reception"), ("color", "keeper_near_side"),
                ("color", "shot_thought_vs_was"), ("color", "cf_keeper_age"),
                ("color", "cf_shot_value")],
    "player_fan": [("pbp", ("scan_at_goal", "scan_side")), ("pbp", "shot_placement"),
                   ("color", "shot_speed"), ("pbp", _RESULT)],
    "coach": [("pbp", "scan_at_goal"), ("color", "keeper_near_side"), ("color", "cf_shot")],
    # For listeners, in the order it happened: where he got it, which way he looked, where the
    # keeper stood, where he put it, what came of it, and the shot without the look.
    "audio_description": [("pbp", "reception_zone"), ("pbp", ("scan_side", "scan_at_goal")),
                          ("color", "keeper_near_side"), ("pbp", "shot_placement"),
                          ("pbp", _RESULT), ("color", "cf_shot")],
}  # fmt: skip


def _placed_shot_moment(ctx: MomentContext) -> bool:
    action = ctx.card.anchors.get("action")
    if action is None:
        return False
    event = ctx.run.event(action)
    return event.type == "shot" and "placement" in event.attrs


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
    if ctx.card.kind == "marker_scan":
        headline = [c for c in MARKER_HEADLINE if c in supported]
        supporting = [c for c in MARKER_SUPPORTING if c in supported and c not in headline]
        angle = "One look over his shoulder kept him with his man; without it the runner is free."
        return Findings(moment=ctx.card.id, lens=lens, headline=headline, supporting=supporting,
                        angle=angle)  # fmt: skip
    if lens == "scan" and _placed_shot_moment(ctx):
        headline = [c for c in SHOT_HEADLINE if c in supported]
        supporting = [c for c in SHOT_SUPPORTING if c in supported and c not in headline]
        angle = "One look at the goal showed him where the keeper was; without it he shoots at him."
        return Findings(moment=ctx.card.id, lens=lens, headline=headline, supporting=supporting,
                        angle=angle)  # fmt: skip
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
    """Template lines in speaking order; only one speaker's lines when `speaker` is given.

    The sequence then goes through the persona rules' repair (agents/persona_rules.py): it opens
    with the persona's opener, ends with the coach's cue, and a moment whose claims the sequence
    did not foresee still gets a script that follows the rules.
    """
    pressure = ctx.card.selected_lens == "pressure"
    sequence = (PRESSURE_SEQUENCES if pressure else SEQUENCES)[persona]
    if ctx.card.kind == "marker_scan":
        sequence = MARKER_SEQUENCES[persona]
    elif not pressure and _placed_shot_moment(ctx):
        sequence = SHOT_SEQUENCES[persona]
    own = persona_rules.EXTRA_CONNECTIVES[persona][language]
    lines: list[ScriptLine] = []
    used: set[str] = set()
    for who, ids in sequence:
        if ids is None:
            if own:
                lines.append(ScriptLine(id=f"L{len(lines) + 1}", speaker=who, text=own[0],
                                        claims=[]))  # fmt: skip
            continue
        cid = next((c for c in (ids if isinstance(ids, tuple) else (ids,))
                    if c in ctx.supported and c not in used), None)  # fmt: skip
        if cid is not None:
            used.add(cid)
            text = ctx.claims[cid].template_for(language)
            lines.append(ScriptLine(id=f"L{len(lines) + 1}", speaker=who, text=text, claims=[cid]))
    lines, _, _ = persona_rules.repair(persona, lines, ctx.supported, ctx.card.selected_lens,
                                       language)  # fmt: skip
    return [
        (line.speaker, DraftLine(text=line.text, claims=line.claims))
        for line in lines
        if speaker is None or line.speaker == speaker
    ]
