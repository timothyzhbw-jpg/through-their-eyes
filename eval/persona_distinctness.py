"""Persona distinctness (SPEC 6, "Persona specs"): how different the five audiences' breakdowns of
one hero moment are, in what is said and in what is shown.

    uv run python -m eval.persona_distinctness
    uv run python -m eval.persona_distinctness --runs out/crew_vs_single/runs/*_crew_*_none.json

Runs the crew offline (templates, no model call) on the served hero moments (blind_side_run-3,
press_escape-0 and match-1's far_post_finish-11 and corner_blind_side-0) for every persona in
`en` and `zh`. `--runs` also scores breakdowns a model wrote (a `BreakdownResult` JSON, or a file
holding one under `result`), reported apart. Per script: spoken lines, words (`en`) or characters
(`zh`), the numbers it says (numeric slots, `agents.persona_rules.numbers`), lines with a number,
lines with jargon (`JARGON`). Per moment and language: the claim Jaccard of every pair of personas
and whether their first lines differ. Per persona: the plan it plays (its own when the breakdown
has one, else the breakdown's): camera beats, overlays, and what is on screen in its first 5 s.

The gate (`gate`, tests/test_persona_distinctness.py): mean pairwise claim Jaccard at most
`MAX_MEAN_JACCARD` and no pair of personas above `MAX_PAIR_JACCARD` (why: next to them), every
pair of personas opening on a different line, a different plan for every persona of a moment,
every script within its persona's spec and rules (`agents.persona_rules.SPECS`, `RULES`), every
aired line verified, no number in text a model wrote.

The before: `--before-runs` measures breakdowns an earlier checkout wrote (main 7c424f3d + #191,
offline, `persona_distinctness_before.json` keeps the measurement) against today's specs and rules;
`--before` reads that JSON again. Writes eval/reports/persona_distinctness.md.
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import re
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, get_args

from agents import persona_rules
from agents.context import MomentContext
from agents.schemas import PLAYER_ID, BreakdownResult, Language, Persona
from explain.numbers import number_tokens
from explain.render import ScriptLine as RenderLine
from explain.render import render_line

REPORTS = Path(__file__).parent / "reports"
HEROES: tuple[tuple[str, int], ...] = (
    ("blind_side_run", 3), ("press_escape", 0), ("far_post_finish", 11), ("corner_blind_side", 0),
)  # fmt: skip
PERSONAS: tuple[Persona, ...] = get_args(Persona)
LANGUAGES: tuple[Language, ...] = get_args(Language)
FIRST_S = 5.0  # "within the first 5 seconds"

# Every persona must tell the same verified facts (SPEC 1: persona changes presentation, never
# facts), so two scripts always share the moment's core: the counterfactual, and often the look.
# That core is one or two claims; scripts are three to seven claims long. Sharing the core and
# nothing else gives a Jaccard of 0.1–0.35, so the mean over all pairs must stay at or under 0.30.
# At 0.5 half of what two audiences hear together is the same sentences, the most that still
# sounds like two different broadcasts: no pair of personas may average more.
MAX_MEAN_JACCARD = 0.30
MAX_PAIR_JACCARD = 0.5

# Words a casual fan would not use, per language. A line with one of them is a jargon line.
JARGON: dict[Language, dict[str, re.Pattern[str]]] = {
    "en": {
        "xT": re.compile(r"expected threat|\bxT\b", re.I),
        "pressing": re.compile(r"pressing intensity", re.I),
        "scan": re.compile(r"\bscan(?:s|ned|ning)?\b", re.I),
        "pitch control": re.compile(r"space the opponents controlled|pitch control", re.I),
        "probability": re.compile(r"\bchance of\b|\ba \d\.\d+ chance\b|probability", re.I),
        "belief error": re.compile(r"picture of .+ (?:was|is) off", re.I),
    },
    "zh": {
        "xT": re.compile(r"预期威胁|xT"),
        "pressing": re.compile(r"逼抢强度"),
        "scan": re.compile(r"回头观察了"),  # "scanned once": not 回头观察 alone, as en "checked"
        "pitch control": re.compile(r"控制区域"),
        "probability": re.compile(r"概率|成功率"),
        "belief error": re.compile(r"判断(?:会)?偏差"),
    },
}
_CJK = re.compile(r"[一-鿿]")


def length(text: str, language: Language) -> int:
    """Words in English; characters (CJK, plus Latin words and numbers) in Chinese."""
    if language == "zh":
        return len(_CJK.findall(text)) + len(re.findall(r"[A-Za-z0-9.]+", text))
    return len(text.split())


@dataclass
class ScriptStats:
    moment: str
    persona: Persona
    language: Language
    lines: int
    length: int  # words (en) or characters (zh)
    numbers: int
    numbered_lines: int
    jargon_lines: int
    jargon: list[str]
    claims: list[str]
    first_line: str
    texts: list[str]
    verified: bool  # every aired line passes the render check again
    problems: list[str]  # persona rules and spec breaks; empty when it follows its spec
    plan: dict[str, Any] = field(default_factory=dict)


def plan_summary(plan: Mapping[str, Any]) -> dict[str, Any]:
    """Camera beats (in order, repeats collapsed), overlays turned on, and what is on screen in the
    first `FIRST_S` seconds of the plan."""
    steps = plan.get("steps", [])
    cameras: list[str] = []
    overlays: list[str] = []
    first: list[str] = []
    for s in steps:
        do = s["do"]
        tag = None
        if do == "camera":
            tag = f"camera {s['mode']}"
            if not cameras or cameras[-1] != s["mode"]:
                cameras.append(s["mode"])
        elif do == "pov":
            tag = f"pov ×{s['speed']:g}"
        elif do == "zone":
            tag = f"zone {s['layer']}"
            overlays.append(s["layer"])
        elif do == "ghost":
            tag = f"ghost {s['kind']}"
            overlays.append(f"{s['kind']} ghost")
        elif do == "scan_marker":
            tag = "scan marker"
            overlays.append("scan marker")
        if tag and s["t"] <= FIRST_S:
            first.append(tag)
    return {"cameras": cameras, "overlays": sorted(set(overlays)), "first": first,
            "duration_s": plan.get("duration_s")}  # fmt: skip


def script_stats(
    ctx: MomentContext, result: Mapping[str, Any], script: Mapping[str, Any]
) -> ScriptStats:
    persona, language = script["persona"], script["language"]
    lines = script["payload"]["lines"]
    texts = [line["text"] for line in lines]
    claims = [c for line in lines for c in line["claims"]]
    supported = ctx.supported
    per_line = [
        sum(persona_rules.numbers(supported[c], language) for c in line["claims"] if c in supported)
        for line in lines
    ]
    hits = [sorted(k for k, p in JARGON[language].items() if p.search(t)) for t in texts]
    verified = all(
        render_line(RenderLine(id=line["id"], text=raw["text"], claims=raw["claims"]),
                    ctx.claims, ctx.verdicts, language, ctx.names).ok
        for line, raw in zip(lines, script["lines"], strict=True)
    )  # fmt: skip
    plan = script.get("plan") or result["plan"]
    stats = ScriptStats(
        moment=ctx.card.id, persona=persona, language=language, lines=len(lines),
        length=sum(length(t, language) for t in texts), numbers=sum(per_line),
        numbered_lines=sum(1 for n in per_line if n), jargon_lines=sum(1 for h in hits if h),
        jargon=sorted({k for h in hits for k in h}), claims=claims,
        first_line=texts[0] if texts else "", texts=texts, verified=verified, problems=[],
        plan=plan_summary(plan),
    )  # fmt: skip
    script_lines = [_line(raw) for raw in script["lines"]]
    stats.problems = persona_rules.problems(
        persona, script_lines, supported, ctx.card.selected_lens, language
    ) + spec_problems(stats)
    return stats


def _line(raw: Mapping[str, Any]):
    from agents.schemas import ScriptLine

    return ScriptLine.model_validate(raw)


def spec_problems(s: ScriptStats) -> list[str]:
    """Where a script falls outside its persona's spec (agents/persona_rules.py `SPECS`)."""
    spec = getattr(persona_rules, "SPECS", {}).get(s.persona)
    if spec is None:
        return []
    out = []
    lo, hi = spec.lines
    if not lo <= s.lines <= hi:
        out.append(f"{s.lines} lines, spec {lo}–{hi}")
    most = spec.length[s.language]
    if s.length > most:
        out.append(f"{s.length} {'characters' if s.language == 'zh' else 'words'}, spec ≤ {most}")
    if spec.min_numbers and s.numbers < spec.min_numbers:
        out.append(f"{s.numbers} numbers, spec ≥ {spec.min_numbers}")
    if spec.max_jargon_lines is not None and s.jargon_lines > spec.max_jargon_lines:
        out.append(f"{s.jargon_lines} jargon lines, spec ≤ {spec.max_jargon_lines}")
    return out


