"""The end-of-match recap (SPEC 6, recap): the production crew on a whole stitched match.

    uv run python -m agents.recap --seed 1 --offline     # templates only, no model calls
    uv run --env-file .env python -m agents.recap --seed 1 --mcp   # Foundry; Analyst on MCP

The breakdown's workflow graph (agents/workflow.py) with the steps told for a match (`RECAP`):
- Director: picks 3–5 key moments from the ranked candidates (agents/recap_context.py). The model
  may name only candidates (an enum); the template takes the largest counterfactual impacts. The
  reel plays them in match order, and from here on the crew works on those moments only.
- Analyst: picks the headline claims, the match stats read through our MCP tools (`--recap`);
  the recap card shows the stats it picked.
- Telestrator: the reel, one clip per key moment: its window around the moment, its speed and its
  opening camera. The camera director (web/src/director) cuts inside each clip.
- Narration: Commentator and Co-commentator as anchored lines, each a verified claim or an allowed
  connective; the templates are `RECAP_SEQUENCES` and `MOMENT_LINES`, a row per persona.
- Verifier: the breakdown's, unchanged; the payload's evidence is lifted to the match clock.
- Voice: SSML per line, every line placed on the reel's clock (a clip holds its last frame while
  its lines still run), and the overlay cue sheet: timed, machine-readable cues a broadcast
  graphics engine could render (score bug, clip, moment title, caption, stat). Every text in it
  is a verified line and every number a verified value; times and frames are the reel's own.

Prompts here have their own version (`RECAP_PROMPT_VERSION`): a breakdown's prompts and cache keys
do not move when a recap prompt changes.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, create_model, field_validator

from agents import prompts, telemetry
from agents.delivery import (
    CLUTCH_DELTA,
    DESCRIBED,
    EXCITED_DELTA,
    VOICE_STYLES,
    voice_cues,
    withheld,
)
from agents.llm import DEFAULT_TIMEOUT_S, client_from_env
from agents.recap_context import Candidate, RecapContext, impact_of
from agents.schemas import (
    DraftLine,
    Language,
    Persona,
    Priority,
    ScriptLine,
    ScriptResult,
    Speaker,
    StepTrace,
    Strict,
    Tier,
    _enum,
    no_numbers,
)
from agents.workflow import (
    BACK,
    STEPS,
    Analyst,
    Analyze,
    Briefing,
    Director,
    Job,
    Narration,
    Planned,
    Story,
    Telestrator,
    Verifier,
    Voice,
    compose,
    run_crew,
)
from explain.render import RenderPayload, build_payload
from explain.render import ScriptLine as RenderLine

MIN_MOMENTS, MAX_MOMENTS = 3, 5
NOTABLE_XT = 0.01  # the template picks a moment below this impact only to reach MIN_MOMENTS
Camera = Literal["broadcast", "tactical"]
LENS_CAMERA: dict[str | None, Camera] = {"space": "tactical"}  # otherwise broadcast
LEAD_S, TAIL_S, MAX_CLIP_S = 4.0, 2.0, 8.0  # a clip's window around the moment, in match time
INTRO_S, OUTRO_S = 3.0, 4.0  # the result before the clips, the stats after them
FIRST_LINE_S, LINE_GAP_S = 0.4, 0.3  # into a segment before its first line; between lines
TITLE_S = 3.0  # a moment's title stays this long
FPS = 25  # timecodes (SPEC 3: 25 Hz frames)

# Connectives a recap line may consist of; each passes `explain.lexicon.is_connective`.
RECAP_CONNECTIVES: dict[Language, tuple[str, ...]] = {
    "en": ("Let's go back.", "Here it is.", "Look again.", "Now watch."),
    "zh": ("倒回去看看。", "看这里。", "再看看。", "注意看。"),
}
CONNECTIVE: dict[Language, str] = {"en": "Let's go back.", "zh": "倒回去看看。"}  # the template's


# --- what the crew passes along and returns -----------------------------------------------------


class RecapRequest(Strict):
    match: str
    moments: list[str]  # the key moments, in match order
    personas: list[Persona]
    languages: list[Language]
    priority: Priority
    reason: str


class RecapFindings(Strict):
    match: str
    moments: list[str]
    headline: list[str]  # claim ids, most important first
    supporting: list[str]
    angle: str


class ReelClip(Strict):
    moment: str
    possession: int
    frame_in: int  # match frames, both inclusive
    frame_out: int
    speed: float = Field(ge=0.1, le=2.0)
    camera: Camera  # how the clip opens; the camera director cuts inside it


class RecapReel(Strict):
    match: str
    clips: list[ReelClip]


class Cue(Strict):
    """One timed overlay cue. `t` and `until` are seconds on the reel's clock, `tc` and `tc_out`
    the same as SMPTE timecode at `CueSheet.fps`. Text is a verified line; `data` holds
    structured fields: a verified claim's values, or the reel's own frames, speed and camera."""

    id: str
    type: Literal["score_bug", "clip", "moment_title", "caption", "stat"]
    t: float
    until: float
    tc: str
    tc_out: str
    moment: str | None = None
    line: str | None = None
    speaker: Speaker | None = None
    text: str | None = None
    claims: list[str] = Field(default_factory=list)
    data: dict[str, bool | int | float | str | None] = Field(default_factory=dict)


class CueSheet(Strict):
    version: Literal[1] = 1
    match: str
    persona: Persona
    language: Language
    fps: int = FPS
    duration_s: float
    cues: list[Cue]


class RecapMoment(Strict):
    id: str
    rank: int
    kind: str
    tags: list[str]
    actor: str
    receiver: str | None
    lens: str | None
    hero: bool  # it has a breakdown of its own
    possession: int
    anchor_frame: int


class RecapScript(ScriptResult):
    card: RenderPayload  # the recap card: the score, one sentence per key moment, the stats
    card_moments: dict[str, str | None]  # key moment -> its card line (None: nothing aired)
    cues: CueSheet


class RecapResult(Strict):
    request: RecapRequest
    findings: RecapFindings
    score: dict[str, int]  # the verified final_score claim's values
    moments: list[RecapMoment]
    stats: list[str]  # the match claims on the card
    reel: RecapReel
    reel_source: Literal["agent", "template"]
    reel_errors: list[str]
    tier: Tier
    scripts: list[RecapScript]
    trace: list[StepTrace]
    total_ms: float
    trace_id: str | None = None


# --- what the models may answer -----------------------------------------------------------------


def director_model(ids: list[str], at_least: int) -> type[BaseModel]:
    return create_model(
        "RecapDirectorChoice", __base__=Strict,
        moments=(list[_enum(ids)], Field(min_length=at_least, max_length=MAX_MOMENTS)),
        priority=(Priority, ...), reason=(str, Field(max_length=400)),
        __validators__={"reason_no_numbers": field_validator("reason")(no_numbers)},
    )  # fmt: skip


def analyst_model(ids: list[str]) -> type[BaseModel]:
    claim = _enum(ids)
    return create_model(
        "RecapAnalystChoice", __base__=Strict,
        headline=(list[claim], Field(min_length=1, max_length=3)),
        supporting=(list[claim], Field(max_length=6)), angle=(str, Field(max_length=400)),
        __validators__={"angle_no_numbers": field_validator("angle")(no_numbers)},
    )  # fmt: skip


def reel_model(moments: list[str]) -> type[BaseModel]:
    clip = create_model(
        "ClipDraft", __base__=Strict, moment=(_enum(moments), ...), camera=(Camera, ...),
        speed=(Literal[0.5, 1.0], ...),
    )  # fmt: skip
    n = len(moments)
    return create_model(
        "ReelDraft", __base__=Strict, clips=(list[clip], Field(min_length=n, max_length=n))
    )


def draft_model(ids: list[str], language: Language) -> type[BaseModel]:
    """Anchored lines (SPEC 6) with the recap's connectives: a claim id, a connective, or both."""
    line = create_model(
        "AnchoredLine", __base__=Strict, claim=(_enum(ids) | None, ...),
        connective=(_enum(RECAP_CONNECTIVES[language]) | None, ...),
    )  # fmt: skip
    return create_model("AnchoredDraft", __base__=Strict, lines=(list[line], Field(max_length=10)))


