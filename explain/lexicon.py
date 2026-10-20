"""Qualitative lexicon (SPEC 5.3): words that carry no digit but are still factual.

Each term maps to one predicate with a fixed threshold (all *tunable*):
- `unmarked` ⇒ nearest opponent > 5 m;
- `blind side` ⇒ the target was outside the observer's vision cone when his last scan began;
- `under heavy pressure` ⇒ pressing intensity on the player ≥ 0.7 (`analytics.pressing`).

A claim backs a term only if its predicate (or one conjunct of an `all`) is that definition with
the lexicon's own threshold — a claim cannot weaken "unmarked" to "nearest opponent > 1 m". The
render check allows a term only in a line that references a supported claim backing it.

Two more vocabulary rules for the render check:
- banned evaluative terms: judgements no predicate can back ("mistake", "should have", 失误, 本该)
  never appear, in any persona or language;
- a line that references no claim must be a connective phrase from `CONNECTIVES`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from explain.claims import Predicate, fn


@dataclass(frozen=True)
class Term:
    key: str
    metric: str  # metric_at metric
    op: str
    threshold: Any
    patterns: tuple[re.Pattern[str], ...]  # English and Chinese surface forms


def _p(*patterns: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(p, re.IGNORECASE) for p in patterns)


TERMS: dict[str, Term] = {
    t.key: t
    for t in (
        Term("unmarked", "nearest_opponent_distance", "gt", 5.0,
             _p(r"\bunmarked\b", r"无人盯防|无人看管|没人盯防|没有人盯")),
        Term("blind side", "blind_side", "eq", True,
             _p(r"\bblind[- ]side\b", r"盲区|盲侧")),
        Term("under heavy pressure", "pressing_intensity", "ge", 0.7,
             _p(r"\bunder (?:heavy|intense|severe|huge) pressure\b", r"\bheavily pressed\b",
                r"重压之下|高压之下|巨大的?压力|被紧逼")),
    )
}  # fmt: skip


@dataclass(frozen=True)
class TermMatch:
    key: str
    start: int
    end: int
    text: str


def find_terms(text: str) -> list[TermMatch]:
    found = [
        TermMatch(t.key, m.start(), m.end(), m[0])
        for t in TERMS.values()
        for p in t.patterns
        for m in p.finditer(text)
    ]
    return sorted(found, key=lambda m: m.start)


def predicate(key: str, anchor: Any, at: float = 0.0, **subject: Any) -> Predicate:
    t = TERMS[key]
    lhs = fn("metric_at", metric=t.metric, anchor=anchor, at=at, **subject)
    return Predicate(op=t.op, lhs=lhs, rhs=t.threshold)


def unmarked(player: Any, anchor: Any, at: float = 0.0) -> Predicate:
    return predicate("unmarked", anchor, at, player=player)


def blind_side(observer: Any, target: Any, anchor: Any, at: float = 0.0) -> Predicate:
    return predicate("blind side", anchor, at, observer=observer, target=target)


def under_heavy_pressure(player: Any, anchor: Any, at: float = 0.0) -> Predicate:
    return predicate("under heavy pressure", anchor, at, player=player)


def backs(key: str, pred: Predicate) -> bool:
    """Whether the predicate asserts the term's own definition (possibly inside an `all`)."""
    t = TERMS.get(key)
    if t is None:
        return False
    for c in pred.conjuncts():
        lhs = c.lhs if isinstance(c.lhs, dict) else {}
        if (
            c.op == t.op
            and lhs.get("fn") == "metric_at"
            and lhs.get("args", {}).get("metric") == t.metric
            and type(c.rhs) is type(t.threshold)
            and c.rhs == t.threshold
        ):
            return True
    return False


# Judgements that cannot be written as a predicate (SPEC 5.3), with close variants.
BANNED = _p(
    r"\bmistakes?\b",
    r"\berrors?\b",
    r"\bblunders?\b",
    r"\bdominat(?:e|es|ed|ing|ion)\b",
    r"\b(?:controll?(?:ed|ing|s)?|in control of) the (?:game|match)\b",
    r"\b(?:certain|sure) goal\b",
    r"\bshould(?: have|'ve|n't have| not have)\b",
    r"\blaz(?:y|iness|ily)\b",
    r"\bworld[- ]class\b",
    r"失误|统治(?:了)?比赛|主宰(?:了)?比赛|必进|本该|本应|偷懒|世界级",
)


def find_banned(text: str) -> list[TermMatch]:
    found = [TermMatch(m[0].lower(), m.start(), m.end(), m[0]) for p in BANNED
             for m in p.finditer(text)]  # fmt: skip
    return sorted(found, key=lambda m: m.start)


# Lines without a claim are limited to these (SPEC 5.3), compared without case or punctuation.
CONNECTIVES = frozenset(
    {
        # en
        "and", "and then", "but", "so", "then", "now", "now watch", "watch", "watch this",
        "watch again", "look", "look at this", "look again", "here it is", "here's why",
        "here is why", "why", "how", "what did he see", "what did she see", "this is the moment",
        "rewind", "let's go back", "back to the moment", "freeze it", "see it again",
        # zh
        "然后", "但是", "所以", "现在", "看这里", "注意看", "再看看", "回放", "倒回去看看",
        "暂停", "为什么", "他看到了什么", "她看到了什么", "就是这个瞬间", "关键在这里",
    }
)  # fmt: skip
_EDGE = re.compile(r"^[\s.,!?;:…—–\-\"'“”‘’，。！？；：、]+|[\s.,!?;:…—–\-\"'“”‘’，。！？；：、]+$")


def is_connective(text: str) -> bool:
    core = _EDGE.sub("", text).replace("’", "'").lower()
    return " ".join(core.split()) in CONNECTIVES
