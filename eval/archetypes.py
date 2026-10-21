"""Archetypes: one fictional midfielder's perception traits, varied within published ranges.

    uv run python -m eval.archetypes                # 1000 open_play runs per archetype, all cores
    uv run python -m eval.archetypes --runs 100     # a quicker look (another report file)

These are properties of our simulator under published parameter ranges; they are not findings
about real players.

Five fictional archetypes of the scan hero's role (central midfielder) differ only in perception:
how often he scans and how fast his head turns in a scan. Each value is placed on a distribution
a paper prints (Jordet et al. 2020: 0.44 ± 0.30 scans/s in the 10 s before receiving; Kokubu et al.
2026: 404.2 ± 50.7°/s peak head speed in a scan). No archetype has a name, a nationality or a
career; none is fitted to any player. The decision model (its softmax temperature included) is
the same for all: no paper in docs/REFERENCES.md prints a range for it.

- **Where.** `open_play` (#48): the shape, pressing and marking of `possession_play`, but every
  carrier picks his pass, carry or shot on his own belief, so what the focal player saw can change
  what he does. In `possession_play` the passes are scripted and his scans could not matter. The
  focal player is H8, the central midfielder. Only his traits change (`sim.model.PlayerTraits`,
  off in every other run); the seeds, and every other player's draws, are the same for every
  archetype (keyed randomness, SPEC 3.7), so the comparisons are paired.
- **Calibration.** A configured scan rate is not a measured one: scans take time and pressure
  slows them (SPEC 3.4). The configured rate of each archetype is read off a curve measured on
  separate tuning seeds (the three central midfielders together, for numbers), by interpolation
  in log rate. A target above the curve's top is not reached, and the report says so.
- **Measured per archetype** (focal player only, with 95% intervals; differences from the
  typical archetype are paired over runs): scans in the 10 s before receiving; belief error about
  nearby opponents at his decision; pass completion; turnovers under heavy pressure; progressive
  passes; xT added per pass; and how often dropping his last scan before a decision changes that
  decision (a counterfactual re-simulation from the scan, SPEC 3.7). The scan hero
  (`blind_side_run`) scripts its hero's one look, so there only the head speed can matter.
- **Validation, not discovery.** The relationships Jordet et al. (2020) print are set beside the
  same quantities in the sim's open play (the typical archetype's runs, every outfield player),
  with whether the direction and the size match.

Writes eval/reports/archetypes.md (or archetypes_<runs>.md), and keeps the raw results in out/
so that `--from-cache` renders the report again without re-running. It prints the wall time; the
report does not, so it regenerates byte for byte.
"""

from __future__ import annotations

import argparse
import math
import os
import pickle
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np

from analytics.xt import xt_for
from explain.lexicon import TERMS
from explain.moments import pressure_on_carrier
from sim.config import DT, SimParams
from sim.engine import Simulation
from sim.match import SEED_BASE
from sim.model import PlayerTraits
from sim.overrides import DropScan
from sim.rng import KeyedRng
from sim.run import MatchRun

REPORTS = Path(__file__).parent / "reports"
FRAMING = (
    "These are properties of our simulator under published parameter ranges; they are not "
    "findings about real players."
)
SEED = 2026
RUNS = 1000  # open_play runs per archetype
TUNING_RUNS = 120  # per point of the calibration curve
HERO_RUNS = 200  # blind_side_run seeds per archetype
SCENARIO = "open_play"
PARAMS = replace(SimParams(), max_duration_s=45.0)
FOCAL = "H8"
MIDFIELD = ("H6", "H8", "H10")  # calibration: the three central midfielders together
WINDOW_S = 10.0  # scans counted before a reception (Jordet et al. 2020)
NEAR_M = 20.0  # opponents counted in the belief error
PROGRESSIVE_M = 10.0  # a completed pass that gains this much toward goal is progressive
HEAVY = float(TERMS["under heavy pressure"].threshold)  # pressing intensity of "heavy pressure"
BOOTSTRAP = 1000
BOOTSTRAP_SEED = 20261021
CURVE = (0.15, 0.25, 0.4, 0.6, 0.9, 1.3, 2.0, 3.0, 4.5, 7.0, 11.0, 16.0)  # configured scans/s

# Printed values (docs/REFERENCES.md).
JORDET_MEAN, JORDET_SD = 0.44, 0.30  # scans/s in the 10 s before receiving (Jordet et al. 2020)
KOKUBU_MEAN, KOKUBU_SD = 404.2, 50.7  # deg/s, peak head yaw rate of a scan (Kokubu et al. 2026)


