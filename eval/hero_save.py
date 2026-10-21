"""Save hero eval: does the keeper's step work because he sees the ball sooner?

    uv run python -m eval.hero_save

Design seeds are 0-99; use --out outside eval/reports while tuning. The default command runs the
held-out seeds 300-339 once and writes eval/reports/hero_save_screened_shot.md. The hard gate is
P_save with the step minus P_save without it, including the keeper reach-speed sweep. Do not tune
on 300-339. Seeds 200-239 were used by a rejected scene, so 300-339 are the gate.
"""

from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path

from sim import shots
from sim.config import DT
from sim.counterfactual import drop_step_counterfactual
from sim.engine import Simulation
from sim.model import Event
from sim.overrides import SightAt
from sim.run import MatchRun
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
HELD_OUT = range(300, 340)
HARD_GAP = 0.4
LATE_GAP = 0.25


def _shot(run: MatchRun) -> Event:
    return next(e for e in run.events if e.type == "shot")


def _delay(shot: Event) -> float | None:
    seen = shot.attrs["seen"]
    if seen is None:
        return None
    return (int(seen) - shot.frame) * DT


def _p_save(shot: Event) -> float | None:
    p = shot.attrs.get("p_save")
    return None if p is None else float(p)


def _late_frame(shot: Event) -> int:
    """The frame SightAt uses: when the no-step keeper saw the ball, or the shot's end."""
    seen = shot.attrs["seen"]
    if seen is not None:
        return int(seen)
    end = shot.attrs.get("end")
    return int(end) if end is not None else shot.frame + 1


def _later(delay_step: float | None, delay_no: float | None) -> bool:
    """Without the step, first sight is at least LATE_GAP seconds after the stepped sight."""
    if delay_no is None:
        return delay_step is not None
    if delay_step is None:
        return False
    return delay_no - delay_step >= LATE_GAP


def _hard(p_step: float | None, p_no: float | None) -> bool:
    return p_step is not None and p_no is not None and p_step - p_no >= HARD_GAP


def _sight_dominates(p_step: float | None, p_late: float | None, p_no: float | None) -> bool:
    if p_step is None or p_late is None or p_no is None:
        return False
    return (p_step - p_late) > (p_late - p_no)


def _with_late_sight(scenario: str, seed: int, step_frame: int, seen_frame: int) -> MatchRun:
    sim = Simulation.from_scenario(scenario, seed)
    sim.run_until(step_frame)
    return Simulation.resume(sim.snapshot(), [SightAt("H1", seen_frame)]).run()


def evaluate_seed(scenario: str, seed: int) -> dict:
    result = drop_step_counterfactual(scenario, seed)
    stepped, hidden = _shot(result.factual), _shot(result.counterfactual)
    late = _shot(
        _with_late_sight(scenario, seed, result.factual.key_step().frame, _late_frame(hidden))
    )
    p_step, p_no, p_late = _p_save(stepped), _p_save(hidden), _p_save(late)
    delay_step, delay_no = _delay(stepped), _delay(hidden)
    return {
        "seed": seed,
        "delay_step": delay_step,
        "delay_no": delay_no,
        "p_step": p_step,
        "p_no": p_no,
        "p_late": p_late,
        "delta_sight": None if p_step is None or p_late is None else p_step - p_late,
        "delta_position": None if p_late is None or p_no is None else p_late - p_no,
        "outcome_step": stepped.attrs.get("outcome"),
        "outcome_no": hidden.attrs.get("outcome"),
        "outcome_late": late.attrs.get("outcome"),
        "later": _later(delay_step, delay_no),
        "hard": _hard(p_step, p_no),
        "sight": _sight_dominates(p_step, p_late, p_no),
        "flip": stepped.attrs.get("outcome") == "saved" and hidden.attrs.get("outcome") == "goal",
    }


def _hard_passes(scenario: str, seeds: list[int]) -> int:
    passed = 0
    for seed in seeds:
        result = drop_step_counterfactual(scenario, seed)
        passed += _hard(_p_save(_shot(result.factual)), _p_save(_shot(result.counterfactual)))
    return passed


def _sweep(scenario: str, seeds: list[int]) -> dict[float, int]:
    """Re-run the hard gate at each uncited reach speed; always restore the default."""
    default = shots.KEEPER
    counts: dict[float, int] = {}
    try:
        for speed in shots.V_DIVE_SWEEP:
            shots.KEEPER = replace(default, v_dive=speed)
            counts[speed] = _hard_passes(scenario, seeds)
    finally:
        shots.KEEPER = default
    return counts


