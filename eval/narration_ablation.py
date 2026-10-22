"""Foundry evaluation as an ablation (SPEC 6): free-text vs anchored narration.

    uv run --group eval --env-file .env python -m eval.narration_ablation --seeds 3,100-104

Both modes narrate the hero moment of `blind_side_run` on the same seeds, personas and languages:
- free text: the pre-anchoring narration (eval/free_text.py), each voice writing its own
  sentences with slot placeholders;
- anchored: what ships, each line a verified claim id and/or an allowed connective.
Only the two narration voices call the model. The Director, Analyst and Telestrator use their
templates, so both modes narrate the same findings. Everything after narration is the shipped
crew: tidy, the Verifier, at most two rewrites, then drops.

Scores:
- per line, the deterministic Verifier's violations by kind on the first draft (after tidy), the
  repeats tidy dropped, rewrite rounds, and the lines aired and dropped in the end;
- per aired script, azure-ai-evaluation's GroundednessEvaluator (MIT) against the rendered
  sentences of the claims the script cites, judged by the same Foundry deployment, keyless
  (`az login`, as agents/llm.py).

Results are cached per seed in out/narration_ablation/, so the report can be rewritten without
model calls; `--max-calls` stops before a seed that could take the run past the budget.
Writes eval/reports/narration_ablation.md.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import datetime as dt
import os
import re
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel

from agents.context import MomentContext
from agents.llm import Attempt
from agents.schemas import Findings, Language, Persona, ScriptLine, ScriptResult
from agents.workflow import BREAKDOWN, Crew, Job, Key, Narration, Verifier, build_workflow, tidy
from eval.free_text import FreeTextNarration
from explain.claims import PLACEHOLDER
from explain.functions import is_number
from explain.lexicon import is_connective
from explain.numbers import ONES, TENS
from explain.render import ScriptLine as RenderLine
from explain.render import Violation, format_slot, render_claim, render_line

Mode = Literal["free_text", "anchored"]
MODES: tuple[Mode, ...] = ("free_text", "anchored")
LABEL: dict[Mode, str] = {"free_text": "free text", "anchored": "anchored"}
SCENARIO = "blind_side_run"
PERSONAS: tuple[Persona, ...] = ("casual", "analyst")
LANGUAGES: tuple[Language, ...] = ("en", "zh")
# Violation kinds of explain.render, in report order.
KINDS = ("number", "entity", "placeholder", "banned", "lexicon", "unsupported_claim",
         "stale_claim", "unbacked_line")  # fmt: skip
TIMEOUT_S = 30.0  # per narration call; generous, so a slow reply is scored instead of templated
MAX_CALLS = 200
REPORTS = Path(__file__).parent / "reports"
CACHE = Path("out") / "narration_ablation"

# (response, context) -> (groundedness 1-5, the judge's reason)
Judge = Callable[[str, str], tuple[float, str]]


# --- what is kept per script ---------------------------------------------------------------------


class Line(BaseModel):
    id: str
    speaker: str
    text: str  # as the voice wrote it, placeholders unfilled
    claims: list[str]
    preview: str = ""  # placeholders that resolve filled in, the rest as written
    kinds: list[str] = []  # the Verifier's violation kinds, in the order it found them
    details: list[str] = []
    made_up: list[str] = []  # ids and numbers written outside slots that no cited claim holds
    truth: list[str] = []  # the cited claims' own sentences, kept when something was made up


class Aired(BaseModel):
    text: str  # as rendered for the viewer
    claims: list[str]
    verbatim: bool  # a claim's own sentence or a connective (or both), not the model's words


class Script(BaseModel):
    seed: int
    mode: Mode
    persona: Persona
    language: Language
    fell_back: bool  # a voice fell back to its template (timeout, error or unusable reply)
    drafted: list[Line]  # both voices' lines in speaking order, before tidy
    first_pass: list[Line]  # after tidy: what the Verifier checked in round 0
    repeats: int  # lines tidy dropped because they restate an earlier line
    restored: int  # lines whose bare placeholders tidy gave their template's form
    rewrites: int  # rewrite rounds
    aired_lines: list[Aired]  # what the viewer gets
    dropped: list[Line]  # still failing after the rewrites
    headline: list[str]  # the findings' headline claims
    headline_spoken: list[str]  # those cited by an aired line
    context: list[str]  # rendered sentences of the claims the aired lines cite
    groundedness: float | None = None
    groundedness_reason: str | None = None

    @property
    def aired(self) -> list[str]:
        return [a.text for a in self.aired_lines]

    @property
    def violations(self) -> dict[str, int]:
        counts = Counter(k for line in self.first_pass for k in line.kinds)
        return {k: counts.get(k, 0) for k in KINDS}

    @property
    def failing(self) -> int:
        return sum(bool(line.kinds) for line in self.first_pass)

    @property
    def made_up(self) -> int:
        return sum(len(line.made_up) for line in self.first_pass)

    @property
    def aired_repeats(self) -> int:
        """Aired lines that restate earlier aired claims or repeat an earlier line word for word
        (rewrites are not tidied again)."""
        n, stated, texts = 0, set(), set()
        for a in self.aired_lines:
            n += (bool(a.claims) and set(a.claims) <= stated) or a.text in texts
            stated |= set(a.claims)
            texts.add(a.text)
        return n


class SeedResult(BaseModel):
    seed: int
    moment: str
    scripts: list[Script]
    calls: dict[str, int]  # model calls: per mode (narration, rewrites, retries) and the judge


class Meta(BaseModel):
    model: str
    date: str
    evaluator: str
    seeds: list[int]
    personas: list[str]
    languages: list[str]
    skipped: list[int] = []  # seeds left out to stay within the call budget


# --- running one mode ----------------------------------------------------------------------------


@dataclass
class NarrationOnlyCrew(Crew):
    """Only the two narration voices call the model; the other agents keep their templates."""

    calls: int = 0
    drafts: dict[Key, list[ScriptLine]] = field(default_factory=dict)
    fell_back: set[Key] = field(default_factory=set)

    async def ask(self, role: str, instructions: str, prompt: str, schema, tools=None) -> Attempt:
        if role not in ("pbp", "color"):
            return Attempt(None, 0, "ablation: template", 0.0)
        attempt = await super().ask(role, instructions, prompt, schema, tools)
        self.calls += attempt.attempts
        return attempt


class _Recording:
    """Keeps each script's first draft (both voices, before tidy) and which voices fell back."""

    crew: NarrationOnlyCrew

    async def _speaker(self, base, key: Key, speaker, pbp, problems=None):
        lines, attempt = await super()._speaker(base, key, speaker, pbp, problems)
        if problems is None and (attempt is None or attempt.value is None):
            self.crew.fell_back.add(key)
        return lines, attempt

    async def _script(self, base, key: Key, problems=None):
        lines, attempts = await super()._script(base, key, problems)
        if problems is None:  # a redraft for the persona rules is not the first draft
            self.crew.drafts[key] = lines
        return lines, attempts