@dataclass(frozen=True)
class Archetype:
    key: str
    label: str
    target: float | None  # measured scans/s it is placed at; None: the sim's own rate
    omega_deg_s: float | None  # mean peak head speed of his scans; None: SimParams'
    basis: str


ARCHETYPES = (
    Archetype("A", "low scanner", JORDET_MEAN - JORDET_SD, None,
              "Jordet et al. (2020) mean − 1 SD"),
    Archetype("B", "typical scanner", None, None,
              "the sim's central midfielder as calibrated in sim/config.py (no override)"),
    Archetype("C", "high scanner", JORDET_MEAN + JORDET_SD, None,
              "Jordet et al. (2020) mean + 1 SD"),
    Archetype("D", "very high scanner", JORDET_MEAN + 2 * JORDET_SD, None,
              "Jordet et al. (2020) mean + 2 SD"),
    Archetype("E", "high scanner, slow head", JORDET_MEAN + JORDET_SD, KOKUBU_MEAN - 2 * KOKUBU_SD,
              "C's rate, Jordet et al. (2020) mean + 1 SD; head speed Kokubu et al. (2026) "
              "mean − 2 SD"),
)  # fmt: skip
TYPICAL = "B"

# Published relationships (Jordet et al. 2020, Results), for the validation table.
PUBLISHED = {
    "beta": (0.16, 0.03, 0.28),  # pass completion, log-odds per SD of scan frequency, 95% HDI
    "beta_difficulty": (0.13, 0.02, 0.24),  # the same with pass difficulty in the model
    "kept": (0.46, 0.37, 0.20),  # scans/s when possession was kept vs lost, Cohen's d
    "complete": (0.46, 0.40, 0.15),  # passes that reached a teammate vs not
    "forward": (0.46, 0.42, (0.06, 0.12)),  # forward vs backward actions; d range printed
}


def keyed_seeds(purpose: str, n: int) -> list[int]:
    rng = KeyedRng(SEED)
    return [
        SEED_BASE + int(rng.generator(purpose, i).integers(0, 2**31 - SEED_BASE)) for i in range(n)
    ]  # noqa: E501


def traits_for(rate: float | None, omega_deg_s: float | None, players=(FOCAL,)):
    if rate is None and omega_deg_s is None:
        return None
    omega = None if omega_deg_s is None else math.radians(omega_deg_s)
    return {p: PlayerTraits(scan_rate=rate, scan_omega_mean=omega) for p in players}


# --- measurements on one run --------------------------------------------------------------------


def scan_rates_at_receptions(run: MatchRun, player: str) -> list[float]:
    """Scans per second in the 10 s before each of his receptions (or since the run began)."""
    scans = [e.frame for e in run.events if e.type == "scan" and e.player == player]
    w = round(WINDOW_S / run.dt)
    out = []
    for e in run.events:
        if e.type == "reception" and e.player == player and e.frame >= round(2.0 / run.dt):
            span = min(e.frame, w)
            out.append(sum(e.frame - span <= s < e.frame for s in scans) / (span * run.dt))
    return out


def _attack(run: MatchRun, player: str) -> int:
    return 1 if run.players[run.index(player)].team == 0 else -1


def pass_value(run: MatchRun, e) -> float:
    """xT added by a pass: where it ended for his team, or minus the opponent's xT where they won
    it, against his team's xT where he played it (analytics/xt.py)."""
    sign = _attack(run, e.player)
    start = xt_for(np.asarray(e.attrs["start"], dtype=float), sign)
    end = np.asarray(e.attrs["end_at"], dtype=float)
    after = xt_for(end, sign) if e.attrs.get("outcome") == "complete" else -xt_for(end, -sign)
    return float(after - start)


def focal_passes(run: MatchRun) -> list:
    return [e for e in run.events if e.type == "pass" and e.player == FOCAL
            and e.attrs.get("outcome") is not None]  # fmt: skip


def decision_rows(run: MatchRun) -> list[dict[str, Any]]:
    """His decisions: belief error about nearby opponents, pressure, and the pass that followed."""
    i = run.index(FOCAL)
    team = run.players[i].team
    passes = focal_passes(run)
    rows = []
    for d in run.decisions:
        if d.player != FOCAL:
            continue
        near = [
            p.id for j, p in enumerate(run.players)
            if p.team != team
            and np.linalg.norm(run.pos[d.frame, j] - run.pos[d.frame, i]) <= NEAR_M
        ]  # fmt: skip
        kick = next((e for e in passes if d.frame <= e.frame <= d.frame + round(1.0 / DT)), None)
        rows.append({
            "frame": d.frame,
            "chosen": d.chosen,
            "belief_error": float(np.mean([d.belief_error[p] for p in near])) if near else None,
            "pressure": pressure_on_carrier(run, d.frame),
            "lost": None if kick is None else kick.attrs.get("outcome") != "complete",
        })  # fmt: skip
    return rows