def _fmt_delay(value: float | None) -> str:
    return "never" if value is None else f"{value:.3f}"


def _fmt_p(value: float | None) -> str:
    return "—" if value is None else f"{value:.3f}"


def report(scenario: str, seeds: list[int]) -> str:
    if not seeds:
        raise ValueError("at least one seed is required")
    rows = [evaluate_seed(scenario, seed) for seed in seeds]
    sweep = _sweep(scenario, seeds)
    n = len(rows)
    later = sum(row["later"] for row in rows)
    hard = sum(row["hard"] for row in rows)
    sight = sum(row["sight"] for row in rows)
    flips = sum(row["flip"] for row in rows)
    hero = SCENARIOS[scenario].hero
    lines = [
        f"# Save hero — `{scenario}`",
        "",
        f"Seeds {seeds[0]}–{seeds[-1]} ({n}). Factual run: `{hero}` makes the key step. "
        "Counterfactual: drop that step and re-simulate from its start. The third run keeps "
        "the step but forces first sight (`SightAt`) to the frame the no-step run first saw "
        f"the ball. Default keeper reach speed: {shots.KEEPER.v_dive:g} m/s.",
        "",
        "P_save is the shot event's `p_save`. delta_sight is P(step) minus P(step, late sight). "
        "delta_position is P(step, late sight) minus P(no step). A missing `p_save` (the shot "
        "was blocked before the save model ran) fails the gates that need it. Delay is the "
        "time from the strike to first sight.",
        "",
        "| Metric | Value | Target |",
        "|---|---|---|",
        f"| Without the step, first sight ≥ {LATE_GAP:.2f} s later | {later}/{n} "
        f"({later / n:.0%}) | ≥ 90% |",
        f"| P_save(step) − P_save(no step) ≥ {HARD_GAP:.1f} | {hard}/{n} ({hard / n:.0%}) "
        "| ≥ 60% |",
        f"| delta_sight > delta_position | {sight}/{n} ({sight / n:.0%}) | ≥ 80% |",
        f"| Realised save to goal when the step is removed | {flips}/{n} ({flips / n:.0%}) "
        "| reported |",
    ]
    lines.extend(
        f"| P_save gap ≥ {HARD_GAP:.1f}, v_dive = {speed:g} m/s | {count}/{n} ({count / n:.0%}) "
        "| ≥ 60% |"
        for speed, count in sweep.items()
    )
    lines.extend(
        [
            "",
            "The sweep re-simulates the step and the dropped step only, then restores the "
            "default keeper. It does not re-run the late-sight decomposition.",
            "",
            "| Seed | Delay step (s) | Delay no step (s) | P_save step | P_save no step "
            "| P_save step+late | Δsight | Δposition | Outcome step | Outcome no step "
            "| Outcome late | ≥0.25 s later | Gap ≥ 0.4 | Sight > position | Save→goal |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['seed']} | {_fmt_delay(row['delay_step'])} | {_fmt_delay(row['delay_no'])} "
            f"| {_fmt_p(row['p_step'])} | {_fmt_p(row['p_no'])} | {_fmt_p(row['p_late'])} "
            f"| {_fmt_p(row['delta_sight'])} | {_fmt_p(row['delta_position'])} "
            f"| {row['outcome_step']} | {row['outcome_no']} | {row['outcome_late']} "
            f"| {'yes' if row['later'] else 'no'} | {'yes' if row['hard'] else 'no'} "
            f"| {'yes' if row['sight'] else 'no'} | {'yes' if row['flip'] else 'no'} |"
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
    candidates = [name for name, cls in SCENARIOS.items() if cls.intervention == "drop_step"]
    parser.add_argument("--scenario", default="screened_shot", choices=candidates)
    parser.add_argument("--seeds", default=f"{HELD_OUT[0]}-{HELD_OUT[-1]}")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds)
    text = report(args.scenario, seeds)
    name = "hero_save_screened_shot"
    if seeds != list(HELD_OUT):
        name += f"_{seeds[0]}-{seeds[-1]}"
    path = args.out or REPORTS / f"{name}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(text.split("\n\n| Seed")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