# --- instructions and prompts -------------------------------------------------------------------

CREW = (
    "You are part of an AI production crew that recaps a whole synthetic football match at full "
    "time, for studio, broadcast and streaming. Clubs and players are fictional: H8 is home "
    "number 8, A5 away number 5. The home team attacks towards +x. Our signature is perception: "
    "what a player saw before the ball arrived, and what he would have done without one look (a "
    "re-simulation inside the synthetic match). Reply with JSON that matches the requested "
    "schema, nothing else."
)

DIRECTOR = f"""ROLE: director
{CREW}
You are the Director of the recap. Pick the key moments for the recap reel from the candidates,
between {MIN_MOMENTS} and {MAX_MOMENTS} of them: the ones that changed the match most (a candidate's
`impact` is the counterfactual delta of its lens in expected threat), with a variety of lenses.
Name only candidate ids. Set the recap's priority (low, normal or high) and give a one-sentence
reason in plain words, with no digits or number words."""

ANALYST = f"""ROLE: analyst
{CREW}
You are the Analyst of the recap. If you have tools, read the match through them
(get_match_stats, list_key_moments, list_recap_claims). Choose claim ids from the claims list:
one to three headline claims and up to six supporting ones. The match stats you choose are shown
on the recap card next to the final score. Use only ids whose verdict is "supported"; never invent
an id. `angle` is one plain sentence about the match for the commentators, with no digits."""

TELESTRATOR = f"""ROLE: telestrator
{CREW}
You are the Telestrator of the recap reel. For each key moment, in the order given, choose how
its clip opens: the broadcast camera (the high side angle that follows the ball) or the tactical
board (from above, for space and shape), and its speed: 1.0, or 0.5 to slow one decisive moment.
Keep the reel short: at most one clip in slow motion. The camera director cuts inside each clip."""

RULES = (
    prompts.NARRATION_RULES
    + "\n- Tell the match in order: the result first, then the key moments in the order they"
    "\n  happened, then what the match stats say."
)

