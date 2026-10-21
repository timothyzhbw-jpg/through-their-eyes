"""Set-piece hero eval (SPEC 3.6): does the marker's one look decide whether the runner is free?

    uv run python -m eval.hero_marking --scenario corner_blind_side --seeds 100-139

For each seed, the factual run and the run without the marker's key scan (`drop_scan`, keyed
randomness, so the runs differ only through the look). The moment is the cutback to the runner.
Writes eval/reports/hero_marking_<scenario>.md (with other seeds, ..._<first>-<last>.md).

- Gate: without the look the runner receives the cutback `unmarked` (the lexicon's nearest
  opponent > 5 m, SPEC 5.3), and with it the marker is within 5 m of him as the ball arrives, or
  wins the ball himself. Target ≥ 60% of seeds.
- Mechanism: without the look, the marker's belief error about the runner half a second after
  the cutback is played (when he would have to set off) is ≥ 3 m (target ≥ 90%). Design rule:
  the runner is not visible to the marker from the dart until the key scan (factual) or until the
  cutback (without the look); target ≥ 90%.
- Reported: separation and pressing intensity on the runner as the ball arrives, interceptions,
  and the blind-side alert (SPEC 4.4) for the marker and the runner: on before the cutback
  arrives without the look; on before the look and cleared during it with the look.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from statistics import median

import numpy as np

from analytics.pressing import frame_pressing
from analytics.vision import player_visibility
from explain.lenses import believed_position
from explain.lexicon import TERMS
from explain.moments import blind_side_alerts
from sim.config import SimParams
from sim.counterfactual import drop_scan_counterfactual
from sim.engine import Simulation
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
UNMARKED = TERMS["unmarked"].threshold  # m, nearest opponent beyond this
WITH_HIM = 5.0  # m, the marker this close as the ball arrives
BELIEF_ERROR = 3.0  # m
BELIEF_LAG_S = 0.5  # after the cutback is played
SEEN = SimParams().perception_threshold


def _cutback(run, passer: str):
    return max((e for e in run.events if e.type == "pass" and e.player == passer),
               key=lambda e: e.frame)  # fmt: skip


def _arrival(run, cut) -> int:
    end = cut.attrs.get("end")
    return min(int(end) if end is not None else len(run.owner) - 1, len(run.owner) - 1)


def _side(run, cut, marker: str, runner: str) -> dict:
    """Where the marker and the runner are as the cutback arrives."""
    f = _arrival(run, cut)
    m, r = run.index(marker), run.index(runner)
    team = np.array([p.team for p in run.players])
    opponents = np.flatnonzero(team != team[r])
    nearest = float(np.linalg.norm(run.pos[f, opponents] - run.pos[f, r], axis=-1).min())
    received = cut.attrs.get("receiver") == runner
    pressing = (
        frame_pressing(run.pos[f], run.vel[f], team, run.ball_pos[f, :2], r).on_carrier
        if received else float("nan")
    )  # fmt: skip
    return {
        "outcome": cut.attrs.get("outcome"),
        "receiver": cut.attrs.get("receiver"),
        "received": received,
        "marker_won": cut.attrs.get("receiver") == marker,
        "separation": float(np.linalg.norm(run.pos[f, m] - run.pos[f, r])),
        "nearest": nearest,
        "pressing": float(pressing),
    }


def _not_seen(run, marker: str, runner: str, start: int, stop: int) -> bool:
    """The runner is not visible to the marker on any frame in [start, stop)."""
    m, r = run.index(marker), run.index(runner)
    speed = np.linalg.norm(run.vel, axis=-1)
    return all(
        player_visibility(run.pos[f], run.head_yaw[f], speed[f])[m, r] < SEEN
        for f in range(start, stop)
    )


def _alerts(run, marker: str, runner: str):
    m, r = run.index(marker), run.index(runner)
    return [a for a in blind_side_alerts(run).intervals if (a.observer, a.target) == (m, r)]


def _alert_clears_in_scan(run, marker: str, runner: str, key) -> bool:
    on = [a for a in _alerts(run, marker, runner) if a.start < key.frame <= a.end]
    return len(on) == 1 and key.frame < on[0].end + 1 <= int(key.attrs["end"])


def _alert_before(run, marker: str, runner: str, start: int, stop: int) -> bool:
    return any(a.start < stop and a.end >= start for a in _alerts(run, marker, runner))


def evaluate_seed(scenario: str, seed: int) -> dict:
    cls = SCENARIOS[scenario]
    marker, runner, passer = cls.hero, cls.runner, cls.short
    probe = Simulation.from_scenario(scenario, seed)
    probe.run()
    dart = probe.scenario.dart_frame
    r = drop_scan_counterfactual(scenario, seed)
    key = r.factual.key_scan()
    fc, cc = _cutback(r.factual, passer), _cutback(r.counterfactual, passer)
    f, c = _side(r.factual, fc, marker, runner), _side(r.counterfactual, cc, marker, runner)
    run = r.counterfactual
    at = min(cc.frame + round(BELIEF_LAG_S / run.dt), _arrival(run, cc) - 1)
    belief = believed_position(run, marker, runner, at)
    belief_error = float(np.linalg.norm(belief - run.pos[at, run.index(runner)]))
    free_without = c["received"] and c["nearest"] > UNMARKED
    with_him = f["marker_won"] or (f["received"] and f["separation"] <= WITH_HIM)
    return {
        "seed": seed,
        "f": f,
        "c": c,
        "gate": bool(free_without and with_him),
        "belief_error": belief_error,
        "design_rule": _not_seen(r.factual, marker, runner, dart, key.frame)
        and _not_seen(r.counterfactual, marker, runner, dart, cc.frame),
        "alert": _alert_clears_in_scan(r.factual, marker, runner, key),
        "alert_without": _alert_before(run, marker, runner, dart, _arrival(run, cc)),
    }


def _fmt(side: dict) -> str:
    who = side["receiver"] or "—"
    pi = "—" if np.isnan(side["pressing"]) else f"{side['pressing']:.2f}"
    return f"{side['outcome']} → {who} | {side['separation']:.1f} | {side['nearest']:.1f} | {pi}"


def report(scenario: str, seeds: list[int]) -> str:
    cls = SCENARIOS[scenario]
    rows = [evaluate_seed(scenario, s) for s in seeds]
    n = len(rows)

    def count(pred) -> int:
        return sum(1 for x in rows if pred(x))

    gate = count(lambda x: x["gate"])
    belief = count(lambda x: x["belief_error"] >= BELIEF_ERROR)
    design = count(lambda x: x["design_rule"])
    alert = count(lambda x: x["alert"])
    alert_without = count(lambda x: x["alert_without"])
    f_sep = median(x["f"]["separation"] for x in rows)
    c_sep = median(x["c"]["separation"] for x in rows)
    heavy = count(lambda x: x["f"]["pressing"] >= TERMS["under heavy pressure"].threshold)
    won = count(lambda x: x["f"]["marker_won"])
    m, rn = cls.hero, cls.runner
    lines = [
        f"# Set-piece hero — `{scenario}`",
        "",
        f"Seeds {seeds[0]}–{seeds[-1]} ({n}). Counterfactual: drop the key scan of the marker "
        f"`{m}` and re-simulate from the frame it starts (keyed randomness). The moment is the "
        f"cutback to `{rn}`; distances are taken as it arrives.",
        "",
        "| Metric | Value | Target (SPEC 3.6) |",
        "|---|---|---|",
        f"| Without the look `{rn}` receives unmarked (nearest opponent > {UNMARKED:g} m), and "
        f"with it `{m}` is within {WITH_HIM:g} m or wins the ball | {gate}/{n} ({gate / n:.0%}) "
        "| ≥ 60% |",
        f"| Without the look, `{m}`'s belief error about `{rn}` {BELIEF_LAG_S:g} s after the "
        f"cutback is played ≥ {BELIEF_ERROR:g} m | {belief}/{n} ({belief / n:.0%}) | ≥ 90% |",
        f"| Design rule: `{rn}` unseen by `{m}` from the dart to the look (factual) or to the "
        f"cutback (without the look) | {design}/{n} ({design / n:.0%}) | ≥ 90% |",
        f"| Median separation as the ball arrives: with the look / without | {f_sep:.1f} m / "
        f"{c_sep:.1f} m | — |",
        f"| With the look: `{rn}` under heavy pressure (pressing ≥ 0.7) · `{m}` wins the ball "
        f"| {heavy}/{n} · {won}/{n} | — |",
        f"| Blind-side alert `{m}` → `{rn}`: on before the ball arrives, without the look · on "
        f"before the look and cleared during it, with the look | {alert_without}/{n} · "
        f"{alert}/{n} | reported |",
        "",
        "| Seed | With the look: outcome | sep. (m) | nearest (m) | pressing | Without: outcome "
        "| sep. (m) | nearest (m) | pressing | belief error (m) | gate |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for x in rows:
        lines.append(
            f"| {x['seed']} | {_fmt(x['f'])} | {_fmt(x['c'])} | {x['belief_error']:.1f} "
            f"| {'yes' if x['gate'] else 'no'} |"
        )
    return "\n".join(lines) + "\n"


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    marking = [s for s, c in SCENARIOS.items() if hasattr(c, "short")]
    parser.add_argument("--scenario", default="corner_blind_side", choices=marking)
    parser.add_argument("--seeds", default="100-139")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds)
    text = report(args.scenario, seeds)
    REPORTS.mkdir(exist_ok=True)
    default = REPORTS / f"hero_marking_{args.scenario}.md"
    if args.seeds != "100-139":
        default = REPORTS / f"hero_marking_{args.scenario}_{seeds[0]}-{seeds[-1]}.md"
    path = args.out or default
    path.write_text(text)
    print(text.split("\n\n| Seed")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
