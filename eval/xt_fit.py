"""xT fit (SPEC 4.5): Markov expected threat on synthetic open play, by value iteration.

    uv run python -m eval.xt_fit

Simulates `open_play` on tuning seeds 0–1999 (45 s each; every carrier decides with the decision
model, so play reaches the box and ends in shots), turns each on-ball action into an
`analytics.xt.Action`, and fits the 16 × 12 grid with `analytics.xt.fit_xt`, counting each
action mirrored across the long axis as well (open play is symmetric in y). A shot scores its
expected goals under the sim's own shot model (the decision model's xG): the engine has no shot
outcome model, and the expectation of a Bernoulli(xG) draw is xG. Writes:

- `analytics/xt_grid.json`: the grid, cached per sim version — `sim_version()` hashes what open
  play does on probe seeds, and tests/test_xt.py fails when the sim no longer matches;
- `eval/reports/xt_fit.md`: the data, the checks, the grid, stability across two halves of the
  seeds, and what changes for the numbers narration shows;
- `eval/reports/xt_fit.svg`: the sanity plot.

About 15 min on 4 cores. After a fit, regenerate the exports (web/README.md) and re-run the evals
that report xT (eval.hero_flip, eval.corruption).
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path
from unittest import mock

import numpy as np

from analytics import xt
from analytics.xt import (
    NX,
    NY,
    Action,
    XtFit,
    cell_centres,
    fit_xt,
    grid_value,
    xt_prior,
    xt_prior_for,
)
from sim.config import SimParams
from sim.decision import DecisionParams
from sim.engine import Simulation
from sim.run import MatchRun

SCENARIO = "open_play"
SEEDS = range(0, 2000)
PARAMS = replace(SimParams(), max_duration_s=45.0)
MIN_ACTIONS = 20  # a cell with fewer actions keeps the prior's value
MIN_SHOTS = 30  # fewer shots in all and the grid is the prior
# Open play is symmetric across the long axis (mirror-image shapes, jitter and physics), so each
# action counts mirrored as well: twice the data per cell and an exactly symmetric grid.
SYMMETRIC = True
# What open play does in the first 12 s of these seeds is the sim version. Short runs: a
# multi-agent sim amplifies last-bit differences between platforms (SPEC 3.7), and the discrete
# record of a run as short as a hero run is what tests/test_committed_exports.py already relies on.
PROBE_SEEDS = (0, 1, 2, 3)
PROBE_PARAMS = SimParams()
# The scenarios the fit was first meant to use: counted to show why they cannot carry it.
SCRIPTED = (("possession_play", range(0, 100)), ("blind_side_run", range(0, 100)))
HERO = ("blind_side_run", 3)
LENS_SEEDS = (*range(0, 40), *range(100, 140))  # the seeds SPEC 5.2 quotes
CENTRAL, WINGS = [4, 5, 6, 7], [0, 1, 10, 11]

REPORTS = Path(__file__).parent / "reports"


# --- data ----------------------------------------------------------------------------------


def actions_of(run: MatchRun) -> list[Action]:
    """Every on-ball action with a known outcome, for the acting team attacking +x.

    Passes go from where they were struck to where they were controlled (lost if intercepted or
    out); carries from the decision to the end of the carry; shots score the xG the carrier saw.
    A pass still rolling, or a carry still going, when the run ends is left out.
    """
    out: list[Action] = []
    last = len(run.owner) - 1
    carry_steps = round(DecisionParams().carry_time / run.dt)
    xg = {(d.player, d.frame): o.p_success for d in run.decisions for o in d.options
          if o.action == "shot"}  # fmt: skip

    def attacking(point, team: int) -> tuple[float, float]:
        s = 1.0 if team == 0 else -1.0
        return (s * float(point[0]), s * float(point[1]))

    for d in run.decisions:  # carries (passes and shots come from their events below)
        i = run.index(d.player)
        if d.chosen != "carry" or d.frame + carry_steps > last:
            continue
        team, until = run.players[i].team, d.frame + carry_steps
        kept = int(run.owner[until]) == i
        end = attacking(run.ball_pos[until, :2], team) if kept else None
        out.append(Action("move", attacking(run.ball_pos[d.frame, :2], team), end))
    for e in run.events:
        if e.type == "shot":
            out.append(Action("shot", attacking(e.attrs["start"], e.team), None,
                              xg[(e.player, e.frame)]))  # fmt: skip
        elif e.type == "pass" and e.attrs.get("outcome") is not None:
            ok = e.attrs["outcome"] == "complete"
            end = attacking(e.attrs["end_at"], e.team) if ok else None
            out.append(Action("move", attacking(e.attrs["start"], e.team), end))
    return out


def _simulate(job: tuple[str, int]) -> MatchRun:
    scenario, seed = job
    params = PARAMS if scenario in (SCENARIO, "possession_play") else SimParams()
    return Simulation.from_scenario(scenario, seed, params=params).run()


def _profile(run: MatchRun, acts: list[Action]) -> dict:
    """Counts for the data table: what kinds of actions a run has, and how long it ran."""
    counts = Counter(e.type if e.type != "pass" else f"pass_{e.attrs.get('outcome')}"
                     for e in run.events if e.type in ("pass", "shot"))  # fmt: skip
    counts["carry"] = sum(d.chosen == "carry" for d in run.decisions)
    counts["decisions"] = len(run.decisions)
    counts["xg"] = sum(a.goals for a in acts)
    counts["box"] = sum(a.start[0] > 36.0 and abs(a.start[1]) < 20.16 for a in acts)
    counts["seconds"] = len(run.owner) * run.dt
    return dict(counts)


def _job(job: tuple[str, int]) -> tuple[list[Action], dict]:
    run = _simulate(job)
    acts = actions_of(run)
    return acts, _profile(run, acts)


def collect_runs(seeds, scenario: str = SCENARIO) -> list[tuple[list[Action], dict]]:
    """(actions, counts) per seed, in seed order (so a fixed seed set gives identical counts)."""
    jobs = [(scenario, int(s)) for s in seeds]
    if len(jobs) <= 2:
        return [_job(job) for job in jobs]
    with ProcessPoolExecutor() as ex:
        return list(ex.map(_job, jobs, chunksize=4))


def collect(seeds, scenario: str = SCENARIO) -> list[Action]:
    return [a for acts, _ in collect_runs(seeds, scenario) for a in acts]


def sim_version() -> str:
    """Hash of what open play does on the probe seeds: every event and decision (ids, frames,
    choices, outcomes). A fingerprint of the data the grid is fitted on, not a proof: a change
    that only shows after 12 s of play would not alter it."""
    record = []
    for seed in PROBE_SEEDS:
        run = Simulation.from_scenario(SCENARIO, seed, params=PROBE_PARAMS).run()
        record.append(
            [[e.id, e.attrs.get("outcome")] for e in run.events]
            + [[d.frame, d.player, d.chosen] for d in run.decisions]
        )
    return hashlib.sha256(json.dumps(record).encode()).hexdigest()[:16]


def grid_json(fit: XtFit, version: str) -> str:
    data = {
        "scenario": SCENARIO,
        "seeds": [SEEDS.start, SEEDS.stop - 1],
        "sim_version": version,
        "min_actions": MIN_ACTIONS,
        "min_shots": MIN_SHOTS,
        "symmetric": SYMMETRIC,
        "status": fit.status,
        "shape": [NX, NY],
        "note": "xT for a team attacking +x; grid[i][j]: column i along x (from the own goal "
        "line), lane j along y. Cell centres; analytics.xt.xt_for interpolates.",
        "grid": [[round(float(v), 6) for v in row] for row in fit.grid],
        "fitted": fit.fitted.tolist(),
    }
    return json.dumps(data, indent=1) + "\n"


# --- checks --------------------------------------------------------------------------------


def checks(grid: np.ndarray) -> list[tuple[str, str, bool]]:
    """The acceptance checks of tests/test_xt.py, with the values behind them."""
    cols, central = grid.mean(axis=1), grid[:, CENTRAL].mean(axis=1)
    near = [13, 14, 15]
    rise = cols[near].mean() - cols[:3].mean()
    lanes = [grid[near, j].mean() - grid[: NX // 2, j].mean() for j in range(NY)]
    margin = [grid[i, CENTRAL].mean() - grid[i, WINGS].mean() for i in near]
    return [
        ("Values in [0, 1]", f"{grid.min():.4f} – {grid.max():.4f}",
         bool(grid.min() >= 0 and grid.max() <= 1)),
        ("Column means never drop by more than 0.01 toward goal",
         f"worst step {np.diff(cols).min():+.4f}", bool(np.diff(cols).min() >= -0.01)),
        ("Central-lane means never drop by more than 0.02 toward goal",
         f"worst step {np.diff(central).min():+.4f}", bool(np.diff(central).min() >= -0.02)),
        ("Last 3 columns minus first 3 columns ≥ 0.05",
         f"{rise:+.4f}", bool(rise >= 0.05)),
        ("Every lane: near goal ≥ own half − 0.01",
         f"worst {min(lanes):+.4f}", bool(min(lanes) >= -0.01)),
        ("Near goal: central lanes ≥ wings, each of the last 3 columns",
         f"smallest margin {min(margin):+.4f}", bool(min(margin) >= 0)),
    ]  # fmt: skip


# --- what changes downstream ---------------------------------------------------------------


def _hero_numbers(prior: bool) -> dict:
    from explain.lenses import explain_moment
    from explain.moments import detect_moments
    from sim.counterfactual import drop_scan_counterfactual

    patches = [mock.patch(f"{m}.xt_for", xt_prior_for) for m in
               ("sim.counterfactual", "explain.lenses")] if prior else []  # fmt: skip
    for p in patches:
        p.start()
    try:
        scenario, seed = HERO
        cf = drop_scan_counterfactual(scenario, seed)
        card = next(c for c in detect_moments(cf.factual) if c.kind == "decision_after_scan")
        card = explain_moment(card, cf.factual)
        return {
            "look": cf.delta_xt,
            "lenses": {lens.lens: lens.delta_xt for lens in card.lenses},
            "selected": card.selected_lens,
            "actions": (cf.factual_action, cf.counterfactual_action),
        }
    finally:
        for p in patches:
            p.stop()


def hero_pass_end() -> tuple[float, float]:
    """Where the hero's pass ends in the factual run, for his team attacking +x."""
    from sim.counterfactual import drop_scan_counterfactual

    run = drop_scan_counterfactual(*HERO).factual
    d = run.hero_decision()
    kick = next(e for e in run.events if (e.player, e.frame) == (d.player, d.frame)
                and e.type == "pass")  # fmt: skip
    s = 1.0 if kick.team == 0 else -1.0
    return s * kick.attrs["end_at"][0], s * kick.attrs["end_at"][1]


