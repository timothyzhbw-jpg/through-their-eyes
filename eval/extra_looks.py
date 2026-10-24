"""With two more looks (SPEC 3.4, 3.7): the opposite of the run without the look. Does the scan
hero decide differently when he also looks to his left and to his right before the ball arrives?

    uv run python -m eval.extra_looks

On the scan hero (`blind_side_run`, held-out seeds 100-139), H8 keeps every look of his own,
the key scan included, and makes two more (`sim.counterfactual.two_more_looks`, `ForceScans`):
- to his left, 2.6 s before he receives the ball: the earliest time inside every run (the ball
  reaches him 2.6-2.9 s in);
- to his right, as soon as his head is free again: the first look turned back and its refractory
  (0.3 s) is over.
Back to back and as early as the run allows, because a scan cannot start while another is under
way: two looks later than that run into his key scan (0.70-0.85 s before the ball reaches him)
and cancel it, so the run would lose a look instead of gaining two. The report counts the seeds
where his own looks all still happen. Left and right are from where his body faces, through the
same scan machinery as every scan (keyed peak speed, median dwell, 70-150 degrees from the ball);
vision and belief update as usual. A sensitivity row swaps the order (right first).

Per seed, factual (his own looks) against with the two looks added:
- belief error at reception: how far his belief puts the other 21 players (mean) and the runner
  from where they are, at the frame he receives the ball, after that frame's perception;
- whether his decision changed, and his pass target;
- whether he received the ball somewhere else;
- the expected threat (xT) where his action ended (`possession_value`).
Shares carry 95% Wilson intervals. Keyed randomness (SPEC 3.7): both runs share every draw.
Writes eval/reports/extra_looks_blind_side_run.md.
"""

from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from analytics.vision import player_visibility
from eval.season import wilson
from sim.config import DT, SimParams
from sim.counterfactual import (
    TWO_LOOKS,
    TWO_LOOKS_FIRST_S,
    ExtraLooksResult,
    possession_value,
    reception_frame,
    two_more_looks,
)
from sim.engine import Simulation
from sim.overrides import ForceScans
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
SCENARIO = "blind_side_run"
HELD_OUT = "100-139"
MOVED_M = 0.001  # a reception this far from the factual one counts as moved (1 mm, the export's)


def belief_error_at(
    scenario: str, seed: int, frame: int, observer: str, overrides=(), start: int = 0
) -> np.ndarray:
    """(N,) m: how far `observer`'s belief puts every player from the truth at `frame`, after
    that frame's perception, as a decision at `frame` would see it (`sim.engine`)."""
    sim = Simulation.from_scenario(scenario, seed)
    sim.run_until(start)
    sim = Simulation.resume(sim.snapshot(), overrides)
    sim.run_until(frame)
    if sim.frame != frame:
        raise ValueError(f"the run ended before frame {frame}")
    p = sim.params
    speed = np.linalg.norm(sim.vel, axis=-1)
    seen = player_visibility(sim.pos, sim.head_yaw, speed) >= p.perception_threshold
    beliefs = copy.deepcopy(sim.beliefs)
    beliefs.update(seen, frame, sim.pos, sim.vel)
    believed, _, _ = beliefs.estimate(sim.index(observer), frame, DT, p.belief_horizon_s)
    return np.linalg.norm(believed - sim.pos, axis=-1)


def _prob(decision, action: str) -> float:
    if decision is None:
        return float("nan")
    return next((o.prob for o in decision.options if o.action == action), 0.0)


def _receiver(action: str | None) -> str | None:
    return action.split(":", 1)[1] if action and action.startswith("pass:") else None


@dataclass
class Row:
    seed: int
    looks: list[tuple[int, int]]  # (frame, degrees from his body)
    reception: int
    kept_own: bool  # every look of his own still happened
    err_mean: float  # m, belief error at reception over the other 21: factual
    err_mean_cf: float  # … with the two looks
    err_runner: float
    err_runner_cf: float
    factual: str
    cf: str | None
    moved_m: float  # how far from the factual reception he received the ball
    xt: float
    xt_cf: float
    p_chosen: float  # the probability of his factual choice: factual
    p_chosen_cf: float  # … with the two looks
    swapped_changed: bool  # the sensitivity run (right first) changed his decision

    @property
    def changed(self) -> bool:
        return self.factual != self.cf

    @property
    def target_changed(self) -> bool:
        return _receiver(self.factual) != _receiver(self.cf)


def evaluate_seed(scenario: str, seed: int) -> Row:
    probe = Simulation.from_scenario(scenario, seed).run()
    r: ExtraLooksResult = two_more_looks(scenario, seed, probe=probe)
    swapped = two_more_looks(scenario, seed, TWO_LOOKS[::-1], probe=probe)
    hero, runner = r.player, SCENARIOS[scenario].runner
    received = r.reception
    i, j = probe.index(hero), probe.index(runner)
    others = np.arange(len(probe.players)) != i
    start = min(f for f, _ in r.looks)
    before = belief_error_at(scenario, seed, received, hero)
    after = belief_error_at(scenario, seed, received, hero, [ForceScans(hero, tuple(r.looks))],
                            start)  # fmt: skip
    cf_received = reception_frame(r.counterfactual, hero)
    moved = float(np.linalg.norm(r.counterfactual.pos[cf_received, i] - probe.pos[received, i]))
    return Row(
        seed=seed,
        looks=r.looks,
        reception=received,
        kept_own=not r.missing,
        err_mean=float(before[others].mean()),
        err_mean_cf=float(after[others].mean()),
        err_runner=float(before[j]),
        err_runner_cf=float(after[j]),
        factual=r.factual_action,
        cf=r.counterfactual_action,
        moved_m=moved,
        xt=possession_value(r.factual),
        xt_cf=possession_value(r.counterfactual),
        p_chosen=_prob(r.factual_decision, r.factual_action),
        p_chosen_cf=_prob(r.counterfactual_decision, r.factual_action),
        swapped_changed=swapped.factual_action != swapped.counterfactual_action,
    )