class _Anchored(_Recording, Narration):
    pass


class _LineVerifier(Verifier):
    """The shipped Verifier with the persona rules (agents/persona_rules.py) off: the ablation
    isolates anchoring, line by line, as when its report was measured."""

    def script_problems(self, key, lines):
        return []

    def repair(self, key, lines):
        return list(lines), [], []


ABLATION = dataclasses.replace(BREAKDOWN, verifier=_LineVerifier)


class _FreeText(_Recording, FreeTextNarration):
    pass


NARRATION: dict[Mode, type[Narration]] = {"free_text": _FreeText, "anchored": _Anchored}


async def run_mode(
    ctx: MomentContext,
    mode: Mode,
    client: Any,
    personas: Sequence[Persona],
    languages: Sequence[Language],
    timeout_s: float = TIMEOUT_S,
) -> tuple[list[Script], int]:
    """One breakdown of the moment in `mode`: the scored scripts and the model calls made."""
    crew = NarrationOnlyCrew(ctx, client, timeout_s)
    workflow = build_workflow(crew, NARRATION[mode], story=ABLATION)
    result = await workflow.run(Job(tuple(personas), tuple(languages)))
    (out,) = result.get_outputs()
    return [_score(ctx, mode, out.findings, crew, s) for s in out.scripts], crew.calls


def preview(ctx: MomentContext, line: ScriptLine, language: Language) -> str:
    """The line with every placeholder that resolves filled in and the rest left as written, so
    a malformed placeholder shows as the literal braces it would air as without the Verifier."""

    def fill(m: re.Match) -> str:
        cid = m["claim"][:-1] if m["claim"] else None
        owners = [c for c in ([cid] if cid else line.claims)
                  if c in ctx.claims and m["name"] in ctx.claims[c].slots]  # fmt: skip
        if len(owners) != 1:
            return m[0]
        slot = ctx.claims[owners[0]].slots[m["name"]]
        try:
            return format_slot(slot, language, ctx.names, m["fmt"], m["one"], m["many"])
        except ValueError:
            return m[0]

    return PLACEHOLDER.sub(fill, line.text)


_EN_VALUES = (
    {w: float(i) for i, w in enumerate(ONES)}
    | {w: float(20 + 10 * i) for i, w in enumerate(TENS)}
    | {"once": 1.0, "twice": 2.0, "thrice": 3.0, "half": 0.5, "dozen": 12.0}
)
_ZH_VALUES = dict(
    zip("零〇一二两三四五六七八九", (0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9), strict=True)
)