def look_with(grid: np.ndarray) -> float:
    """The hero look's ΔxT (possession value after his action, with and without it) on `grid`."""
    from sim.counterfactual import drop_scan_counterfactual

    def lookup(points, sign):
        p = np.asarray(points, dtype=float)
        return grid_value(grid, sign * p[..., 0], sign * p[..., 1])

    with mock.patch("sim.counterfactual.xt_for", lookup):
        return drop_scan_counterfactual(*HERO).delta_xt


def _lens_job(job: tuple[int, bool]) -> tuple[str | None, float, bool]:
    from explain.lenses import explain_moment
    from explain.moments import detect_moments

    seed, prior = job
    patches = [mock.patch(f"{m}.xt_for", xt_prior_for) for m in
               ("sim.counterfactual", "explain.lenses")] if prior else []  # fmt: skip
    for p in patches:
        p.start()
    try:
        run = Simulation.from_scenario("blind_side_run", seed).run()
        card = next(c for c in detect_moments(run) if c.kind == "decision_after_scan")
        card = explain_moment(card, run)
        d = {lens.lens: lens.delta_xt for lens in card.lenses}
        return card.selected_lens, d["scan"] - d["space"], d["scan"] >= d["space"]
    finally:
        for p in patches:
            p.stop()


def lens_selection(prior: bool) -> list[tuple[str | None, float, bool]]:
    with ProcessPoolExecutor() as ex:
        return list(ex.map(_lens_job, [(s, prior) for s in LENS_SEEDS]))