def jaccard(a: Iterable[str], b: Iterable[str]) -> float:
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb) if sa | sb else 1.0


@dataclass
class Measurement:
    label: str
    scripts: list[ScriptStats]
    model_digits: int  # numbers in text a model wrote (the Director's reason, the Analyst's angle)

    def groups(self) -> dict[tuple[str, str], dict[str, ScriptStats]]:
        out: dict[tuple[str, str], dict[str, ScriptStats]] = {}
        for s in self.scripts:
            out.setdefault((s.moment, s.language), {})[s.persona] = s
        return out

    def pairs(self) -> list[tuple[str, str, str, str, float, bool]]:
        """(moment, language, persona a, persona b, claim Jaccard, first lines differ)."""
        out = []
        for (moment, language), by in self.groups().items():
            for a, b in itertools.combinations([p for p in PERSONAS if p in by], 2):
                out.append((moment, language, a, b, jaccard(by[a].claims, by[b].claims),
                            by[a].first_line != by[b].first_line))  # fmt: skip
        return out

    def mean_jaccard(self) -> float:
        pairs = self.pairs()
        return statistics.fmean(p[4] for p in pairs) if pairs else float("nan")

    def pair_means(self) -> dict[tuple[str, str], float]:
        out: dict[tuple[str, str], list[float]] = {}
        for _, _, a, b, j, _ in self.pairs():
            out.setdefault((a, b), []).append(j)
        return {k: statistics.fmean(v) for k, v in out.items()}

    def distinct_openers(self) -> float:
        pairs = self.pairs()
        return sum(p[5] for p in pairs) / len(pairs) if pairs else float("nan")

    def by_persona(self) -> dict[str, dict[str, Any]]:
        out = {}
        for p in PERSONAS:
            rows = [s for s in self.scripts if s.persona == p]
            if not rows:
                continue

            def mean(f, rows=rows) -> float:
                return statistics.fmean(f(s) for s in rows)

            en = [s for s in rows if s.language == "en"]
            zh = [s for s in rows if s.language == "zh"]
            out[p] = {
                "scripts": len(rows),
                "lines": (min(s.lines for s in rows), mean(lambda s: s.lines),
                          max(s.lines for s in rows)),
                "words_en": statistics.fmean(s.length for s in en) if en else None,
                "chars_zh": statistics.fmean(s.length for s in zh) if zh else None,
                "numbers": (mean(lambda s: s.numbers), max(s.numbers for s in rows)),
                "numbered_share": sum(s.numbered_lines for s in rows) / sum(s.lines for s in rows),
                "jargon_share": sum(s.jargon_lines for s in rows) / sum(s.lines for s in rows),
                "jargon": sorted({j for s in rows for j in s.jargon}),
                "verified": all(s.verified for s in rows),
                "problems": sum(1 for s in rows if s.problems),
            }  # fmt: skip
        return out

    def to_json(self) -> dict[str, Any]:
        return {"label": self.label, "model_digits": self.model_digits,
                "scripts": [asdict(s) for s in self.scripts]}  # fmt: skip

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> Measurement:
        return cls(data["label"], [ScriptStats(**s) for s in data["scripts"]], data["model_digits"])


