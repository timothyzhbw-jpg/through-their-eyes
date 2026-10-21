"""Shot hero eval: does reading the keeper change the striker's placement?

    .venv/bin/python -m eval.hero_shot --seeds 100-139

Design seeds are 0-99; use --out outside eval/reports while tuning. The default command writes
eval/reports/hero_shot_far_post_finish.md, including the keeper reach-speed sensitivity sweep.
"""

from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path
from statistics import median

import numpy as np

from analytics.vision import player_visibility
from sim import shots
from sim.config import SimParams
from sim.counterfactual import SHOT_OUTCOMES, drop_scan_counterfactual
from sim.decision import DecisionContext, _placed_shot
from sim.model import Decision
from sim.run import MatchRun
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
SEEN = SimParams().perception_threshold


def truth_p_goal(run: MatchRun, decision: Decision) -> float:
    """Re-score the chosen placement on the true state at this run's own decision frame."""
    if not decision.chosen.startswith("shot:"):
        return 0.0  # No immediate shot is taken by a pass or carry.
    frame, carrier = decision.frame, run.index(decision.player)
    team = np.array([p.team for p in run.players])
    incoming = [
        e for e in run.events
        if e.type == "pass" and e.frame <= frame and e.attrs.get("to") == decision.player
    ]  # fmt: skip
    # The engine's _shot_context uses the last incoming pass's start, including a central shot.
    from_y = float(incoming[-1].attrs["start"][1]) if incoming else 0.0
    ctx = DecisionContext(
        carrier=carrier,
        team=team,
        pos=run.pos[frame].copy(),
        vel=run.vel[frame].copy(),
        age_s=np.zeros(len(run.players)),
        ids=run.ids,
        attack_sign=1 if team[carrier] == 0 else -1,
        ball=run.ball_pos[frame, :2].copy(),
        shots=True,
        keeper=run.index("A1"),
        from_y=from_y,
    )
    return _placed_shot(ctx, ctx.ball, decision.chosen.partition(":")[2]).p_success


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
    return {
        "seed": seed,
        "f": factual,
        "c": counterfactual,
        "placement_changed": factual["action"] != counterfactual["action"],
        "delta": factual["p_goal"] - counterfactual["p_goal"],
        "design_rule": _not_seen(result.factual, hero, "A1", key.frame)
        and _not_seen(result.counterfactual, hero, "A1", counterfactual["frame"] + 1),
        "outcome_changed": factual["outcome"] != counterfactual["outcome"],
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
    delta = median(x["delta"] for x in rows)
    lines = [
        f"# Shot hero — `{scenario}`",
        "",
        f"Seeds {seeds[0]}–{seeds[-1]} ({n}). Counterfactual: drop the key scan of "
        f"`{SCENARIOS[scenario].hero}` and re-simulate from its start with keyed randomness. "
        f"Default keeper reach speed: {default_speed:g} m/s.",
        "",
        "P_goal re-scores each run's chosen placement using `_placed_shot` on the true positions, "
        "velocities and ball at that run's decision frame, with belief age zero and keeper A1. "
        "The last incoming pass determines the near side exactly as in the engine. A pass or "
        "carry has zero immediate shot probability and is labelled `no shot`.",
        "",
        "| Metric | Value | Target |",
        "|---|---|---|",
        f"| Placement changed without the key scan | {changed}/{n} ({changed / n:.0%}) | ≥ 60% |",
        f"| Median ΔP_goal on truth (factual − counterfactual) | {delta:+.3f} | ≥ 0.300 |",
        f"| Design rule: A1 unseen from frame 1 until the key scan (factual) and until the "
        f"decision (counterfactual) | {design}/{n} ({design / n:.0%}) | ≥ 90% |",
        f"| Realised shot outcome changed | {outcomes}/{n} ({outcomes / n:.0%}) | reported |",
    ]
    lines.extend(
        f"| Placement changed, v_dive = {speed:g} m/s | {count}/{n} ({count / n:.0%}) | ≥ 60% |"
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
            "| Design rule |",
            "|---|---|---|---|---|---|---|---|---|---|",
        ]
    )
    for row in rows:
        f, c = row["f"], row["c"]
        lines.append(
            f"| {row['seed']} | `{f['action']}` | {f['p_goal']:.3f} | {f['outcome']} "
            f"| `{c['action']}` | {c['p_goal']:.3f} | {c['outcome']} "
            f"| {'yes' if row['placement_changed'] else 'no'} | {row['delta']:+.3f} "
            f"| {'yes' if row['design_rule'] else 'no'} |"
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
    parser.add_argument("--seeds", default="100-139")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds)
    text = report(args.scenario, seeds)
    name = f"hero_shot_{args.scenario}"
    if seeds != list(range(100, 140)):
        name += f"_{seeds[0]}-{seeds[-1]}"
    path = args.out or REPORTS / f"{name}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(text.split("\n\n| Seed")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