# --- sanity plot (hand-written SVG: matplotlib is not a dependency) -------------------------

# Sequential blue ramp (8 bins of 0.05 xT) and categorical slots 1-3, light and dark.
RAMP_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#5598e7", "#3987e5", "#256abf", "#184f95",
              "#0d366b"]  # fmt: skip
RAMP_DARK = RAMP_LIGHT[::-1]
BIN = 0.05


def svg(fit: XtFit) -> str:
    grid, s = fit.grid, 6.0  # px per metre
    pw, ph = 105 * s, 68 * s
    ox, oy = 48.0, 64.0
    cw, ch = pw / NX, ph / NY
    xs, _ = cell_centres()
    prior_cols = xt_prior(xs, 0.0 * xs)
    style = ["svg{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}",
             ".bg{fill:#fcfcfb}.t1{fill:#0b0b0b}.t2{fill:#52514e}.ln{stroke:#c3c2b7}",
             ".grid{stroke:#e4e3df}.hatch{stroke:#52514e}.s1{stroke:#2a78d6}.s2{stroke:#eb6834}",
             ".s3{stroke:#1baf7a}.sp{stroke:#52514e}.f1{fill:#2a78d6}.f2{fill:#eb6834}",
             ".f3{fill:#1baf7a}.fp{fill:#52514e}"]  # fmt: skip
    style += [f".b{k}{{fill:{c}}}" for k, c in enumerate(RAMP_LIGHT)]
    dark = [".bg{fill:#1a1a19}.t1{fill:#f0efec}.t2{fill:#c3c2b7}.ln{stroke:#6b6a64}",
            ".grid{stroke:#383835}.hatch{stroke:#c3c2b7}.s1{stroke:#3987e5}.s2{stroke:#d95926}",
            ".s3{stroke:#199e70}.sp{stroke:#c3c2b7}.f1{fill:#3987e5}.f2{fill:#d95926}",
            ".f3{fill:#199e70}.fp{fill:#c3c2b7}"]  # fmt: skip
    dark += [f".b{k}{{fill:{c}}}" for k, c in enumerate(RAMP_DARK)]
    width, height = ox + pw + 120, oy + ph + 380
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'width="{width:.0f}" height="{height:.0f}" role="img" '
        'aria-labelledby="title desc">',
        '<title id="title">xT grid fitted on synthetic open play</title>',
        '<desc id="desc">16 by 12 expected-threat grid for a team attacking to the right, and '
        "its column means against the smooth prior. Values are listed in xt_fit.md.</desc>",
        f"<style>{''.join(style)}@media (prefers-color-scheme: dark){{{''.join(dark)}}}</style>",
        '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" '
        'patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch" '
        'stroke-width="1.2" stroke-opacity="0.55"/></pattern></defs>',
        f'<rect class="bg" width="{width:.0f}" height="{height:.0f}"/>',
        f'<text class="t1" x="{ox}" y="26" font-size="16" font-weight="600">Fitted xT, '
        f"open_play seeds {SEEDS.start}–{SEEDS.stop - 1}</text>",
        f'<text class="t2" x="{ox}" y="46" font-size="12">Attacking left to right. Hatched '
        f"cells have fewer than {MIN_ACTIONS} actions: the prior at the fitted floor.</text>",
    ]
    for i in range(NX):
        for j in range(NY):
            v = float(grid[i, j])
            k = min(int(v / BIN), len(RAMP_LIGHT) - 1)
            x, y = ox + i * cw, oy + (NY - 1 - j) * ch  # +y is up the page
            src = "fitted" if fit.fitted[i, j] else "prior"
            out.append(
                f'<rect class="b{k}" x="{x:.1f}" y="{y:.1f}" width="{cw - 1:.1f}" '
                f'height="{ch - 1:.1f}"><title>column {i}, lane {j}: {v:.3f} ({src}, '
                f"{int(fit.actions[i, j])} actions)</title></rect>"
            )
            if not fit.fitted[i, j]:
                out.append(f'<rect fill="url(#hatch)" x="{x:.1f}" y="{y:.1f}" '
                           f'width="{cw - 1:.1f}" height="{ch - 1:.1f}"/>')  # fmt: skip

    def m(px: float, py: float) -> tuple[float, float]:  # pitch metres -> svg
        return ox + (px + 52.5) * s, oy + (34.0 - py) * s

    lines = [((0, -34), (0, 34)), ((36, -20.16), (52.5, -20.16)), ((36, 20.16), (52.5, 20.16)),
             ((36, -20.16), (36, 20.16)), ((-36, -20.16), (-52.5, -20.16)),
             ((-36, 20.16), (-52.5, 20.16)), ((-36, -20.16), (-36, 20.16))]  # fmt: skip
    out.append(f'<rect class="ln" fill="none" stroke-width="1.5" x="{ox}" y="{oy}" '
               f'width="{pw}" height="{ph}"/>')  # fmt: skip
    for a, b in lines:
        (x1, y1), (x2, y2) = m(*a), m(*b)
        out.append(f'<line class="ln" stroke-width="1.5" x1="{x1:.1f}" y1="{y1:.1f}" '
                   f'x2="{x2:.1f}" y2="{y2:.1f}"/>')  # fmt: skip
    cx, cy = m(0, 0)
    out.append(f'<circle class="ln" fill="none" stroke-width="1.5" cx="{cx:.1f}" cy="{cy:.1f}" '
               f'r="{9.15 * s:.1f}"/>')  # fmt: skip
    # Colour legend.
    ly = oy + ph + 22
    out.append(f'<text class="t2" x="{ox}" y="{ly + 11}" font-size="12">xT</text>')
    for k in range(len(RAMP_LIGHT)):
        x = ox + 28 + k * 44
        out.append(f'<rect class="b{k}" x="{x}" y="{ly}" width="42" height="14" rx="2"/>')
        label = f"{k * BIN:.2f}" if k else "0"
        out.append(f'<text class="t2" x="{x}" y="{ly + 30}" font-size="11">{label}</text>')
    out.append(f'<text class="t2" x="{ox + 28 + 8 * 44 - 8}" y="{ly + 30}" '
               f'font-size="11">{len(RAMP_LIGHT) * BIN:.2f}+</text>')  # fmt: skip
    x = ox + 28 + 8 * 44 + 40
    out.append(f'<rect fill="url(#hatch)" class="ln" stroke-width="1" x="{x}" y="{ly}" '
               f'width="42" height="14"/>')  # fmt: skip
    out.append(f'<text class="t2" x="{x + 50}" y="{ly + 11}" font-size="12">prior (too little '
               "data)</text>")  # fmt: skip

    # Column means: fitted central lanes, fitted wings, fitted all lanes, prior on the long axis.
    top, h = ly + 70, 250.0
    vmax = 0.4
    out.append(f'<text class="t1" x="{ox}" y="{top - 14}" font-size="14" font-weight="600">'
               "Mean xT per column, toward the attacked goal</text>")  # fmt: skip

    def py_(v: float) -> float:
        return top + h - min(v, vmax) / vmax * h

    def px_(i: int) -> float:
        return ox + (i + 0.5) * cw

    for t in (0.0, 0.1, 0.2, 0.3, 0.4):
        out.append(f'<line class="grid" stroke-width="1" x1="{ox}" x2="{ox + pw}" '
                   f'y1="{py_(t):.1f}" y2="{py_(t):.1f}"/>')  # fmt: skip
        out.append(f'<text class="t2" x="{ox - 8}" y="{py_(t) + 4:.1f}" font-size="11" '
                   f'text-anchor="end">{t:.1f}</text>')  # fmt: skip
    for i in (0, 4, 8, 12, 15):
        out.append(f'<text class="t2" x="{px_(i):.1f}" y="{top + h + 18}" font-size="11" '
                   f'text-anchor="middle">{xs[i]:+.0f} m</text>')  # fmt: skip
    series = [
        ("s1", "f1", "central lanes", grid[:, CENTRAL].mean(axis=1), ""),
        ("s3", "f3", "all lanes", grid.mean(axis=1), ""),
        ("s2", "f2", "wings", grid[:, WINGS].mean(axis=1), ""),
        ("sp", "fp", "prior, long axis", prior_cols, ' stroke-dasharray="6 4"'),
    ]
    label_y: list[float] = []
    for stroke, fill, name, values, dash in series:
        pts = " ".join(f"{px_(i):.1f},{py_(float(v)):.1f}" for i, v in enumerate(values))
        out.append(f'<polyline class="{stroke}" fill="none" stroke-width="2" '
                   f'stroke-linejoin="round"{dash} points="{pts}"/>')  # fmt: skip
        for i, v in enumerate(values):
            out.append(f'<circle class="{fill}" cx="{px_(i):.1f}" cy="{py_(float(v)):.1f}" r="3">'
                       f"<title>{name}, column {i}: {float(v):.3f}</title></circle>")  # fmt: skip
        y = py_(float(values[-1]))
        for other in label_y:  # keep direct labels apart
            if abs(y - other) < 14:
                y = other + 14
        label_y.append(y)
        out.append(f'<text class="t1" x="{px_(NX - 1) + 8:.1f}" y="{y + 4:.1f}" '
                   f'font-size="11">{name}</text>')  # fmt: skip
    out.append("</svg>")
    return "\n".join(out) + "\n"