def measure(label: str, runs: Sequence[tuple[MomentContext, Mapping[str, Any]]]) -> Measurement:
    scripts, digits = [], 0
    for ctx, result in runs:
        by_model = {t["step"] for t in result["trace"] if t["source"] == "llm"}
        written = [result["request"].get("reason") if "director" in by_model else None,
                   result["findings"].get("angle") if "analyst" in by_model else None]  # fmt: skip
        for text in written:
            # As `agents.schemas.no_numbers` reads it: a player id (H8) is not a number.
            digits += len(number_tokens(PLAYER_ID.sub("X", text or "")))
        scripts += [script_stats(ctx, result, s) for s in result["scripts"]]
    return Measurement(label, scripts, digits)


def offline_runs(
    heroes: Sequence[tuple[str, int]] = HEROES,
    personas: Sequence[Persona] = PERSONAS,
    languages: Sequence[Language] = LANGUAGES,
) -> list[tuple[MomentContext, dict[str, Any]]]:
    """The crew offline (every step on its template) on each hero, every persona and language."""
    from agents.workflow import run_crew

    out = []
    for scenario, seed in heroes:
        ctx = MomentContext.load(scenario, seed)
        run = asyncio.run(run_crew(ctx, client=None, personas=tuple(personas),
                                   languages=tuple(languages)))  # fmt: skip
        out.append((ctx, run.result.model_dump(mode="json", by_alias=True)))
    return out