PERSONAS: dict[Persona, str] = {
    "casual": "Audience: casual fans. Plain words and few numbers: the result, then one claim "
    "per key moment, preferring claims without numeric slots. Up to eight lines.",
    "analyst": "Audience: analysts. Dense and precise: the result, for each key moment the claim "
    "that measures it, then the match stats. Up to twelve lines.",
    "player_fan": "Audience: fans of the players on the ball. Keep the focus on them: their "
    "looks, their picture of the pitch, their choices. Up to eight lines.",
    "coach": "Audience: coaches. Instructional: what the looks gave the players, and how often "
    "each side checked its shoulders. Up to ten lines.",
    "audio_description": "Audience: blind and low-vision viewers, who hear the recap instead of "
    "seeing it. The result, then each key moment in the order it happened: who had the ball and "
    "what he did with it. Leave out expected threat and probabilities. Calm and clear; no "
    "connectives. Up to ten lines.",
}

# Templates: the lines in speaking order, (speaker, item). An item is a match claim id, MOMENTS
# (every key moment in match order, told by MOMENT_LINES) or None (the connective).
MOMENTS = "<key moments>"
RECAP_SEQUENCES: dict[Persona, list[tuple[Speaker, str | None]]] = {
    "casual": [("pbp", "final_score"), ("color", None), ("pbp", MOMENTS)],
    "analyst": [("pbp", "final_score"), ("color", None), ("pbp", MOMENTS),
                ("color", "passes_home"), ("color", "passes_away"), ("color", "scans_home"),
                ("color", "scans_away")],
    "player_fan": [("pbp", "final_score"), ("color", None), ("pbp", MOMENTS),
                   ("color", "scans_home")],
    "coach": [("pbp", "final_score"), ("pbp", MOMENTS), ("color", "scans_home"),
              ("color", "scans_away"), ("color", "won_back_home"), ("color", "won_back_away")],
    "audio_description": [("pbp", "final_score"), ("pbp", MOMENTS), ("color", "passes_home"),
                          ("color", "passes_away")],
}  # fmt: skip
# How one key moment is told: (speaker, claim kinds best first); the first supported kind speaks.
# A shot is told by how it ended first (explain/recap.py `_shot_claim`).
SHOT = ("goal", "saved", "blocked", "wide")
MOMENT_LINES: dict[Persona, list[tuple[Speaker, tuple[str, ...]]]] = {
    "casual": [("pbp", (*SHOT, "seen_in_scan", "heavy_pressure", "bypassed", "runner_received",
                        "pass_to")),
               ("color", ("cf_pass", "cf_carry_lost"))],
    "analyst": [("pbp", (*SHOT, "scans_before_reception", "pressure_at_pass", "bypassed",
                         "pass_to_runner", "pass_to")),
                ("color", ("cf_value", "cf_pass", "cf_carry_lost"))],
    "player_fan": [("pbp", (*SHOT, "seen_in_scan", "heavy_pressure", "bypassed",
                            "pass_to_runner", "pass_to")),
                   ("color", ("cf_pass", "cf_carry_lost"))],
    "coach": [("pbp", (*SHOT, "scans_before_reception", "presser_distance", "bypassed",
                       "pass_to")),
              ("color", ("cf_pass", "cf_carry_lost"))],
    "audio_description": [("pbp", (*SHOT, "reception_zone", "bypassed", "pass_to_runner",
                                   "pass_to")),
                          ("color", ("seen_in_scan", "heavy_pressure", "cf_pass",
                                     "cf_carry_lost"))],
}  # fmt: skip


def narration_instructions(speaker: Speaker) -> str:
    return f"ROLE: {speaker}\n{CREW}\n{prompts.SPEAKERS[speaker]}\n{RULES}"


def _prompt_version() -> str:
    """Changes whenever a recap instruction or template changes; part of the recap cache key."""
    texts = [CREW, DIRECTOR, ANALYST, TELESTRATOR, RULES, *prompts.SPEAKERS.values(),
             *PERSONAS.values(), repr(RECAP_SEQUENCES), repr(MOMENT_LINES),
             repr(RECAP_CONNECTIVES)]  # fmt: skip
    return hashlib.sha256("\n".join(texts).encode()).hexdigest()[:12]


RECAP_PROMPT_VERSION = _prompt_version()


def _claim(rc: RecapContext, cid: str, language: Language) -> dict[str, Any]:
    c = rc.all_claims[cid]
    return {"id": cid, "kind": c.kind, "sentence": c.template_for(language)}


def director_prompt(rc: RecapContext, request: RecapRequest) -> str:
    return prompts._dump({
        "match": rc.match_id, "score": {"home": rc.score[0], "away": rc.score[1]},
        "candidates": [
            {"moment": c.id, "kind": c.kind, "tags": c.tags, "actor": c.actor, "lens": c.lens,
             "impact": round(impact_of(c), 4), "hero": c.hero, "possession": c.possession}
            for c in rc.candidates
        ],
        "template_choice": request.moments,
    })  # fmt: skip


def analyst_prompt(rc: RecapContext, request: RecapRequest) -> str:
    return prompts._dump({
        "request": request.model_dump(),
        "key_moments": [m.summary() for m in rc.moments],
        "claims": [{**_claim(rc, cid, "en"), "verdict": "supported"} for cid in rc.supported],
    })  # fmt: skip


