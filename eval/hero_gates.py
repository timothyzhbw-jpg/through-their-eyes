"""Hero gates on a large fresh sample (SPEC 3.6): each hero's held-out gate, re-run on 200 seeds.

    uv run python -m eval.hero_gates                # the summary, from the committed reports
    uv run python -m eval.hero_gates --run --jobs 4 # first run the missing 1000–1199 evals

Every hero's acceptance eval is run once more, unchanged (same design, thresholds and
interventions), on fresh seeds 1000–1199 that no eval had used. The summary reads the committed
reports, both the original held-out run (40 seeds) and the 1000–1199 run, and writes
eval/reports/hero_gates_1000-1199.md: each gate's rate with a 95% Wilson interval, next to the
original result. A gate passes on the large sample when its rate meets the target, as on the
original run; the interval says how sure that is. Nothing is re-tuned.

A hero counts once its scenario and its original report are on this branch. Heroes still in
review are listed as pending; once they land, `--run` picks them up. Each 1000–1199 report comes
from the eval's own `--seeds` / `--out` path (the commands are listed in the summary). `--run`
starts them under `nice -n 10`, `--jobs` at a time (default 1), single-threaded BLAS, and skips
reports that already exist.
"""

from __future__ import annotations

import argparse
import math
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
SEEDS = "1000-1199"
Z = 1.959963984540054  # two-sided 95%

# Each original held-out report: its scenario and the eval that re-runs it on 1000–1199.
_OUT = f"--seeds {SEEDS} --out eval/reports/{{name}}_{SEEDS}.md"
EVALS: dict[str, tuple[str, str]] = {
    "hero_flip_blind_side_run": ("blind_side_run", "eval.hero_flip --scenario blind_side_run"),
    "hero_lens_blind_side_run": ("blind_side_run", "eval.hero_lens --scenario blind_side_run"),
    "hero_lens_press_escape": ("press_escape", "eval.hero_lens --scenario press_escape"),
    "hero_marking_corner_blind_side": ("corner_blind_side", "eval.hero_marking"),
    "hero_lens_corner_blind_side": ("corner_blind_side",
                                    "eval.hero_lens --scenario corner_blind_side"),
    "hero_shot_far_post_finish": ("far_post_finish", "eval.hero_shot"),
    "hero_lens_far_post_finish": ("far_post_finish", "eval.hero_lens --scenario far_post_finish"),
    "hero_flip_keeper_switch": ("keeper_switch", "eval.hero_flip --scenario keeper_switch"),
    "hero_flip_cutback_scan": ("cutback_scan", "eval.hero_flip --scenario cutback_scan"),
    "hero_lens_cutback_scan": ("cutback_scan", "eval.hero_lens --scenario cutback_scan"),
    "hero_save_screened_shot": ("screened_shot", "eval.hero_save"),
    "hero_flip_read_the_run": ("read_the_run", "eval.hero_flip --scenario read_the_run"),
}  # fmt: skip

# The gates: (original report, the start of the metric's row). Its target is in the row.
GATES: list[tuple[str, str]] = [
    ("hero_flip_blind_side_run", "Decision changed without the key scan"),
    ("hero_lens_blind_side_run", "`scan` lens selected"),
    ("hero_lens_blind_side_run", "Intervention changes the outcome"),
    ("hero_lens_press_escape", "`pressure` lens selected"),
    ("hero_lens_press_escape", "Intervention changes the outcome"),
    ("hero_marking_corner_blind_side", "Without the look `A9` receives unmarked"),
    ("hero_marking_corner_blind_side", "Without the look, `H5`'s belief error"),
    ("hero_marking_corner_blind_side", "Design rule: `A9` unseen"),
    ("hero_lens_corner_blind_side", "Scan lens Δ > 0"),
    ("hero_lens_corner_blind_side", "The lens's scan"),
    ("hero_shot_far_post_finish", "Placement changed without the key scan"),
    ("hero_shot_far_post_finish", "Design rule: A1 unseen"),
    ("hero_shot_far_post_finish", "Placement changed, v_dive = 2.5"),
    ("hero_shot_far_post_finish", "Placement changed, v_dive = 4.0"),
    ("hero_lens_far_post_finish", "`scan` lens selected"),
    ("hero_lens_far_post_finish", "The scan lens's scan"),
    ("hero_flip_keeper_switch", "Decision changed without the key scan"),
    ("hero_flip_cutback_scan", "Decision changed without the key scan"),
    ("hero_lens_cutback_scan", "`scan` lens selected"),
    ("hero_save_screened_shot", "P_save(step) − P_save(no step) ≥ 0.4"),
    ("hero_save_screened_shot", "P_save gap ≥ 0.4, v_dive = 2.5"),
    ("hero_save_screened_shot", "P_save gap ≥ 0.4, v_dive = 4"),
    ("hero_save_screened_shot", "Without the step, first sight ≥ 0.25 s later"),
    ("hero_save_screened_shot", "delta_sight > delta_position"),
    ("hero_flip_read_the_run", "Decision changed without the key scan"),
]
# Gates on a value rather than a rate.
VALUE_GATES: list[tuple[str, str]] = [
    ("hero_shot_far_post_finish", "Median ΔP_goal on truth"),
]


@dataclass(frozen=True)
class Row:
    k: int
    n: int
    target: float  # a rate
    seeds: str  # the report's seed range, e.g. "100–139"


def available(report: str) -> bool:
    """On this branch: the hero's scenario and its original held-out report."""
    return EVALS[report][0] in SCENARIOS and (REPORTS / f"{report}.md").exists()


def large(report: str) -> str:
    return f"{report}_{SEEDS}"


def command(report: str) -> str:
    return f"{EVALS[report][1]} {_OUT.format(name=report)}"


