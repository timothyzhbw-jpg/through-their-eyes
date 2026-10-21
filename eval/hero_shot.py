"""Shot hero eval: does reading the keeper change the striker's placement?

    uv run python -m eval.hero_shot

Design seeds are 0-99; use --out outside eval/reports while tuning. The default command runs the
held-out seeds 200-239 and writes eval/reports/hero_shot_far_post_finish.md, including the keeper
reach-speed sensitivity sweep. Seeds 100-139 are no longer fresh: they were run once with an
earlier layout of the scene (the away defence out by the byline corners, the box empty), before
the defence was moved into the box. Their report is kept as ..._100-139.md, labelled as seen.
"""

from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path
from statistics import median

import numpy as np

from analytics.vision import player_visibility
from explain.functions import true_decision_context
from sim import shots
from sim.config import SimParams
from sim.counterfactual import SHOT_OUTCOMES, drop_scan_counterfactual
from sim.decision import placed_shot_value
from sim.model import Decision
from sim.run import MatchRun
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
HELD_OUT = range(200, 240)  # fresh: see the module docstring
SEEN = SimParams().perception_threshold


def truth_p_goal(run: MatchRun, decision: Decision) -> float:
    """Re-score the chosen placement on the true state at this run's own decision frame."""
    if not decision.chosen.startswith("shot:"):
        return 0.0  # No immediate shot is taken by a pass or carry.
    ctx = true_decision_context(run, run.index(decision.player), decision.frame)
    return placed_shot_value(ctx, decision.chosen.partition(":")[2])


def _side(run: MatchRun, decision: Decision | None) -> dict:
    if decision is None:
        return {"action": None, "p_goal": 0.0, "outcome": "no decision", "frame": len(run.owner)}
    shot = next(
        (e for e in run.events if e.type == "shot" and e.player == decision.player
         and e.frame == decision.frame), None,
    )  # fmt: skip
    outcome = "no shot" if shot is None else shot.attrs.get("outcome")
    if shot is not None and outcome not in SHOT_OUTCOMES:
        outcome = "unresolved"
    return {
        "action": decision.chosen,
        "p_goal": truth_p_goal(run, decision),
        "outcome": outcome,
        "frame": decision.frame,
    }


def _not_seen(run: MatchRun, observer: str, target: str, stop: int) -> bool:
    """Exclude frame zero's universal knowledge; inspect frames [1, stop)."""
    i, j = run.index(observer), run.index(target)
    speed = np.linalg.norm(run.vel, axis=-1)
    return all(
        player_visibility(run.pos[f], run.head_yaw[f], speed[f])[i, j] < SEEN
        for f in range(1, min(stop, len(run.owner)))
    )


def evaluate_seed(scenario: str, seed: int) -> dict:
    result = drop_scan_counterfactual(scenario, seed)
    factual = _side(result.factual, result.factual_decision)
    counterfactual = _side(result.counterfactual, result.counterfactual_decision)
    hero = SCENARIOS[scenario].hero
    key = result.factual.key_scan()
    team = result.factual.players[result.factual.index(hero)].team
    keeper = next(p.id for p in result.factual.players if p.team != team and p.role == "GK")
    factual_goal = factual["outcome"] == "goal"
    counterfactual_goal = counterfactual["outcome"] == "goal"
    return {
        "seed": seed,
        "f": factual,
        "c": counterfactual,
        "placement_changed": factual["action"] != counterfactual["action"],
        "delta": factual["p_goal"] - counterfactual["p_goal"],
        "design_rule": _not_seen(result.factual, hero, keeper, key.frame)
        and _not_seen(result.counterfactual, hero, keeper, counterfactual["frame"] + 1),
        "outcome_changed": factual["outcome"] != counterfactual["outcome"],
        "goal_factual": factual_goal,
        "goal_counterfactual": counterfactual_goal,
        "goal_changed": factual_goal != counterfactual_goal,
    }


def _sweep(scenario: str, seeds: list[int]) -> dict[float, int]:
    """Re-run placement choices for each uncited reach-speed endpoint; always restore state."""
    default = shots.KEEPER
    counts = {}
    try:
        for speed in shots.V_DIVE_SWEEP:
            shots.KEEPER = replace(default, v_dive=speed)
            changed = 0
            for seed in seeds:
                result = drop_scan_counterfactual(scenario, seed)
                changed += result.factual_action != result.counterfactual_action
            counts[speed] = changed
    finally:
        shots.KEEPER = default
    return counts


