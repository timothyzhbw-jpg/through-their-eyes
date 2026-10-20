"""Scan calibration (SPEC 3.4, 3.8): fit the scan dwell and the role scan rates on tuning seeds.

    uv run python -m eval.scan_calibration

Fits on `possession_play` tuning seeds 0-99; eval/realism.py reports held-out seeds 100-199.
Every target is a value printed in a paper cited in docs/REFERENCES.md; no dataset is used.
- Peak head speed of a scan: Kokubu et al. (2026), 404.2 +- 50.7 deg/s, used as given (no fit).
- Dwell, a lognormal (median, log SD): measured on a grid, then solved by linear interpolation
  for the share of scans with the ball out of an 82 deg head-fixed frame for <= 0.66 s at Aksum
  et al.'s 90.3% and the SD of that duration at their 0.2842 s.
- Pressure factor at <= 1 m, closed form: Jordet et al. (2020) print d = 0.57 between the 0-1 m
  and 10+ m bins; times their SD of 0.30 scans/s that is a drop of 0.17 scans/s, a share of their
  mean of 0.44 scans/s.
- Role scan rates: per-group target means from a weighted least-squares fit of the eight effect
  sizes of Jordet et al. (2020) Figure 2, scaled so receptions average 3 scans in the 10 s before
  (SPEC 3.4), reached by multiplicative updates. DM, CM and AM share one rate.
Writes eval/reports/scan_calibration.md; sim/config.py holds the fitted values, rounded.
"""

from __future__ import annotations

import math
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path

import numpy as np

from eval.realism import (
    GROUP_ORDER,
    GROUPS,
    MIDFIELD,
    PARAMS,
    ROLE_PAIRS,
    WINDOW_S,
    _binomial_ci,
    simulate,
)
from sim.config import ROLES, SimParams

REPORTS = Path(__file__).parent / "reports"

TUNING_SEEDS = tuple(range(0, 100))
DWELL_MEDIANS_S = (0.01, 0.02, 0.03, 0.04)
DWELL_LOG_SDS = (1.25, 1.5, 1.75, 2.0, 2.25, 2.5)
SHORT_S, SHORT_SHARE, SHORT_N, DURATION_SD = 0.66, 0.903, 869, 0.2842  # Aksum et al. (2021)
PRESSURE_D, FREQUENCY_SD, FREQUENCY_MEAN = 0.57, 0.30, 0.44  # Jordet et al. (2020)
TARGET_SCANS = 3.0  # SPEC 3.4, Jordet et al. (2020): 3.0 scans in the 10 s before receiving
ITERATIONS = 8
# Measured rates move about 0.4 times as much as configured ones (in log terms): a scan, its
# refractory time and partial turns block new scans. So the first update overshoots by 1 / 0.4;
# later ones shrink as 1 / (k + 1), so seed noise in small groups (forwards) averages out.
GAIN = 2.5


def _set_rates(rates: dict[str, float]) -> None:
    for role, rate in rates.items():
        ROLES[role] = replace(ROLES[role], scan_rate=rate)


def _simulate(job: tuple[int, SimParams]) -> dict[str, dict[str, np.ndarray]]:
    return simulate(*job)


def run_seeds(params: SimParams, rates: dict[str, float]) -> list[dict]:
    """eval/realism.py tables of every tuning seed, with these role rates (set in the workers)."""
    with ProcessPoolExecutor(initializer=_set_rates, initargs=(rates,)) as pool:
        return list(pool.map(_simulate, [(seed, params) for seed in TUNING_SEEDS]))


def _pooled(tables: list[dict], name: str) -> dict[str, np.ndarray]:
    return {k: np.concatenate([t[name][k] for t in tables]) for k in tables[0][name]}


# --- dwell ----------------------------------------------------------------------------------


def duration_stats(tables: list[dict]) -> tuple[float, float, int]:
    """Midfielders' scans off the ball: share out of frame <= 0.66 s, SD (s), count."""
    scans = _pooled(tables, "scans")
    out = scans["out"][np.isin(scans["role"], MIDFIELD) & np.isfinite(scans["out"])]
    return float(np.mean(out <= SHORT_S + 1e-9)), float(np.std(out, ddof=1)), int(out.size)


def _cross(x: list[float], y: list[float], target: float) -> float:
    """x where the piecewise-linear y(x) first reaches target; past the ends, the end segment
    nearer the target is extended."""
    for k in range(1, len(x)):
        if min(y[k - 1], y[k]) <= target <= max(y[k - 1], y[k]):
            break
    else:
        k = 1 if abs(y[0] - target) < abs(y[-1] - target) else len(x) - 1
    t = (target - y[k - 1]) / (y[k] - y[k - 1])
    return float(x[k - 1] + t * (x[k] - x[k - 1]))


