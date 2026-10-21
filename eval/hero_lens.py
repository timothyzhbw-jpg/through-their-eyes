"""Hero lens eval (SPEC 3.6, 5.2): is the scenario's moment explained by the lens it was built for,
and does the scenario's intervention change the outcome?

    uv run python -m eval.hero_lens --scenario press_escape

Every hero scenario names the lens it is built to show (`Scenario.lens`) and the intervention that
tests it (`Scenario.intervention`, re-simulated with keyed randomness, SPEC 3.7):
- `drop_scan` (a `scan` hero): drop the key scan. The outcome changes when the decision does
  (`eval.hero_flip`).
- `force:<action>` (e.g. a `pressure` hero): make the hero take that option instead of sampling.
  The outcome changes when possession does: his team kept the ball after the factual action and
  lost it after the forced one, or the other way round.

For every seed the hero's decision moment is detected (`explain.moments`), all three lenses are
computed (`explain.lenses`), and the selected one is compared with the scenario's. Targets: the
intended lens in at least 60% of held-out seeds, and the intervention changes the outcome in at
least 60% (SPEC 3.6: otherwise the moment is not that lens's story). Held-out seeds are 100-139,
and 200-239 for `press_escape` (100-139 were seen while its decision-model fix was made). Writes
eval/reports/hero_lens_<scenario>.md on the held-out seeds, hero_lens_<scenario>_<seeds>.md on any
others, or the file `--out` names.

A hero with no decision on the ball (a marker, `corner_blind_side`) is read through his
`marker_scan` moment instead: only the scan lens applies (the expected turnover where the pass to
his man resolves, with the look minus without), and the outcome is `eval.hero_marking`'s gate
(without the look his man receives unmarked; with it he is within 5 m). Its report adds whether
the lens's Δ is positive and whether the lens's scan, the most informative one, is the key scan
(targets: moment detected ≥ 95%, scan lens ≥ 60%, Δ > 0 ≥ 60%, key scan ≥ 90%, outcome ≥ 60%).
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from explain.lenses import explain_moment
from explain.moments import detect_moments, hero_card
from sim.counterfactual import hero_counterfactual, possession_result
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
TARGET = 0.6
HELD_OUT = "100-139"
# 100-139 were seen while the decision model was fixed for this scenario (SPEC 3.5, 3.6).
HELD_OUT_BY_SCENARIO = {"press_escape": "200-239", "far_post_finish": "200-239"}


@dataclass
class Row:
    seed: int
    moment: str | None  # the hero's card id, None when no moment was detected
    selected: str | None
    deltas: dict[str, float | None]
    factual_action: str | None
    factual_result: str
    cf_action: str | None
    cf_result: str
    decision_changed: bool
    outcome_changed: bool
    realized_delta_xt: float
    key_scan: bool | None = None  # scan heroes with shots: the scan lens's scan is the key scan

    @property
    def margin(self) -> float | None:
        """|delta| of the selected lens minus the largest other |delta|."""
        if self.selected is None:
            return None
        mine = abs(self.deltas[self.selected])
        others = [abs(d) for k, d in self.deltas.items() if k != self.selected and d is not None]
        return mine - max(others, default=0.0)


def evaluate_seed(scenario: str, seed: int) -> Row:
    cf = hero_counterfactual(scenario, seed)
    run = cf.factual
    hero = run.hero_decision()
    card = None
    if hero is not None:
        card = next(
            (c for c in detect_moments(run)
             if (c.actor, c.anchor_frame) == (hero.player, hero.frame) and not c.live_only),
            None,
        )  # fmt: skip
    deltas: dict[str, float | None] = {"scan": None, "space": None, "pressure": None}
    selected, key_scan = None, None
    if card is not None:
        explained = explain_moment(card, run)
        selected = explained.selected_lens
        for lens in explained.lenses:
            deltas[lens.lens] = lens.delta_xt if lens.available else None
        scan = explained.lens("scan")
        if SCENARIOS[scenario].shots and scan is not None and scan.available:
            key_scan = scan.metrics["scan_id"] == run.key_scan().id
    if SCENARIOS[scenario].intervention == "drop_scan":
        outcome_changed = cf.factual_action != cf.counterfactual_action
    else:
        outcome_changed = possession_result(cf.factual) != possession_result(cf.counterfactual)
    return Row(
        seed=seed,
        moment=card.id if card else None,
        selected=selected,
        deltas=deltas,
        factual_action=cf.factual_action,
        factual_result=possession_result(cf.factual),
        cf_action=cf.counterfactual_action,
        cf_result=possession_result(cf.counterfactual),
        decision_changed=cf.factual_action != cf.counterfactual_action,
        outcome_changed=outcome_changed,
        realized_delta_xt=float(cf.delta_xt),
        key_scan=key_scan,
    )


def _fmt(x: float | None) -> str:
    return "—" if x is None else f"{x:+.4f}"


def report(scenario: str, rows: list[Row]) -> str:
    cls = SCENARIOS[scenario]
    n = len(rows)
    detected = sum(r.moment is not None for r in rows)
    picked = sum(r.selected == cls.lens for r in rows)
    changed = sum(r.outcome_changed for r in rows)
    kept = sum(r.factual_result == "kept" for r in rows)
    lost = sum(r.cf_result == "lost" for r in rows)
    counts = {k: sum(r.selected == k for r in rows) for k in ("scan", "space", "pressure")}
    margins = [r.margin for r in rows if r.selected == cls.lens and r.margin is not None]
    seeds = f"{rows[0].seed}–{rows[-1].seed}" if n else "none"
    what = (
        "the decision changes" if cls.intervention == "drop_scan"
        else "possession changes hands (kept ↔ lost)"
    )  # fmt: skip
    lines = [
        f"# Hero lens — `{scenario}`",
        "",
        f"Seeds {seeds} ({n}). Intended lens "
        f"`{cls.lens}`; intervention `{cls.intervention}` on `{cls.hero}`, re-simulated from the "
        "frame it applies (keyed randomness, Gumbel-max decisions). The outcome counts as changed "
        f"when {what}.",
        "",
        "| Metric | Value | Target |",
        "|---|---|---|",
        f"| Hero decision detected as a moment | {detected}/{n} | — |",
        f"| `{cls.lens}` lens selected | {picked}/{n} ({picked / max(n, 1):.0%}) | ≥ 60% |",
        f"| Intervention changes the outcome | {changed}/{n} ({changed / max(n, 1):.0%}) | ≥ 60% |",
        f"| … factual action kept the ball | {kept}/{n} | — |",
        f"| … the ball is lost after the intervention | {lost}/{n} | — |",
        "| Selected lens: scan · space · pressure | "
        f"{counts['scan']} · {counts['space']} · {counts['pressure']} | — |",
        f"| Median margin of `{cls.lens}` over the next lens (xT) | "
        f"{np.median(margins) if margins else float('nan'):.4f} | — |",
        f"| Mean realised ΔxT (factual − intervention) | "
        f"{np.mean([r.realized_delta_xt for r in rows]) if rows else float('nan'):+.4f} | — |",
        *_shot_rows(cls, rows),
        "",
        "Δ per lens in xT of the hero's team (SPEC 5.2); — when the lens is unavailable (e.g. no "
        "scan before the decision). Result: `kept` or `lost` possession after the hero's action.",
        "",
        "| Seed | Selected | Δscan | Δspace | Δpressure | Factual | Result | Intervention "
        "| Result | ΔxT |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r.seed} | {r.selected or '—'} | {_fmt(r.deltas['scan'])} "
            f"| {_fmt(r.deltas['space'])} | {_fmt(r.deltas['pressure'])} "
            f"| `{r.factual_action}` | {r.factual_result} | `{r.cf_action}` | {r.cf_result} "
            f"| {r.realized_delta_xt:+.3f} |"
        )
    return "\n".join(lines) + "\n"


# --- a hero with no decision on the ball (a marker's look) --------------------------------------


@dataclass
class MarkerRow:
    seed: int
    moment: str | None  # the hero's marker_scan card id
    selected: str | None
    delta: float | None  # the scan lens's Δ, xT of the hero's (defending) team
    key_scan: bool  # the lens's scan (the most informative) is the scenario's key scan
    # Where the pass to his man resolved, with the look and without it: the marker's distance to
    # his man (m), and pressing intensity on his man.
    separation: tuple[float, float] | None
    pressure: tuple[float, float] | None
    outcome_changed: bool  # eval.hero_marking's gate


def is_marker_hero(scenario: str) -> bool:
    """Whether the scenario's hero has no decision on the ball (judged on its first seed, 0)."""
    from sim.engine import Simulation

    return Simulation.from_scenario(scenario, 0).run().hero_decision() is None