def report(scenario: str, seeds: list[int]) -> str:
    if not seeds:
        raise ValueError("at least one seed is required")
    default_speed = shots.KEEPER.v_dive
    rows = [evaluate_seed(scenario, seed) for seed in seeds]
    sweep = _sweep(scenario, seeds)
    n = len(rows)
    changed = sum(x["placement_changed"] for x in rows)
    design = sum(x["design_rule"] for x in rows)
    outcomes = sum(x["outcome_changed"] for x in rows)
    goals = sum(x["goal_changed"] for x in rows)
    goals_lost = sum(x["goal_factual"] and not x["goal_counterfactual"] for x in rows)
    goals_gained = sum(x["goal_counterfactual"] and not x["goal_factual"] for x in rows)
    delta = median(x["delta"] for x in rows)
    lines = [
        f"# Shot hero — `{scenario}`",
        "",
        f"Seeds {seeds[0]}–{seeds[-1]} ({n}). Counterfactual: drop the key scan of "
        f"`{SCENARIOS[scenario].hero}` and re-simulate from its start with keyed randomness. "
        f"Default keeper reach speed: {default_speed:g} m/s.",
        "",
        *(
            [
                "**Seen seeds, not a held-out gate:** 100–139 were run once with an earlier "
                "layout of the scene (the away defence out by the byline corners), before the "
                "defence was moved into the box. The held-out gate is seeds 200–239.",
                "",
            ]
            if set(seeds) & set(range(100, 140))
            else []
        ),
        "P_goal re-scores each run's chosen placement with `placed_shot_value` on "
        "`true_decision_context`: the true positions, velocities and ball at that run's decision "
        "frame, belief age zero, and the opponents' keeper (A1). "
        "The last incoming pass determines the near side exactly as in the engine. A pass or "
        "carry has zero immediate shot probability and is labelled `no shot`.",
        "",
        "| Metric | Value | Target |",
        "|---|---|---|",
        f"| Placement changed without the key scan | {changed}/{n} ({changed / n:.0%}) | ≥ 60% |",
        f"| Median ΔP_goal on truth (factual − counterfactual) | {delta:+.3f} | ≥ 0.300 |",
        f"| Design rule: A1 unseen from frame 1 until the key scan (factual) and until the "
        f"decision (counterfactual) | {design}/{n} ({design / n:.0%}) | ≥ 90% |",
        f"| Shot outcome label changed (e.g. wide -> saved), reported | "
        f"{outcomes}/{n} ({outcomes / n:.0%}) | reported |",
        f"| Goal status changed (goal with the look vs without), reported | "
        f"{goals}/{n} ({goals / n:.0%}); lost without the look: {goals_lost}; "
        f"gained without it: {goals_gained} | reported |",
    ]
    lines.extend(
        f"| Placement changed, v_dive = {speed:.1f} m/s (uncited, swept) "
        f"| {count}/{n} ({count / n:.0%}) | ≥ 60% |"
        for speed, count in sweep.items()
    )
    lines.extend(
        [
            "",
            f"Design visibility uses `player_visibility` < {SEEN:g} on every frame in each "
            "stated interval, including the counterfactual decision frame; frame zero is "
            "excluded because everyone starts known. "
            "The sweep re-runs both decisions and restores the default keeper afterwards.",
            "",
            "| Seed | Factual action | P_goal on truth | Factual outcome | Counterfactual action "
            "| P_goal on truth | Counterfactual outcome | Placement changed | ΔP_goal "
            "| Design rule | Goal status |",
            "|---|---|---|---|---|---|---|---|---|---|---|",
        ]
    )
    for row in rows:
        f, c = row["f"], row["c"]
        goal_status = (
            f"{'goal' if row['goal_factual'] else 'no goal'} → "
            f"{'goal' if row['goal_counterfactual'] else 'no goal'}"
        )
        lines.append(
            f"| {row['seed']} | `{f['action']}` | {f['p_goal']:.3f} | {f['outcome']} "
            f"| `{c['action']}` | {c['p_goal']:.3f} | {c['outcome']} "
            f"| {'yes' if row['placement_changed'] else 'no'} | {row['delta']:+.3f} "
            f"| {'yes' if row['design_rule'] else 'no'} | {goal_status} |"
        )
    return "\n".join(lines) + "\n"


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    seeds = list(range(int(lo), int(hi or lo) + 1))
    if not seeds:
        raise ValueError("seed range must be ascending")
    return seeds


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    candidates = [name for name, cls in SCENARIOS.items() if cls.shots and cls.lens == "scan"]
    parser.add_argument("--scenario", default="far_post_finish", choices=candidates)
    parser.add_argument("--seeds", default=f"{HELD_OUT[0]}-{HELD_OUT[-1]}")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds)
    text = report(args.scenario, seeds)
    name = f"hero_shot_{args.scenario}"
    if seeds != list(HELD_OUT):
        name += f"_{seeds[0]}-{seeds[-1]}"
    path = args.out or REPORTS / f"{name}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(text.split("\n\n| Seed")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