def telestrator_prompt(rc: RecapContext, findings: RecapFindings, template: RecapReel) -> str:
    return prompts._dump({
        "findings": findings.model_dump(),
        "key_moments": [{"moment": m.id, "kind": m.kind, "lens": m.lens, "actor": m.actor}
                        for m in rc.moments],
        "example_reel": template.model_dump(),
    })  # fmt: skip


def narration_prompt(
    rc: RecapContext,
    findings: RecapFindings,
    persona: Persona,
    language: Language,
    speaker: Speaker,
    pbp_lines: list[ScriptLine] | None = None,
) -> str:
    supported = rc.supported

    def claims(ids) -> list[dict[str, Any]]:
        return [
            _claim(rc, c, language) for c in ids if c in supported and not withheld(persona, [c])
        ]

    data: dict[str, Any] = {
        "language": language,
        "persona": PERSONAS[persona],
        "angle": findings.angle,
        "result": claims(["final_score"]),
        "headline_claims": claims(findings.headline),
        "supporting_claims": claims(findings.supporting),
        "key_moments": [
            {"moment": m.id, "kind": m.kind, "lens": m.lens, "claims": claims(m.claims)}
            for m in rc.moments
        ],
        "match_stats": claims(rc.stats[1:]),
        "allowed_connectives": list(RECAP_CONNECTIVES[language]),
    }
    if pbp_lines:
        data["play_by_play_used"] = [
            {"claim": line.claims[0] if line.claims else None, "text": line.text}
            for line in pbp_lines
        ]
    return prompts._dump(data)


# --- templates ----------------------------------------------------------------------------------


def template_request(
    rc: RecapContext, personas: tuple[Persona, ...], languages: tuple[Language, ...]
) -> RecapRequest:
    n_min = min(MIN_MOMENTS, len(rc.candidates))
    notable = sum(impact_of(c) >= NOTABLE_XT for c in rc.candidates)
    picked = rc.candidates[: max(n_min, min(MAX_MOMENTS, notable))]
    top = max((impact_of(c) for c in picked), default=0.0)
    return RecapRequest(
        match=rc.match_id, moments=in_match_order(rc, [c.id for c in picked]),
        personas=list(personas), languages=list(languages),
        priority="high" if top >= 0.05 else "normal" if top >= NOTABLE_XT else "low",
        reason="Template: the moments with the largest counterfactual impact.",
    )  # fmt: skip


def in_match_order(rc: RecapContext, moments: list[str]) -> list[str]:
    return [c.id for c in sorted((rc.candidate(m) for m in moments),
                                 key=lambda c: (c.anchor_frame, c.id))]  # fmt: skip


def template_findings(rc: RecapContext, request: RecapRequest) -> RecapFindings:
    top = min(rc.moments, key=lambda c: c.rank, default=None)
    headline = ["final_score"] + ([top.claims[0]] if top is not None else [])
    return RecapFindings(
        match=rc.match_id, moments=request.moments, headline=headline,
        supporting=[c for c in rc.stats if c not in headline][:6],
        angle="The match told through the moments that changed it most.",
    )  # fmt: skip


def moment_claim(rc: RecapContext, m: Candidate, kinds: tuple[str, ...], persona: Persona,
                 used: set[str] = frozenset()) -> str | None:  # fmt: skip
    """The first of `kinds` that `m` has supported, the persona may hear and was not used yet."""
    supported = rc.supported
    for kind in kinds:
        cid = f"{m.prefix}.{kind}"
        if cid in supported and cid not in used and not withheld(persona, [cid]):
            return cid
    return None


def narration(
    rc: RecapContext, persona: Persona, language: Language, speaker: Speaker | None = None
) -> list[tuple[Speaker, DraftLine]]:
    """Template lines in speaking order; only one speaker's lines when `speaker` is given."""
    supported = rc.supported
    out: list[tuple[Speaker, DraftLine]] = []
    used: set[str] = set()

    def say(who: Speaker, cid: str | None) -> None:
        if cid is None or cid not in supported or cid in used or withheld(persona, [cid]):
            return
        used.add(cid)
        out.append((who, DraftLine(text=rc.claims[cid].template_for(language), claims=[cid])))

    for who, item in RECAP_SEQUENCES[persona]:
        if item is None:
            out.append((who, DraftLine(text=CONNECTIVE[language], claims=[])))
        elif item == MOMENTS:
            for m in rc.moments:
                for line_speaker, kinds in MOMENT_LINES[persona]:
                    say(line_speaker, moment_claim(rc, m, kinds, persona, used))
        else:
            say(who, item)
    return [(who, line) for who, line in out if speaker is None or who == speaker]


def story_order(rc: RecapContext, lines: list[ScriptLine]) -> list[ScriptLine]:
    """The two voices' lines in the recap's order: the result, then each key moment in match
    order (play-by-play before co-commentator), then the stats. The voices interleave line by
    line, which pairs lines of different moments when only one voice tells a moment. A
    connective goes with the line after it. Ids are numbered again in the new order."""
    order = {m.id: k for k, m in enumerate(rc.moments, start=1)}

    def group(line: ScriptLine) -> int | None:
        if not line.claims:
            return None
        m = rc.moment_of(line.claims[0])
        if m is not None:
            return order.get(m.id, len(order) + 1)
        return 0 if line.claims[0] == "final_score" else len(order) + 1

    groups: list[int] = []
    for line in reversed(lines):  # a connective takes the group of the line after it
        g = group(line)
        groups.append(g if g is not None else (groups[-1] if groups else len(order) + 1))
    groups.reverse()
    rank = {"pbp": 1, "color": 2}
    keyed = sorted(
        range(len(lines)),
        key=lambda i: (groups[i], 0 if not lines[i].claims else rank[lines[i].speaker], i),
    )
    return [lines[i].model_copy(update={"id": f"L{n}"}) for n, i in enumerate(keyed, start=1)]