def scan_flips(seed: int, traits, run: MatchRun) -> list[bool]:
    """For each decision of his with a scan of his finished in the 10 s before it: drop the last
    such scan and re-simulate from its start to the decision. Did he choose otherwise?"""
    w = round(WINDOW_S / DT)
    scans = sorted(
        (e for e in run.events if e.type == "scan" and e.player == FOCAL), key=lambda e: e.frame
    )
    jobs = []
    for d in run.decisions:
        if d.player != FOCAL:
            continue
        before = [s for s in scans if d.frame - w <= s.frame and int(s.attrs["end"]) < d.frame]
        if before:
            jobs.append((before[-1], d))
    out = []
    sim = Simulation.from_scenario(SCENARIO, seed, params=PARAMS, traits=traits)
    for scan, d in sorted(jobs, key=lambda j: j[0].frame):
        sim.run_until(scan.frame)
        cf = Simulation.resume(sim.snapshot(), [DropScan(scan.id)])
        cf.run_until(d.frame + 1)
        other = next((c for c in cf.decisions if c.player == FOCAL and c.frame == d.frame), None)
        if other is not None:
            out.append(other.chosen != d.chosen)
    return out


def play(job: tuple[int, str, float | None, float | None]) -> dict[str, Any]:
    """One open_play run with the focal player's archetype: everything the report needs."""
    seed, key, rate, omega = job
    traits = traits_for(rate, omega)
    run = Simulation.from_scenario(SCENARIO, seed, params=PARAMS, traits=traits).run()
    passes = focal_passes(run)
    out: dict[str, Any] = {
        "seed": seed,
        "key": key,
        "scan_rates": scan_rates_at_receptions(run, FOCAL),
        "decisions": decision_rows(run),
        "passes": [
            {
                "complete": e.attrs["outcome"] == "complete",
                "gain": _attack(run, e.player) * (e.attrs["end_at"][0] - e.attrs["start"][0]),
                "xt": pass_value(run, e),
            }
            for e in passes
        ],  # fmt: skip
        "flips": scan_flips(seed, traits, run),
    }
    if key == TYPICAL:
        out["validation"] = validation_rows(run)
    return out


def validation_rows(run: MatchRun) -> list[dict[str, Any]]:
    """Every outfield player's reception, the scan rate before it, and his next pass."""
    rows = []
    passes = [e for e in run.events if e.type == "pass" and e.attrs.get("outcome") is not None]
    receptions = [e for e in run.events if e.type == "reception"]
    for p in run.players:
        if p.role == "GK":
            continue
        rates = iter(scan_rates_at_receptions(run, p.id))
        for r in (e for e in receptions if e.player == p.id and e.frame >= round(2.0 / run.dt)):
            rate = next(rates)
            nxt = next((e for e in receptions if e.frame > r.frame), None)
            limit = nxt.frame if nxt is not None else len(run.owner)
            kick = next((e for e in passes if e.player == p.id and r.frame < e.frame < limit), None)
            if kick is None:
                continue
            gain = _attack(run, p.id) * (kick.attrs["end_at"][0] - kick.attrs["start"][0])
            rows.append({"rate": rate, "complete": kick.attrs["outcome"] == "complete",
                         "forward": gain > 0})  # fmt: skip
    return rows


# --- the hero scenario --------------------------------------------------------------------------


def hero_flip(job: tuple[int, str, float | None, float | None]) -> bool | None:
    """blind_side_run with H8's traits: does dropping the key scan change his decision?"""
    seed, _key, rate, omega = job
    traits = traits_for(rate, omega)
    sim = Simulation.from_scenario("blind_side_run", seed, traits=traits)
    run = Simulation.from_scenario("blind_side_run", seed, traits=traits).run()
    key = run.key_scan()
    d = run.hero_decision()
    if d is None:
        return None
    sim.run_until(key.frame)
    cf = Simulation.resume(sim.snapshot(), [DropScan(key.id)])
    cf.run_until(d.frame + 1)
    other = next((c for c in cf.decisions if c.player == d.player and c.frame == d.frame), None)
    return None if other is None else other.chosen != d.chosen


# --- calibration --------------------------------------------------------------------------------