def fit_dwell(rates: dict[str, float]) -> tuple[tuple[float, float], dict, list]:
    """Grid of (share <= 0.66 s, SD); for each median, the log SD where the share is on target
    (the share falls as the log SD grows); along that ridge, the median where the SD is."""
    grid = {
        (m, s): duration_stats(run_seeds(replace(PARAMS, scan_dwell_s=(m, s)), rates))
        for m in DWELL_MEDIANS_S
        for s in DWELL_LOG_SDS
    }
    ridge = []
    for m in DWELL_MEDIANS_S:
        shares = [grid[(m, s)][0] for s in DWELL_LOG_SDS]
        sds = [grid[(m, s)][1] for s in DWELL_LOG_SDS]
        log_sd = _cross(list(DWELL_LOG_SDS), shares, SHORT_SHARE)
        ridge.append((m, log_sd, float(np.interp(log_sd, DWELL_LOG_SDS, sds))))
    medians, log_sds, sds = (list(v) for v in zip(*ridge, strict=True))
    median = _cross(medians, sds, DURATION_SD)
    return (median, float(np.interp(median, medians, log_sds))), grid, ridge


# --- role rates -----------------------------------------------------------------------------


def group_offsets(sizes: dict[str, int]) -> dict[str, float]:
    """Group means in pooled-SD units, central midfielders at 0: a weighted least-squares fit of
    the printed d's, each weighted by 1 / (its CI's variance + the sim's sampling variance)."""
    groups = list(GROUP_ORDER)
    rows, rhs, weights = [], [], []
    for a, b, d, lo, hi, _ in ROLE_PAIRS:
        row = np.zeros(len(groups))
        row[groups.index(a)], row[groups.index(b)] = 1.0, -1.0
        se_published = (hi - lo) / (2 * 1.96)
        se_sim = math.sqrt(1.0 / max(sizes[a], 1) + 1.0 / max(sizes[b], 1))
        rows.append(row), rhs.append(d), weights.append(1.0 / (se_published**2 + se_sim**2))
    anchor = np.zeros(len(groups))
    anchor[groups.index("central midfielders")] = 1.0
    rows.append(anchor), rhs.append(0.0), weights.append(1e6)
    w = np.sqrt(weights)
    x, *_ = np.linalg.lstsq(np.array(rows) * w[:, None], np.array(rhs) * w, rcond=None)
    return dict(zip(groups, x.tolist(), strict=True))


def fit_rates(params: SimParams, rates: dict[str, float]) -> tuple[dict[str, float], list[dict]]:
    history = []
    for k in range(ITERATIONS):
        rec = _pooled(run_seeds(params, rates), "receptions")
        rate = rec["scans"] / rec["window"]
        group = np.array([GROUPS[r] for r in rec["role"]])
        sizes = {g: int(np.sum(group == g)) for g in GROUP_ORDER}
        means = {g: float(rate[group == g].mean()) for g in GROUP_ORDER}
        within = sum(float(np.sum((rate[group == g] - means[g]) ** 2)) for g in GROUP_ORDER)
        sigma = math.sqrt(within / (len(rate) - len(GROUP_ORDER)))
        count = float(rec["scans"].mean())
        window = count / float(rate.mean())  # effective window: mean count per mean rate
        offsets = group_offsets(sizes)
        top = TARGET_SCANS / window - sum(sizes[g] / len(rate) * offsets[g] * sigma for g in sizes)
        targets = {g: top + offsets[g] * sigma for g in GROUP_ORDER}
        history.append(
            {"rates": dict(rates), "scans": count, "sigma": sigma, "means": means,
             "targets": targets, "sizes": sizes}
        )  # fmt: skip
        step = GAIN / (k + 1)
        rates = {r: rates[r] * (targets[GROUPS[r]] / means[GROUPS[r]]) ** step for r in GROUPS}
    return rates, history


# --- report ---------------------------------------------------------------------------------