def load_runs(paths: Sequence[Path]) -> list[tuple[MomentContext, dict[str, Any]]]:
    """Breakdowns from files: `<scenario>-<seed>_...json` holding a BreakdownResult (or one under
    `result`). The moment is loaded again to re-check its lines."""
    out = []
    contexts: dict[tuple[str, int], MomentContext] = {}
    for path in paths:
        data = json.loads(Path(path).read_text())
        result = data.get("result", data)
        BreakdownResult.model_validate(result)
        scenario, seed = data.get("scenario"), data.get("seed")
        if scenario is None:
            stem = Path(path).name.split("_crew")[0].split("_single")[0]
            scenario, _, seed = stem.rpartition("-")
        key = (scenario, int(seed))
        if key not in contexts:
            contexts[key] = MomentContext.load(*key)
        out.append((contexts[key], result))
    return out


@dataclass
class Gate:
    mean_jaccard: float
    max_pair_jaccard: float  # the closest pair of personas, averaged over moments and languages
    in_spec: int
    scripts: int
    verified: int
    model_digits: int
    distinct_openers: float
    distinct_plans: int  # the fewest different plans among the personas of one moment

    @property
    def passed(self) -> bool:
        return (
            self.mean_jaccard <= MAX_MEAN_JACCARD
            and self.max_pair_jaccard <= MAX_PAIR_JACCARD
            and self.distinct_openers == 1.0
            and self.distinct_plans == len(PERSONAS)
            and self.in_spec == self.scripts
            and self.verified == self.scripts
            and self.model_digits == 0
        )


def gate(m: Measurement) -> Gate:
    pairs = m.pair_means()
    return Gate(
        mean_jaccard=m.mean_jaccard(),
        max_pair_jaccard=max(pairs.values()) if pairs else float("nan"),
        in_spec=sum(1 for s in m.scripts if not s.problems),
        scripts=len(m.scripts),
        verified=sum(1 for s in m.scripts if s.verified),
        model_digits=m.model_digits,
        distinct_openers=m.distinct_openers(),
        distinct_plans=min(
            (len({json.dumps(s.plan, sort_keys=True) for s in by.values()})
             for (_, language), by in m.groups().items() if language == "en"),
            default=0,
        ),
    )  # fmt: skip


# --- the report ----------------------------------------------------------------------------------

LABEL = {"casual": "casual", "analyst": "analyst", "player_fan": "player fan", "coach": "coach",
         "audio_description": "audio description"}  # fmt: skip


def _f(x: float | None, d: int = 2) -> str:
    return "–" if x is None else f"{x:.{d}f}"


def _summary_rows(m: Measurement) -> list[str]:
    g = gate(m)
    return [
        f"| mean pairwise claim Jaccard | {_f(g.mean_jaccard)} |",
        f"| persona pairs whose first line differs | {g.distinct_openers:.0%} |",
        f"| scripts within their persona's spec | {g.in_spec} of {g.scripts} |",
        f"| scripts whose every line verifies again | {g.verified} of {g.scripts} |",
        f"| numbers in text a model wrote | {g.model_digits} |",
    ]


def _persona_table(m: Measurement) -> list[str]:
    rows = [
        "| persona | lines (min–max, mean) | words en | chars zh | numbers (mean, max) "
        "| lines with a number | jargon lines | jargon | out of spec |",
        "|---|---|---:|---:|---|---:|---:|---|---:|",
    ]
    for p, d in m.by_persona().items():
        lo, mean, hi = d["lines"]
        rows.append(
            f"| {LABEL[p]} | {lo}–{hi}, {mean:.1f} | {_f(d['words_en'], 0)} | "
            f"{_f(d['chars_zh'], 0)} | {d['numbers'][0]:.1f}, {d['numbers'][1]} | "
            f"{d['numbered_share']:.0%} | {d['jargon_share']:.0%} | "
            f"{', '.join(d['jargon']) or '–'} | {d['problems']} of {d['scripts']} |"
        )
    return rows