def _curve_point(job: tuple[int, float, float | None]) -> list[float]:
    seed, rate, omega = job
    traits = traits_for(rate, omega, MIDFIELD)
    run = Simulation.from_scenario(SCENARIO, seed, params=PARAMS, traits=traits).run()
    return [x for p in MIDFIELD for x in scan_rates_at_receptions(run, p)]


def curve(pool: ProcessPoolExecutor, omega: float | None, runs: int) -> list[tuple[float, float]]:
    """(configured, measured mean scans/s before receiving) on the tuning seeds."""
    seeds = keyed_seeds("archetype_tune", runs)
    out = []
    for rate in CURVE:
        xs = [x for part in pool.map(_curve_point, [(s, rate, omega) for s in seeds]) for x in part]
        out.append((rate, float(np.mean(xs))))
    return out


def configured_for(target: float, points: list[tuple[float, float]]) -> tuple[float, bool]:
    """The configured rate whose measured rate is `target`, by interpolation in log rate; the
    curve's top rate, and False, when the target is above everything measured."""
    rates, measured = zip(*points, strict=True)
    if target >= max(measured):
        return rates[int(np.argmax(measured))], False
    if target <= measured[0]:
        return rates[0], target == measured[0]
    k = next(i for i in range(1, len(points)) if measured[i] >= target)
    lo, hi = math.log(rates[k - 1]), math.log(rates[k])
    t = (target - measured[k - 1]) / (measured[k] - measured[k - 1])
    return round(math.exp(lo + t * (hi - lo)), 4), True


# --- statistics ---------------------------------------------------------------------------------


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return math.nan, math.nan
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return max(0.0, centre - half), min(1.0, centre + half)


def _mean(x: np.ndarray) -> float:
    return float(x.mean()) if x.size else math.nan


def cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 2 or len(b) < 2:
        return math.nan
    pooled = math.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1))
                       / (len(a) + len(b) - 2))  # fmt: skip
    return float((a.mean() - b.mean()) / pooled) if pooled > 0 else math.nan


def logistic_slope(x: np.ndarray, y: np.ndarray, w: np.ndarray | None = None) -> float:
    """Log-odds per unit of x (Newton-Raphson, intercept and slope), with optional weights."""
    w = np.ones_like(x) if w is None else w
    X = np.column_stack([np.ones_like(x), x])
    beta = np.zeros(2)
    for _ in range(50):
        p = 1 / (1 + np.exp(-X @ beta))
        g = X.T @ (w * (y - p))
        h = (X * (w * p * (1 - p))[:, None]).T @ X
        step = np.linalg.solve(h + 1e-9 * np.eye(2), g)
        beta += step
        if np.abs(step).max() < 1e-10:
            break
    return float(beta[1])


class Paired:
    """Per-run sums for every archetype, resampled over runs together (the seeds are paired)."""

    def __init__(self, results: list[dict[str, Any]]) -> None:
        self.seeds = sorted({r["seed"] for r in results})
        self.by = {(r["key"], r["seed"]): r for r in results}
        gen = np.random.default_rng(BOOTSTRAP_SEED)
        n = len(self.seeds)
        self.samples = [gen.integers(0, n, n) for _ in range(BOOTSTRAP)]

    def ratio(self, key: str, num, den, idx=None) -> float:
        seeds = self.seeds if idx is None else [self.seeds[i] for i in idx]
        top = sum(num(self.by[(key, s)]) for s in seeds)
        bottom = sum(den(self.by[(key, s)]) for s in seeds)
        return top / bottom if bottom else math.nan

    def interval(self, fn) -> tuple[float, float]:
        values = np.array([fn(idx) for idx in self.samples])
        values = values[np.isfinite(values)]
        if values.size == 0:
            return math.nan, math.nan
        lo, hi = np.percentile(values, [2.5, 97.5])
        return float(lo), float(hi)


