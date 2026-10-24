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
from sim.config import SimParams
from sim.engine import Simulation
from sim.model import Decision, Event
from sim.overrides import (
    AddScan,
    DropScan,
    DropStep,
    ForceAction,
    ForceScans,
    NoScans,
    scan_direction_deg,
)
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


def what_if_from_id(
    scenario: str, seed: int, what_if: str
) -> WhatIfResult | LookResult | ExtraLooksResult:
    """Re-simulate a what-if by its id: `force:…` (a decision forced), `look:…` (a look) or
    `extra:…` (looks added on top of his own)."""
    if what_if.startswith(EXTRA_PREFIX):
        player, looks = parse_extra_looks_id(what_if)
        return extra_looks_at(scenario, seed, looks, player)
    if what_if.startswith(LOOK_PREFIX):
        player, frame, offset_deg = parse_look_id(what_if)
        return look_counterfactual(scenario, seed, frame, offset_deg, player)
    player, frame, action = parse_what_if_id(what_if)
    return force_action_counterfactual(scenario, seed, action, player, frame)


def is_what_if_id(ref: object) -> bool:
    return isinstance(ref, str) and ref.startswith((WHAT_IF_PREFIX, LOOK_PREFIX, EXTRA_PREFIX))


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


# --- "With two more looks": scans added on top of his own (SPEC 3.7) ---------------------------
#
# The opposite of the run without the look: he keeps every look of his own and makes more, each
# at a time before the ball reaches him and in a direction from where his body faces
# (`ForceScans`). His own scans are not touched, so an added look that is still under way (or in
# its refractory) when one of his own is due would cancel it: `extra_looks_counterfactual` lists
# his own scans that did not happen (`missing`), and a caller that wants them all kept checks it.

EXTRA_PREFIX = "extra:"


def extra_looks_id(player: str, looks: Sequence[tuple[int, int]]) -> str:
    """ "extra:H8:0009:+090,0029:-090": looks at frames 9 and 29, to his left and to his right."""
    parts = ",".join(f"{frame:04d}:{deg:+04d}" for frame, deg in looks)
    return f"{EXTRA_PREFIX}{player}:{parts}"


def parse_extra_looks_id(extra: str) -> tuple[str, list[tuple[int, int]]]:
    if not extra.startswith(EXTRA_PREFIX):
        raise ValueError(f"not an extra-looks id: {extra}")
    player, _, rest = extra.removeprefix(EXTRA_PREFIX).partition(":")
    looks = []
    for part in rest.split(","):
        frame, deg = part.split(":")
        looks.append((int(frame), int(deg)))
    return player, looks


def reception_frame(run: MatchRun, player: str) -> int:
    """The frame he received the ball for his first decision."""
    decision = next((d for d in run.decisions if d.player == player), None)
    if decision is None:
        raise ValueError(f"{player} makes no decision")
    frames = [
        e.frame for e in run.events
        if e.type == "reception" and e.player == player and e.frame <= decision.frame
    ]  # fmt: skip
    if not frames:
        raise ValueError(f"{player} receives no ball before his decision")
    return max(frames)


@dataclass
class ExtraLooksResult:
    """The factual run vs the same run where the player also makes the added looks."""

    id: str  # extra_looks_id(...): the intervention, also the counterfactual's id in claims
    player: str
    looks: list[tuple[int, int]]  # (frame, degrees from his body), as asked
    reception: int  # the frame he received the ball (factual run)
    added: list[str]  # the added scans' ids (counterfactual run)
    missing: list[str]  # his own scans before his decision (factual run) that did not happen
    factual: MatchRun
    counterfactual: MatchRun
    factual_decision: Decision
    counterfactual_decision: Decision | None
    delta_xt: float  # possession value after his action: factual minus with the added looks

    @property
    def scan_id(self) -> str:
        """Interventions are looked up by id; for added looks that is its own id."""
        return self.id

    @property
    def factual_action(self) -> str:
        return self.factual_decision.chosen

    @property
    def counterfactual_action(self) -> str | None:
        return self.counterfactual_decision.chosen if self.counterfactual_decision else None


