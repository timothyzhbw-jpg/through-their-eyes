"""Seasons: eval/season.py on independent seasons, with intervals across them (SPEC 3, 5, 6).

    uv run python -m eval.seasons                            # 5 seasons × 380 matches, all cores
    uv run python -m eval.seasons --seasons 2 --matches 38   # a quicker look (another report file)

These are properties of our simulator, whose perception and decision parameters come from
published papers (docs/REFERENCES.md); they are not findings about real football.

Each season is eval/season.py's: 380 stitched matches from one root seed (match seeds keyed by
(root, match number), hero and open-play seeds keyed off the match seed). The five roots, 2027 to
2031, are fresh (SPEC 3.6, the seed registry): season.md's season is root 2026 and is not one of
them. For every metric of season.md the report gives

- each season's value with its own 95% interval (a bootstrap over that season's matches for a
  per-match mean, Wilson for a share), so the spread *within* a season;
- the mean of the season values with a 95% t-interval over seasons, so the spread *across*
  seasons, which includes everything that differs from one season's seeds to the next;
- the value over all matches pooled, with its interval.

A season is cached in out/ under the same name eval/season.py uses
(`season_<root>_<matches>.pickle`), so seasons can be run one at a time with
`python -m eval.season --season-seed <root>` and then rendered together with `--from-cache`. It
prints the wall time; the report does not, so it regenerates byte for byte.
"""

from __future__ import annotations

import argparse
import math
import os
import pickle
import re
import sys
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from eval import realism
from eval.season import (
    BOOTSTRAP,
    FRAMING,
    LANGUAGES,
    MATCHES,
    OPEN_PLAY,
    PERSONAS,
    RERUN_EVERY,
    RESTART_NAMES,
    mean_ci,
    run_season,
    wilson,
)

REPORTS = Path(__file__).parent / "reports"
ROOTS = (2027, 2028, 2029, 2030, 2031)  # fresh season roots (SPEC 3.6); season.md's is 2026
# Two-sided 95% quantiles of Student's t, by degrees of freedom (seasons − 1).
T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
        9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120,
        17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086}  # fmt: skip

Results = list[dict[str, Any]]


@dataclass(frozen=True)
class Stat:
    """One metric in one season (or pooled): its value and 95% interval, and for a share k/n."""

    value: float
    lo: float = math.nan
    hi: float = math.nan
    k: int | None = None
    n: int | None = None


@dataclass(frozen=True)
class Metric:
    section: str
    label: str
    kind: str  # "mean" (per match), "share" or "count" (a season total)
    fn: Callable[[Results, dict[int, bool]], Stat]


def per_match(results: Results, f) -> Stat:
    m, lo, hi = mean_ci([f(r) for r in results])
    return Stat(m, lo, hi)


def share(k: int, n: int) -> Stat:
    lo, hi = wilson(k, n)
    return Stat(k / n if n else math.nan, lo, hi, k, n)


def across(values: list[float]) -> tuple[float, float, float]:
    """The mean of the season values and its 95% t-interval over seasons."""
    x = np.array([v for v in values if math.isfinite(v)], dtype=float)
    if x.size == 0:
        return math.nan, math.nan, math.nan
    if x.size == 1:
        return float(x[0]), math.nan, math.nan
    half = T975.get(x.size - 1, 1.96) * x.std(ddof=1) / math.sqrt(x.size)
    return float(x.mean()), float(x.mean() - half), float(x.mean() + half)


def pooled_value(sim: str) -> tuple[float, str]:
    """The pooled value at the head of a realism row's sim cell ("0.41 ± 0.19 (n = …)",
    "d = −0.04 (…)", "90.1% (…)"), and as printed; NaN and "—" for a row that does not start
    with one (an order)."""
    m = re.match(r"(?:d = )?([−-]?\d+(?:\.\d+)?)", sim)
    return (float(m[1].replace("−", "-")), m[1]) if m else (math.nan, "—")


# --- what is measured -----------------------------------------------------------------------------


def _heroes(results: Results) -> list[dict[str, Any]]:
    return [h for r in results for h in r["heroes"]]


def _built(results: Results) -> list[dict[str, Any]]:
    return [h for h in _heroes(results) if h["built"]]


def _verdicts(results: Results) -> Counter:
    total: Counter = Counter()
    for h in _built(results):
        total.update(h["verdicts"])
    return total


def _mean_of(f):
    """A per-match mean of f(match)."""
    return lambda rs, _: per_match(rs, f)


def _total(f):
    """A season total of f(hero) over the built breakdowns."""
    return lambda rs, _: Stat(float(sum(f(h) for h in _built(rs))))


