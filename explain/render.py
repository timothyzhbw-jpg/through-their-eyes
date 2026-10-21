"""Verified rendering (SPEC 5.3): captions are filled only from verified slot values.

The Narrator writes script lines with placeholders and claim references; it never writes a
number. `render_line` fills the placeholders from the referenced claims, and only if every one
of them is `supported` and unchanged since it was verified. The result is then checked as a
final caption (`check_caption`):
- every number (digits or number words, any language) lies inside a slot span;
- every lexicon term is backed by a supported claim referenced on the line;
- no banned evaluative term appears ("mistake", "should have", 失误, ...);
- every player name lies inside a slot span (names come from refs, not free text);
and a line that references no claim must be a connective phrase.

`build_payload` turns a script into what a viewer receives for one breakdown (SPEC 5.3): the
lines that passed, and for each claim its kind, verdict, filled values, evidence and seek frame.
`check_payload` re-runs every check on that final payload before it is sent.

Placeholders: `{name}` (a slot of the line's only claim that has it) or `{claim.name}`, with an
optional format — `{n:times}` (once / twice / 3 times; 3次), `{n:words}` (three; 三), `{lane:vocab}`
(a categorical value in words from `VOCABULARY`: right of centre; 中路偏右) — and an optional
plural noun, `{n|second|seconds}` → "1 second", "6 seconds".
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

from explain import lexicon
from explain.claims import PLACEHOLDER, Claim, ClaimKind, Slot
from explain.functions import EVENT_ID, is_number
from explain.numbers import ONES, TENS, number_tokens
from explain.verifier import Verdict


class ScriptLine(BaseModel):
    """One narration line from the Narrator (SPEC 6): text with placeholders + claim refs."""

    id: str
    text: str
    claims: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class SlotSpan:
    start: int
    end: int
    claim: str
    slot: str


@dataclass(frozen=True)
class Violation:
    kind: str  # unsupported_claim | stale_claim | placeholder | number | lexicon | banned |
    #            entity | unbacked_line
    detail: str
    start: int | None = None
    end: int | None = None
    line: str | None = None


@dataclass
class RenderResult:
    ok: bool
    text: str | None  # None unless ok: nothing unverified ever leaves the renderer
    lang: str
    line_id: str
    claims: list[str]
    spans: list[SlotSpan] = field(default_factory=list)
    violations: list[Violation] = field(default_factory=list)


class _Unrenderable(ValueError):
    pass


_ZH_DIGITS = "零一二三四五六七八九"

# Categorical slot values as words (`{name:vocab}`): where on the pitch (`explain.functions` BANDS
# and LANES, from the attacking direction) and which way a look turned. A word comes only from a
# verified value, so "half" in "the opponents' half" sits inside a slot span.
VOCABULARY: dict[str, dict[str, str]] = {
    "own_third": {"en": "in his own third", "zh": "后场三区"},
    "own_half": {"en": "in his own half", "zh": "本方半场"},
    "opponents_half": {"en": "in the opponents' half", "zh": "对方半场"},
    "final_third": {"en": "in the final third", "zh": "前场三区"},
    "right_wing": {"en": "on the right wing", "zh": "右边路"},
    "right_of_centre": {"en": "right of centre", "zh": "中路偏右"},
    "centre": {"en": "in the centre", "zh": "中路"},
    "left_of_centre": {"en": "left of centre", "zh": "中路偏左"},
    "left_wing": {"en": "on the left wing", "zh": "左边路"},
    "left": {"en": "left", "zh": "左"},
    "right": {"en": "right", "zh": "右"},
}


def _words(n: int, lang: str) -> str | None:
    if not 0 <= n <= 99:
        return None
    if lang == "zh":
        if n == 2:
            return "两"
        if n < 10:
            return _ZH_DIGITS[n]
        tens, ones = divmod(n, 10)
        return (_ZH_DIGITS[tens] if tens > 1 else "") + "十" + (_ZH_DIGITS[ones] if ones else "")
    if n < 20:
        return ONES[n]
    tens, ones = divmod(n, 10)
    return TENS[tens - 2] + (f"-{ONES[ones]}" if ones else "")


def _digits(value: float, decimals: int | None) -> str:
    if decimals is not None:
        text = f"{value:.{decimals}f}"
        if float(text) != value:
            raise _Unrenderable(f"{value} has more precision than {decimals} decimals")
        return text
    if isinstance(value, int) or float(value).is_integer():
        return str(int(value))
    text = repr(float(value))
    if "e" in text:
        raise _Unrenderable(f"{value} needs explicit decimals")
    return text


def format_slot(
    s: Slot,
    lang: str,
    names: Mapping[str, str] | None = None,
    fmt: str | None = None,
    one: str | None = None,
    many: str | None = None,
) -> str:
    names = names or {}
    if fmt == "vocab":
        words = VOCABULARY.get(s.value) if isinstance(s.value, str) else None
        if words is None:
            raise _Unrenderable(f"{s.raw!r} has no vocabulary word")
        return words.get(lang, words["en"])
    if s.ref is not None:
        if EVENT_ID.match(s.ref):
            raise _Unrenderable(f"event slot {s.ref} has no text form")
        return names.get(s.ref, s.ref)
    value = s.value
    if isinstance(value, str):
        return names.get(value, value)
    if not is_number(value):
        raise _Unrenderable(f"{value!r} has no text form")
    whole = float(value).is_integer()
    text = _digits(value, s.decimals)
    if fmt == "words":
        text = (_words(int(value), lang) if whole else None) or text
    elif fmt == "times":
        if not whole:
            raise _Unrenderable(f"{value} is not a count")
        if lang == "zh":
            return f"{text}次"
        return {1: "once", 2: "twice"}.get(int(value), f"{text} times")
    elif fmt is not None:
        raise _Unrenderable(f"unknown format {fmt!r}")
    if one is not None and many is not None:
        noun = one if float(value) == 1.0 else many
        return f"{text}{noun}" if lang == "zh" else f"{text} {noun}"
    return text


def render_claim(
    claim: Claim, verdict: Verdict, lang: str = "en", names: Mapping[str, str] | None = None
) -> RenderResult:
    """A claim's own sentence (its template for `lang`)."""
    line = ScriptLine(id=claim.id, text=claim.template_for(lang), claims=[claim.id])
    return render_line(line, {claim.id: claim}, {claim.id: verdict}, lang, names)


