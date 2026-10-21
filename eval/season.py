"""Season: the whole pipeline, offline, on a season of stitched matches (SPEC 3, 5, 6).

    uv run python -m eval.season                  # 380 matches from season seed 2026, all cores
    uv run python -m eval.season --matches 38     # a quicker look (another report file)
    uv run python -m eval.season --season-seed 2027 --seasons 5   # five seasons side by side

These are properties of our simulator, whose perception and decision parameters come from
published papers (docs/REFERENCES.md); they are not findings about real football.

A season is 380 matches, as in a 20-team league, reproducible from one season seed. Every match
plays match-1's plan (`sim.match.DEFAULT_PLAN`: open play to fixed caps and the heroes on main),
with its own match seed and fresh hero seeds (keyed off the match seed, at least 1,000,000, so
never a design or eval seed). For each match, offline (no model calls):

- build it and detect and explain every possession's moments (`explain_moments`: lenses and
  their counterfactuals);
- for each hero possession, find the hero moment (`hero_card`), load its MomentContext (the
  scenario's counterfactual, the claims and the Verifier) and run the crew with the offline
  templates for every persona and language; re-check every payload a viewer would receive
  (`check_payload`) and every claim on it against the Verifier;
- measure whether the scenario's intervention changes the outcome (heroes) and whether the
  selected lens's counterfactual does (open play);
- collect the realism tables of its open play (eval/realism.py), and the same receptions with
  the pressure term off for realism's ablation row.

Every 19th match is built again and byte-compared. Writes eval/reports/season.md (or
season_<seed>_<n>.md for another season), and keeps the raw results in out/ so that
`--from-cache` renders the report again without re-running the season. It prints the wall
time; the report does not, so it regenerates byte for byte.

`--seasons K` runs K independent seasons, season seeds `--season-seed` to `--season-seed` + K − 1,
each exactly as above and cached on its own, and writes eval/reports/seasons_<first>-<last>.md:
every season's counts side by side, and all of them pooled with 95% intervals.
"""

from __future__ import annotations

import argparse
import math
import os
import pickle
import sys
import time
import traceback
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path
from typing import Any, get_args

import numpy as np

from agents.context import MomentContext
from agents.schemas import Language, Persona
from agents.workflow import breakdown
from eval import realism
from explain.cards import MomentCard
from explain.lenses import explain_moments, marker_scan_lens
from explain.moments import MARKED_M, hero_card
from explain.render import check_payload
from sim.config import SimParams
from sim.counterfactual import CounterfactualResult, possession_result
from sim.engine import Simulation
from sim.match import DEFAULT_PLAN, SEED_BASE, Possession, PossessionSpec, build_match
from sim.rng import KeyedRng

REPORTS = Path(__file__).parent / "reports"
FRAMING = (
    "These are properties of our simulator, whose perception and decision parameters come from "
    "published papers (docs/REFERENCES.md); they are not findings about real football."
)
SEASON_SEED = 2026
MATCHES = 380  # a 20-team league, home and away
MATCH_SEED_BASE = 10_000_000  # match seeds; open-play and hero seeds are keyed off them
RERUN_EVERY = 19  # matches built a second time and byte-compared
BOOTSTRAP = 1000
BOOTSTRAP_SEED = 20261021
PERSONAS: tuple[Persona, ...] = get_args(Persona)
LANGUAGES: tuple[Language, ...] = get_args(Language)
OPEN_PLAY = "possession_play"
RESTART_NAMES = {"kick_off": "kick-off", "throw_in": "throw-in", "goal_kick": "goal kick"}


# --- the season --------------------------------------------------------------------------------


def match_seeds(season_seed: int, n: int) -> list[int]:
    """The season's match seeds, keyed by (season seed, match number)."""
    rng = KeyedRng(season_seed)
    seeds = [
        MATCH_SEED_BASE + int(rng.generator("season_match", i).integers(0, 2**31 - MATCH_SEED_BASE))
        for i in range(n)
    ]
    if len(set(seeds)) != len(seeds):
        raise ValueError(f"season {season_seed}: two matches drew the same seed")
    return seeds


def hero_seed(match_seed: int, k: int) -> int:
    """A fresh seed for the hero at plan position k, keyed by (match seed, k)."""
    gen = KeyedRng(match_seed).generator("season_hero", k)
    return SEED_BASE + int(gen.integers(0, 2**31 - SEED_BASE))