def _share_of(items, hit):
    """The share of items(results) for which hit(item) holds."""

    def fn(rs, _):
        xs = items(rs)
        return share(sum(bool(hit(x)) for x in xs), len(xs))

    return fn


def _count_moments(cond):
    return _mean_of(lambda r: sum(bool(cond(m)) for m in r["moments"]))


def metrics(seasons: list[Results]) -> list[Metric]:
    """Every metric of season.md, over the union of what any season has (a restart kind, a
    moment kind or a lens one season never saw counts as zero there)."""
    everything = [r for results in seasons for r in results]
    restarts = sorted({k for r in everything for k in r["restarts"]})
    kinds = sorted({m["kind"] for r in everything for m in r["moments"]})
    lenses = sorted({m["lens"] for r in everything for m in r["moments"] if m["lens"]})
    scenarios = list(dict.fromkeys(h["scenario"] for h in _heroes(everything)))
    open_kinds = sorted(
        {f["kind"] for r in everything for f in r["open_flips"] if f["flip"] is not None}
    )
    claims = "Claims and the Verifier"
    flips = "Does the intervention change the outcome?"
    out = [
        Metric("Matches", "Possessions", "mean", _mean_of(lambda r: r["possessions"])),
        Metric("Matches", "Minutes of play", "mean", _mean_of(lambda r: r["duration_s"] / 60)),
        Metric("Matches", "Goals", "mean", _mean_of(lambda r: r["goals"])),
    ]
    for k in restarts:
        name = f"Restarts: {RESTART_NAMES.get(k, k)}"
        out.append(Metric("Matches", name, "mean", _mean_of(lambda r, k=k: r["restarts"][k])))
    out.append(Metric("Moments", "All moments", "mean", _mean_of(lambda r: len(r["moments"]))))
    for k in kinds:
        out.append(
            Metric("Moments", f"Kind `{k}`", "mean", _count_moments(lambda m, k=k: m["kind"] == k))
        )
    for lens in lenses:
        cond = _count_moments(lambda m, lens=lens: m["lens"] == lens)
        out.append(Metric("Moments", f"Selected lens `{lens}`", "mean", cond))
    out.append(
        Metric(
            "Moments",
            "No lens (live only or none available)",
            "mean",
            _count_moments(lambda m: m["lens"] is None),
        )
    )
    for s in scenarios:

        def tried(rs, s=s):
            return [h for h in _heroes(rs) if h["scenario"] == s]

        def found(rs, s=s):
            return [h for h in _heroes(rs) if h["scenario"] == s and h["detected"]]

        out += [
            Metric(
                "Heroes",
                f"`{s}`: hero moment detected",
                "share",
                _share_of(tried, lambda h: h["detected"]),
            ),
            Metric(
                "Heroes", f"`{s}`: breakdown built", "share", _share_of(found, lambda h: h["built"])
            ),
        ]
    out += [
        Metric(claims, "Breakdowns built", "count", _total(lambda h: 1)),
        Metric(
            claims,
            f"Scripts ({len(PERSONAS)} personas × {len(LANGUAGES)} languages each)",
            "count",
            _total(lambda h: h["scripts"]),
        ),
        Metric(
            claims,
            "Claims checked by the Verifier",
            "count",
            _total(lambda h: sum(h["verdicts"].values())),
        ),
        Metric(
            claims,
            "Claims supported",
            "share",
            lambda rs, _: share(_verdicts(rs)["supported"], sum(_verdicts(rs).values())),
        ),
        Metric(
            claims,
            "Unsupported claims on a viewer's payload (target 0)",
            "count",
            _total(lambda h: h["unverified_on_screen"]),
        ),
        Metric(
            claims,
            "Render violations, every payload re-checked (target 0)",
            "count",
            _total(lambda h: h["violations"]),
        ),
        Metric(
            claims,
            "Lines dropped before a payload was built",
            "count",
            _total(lambda h: h["dropped"]),
        ),
        Metric(claims, "Crew steps with an error", "count", _total(lambda h: h["step_errors"])),
    ]
    for s in scenarios:

        def measured(rs, s=s):
            return [h for h in _built(rs) if h["scenario"] == s and h["flip"] is not None]

        on = sorted({h["measure"] for h in measured(everything)})
        name = f"Hero `{s}` ({', '.join(on) or '—'})"
        out.append(Metric(flips, name, "share", _share_of(measured, lambda h: h["flip"])))
    for kind in open_kinds:

        def lens_flips(rs, kind=kind):
            return [
                f
                for r in rs
                for f in r["open_flips"]
                if f["kind"] == kind and f["flip"] is not None
            ]

        out.append(
            Metric(
                flips, f"Open play `{kind}`", "share", _share_of(lens_flips, lambda f: f["flip"])
            )
        )
    out.append(
        Metric(
            "Determinism",
            f"Every {RERUN_EVERY}th match re-built, byte-identical",
            "share",
            lambda _, same: share(sum(same.values()), len(same)),
        )
    )
    return out


