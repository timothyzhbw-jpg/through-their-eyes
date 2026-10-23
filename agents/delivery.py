"""Delivery: how a line is spoken (SPEC 6, "Two voices", "Delivery tiers" and "Persona specs").

The tier comes from rules on the MomentCard, never from a model. Each line also has a role
(open, build, peak, why). Role and tier pick a speaking style the voice has, and prosody always
wraps the words. Each audience has its own delivery: the casual fan hears the broadcast booth,
the analyst a measured read, the coach a steady one with a pause after the coaching point, the
player fan a warmer, higher booth, and audio description (SPEC 1) a calm, slower read with pauses
at every clause and after every line, whatever the tier.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping
from typing import Any, Literal
from xml.sax.saxutils import escape, quoteattr

from agents import persona_rules
from agents.schemas import Language, Persona, ScriptLine, Speaker, Tier, VoiceCue
from explain.cards import MomentCard
from explain.lexicon import TERMS

# One voice per speaker and language. Nothing else names a voice: swap these four here.
VOICES: dict[tuple[Language, Speaker], str] = {
    ("en", "pbp"): "en-US-GuyNeural",
    ("en", "color"): "en-US-DavisNeural",
    ("zh", "pbp"): "zh-CN-YunjianNeural",
    ("zh", "color"): "zh-CN-YunyeNeural",
}
LOCALES: dict[Language, str] = {"en": "en-US", "zh": "zh-CN"}

# From the voices list of Azure Speech, region northcentralus, 2026-10-21
# (`python -m infra.voices` checks it).
VOICE_STYLES: dict[str, frozenset[str]] = {
    "en-US-GuyNeural": frozenset(
        {
            "angry",
            "cheerful",
            "excited",
            "friendly",
            "hopeful",
            "newscast",
            "sad",
            "shouting",
            "terrified",
            "unfriendly",
            "whispering",
        }
    ),
    "en-US-AriaNeural": frozenset(
        {
            "angry",
            "chat",
            "cheerful",
            "customerservice",
            "empathetic",
            "excited",
            "friendly",
            "hopeful",
            "narration-professional",
            "newscast-casual",
            "newscast-formal",
            "sad",
            "shouting",
            "terrified",
            "unfriendly",
            "whispering",
        }
    ),
    "en-US-DavisNeural": frozenset(
        {
            "angry",
            "chat",
            "cheerful",
            "excited",
            "friendly",
            "hopeful",
            "sad",
            "shouting",
            "terrified",
            "unfriendly",
            "whispering",
        }
    ),
    "en-US-JennyNeural": frozenset(
        {
            "angry",
            "assistant",
            "chat",
            "cheerful",
            "customerservice",
            "excited",
            "friendly",
            "hopeful",
            "newscast",
            "sad",
            "shouting",
            "terrified",
            "unfriendly",
            "whispering",
        }
    ),
    "en-GB-RyanNeural": frozenset({"chat", "cheerful"}),
    "en-GB-SoniaNeural": frozenset({"cheerful", "sad"}),
    "zh-CN-YunjianNeural": frozenset(
        {
            "angry",
            "cheerful",
            "depressed",
            "disgruntled",
            "documentary-narration",
            "narration-relaxed",
            "sad",
            "serious",
            "sports-commentary",
            "sports-commentary-excited",
        }
    ),
    "zh-CN-YunzeNeural": frozenset(
        {
            "angry",
            "calm",
            "cheerful",
            "depressed",
            "disgruntled",
            "documentary-narration",
            "fearful",
            "sad",
            "serious",
        }
    ),
    "zh-CN-YunyeNeural": frozenset(
        {
            "angry",
            "calm",
            "cheerful",
            "disgruntled",
            "embarrassed",
            "fearful",
            "sad",
            "serious",
        }
    ),
    "zh-CN-XiaoxiaoNeural": frozenset(
        {
            "affectionate",
            "angry",
            "assistant",
            "calm",
            "chat",
            "chat-casual",
            "cheerful",
            "customerservice",
            "disgruntled",
            "excited",
            "fearful",
            "friendly",
            "gentle",
            "lyrical",
            "newscast",
            "poetry-reading",
            "sad",
            "serious",
            "sorry",
            "whispering",
        }
    ),
    "zh-CN-YunyangNeural": frozenset(
        {
            "customerservice",
            "narration-professional",
            "newscast-casual",
        }
    ),
}

Role = Literal["open", "build", "peak", "why"]
# styles (best first), styledegree or none, rate, pitch. Peak on calm speaks like build.
# styledegree is applied only when the voice has one of the styles.
_Prosody = tuple[tuple[str, ...], str | None, str, str]
_OPEN: _Prosody = (("sports-commentary", "cheerful"), None, "+6%", "+3%")
_BUILD: _Prosody = (("sports-commentary-excited", "excited", "cheerful"), None, "+8%", "+3%")
_WHY: _Prosody = (("cheerful", "excited"), None, "+2%", "+2%")
_PEAK: dict[Tier, _Prosody] = {
    "calm": _BUILD,
    "excited": (("sports-commentary-excited", "excited", "cheerful"), "1.5", "+10%", "+4%"),
    "clutch": (("sports-commentary-excited", "excited", "cheerful"), "2", "+14%", "+6%"),
}
_AD_STYLES = ("narration-relaxed", "narration-professional", "calm", "newscast")
# The analyst's read: measured, the same at every tier; the numbers carry it.
_ANALYST: _Prosody = (("newscast", "documentary-narration", "serious"), None, "+0%", "+0%")
# The coach's: steady and a little slower, so the point lands.
_COACH: _Prosody = (("friendly", "narration-relaxed", "calm", "serious"), None, "-6%", "+0%")
# The player fan's: the booth, warmer and higher (pride in the player).
_FAN_STYLES = ("excited", "sports-commentary-excited", "cheerful", "hopeful")
_FAN_PITCH = 3  # percentage points over the booth's pitch

# Audio description (SPEC 1) is read calm and clear whatever the moment's tier: a calm style when
# the voice has one, never an excited one, and always a slower rate, so every name and place lands;
# a pause at every clause and after every line, so a listener can place each one.
DESCRIBED: frozenset[Persona] = frozenset({"audio_description"})
DESCRIBED_PROSODY = ("-15%", "+0%")  # (rate, pitch)
DESCRIBED_BREAKS = ("300ms", "600ms")  # (at each clause, after the line)
# A pause after the persona's opener ("Coaching point.", "Lovely from him."), so it stands alone.
OPENER_BREAK = "400ms"
# What each persona must not hear lives with the other persona rules; re-exported for callers.
ANALYST_NUMBERS = persona_rules.ANALYST_NUMBERS
withheld = persona_rules.withheld

# Emphasis on the decisive words, by speaker: (rate, pitch, volume). Not used for audio description.
_EMPHASIS: dict[Speaker, tuple[str, str, str]] = {
    "pbp": ("+0%", "+8%", "+15%"),
    "color": ("-10%", "+5%", "+10%"),
}
# Lexicon surface forms first, then the look and the shoulder check. The earliest start wins an
# overlap, and an earlier pattern wins a tie. Case-insensitive.
_EMPHASIS_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    pattern for term in TERMS.values() for pattern in term.patterns
) + (
    re.compile(r"\bthat look\b", re.IGNORECASE),
    re.compile(r"\bchecked his shoulder\b", re.IGNORECASE),
    re.compile(r"\blooked over his (?:left |right )?shoulder\b", re.IGNORECASE),
    re.compile(r"那一眼", re.IGNORECASE),
    re.compile(r"回头看了一眼", re.IGNORECASE),
)
_BREAK = "250ms"


# Tier rules on the selected lens's |delta| in xT, and the moment's tags.
CLUTCH_DELTA = 0.15
EXCITED_DELTA = 0.05
EXCITING_TAGS = {"line_breaking_pass"}


def delivery_tier(card: MomentCard) -> Tier:
    selected = card.lens(card.selected_lens) if card.selected_lens else None
    delta = abs(selected.delta_xt or 0.0) if selected is not None else 0.0
    if delta >= CLUTCH_DELTA:
        return "clutch"
    if delta >= EXCITED_DELTA or EXCITING_TAGS & set(card.tags):
        return "excited"
    return "calm"


def persona_tier(tier: Tier, persona: Persona | None) -> Tier:
    """The tier a persona's lines are spoken at: the moment's, or calm for audio description."""
    return "calm" if persona in DESCRIBED else tier


def _decision(moment: str) -> tuple[str, int] | None:
    """Player and frame of the moment's decision: the last two `:` fields of its id."""
    parts = moment.split(":")
    if len(parts) < 3:
        return None
    try:
        return parts[-2], int(parts[-1])
    except ValueError:
        return None