def season_plan(match_seed: int) -> tuple[PossessionSpec, ...]:
    """match-1's plan with fresh hero seeds."""
    return tuple(
        spec if spec.seed is None else replace(spec, seed=hero_seed(match_seed, k))
        for k, spec in enumerate(DEFAULT_PLAN)
    )


# --- one match ---------------------------------------------------------------------------------


def marked_changed(metrics: dict) -> bool | None:
    """A marker's look: was his man marked (within the lexicon's `unmarked` distance, 5 m) as the
    ball arrived with the look, and not without it, or the other way round?"""
    if "separation_with_scan_m" not in metrics:
        return None
    with_look = metrics["separation_with_scan_m"] <= MARKED_M
    return with_look != (metrics["separation_without_scan_m"] <= MARKED_M)


def lens_flip(card: MomentCard) -> bool | None:
    """Whether the selected lens's counterfactual changed the outcome: the decision (scan lens)
    or whether the man was marked (a marker's look). None when that lens has no such
    counterfactual."""
    lens = card.lens(card.selected_lens) if card.selected_lens else None
    m = lens.metrics if lens is not None else {}
    if "decision_changed" in m:
        return bool(m["decision_changed"])
    return marked_changed(m)


def hero_flip(ctx: MomentContext, card: MomentCard) -> tuple[bool | None, str | None]:
    """Whether the scenario's intervention (`MomentContext.cf`) changed the outcome, and how
    that is measured: the decision (drop the key scan), the marker's outcome (drop the marker's
    key scan; a marker has no decision) or the possession result (a forced action)."""
    cf = ctx.cf
    if isinstance(cf, CounterfactualResult):
        if cf.factual_decision is not None and cf.counterfactual_decision is not None:
            return cf.factual_decision.chosen != cf.counterfactual_decision.chosen, "decision"
        changed = marked_changed(marker_scan_lens(ctx.run, card, cf.scan_id).metrics)
        return (
            changed,
            None if changed is None else f"man marked (≤ {MARKED_M:.0f} m) as it arrives",
        )
    return possession_result(cf.factual) != possession_result(cf.counterfactual), "possession"


def hero_result(p: Possession, card: MomentCard | None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "scenario": p.scenario, "seed": p.seed, "detected": card is not None,
        "kind": card.kind if card else None, "lens": card.selected_lens if card else None,
        "built": False, "error": None, "scripts": 0, "dropped": 0, "claims": 0,
        "verdicts": Counter(), "violations": 0, "unverified_on_screen": 0, "step_errors": 0,
        "flip": None, "measure": None,
    }  # fmt: skip
    if card is None:
        return out
    try:
        ctx = MomentContext.load(p.scenario, p.seed)
        out["claims"] = len(ctx.claims)
        out["verdicts"] = Counter(v.status for v in ctx.verdicts.values())
        result = breakdown(ctx, personas=PERSONAS, languages=LANGUAGES)
        out["scripts"] = len(result.scripts)
        out["dropped"] = sum(len(s.dropped) for s in result.scripts)
        out["step_errors"] = sum(1 for t in result.trace if t.error)
        out["violations"] = sum(len(check_payload(s.payload, ctx.names)) for s in result.scripts)
        out["unverified_on_screen"] = sum(
            1
            for s in result.scripts
            for c in s.payload.claims
            if c.id not in ctx.verdicts or ctx.verdicts[c.id].status != "supported"
        )
        out["flip"], out["measure"] = hero_flip(ctx, card)
        out["built"] = True
    except Exception as e:  # a breakdown that fails is a result here, listed in the report
        where = traceback.extract_tb(e.__traceback__)[-1]
        at = f"{Path(where.filename).parent.name}/{Path(where.filename).name}:{where.lineno}"
        out["error"] = f"{type(e).__name__} in {where.name} ({at}): {e}"[:240]
    return out


def _concat(parts: list[dict[str, Any]]) -> dict[str, Any]:
    """One match's realism tables from its passages' tables."""
    if not parts:
        return {}
    if isinstance(next(iter(parts[0].values())), dict):
        return {k: _concat([p[k] for p in parts]) for k in parts[0]}
    return {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}