def number_value(text: str) -> float | None:
    """The value of a number token (digits, an English number word, a Chinese numeral with or
    without its measure word), or None when it is not one of the simple forms."""
    if m := re.match(r"\d+(?:\.\d+)?", text):
        return float(m[0])
    if text.lower() in _EN_VALUES:
        return _EN_VALUES[text.lower()]
    if text.startswith("半"):
        return 0.5
    m = re.match(r"第?([零〇一二两三四五六七八九十]+)", text)
    if m is None:
        return None
    tens, ten, ones = m[1].partition("十")
    if not ten:
        return float(_ZH_VALUES[tens]) if len(tens) == 1 else None
    return float((_ZH_VALUES.get(tens, 1) if tens else 1) * 10 + (_ZH_VALUES.get(ones, 0)))


def _made_up(ctx: MomentContext, claims: list[str], violations: list[Violation]) -> list[str]:
    """Ids and numbers written outside slots that no slot of the line's claims holds: the model
    is shown slot names, not values, so these are guesses that came out wrong. A right id or
    number in the wrong role is not caught, so this is a lower bound."""
    ids, values = set(), []
    for cid in claims:
        for s in ctx.claims[cid].slots.values() if cid in ctx.claims else ():
            if s.ref is not None or isinstance(s.value, str):
                pid = s.ref or s.value
                ids |= {pid, ctx.names.get(pid, pid)}  # written out by id or by name
            elif is_number(s.value):
                values.append(float(s.value))
    out = []
    for v in violations:
        if v.kind == "entity" and v.detail not in ids:
            out.append(v.detail)
        elif v.kind == "number":
            x = number_value(v.detail)
            if x is None or not any(abs(x - y) <= max(0.05 * abs(y), 0.005) for y in values):
                out.append(v.detail)
    return out


ID = r"(?<![A-Za-z0-9]){}(?![0-9])"  # a player id, with ASCII-only boundaries


def _ids_as_entities(ctx: MomentContext, text: str, found: list[Violation]) -> list[Violation]:
    """A player id written outside a slot (H8) is an entity violation for the Verifier, and its
    digit a number violation too; count it once, as the entity."""
    spans = [(m.start(), m.end(), pid) for pid in sorted(set(ctx.names))
             for m in re.finditer(ID.format(re.escape(pid)), text)]  # fmt: skip
    out, seen = [], set()
    for v in found:
        if v.kind == "number":
            owner = next((s for s in spans if s[0] <= v.start and v.end <= s[1]), None)
            if owner is not None:
                v = Violation("entity", owner[2], owner[0], owner[1])
        if v.kind == "entity":
            if (v.start, v.end) in seen:
                continue
            seen.add((v.start, v.end))
        out.append(v)
    return out


def _check(ctx: MomentContext, line: ScriptLine, language: Language) -> Line:
    """A line as the Verifier checks it (agents.workflow.Verifier._check), with a written-out
    player id counted once, as an entity."""
    res = render_line(RenderLine(id=line.id, text=line.text, claims=line.claims), ctx.claims,
                      ctx.verdicts, language, ctx.names)  # fmt: skip
    # Number and entity violations come from the caption check, which runs on the line with
    # every placeholder filled: the preview, whose positions they refer to.
    found = _ids_as_entities(ctx, preview(ctx, line, language), res.violations)
    made_up = _made_up(ctx, line.claims, found)
    truth = [render_claim(ctx.claims[c], ctx.verdicts[c], language, ctx.names).text
             for c in line.claims if c in ctx.supported] if made_up else []  # fmt: skip
    return Line(id=line.id, speaker=line.speaker, text=line.text, claims=line.claims,
                preview=res.text or preview(ctx, line, language), kinds=[v.kind for v in found],
                details=[v.detail for v in found], made_up=made_up, truth=truth)  # fmt: skip


def _aired(ctx: MomentContext, line, language: Language) -> Aired:
    sentences = [render_claim(ctx.claims[c], ctx.verdicts[c], language, ctx.names).text
                 for c in line.claims]  # fmt: skip
    text = line.text
    verbatim = is_connective(text) or any(
        text.endswith(s) and (text == s or is_connective(text[: -len(s)])) for s in sentences
    )
    return Aired(text=text, claims=line.claims, verbatim=verbatim)