def _metrics() -> list[tuple[str, str, Any, Any, float]]:
    """(name, unit, numerator, denominator, scale) per run, for every metric."""

    def dec(r, cond):
        return [d for d in r["decisions"] if cond(d)]

    return [
        ("Scans in the 10 s before receiving, per second", "scans/s",
         lambda r: sum(r["scan_rates"]), lambda r: len(r["scan_rates"]), 1.0),
        (f"Belief error about opponents within {NEAR_M:.0f} m at his decision", "m",
         lambda r: sum(d["belief_error"] for d in dec(r, lambda d: d["belief_error"] is not None)),
         lambda r: len(dec(r, lambda d: d["belief_error"] is not None)), 1.0),
        ("Pass completion", "%",
         lambda r: sum(p["complete"] for p in r["passes"]), lambda r: len(r["passes"]), 100.0),
        (f"Turnovers under heavy pressure (pressing ≥ {HEAVY:g}), share of those passes", "%",
         lambda r: sum(bool(d["lost"]) for d in dec(r, lambda d: d["pressure"] >= HEAVY
                                                       and d["lost"] is not None)),
         lambda r: len(dec(r, lambda d: d["pressure"] >= HEAVY and d["lost"] is not None)), 100.0),
        (f"Progressive passes (complete, ≥ {PROGRESSIVE_M:.0f} m toward goal), share of passes",
         "%", lambda r: sum(p["complete"] and p["gain"] >= PROGRESSIVE_M for p in r["passes"]),
         lambda r: len(r["passes"]), 100.0),
        ("xT added per pass", "xT",
         lambda r: sum(p["xt"] for p in r["passes"]), lambda r: len(r["passes"]), 1.0),
        ("Decisions changed by dropping his last scan before them", "%",
         lambda r: sum(r["flips"]), lambda r: len(r["flips"]), 100.0),
    ]  # fmt: skip


def _fmt(x: float, unit: str) -> str:
    if not math.isfinite(x):
        return "—"
    return {"%": f"{x:.1f}%", "m": f"{x:.2f} m", "xT": f"{x:+.4f}", "scans/s": f"{x:.3f}"}[unit]


def _diff(x: float, unit: str) -> str:
    """A difference: percentage points, metres, xT or scans/s, always signed."""
    if not math.isfinite(x):
        return "—"
    return {"%": f"{x:+.1f} pp", "m": f"{x:+.2f} m", "xT": f"{x:+.4f}",
            "scans/s": f"{x:+.3f}"}[unit]  # fmt: skip


# --- the report ---------------------------------------------------------------------------------