def evaluate() -> str:
    config = SimParams()
    start = {r: ROLES[r].scan_rate for r in GROUPS}
    (median, log_sd), grid, ridge = fit_dwell(start)
    params = replace(PARAMS, scan_dwell_s=(median, log_sd))
    rates, history = fit_rates(params, start)
    factor = 1.0 - PRESSURE_D * FREQUENCY_SD / FREQUENCY_MEAN
    lo, hi = _binomial_ci(SHORT_SHARE, SHORT_N)
    last = history[-1]
    offsets = ", ".join(f"{g} {v:+.3f}" for g, v in group_offsets(last["sizes"]).items())

    lines = [
        "# Scan calibration (SPEC 3.4, 3.8)",
        "",
        f"`uv run python -m eval.scan_calibration`. `possession_play` tuning seeds "
        f"{TUNING_SEEDS[0]}–{TUNING_SEEDS[-1]} ({len(TUNING_SEEDS)}), "
        f"{PARAMS.max_duration_s:.0f} s each; the realism report (eval/reports/realism.md) runs "
        "held-out seeds 100–199. Targets are values printed in the papers of docs/REFERENCES.md; "
        "the measurements are eval/realism.py's.",
        "",
        "## Fitted values",
        "",
        "| Parameter | Fitted | sim/config.py | Target |",
        "|---|---|---|---|",
        f"| `scan_omega` (°/s) | {np.rad2deg(config.scan_omega[0]):.1f} ± "
        f"{np.rad2deg(config.scan_omega[1]):.1f} (as printed) | same | Kokubu et al. (2026), "
        "Results 3.1: 404.2 ± 50.7 |",
        f"| `scan_dwell_s` (median s, log SD) | {median:.3f}, {log_sd:.2f} | "
        f"{config.scan_dwell_s[0]:.3f}, {config.scan_dwell_s[1]:.2f} | Aksum et al. (2021): "
        f"{SHORT_SHARE:.1%} ≤ {SHORT_S} s, SD {DURATION_SD} s |",
        f"| `pressure_scan_factor` | {factor:.3f} | {config.pressure_scan_factor:.2f} | Jordet et "
        f"al. (2020): d = {PRESSURE_D} (0–1 m vs 10+ m), SD {FREQUENCY_SD}, mean "
        f"{FREQUENCY_MEAN} scans/s |",
        *(
            f"| `ROLES[{r!r}].scan_rate` | {rates[r]:.3f} | {ROLES[r].scan_rate:.2f} | "
            f"{GROUPS[r]}: {last['targets'][GROUPS[r]]:.3f} scans/s at receptions |"
            for r in GROUPS
        ),
        "",
        f"Pressure factor: {PRESSURE_D} × {FREQUENCY_SD} = {PRESSURE_D * FREQUENCY_SD:.3f} "
        f"scans/s lower at 0–1 m than at 10+ m, {PRESSURE_D * FREQUENCY_SD / FREQUENCY_MEAN:.0%} "
        f"of the mean, so the rate at 1 m is {factor:.2f} of the rate at 10 m. This assumes the "
        "10+ m bin sits near the overall mean and the SD within a bin near the overall SD; the "
        "paper prints neither. It also assumes the bins differ only in pressure: in "
        "`possession_play` they differ by role as well (eval/reports/realism.md, the pressure "
        "row's ablation).",
        "",
        "## Dwell grid",
        "",
        f"Share of midfielders' scans off the ball with the ball out of an 82° frame for ≤ "
        f"{SHORT_S} s, and the SD of that duration. For each median, the log SD where the share "
        f"is {SHORT_SHARE:.1%} (linear in between grid points); along that ridge, the median where "
        f"the SD is {DURATION_SD} s. The realism report checks the share against "
        f"{lo:.1%}–{hi:.1%}, the binomial 95% CI of the printed share (n = {SHORT_N}).",
        "",
        "| Median (s) | Log SD | ≤ 0.66 s | SD (s) | Scans |",
        "|---|---|---|---|---|",
        *(
            f"| {m:.2f} | {s:.2f} | {share:.1%} | {sd:.3f} | {n} |"
            for (m, s), (share, sd, n) in grid.items()
        ),
        "",
        f"| Median (s) | Log SD at {SHORT_SHARE:.1%} | SD there (s) |",
        "|---|---|---|",
        *(f"| {m:.2f} | {s:.3f} | {sd:.3f} |" for m, s, sd in ridge),
        f"| **{median:.3f}** | **{log_sd:.3f}** | **{DURATION_SD}** |",
        "",
        "## Role rates",
        "",
        f"Group targets: central midfielders highest, the other groups below by the "
        f"least-squares offsets in pooled-SD units ({offsets}), "
        f"all scaled so receptions average {TARGET_SCANS:.0f} scans in the last {WINDOW_S:.0f} s. "
        "Each iteration simulates every tuning seed and moves each rate by "
        f"(target / measured)^({GAIN} / (k + 1)) at iteration k.",
        "",
        "| Iteration | CM rate | Scans in window | Pooled SD | "
        + " | ".join(f"{g} (measured → target)" for g in GROUP_ORDER)
        + " |",
        "|---" * (4 + len(GROUP_ORDER)) + "|",
        *(
            f"| {k} | {h['rates']['CM']:.3f} | {h['scans']:.2f} | {h['sigma']:.3f} | "
            + " | ".join(f"{h['means'][g]:.3f} → {h['targets'][g]:.3f}" for g in GROUP_ORDER)
            + " |"
            for k, h in enumerate(history)
        ),
        "",
        "Forwards receive rarely in `possession_play` "
        f"({last['sizes']['forwards']} receptions here), so their measured mean is noisy.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    report = evaluate()
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "scan_calibration.md"
    path.write_text(report)
    print(report)
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