def _is_decision(event_id: str, actor: str, frame: int) -> bool:
    parts = event_id.split(":")
    if len(parts) < 2:
        return False
    try:
        return parts[-2] == actor and int(parts[-1]) == frame
    except ValueError:
        return False


def line_role(
    speaker: Speaker,
    claims: Iterable[str],
    evidence: Mapping[str, Iterable[str]],
    moment: str,
) -> Role:
    """`why` for color; `open` for play-by-play with no claim; `peak` when a cited claim's
    evidence includes the moment's decision event; otherwise `build`."""
    if speaker == "color":
        return "why"
    cited = list(claims)
    if not cited:
        return "open"
    decision = _decision(moment)
    if decision is not None and any(
        _is_decision(event, *decision) for cid in cited for event in evidence.get(cid, ())
    ):
        return "peak"
    return "build"


def _delivery(role: Role, tier: Tier, persona: Persona | None) -> _Prosody:
    if persona in DESCRIBED:
        return (_AD_STYLES, None, *DESCRIBED_PROSODY)
    if persona == "analyst":
        return _ANALYST
    if persona == "coach":
        return _COACH
    booth = _PEAK[tier] if role == "peak" else {"open": _OPEN, "build": _BUILD, "why": _WHY}[role]
    if persona == "player_fan":
        styles, degree, rate, pitch = booth
        return (_FAN_STYLES, degree, rate, f"{int(pitch.rstrip('%')) + _FAN_PITCH:+d}%")
    return booth