def render(
    results: list[dict[str, Any]],
    hero: dict[str, list[bool | None]],
    calibration: dict[str, Any],
    runs: int,
) -> str:
    paired = Paired(results)
    keys = [a.key for a in ARCHETYPES]
    lines = [
        "# Archetypes — one midfielder's perception traits within published ranges",
        "",
        FRAMING,
        "",
        f"`uv run python -m eval.archetypes`: {runs} `{SCENARIO}` runs "
        f"({PARAMS.max_duration_s:.0f} s cap) per archetype, the same seeds for every archetype "
        f"(keyed off seed {SEED}, ≥ 1,000,000), with only H8's perception changed "
        "(`sim.model.PlayerTraits`). Intervals are 95%: a bootstrap over runs "
        f"({BOOTSTRAP} resamples, paired across archetypes) for rates and means, Wilson for the "
        "hero's shares.",
        "",
        "## The archetypes",
        "",
        "| Archetype | Placed at | Basis | Configured scans/s | Head speed in a scan | Measured "
        "(his receptions) |",
        "|---|---|---|---|---|---|",
    ]  # noqa: E501
    sr = _metrics()[0]
    for a in ARCHETYPES:
        rate, reached = calibration["rates"][a.key]
        target = "the sim's own" if a.target is None else f"{a.target:.2f} scans/s"
        if a.target is not None and not reached:
            target += " (not reached)"
        speed = f"{a.omega_deg_s:.1f}°/s" if a.omega_deg_s else f"{KOKUBU_MEAN:.1f}°/s (SimParams)"
        value = paired.ratio(a.key, sr[2], sr[3])
        lo, hi = paired.interval(lambda idx, k=a.key: paired.ratio(k, sr[2], sr[3], idx))
        configured = f"{rate:.2f}" if rate is not None else "1.19 (sim/config.py CM)"
        lines.append(f"| {a.key}: {a.label} | {target} | {a.basis} | {configured} | {speed} | "
                     f"{value:.3f} ({lo:.3f}–{hi:.3f}) |")  # fmt: skip
    top = max(m for _, m in calibration["curve"])
    lines += [
        "",
        f"The calibration curve (tuning seeds, the three central midfielders, {calibration['runs']}"
        " runs per point) rises to "
        f"{top:.2f} measured scans/s at {CURVE[-1]:g} configured: scans take time (a turn out, a "
        "dwell, a turn back, then a 0.3 s refractory pause) and tight pressure slows them (SPEC "
        "3.4). An archetype placed above the curve's top is run at its top and marked *not "
        "reached*; its measured rate is what the comparisons below are about.",
        "",
        "## Comparison (focal player H8)",
        "",
        "| Metric | " + " | ".join(f"{a.key}" for a in ARCHETYPES) + " |",
        "|---|" + "---|" * len(ARCHETYPES),
    ]
    for name, unit, num, den, scale in _metrics():
        cells = []
        for k in keys:
            v = paired.ratio(k, num, den) * scale
            lo, hi = paired.interval(
                lambda idx, k=k, num=num, den=den, scale=scale: (
                    paired.ratio(k, num, den, idx) * scale
                )
            )
            n = sum(den(paired.by[(k, s)]) for s in paired.seeds)
            cells.append(f"{_fmt(v, unit)} ({_fmt(lo, unit)} to {_fmt(hi, unit)}), n = {n:,}")
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    lines += [
        "",
        f"Differences from {TYPICAL} (paired over runs; an interval that excludes 0 is a "
        "difference the runs resolve):",
        "",
        "| Metric | " + " | ".join(f"{k} − {TYPICAL}" for k in keys if k != TYPICAL) + " |",
        "|---|" + "---|" * (len(keys) - 1),
    ]
    for name, unit, num, den, scale in _metrics():
        cells = []
        for k in keys:
            if k == TYPICAL:
                continue

            def diff(idx, k=k, num=num, den=den, scale=scale):
                return (
                    paired.ratio(k, num, den, idx) - paired.ratio(TYPICAL, num, den, idx)
                ) * scale

            lo, hi = paired.interval(diff)
            cells.append(f"{_diff(diff(None), unit)} ({_diff(lo, unit)} to {_diff(hi, unit)})")
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    lines += [
        "",
        "- Belief error: the mean distance between where he believes each opponent within "
        f"{NEAR_M:.0f} m is and where that opponent is, at his decision (the sim's belief, "
        "SPEC 3.4).",
        f"- Heavy pressure: the lexicon's pressing intensity ≥ {HEAVY:g} on him at his decision "
        "(SPEC 4.3, 5.3); a turnover is a pass that did not reach a teammate (open_play has no "
        "tackles).",
        "- xT added: his team's xT where the pass ended, or minus the opponent's xT where they won "
        "it, against his team's xT where he played it (analytics/xt.py, the fitted grid).",
        "- Changed decisions: the scan is dropped (`DropScan`) and the run re-simulated from its "
        "first frame to the decision; every other player's draws are unchanged (SPEC 3.7).",
        "",
        "## The scan hero (`blind_side_run`, H8)",
        "",
        "The scenario scripts the hero's look: his spontaneous scans are suppressed until he acts, "
        "and the key scan's timing and dwell are drawn by the scenario. An archetype changes only "
        "how fast that look turns, so A to D, whose heads turn at the same speed, play the same "
        f"runs. Fresh seeds ({len(next(iter(hero.values())))} per archetype, "
        "keyed, ≥ 1,000,000), the key scan dropped:",
        "",
        "| Archetype | Decision changed without the key scan |",
        "|---|---|",
    ]
    for a in ARCHETYPES:
        flips = [f for f in hero[a.key] if f is not None]
        k = sum(flips)
        lo, hi = wilson(k, len(flips))
        lines.append(f"| {a.key}: {a.label} | {k}/{len(flips)} = {100 * k / len(flips):.1f}% "
                     f"({100 * lo:.1f}–{100 * hi:.1f}%) |")  # fmt: skip
    lines += validation(results)
    lines += [
        "",
        "## What is held fixed",
        "",
        "- The decision model, its temperature included, and every other perception parameter "
        "(the field of view, belief extrapolation, scan amplitude and dwell): no paper in "
        "docs/REFERENCES.md prints a per-player range for them.",
        "- Every other player: his role's rates (sim/config.py). The archetype is one fictional "
        "player's traits, not a team's.",
        "- No archetype is a real player or modelled on one, and nothing here is fitted to real "
        "match data (CLAUDE.md, hard constraint 2).",
        "",
    ]
    return "\n".join(lines)