# --- report --------------------------------------------------------------------------------


def _grid_table(fit: XtFit) -> list[str]:
    xs, ys = cell_centres()
    head = "| lane \\ x (m) | " + " | ".join(f"{x:+.0f}" for x in xs) + " |"
    rows = [head, "|---" * (NX + 1) + "|"]
    for j in reversed(range(NY)):
        cells = [f"{fit.grid[i, j]:.3f}" if fit.fitted[i, j] else f"*{fit.grid[i, j]:.3f}*"
                 for i in range(NX)]  # fmt: skip
        rows.append(f"| {ys[j]:+.1f} | " + " | ".join(cells) + " |")
    return rows


def report(fit: XtFit, halves: tuple[XtFit, XtFit], profiles: dict, version: str,
           hero: tuple[dict, dict], lenses: tuple[list, list], seconds: float) -> str:  # fmt: skip
    a, b = halves
    diff = np.abs(a.grid - b.grid)
    both = a.fitted & b.fitted
    cols = fit.grid.mean(axis=1)
    looks = [look_with(h.grid) for h in halves]
    end = hero_pass_end()
    z = xt.cell_of(end)

    def cell_note(f: XtFit) -> str:
        return f"{int(f.actions[z])} ({'fitted' if f.fitted[z] else 'prior at the floor'})"

    lines = [
        "# xT fit — Markov expected threat on synthetic open play",
        "",
        f"`uv run python -m eval.xt_fit` ({seconds / 60:.0f} min). Grid {NX} × {NY} for a team "
        "attacking +x, fitted by value iteration on `xT(z) = s(z)·g(z) + m(z)·Σ T(z→z')·xT(z')` "
        "(Singh 2019; our own implementation in `analytics/xt.py`, socceraction is not used). "
        f"Cached in `analytics/xt_grid.json` for sim version `{version}`.",
        "",
        "## Data",
        "",
        f"`open_play` seeds {SEEDS.start}–{SEEDS.stop - 1}, 45 s each: `possession_play`'s shape, "
        "pressing and marking, but every ball carrier decides with the decision model on his "
        "belief (SPEC 3.5), so play moves toward goal and some possessions end in shots. A shot "
        "scores its expected goals under the sim's shot model (the decision model's xG; the "
        "engine has no shot outcome model). A lost ball is worth 0. The decision model values "
        "options with the smooth prior, not this grid: the grid is fitted on the play it drives.",
        "",
        "The scripted scenarios cannot carry the fit: they have no shots at all.",
        "",
        "| Scenario (seeds) | Played (s) | Decisions | Passes complete / lost | Carries | Shots "
        "| Expected goals | Actions from the box |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for (name, seeds), p in profiles.items():
        lost = p.get("pass_intercepted", 0) + p.get("pass_out", 0)
        lines.append(
            f"| `{name}` ({seeds.start}–{seeds.stop - 1}) | {p['seconds']:.0f} | "
            f"{p['decisions']} | {p.get('pass_complete', 0)} / {lost} | {p['carry']} | "
            f"{p.get('shot', 0)} | {p['xg']:.1f} | {p['box']} |"
        )
    lines += [
        "",
        f"Fit: {int(fit.actions.sum()) // 2} actions, {int(fit.shots.sum()) // 2} shots, each also "
        "counted mirrored across the long axis (open play is symmetric in y: mirror-image shapes, "
        f"jitter and physics). {int(fit.fitted.sum())}/{NX * NY} cells have at least "
        f"{MIN_ACTIONS} actions (their own plus their mirror image's) and are fitted. The rest "
        "keep the smooth prior, moved down to the lowest fitted value: the prior's floor of "
        f"{xt.FLOOR} is a guess, and the fit measures it. At least {MIN_SHOTS} shots are needed "
        f"for any fit. Status: **{fit.status}**.",
        "",
        "## Acceptance checks (SPEC 4)",
        "",
        "| Check | Value | Pass |",
        "|---|---|---|",
    ]
    lines += [f"| {name} | {value} | {'yes' if ok else '**no**'} |" for name, value, ok in
              checks(fit.grid)]  # fmt: skip
    lines += [
        "",
        "Sanity plot: [xt_fit.svg](xt_fit.svg). Tested by "
        "[tests/test_xt.py](../../tests/test_xt.py) on the cached grid.",
        "",
        "![Fitted xT grid and column means](xt_fit.svg)",
        "",
        "## Grid",
        "",
        "Rows are lanes (y, metres from the long axis), columns run toward the attacked goal "
        "(x of the cell centre). *Italic*: too little data, the prior at the fitted floor.",
        "",
        *_grid_table(fit),
        "",
        "Column means: " + ", ".join(f"{v:.3f}" for v in cols) + ".",
        "",
        "## Stability",
        "",
        f"The same fit on each half of the seeds ({SEEDS.start}–{SEEDS.start + len(SEEDS) // 2 - 1}"
        f" and {SEEDS.start + len(SEEDS) // 2}–{SEEDS.stop - 1}).",
        "",
        "| | First half | Second half |",
        "|---|---|---|",
        f"| Shots | {int(a.shots.sum()) // 2} | {int(b.shots.sum()) // 2} |",
        f"| Fitted cells | {int(a.fitted.sum())} | {int(b.fitted.sum())} |",
        "| All checks pass | " + " | ".join(
            "yes" if all(ok for *_, ok in checks(h.grid)) else "**no**" for h in halves) + " |",
        "| Column means | " + " | ".join(
            ", ".join(f"{v:.3f}" for v in h.grid.mean(axis=1)) for h in halves) + " |",
        f"| The look's ΔxT on `{HERO[0]}` seed {HERO[1]} (narrated) | "
        + " | ".join(f"{v:.4f} ({v:.2f})" for v in looks) + " |",
        f"| Actions in the cell where that pass ends, {z} | {cell_note(a)} | {cell_note(b)} |",
        "",
        f"Cell by cell, where both halves fit the cell ({int(both.sum())} cells): mean |Δ| "
        f"{diff[both].mean():.4f}, 95th percentile {np.percentile(diff[both], 95):.4f}, max "
        f"{diff[both].max():.4f}. Column means differ by at most "
        f"{np.abs(a.grid.mean(axis=1) - b.grid.mean(axis=1)).max():.4f}. The hero's pass ends at "
        f"({end[0]:.1f}, {end[1]:.1f}) m, where play in the sim is thin: the whole fit has "
        f"{cell_note(fit)} actions in that cell, each half alone too few, so the halves' look "
        "values lean on the prior there.",
        "",
    ]  # fmt: skip
    before, after = hero
    (lb, la) = lenses
    lines += [
        "## What changes downstream",
        "",
        "Analytics and explain read the fitted grid (`analytics.xt.xt_for`): possession value "
        "after an action (`sim.counterfactual`, the ΔxT of a counterfactual), the lens values "
        "(`explain.lenses`), pass xT gain (`explain.moments`) and the Analyst's `get_xt` tool. "
        "The sim's decisions do not change, so neither does any run.",
        "",
        f"Hero moment (`{HERO[0]}` seed {HERO[1]}: `{after['actions'][0]}`, without the look "
        f"`{after['actions'][1]}`; unchanged):",
        "",
        "| Number | Prior | Fitted grid | Narrated |",
        "|---|---|---|---|",
        "| The look's ΔxT (“That look was worth … in expected threat”) "
        f"| {before['look']:.4f} | {after['look']:.4f} "
        f"| {before['look']:.2f} → {after['look']:.2f} |",
    ]
    for name in ("scan", "space", "pressure"):
        lines.append(f"| Lens `{name}` Δ | {before['lenses'][name]:+.4f} | "
                     f"{after['lenses'][name]:+.4f} | not narrated |")  # fmt: skip
    lines.append(f"| Selected lens | `{before['selected']}` | `{after['selected']}` | — |")

    def summary(rows: list) -> str:
        n = len(rows)
        scan = sum(sel == "scan" for sel, _, _ in rows)
        margin = np.median([m for _, m, _ in rows])
        ge = sum(g for *_, g in rows)
        return f"{scan}/{n} | {margin:.4f} | {ge}/{n}"

    lines += [
        "",
        f"Lens selection on `blind_side_run` seeds 0–39 and 100–139 ({len(LENS_SEEDS)}, SPEC 5.2):",
        "",
        "| | `scan` selected | Median Δscan − Δspace | Δscan ≥ Δspace |",
        "|---|---|---|---|",
        f"| Prior | {summary(lb)} |",
        f"| Fitted grid | {summary(la)} |",
        "",
    ]
    return "\n".join(lines)


def _total(rows: list[tuple[list[Action], dict]]) -> dict:
    total: Counter = Counter()
    for _, counts in rows:
        total.update(counts)
    return dict(total)


def main() -> None:
    t0 = time.time()
    runs = collect_runs(SEEDS)
    half = len(runs) // 2
    fit, *halves = (
        fit_xt([a for acts, _ in part for a in acts], MIN_ACTIONS, MIN_SHOTS, SYMMETRIC)
        for part in (runs, runs[:half], runs[half:])
    )
    version = sim_version()
    xt.GRID_PATH.write_text(grid_json(fit, version))
    xt.fitted_grid.cache_clear()

    profiles = {(SCENARIO, SEEDS): _total(runs)}
    for name, seeds in SCRIPTED:
        profiles[(name, seeds)] = _total(collect_runs(seeds, name))
    hero = (_hero_numbers(prior=True), _hero_numbers(prior=False))
    lenses = (lens_selection(prior=True), lens_selection(prior=False))

    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "xt_fit.svg").write_text(svg(fit))
    text = report(fit, tuple(halves), profiles, version, hero, lenses, time.time() - t0)
    (REPORTS / "xt_fit.md").write_text(text)
    print(text.split("## Grid")[0])
    print(f"wrote {xt.GRID_PATH}, {REPORTS / 'xt_fit.md'}, {REPORTS / 'xt_fit.svg'}")


if __name__ == "__main__":
    main()