def play_match(
    index: int, match_seed: int, plan: tuple[PossessionSpec, ...] | None = None
) -> dict[str, Any]:
    """Everything the report needs from one match (no runs: it crosses a process boundary)."""
    plan = season_plan(match_seed) if plan is None else plan
    match = build_match(match_seed, plan)
    moments, heroes, open_flips, observed, ablation = [], [], [], [], []
    for spec, p in zip(plan, match.possessions, strict=True):
        cards = explain_moments(p.run)
        card = hero_card(p.run, cards) if p.run.hero is not None else None
        for c in cards:
            moments.append({
                "kind": c.kind, "lens": c.selected_lens, "live_only": c.live_only,
                "hero": card is not None and c.id == card.id, "open_play": p.scenario == OPEN_PLAY,
            })  # fmt: skip
            if p.scenario == OPEN_PLAY and c.selected_lens:
                open_flips.append({"kind": c.kind, "lens": c.selected_lens, "flip": lens_flip(c)})
        if p.run.hero is not None:
            heroes.append(hero_result(p, card))
        if p.scenario == OPEN_PLAY:
            observed.append(realism.tables(p.run))
            off = replace(SimParams(), pressure_scan_factor=1.0)
            if spec.max_s is not None:
                off = replace(off, max_duration_s=spec.max_s)
            run_off = Simulation.from_scenario(p.scenario, p.seed, params=off).run()
            ablation.append(realism.tables(run_off)["receptions"])
    return {
        "index": index,
        "seed": match_seed,
        "hash": match.output_hash(),
        "duration_s": match.duration_s,
        "possessions": len(match.possessions),
        "restarts": Counter(p.restart for p in match.possessions[1:]),
        "goals": sum(e.type == "goal" for p in match.possessions for e in p.run.events),
        "moments": moments,
        "heroes": heroes,
        "open_flips": open_flips,
        "observed": _concat(observed),
        "ablation": _concat(ablation),
    }


def rebuild_hash(match_seed: int) -> str:
    return build_match(match_seed, season_plan(match_seed)).output_hash()


def _play(job: tuple[int, int]) -> dict[str, Any]:
    return play_match(*job)


def run_season(
    season_seed: int = SEASON_SEED, n: int = MATCHES, workers: int | None = None
) -> tuple[list[dict[str, Any]], dict[int, bool]]:
    """Every match's results in match order, and which re-run matches were byte-identical."""
    seeds = match_seeds(season_seed, n)
    rerun = list(range(0, n, RERUN_EVERY))
    with ProcessPoolExecutor(workers) as pool:
        results = []
        for r in pool.map(_play, list(enumerate(seeds)), chunksize=1):
            results.append(r)
            if len(results) % 20 == 0 or len(results) == n:
                print(f"{len(results)}/{n} matches", file=sys.stderr, flush=True)
        hashes = list(pool.map(rebuild_hash, [seeds[i] for i in rerun], chunksize=1))
    same = {i: h == results[i]["hash"] for i, h in zip(rerun, hashes, strict=True)}
    return results, same