def pick_style(
    role: Role, tier: Tier, styles: Iterable[str], persona: Persona | None = None
) -> str | None:
    """The first preferred style this voice has, or None (prosody only)."""
    preferred = _delivery(role, tier, persona)[0]
    available = set(styles)
    return next((style for style in preferred if style in available), None)


def _emphasis_spans(text: str) -> list[tuple[int, int]]:
    found: list[tuple[int, int, int]] = []
    for index, pattern in enumerate(_EMPHASIS_PATTERNS):
        found.extend(
            (match.start(), index, match.end())
            for match in pattern.finditer(text)
            if match.start() < match.end()
        )
    spans: list[tuple[int, int]] = []
    last = 0
    for start, _, end in sorted(found):
        if start < last:
            continue
        spans.append((start, end))
        last = end
    return spans


def _break_at(text: str) -> int | None:
    """Index just after the first `, ` or `，`. The comma stays in the segment before the break."""
    found = [index + 1 for index in (text.find(", "), text.find("，")) if index != -1]
    return min(found) if found else None


def _clauses(text: str) -> list[int]:
    """Indices just after every clause mark inside the line (`, ; :` and their Chinese forms)."""
    return [m.end() for m in re.finditer(r"[,;:](?= )|[，；：、]", text) if m.end() < len(text)]


def _opener_end(text: str, persona: Persona | None, language: Language) -> int | None:
    """Index just after the persona's opener when the line starts with it."""
    for phrase in persona_rules.OPENERS.get(persona or "", {}).get(language, {}).values():
        if text.startswith(phrase) and len(text) > len(phrase):
            return len(phrase)
    return None


def _segments(
    text: str,
    speaker: Speaker,
    rate: str,
    pitch: str,
    *,
    emphasize: bool,
    counterfactual: bool,
    pauses: dict[int, str] | None = None,
) -> str:
    """Prosody spans in order. Emphasis replaces the line's prosody on its span; no nesting.
    `pauses`: more breaks, by the index they follow."""
    spans = _emphasis_spans(text) if emphasize else []
    break_at = _break_at(text) if counterfactual else None
    breaks = dict(pauses or {})
    if break_at is not None:
        breaks.setdefault(break_at, _BREAK)
    points = {0, len(text)} | set(breaks)
    for start, end in spans:
        points.add(start)
        points.add(end)
    ordered = sorted(points)
    parts: list[str] = []
    for index in range(len(ordered) - 1):
        start, end = ordered[index], ordered[index + 1]
        if start == end:
            continue
        chunk = escape(text[start:end])
        if any(span_start <= start < span_end for span_start, span_end in spans):
            er, ep, ev = _EMPHASIS[speaker]
            parts.append(f'<prosody rate="{er}" pitch="{ep}" volume="{ev}">{chunk}</prosody>')
        else:
            parts.append(f'<prosody rate="{rate}" pitch="{pitch}">{chunk}</prosody>')
        if end in breaks:
            parts.append(f'<break time="{breaks[end]}"/>')
    return "".join(parts)