def render_line(
    line: ScriptLine,
    claims: Mapping[str, Claim],
    verdicts: Mapping[str, Verdict],
    lang: str = "en",
    names: Mapping[str, str] | None = None,
) -> RenderResult:
    def fail(violations: list[Violation]) -> RenderResult:
        return RenderResult(False, None, lang, line.id, list(line.claims), [], violations)

    violations: list[Violation] = []
    for cid in line.claims:
        claim, verdict = claims.get(cid), verdicts.get(cid)
        if claim is None or verdict is None:
            violations.append(Violation("unsupported_claim", f"{cid}: no verified claim"))
        elif verdict.status != "supported":
            violations.append(
                Violation("unsupported_claim", f"{cid}: {verdict.status} ({verdict.reason})")
            )
        elif verdict.fingerprint != claim.fingerprint():
            violations.append(Violation("stale_claim", f"{cid}: changed after verification"))
    if violations:
        return fail(violations)

    out: list[str] = []
    spans: list[SlotSpan] = []
    length = pos = 0
    for m in PLACEHOLDER.finditer(line.text):
        literal = line.text[pos : m.start()]
        out.append(literal)
        length += len(literal)
        pos = m.end()
        name = m["name"]
        if m["claim"]:
            cid = m["claim"][:-1]
            owners = [cid] if cid in line.claims and name in claims[cid].slots else []
        else:
            owners = [cid for cid in line.claims if name in claims[cid].slots]
        if len(owners) != 1:
            why = "is ambiguous" if owners else "names no slot of a referenced claim"
            violations.append(Violation("placeholder", f"{m[0]} {why}", m.start(), m.end()))
            continue
        cid = owners[0]
        try:
            text = format_slot(claims[cid].slots[name], lang, names, m["fmt"], m["one"], m["many"])
        except _Unrenderable as e:
            violations.append(Violation("placeholder", f"{m[0]}: {e}", m.start(), m.end()))
            continue
        spans.append(SlotSpan(length, length + len(text), cid, name))
        out.append(text)
        length += len(text)
    out.append(line.text[pos:])
    if violations:
        return fail(violations)

    text = "".join(out)
    backed = {t for cid in line.claims for t in verdicts[cid].terms}
    violations = _unbacked(line.claims, text) + check_caption(text, spans, backed, names)
    return RenderResult(
        not violations, None if violations else text, lang, line.id, list(line.claims), spans,
        violations,
    )  # fmt: skip