def extra_looks_counterfactual(
    scenario: str,
    seed: int,
    looks: Sequence[tuple[float, str | int]],
    player: str | None = None,
    record_draws: bool = False,
    probe: MatchRun | None = None,
) -> ExtraLooksResult:
    """Re-simulate a decision (default: the hero's) with looks added on top of his own: each
    (seconds before he received the ball, direction), the direction a `SCAN_DIRECTIONS` name or
    whole degrees from where his body faces. Refuses a look before the run's first frame or not
    before his decision, and one that does not start (`ForceScans`). `probe`: the factual run,
    when the caller already has it."""
    probe = probe or Simulation.from_scenario(scenario, seed).run()
    player = player or probe.hero
    received = reception_frame(probe, player)
    frames = [(received - round(t / probe.dt), scan_direction_deg(d)) for t, d in looks]
    return extra_looks_at(scenario, seed, frames, player, record_draws, probe)


def extra_looks_at(
    scenario: str,
    seed: int,
    looks: Sequence[tuple[int, int]],
    player: str | None = None,
    record_draws: bool = False,
    probe: MatchRun | None = None,
) -> ExtraLooksResult:
    """`extra_looks_counterfactual` with each look's frame and degrees from his body given."""
    probe = probe or Simulation.from_scenario(scenario, seed).run()
    player = player or probe.hero
    decision = next((d for d in probe.decisions if d.player == player), None)
    if decision is None:
        raise ValueError(f"{player} makes no decision to look for")
    received = reception_frame(probe, player)
    frames = [(int(f), int(d)) for f, d in looks]
    if not frames:
        raise ValueError("no look to add")
    for frame, _ in frames:
        if not 0 <= frame < decision.frame:
            raise ValueError(f"a look at frame {frame} is outside [0, {decision.frame}), from "
                             f"the first frame to {player}'s decision")  # fmt: skip
    start = min(f for f, _ in frames)
    factual, counterfactual = run_counterfactual(
        scenario, seed, start, [ForceScans(player, tuple(frames))], record_draws
    )
    added = []
    for frame, _ in frames:
        sid = scan_id(player, frame)
        if not any(e.id == sid and e.attrs.get("added") for e in counterfactual.events):
            raise ValueError(f"{player} cannot start a look at frame {frame}: a scan is under way, "
                             "or the direction keeps the ball in view")  # fmt: skip
        added.append(sid)
    after = {e.id for e in counterfactual.events if e.type == "scan"}
    missing = [
        e.id for e in factual.events
        if e.type == "scan" and e.player == player and e.frame < decision.frame
        and e.id not in after
    ]  # fmt: skip
    decision = next(d for d in factual.decisions if d.player == player)
    looked = next((d for d in counterfactual.decisions if d.player == player), None)
    return ExtraLooksResult(
        id=extra_looks_id(player, frames),
        player=player,
        looks=frames,
        reception=received,
        added=added,
        missing=missing,
        factual=factual,
        counterfactual=counterfactual,
        factual_decision=decision,
        counterfactual_decision=looked,
        delta_xt=possession_value(factual) - possession_value(counterfactual),
    )


# The timing rule of "With two more looks" (eval/extra_looks.py): the first look this long before
# he receives the ball, the earliest time inside every run of the scan hero (the ball reaches H8
# 2.6-2.9 s into the run); the second as soon as his head is free again, when the first look has
# turned back and its refractory (`SimParams.scan_refractory_s`) is over. Back to back and as early
# as the run allows, both are over before his key scan, 0.70-0.85 s before the ball reaches him,
# so they add to his looks without cancelling one.
TWO_LOOKS_FIRST_S = 2.6
TWO_LOOKS = ("left", "right")


def two_more_looks(
    scenario: str,
    seed: int,
    directions: Sequence[str | int] = TWO_LOOKS,
    player: str | None = None,
    probe: MatchRun | None = None,
) -> ExtraLooksResult:
    """The hero's run with two looks added by the timing rule above, in `directions` order."""
    probe = probe or Simulation.from_scenario(scenario, seed).run()
    first, second = directions
    one = extra_looks_counterfactual(
        scenario, seed, [(TWO_LOOKS_FIRST_S, first)], player, probe=probe
    )
    end = int(one.counterfactual.event(one.added[0]).attrs["end"])
    free = end + round(SimParams().scan_refractory_s / probe.dt)
    looks = [(one.looks[0][0], scan_direction_deg(first)), (free, scan_direction_deg(second))]
    return extra_looks_at(scenario, seed, looks, one.player, probe=probe)


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