def _pair_table(m: Measurement) -> list[str]:
    means = m.pair_means()
    head = "| | " + " | ".join(LABEL[p] for p in PERSONAS[1:]) + " |"
    rows = [head, "|---|" + "---:|" * (len(PERSONAS) - 1)]
    for i, a in enumerate(PERSONAS[:-1]):
        cells = []
        for j, b in enumerate(PERSONAS[1:], start=1):
            cells.append(_f(means.get((a, b))) if j > i else "")
        rows.append(f"| {LABEL[a]} | " + " | ".join(cells) + " |")
    return rows


def _plan_table(m: Measurement) -> list[str]:
    rows = ["| persona | camera beats | overlays | on screen in the first 5 s |",
            "|---|---|---|---|"]  # fmt: skip
    seen: dict[str, dict[str, Any]] = {}
    for s in m.scripts:
        if s.moment == m.scripts[0].moment and s.language == "en" and s.plan:
            seen.setdefault(s.persona, s.plan)
    for p in PERSONAS:
        plan = seen.get(p)
        if plan is None:
            continue
        rows.append(f"| {LABEL[p]} | {' → '.join(plan['cameras'])} | "
                    f"{', '.join(plan['overlays'])} | {', '.join(plan['first'])} |")  # fmt: skip
    return rows


def _scripts_side_by_side(m: Measurement, moment: str, language: Language) -> list[str]:
    rows = []
    for s in m.scripts:
        if s.moment == moment and s.language == language:
            unit = "chars" if language == "zh" else "words"
            rows.append(f"- **{LABEL[s.persona]}** ({s.lines} lines, {s.length} {unit}, "
                        f"{s.numbers} numbers)")  # fmt: skip
            rows += [f"  {k}. {t}" for k, t in enumerate(s.texts, start=1)]
    return rows


def report(after: Measurement, before: Measurement | None, models: list[Measurement]) -> str:
    out = [
        '# Persona distinctness (SPEC 6, "Persona specs")',
        "",
        "How different the five audiences' breakdowns of one hero moment are, in what is said and "
        "in what is shown. Written by `uv run python -m eval.persona_distinctness`.",
        "",
        "- **Moments:** the served hero moments: blind_side_run-3 (a look before a pass), "
        "press_escape-0 (a pass under pressure), far_post_finish-11 (a look before a shot) and "
        "corner_blind_side-0 (a marker's look). Every persona × `en`, `zh`: 40 scripts.",
        "- **Crew:** offline, every step on its template, so the numbers are reproducible and cost "
        "no model call. A model picks among the same claims under the same persona rules (the "
        "schema enum, the Verifier's script check and `repair`), so the template scripts are what "
        "the rules allow at their tightest; model runs are measured apart when given (`--runs`).",
        "- **Jaccard:** of the claim ids two personas' scripts cite, per moment and language, "
        f"averaged over the 10 pairs × 8. Gate: mean ≤ {MAX_MEAN_JACCARD} (why: "
        "`MAX_MEAN_JACCARD` in the script). **Length:** words in `en`, characters in `zh`. "
        "**Numbers:** numeric slots the cited claims say. **Jargon:** a line saying expected "
        "threat, pressing intensity, scan(ned), the space the opponents controlled, a chance or "
        "probability, or a belief error (`JARGON`).",
        "",
    ]
    if before is not None:
        b, a = gate(before), gate(after)
        out += [
            "## Before and after",
            "",
            f"| | {before.label} | {after.label} |",
            "|---|---:|---:|",
            f"| mean pairwise claim Jaccard (gate ≤ {MAX_MEAN_JACCARD}) | {_f(b.mean_jaccard)} "
            f"| {_f(a.mean_jaccard)} |",
            f"| closest pair of personas, mean Jaccard (gate ≤ {MAX_PAIR_JACCARD}) | "
            f"{_most(before)} | {_most(after)} |",
            f"| persona pairs whose first line differs (gate 100%) | {b.distinct_openers:.0%} | "
            f"{a.distinct_openers:.0%} |",
            f"| different plans among the 5 personas of a moment, fewest (gate 5) | "
            f"{b.distinct_plans} | {a.distinct_plans} |",
            f"| scripts within their persona's spec and rules | {b.in_spec} of {b.scripts} | "
            f"{a.in_spec} of {a.scripts} |",
            f"| scripts whose every line verifies again | {b.verified} of {b.scripts} | "
            f"{a.verified} of {a.scripts} |",
            f"| numbers in text a model wrote | {b.model_digits} | {a.model_digits} |",
            "",
            f"**Gate: {'passed' if gate(after).passed else 'FAILED'}.**",
            "",
        ]
    for m in ([before] if before is not None else []) + [after]:
        out += [f"## {m.label}", "", "| | |", "|---|---|", *_summary_rows(m), "",
                "Per persona (all four moments, both languages):", "", *_persona_table(m), "",
                "Mean claim Jaccard per pair:", "", *_pair_table(m), "",
                "The plan each persona plays (blind_side_run-3):", "", *_plan_table(m), "",
                "blind_side_run-3, `en`, side by side:", "",
                *_scripts_side_by_side(m, m.scripts[0].moment, "en"), ""]  # fmt: skip
        out += _problem_rows(m)
    for m in models:
        out += [f"## Model sample: {m.label}", "", "| | |", "|---|---|", *_summary_rows(m), "",
                *_persona_table(m), "", *_pair_table(m), ""]  # fmt: skip
    return "\n".join(out).rstrip() + "\n"


