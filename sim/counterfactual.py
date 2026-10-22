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
from sim.model import Decision, Event
from sim.overrides import AddScan, DropScan, DropStep, ForceAction, NoScans
from sim.perception import scan_id
from sim.run import MatchRun

SHOT_OUTCOMES = ("goal", "saved", "wide", "blocked", "post")  # "post": back off the woodwork


@dataclass
class CounterfactualResult:
    scan_id: str  # intervention id: a scan id, or a step id when the intervention is drop_step
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
    if action.type == "shot" and action.attrs.get("outcome") == "goal":
        return 1.0  # a goal is worth one goal (xT and xG are both goal probabilities)
    end = np.array(action.attrs.get("end_at") or run.ball_pos[-1, :2])
    if action.attrs.get("outcome") == "complete":
        return float(xt_for(end, sign))
    if action.attrs.get("outcome") is None:  # still rolling when the run ended
        return float(xt_for(run.ball_pos[-1, :2], sign))
    return -float(xt_for(end, -sign))


def possession_result(run: MatchRun) -> str:
    """What the hero's action did with the ball: "kept" (a completed pass, or a carry nobody won
    off him), "lost" (intercepted, out of play, or tackled during the carry), "open" (a pass still
    rolling when the run ended), "shot", or "none" without a decision. With `Scenario.shots` a
    shot ends "goal", "saved", "wide", "blocked" or "post" (back into play off the woodwork)
    instead."""
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
    if action.type == "shot":  # with `Scenario.shots`, how the shot ended
        outcome = action.attrs.get("outcome")
        return outcome if outcome in SHOT_OUTCOMES else "shot"
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


def what_if_from_id(scenario: str, seed: int, what_if: str) -> WhatIfResult | LookResult:
    """Re-simulate a what-if by its id: `force:…` (a decision forced) or `look:…` (a look)."""
    if what_if.startswith(LOOK_PREFIX):
        player, frame, offset_deg = parse_look_id(what_if)
        return look_counterfactual(scenario, seed, frame, offset_deg, player)
    player, frame, action = parse_what_if_id(what_if)
    return force_action_counterfactual(scenario, seed, action, player, frame)


def is_what_if_id(ref: object) -> bool:
    return isinstance(ref, str) and ref.startswith((WHAT_IF_PREFIX, LOOK_PREFIX))


# --- "Take his eyes": the viewer chooses when and where he looks (SPEC 3.7, 7) -----------------
#
# From the pass to him until his decision, the player looks only where the viewer says: one scan
# (`AddScan`), and none of his own (`NoScans` for spontaneous and partial ones, `DropScan` for the
# scenario's forced ones, such as the key scan). Looks added on top of his own would collide with
# them: a forced scan waits for one under way, so an extra look before the key scan would cancel
# it, and in press_escape his own looks fill half the window. "No look" is the same window with no
# scan at all; for a scan hero it is the run without the key scan, byte for byte.

LOOK_PREFIX = "look:"
NO_LOOK = "none"


def look_id(player: str, frame: int | None, offset_deg: int | None) -> str:
    """ "look:H8:0050:-150": a look at frame 50, 150 degrees clockwise of the ball (over his right
    shoulder as he faces it). "look:H8:none": no look in the window."""
    if frame is None or offset_deg is None:
        return f"{LOOK_PREFIX}{player}:{NO_LOOK}"
    return f"{LOOK_PREFIX}{player}:{frame:04d}:{offset_deg:+04d}"


def parse_look_id(look: str) -> tuple[str, int | None, int | None]:
    if not look.startswith(LOOK_PREFIX):
        raise ValueError(f"not a look id: {look}")
    player, _, rest = look.removeprefix(LOOK_PREFIX).partition(":")
    if rest == NO_LOOK:
        return player, None, None
    frame, offset = rest.split(":")
    return player, int(frame), int(offset)


def look_window(run: MatchRun, player: str) -> tuple[int, int]:
    """[the frame the ball was played to him, his decision): when a look can change it."""
    decision = next((d for d in run.decisions if d.player == player), None)
    if decision is None:
        raise ValueError(f"{player} makes no decision to look for")
    kicks = [
        e.frame for e in run.events
        if e.type == "pass" and e.attrs.get("to") == player and e.frame < decision.frame
    ]  # fmt: skip
    if not kicks:
        raise ValueError(f"no pass to {player} before his decision")
    return max(kicks), decision.frame


@dataclass
class LookResult:
    """The factual run vs the same run where the player looks only where the viewer said."""

    id: str  # look_id(...): the intervention, also the counterfactual's id in claims
    player: str
    frame: int | None  # the look's first frame; None: no look at all
    offset: float | None  # rad from the ball, counter-clockwise positive
    window: tuple[int, int]  # look_window(...)
    dropped: list[str]  # his own scans in the window (factual run), which did not happen
    factual: MatchRun
    counterfactual: MatchRun
    factual_decision: Decision
    counterfactual_decision: Decision | None
    delta_xt: float  # possession value after his action: factual minus with this look

    @property
    def scan_id(self) -> str:
        """Interventions are looked up by id; for a look that is its own id."""
        return self.id

    @property
    def look(self) -> Event | None:
        """The viewer's scan in the counterfactual run."""
        if self.frame is None:
            return None
        return self.counterfactual.event(scan_id(self.player, self.frame))

    @property
    def factual_action(self) -> str:
        return self.factual_decision.chosen

    @property
    def counterfactual_action(self) -> str | None:
        return self.counterfactual_decision.chosen if self.counterfactual_decision else None