def ssml_for_line(
    line: ScriptLine,
    language: Language,
    tier: Tier,
    styles: Iterable[str] | None = None,
    persona: Persona | None = None,
    *,
    role: Role | None = None,
    counterfactual: bool = False,
) -> str:
    """SSML for one rendered line.

    `styles` None means the styles `VOICE_STYLES` lists for this voice. `role` None means `why`
    for color, `build` for play-by-play that cites a claim, and `open` otherwise (not `peak`:
    that needs the moment). `counterfactual` inserts the reveal break.
    """
    voice = VOICES[(language, line.speaker)]
    if styles is None:
        styles = VOICE_STYLES.get(voice, frozenset())
    described = persona in DESCRIBED
    if role is None:
        role = "why" if line.speaker == "color" else "build" if line.claims else "open"
    preferred, degree, rate, pitch = _delivery(role, tier, persona)
    chosen = next((style for style in preferred if style in set(styles)), None)
    if described or not chosen:
        degree = None
    pauses: dict[int, str] = {}
    if described:
        pauses = dict.fromkeys(_clauses(line.text), DESCRIBED_BREAKS[0])
        pauses[len(line.text)] = DESCRIBED_BREAKS[1]
    elif (end := _opener_end(line.text, persona, language)) is not None:
        pauses[end] = OPENER_BREAK
    segments = _segments(
        line.text, line.speaker, rate, pitch,
        emphasize=not described, counterfactual=counterfactual and not described, pauses=pauses,
    )  # fmt: skip
    if chosen:
        extra = f' styledegree="{degree}"' if degree else ""
        body = f'<mstts:express-as style="{chosen}"{extra}>{segments}</mstts:express-as>'
    else:
        body = segments
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang={quoteattr(LOCALES[language])}>'
        f"<voice name={quoteattr(voice)}>{body}</voice></speak>"
    )


def cache_key(ssml: str) -> str:
    return hashlib.sha256(ssml.encode()).hexdigest()[:16]


def _field(obj: Any, name: str) -> Any:
    return obj[name] if isinstance(obj, dict) else getattr(obj, name)


def _maybe(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _available(voice: str, styles: Mapping[str, Iterable[str]] | None) -> set[str]:
    if styles is None:
        return set(VOICE_STYLES.get(voice, ()))
    return set(styles.get(voice, ()))


def voice_cues(
    persona: Persona,
    language: Language,
    tier: Tier,
    moment: str,
    lines: Iterable[Any],
    claims: Iterable[Any],
    times: Iterable[float],
    styles: Mapping[str, Iterable[str]] | None = None,
) -> list[VoiceCue]:
    """Voice cues for rendered lines. `styles` None means `VOICE_STYLES`; a map is per voice
    name, and a voice missing from it is prosody only."""
    evidence: dict[str, list[str]] = {}
    kinds: dict[str, Any] = {}
    for claim in claims:
        cid = _field(claim, "id")
        evidence[cid] = list(_maybe(claim, "evidence") or [])
        kinds[cid] = _maybe(claim, "kind")
    cues = []
    for line, t in zip(lines, times, strict=True):
        spoken = ScriptLine(
            id=_field(line, "id"), speaker=_field(line, "speaker"), text=_field(line, "text"),
            claims=list(_field(line, "claims") or []),
        )  # fmt: skip
        role = line_role(spoken.speaker, spoken.claims, evidence, moment)
        counterfactual = any(kinds.get(cid) == "counterfactual" for cid in spoken.claims)
        voice = VOICES[(language, spoken.speaker)]
        available = _available(voice, styles)
        ssml = ssml_for_line(
            spoken, language, tier, available, persona, role=role, counterfactual=counterfactual
        )
        cues.append(
            VoiceCue(
                line=spoken.id, speaker=spoken.speaker, t=t, voice=voice,
                style=pick_style(role, tier, available, persona), ssml=ssml,
                cache_key=cache_key(ssml),
            )
        )  # fmt: skip
    return cues


def revoice(result: dict[str, Any]) -> dict[str, Any]:
    """A copy of a breakdown JSON with voice cues re-derived from today's rules.

    A cache envelope `{source, result}` is re-voiced on the inner breakdown. A value with no
    scripts, or whose scripts have no voice cues, comes back unchanged. Pure: no I/O.
    """
    if not isinstance(result, dict):
        return result
    if "scripts" not in result and isinstance(result.get("result"), dict):
        inner = revoice(result["result"])
        return result if inner is result["result"] else {**result, "result": inner}
    scripts = result.get("scripts")
    if not scripts or not any(isinstance(s, dict) and s.get("voice") for s in scripts):
        return result
    tier = result["tier"]
    new_scripts = []
    changed = False
    for script in scripts:
        updated = _revoice_script(script, tier)
        changed = changed or updated is not script
        new_scripts.append(updated)
    return {**result, "scripts": new_scripts} if changed else result


def _revoice_script(script: Any, tier: Tier) -> Any:
    if not isinstance(script, dict) or not script.get("voice"):
        return script
    payload = script["payload"]
    by_id = {_field(line, "id"): line for line in payload["lines"]}
    lines, times = [], []
    for cue in script["voice"]:
        line = by_id[cue["line"]]
        lines.append({**line, "speaker": cue["speaker"]})
        times.append(cue["t"])
    cues = voice_cues(
        script["persona"], script["language"], tier, payload["moment"], lines, payload["claims"],
        times,
    )  # fmt: skip
    dumped = [cue.model_dump(mode="json", by_alias=True) for cue in cues]
    return script if dumped == script["voice"] else {**script, "voice": dumped}