def _problem_rows(m: Measurement) -> list[str]:
    bad = [s for s in m.scripts if s.problems]
    if not bad:
        return []
    return (
        ["Scripts outside their spec:", ""]
        + [f"- {s.moment} {LABEL[s.persona]} {s.language}: {'; '.join(s.problems)}" for s in bad]
        + [""]
    )


def _most(m: Measurement) -> str:
    (a, b), j = max(m.pair_means().items(), key=lambda kv: kv[1])
    return f"{LABEL[a]} / {LABEL[b]} {j:.2f}"


def main(argv: Sequence[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--runs", nargs="*", type=Path, default=[],
                   help="model breakdowns to score apart (BreakdownResult JSON files)")  # fmt: skip
    p.add_argument("--runs-label", default="model runs")
    p.add_argument("--old-runs", nargs="*", type=Path, default=[],
                   help="model breakdowns from before this change, scored apart too")  # fmt: skip
    p.add_argument("--old-runs-label", default="model runs before")
    p.add_argument("--label", default="this code")
    p.add_argument("--before", type=Path, default=REPORTS / "persona_distinctness_before.json",
                   help="an earlier measurement (JSON), for the before/after table")  # fmt: skip
    p.add_argument("--before-runs", nargs="*", type=Path, default=[],
                   help="breakdowns an earlier checkout wrote: measured as the before, saved "
                   "to --before")  # fmt: skip
    p.add_argument("--before-label", default="before")
    p.add_argument("--save-json", type=Path, default=None)
    p.add_argument("--out", type=Path, default=REPORTS / "persona_distinctness.md")
    a = p.parse_args(argv)
    after = measure(a.label, offline_runs())
    if a.save_json:
        a.save_json.write_text(json.dumps(after.to_json(), ensure_ascii=False, indent=1) + "\n")
    before = None
    if a.before_runs:
        before = measure(a.before_label, load_runs(a.before_runs))
        a.before.write_text(json.dumps(before.to_json(), ensure_ascii=False, indent=1) + "\n")
    elif a.before and a.before.is_file() and a.before.stat().st_size and a.before != a.save_json:
        before = Measurement.from_json(json.loads(a.before.read_text()))
    models = [measure(a.runs_label, load_runs(a.runs))] if a.runs else []
    if a.old_runs:
        models.append(measure(a.old_runs_label, load_runs(a.old_runs)))
    a.out.write_text(report(after, before, models))
    g = gate(after)
    print(f"mean Jaccard {g.mean_jaccard:.3f}, worst pair {g.max_pair_jaccard:.3f}, "
          f"plans {g.distinct_plans}, openers differ {g.distinct_openers:.0%}, "
          f"in spec {g.in_spec}/{g.scripts}, verified {g.verified}/{g.scripts}, "
          f"model digits {g.model_digits}: {'passed' if g.passed else 'FAILED'}")  # fmt: skip
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