def _score(
    ctx: MomentContext, mode: Mode, findings: Findings, crew: NarrationOnlyCrew, s: ScriptResult
) -> Script:
    key, lang = (s.persona, s.language), s.language
    spoken = {c for line in s.payload.lines for c in line.claims}
    script = Script(
        seed=ctx.seed, mode=mode, persona=s.persona, language=lang,
        fell_back=key in crew.fell_back,
        drafted=[Line(id=x.id, speaker=x.speaker, text=x.text, claims=x.claims)
                 for x in crew.drafts[key]],
        first_pass=[], repeats=0, restored=0, rewrites=s.rewrites,
        aired_lines=[Aired(text=line.text, claims=line.claims, verbatim=False)
                     for line in s.payload.lines],
        dropped=[Line(id=d.id, speaker=d.speaker, text=d.text, claims=[], kinds=[d.reason],
                      details=[d.detail]) for d in s.dropped],
        headline=list(findings.headline),
        headline_spoken=[c for c in findings.headline if c in spoken],
        context=[render_claim(ctx.claims[c.id], ctx.verdicts[c.id], lang, ctx.names).text
                 for c in s.payload.claims],
    )  # fmt: skip
    return derive(ctx, script)


def derive(ctx: MomentContext, s: Script) -> Script:
    """Every score computed from what the model wrote, with no model call, so a cached seed is
    scored by the current code: tidy and the Verifier's check on the first draft, and how each
    aired line relates to its claims."""
    drafted = [ScriptLine(id=x.id, speaker=x.speaker, text=x.text, claims=x.claims)
               for x in s.drafted]  # fmt: skip
    kept, notes = tidy(ctx, drafted, s.language)
    before = {line.id: line.text for line in drafted}
    s.first_pass = [_check(ctx, line, s.language) for line in kept]
    s.repeats, s.restored = len(notes), sum(line.text != before[line.id] for line in kept)
    s.aired_lines = [_aired(ctx, a, s.language) for a in s.aired_lines]
    return s


# --- the ablation --------------------------------------------------------------------------------


async def _judge_all(scripts: list[Script], judge: Judge, pace_s: float) -> int:
    calls = 0
    for s in scripts:
        if not s.aired:
            continue  # nothing aired: nothing to ground
        try:
            score, reason = await asyncio.to_thread(judge, "\n".join(s.aired), "\n".join(s.context))
            s.groundedness, s.groundedness_reason = float(score), reason
        except Exception as e:  # recorded, not fatal: the Verifier's numbers still stand
            s.groundedness_reason = f"judge error: {type(e).__name__}: {e}"[:300]
        calls += 1
        await asyncio.sleep(pace_s)
    return calls


def _cache_path(cache_dir: Path, seed: int, personas, languages) -> Path:
    return cache_dir / f"seed{seed}_{'-'.join(personas)}_{'-'.join(languages)}.json"


async def ablate(
    seeds: Sequence[int],
    clients: dict[Mode, Any],
    judge: Judge,
    personas: Sequence[Persona] = PERSONAS,
    languages: Sequence[Language] = LANGUAGES,
    cache_dir: Path | None = None,
    max_calls: int | None = None,
    pace_s: float = 0.0,
    timeout_s: float = TIMEOUT_S,
    log: Callable[[str], None] = lambda _: None,
) -> list[SeedResult]:
    """Both modes on every seed, each aired script judged; stops before a seed that could take
    the model calls past `max_calls` (the costliest seed so far is the estimate)."""
    results: list[SeedResult] = []
    used = costliest = 0
    for seed in seeds:
        path = _cache_path(cache_dir, seed, personas, languages) if cache_dir else None
        if path is not None and path.exists():
            cached = SeedResult.model_validate_json(path.read_text())
            ctx = MomentContext.load(SCENARIO, seed)
            cached.scripts = [derive(ctx, s) for s in cached.scripts]
            results.append(cached)
            log(f"seed {seed}: cached, scored again")
            continue
        if max_calls is not None and used + costliest > max_calls:
            log(f"seed {seed}: skipped, {used} calls used of {max_calls}")
            break
        ctx = MomentContext.load(SCENARIO, seed)
        scripts: list[Script] = []
        calls: dict[str, int] = {}
        for mode in MODES:
            out, calls[mode] = await run_mode(ctx, mode, clients[mode], personas, languages,
                                              timeout_s)  # fmt: skip
            scripts += out
            await asyncio.sleep(pace_s)
        calls["judge"] = await _judge_all(scripts, judge, pace_s)
        result = SeedResult(seed=seed, moment=ctx.card.id, scripts=scripts, calls=calls)
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(result.model_dump_json(indent=1))
        cost = sum(calls.values())
        used, costliest = used + cost, max(costliest, cost)
        log(f"seed {seed}: {calls} ({used} calls so far)")
        results.append(result)
    return results


# --- the report ----------------------------------------------------------------------------------

# A count word that does not agree with its value or unit: "once times", "1 times",
# "6.6 metres-metre", 1次次.
GRAMMAR = re.compile(
    r"\b(?:once|twice|thrice) times\b|(?<![\d.])1 (?:times|seconds|metres)\b"
    r"|\b(?:metres?|seconds?)-(?:metres?|seconds?)\b|次次"
)