def realism_rows(results: Results) -> list[realism.Row]:
    return realism.evaluate(
        [], observed=[r["observed"] for r in results], ablation=[r["ablation"] for r in results]
    )


# --- the report -----------------------------------------------------------------------------------


def _cell(stat: Stat, kind: str) -> str:
    if not math.isfinite(stat.value):
        return "—"
    if kind == "share":
        return f"{100 * stat.value:.1f}% ({100 * stat.lo:.1f}–{100 * stat.hi:.1f}%)"
    if kind == "count":
        return f"{stat.value:,.0f}"
    return f"{stat.value:.2f} ({stat.lo:.2f}–{stat.hi:.2f})"


def _across(values: list[float], kind: str) -> str:
    m, lo, hi = across(values)
    if not math.isfinite(m):
        return "—"
    scale, unit, fmt = (100.0, "%", ".1f") if kind == "share" else (1.0, "", ".2f")
    if kind == "count":
        fmt = ",.1f"
    if not math.isfinite(lo):
        return f"{scale * m:{fmt}}{unit}"
    return f"{scale * m:{fmt}}{unit} ({scale * lo:{fmt}} to {scale * hi:{fmt}}{unit})"


def _pooled(stat: Stat, kind: str) -> str:
    if kind == "share" and stat.n:
        return f"{stat.k:,}/{stat.n:,} = {_cell(stat, kind)}"
    return _cell(stat, kind)


def render(seasons: list[Results], same: list[dict[int, bool]], roots: list[int]) -> str:
    everything = [r for results in seasons for r in results]
    every_same = {(i, j): ok for i, s in enumerate(same) for j, ok in s.items()}
    k = len(seasons)
    n = len(seasons[0]) if seasons else 0
    lines = [
        "# Seasons — the pipeline on independent seasons",
        "",
        FRAMING,
        "",
        f"`uv run python -m eval.seasons`: {k} seasons of {n} stitched matches each, from root "
        f"seeds {', '.join(map(str, roots))} (fresh: SPEC 3.6's seed registry), every one "
        "eval/season.py's season: match-1's plan with its own match seeds and fresh hero seeds, "
        "the whole pipeline offline. For every metric: each season's value with its own 95% "
        f"interval (Wilson for a share, a bootstrap over that season's matches, {BOOTSTRAP} "
        "resamples, for a per-match mean); the mean of the season values with a 95% t-interval "
        f"over the {k} seasons (*across*: how much a result moves from one season's seeds to the "
        f"next); and the value over all {len(everything):,} matches pooled.",
        "",
        "Means per match unless marked; a count is the season's total.",
    ]
    table = metrics(seasons)
    header = (
        "| Metric | " + " | ".join(map(str, roots)) + " | Across seasons: mean (95% CI) | "
        "All matches pooled |"
    )
    rule = "|---|" + "---|" * (len(roots) + 2)
    section = None
    for m in table:
        if m.section != section:
            section = m.section
            lines += ["", f"## {section}", "", header, rule]
        stats = [m.fn(results, s) for results, s in zip(seasons, same, strict=True)]
        pooled = m.fn(everything, every_same)
        cells = [_cell(s, m.kind) for s in stats]
        label = f"{m.label} (season total)" if m.kind == "count" else m.label
        spread = _across([s.value for s in stats], m.kind)
        lines.append(f"| {label} | " + " | ".join(cells) + f" | {spread} | "
                     f"{_pooled(pooled, m.kind)} |")  # fmt: skip
    lines += [
        "",
        "Goals come from the plan's shooting hero (`far_post_finish`, once per match) and, rarely, "
        "a ball that rolls into a goal in open play (Law 10.1 counts any ball, SPEC 3.9), so the "
        "count is not a measured scoring rate.",
    ]
    failures = [
        (roots[i], h["scenario"], h["seed"], h["error"])
        for i, results in enumerate(seasons)
        for h in _heroes(results)
        if h["detected"] and not h["built"]
    ]
    if failures:
        causes = Counter((s, err.rstrip(": ")) for _, s, _, err in failures)
        lines += ["", "Breakdowns that failed, by cause (all seasons):", ""]
        for (scenario, err), count in causes.items():
            lines.append(f"- `{scenario}`, {count}×: {err}")
    lines += realism_section(seasons, roots)
    return "\n".join(lines) + "\n"