def evaluate_marker_seed(scenario: str, seed: int) -> MarkerRow:
    from eval.hero_marking import evaluate_seed as marking

    run = hero_counterfactual(scenario, seed).factual
    card = hero_card(run, detect_moments(run))
    selected, delta, key, sep, press = None, None, False, None, None
    if card is not None:
        explained = explain_moment(card, run)
        selected = explained.selected_lens
        lens = explained.lens("scan")
        if lens is not None and lens.available:
            m = lens.metrics
            delta, key = lens.delta_xt, bool(m["key_scan"])
            sep = (float(m["separation_with_scan_m"]), float(m["separation_without_scan_m"]))
            press = (float(m["pressure_with_scan"]), float(m["pressure_without_scan"]))
    return MarkerRow(seed=seed, moment=card.id if card else None, selected=selected, delta=delta,
                     key_scan=key, separation=sep, pressure=press,
                     outcome_changed=bool(marking(scenario, seed)["gate"]))  # fmt: skip


def marker_report(scenario: str, rows: list[MarkerRow]) -> str:
    cls = SCENARIOS[scenario]
    n = len(rows)

    def share(k: int) -> str:
        return f"{k}/{n} ({k / max(n, 1):.0%})"

    detected = sum(r.moment is not None for r in rows)
    picked = sum(r.selected == cls.lens for r in rows)
    positive = sum(r.delta is not None and r.delta > 0 for r in rows)
    key = sum(r.key_scan for r in rows)
    changed = sum(r.outcome_changed for r in rows)
    deltas = [r.delta for r in rows if r.delta is not None]
    seeds = f"{rows[0].seed}–{rows[-1].seed}" if n else "none"
    lines = [
        f"# Hero lens — `{scenario}`",
        "",
        f"Seeds {seeds} ({n}). `{cls.hero}` has no decision on the ball: his moment is his look "
        "at the man he marks (`marker_scan`, `explain.moments`). Intended lens "
        f"`{cls.lens}`; intervention `{cls.intervention}`, re-simulated from the frame it applies "
        "(keyed randomness). The scan lens's Δ is the expected turnover where the pass to his man "
        "resolved (pressing intensity × stake, the pressure lens's cost), with the look minus "
        "without it; the space and pressure lenses need a decision on the ball and are "
        "unavailable. The outcome counts as changed when `eval.hero_marking`'s gate holds: "
        "without the look his man receives unmarked, with it he is within 5 m.",
        "",
        "| Metric | Value | Target |",
        "|---|---|---|",
        f"| Hero's look detected as a `marker_scan` moment | {share(detected)} | ≥ 95% |",
        f"| `{cls.lens}` lens selected | {share(picked)} | ≥ 60% |",
        f"| Scan lens Δ > 0 (the look raised the defence's expected turnover) | {share(positive)} "
        "| ≥ 60% |",
        f"| The lens's scan (the most informative) is the key scan | {share(key)} | ≥ 90% |",
        f"| Intervention changes the outcome | {share(changed)} | ≥ 60% |",
        f"| Median scan lens Δ (xT) | {np.median(deltas) if deltas else float('nan'):+.4f} | — |",
        "",
        "Separation: the marker to his man where the pass resolved (m). Pressure: pressing "
        "intensity on his man there. With the look / without it.",
        "",
        "| Seed | Selected | Δscan | Key scan | Separation | Pressure | Outcome changed |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        sep = "—" if r.separation is None else f"{r.separation[0]:.1f} / {r.separation[1]:.1f}"
        press = "—" if r.pressure is None else f"{r.pressure[0]:.2f} / {r.pressure[1]:.2f}"
        lines.append(
            f"| {r.seed} | {r.selected or '—'} | {_fmt(r.delta)} | "
            f"{'yes' if r.key_scan else 'no'} | {sep} | {press} | "
            f"{'yes' if r.outcome_changed else 'no'} |"
        )
    return "\n".join(lines) + "\n"


def _shot_rows(cls, rows: list[Row]) -> list[str]:
    """For a scan hero with shots (Module A): whether the scan lens's scan, the most informative
    one, is the key scan, and how often the space lens ties it (a placed shot's best alternative
    is the other placement, which is also what he picks without the look)."""
    if not cls.shots:
        return []
    n = len(rows)
    key = sum(bool(r.key_scan) for r in rows)
    ties = sum(r.deltas["scan"] is not None and r.deltas["scan"] == r.deltas["space"] for r in rows)
    return [
        f"| The scan lens's scan (the most informative) is the key scan | {key}/{n} "
        f"({key / max(n, 1):.0%}) | ≥ 90% |",
        f"| … Δscan equals Δspace (the tie goes to `scan`, §5.2) | {ties}/{n} | — |",
    ]


def evaluate(scenario: str, seeds: list[int]) -> tuple[list[Row] | list[MarkerRow], str]:
    if is_marker_hero(scenario):
        marker_rows = [evaluate_marker_seed(scenario, s) for s in seeds]
        return marker_rows, marker_report(scenario, marker_rows)
    rows = [evaluate_seed(scenario, s) for s in seeds]
    return rows, report(scenario, rows)


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def default_seeds(scenario: str) -> list[int]:
    """The scenario's held-out seeds."""
    return _parse_seeds(HELD_OUT_BY_SCENARIO.get(scenario, HELD_OUT))


def report_path(scenario: str, seeds: list[int], out: Path | None = None) -> Path:
    """`out`, else hero_lens_<scenario>.md for the held-out seeds and
    hero_lens_<scenario>_<first>-<last>.md for any others, so they never overwrite it."""
    if out is not None:
        return out
    if seeds == default_seeds(scenario):
        return REPORTS / f"hero_lens_{scenario}.md"
    return REPORTS / f"hero_lens_{scenario}_{seeds[0]}-{seeds[-1]}.md"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scenario", default="press_escape", choices=sorted(SCENARIOS))
    parser.add_argument("--seeds", help="e.g. 100-139 (default: the scenario's held-out seeds)")
    parser.add_argument("--out", type=Path, help="report path (default: by scenario and seeds)")
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds) if args.seeds else default_seeds(args.scenario)
    _, text = evaluate(args.scenario, seeds)
    path = report_path(args.scenario, seeds, args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(text.split("\n\nΔ per lens")[0].split("\n\nSeparation:")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