def _pct(n: int, d: int) -> str:
    return f"{n} of {d} ({100 * n / d:.0f}%)" if d else "0"


def _grounded(scripts: list[Script]) -> list[float]:
    return [s.groundedness for s in scripts if s.groundedness is not None]


def _mean(xs: list[float]) -> str:
    return f"{sum(xs) / len(xs):.2f}" if xs else "–"


@dataclass
class Totals:
    """Sums over a group of scripts."""

    scripts: int
    drafted: int  # lines both voices wrote
    repeats: int  # dropped by tidy
    checked: int  # first-draft lines the Verifier checked
    failing: int
    violations: Counter
    made_up: int
    rewritten: int  # scripts with at least one rewrite round
    rounds: int
    aired: int
    aired_repeats: int
    own_words: int  # aired lines that are not a claim's sentence or a connective
    broken: int  # aired lines with a count word that does not agree (GRAMMAR)
    dropped: int
    headline: int
    spoken: int  # headline claims an aired line cites
    grounded: list[float]
    fell_back: int

    @classmethod
    def of(cls, ss: list[Script]) -> Totals:
        violations = Counter()
        for s in ss:
            violations.update(s.violations)
        return cls(
            scripts=len(ss), drafted=sum(len(s.drafted) for s in ss),
            repeats=sum(s.repeats for s in ss), checked=sum(len(s.first_pass) for s in ss),
            failing=sum(s.failing for s in ss), violations=violations,
            made_up=sum(s.made_up for s in ss), rewritten=sum(s.rewrites > 0 for s in ss),
            rounds=sum(s.rewrites for s in ss), aired=sum(len(s.aired_lines) for s in ss),
            aired_repeats=sum(s.aired_repeats for s in ss),
            own_words=sum(not a.verbatim for s in ss for a in s.aired_lines),
            broken=sum(bool(GRAMMAR.search(a.text)) for s in ss for a in s.aired_lines),
            dropped=sum(len(s.dropped) for s in ss), headline=sum(len(s.headline) for s in ss),
            spoken=sum(len(s.headline_spoken) for s in ss), grounded=_grounded(ss),
            fell_back=sum(s.fell_back for s in ss),
        )  # fmt: skip


def _comparison(by_mode: dict[Mode, list[Script]], calls: Counter) -> list[str]:
    t = {m: Totals.of(by_mode[m]) for m in MODES}
    rows: list[tuple[str, Callable[[Mode, Totals], object]]] = [
        ("scripts (seed × audience)", lambda m, x: x.scripts),
        ("model calls (narration, rewrites, retries)", lambda m, x: calls[m]),
        ("lines drafted", lambda m, x: x.drafted),
        ("… restating an earlier line (dropped by tidy)", lambda m, x: x.repeats),
        ("lines failing the Verifier on the first draft", lambda m, x: _pct(x.failing, x.checked)),
        ("violations on the first draft", lambda m, x: sum(x.violations.values())),
        ("ids and numbers made up (no cited claim holds them)", lambda m, x: x.made_up),
        ("scripts rewritten · rewrite rounds", lambda m, x: f"{x.rewritten} · {x.rounds}"),
        ("lines aired", lambda m, x: x.aired),
        ("… restating an earlier aired line", lambda m, x: x.aired_repeats),
        ("… in the model's own words (not a claim's sentence)", lambda m, x: x.own_words),
        ("… with a count word that does not agree (“once times”, 1次次)", lambda m, x: x.broken),
        ("lines dropped", lambda m, x: x.dropped),
        ("headline claims spoken", lambda m, x: _pct(x.spoken, x.headline)),
        ("groundedness, mean (min)", lambda m, x: _mean(x.grounded)
         + (f" ({min(x.grounded):.0f})" if x.grounded else "")),
        ("scripts scored below 5", lambda m, x: sum(g < 5 for g in x.grounded)),
        ("scripts where a voice fell back to its template", lambda m, x: x.fell_back),
    ]  # fmt: skip
    return [
        "| | " + " | ".join(LABEL[m] for m in MODES) + " |",
        "|---|" + "---:|" * len(MODES),
        *(f"| {label} | " + " | ".join(str(f(m, t[m])) for m in MODES) + " |"
          for label, f in rows),
    ]  # fmt: skip


AUDIENCE_HEAD = [
    "| persona · language | scripts | failing first draft | number | entity | placeholder "
    "| banned | lexicon | unsupported / stale | unbacked line | made up | rewrite rounds | aired "
    "| aired repeats | dropped | groundedness |",
    "|---|" + "---:|" * 15,
]