# --- statistics --------------------------------------------------------------------------------


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson interval of a share k/n."""
    if n == 0:
        return math.nan, math.nan
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return max(0.0, centre - half), min(1.0, centre + half)


def mean_ci(values: list[float]) -> tuple[float, float, float]:
    """Mean over matches and its 95% bootstrap interval (matches resampled)."""
    x = np.asarray(values, dtype=float)
    if x.size == 0:
        return math.nan, math.nan, math.nan
    gen = np.random.default_rng(BOOTSTRAP_SEED)
    idx = gen.integers(0, x.size, size=(BOOTSTRAP, x.size))
    means = x[idx].mean(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    return float(x.mean()), float(lo), float(hi)


def _mean(values: list[float], fmt: str = ".2f") -> str:
    m, lo, hi = mean_ci(values)
    return f"{m:{fmt}} ({lo:{fmt}}–{hi:{fmt}})"


def _share(k: int, n: int) -> str:
    if n == 0:
        return "— (0)"
    lo, hi = wilson(k, n)
    return f"{k}/{n} = {100 * k / n:.1f}% ({100 * lo:.1f}–{100 * hi:.1f}%)"


# --- the report --------------------------------------------------------------------------------


def _grouped(failures: list[tuple[str, int, str]]) -> dict[tuple[str, str], list[int]]:
    """Failures by (scenario, error), each with its seeds in match order."""
    out: dict[tuple[str, str], list[int]] = {}
    for scenario, seed, err in failures:
        out.setdefault((scenario, err.rstrip(": ")), []).append(seed)
    return out


def render(
    results: list[dict[str, Any]], same: dict[int, bool], season_seed: int = SEASON_SEED
) -> str:
    n = len(results)

    def per_match(f) -> list[float]:
        return [f(r) for r in results]

    heroes = [h for r in results for h in r["heroes"]]
    lines = [
        "# Season — the pipeline on a season of stitched matches",
        "",
        FRAMING,
        "",
        f"`uv run python -m eval.season`: {n} matches from season seed {season_seed}, each "
        "match-1's plan (`sim.match.DEFAULT_PLAN`) with its own match seed and fresh hero seeds "
        "(keyed off the match seed, ≥ 1,000,000: never a design or eval seed). Offline: no model "
        "calls; the crew runs its templates for every persona and language. Intervals are 95%: "
        f"Wilson for shares, a bootstrap over matches ({BOOTSTRAP} resamples) for per-match "
        "means.",
        "",
        "## Matches",
        "",
        "| Per match | Mean (95% CI) |",
        "|---|---|",
        f"| Possessions | {_mean(per_match(lambda r: r['possessions']), '.1f')} |",
        f"| Minutes of play | {_mean(per_match(lambda r: r['duration_s'] / 60))} |",
        f"| Goals | {_mean(per_match(lambda r: r['goals']))} |",
    ]
    kinds = sorted({k for r in results for k in r["restarts"]})
    for k in kinds:
        values = per_match(lambda r, k=k: r["restarts"][k])
        lines.append(f"| Restarts: {RESTART_NAMES.get(k, k)} | {_mean(values)} |")
    lines += [
        "",
        "Goals come only from a shooting hero; match-1's plan has none yet, so the count is zero "
        "by construction, not a measurement. Restarts are counted after the kick-off: a cut "
        "follows every hero and every passage that reached its cap in play.",
        "",
        "## 1. Moments",
        "",
        "| Per match | Mean (95% CI) |",
        "|---|---|",
        f"| All moments | {_mean(per_match(lambda r: len(r['moments'])))} |",
    ]
    kind_names = sorted({m["kind"] for r in results for m in r["moments"]})
    for k in kind_names:
        values = per_match(lambda r, k=k: sum(m["kind"] == k for m in r["moments"]))
        lines.append(f"| Kind `{k}` | {_mean(values)} |")
    lens_names = sorted({m["lens"] for r in results for m in r["moments"] if m["lens"]})
    for lens in lens_names:
        values = per_match(lambda r, lens=lens: sum(m["lens"] == lens for m in r["moments"]))
        lines.append(f"| Selected lens `{lens}` | {_mean(values)} |")
    lines += [
        f"| No lens (live only or none available) | "
        f"{_mean(per_match(lambda r: sum(m['lens'] is None for m in r['moments'])))} |",
        "",
        "Hero moments, by scenario (the hero's decision or, for a marker, his look):",
        "",
        "| Hero | Hero moment detected | Selected lens | Breakdown built | Failures |",
        "|---|---|---|---|---|",
    ]
    failures = []
    for scenario in dict.fromkeys(h["scenario"] for h in heroes):
        hs = [h for h in heroes if h["scenario"] == scenario]
        found = [h for h in hs if h["detected"]]
        built = [h for h in found if h["built"]]
        lenses = Counter(h["lens"] for h in found)
        lens_text = ", ".join(f"{k} {v}" for k, v in sorted(lenses.items(), key=str))
        failed = [h for h in found if not h["built"]]
        failures += [(scenario, h["seed"], h["error"]) for h in failed]
        lines.append(
            f"| `{scenario}` | {_share(len(found), len(hs))} | {lens_text or '—'} | "
            f"{_share(len(built), len(found))} | {len(failed)} |"
        )
    lines += [""]
    if failures:
        lines += ["Breakdowns that failed, by cause:", ""]
        for (scenario, err), seeds in _grouped(failures).items():
            shown = ", ".join(map(str, seeds[:8])) + (" …" if len(seeds) > 8 else "")
            lines.append(f"- `{scenario}`, {len(seeds)}×: {err} Seeds {shown}.")
    else:
        lines.append("Every detected hero moment's breakdown built without an error.")
    missed = [h for h in heroes if not h["detected"]]
    if missed:
        lines += [
            "",
            f"No hero moment was detected in {len(missed)} hero possessions (their scenario did "
            "not produce the situation it is built for with that seed); they play without a "
            "breakdown, as the service does. Seeds: "
            + ", ".join(f"`{h['scenario']}` {h['seed']}" for h in missed[:20])
            + (" …" if len(missed) > 20 else "")
            + ".",
        ]
    built = [h for h in heroes if h["built"]]
    verdicts: Counter = Counter()
    for h in built:
        verdicts.update(h["verdicts"])
    total = sum(verdicts.values())
    lines += [
        "",
        "## 2. Claims and the Verifier",
        "",
        f"- Breakdowns built: {len(built)}, each with {len(PERSONAS)} personas × {len(LANGUAGES)} "
        f"languages: {sum(h['scripts'] for h in built)} scripts.",
        f"- Claims checked by the Verifier: {total} ("
        + ", ".join(f"{k} {v} = {100 * v / total:.1f}%" for k, v in sorted(verdicts.items()))
        + ").",
        f"- Claims on a viewer's payload that the Verifier did not support: "
        f"{sum(h['unverified_on_screen'] for h in built)} (target 0).",
        f"- Render violations when every payload is re-checked (`check_payload`: a number "
        f"with no verified claim behind it, an unsupported term, a placeholder): "
        f"{sum(h['violations'] for h in built)} (target 0).",
        f"- Lines the checks dropped before a payload was built: {sum(h['dropped'] for h in built)}"
        f"; crew steps with an error: {sum(h['step_errors'] for h in built)}.",
        "",
        "## 3. Does the intervention change the outcome?",
        "",
        "| Moments | Measured on | Changed |",
        "|---|---|---|",
    ]
    for scenario in dict.fromkeys(h["scenario"] for h in built):
        hs = [h for h in built if h["scenario"] == scenario and h["flip"] is not None]
        measure = ", ".join(sorted({h["measure"] for h in hs})) or "—"
        flips = sum(bool(h["flip"]) for h in hs)
        lines.append(f"| Hero `{scenario}` | {measure} | {_share(flips, len(hs))} |")
    open_flips = [f for r in results for f in r["open_flips"]]
    for kind in sorted({f["kind"] for f in open_flips if f["flip"] is not None}):
        fs = [f for f in open_flips if f["kind"] == kind and f["flip"] is not None]
        lens_text = ", ".join(sorted({f["lens"] for f in fs}))
        flips = sum(bool(f["flip"]) for f in fs)
        lines.append(f"| Open play `{kind}` | {lens_text} lens | {_share(flips, len(fs))} |")
    no_cf = sum(f["flip"] is None for f in open_flips)
    lines += [
        "",
        "Heroes: the scenario's own intervention (`MomentContext.cf`): the key scan dropped "
        "(the decision, or for a marker whether his man is marked as the ball arrives) or the "
        "forced action "
        "(the possession's result). Open play: the selected lens's counterfactual, which drops "
        "the most informative scan. Open play has no decisions on the ball (`possession_play` "
        "scripts its passes), so only a marker's look has an outcome to change there; "
        f"{no_cf} open-play moments with a lens have no such counterfactual.",
        "",
        "## 4. Determinism",
        "",
        f"Every {RERUN_EVERY}th match built a second time: {sum(same.values())}/{len(same)} "
        "byte-identical (`StitchedMatch.to_bytes`, SPEC 3.7).",
        "",
        "## 5. Realism at season scale",
        "",
        "eval/realism.py's rows on the season's open play, pooled per match (the bootstrap "
        "resamples matches). Ranges and sources as in "
        "[realism.md](realism.md); *inside* compares the pooled value.",
        "",
    ]
    rows = realism.evaluate(
        [], observed=[r["observed"] for r in results], ablation=[r["ablation"] for r in results]
    )
    counts = Counter(r.inside for r in rows)
    lines += [
        f"**{counts[realism.INSIDE]} inside, {counts[realism.OUTSIDE]} outside, "
        f"{counts[realism.INCONCLUSIVE]} inconclusive, "
        f"{sum(r.published == realism.NO_REFERENCE for r in rows)} with no published "
        "reference.**",
        "",
        "| Metric | Sim (pooled) | Sim, 90% over matches | Published | Range checked | Inside |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        cells = (r.label, r.sim, r.seeds, r.published, r.range, r.inside)
        lines.append("| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |")
    lines += [
        "",
        "Open play here runs to the plan's caps (30–70 s) instead of realism's 45 s, and a "
        "reception within a scan's length of a passage's end is not counted (as there).",
        "",
    ]
    return "\n".join(lines)


# --- several seasons ---------------------------------------------------------------------------

Season = tuple[int, list[dict[str, Any]], dict[int, bool]]  # season seed, results, re-runs


def render_seasons(seasons: list[Season]) -> str:
    """Independent seasons side by side: each season's count or mean, and all of them pooled
    with a 95% interval (Wilson for shares, a bootstrap over matches for per-match means)."""
    seeds = [seed for seed, _, _ in seasons]
    pooled = [r for _, results, _ in seasons for r in results]
    k = len(seasons)
    head = (
        "| | " + " | ".join(str(s) for s in seeds) + " | All seasons (95% CI) | Seasons' range |",
        "|---|" + "---|" * (k + 2),
    )

    def share_row(label: str, count) -> str:
        """`count(results)` gives (k, n) for one season or the pooled matches."""
        per = [count(results) for _, results, _ in seasons]
        pct = [100 * a / b for a, b in per if b]
        spread = f"{min(pct):.1f}–{max(pct):.1f}%" if pct else "—"
        cells = [f"{a}/{b}" if b else "—" for a, b in per]
        return f"| {label} | " + " | ".join(cells) + f" | {_share(*count(pooled))} | {spread} |"

    def mean_row(label: str, value, fmt: str = ".2f") -> str:
        """`value(match)` per match; each season's mean, the pooled mean and its interval."""
        means = [float(np.mean([value(r) for r in results])) for _, results, _ in seasons]
        cells = [f"{m:{fmt}}" for m in means]
        spread = f"{min(means):{fmt}}–{max(means):{fmt}}"
        pooled_mean = _mean([value(r) for r in pooled], fmt)
        return f"| {label} | " + " | ".join(cells) + f" | {pooled_mean} | {spread} |"

    def heroes(results, scenario: str) -> list[dict[str, Any]]:
        return [h for r in results for h in r["heroes"] if h["scenario"] == scenario]

    def detected(results, scenario):
        hs = heroes(results, scenario)
        return sum(h["detected"] for h in hs), len(hs)

    def built(results, scenario):
        hs = [h for h in heroes(results, scenario) if h["detected"]]
        return sum(h["built"] for h in hs), len(hs)

    def flipped(results, scenario):
        hs = [h for h in heroes(results, scenario) if h["built"] and h["flip"] is not None]
        return sum(bool(h["flip"]) for h in hs), len(hs)

    def total(results, key: str) -> int:
        return sum(h[key] for r in results for h in r["heroes"] if h["built"])

    def supported(results):
        verdicts: Counter = Counter()
        for r in results:
            for h in r["heroes"]:
                if h["built"]:
                    verdicts.update(h["verdicts"])
        return verdicts["supported"], sum(verdicts.values())

    span = f"{seeds[0]}–{seeds[-1]}" if seeds == list(range(seeds[0], seeds[0] + k)) else (
        ", ".join(map(str, seeds))
    )  # fmt: skip
    sizes = sorted({len(results) for _, results, _ in seasons})
    lines = [
        f"# Seasons — the pipeline on {k} independent seasons",
        "",
        FRAMING,
        "",
        f"`uv run python -m eval.season --season-seed {seeds[0]} --seasons {k}`: season seeds "
        f"{span}, {' or '.join(map(str, sizes))} matches each, {len(pooled)} in all. Each season "
        "is built and measured exactly as in [season.md](season.md) (season seed "
        f"{SEASON_SEED}, not one of these): match-1's plan with its own match seeds and fresh hero "
        "seeds, offline. A season's column is its own count or per-match mean; *All seasons* "
        "pools every match, with a 95% interval (Wilson for shares, a bootstrap over matches, "
        f"{BOOTSTRAP} resamples, for per-match means); *Seasons' range* is the lowest and "
        "highest season.",
        "",
        "## 1. Heroes",
        "",
        "The hero moment (the hero's decision or, for a marker, his look), its breakdown, and "
        "whether the scenario's own intervention changes the outcome, measured as in season.md "
        "§3.",
        "",
        *head,
    ]
    scenarios = list(dict.fromkeys(h["scenario"] for r in pooled for h in r["heroes"]))
    for s in scenarios:
        measure = ", ".join(
            sorted({h["measure"] for r in pooled for h in r["heroes"]
                    if h["scenario"] == s and h["measure"]})
        ) or "—"  # fmt: skip
        lines += [
            share_row(f"`{s}`: hero moment detected", lambda rs, s=s: detected(rs, s)),
            share_row(f"`{s}`: breakdown built", lambda rs, s=s: built(rs, s)),
            share_row(f"`{s}`: intervention changes the outcome ({measure})",
                      lambda rs, s=s: flipped(rs, s)),
        ]  # fmt: skip
    failures = [
        (h["scenario"], h["error"], seed)
        for seed, results, _ in seasons
        for r in results
        for h in r["heroes"]
        if h["detected"] and not h["built"]
    ]
    lines += [""]
    if failures:
        causes: dict[tuple[str, str], Counter] = {}
        for scenario, err, seed in failures:
            causes.setdefault((scenario, err.rstrip(": ")), Counter())[seed] += 1
        lines += ["Breakdowns that failed, by cause (per season):", ""]
        for (scenario, err), by_season in causes.items():
            per = ", ".join(f"{s}: {by_season[s]}" for s in seeds)
            lines.append(f"- `{scenario}`, {sum(by_season.values())}×: {err} ({per}).")
    else:
        lines.append("Every detected hero moment's breakdown built without an error.")
    lines += [
        "",
        "## 2. Claims and the Verifier",
        "",
        *head,
        share_row("Claims the Verifier supports", supported),
    ]
    for key, label in (
        ("scripts", "Scripts (persona × language)"),
        ("unverified_on_screen", "Claims on a viewer's payload not supported (target 0)"),
        ("violations", "Render violations, `check_payload` (target 0)"),
        ("dropped", "Lines dropped before a payload was built"),
        ("step_errors", "Crew steps with an error"),
    ):
        cells = [str(total(results, key)) for _, results, _ in seasons]
        lines.append(f"| {label} | " + " | ".join(cells) + f" | {total(pooled, key)} | — |")
    open_kinds = sorted(
        {f["kind"] for r in pooled for f in r["open_flips"] if f["flip"] is not None}
    )
    lines += [
        "",
        "## 3. Open-play moments: does the selected lens's counterfactual change the outcome?",
        "",
        *(head if open_kinds else ["No open-play moment had such a counterfactual."]),
    ]
    for kind in open_kinds:
        lines.append(share_row(
            f"Open play `{kind}`",
            lambda rs, kind=kind: (
                sum(bool(f["flip"]) for r in rs for f in r["open_flips"]
                    if f["kind"] == kind and f["flip"] is not None),
                sum(1 for r in rs for f in r["open_flips"]
                    if f["kind"] == kind and f["flip"] is not None),
            ),
        ))  # fmt: skip
    lines += [
        "",
        "## 4. Matches and moments",
        "",
        *head,
        mean_row("Possessions per match", lambda r: r["possessions"], ".1f"),
        mean_row("Minutes of play per match", lambda r: r["duration_s"] / 60),
        mean_row("Goals per match", lambda r: r["goals"]),
        mean_row("Moments per match", lambda r: len(r["moments"])),
    ]
    for kind in sorted({m["kind"] for r in pooled for m in r["moments"]}):
        lines.append(mean_row(
            f"Moments per match: `{kind}`",
            lambda r, kind=kind: sum(m["kind"] == kind for m in r["moments"]),
        ))  # fmt: skip
    for kind in sorted({k for r in pooled for k in r["restarts"]}):
        lines.append(mean_row(
            f"Restarts per match: {RESTART_NAMES.get(kind, kind)}",
            lambda r, kind=kind: r["restarts"][kind],
        ))  # fmt: skip
    reruns = [sum(same.values()) for _, _, same in seasons]
    lines += [
        "",
        "## 5. Determinism",
        "",
        f"Every {RERUN_EVERY}th match of each season built a second time: "
        + ", ".join(f"{s}: {a}/{len(same)}" for (s, _, same), a in zip(seasons, reruns,
                                                                         strict=True))
        + f"; {sum(reruns)}/{sum(len(same) for _, _, same in seasons)} byte-identical in all "
        "(`StitchedMatch.to_bytes`, SPEC 3.7).",
        "",
        "## 6. Realism over all seasons",
        "",
        "eval/realism.py's rows on every season's open play, pooled per match (the bootstrap "
        "resamples matches), as in season.md §5; *inside per season* counts the seasons whose "
        "own pooled value is inside the range checked.",
        "",
    ]  # fmt: skip
    all_rows = realism.evaluate(
        [], observed=[r["observed"] for r in pooled], ablation=[r["ablation"] for r in pooled]
    )
    per_season = [
        {row.label: row.inside for row in realism.evaluate(
            [], observed=[r["observed"] for r in results],
            ablation=[r["ablation"] for r in results])}
        for _, results, _ in seasons
    ]  # fmt: skip
    counts = Counter(r.inside for r in all_rows)
    receptions = sum(len(r["observed"]["receptions"]["scans"]) for r in pooled if r["observed"])
    lines += [
        f"**{counts[realism.INSIDE]} inside, {counts[realism.OUTSIDE]} outside, "
        f"{counts[realism.INCONCLUSIVE]} inconclusive, "
        f"{sum(r.published == realism.NO_REFERENCE for r in all_rows)} with no published "
        f"reference**, over {receptions} receptions.",
        "",
        "| Metric | Sim (pooled) | Sim, 90% over matches | Published | Range checked | Inside "
        "| Inside per season |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in all_rows:
        checked = r.inside in (realism.INSIDE, realism.OUTSIDE)
        inside = sum(s.get(r.label) == realism.INSIDE for s in per_season)
        cells = (r.label, r.sim, r.seeds, r.published, r.range, r.inside,
                 f"{inside}/{k}" if checked else "—")  # fmt: skip
        lines.append("| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |")
    lines += [""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--season-seed", type=int, default=SEASON_SEED)
    parser.add_argument("--matches", type=int, default=MATCHES)
    parser.add_argument("--workers", type=int, default=os.cpu_count())
    parser.add_argument(
        "--seasons", type=int, default=1,
        help="independent seasons from --season-seed on; more than one writes seasons_<seeds>.md",
    )  # fmt: skip
    parser.add_argument(
        "--from-cache", action="store_true", help="render the last run's results again (out/)"
    )
    args = parser.parse_args()
    t0 = time.time()
    seasons: list[Season] = []
    for seed in range(args.season_seed, args.season_seed + args.seasons):
        cache = Path("out") / f"season_{seed}_{args.matches}.pickle"
        if args.from_cache:
            results, same = pickle.loads(cache.read_bytes())
        else:
            results, same = run_season(seed, args.matches, args.workers)
            cache.parent.mkdir(exist_ok=True)
            cache.write_bytes(pickle.dumps((results, same)))
        seasons.append((seed, results, same))
    REPORTS.mkdir(exist_ok=True)
    if args.seasons > 1:
        report = render_seasons(seasons)
        last = args.season_seed + args.seasons - 1
        size = "" if args.matches == MATCHES else f"_{args.matches}"
        path = REPORTS / f"seasons_{args.season_seed}-{last}{size}.md"
        shown = report.split("\n## 6.")[0]
    else:
        report = render(results, same, args.season_seed)
        default = args.matches == MATCHES and args.season_seed == SEASON_SEED
        path = REPORTS / (
            "season.md" if default else f"season_{args.season_seed}_{args.matches}.md"
        )  # fmt: skip
        shown = report.split("\n## 5.")[0]
    path.write_text(report)
    print(shown)
    print(f"\nwrote {path} in {time.time() - t0:.0f} s on {args.workers} workers")


if __name__ == "__main__":
    main()
