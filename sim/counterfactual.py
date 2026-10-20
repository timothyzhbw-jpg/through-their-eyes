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
from sim.overrides import DropScan, ForceAction
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
    """xT for the hero's team where his action ended; minus the opponent's xT if it was lost
    (intercepted, out of play, or tackled while he carried it)."""
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
    if action is None:  # carry: wherever he ended up, unless a tackle won the ball off him
        tackle = next(
            (e for e in run.events if e.type == "tackle" and e.frame > decision.frame
             and e.attrs.get("won_from") == decision.player),
            None,
        )  # fmt: skip
        if tackle is not None:
            return -float(xt_for(np.array(tackle.attrs["at"]), -sign))
        return float(xt_for(run.pos[-1, run.index(decision.player)], sign))
    end = np.array(action.attrs.get("end_at") or run.ball_pos[-1, :2])
    if action.attrs.get("outcome") == "complete":
        return float(xt_for(end, sign))
    if action.attrs.get("outcome") is None:  # still rolling when the run ended
        return float(xt_for(run.ball_pos[-1, :2], sign))
    return -float(xt_for(end, -sign))


def possession_result(run: MatchRun) -> str:
    """What the hero's action did with the ball: "kept" (a completed pass, or a carry nobody won
    off him), "lost" (intercepted, out of play, or tackled during the carry), "open" (a pass still
    rolling when the run ended), "shot", or "none" without a decision."""
    decision = run.hero_decision()
    if decision is None:
        return "none"
    action = next(
        (e for e in run.events if e.player == decision.player and e.frame == decision.frame
         and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip
    if action is None:
        tackled = any(
            e.type == "tackle" and e.attrs.get("won_from") == decision.player
            and e.frame > decision.frame
            for e in run.events
        )  # fmt: skip
        return "lost" if tackled else "kept"
    if action.type == "shot":
        return "shot"
    outcome = action.attrs.get("outcome")
    return "open" if outcome is None else "kept" if outcome == "complete" else "lost"


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


# --- "What if…?": force one of the options the player evaluated (SPEC 3.7, 6) --------------------

WHAT_IF_PREFIX = "force:"


def what_if_id(player: str, frame: int, action: str) -> str:
    return f"{WHAT_IF_PREFIX}{player}:{frame:04d}:{action}"


def parse_what_if_id(what_if: str) -> tuple[str, int, str]:
    if not what_if.startswith(WHAT_IF_PREFIX):
        raise ValueError(f"not a what-if id: {what_if}")
    player, frame, action = what_if.removeprefix(WHAT_IF_PREFIX).split(":", 2)
    return player, int(frame), action


@dataclass
class WhatIfResult:
    """The factual run vs the same run with one decision forced to another option."""

    id: str  # what_if_id(...): the intervention, also used as the counterfactual's id in claims
    action: str
    factual: MatchRun
    counterfactual: MatchRun
    factual_decision: Decision
    counterfactual_decision: Decision | None
    delta_xt: float  # possession value after the action: factual minus the forced option

    @property
    def scan_id(self) -> str:
        """Interventions are looked up by id; for a what-if that is its own id."""
        return self.id

    @property
    def factual_action(self) -> str:
        return self.factual_decision.chosen

    @property
    def counterfactual_action(self) -> str | None:
        return self.counterfactual_decision.chosen if self.counterfactual_decision else None


def force_action_counterfactual(
    scenario: str,
    seed: int,
    action: str,
    player: str | None = None,
    frame: int | None = None,
    record_draws: bool = False,
) -> WhatIfResult:
    """Re-simulate a decision (default: the hero's) with `action` forced. Refuses an action that
    was not among the options the player evaluated."""
    probe = Simulation.from_scenario(scenario, seed).run()
    decision = next(
        (d for d in probe.decisions
         if (d.player == (player or probe.hero)) and (frame is None or d.frame == frame)),
        None,
    )  # fmt: skip
    if decision is None:
        raise ValueError(f"no decision by {player or probe.hero} to force")
    if action not in {o.action for o in decision.options}:
        raise ValueError(
            f"{action} is not an option of {decision.player} at frame {decision.frame}"
        )
    intervention = ForceAction(decision.player, decision.frame, action)
    factual, counterfactual = run_counterfactual(
        scenario, seed, decision.frame, [intervention], record_draws
    )
    forced = next(
        (d for d in counterfactual.decisions
         if d.player == decision.player and d.frame == decision.frame),
        None,
    )  # fmt: skip
    return WhatIfResult(
        id=what_if_id(decision.player, decision.frame, action),
        action=action,
        factual=factual,
        counterfactual=counterfactual,
        factual_decision=decision,
        counterfactual_decision=forced,
        delta_xt=possession_value(factual) - possession_value(counterfactual),
    )


def what_if_from_id(scenario: str, seed: int, what_if: str) -> WhatIfResult:
    player, frame, action = parse_what_if_id(what_if)
    return force_action_counterfactual(scenario, seed, action, player, frame)


def hero_counterfactual(
    scenario: str, seed: int, record_draws: bool = False
) -> CounterfactualResult | WhatIfResult:
    """The scenario's own intervention on its hero (`Scenario.intervention`, SPEC 3.6): the run
    without the key scan ("drop_scan"), or the hero forced to take an option ("force:carry")."""
    from sim.scenarios import SCENARIOS

    intervention = SCENARIOS[scenario].intervention
    if intervention == "drop_scan":
        return drop_scan_counterfactual(scenario, seed, record_draws=record_draws)
    if intervention and intervention.startswith("force:"):
        action = intervention.removeprefix("force:")
        return force_action_counterfactual(scenario, seed, action, record_draws=record_draws)
    raise ValueError(f"{scenario} has no hero intervention")