def _audience_row(label: str, ss: list[Script]) -> str:
    x = Totals.of(ss)
    v = x.violations
    cells = [
        x.scripts, _pct(x.failing, x.checked), v["number"], v["entity"], v["placeholder"],
        v["banned"], v["lexicon"], v["unsupported_claim"] + v["stale_claim"], v["unbacked_line"],
        x.made_up, x.rounds, x.aired, x.aired_repeats, x.dropped, _mean(x.grounded),
    ]  # fmt: skip
    return f"| {label} | " + " | ".join(map(str, cells)) + " |"


def _where(s: Script, line: Line | None = None) -> str:
    who = f" · {line.speaker}" if line is not None else ""
    return f"seed {s.seed} · {s.persona}/{s.language}{who}"


def _diverse(items: list, key: Callable, limit: int) -> list:
    """Up to `limit` items, one per key first, in order."""
    picked, seen = [], set()
    for item in items:
        if key(item) not in seen:
            seen.add(key(item))
            picked.append(item)
    picked += [item for item in items if item not in picked]
    return picked[:limit]


def _reason(text: str | None, limit: int = 320) -> str:
    text = re.sub(r"^\s*Let's think step by step:\s*", "", text or "").strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + " …"


def _details(line: Line, kind: str) -> list[str]:
    return [d for k, d in zip(line.kinds, line.details, strict=True) if k == kind]


def _examples(scripts: list[Script]) -> list[str]:
    out: list[str] = []

    def section(
        title: str, lines: list[str], total: int, none: str | None = None, unit: str = "lines"
    ) -> None:
        if lines:
            out.extend([f"**{title}** ({total} {unit})", "", *lines, ""])
        elif none:
            out.extend([f"**{title}:** {none}", ""])

    def g(s: Script) -> str:
        return f"groundedness {s.groundedness:.0f}" if s.groundedness is not None else "not judged"

    lines = [(s, line) for s in scripts for line in s.first_pass]
    made_up = [(s, x) for s, x in lines if x.made_up]
    section("Made up: ids and numbers no cited claim holds", [
        f"- {_where(s, x)}: “{x.preview}” — made up: {', '.join(x.made_up)}. "
        f"The claim says: " + " ".join(f"“{t}”" for t in x.truth)
        for s, x in _diverse(made_up, lambda it: (it[0].persona, it[0].language, *it[1].claims), 6)
    ], len(made_up), "none in this run.")  # fmt: skip
    braces = [(s, x) for s, x in lines if "unrendered brace" in x.details]
    section("Literal braces: a placeholder that does not render", [
        f"- {_where(s, x)}: `{x.text}` → “{x.preview}”" for s, x in braces[:3]
    ], len(braces), "none in this run; the first run (M0) had `{window_s|second}`.")  # fmt: skip
    grammar = [(s, a.text, "aired") for s in scripts for a in s.aired_lines
               if GRAMMAR.search(a.text)]  # fmt: skip
    grammar += [(s, x.preview, "first draft, rejected") for s, x in lines
                if GRAMMAR.search(x.preview)]  # fmt: skip
    section("Broken grammar", [f"- {_where(s)}, {where}: “{t}”" for s, t, where in grammar[:5]],
            len(grammar), "none in this run.")  # fmt: skip
    own = [(s, a) for s in scripts for a in s.aired_lines if not a.verbatim]
    section("Aired in the model's own words (passed the Verifier)", [
        f"- {_where(s)} ({g(s)}): “{a.text}”"
        for s, a in _diverse(own, lambda it: (it[0].persona, it[0].language), 8)
    ], len(own), "none.")  # fmt: skip
    restated = [(s, x) for s in scripts for x in s.drafted
                if x.id not in {y.id for y in s.first_pass}]  # fmt: skip
    section("Restating a claim an earlier line stated (dropped by tidy)", [
        f"- {_where(s, x)}: `{x.text}`"
        for s, x in _diverse(restated, lambda it: (it[0].persona, it[0].language), 4)
    ], len(restated))  # fmt: skip
    repeats = [s for s in scripts if s.aired_repeats]
    section("Aired twice: a rewrite restating a line that already airs", [
        f"- {_where(s)}: " + " / ".join(f"“{t}”" for t in s.aired) for s in repeats[:2]
    ], sum(s.aired_repeats for s in scripts))  # fmt: skip
    low = sorted((s for s in scripts if s.groundedness is not None and s.groundedness < 5),
                 key=lambda s: s.groundedness)  # fmt: skip
    section("Aired, but scored below 5 for groundedness", [
        f"- {_where(s)}, {g(s)}: " + " / ".join(f"“{a.text}”" for a in s.aired_lines)
        + f"\n  - judge: {_reason(s.groundedness_reason)}"
        for s in low[:3]
    ], len(low), unit="scripts")  # fmt: skip
    for kind in ("banned", "lexicon", "unsupported_claim", "stale_claim", "unbacked_line"):
        found = [(s, x) for s, x in lines if kind in x.kinds]
        section(f"Caught by the Verifier: {kind}", [
            f"- {_where(s, x)}: “{x.preview}” ({'; '.join(_details(x, kind))})"
            for s, x in found[:2]
        ], len(found))  # fmt: skip
    return out