def card_stats(rc: RecapContext, findings: RecapFindings) -> list[str]:
    """The match stats on the card: the ones the Analyst picked, else all of them."""
    picked = [c for c in dict.fromkeys(findings.headline + findings.supporting)
              if c in rc.stats and c != "final_score"]  # fmt: skip
    return picked or rc.stats[1:]


def card(
    rc: RecapContext, findings: RecapFindings, persona: Persona, language: Language
) -> tuple[RenderPayload, dict[str, str | None]]:
    """The recap card as a render payload: the score, one sentence per key moment, the stats."""
    lines = [RenderLine(id="S", text=rc.claims["final_score"].template_for(language),
                        claims=["final_score"])]  # fmt: skip
    wanted: dict[str, str] = {}
    first = MOMENT_LINES[persona][0][1] + MOMENT_LINES[persona][1][1]
    for i, m in enumerate(rc.moments, start=1):
        cid = moment_claim(rc, m, first, persona) or next(
            (c for c in m.claims if not withheld(persona, [c])), None
        )
        if cid is not None:
            wanted[m.id] = f"K{i}"
            lines.append(RenderLine(id=f"K{i}", text=rc.claims[cid].template_for(language),
                                    claims=[cid]))  # fmt: skip
    for j, cid in enumerate(card_stats(rc, findings), start=1):
        lines.append(RenderLine(id=f"T{j}", text=rc.claims[cid].template_for(language),
                                claims=[cid]))  # fmt: skip
    built = build_payload(rc.card.id, persona, language, lines, rc.claims, rc.verdicts, rc.names)
    aired = {line.id for line in built.payload.lines}
    moments = {m.id: (wanted[m.id] if wanted.get(m.id) in aired else None) for m in rc.moments}
    return rc.lift(built.payload), moments


def clip_window(rc: RecapContext, m: Candidate) -> tuple[int, int]:
    """Match frames around the moment: from LEAD_S before its key instant to TAIL_S after it (or
    its end), inside its possession, at most MAX_CLIP_S long."""
    lead, tail, cap = (round(s / rc.dt) for s in (LEAD_S, TAIL_S, MAX_CLIP_S))
    lo = max(m.start, m.anchor_frame - lead)
    hi = min(m.end - 1, max(m.frame_end, m.anchor_frame + tail), lo + cap)
    return lo, hi


def template_reel(rc: RecapContext) -> RecapReel:
    clips = []
    for m in rc.moments:
        lo, hi = clip_window(rc, m)
        clips.append(ReelClip(moment=m.id, possession=m.possession, frame_in=lo, frame_out=hi,
                              speed=1.0, camera=LENS_CAMERA.get(m.lens, "broadcast")))  # fmt: skip
    return RecapReel(match=rc.match_id, clips=clips)


def reel_errors(draft: Any, request: RecapRequest) -> list[str]:
    """Why the model's reel cannot be played, as public reason codes (no model text)."""
    errors = []
    if [c.moment for c in draft.clips] != request.moments:
        errors.append("clips: not_the_key_moments_in_order")
    if sum(c.speed < 1.0 for c in draft.clips) > 1:
        errors.append("clips (speed): more_than_one_slow_clip")
    return errors


def recap_tier(rc: RecapContext) -> Tier:
    """Delivery from rules on the key moments (SPEC 6), never from a model."""
    top = max((impact_of(m) for m in rc.moments), default=0.0)
    if top >= CLUTCH_DELTA:
        return "clutch"
    if top >= EXCITED_DELTA or any("goal" in m.tags for m in rc.moments):
        return "excited"
    return "calm"


# --- the reel's clock and the cue sheet ---------------------------------------------------------


def line_seconds(text: str, language: Language) -> float:
    """How long a line takes to say, roughly: words for English, characters for Chinese."""
    n = len(text) / 4.5 if language == "zh" else len(text.split()) / 2.7
    return round(0.6 + n, 2)


def timecode(t: float, fps: int = FPS) -> str:
    frames = round(t * fps)
    s, ff = divmod(frames, fps)
    m, ss = divmod(s, 60)
    h, mm = divmod(m, 60)
    return f"{h:02d}:{mm:02d}:{ss:02d}:{ff:02d}"


def _groups(rc: RecapContext, reel: RecapReel, lines: list) -> dict[str, list]:
    """Each payload line's place on the reel: "intro", a key moment's clip, or "outro". A line
    without claims (a connective) goes with the line after it."""
    clips = {c.moment for c in reel.clips}
    out: dict[str, list] = {"intro": [], **{c.moment: [] for c in reel.clips}, "outro": []}
    pending, seen_clip = [], False
    for line in lines:
        if not line.claims:
            pending.append(line)
            continue
        m = rc.moment_of(line.claims[0])
        if m is not None and m.id in clips:
            group, seen_clip = m.id, True
        else:
            group = "outro" if seen_clip else "intro"
        out[group] += pending + [line]
        pending = []
    out["outro"] += pending
    return out