def validation(results: list[dict[str, Any]]) -> list[str]:
    """Jordet et al. (2020)'s printed relationships beside the same quantities in the sim."""
    runs = [r for r in results if r["key"] == TYPICAL]
    rows = [(i, v) for i, r in enumerate(runs) for v in r["validation"]]
    unit = np.array([i for i, _ in rows])
    rate = np.array([v["rate"] for _, v in rows])
    done = np.array([v["complete"] for _, v in rows], dtype=bool)
    fwd = np.array([v["forward"] for _, v in rows], dtype=bool)
    z = (rate - rate.mean()) / rate.std()
    n = len(runs)
    gen = np.random.default_rng(BOOTSTRAP_SEED)
    weights = [np.bincount(gen.integers(0, n, n), minlength=n) for _ in range(BOOTSTRAP)]

    def boot(fn) -> tuple[float, float]:
        vals = np.array([fn(w) for w in weights])
        vals = vals[np.isfinite(vals)]
        if vals.size == 0:
            return math.nan, math.nan
        lo, hi = np.percentile(vals, [2.5, 97.5])
        return float(lo), float(hi)

    def d_of(mask: np.ndarray, w: np.ndarray | None = None) -> float:
        rep = np.ones(len(rate), dtype=int) if w is None else w[unit]
        return cohens_d(np.repeat(rate[mask], rep[mask]), np.repeat(rate[~mask], rep[~mask]))

    beta = logistic_slope(z, done.astype(float))
    beta_ci = boot(lambda w: logistic_slope(z, done.astype(float), w[unit].astype(float)))
    d_comp, d_comp_ci = d_of(done), boot(lambda w: d_of(done, w))
    d_fwd, d_fwd_ci = d_of(fwd), boot(lambda w: d_of(fwd, w))
    arche = _archetype_slope(results)
    arche_ci = boot(lambda w: _archetype_slope(results, w))
    pb, plo, phi = PUBLISHED["beta"]
    pd_comp = PUBLISHED["complete"][2]

    def verdict(ci: tuple[float, float], lo: float, hi: float) -> str:
        """Direction from the sim's interval (the published ones are all positive); size: the
        sim's interval overlaps the published range."""
        if not all(math.isfinite(x) for x in ci):
            return "not enough data"
        if ci[1] < 0:
            return "❌ opposite direction"
        if ci[0] <= 0:
            return "inconclusive (the interval includes 0)"
        return "✅ direction and size" if ci[0] <= hi and lo <= ci[1] else "⚠️ direction, not size"

    return [
        "",
        "## Validation against Jordet et al. (2020)",
        "",
        "The sim's open play with the typical archetype: every outfield player's reception, the "
        f"scans in the 10 s before it, and his next pass ({len(rows):,} passes in {n} runs). The "
        "paper: 27 players of one club, 9,574 possessions, scans from close-up video. A match in "
        "direction and size is a property of the sim's parameters, which come from such papers; "
        "it is not evidence about players.",
        "",
        "| Relationship | Published | Sim (95% CI) | Match |",
        "|---|---|---|---|",
        f"| Pass completion vs scan frequency, log-odds per SD | {pb:.2f} (95% HDI {plo:.2f} to "
        f"{phi:.2f}); {PUBLISHED['beta_difficulty'][0]:.2f} with pass difficulty in the model | "
        f"{beta:.2f} ({beta_ci[0]:.2f} to {beta_ci[1]:.2f}) | {verdict(beta_ci, plo, phi)} |",
        "| Scans/s before receiving, pass reached a teammate vs not | "
        f"{PUBLISHED['complete'][0]:.2f} vs {PUBLISHED['complete'][1]:.2f}, d = {pd_comp:.2f} | "
        f"{_mean(rate[done]):.2f} vs {_mean(rate[~done]):.2f}, d = {d_comp:.2f} "
        f"({d_comp_ci[0]:.2f} to {d_comp_ci[1]:.2f}) | "
        f"{verdict(d_comp_ci, pd_comp - 0.1, pd_comp + 0.1)} |",
        f"| Scans/s before receiving, forward vs backward pass | {PUBLISHED['forward'][0]:.2f} vs "
        f"{PUBLISHED['forward'][1]:.2f}, d = 0.06–0.12 | {_mean(rate[fwd]):.2f} vs "
        f"{_mean(rate[~fwd]):.2f}, d = {d_fwd:.2f} ({d_fwd_ci[0]:.2f} to {d_fwd_ci[1]:.2f}) | "
        f"{verdict(d_fwd_ci, 0.06, 0.12)} |",
        f"| The archetypes' own slope: H8's pass completion, log-odds per {JORDET_SD:.2f} scans/s "
        f"| {pb:.2f} (observational) | {arche:.2f} ({arche_ci[0]:.2f} to {arche_ci[1]:.2f}), the "
        f"same player with his scan rate set | {verdict(arche_ci, plo, phi)} |",
        "",
        "- The paper's possession-kept comparison (0.46 vs 0.37 scans/s, d = 0.20) needs the "
        "outcome of every action, carries included; open play here has no tackles, so a carry "
        "never loses the ball and that row is not comparable.",
        "- *Size* matches when the sim's interval overlaps the published interval, or for a "
        "printed d, its range (or ± 0.1 around a single value). The published coefficient is a "
        "group-level estimate from a hierarchical Bayesian model; the sim's is a pooled logistic "
        "regression with a bootstrap over runs.",
        "- The last row is a controlled comparison, the sim's own counterfactual, set beside an "
        "observational estimate: they need not agree, and the sim's says nothing about whether "
        "scanning causes completion in real football.",
    ]