def _unbacked(claims: list[str], text: str) -> list[Violation]:
    """SPEC 5.3: a line references a supported claim or is a connective phrase."""
    if claims or lexicon.is_connective(text):
        return []
    return [Violation("unbacked_line", "no claim and not a connective phrase")]


_ENTITY = r"(?<![A-Za-z0-9_]){}(?![A-Za-z0-9_])"  # a player's id or name, ASCII boundaries


def check_caption(
    text: str,
    spans: list[SlotSpan],
    backed_terms: set[str] | frozenset[str] = frozenset(),
    names: Mapping[str, str] | None = None,
) -> list[Violation]:
    """Render check on a final caption (SPEC 5.3, acceptance checks — explain)."""

    def in_slot(a: int, b: int) -> bool:
        return any(s.start <= a and b <= s.end for s in spans)

    violations = [
        Violation("number", t.text, t.start, t.end)
        for t in number_tokens(text)
        if not in_slot(t.num_start, t.num_end)
    ]
    violations += [
        Violation("lexicon", m.key, m.start, m.end)
        for m in lexicon.find_terms(text)
        if m.key not in backed_terms
    ]
    violations += [Violation("banned", m.text, m.start, m.end) for m in lexicon.find_banned(text)]
    violations += [  # a placeholder that did not render (malformed or unknown) never airs
        Violation("placeholder", "unrendered brace", m.start(), m.end())
        for m in re.finditer(r"[{}]", text)
    ]
    # A player is named only by a slot. Outside one, his id, his on-screen name ("J. Ferriday")
    # and his surname alone or in his full name are entities, each written-out name once. ASCII
    # boundaries: `\b` would miss a name next to a Chinese character (a word character to it).
    entities: set[str] = set()
    for pid, name in (names or {}).items():
        entities |= {pid, name}
        if ". " in name:
            entities.add(name.rsplit(" ", 1)[1])
    found = []
    for name in entities:
        pattern = _ENTITY.format(re.escape(name)) if name.isascii() else re.escape(name)
        found += [(m.start(), m.end(), name) for m in re.finditer(pattern, text)]
    found.sort(key=lambda f: (f[0], -f[1]))  # the longest first where several start together
    end = -1
    for a, b, name in found:
        if b <= end or in_slot(a, b):  # inside a name already counted, or a slot's value
            continue
        violations.append(Violation("entity", name, a, b))
        end = b
    return violations


# --- render payload (SPEC 5.3) ------------------------------------------------------------


class PayloadSpan(BaseModel):
    start: int
    end: int
    claim: str
    slot: str


# The serialised payload is exactly the SPEC 5.3 shape. `spans` and `terms` stay server-side
# (excluded from dumps): `check_payload` needs them, the viewer does not.