def cue_sheet(
    rc: RecapContext,
    reel: RecapReel,
    payload: RenderPayload,
    card_payload: RenderPayload,
    card_moments: dict[str, str | None],
    speakers: dict[str, Speaker],
    persona: Persona,
    language: Language,
) -> tuple[CueSheet, dict[str, float]]:
    """The timed cues of one script, and when each of its lines starts (s on the reel)."""
    groups = _groups(rc, reel, payload.lines)
    card_lines = {line.id: line for line in card_payload.lines}
    values = {c.id: c.values for c in card_payload.claims}
    cues: list[Cue] = []
    starts: dict[str, float] = {}

    def cue(type_: str, t: float, until: float, **fields: Any) -> None:
        t, until = round(t, 2), round(until, 2)
        cues.append(Cue(id=f"q{len(cues) + 1}", type=type_, t=t, until=until, tc=timecode(t),
                        tc_out=timecode(until), **fields))  # fmt: skip

    def place(lines: list, t0: float, minimum: float) -> float:
        """Lines one after another from t0; returns the segment's length."""
        t = t0 + FIRST_LINE_S
        timed = []
        for line in lines:
            starts[line.id] = round(t, 2)
            timed.append((line, t))
            t += line_seconds(line.text, language) + LINE_GAP_S
        length = max(minimum, t - t0)
        for k, (line, start) in enumerate(timed):
            until = timed[k + 1][1] if k + 1 < len(timed) else t0 + length
            cue("caption", start, until, line=line.id, speaker=speakers.get(line.id),
                text=line.text, claims=list(line.claims))  # fmt: skip
        return length

    t = place(groups["intro"], 0.0, INTRO_S)
    for clip in reel.clips:
        m = rc.candidate(clip.moment)
        clip_s = (clip.frame_out - clip.frame_in + 1) * rc.dt / clip.speed
        length = place(groups[clip.moment], t, clip_s)
        cue("clip", t, t + length, moment=clip.moment, data={
            "possession": clip.possession, "match_frame_in": clip.frame_in,
            "match_frame_out": clip.frame_out, "speed": clip.speed, "camera": clip.camera,
            "hold_s": round(length - clip_s, 2),
        })  # fmt: skip
        title = card_lines.get(card_moments.get(clip.moment) or "")
        cue("moment_title", t, t + min(TITLE_S, length), moment=clip.moment,
            text=title.text if title else None, claims=list(title.claims) if title else [],
            data={"kind": m.kind, "actor": m.actor, "receiver": m.receiver, "lens": m.lens,
                  "rank": m.rank})  # fmt: skip
        t += length
    stats = [line for line in card_payload.lines if line.id.startswith("T")]
    outro = place(groups["outro"], t, max(OUTRO_S, len(stats) * 1.5))
    for k, line in enumerate(stats):
        start = t + k * outro / max(1, len(stats))
        cue("stat", start, t + outro, line=line.id, text=line.text, claims=list(line.claims),
            data=dict(values.get(line.claims[0], {})))  # fmt: skip
    duration = round(t + outro, 2)
    score = values.get("final_score", {})
    cues.insert(0, Cue(id="q0", type="score_bug", t=0.0, until=duration, tc=timecode(0.0),
                       tc_out=timecode(duration), claims=["final_score"],
                       text=card_lines["S"].text if "S" in card_lines else None,
                       data={"home": score.get("home"), "away": score.get("away"),
                             "state": "full_time"}))  # fmt: skip
    order = {c.id: k for k, c in enumerate(cues)}  # same start: the score bug, then as made
    cues.sort(key=lambda c: (c.t, c.id != "q0", order[c.id]))
    cues = [c.model_copy(update={"id": f"q{k + 1}"}) for k, c in enumerate(cues)]
    sheet = CueSheet(match=rc.match_id, persona=persona, language=language, duration_s=duration,
                     cues=cues)  # fmt: skip
    return sheet, starts


# --- the steps ----------------------------------------------------------------------------------


class RecapDirector(Director):
    def __init__(self, crew) -> None:
        super().__init__(crew)
        self.whole: RecapContext = crew.ctx  # every candidate; after it picks, the crew's focus

    async def _direct(self, job: Job, ctx, resumed: bool = False) -> None:
        crew, rc = self.crew, self.whole
        with crew.step("director", resumed=resumed or None) as span:
            request = template_request(rc, job.personas, job.languages)
            attempt, notes, used = None, [BACK] if resumed else [], False
            if crew.uses_model("director"):
                at_least = min(MIN_MOMENTS, len(rc.candidates))
                attempt = await crew.ask(
                    "director", DIRECTOR, director_prompt(rc, request),
                    director_model([c.id for c in rc.candidates], at_least),
                )  # fmt: skip
                if attempt.value is not None:
                    picked = list(dict.fromkeys(attempt.value.moments))
                    if len(picked) >= at_least:
                        request = request.model_copy(update={
                            "moments": in_match_order(rc, picked),
                            "priority": attempt.value.priority, "reason": attempt.value.reason,
                        })  # fmt: skip
                        used = True
                    else:
                        notes.append("too few key moments: template moments")
            crew.record("director", attempt, notes, used, span)
        crew.ctx = rc.focused(request.moments)
        await ctx.send_message(Analyze(request))
        await self.wait_if_down([attempt], ctx)


