"""Counterfactual re-simulation (SPEC 3.7).

Snapshot the factual run just before the intervention, resume twice — unchanged and with the
override — and compare the decisions and outcomes. Keyed randomness makes the two runs share
every random draw, so they differ only through the intervention.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from analytics.xt import xt_for
from sim.engine import Simulation
from sim.model import Decision
from sim.overrides import DropScan
from sim.run import MatchRun


@dataclass
class CounterfactualResult:
    scan_id: str
    factual: MatchRun
    counterfactual: MatchRun
    factual_decision: Decision | None
    counterfactual_decision: Decision | None
    delta_xt: float  # possession value after the hero's action: factual minus counterfactual

    @property
    def factual_action(self) -> str | None:
        return self.factual_decision.chosen if self.factual_decision else None

    @property
    def counterfactual_action(self) -> str | None:
        return self.counterfactual_decision.chosen if self.counterfactual_decision else None


def run_counterfactual(
    scenario: str, seed: int, at_frame: int, overrides: Sequence, record_draws: bool = False
) -> tuple[MatchRun, MatchRun]:
    sim = Simulation.from_scenario(scenario, seed, record_draws=record_draws)
    sim.run_until(at_frame)
    snap = sim.snapshot()
    return Simulation.resume(snap).run(), Simulation.resume(snap, overrides).run()


def possession_value(run: MatchRun) -> float:
    """xT for the hero's team where his action ended; minus the opponent's xT if it was lost."""
    decision = run.hero_decision()
    if decision is None:
        return float("nan")
    hero = run.players[run.index(decision.player)]
    sign = 1 if hero.team == 0 else -1
    action = next(
        (e for e in run.events if e.player == decision.player and e.frame == decision.frame
         and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip
    if action is None:  # carry: wherever he ended up
        return float(xt_for(run.pos[-1, run.index(decision.player)], sign))
    end = np.array(action.attrs.get("end_at") or run.ball_pos[-1, :2])
    if action.attrs.get("outcome") == "complete":
        return float(xt_for(end, sign))
    if action.attrs.get("outcome") is None:  # still rolling when the run ended
        return float(xt_for(run.ball_pos[-1, :2], sign))
    return -float(xt_for(end, -sign))


def drop_scan_counterfactual(
    scenario: str, seed: int, scan_id: str | None = None, record_draws: bool = False
) -> CounterfactualResult:
    """Factual run vs the same run without one scan (by default the scenario's key scan)."""
    if scan_id is None:
        scan_id = Simulation.from_scenario(scenario, seed).run().key_scan().id
    start = int(scan_id.rsplit(":", 1)[1])
    factual, counterfactual = run_counterfactual(
        scenario, seed, start, [DropScan(scan_id)], record_draws
    )
    return CounterfactualResult(
        scan_id=scan_id,
        factual=factual,
        counterfactual=counterfactual,
        factual_decision=factual.hero_decision(),
        counterfactual_decision=counterfactual.hero_decision(),
        delta_xt=possession_value(factual) - possession_value(counterfactual),
    )