def _archetype_slope(results: list[dict[str, Any]], w: np.ndarray | None = None) -> float:
    """H8's pass completion across archetypes against his measured scan rate, log-odds per
    JORDET_SD. `w`: how many times each run (by its index among one archetype's runs) counts."""
    xs, ys = [], []
    for a in ARCHETYPES:
        runs = [r for r in results if r["key"] == a.key]
        reps = np.ones(len(runs), dtype=int) if w is None else w
        rates = [x for r, k in zip(runs, reps, strict=True) for x in r["scan_rates"] * int(k)]
        passes = [p for r, k in zip(runs, reps, strict=True) for p in r["passes"] * int(k)]
        if not rates or not passes:
            continue
        xs += [float(np.mean(rates)) / JORDET_SD] * len(passes)
        ys += [p["complete"] for p in passes]
    return logistic_slope(np.array(xs), np.array(ys, dtype=float))


# --- running it ---------------------------------------------------------------------------------


def calibrate(pool: ProcessPoolExecutor, runs: int) -> dict[str, Any]:
    base = curve(pool, None, runs)
    slow = {}
    rates = {}
    for a in ARCHETYPES:
        if a.target is None:
            rates[a.key] = (None, True)
            continue
        points = base
        if a.omega_deg_s is not None:
            slow.setdefault(a.omega_deg_s, curve(pool, a.omega_deg_s, runs))
            points = slow[a.omega_deg_s]
        rates[a.key] = configured_for(a.target, points)
    return {"curve": base, "slow": slow, "rates": rates, "runs": runs}


def run_all(
    runs: int, workers: int | None, tuning_runs: int = TUNING_RUNS, hero_runs: int = HERO_RUNS
) -> tuple[list, dict, dict]:
    with ProcessPoolExecutor(workers) as pool:
        calibration = calibrate(pool, tuning_runs)
        print("calibrated", {k: v for k, v in calibration["rates"].items()}, file=sys.stderr)
        seeds = keyed_seeds("archetype_eval", runs)
        jobs = [(s, a.key, calibration["rates"][a.key][0], a.omega_deg_s)
                for a in ARCHETYPES for s in seeds]  # fmt: skip
        results = []
        for k, r in enumerate(pool.map(play, jobs, chunksize=4)):
            results.append(r)
            if (k + 1) % 200 == 0:
                print(f"{k + 1}/{len(jobs)} runs", file=sys.stderr, flush=True)
        hero_seeds = keyed_seeds("archetype_hero", hero_runs)
        hero = {}
        for a in ARCHETYPES:
            rate = calibration["rates"][a.key][0]
            hero[a.key] = list(
                pool.map(hero_flip, [(s, a.key, rate, a.omega_deg_s) for s in hero_seeds])
            )  # noqa: E501
    return results, hero, calibration


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runs", type=int, default=RUNS)
    parser.add_argument("--tuning-runs", type=int, default=TUNING_RUNS)
    parser.add_argument("--hero-runs", type=int, default=HERO_RUNS)
    parser.add_argument("--workers", type=int, default=os.cpu_count())
    parser.add_argument(
        "--from-cache", action="store_true", help="render the last run's results again (out/)"
    )
    args = parser.parse_args()
    t0 = time.time()
    cache = Path("out") / f"archetypes_{args.runs}_{args.tuning_runs}_{args.hero_runs}.pickle"
    if args.from_cache:
        results, hero, calibration = pickle.loads(cache.read_bytes())
    else:
        results, hero, calibration = run_all(
            args.runs, args.workers, args.tuning_runs, args.hero_runs
        )
        cache.parent.mkdir(exist_ok=True)
        cache.write_bytes(pickle.dumps((results, hero, calibration)))
    report = render(results, hero, calibration, args.runs)
    REPORTS.mkdir(exist_ok=True)
    default = (args.runs, args.tuning_runs, args.hero_runs) == (RUNS, TUNING_RUNS, HERO_RUNS)
    path = REPORTS / ("archetypes.md" if default else f"archetypes_{args.runs}.md")
    path.write_text(report)
    print(report.split("\n## The scan hero")[0])
    print(f"\nwrote {path} in {time.time() - t0:.0f} s on {args.workers} workers")


if __name__ == "__main__":
    main()