class RecapAnalyst(Analyst):
    async def _analyze(self, msg: Analyze, ctx, resumed: bool = False) -> None:
        crew, rc = self.crew, self.crew.ctx
        with crew.step("analyst", resumed=resumed or None) as span:
            findings = template_findings(rc, msg.request)
            attempt, notes, used = None, [BACK] if resumed else [], False
            if crew.mcp_error:
                notes.append(f"MCP tools unavailable ({telemetry.error_class(crew.mcp_error)})")
            if crew.uses_model("analyst"):
                supported = rc.supported
                attempt = await crew.ask(
                    "analyst", ANALYST, analyst_prompt(rc, msg.request),
                    analyst_model(list(supported)), tools=crew.analyst_tools,
                )  # fmt: skip
                if attempt.tools_called:
                    notes.append(f"MCP tools called: {', '.join(attempt.tools_called)}")
                    telemetry.annotate(span, tools_called=attempt.tools_called)
                if attempt.value is not None:
                    v = attempt.value
                    headline = [c for c in dict.fromkeys(v.headline) if c in supported]
                    if headline:
                        findings = RecapFindings(
                            match=rc.match_id, moments=msg.request.moments, headline=headline,
                            supporting=[c for c in dict.fromkeys(v.supporting)
                                        if c in supported and c not in headline],
                            angle=v.angle,
                        )  # fmt: skip
                        used = True
                    else:
                        notes.append("no usable headline: template findings")
            crew.record("analyst", attempt, notes, used, span)
        await ctx.send_message(Briefing(msg.request, findings, rev=self.sent))
        self.sent += 1
        await self.wait_if_down([attempt], ctx)


class RecapTelestrator(Telestrator):
    async def _plan(self, msg: Briefing, ctx, resumed: bool = False) -> None:
        crew, rc = self.crew, self.crew.ctx
        with crew.step("telestrator", resumed=resumed or None) as span:
            template = template_reel(rc)
            reel, source, errors, attempt, used = template, "template", [], None, False
            if crew.uses_model("telestrator"):
                attempt = await crew.ask(
                    "telestrator", TELESTRATOR, telestrator_prompt(rc, msg.findings, template),
                    reel_model(msg.request.moments),
                )  # fmt: skip
                if attempt.value is not None:
                    used = True
                    errors = reel_errors(attempt.value, msg.request)
                    if not errors:
                        by_moment = {c.moment: c for c in template.clips}
                        reel = RecapReel(match=rc.match_id, clips=[
                            by_moment[c.moment].model_copy(
                                update={"camera": c.camera, "speed": c.speed})
                            for c in attempt.value.clips
                        ])  # fmt: skip
                        source = "agent"
            notes = [BACK] if resumed else []
            notes += [f"invalid reel, template used: {e}" for e in errors]
            crew.record("telestrator", attempt, notes, used, span)
        await ctx.send_message(Planned(reel, source, errors, rev=msg.rev))
        await self.wait_if_down([attempt], ctx)


class RecapNarration(Narration):
    def instructions(self, speaker: Speaker) -> str:
        return narration_instructions(speaker)

    def prompt(self, findings, persona, language, speaker, pbp=None) -> str:
        return narration_prompt(self.crew.ctx, findings, persona, language, speaker, pbp)

    def schema(self, language: Language) -> type[BaseModel]:
        return draft_model(list(self.crew.ctx.supported), language)

    def to_lines(self, value: Any, language: Language) -> list[DraftLine]:
        return compose(self.crew.ctx, value, language)

    def template(self, persona, language, speaker=None):
        return narration(self.crew.ctx, persona, language, speaker)

    async def _script(self, base, key):
        lines, attempts = await super()._script(base, key)
        return story_order(self.crew.ctx, lines), attempts


class RecapVerifier(Verifier):
    def payload(self, persona, language, kept):
        return self.crew.ctx.lift(super().payload(persona, language, kept))