class PayloadLine(BaseModel):
    id: str
    text: str
    claims: list[str]
    spans: list[PayloadSpan] = Field(default_factory=list, exclude=True)  # slot value positions


class PayloadClaim(BaseModel):
    id: str
    kind: ClaimKind
    verdict: Literal["supported"]  # nothing else reaches a viewer
    values: dict[str, bool | int | float | str]  # filled values of the value slots
    evidence: list[str] = Field(default_factory=list)  # event ids
    seek_frame: int | None = None  # where the replay jumps to show the evidence
    terms: list[str] = Field(default_factory=list, exclude=True)  # lexicon terms it backs


class RenderPayload(BaseModel):
    moment: str
    persona: str
    language: str
    lines: list[PayloadLine]
    claims: list[PayloadClaim]


@dataclass
class PayloadBuild:
    payload: RenderPayload
    rejected: list[RenderResult]  # lines dropped, with why (for the Narrator rewrite loop)


def _event_ids(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if EVENT_ID.match(value) else []
    if isinstance(value, dict):
        return [e for v in value.values() for e in _event_ids(v)]
    if isinstance(value, list):
        return [e for v in value for e in _event_ids(v)]
    return []


def seek_frame(claim: Claim) -> int | None:
    """The earliest evidence event, else the earliest event the claim refers to."""
    ids = claim.evidence or _event_ids(claim.predicate.model_dump()) + _event_ids(
        {k: s.ref for k, s in claim.slots.items()}
    )
    frames = [int(e.rsplit(":", 1)[1]) for e in ids if EVENT_ID.match(e)]
    return min(frames) if frames else None


def build_payload(
    moment: str,
    persona: str,
    language: str,
    lines: Iterable[ScriptLine],
    claims: Mapping[str, Claim],
    verdicts: Mapping[str, Verdict],
    names: Mapping[str, str] | None = None,
) -> PayloadBuild:
    kept: list[PayloadLine] = []
    rejected: list[RenderResult] = []
    used: list[str] = []
    for line in lines:
        out = render_line(line, claims, verdicts, language, names)
        if not out.ok:
            rejected.append(out)
            continue
        spans = [PayloadSpan(start=s.start, end=s.end, claim=s.claim, slot=s.slot)
                 for s in out.spans]  # fmt: skip
        kept.append(PayloadLine(id=line.id, text=out.text, claims=line.claims, spans=spans))
        used += [c for c in line.claims if c not in used]
    entries = [
        PayloadClaim(
            id=cid,
            kind=claims[cid].kind,
            verdict="supported",
            values={k: s.value for k, s in claims[cid].slots.items() if s.value is not None},
            terms=verdicts[cid].terms,
            evidence=claims[cid].evidence,
            seek_frame=seek_frame(claims[cid]),
        )
        for cid in used
    ]
    payload = RenderPayload(
        moment=moment, persona=persona, language=language, lines=kept, claims=entries
    )
    return PayloadBuild(payload, rejected)


def check_payload(
    payload: RenderPayload, names: Mapping[str, str] | None = None
) -> list[Violation]:
    """Every render check, re-run on the final payload a viewer receives."""
    claims = {c.id: c for c in payload.claims}
    violations: list[Violation] = []
    for line in payload.lines:
        found = _unbacked(line.claims, line.text)
        missing = [c for c in line.claims if c not in claims]
        found += [Violation("unsupported_claim", f"{c}: not in the payload") for c in missing]
        for s in line.spans:
            if s.claim not in line.claims or s.claim not in claims:
                found.append(Violation("placeholder", f"span for {s.claim}.{s.slot}"))
        spans = [SlotSpan(s.start, s.end, s.claim, s.slot) for s in line.spans]
        backed = {t for c in line.claims if c in claims for t in claims[c].terms}
        found += check_caption(line.text, spans, backed, names)
        violations += [Violation(v.kind, v.detail, v.start, v.end, line.id) for v in found]
    return violations
