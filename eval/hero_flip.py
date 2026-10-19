"""Hero-moment eval (SPEC 3.6): does dropping the key scan change the hero's decision?

    uv run python -m eval.hero_flip --scenario blind_side_run --seeds 100-139

Writes eval/reports/hero_flip_<scenario>.md with one row per seed and a summary.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from sim.counterfactual import drop_scan_counterfactual
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"


def _prob(decision, action: str) -> float:
    return next((o.prob for o in decision.options if o.action == action), 0.0)


def _hero_pass_outcome(run) -> str:
    decision = run.hero_decision()
    event = next(
        (e for e in run.events if e.player == decision.player and e.frame == decision.frame
         and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip
    return "carry" if event is None else str(event.attrs.get("outcome"))


def evaluate(scenario: str, seeds: list[int]) -> str:
    cls = SCENARIOS[scenario]
    runner = getattr(cls, "runner", None)
    key_action = f"pass:{runner}" if runner else None
    rows, changed, keyed, completed, deltas = [], 0, 0, 0, []
    for seed in seeds:
        r = drop_scan_counterfactual(scenario, seed)
        f, c = r.factual_decision, r.counterfactual_decision
        changed += r.factual_action != r.counterfactual_action
        outcome = _hero_pass_outcome(r.factual)
        if r.factual_action == key_action:
            keyed += 1
            completed += outcome == "complete"
        deltas.append(r.delta_xt)
        rows.append(
            f"| {seed} | `{r.factual_action}` | {_prob(f, key_action):.2f} | {outcome} "
            f"| `{r.counterfactual_action}` | {_prob(c, key_action):.2f} "
            f"| {f.belief_error[runner]:.1f} | {c.belief_error[runner]:.1f} | {r.delta_xt:+.3f} |"
        )
    n = len(seeds)
    summary = [
        f"# Hero flip — `{scenario}`",
        "",
        f"Seeds {seeds[0]}–{seeds[-1]} ({n}). Counterfactual: drop the key scan of `{cls.hero}` "
        "and re-simulate from the frame it starts (keyed randomness, Gumbel-max decisions).",
        "",
        "| Metric | Value | Target (SPEC) |",
        "|---|---|---|",
        f"| Decision changed without the key scan | {changed}/{n} ({changed / n:.0%}) | ≥ 60% |",
        f"| Factual decision is `{key_action}` | {keyed}/{n} ({keyed / n:.0%}) | — |",
        f"| … and the pass is completed | {completed}/{max(keyed, 1)} | — |",
        f"| Mean ΔxT (factual − counterfactual) | {np.mean(deltas):+.3f} | — |",
        "",
        f"| Seed | Factual | P({key_action}) | Outcome | Counterfactual | P({key_action}) "
        f"| Belief error {runner} F (m) | CF (m) | ΔxT |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    return "\n".join(summary + rows) + "\n"


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scenario", default="blind_side_run", choices=sorted(SCENARIOS))
    parser.add_argument("--seeds", default="100-139")
    args = parser.parse_args()
    report = evaluate(args.scenario, _parse_seeds(args.seeds))
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / f"hero_flip_{args.scenario}.md"
    path.write_text(report)
    print(report.split("\n\n| Seed")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