def _headline(by_mode: dict[Mode, list[Script]]) -> list[str]:
    out = []
    for m in MODES:
        x = Totals.of(by_mode[m])
        out.append(
            f"- **{LABEL[m].capitalize()}:** {_pct(x.failing, x.checked)} first-draft lines failed "
            f"the Verifier, with {x.made_up} made-up ids or numbers; {x.rewritten} of {x.scripts} "
            f"scripts needed a rewrite. {x.aired} lines aired ({x.own_words} in the model's own "
            f"words, {x.broken} with broken count words, {x.aired_repeats} restating another), "
            f"{x.dropped} dropped; groundedness {_mean(x.grounded)}."
        )
    return out


def report(results: list[SeedResult], meta: Meta) -> str:
    by_mode = {m: [s for r in results for s in r.scripts if s.mode == m] for m in MODES}
    calls = Counter()
    for r in results:
        calls.update(r.calls)
    seeds = ", ".join(str(r.seed) for r in results)
    lines = [
        "# Narration ablation — free text vs anchored lines (SPEC 6)",
        "",
        f"Model: `{meta.model}` on Microsoft Foundry, for narration and as the groundedness "
        f"judge. Evaluator: {meta.evaluator}. Date: {meta.date}.",
        f"Seeds: {seeds} ({len(results)}) of `{SCENARIO}`, the hero moment "
        f"(`{results[0].moment if results else '–'}` on the first). "
        f"Audiences: {', '.join(meta.personas)} × {', '.join(meta.languages)}.",
        f"Model calls: {sum(calls.values())} ({calls['free_text']} free-text narration, "
        f"{calls['anchored']} anchored narration, {calls['judge']} groundedness).",
    ]
    if meta.skipped:
        lines.append(f"Skipped to stay within the call budget: seeds {meta.skipped}.")
    lines += ["", *_headline(by_mode), "", "## Result", "", *_comparison(by_mode, calls)]
    for m in MODES:
        lines += ["", f"### {LABEL[m].capitalize()}, per audience", "", *AUDIENCE_HEAD]
        for persona in meta.personas:
            for language in meta.languages:
                group = [s for s in by_mode[m] if (s.persona, s.language) == (persona, language)]
                lines.append(_audience_row(f"{persona} · {language}", group))
        lines.append(_audience_row("all", by_mode[m]))
    lines += ["", "## Free-text failures, verbatim", "",
              "Quoted with every placeholder that resolves filled in: what would have aired with "
              "no Verifier. `Code` is the line as the voice wrote it.", ""]  # fmt: skip
    lines += _examples(by_mode["free_text"]) or ["None.", ""]
    lines.append(METHOD)
    return "\n".join(lines).rstrip() + "\n"


METHOD = """## Method

- **Free text** is the narration the crew had before anchored lines (git `d975277^`), kept as an
  eval-only mode in `eval/free_text.py`: each voice writes its own sentences with slot
  placeholders and lists the claims each line states (`NarrationDraft`). The model sees each
  claim's template and slot names, not the values. **Anchored** is what ships: each line is a
  supported claim id and/or an allowed connective, enums in the JSON schema, and a claim speaks
  its verified template.
- Same moment, seeds, audiences and findings for both: only the two narration voices call the
  model; the Director, Analyst and Telestrator use their templates. After narration both run the
  shipped crew unchanged: tidy (drops lines restating a claim, gives bare placeholders their
  template's form), the Verifier, at most two rewrites by the voice that wrote the line, then
  drops. Tidy came with the anchoring commit, so free text here is better off than in the first
  run, which had no tidy.
- Narration calls get 30 s and one retry (the crew uses 8 s), so slow replies are scored rather
  than replaced by templates; "a voice fell back" counts scripts where a template took over.
- **Verifier violations** are counted on the first draft after tidy, per kind; a line can have
  several. The Verifier stops at the first failing stage (an unsupported claim hides the
  placeholder and caption checks; a bad placeholder hides the caption checks). A player id
  written outside a slot (`H8`) counts once, as an entity: the Verifier also rejects its digit as
  a number, and in zh its entity check misses an id next to a Chinese character (`\\b` treats CJK
  as word characters), so ids are matched here with ASCII-only boundaries.
- **Made up** counts the ids and numbers a line writes outside its slots that no slot of its
  cited claims holds (numbers within 5%). An id or number that exists in the claims but stands in
  the wrong role is not counted, so this is a lower bound on wrong facts.
- **Aired lines** are scored after the rewrites: whether a line restates claims an earlier aired
  line already stated (or repeats its words), whether it is the model's own words rather than a
  claim's sentence, a connective, or a connective followed by a claim's sentence, and whether a
  count word disagrees with its value or unit (a pattern match: neither the Verifier nor the
  judge checks grammar).
- **Groundedness** is `azure-ai-evaluation`'s `GroundednessEvaluator` (1–5, pass at 3) on each
  aired script: the response is its lines, the context the rendered sentences of the claims they
  cite. Judged by the same Foundry deployment, keyless (`az login`).

## What this shows, and what it does not

- It shows how much the Verifier has to catch when the model writes its own sentences, what airs
  once it has, and whether that is grounded in the claims. Anchored lines are verified templates,
  so their groundedness is close to 5 by construction: the ceiling free text is compared against,
  not evidence on its own.
- The Verifier does not judge meaning. A free-text line that passes it can still say something
  its claims do not; groundedness and the own-words count are the checks for that, and the judge
  reads whole scripts, so one ungrounded line in a long script can still score 4 or 5.
- It compares the two narration designs as built, prompt and schema together. Besides the enum
  schema, the anchored prompt lists the remaining claims and tells the co-commentator not to
  repeat the play-by-play's claims; the pre-anchoring prompt did neither, which shows in the
  restated-line count.
- One moment type, one model, a handful of seeds: the counts are evidence for this crew on this
  moment, not a general rate. The judge is the same model that wrote the free text, so it may be
  lenient with its own phrasing.
- It does not measure how the lines sound. Anchored scripts repeat template wording; free text
  can be livelier when it is right.
- Rewrites are not tidied again, in either mode: a rewritten line can restate a claim another
  line already airs; "restating an earlier aired line" counts it.
"""