def wilson(k: int, n: int, z: float = Z) -> tuple[float, float]:
    """The Wilson score interval for k successes in n trials."""
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z / denom * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, centre - half), min(1.0, centre + half)


def _cells(name: str, metric: str) -> tuple[str, list[str]]:
    text = (REPORTS / f"{name}.md").read_text()
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 3 and cells[0].startswith(metric):
            return text, cells
    raise ValueError(f"{name}: no row starting {metric!r}")


def read_row(name: str, metric: str) -> Row:
    """The metric's `k/n` and its `≥ x%` target from a committed report."""
    text, cells = _cells(name, metric)
    seeds = re.search(r"^Seeds (\S+) \((\d+)\)", text, re.M)
    count, target = re.match(r"(\d+)/(\d+)", cells[1]), re.match(r"≥ (\d+)%", cells[-1])
    if seeds is None or count is None or target is None:
        raise ValueError(f"{name}: {metric!r} is not a rate with a target")
    return Row(int(count[1]), int(count[2]), int(target[1]) / 100, seeds[1])


def read_value(name: str, metric: str) -> tuple[float, float]:
    """A value metric (e.g. `+0.524`) and its `≥ x` target from a committed report."""
    _, cells = _cells(name, metric)
    value, target = re.match(r"[+-]?\d+\.\d+", cells[1]), re.match(r"≥ (\d+\.\d+)", cells[-1])
    if value is None or target is None:
        raise ValueError(f"{name}: {metric!r} is not a value with a target")
    return float(value[0]), float(target[1])


def _rate(r: Row) -> str:
    return f"{r.k}/{r.n} ({r.k / r.n:.0%})"


def _verdict(r: Row) -> str:
    lo, _ = wilson(r.k, r.n)
    if r.k / r.n < r.target:
        return "**fail**"
    return "pass" if lo >= r.target else "pass (interval reaches below the target)"


def report() -> str:
    span = SEEDS.replace("-", "–")
    lines = [
        f"# Hero gates on fresh seeds {span}",
        "",
        "Each hero's held-out acceptance eval, run once more and unchanged (same design, "
        f"thresholds and interventions) on 200 fresh seeds, {span}, that no eval had used. The "
        "original run is the committed 40-seed report; the interval is the 95% Wilson score "
        "interval. A gate passes when its rate meets the target. Generated by "
        "`uv run python -m eval.hero_gates` from the committed reports.",
        "",
        f"| Hero | Gate | Target | Original (seeds) | 95% interval | {span} | 95% interval "
        "| Verdict |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for name, metric in GATES:
        if not available(name):
            continue
        hero, old = EVALS[name][0], read_row(name, metric)
        olo, ohi = wilson(old.k, old.n)
        first = f"| `{hero}` | {metric} | ≥ {old.target:.0%} | {_rate(old)} ({old.seeds}) "
        if not (REPORTS / f"{large(name)}.md").exists():
            lines.append(f"{first}| {olo:.0%}–{ohi:.0%} | not run yet | — | — |")
            continue
        new = read_row(large(name), metric)
        nlo, nhi = wilson(new.k, new.n)
        lines.append(
            f"{first}| {olo:.0%}–{ohi:.0%} | {_rate(new)} | {nlo:.0%}–{nhi:.0%} | {_verdict(new)} |"
        )
    values = [(n, m) for n, m in VALUE_GATES if available(n)]
    if values:
        lines += ["", f"| Hero | Gate on a value | Target | Original | {span} | Verdict |",
                  "|---|---|---|---|---|---|"]  # fmt: skip
        for name, metric in values:
            old_v, target = read_value(name, metric)
            if (REPORTS / f"{large(name)}.md").exists():
                new_v, _ = read_value(large(name), metric)
                new, verdict = f"{new_v:+.3f}", "pass" if new_v >= target else "**fail**"
            else:
                new, verdict = "not run yet", "—"
            lines.append(f"| `{EVALS[name][0]}` | {metric} | ≥ {target:.3f} | {old_v:+.3f} | {new} "
                         f"| {verdict} |")  # fmt: skip
    pending = [n for n in EVALS if not available(n)]
    if pending:
        lines += ["", "Pending, their scenario or original report not on this branch yet: "
                  + ", ".join(f"`{n}`" for n in pending) + "."]  # fmt: skip
    lines += ["", "Reports and commands (each run once, with `uv run python -m`):", ""]
    lines += [f"- [{large(n)}.md]({large(n)}.md): `{command(n)}`" for n in EVALS if available(n)]
    return "\n".join(lines) + "\n"


def run_missing(jobs: int) -> None:
    """Run the 1000–1199 evals whose report is missing, under nice, `jobs` at a time."""
    todo = [n for n in EVALS if available(n) and not (REPORTS / f"{large(n)}.md").exists()]
    env = {**os.environ, "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1",
           "MKL_NUM_THREADS": "1", "VECLIB_MAXIMUM_THREADS": "1"}  # fmt: skip
    root = REPORTS.parent.parent

    def one(name: str) -> tuple[str, int]:
        args = ["nice", "-n", "10", sys.executable, "-m", *command(name).split()]
        return name, subprocess.run(args, cwd=root, env=env, stdout=subprocess.DEVNULL).returncode

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for name, rc in pool.map(one, todo):
            print(f"{large(name)}: {'ok' if rc == 0 else f'failed ({rc})'}")
            if rc != 0:
                raise SystemExit(rc)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run", action="store_true", help="first run the missing evals")
    parser.add_argument("--jobs", type=int, default=1, help="evals at a time with --run")
    args = parser.parse_args()
    if args.run:
        run_missing(args.jobs)
    text = report()
    path = REPORTS / f"hero_gates_{SEEDS}.md"
    path.write_text(text)
    print(text)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
