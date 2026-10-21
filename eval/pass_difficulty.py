"""Pass difficulty sanity check (SPEC 4.6): does the rating separate failed passes from completed
ones?

    uv run python -m eval.pass_difficulty --seeds 300-399

The difficulty formula (analytics/stats.py) was fixed before this check ran and is not fitted to
any outcome; this report only reads it. It runs `possession_play` on seeds no stats decision has
seen (300-399), computes the live stats from each run's tracking and events
(analytics/live_stats.py) and compares the difficulty of passes that failed (intercepted or out)
with that of completed ones: the AUC, i.e. the probability that a failed pass was rated harder
than a completed one (ties count half), with a 95% bootstrap interval over passes.

Criterion, set before the run: supported if the interval's lower bound is above 0.5, a
counterexample if its upper bound is below 0.5, else inconclusive. The sim's own pass outcomes
come from the same motion model the lane term reuses (time to intercept, SPEC 3.5), so a
separation here says the rating is consistent with the sim, not that it predicts real passes.
Writes eval/reports/pass_difficulty.md.
"""

from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path

import numpy as np

from analytics import stats
from analytics.live_stats import stats_from_run
from sim.config import SimParams
from sim.engine import Simulation

REPORTS = Path(__file__).parent / "reports"
SCENARIO = "possession_play"
PARAMS = replace(SimParams(), max_duration_s=45.0)  # as the realism report
BOOTSTRAP = 2000
BOOTSTRAP_SEED = 20261021
PARTS = ("lane", "passer", "receiver", "distance")
SUPPORTED, COUNTEREXAMPLE, INCONCLUSIVE = "supported", "counterexample", "inconclusive"


def passes(seed: int) -> list[dict]:
    """Every resolved pass of one run: its difficulty, parts and whether it failed."""
    run = Simulation.from_scenario(SCENARIO, seed, params=PARAMS).run()
    cues = stats_from_run(run, f"{SCENARIO}-{seed}").snapshot().cues
    return [
        {"seed": seed, "difficulty": c.difficulty, "failed": c.outcome != "complete",
         "distance_m": c.distance_m, **c.components.model_dump()}
        for c in cues if c.kind == "pass"
    ]  # fmt: skip


def auc(score: np.ndarray, failed: np.ndarray) -> float:
    """P(a failed pass scores higher than a completed one), ties counted half (Mann-Whitney)."""
    f, c = score[failed], score[~failed]
    if not len(f) or not len(c):
        return float("nan")
    greater = (f[:, None] > c[None, :]).sum()
    ties = (f[:, None] == c[None, :]).sum()
    return float((greater + 0.5 * ties) / (len(f) * len(c)))


def bootstrap(score: np.ndarray, failed: np.ndarray) -> tuple[float, float]:
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    n = len(score)
    values = []
    for _ in range(BOOTSTRAP):
        k = rng.integers(0, n, n)
        values.append(auc(score[k], failed[k]))
    lo, hi = np.nanpercentile(values, [2.5, 97.5])
    return float(lo), float(hi)


def verdict(lo: float, hi: float) -> str:
    if lo > 0.5:
        return SUPPORTED
    if hi < 0.5:
        return COUNTEREXAMPLE
    return INCONCLUSIVE


def render(rows: list[dict], seeds: list[int]) -> str:
    score = np.array([r["difficulty"] for r in rows])
    failed = np.array([r["failed"] for r in rows], dtype=bool)
    a = auc(score, failed)
    lo, hi = bootstrap(score, failed)
    lines = [
        "# Pass difficulty: does it separate failed passes from completed ones?",
        "",
        f"`uv run python -m eval.pass_difficulty --seeds {seeds[0]}-{seeds[-1]}` — "
        f"`{SCENARIO}`, {len(seeds)} seeds, up to {PARAMS.max_duration_s:g} s each.",
        "",
        "The formula (SPEC 4.6) was fixed before this run and is not tuned on it:",
        "`difficulty = 0.4·lane + 0.2·passer + 0.2·receiver + 0.2·min(d / 50 m, 1)`.",
        "",
        "## Result",
        "",
        f"- Passes: {len(rows)} resolved, {int(failed.sum())} failed (intercepted or out), "
        f"{int((~failed).sum())} completed.",
        f"- **AUC {a:.3f}** (95% bootstrap interval {lo:.3f}–{hi:.3f}, {BOOTSTRAP} resamples of "
        f"passes): **{verdict(lo, hi)}** (criterion set before the run: lower bound above 0.5).",
        f"- Mean difficulty: failed {score[failed].mean():.3f}, completed "
        f"{score[~failed].mean():.3f}.",
        "",
        "## Each part alone",
        "",
        "| Part | Weight | AUC | Mean, failed | Mean, completed |",
        "|---|---:|---:|---:|---:|",
    ]
    for part in PARTS:
        v = np.array([r[part] for r in rows])
        lines.append(
            f"| {part} | {stats.DIFFICULTY_WEIGHTS[part]:.1f} | {auc(v, failed):.3f} | "
            f"{v[failed].mean():.3f} | {v[~failed].mean():.3f} |"
        )
    lines += [
        "",
        "## Completion by band",
        "",
        "| Band | Passes | Completed | Completion |",
        "|---|---:|---:|---:|",
    ]
    bands = [stats.difficulty_band(x) for x in score]
    for band in ("routine", "moderate", "hard", "very hard"):
        k = np.array([b == band for b in bands], dtype=bool)
        n, done = int(k.sum()), int((k & ~failed).sum())
        share = f"{done / n:.0%}" if n else "–"
        lines.append(f"| {band} | {n} | {done} | {share} |")
    lines += [
        "",
        "## How to read it",
        "",
        "- AUC 0.5 is no separation; 1.0 would rank every failed pass above every completed one.",
        "- The sim decides pass outcomes with the same motion model the lane term reuses (time to "
        "intercept and the run-in, SPEC 3.5), so this checks that the rating is consistent with "
        "how passes fail in the sim. It is not evidence about real passes.",
        "- The lane term reads the ball's tracked path, which for an intercepted pass ends where "
        "an opponent won it, so part of the lane's separation is built in: that opponent could, "
        "by definition, reach the path. The rating describes the pass as played, not a forecast "
        "made at the kick. The passer, receiver and distance parts have no such link.",
        "- The same cut-off works against the distance part: an intercepted pass is measured to "
        "where it was won, so failed passes look short, and the distance part alone can rank "
        "them below completed ones (AUC under 0.5). It stays as set before the run; measuring "
        "the intended length instead would be a new formula, to be checked on new fresh seeds.",
        "- A band with few passes (fewer than about 100) has a wide completion interval; read its "
        "rate with that in mind.",
        "",
    ]
    return "\n".join(lines)


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seeds", default="300-399")
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds)
    rows = [r for s in seeds for r in passes(s)]
    report = render(rows, seeds)
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "pass_difficulty.md"
    path.write_text(report)
    print(report.split("\n## How to read it")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