def _reading(changed: int, n: int, d_runner: np.ndarray) -> list[str]:
    """What the counts say, worded by what they are: no sentence the numbers do not back."""
    if changed / n >= 0.1 or abs(float(d_runner.mean())) >= 0.1:
        return []
    return [
        "Reading: more looks are not the same as the right look. His decision turns on the runner "
        "behind him, and only the key scan shows him (the hero design rule, SPEC 3.6). Looks to "
        "his sides refresh players he could already place, so his belief about the runner, and "
        "with it his decision, barely move.",
        "",
    ]


def _share(k: int, n: int) -> str:
    lo, hi = wilson(k, n)
    return f"{k}/{n} ({k / n:.0%}; 95% CI {lo:.0%}–{hi:.0%})"


def render(scenario: str, seeds: list[int], rows: list[Row]) -> str:
    n = len(rows)
    hero = SCENARIOS[scenario].hero
    runner = SCENARIOS[scenario].runner
    kept = sum(r.kept_own for r in rows)
    changed = sum(r.changed for r in rows)
    target = sum(r.target_changed for r in rows)
    moved = sum(r.moved_m > MOVED_M for r in rows)
    swapped = sum(r.swapped_changed for r in rows)
    lower = sum(r.err_mean_cf < r.err_mean for r in rows)
    higher = sum(r.err_mean_cf > r.err_mean for r in rows)
    d_p = np.array([r.p_chosen_cf - r.p_chosen for r in rows])
    d_mean = np.array([r.err_mean_cf - r.err_mean for r in rows])
    d_runner = np.array([r.err_runner_cf - r.err_runner for r in rows])
    d_xt = np.array([r.xt_cf - r.xt for r in rows])
    refractory = SimParams().scan_refractory_s
    lines = [
        f"# With two more looks — `{scenario}`",
        "",
        f"Seeds {seeds[0]}–{seeds[-1]} ({n}, held out). `{hero}` keeps every look of his own and "
        f"makes two more: to his {TWO_LOOKS[0]} {TWO_LOOKS_FIRST_S} s before he receives the ball, "
        f"and to his {TWO_LOOKS[1]} as soon as his head is free again (the first look back and "
        f"its {refractory} s refractory over). Directions are from where his body faces; both "
        "looks go through the sim's scan machinery (`ForceScans`), and both runs share every "
        "random draw (SPEC 3.7). Generated by `uv run python -m eval.extra_looks`.",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| His own looks all still happen (key scan included) | {_share(kept, n)} |",
        f"| Decision changed with two more looks | {_share(changed, n)} |",
        f"| Pass target changed | {_share(target, n)} |",
        f"| Reception position changed (> 1 mm) | {_share(moved, n)} |",
        f"| Belief error at reception lower (mean over the other 21) | {_share(lower, n)} |",
        f"| … higher | {_share(higher, n)} |",
        f"| Mean belief error at reception, other 21: factual → with looks | "
        f"{np.mean([r.err_mean for r in rows]):.2f} m → "
        f"{np.mean([r.err_mean_cf for r in rows]):.2f} m (mean change {d_mean.mean():+.2f} m) |",
        f"| Belief error about the runner `{runner}` at reception: factual → with looks | "
        f"{np.mean([r.err_runner for r in rows]):.2f} m → "
        f"{np.mean([r.err_runner_cf for r in rows]):.2f} m "
        f"(mean change {d_runner.mean():+.2f} m) |",
        f"| Probability of his factual choice: factual → with looks | "
        f"{np.mean([r.p_chosen for r in rows]):.3f} → {np.mean([r.p_chosen_cf for r in rows]):.3f} "
        f"(largest change {d_p[np.argmax(np.abs(d_p))]:+.3f}) |",
        f"| Mean xT where his action ended: factual → with looks | "
        f"{np.mean([r.xt for r in rows]):.3f} → {np.mean([r.xt_cf for r in rows]):.3f} "
        f"(mean change {d_xt.mean():+.3f}) |",
        f"| Sensitivity, {TWO_LOOKS[1]} first: decision changed | {_share(swapped, n)} |",
        "",
        "For comparison, removing his one key look: "
        f"[hero_flip_{scenario}](hero_flip_{scenario}.md).",
        "",
        *_reading(changed, n, d_runner),
        "| Seed | Looks (frame:deg) | Reception | Own looks kept | Belief err. 21 F → L (m) "
        f"| `{runner}` F → L (m) | Factual | With looks | P(factual choice) F → L | Moved (m) "
        "| xT F → L |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        looks = ", ".join(f"{f}:{d:+d}" for f, d in r.looks)
        lines.append(
            f"| {r.seed} | {looks} | {r.reception} | {'yes' if r.kept_own else 'no'} "
            f"| {r.err_mean:.2f} → {r.err_mean_cf:.2f} "
            f"| {r.err_runner:.2f} → {r.err_runner_cf:.2f} | `{r.factual}` | `{r.cf}` "
            f"| {r.p_chosen:.3f} → {r.p_chosen_cf:.3f} | {r.moved_m:.3f} "
            f"| {r.xt:.3f} → {r.xt_cf:.3f} |"
        )
    return "\n".join(lines) + "\n"


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seeds", default=HELD_OUT)
    parser.add_argument("--out", type=Path, default=REPORTS / f"extra_looks_{SCENARIO}.md")
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds)
    report = render(SCENARIO, seeds, [evaluate_seed(SCENARIO, s) for s in seeds])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(report)
    print(report.split("\n\nFor comparison")[0])
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