# --- Foundry --------------------------------------------------------------------------------------


def foundry_judge() -> tuple[Judge, str]:
    """GroundednessEvaluator on the crew's Foundry deployment, with the credential agents/llm.py
    uses (the developer's `az login` locally). Needs the `eval` dependency group."""
    from importlib.metadata import version

    from azure.ai.evaluation import GroundednessEvaluator

    from agents.llm import sync_credential_from_env

    parts = urlsplit(os.environ["FOUNDRY_PROJECT_ENDPOINT"].strip())
    config = {"azure_endpoint": f"{parts.scheme}://{parts.netloc}",
              "azure_deployment": os.environ["FOUNDRY_MODEL"].strip()}  # fmt: skip
    evaluator = GroundednessEvaluator(config, credential=sync_credential_from_env())

    def judge(response: str, context: str) -> tuple[float, str]:
        out = evaluator(response=response, context=context)
        return float(out["groundedness"]), str(out.get("groundedness_reason", ""))

    name = f"`azure-ai-evaluation` {version('azure-ai-evaluation')} `GroundednessEvaluator`"
    return judge, name


def parse_seeds(text: str) -> list[int]:
    seeds: list[int] = []
    for part in text.split(","):
        lo, _, hi = part.strip().partition("-")
        seeds += list(range(int(lo), int(hi or lo) + 1))
    return seeds


async def main_async(args: argparse.Namespace) -> Path:
    from agents.llm import client_from_env
    from agents.telemetry import model_name

    client, close = client_from_env()
    if client is None:
        raise SystemExit("needs FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_MODEL (see .env.example)")
    seeds, personas = parse_seeds(args.seeds), tuple(args.personas.split(","))
    languages = tuple(args.languages.split(","))
    try:
        judge, evaluator = foundry_judge()
        cache = None if args.no_cache else CACHE
        results = await ablate(
            seeds, {m: client for m in MODES}, judge, personas, languages, cache_dir=cache,
            max_calls=args.max_calls, pace_s=args.pace, timeout_s=args.timeout, log=print,
        )  # fmt: skip
    finally:
        await close()
    done = {r.seed for r in results}
    meta = Meta(model=model_name(client), date=dt.date.today().isoformat(), evaluator=evaluator,
                seeds=seeds, personas=list(personas), languages=list(languages),
                skipped=[s for s in seeds if s not in done])  # fmt: skip
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "narration_ablation.md"
    path.write_text(report(results, meta))
    print(f"wrote {path}")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Free-text vs anchored narration (SPEC 6).")
    parser.add_argument("--seeds", default="3,100-104", help="e.g. 3,100-104")
    parser.add_argument("--personas", default=",".join(PERSONAS))
    parser.add_argument("--languages", default=",".join(LANGUAGES))
    parser.add_argument("--max-calls", type=int, default=MAX_CALLS)
    parser.add_argument("--pace", type=float, default=2.0, help="seconds between model batches")
    parser.add_argument("--timeout", type=float, default=TIMEOUT_S, help="seconds per call")
    parser.add_argument("--no-cache", action="store_true", help="ignore out/narration_ablation")
    asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    main()