def realism_section(seasons: list[Results], roots: list[int]) -> list[str]:
    per_season = [realism_rows(results) for results in seasons]
    pooled = realism_rows([r for results in seasons for r in results])
    lines = [
        "",
        "## Realism at season scale",
        "",
        "eval/realism.py's rows on each season's open play (the bootstrap resamples matches), "
        "with the ranges and sources of [realism.md](realism.md). A season's cell is its pooled "
        "value and whether it is inside the published range; *across* is the mean of the season "
        "values with a t-interval, and how many seasons are inside.",
        "",
        "| Rows | " + " | ".join(map(str, roots)) + " | Across seasons: mean (95% CI) | "
        "All matches pooled |",
        "|---|" + "---|" * (len(roots) + 2),
    ]
    for label, key in (("inside", realism.INSIDE), ("outside", realism.OUTSIDE),
                       ("inconclusive", realism.INCONCLUSIVE)):  # fmt: skip
        counts = [sum(r.inside == key for r in rows) for rows in per_season]
        lines.append(
            f"| Rows {label} | " + " | ".join(map(str, counts))
            + f" | {_across([float(c) for c in counts], 'mean')} | "
            f"{sum(r.inside == key for r in pooled)} |"
        )  # fmt: skip
    lines += [
        "",
        "| Metric | " + " | ".join(map(str, roots)) + " | Across seasons: mean (95% CI) | "
        "All matches pooled | Published |",
        "|---|" + "---|" * (len(roots) + 3),
    ]
    mark = {realism.INSIDE: " ✅", realism.OUTSIDE: " ❌"}
    for j, row in enumerate(pooled):
        rows = [season[j] for season in per_season]
        read = [pooled_value(r.sim) for r in rows]
        values = [v for v, _ in read]
        cells = [text + mark.get(r.inside, "") for (_, text), r in zip(read, rows, strict=True)]
        judged = [r for r in rows if r.inside in (realism.INSIDE, realism.OUTSIDE)]
        inside = sum(r.inside == realism.INSIDE for r in judged)
        tail = f"; inside in {inside}/{len(rows)}" if judged else ""
        row_cells = (row.label, *cells, f"{_across(values, 'mean')}{tail}",
                     f"{row.sim}{mark.get(row.inside, '')}", row.published)  # fmt: skip
        lines.append("| " + " | ".join(c.replace("|", "\\|") for c in row_cells) + " |")
    lines += [
        "",
        "A row whose sim cell does not start with a number (the positional order) has no season "
        "value; its ✅ or ❌ still says whether the order held. † marks a value the sim was "
        f"calibrated to on tuning seeds (sim/config.py). Open play here is `{OPEN_PLAY}`, run "
        "to the plan's caps.",
    ]
    return lines


# --- running it -----------------------------------------------------------------------------------


def report_name(roots: list[int], matches: int, default: bool) -> str:
    """seasons_intervals.md, or with the roots and size for another run. Not eval.season
    --seasons's seasons_<first>-<last>.md, which shows the same caches side by side."""
    if default:
        return "seasons_intervals.md"
    return f"seasons_intervals_{roots[0]}-{roots[-1]}_{matches}.md"


def _cache(root: int, matches: int) -> Path:
    return Path("out") / f"season_{root}_{matches}.pickle"  # the name eval/season.py writes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seasons", type=int, default=len(ROOTS))
    parser.add_argument("--first-root", type=int, default=ROOTS[0])
    parser.add_argument("--matches", type=int, default=MATCHES)
    parser.add_argument("--workers", type=int, default=os.cpu_count())
    parser.add_argument(
        "--from-cache", action="store_true", help="render the seasons' cached results (out/)"
    )
    args = parser.parse_args()
    t0 = time.time()
    roots = list(range(args.first_root, args.first_root + args.seasons))
    seasons, same = [], []
    for root in roots:
        cache = _cache(root, args.matches)
        if args.from_cache:
            results, s = pickle.loads(cache.read_bytes())
        else:
            print(f"season {root}", file=sys.stderr, flush=True)
            results, s = run_season(root, args.matches, args.workers)
            cache.parent.mkdir(exist_ok=True)
            cache.write_bytes(pickle.dumps((results, s)))
        seasons.append(results)
        same.append(s)
    report = render(seasons, same, roots)
    REPORTS.mkdir(exist_ok=True)
    default = (args.seasons, args.first_root, args.matches) == (len(ROOTS), ROOTS[0], MATCHES)
    path = REPORTS / report_name(roots, args.matches, default)
    path.write_text(report)
    print(report.split("\n## Realism")[0])
    print(f"\nwrote {path} in {time.time() - t0:.0f} s on {args.workers} workers")


if __name__ == "__main__":
    main()