def look_overrides(
    run: MatchRun, player: str, frame: int | None, offset_deg: int | None
) -> tuple[tuple[int, int], list[Event], list]:
    """The window, his own scans in it (factual run) and the overrides of one look (see
    `look_counterfactual`). Resume from the window's first frame to apply them."""
    start, end = look_window(run, player)
    if frame is not None and not start <= frame < end:
        raise ValueError(f"frame {frame} is outside the window from the pass to {player} to his "
                         f"decision, [{start}, {end})")  # fmt: skip
    own = [e for e in run.events
           if e.type == "scan" and e.player == player and start <= e.frame < end]  # fmt: skip
    overrides: list = [NoScans(player, start, end)]
    overrides += [DropScan(e.id) for e in own if e.frame != frame]  # at his frame, ours replaces it
    if frame is not None and offset_deg is not None:
        overrides.append(AddScan(player, frame, float(np.deg2rad(offset_deg))))
    return (start, end), own, overrides


def look_counterfactual(
    scenario: str,
    seed: int,
    frame: int | None,
    offset_deg: int | None,
    player: str | None = None,
    record_draws: bool = False,
) -> LookResult:
    """Re-simulate a decision (default: the hero's) with the player's eyes taken: in the window
    from the pass to him to his decision, his only look is at `frame`, `offset_deg` whole degrees
    from the ball (counter-clockwise positive); `frame` None for no look at all. Refuses a look
    outside the window, one a scan cannot make (`AddScan`), and one that does not start because
    a scan of his from before the window is still under way."""
    probe = Simulation.from_scenario(scenario, seed).run()
    player = player or probe.hero
    if frame is None or offset_deg is None:
        frame = offset_deg = None
    (start, end), own, overrides = look_overrides(probe, player, frame, offset_deg)
    offset = None if offset_deg is None else float(np.deg2rad(offset_deg))
    factual, counterfactual = run_counterfactual(scenario, seed, start, overrides, record_draws)
    if frame is not None and not any(
        e.id == scan_id(player, frame) and e.attrs.get("added") for e in counterfactual.events
    ):
        raise ValueError(f"{player} cannot start a look at frame {frame}: a scan is under way")
    decision = next(d for d in factual.decisions if d.player == player and d.frame == end)
    looked = next((d for d in counterfactual.decisions if d.player == player), None)
    return LookResult(
        id=look_id(player, frame, offset_deg),
        player=player,
        frame=frame,
        offset=offset,
        window=(start, end),
        dropped=[e.id for e in own],
        factual=factual,
        counterfactual=counterfactual,
        factual_decision=decision,
        counterfactual_decision=looked,
        delta_xt=possession_value(factual) - possession_value(counterfactual),
    )


def drop_step_counterfactual(
    scenario: str, seed: int, step_id: str | None = None, record_draws: bool = False
) -> CounterfactualResult:
    """Factual run vs the same run without one step (by default the scenario's key step).

    The step id is stored on `scan_id`: that field is the intervention id."""
    if step_id is None:
        step_id = Simulation.from_scenario(scenario, seed).run().key_step().id
    start = int(step_id.rsplit(":", 1)[1])
    factual, counterfactual = run_counterfactual(
        scenario, seed, start, [DropStep(step_id)], record_draws
    )
    return CounterfactualResult(
        scan_id=step_id,
        factual=factual,
        counterfactual=counterfactual,
        factual_decision=factual.hero_decision(),
        counterfactual_decision=counterfactual.hero_decision(),
        delta_xt=possession_value(factual) - possession_value(counterfactual),
    )


def hero_counterfactual(
    scenario: str, seed: int, record_draws: bool = False
) -> CounterfactualResult | WhatIfResult:
    """The scenario's own intervention on its hero (`Scenario.intervention`, SPEC 3.6): the run
    without the key scan ("drop_scan"), without the key step ("drop_step"), or the hero forced
    to take an option ("force:carry")."""
    from sim.scenarios import SCENARIOS

    intervention = SCENARIOS[scenario].intervention
    if intervention == "drop_scan":
        return drop_scan_counterfactual(scenario, seed, record_draws=record_draws)
    if intervention == "drop_step":
        return drop_step_counterfactual(scenario, seed, record_draws=record_draws)
    if intervention and intervention.startswith("force:"):
        action = intervention.removeprefix("force:")
        return force_action_counterfactual(scenario, seed, action, record_draws=record_draws)
    raise ValueError(f"{scenario} has no hero intervention")