class RecapVoice(Voice):
    def _speak(self, planned: Planned, msg) -> RecapResult:
        crew, rc = self.crew, self.crew.ctx
        reel: RecapReel = planned.plan
        findings: RecapFindings = msg.base.findings
        tier = recap_tier(rc)
        # Tests pass a style map. Production leaves it empty and `voice_cues` uses VOICE_STYLES.
        given = crew.voice_styles or None
        scripts = []
        for script in msg.scripts:
            persona, language = script.persona, script.language
            speakers = {line.id: line.speaker for line in script.lines}
            card_payload, card_moments = card(rc, findings, persona, language)
            sheet, starts = cue_sheet(rc, reel, script.payload, card_payload, card_moments,
                                      speakers, persona, language)  # fmt: skip
            lines = [
                {"id": line.id, "text": line.text, "claims": list(line.claims),
                 "speaker": speakers[line.id]}
                for line in script.payload.lines
            ]  # fmt: skip
            # No one moment's decision to peak on: the recap tells several (`moment` empty).
            cues = voice_cues(
                persona, language, tier, "", lines, script.payload.claims,
                [starts[line.id] for line in script.payload.lines], given,
            )  # fmt: skip
            scripts.append(RecapScript(
                persona=persona, language=language, lines=script.lines, payload=script.payload,
                dropped=script.dropped, rewrites=script.rewrites, voice=cues, card=card_payload,
                card_moments=card_moments, cues=sheet,
            ))  # fmt: skip
        unknown = given is None and any(
            cue.voice not in VOICE_STYLES for script in scripts for cue in script.voice
        )
        notes = [f"tier {tier}"] + (["voice styles unknown: prosody only"] if unknown else [])
        notes += [f"{p}: calm and slower" for p in sorted({s.persona for s in scripts} & DESCRIBED)]
        crew.put(StepTrace(step="voice", source="code", attempts=1, ms=0.0, error=None,
                           notes=notes))  # fmt: skip
        score = rc.all_claims["final_score"].slots
        return RecapResult(
            request=msg.base.request, findings=findings,
            score={"home": int(score["home"].value), "away": int(score["away"].value)},
            moments=[RecapMoment(id=m.id, rank=m.rank, kind=m.kind, tags=m.tags, actor=m.actor,
                                 receiver=m.receiver, lens=m.lens, hero=m.hero,
                                 possession=m.possession, anchor_frame=m.anchor_frame)
                     for m in rc.moments],
            stats=card_stats(rc, findings), reel=reel, reel_source=planned.plan_source,
            reel_errors=planned.plan_errors, tier=tier, scripts=scripts,
            trace=sorted(crew.trace, key=lambda s: STEPS.index(s.step)), total_ms=0.0,
        )  # fmt: skip


RECAP = Story("recap", RecapDirector, RecapAnalyst, RecapTelestrator, RecapNarration,
              RecapVerifier, RecapVoice)  # fmt: skip


async def run_recap(
    rc: RecapContext,
    client: Any | None = None,
    personas: tuple[Persona, ...] = ("casual", "analyst"),
    languages: tuple[Language, ...] = ("en", "zh"),
    step_timeout_s: float = DEFAULT_TIMEOUT_S,
    use_mcp: bool = False,
    voice_styles: dict[str, set[str]] | None = None,
    down: tuple[str, ...] = (),
) -> RecapResult:
    """The recap of the match: the crew's workflow with the recap's steps. `down`: agent steps
    taken down for this run, as in the failure drill (no model call for them)."""
    run = await run_crew(rc, client=client, personas=personas, languages=languages,
                         step_timeout_s=step_timeout_s, use_mcp=use_mcp,
                         voice_styles=voice_styles, down=down, story=RECAP)  # fmt: skip
    return run.result


# --- command line -------------------------------------------------------------------------------

OUT = Path("out")


async def main_async(args: argparse.Namespace) -> Path:
    rc = RecapContext.for_match(args.seed)
    OUT.mkdir(exist_ok=True)
    if args.mcp:
        path = OUT / f"recap_evidence_match{args.seed}.json"
        path.write_text(prompts._dump(rc.evidence()))
        rc.evidence_path = str(path)
    client, close = (None, None) if args.offline else client_from_env()
    try:
        result = await run_recap(
            rc, client=client, personas=tuple(args.personas.split(",")),
            languages=tuple(args.languages.split(",")), step_timeout_s=args.timeout,
            use_mcp=args.mcp, down=tuple(d for d in args.down.split(",") if d),
        )  # fmt: skip
    finally:
        if close is not None:
            await close()
    path = OUT / f"recap_match{args.seed}.json"
    path.write_text(result.model_dump_json(by_alias=True, indent=1))
    home, away = result.score["home"], result.score["away"]
    took = result.total_ms / 1000
    print(f"{rc.match_id} · {home}-{away} · {len(result.moments)} key moments · "
          f"tier {result.tier} · reel from {result.reel_source} · {took:.1f} s")  # fmt: skip
    for step in result.trace:
        error = f" · {step.error}" if step.error else ""
        print(
            f"  {step.step:<12} {step.source:<9} attempts {step.attempts} {step.ms:>7.0f} ms{error}"
        )
    for script in result.scripts:
        print(f"\n[{script.persona} · {script.language}] {script.cues.duration_s:.1f} s, "
              f"rewrites {script.rewrites}, dropped {len(script.dropped)}")  # fmt: skip
        for line in script.payload.lines:
            print(f"  {line.text}")
    print(f"\nwrote {path}")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the agent crew on a whole stitched match.")
    parser.add_argument("--seed", type=int, default=1, help="the stitched match's seed")
    parser.add_argument("--personas", default="casual,analyst")
    parser.add_argument("--languages", default="en,zh")
    parser.add_argument("--timeout", type=float, default=8.0, help="seconds per agent step")
    parser.add_argument("--offline", action="store_true", help="templates only, no model calls")
    parser.add_argument("--mcp", action="store_true", help="the Analyst uses the MCP tool server")
    parser.add_argument("--down", default="", help="agent steps to take down, e.g. narration")
    asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    main()
