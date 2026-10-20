"""Delivery: how a line is spoken (SPEC 6, "Two voices" and "Delivery tiers").

The tier comes from rules on the MomentCard, never from a model. A tier becomes an SSML speaking
style only when the voice supports it (Azure Speech lists each voice's styles); otherwise it becomes
prosody, which every voice accepts.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from xml.sax.saxutils import escape, quoteattr

from agents.schemas import Language, ScriptLine, Speaker, Tier
from explain.cards import MomentCard

# One voice per speaker and language. Styles are not assumed: see `ssml_for_line`.
VOICES: dict[tuple[Language, Speaker], str] = {
    ("en", "pbp"): "en-US-DavisNeural",
    ("en", "color"): "en-US-JennyNeural",
    ("zh", "pbp"): "zh-CN-YunjianNeural",
    ("zh", "color"): "zh-CN-XiaoxiaoNeural",
}
LOCALES: dict[Language, str] = {"en": "en-US", "zh": "zh-CN"}

# Speaking styles to try for a tier, best first; the first one the voice has is used.
STYLE_PREFERENCE: dict[Tier, tuple[str, ...]] = {
    "calm": ("narration-relaxed", "calm", "newscast", "chat"),
    "excited": ("sports_commentary", "excited", "cheerful"),
    "clutch": ("sports_commentary_excited", "excited", "shouting"),
}
PROSODY: dict[Tier, tuple[str, str]] = {  # (rate, pitch) when no style fits
    "calm": ("+0%", "+0%"),
    "excited": ("+8%", "+5%"),
    "clutch": ("+15%", "+10%"),
}

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


def pick_style(tier: Tier, styles: Iterable[str]) -> str | None:
    available = set(styles)
    return next((s for s in STYLE_PREFERENCE[tier] if s in available), None)


def ssml_for_line(
    line: ScriptLine, language: Language, tier: Tier, styles: Iterable[str] = ()
) -> str:
    """SSML for one rendered line. `styles`: the speaking styles this voice supports."""
    voice = VOICES[(language, line.speaker)]
    style = pick_style(tier, styles)
    text = escape(line.text)
    if style:
        body = f'<mstts:express-as style="{style}">{text}</mstts:express-as>'
    else:
        rate, pitch = PROSODY[tier]
        body = f'<prosody rate="{rate}" pitch="{pitch}">{text}</prosody>'
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang={quoteattr(LOCALES[language])}>'
        f"<voice name={quoteattr(voice)}>{body}</voice></speak>"
    )


def cache_key(ssml: str) -> str:
    return hashlib.sha256(ssml.encode()).hexdigest()[:16]
