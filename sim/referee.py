"""The referee (SPEC 3.9): the Laws of the Game enforced inside the frame loop.

The engine calls him when a player kicks the ball, when a free ball is next controlled, and when
it moves players. He judges with `sim.laws`, the same checks the audit (`eval/laws.py`) uses:
- at every pass or shot he notes who is in an offside position (IFAB Laws of the Game, Law 11.1);
- at the next touch he gives the offence if one of them became involved (Law 11.2, 11.3); the
  engine then stops play with an indirect free kick to the defenders where it happened (Law 11.4).
  A rebound off a post is no touch: the watch stays, so playing it is gaining an advantage;
- he keeps attackers onside while a teammate has the ball (`hold_the_line`) and opponents out of
  a set piece's exclusion zone until it is taken (`keep_back`): players who know the law.
The ball's Laws 9 and 10 (out of play, goals) are applied by the engine on every frame.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from sim import laws

if TYPE_CHECKING:
    from sim.engine import Simulation
    from sim.model import Event

# An attacker without the ball stays this far onside while a teammate has it: the second-last
# defender's line, the ball or the halfway line, less this margin. A style knob, not fitted: it
# keeps a runner clear of the carrier's offside doubt (`sim.decision`, 0.3 m + 1 m/s of belief age).
HOLD_MARGIN = 1.0  # m


@dataclass(frozen=True)
class Watch:
    """Offside positions when a teammate played the ball (Law 11.1)."""

    frame: int
    team: int  # the attacking team: the kicker's
    kicker: int
    kick: Event  # the pass or shot (its id may still change: a legacy shot is renamed)
    in_position: frozenset[int]
    margins: tuple[float, ...]  # every player's distance beyond the line (m)
    line_by: str  # the second-last opponent's id, "ball" or "halfway"
    restart: str | None  # the restart this kick takes, if any (Law 11.3)


@dataclass(frozen=True)
class Offence:
    """An offside offence: who, how, and where the indirect free kick is taken (Law 11.4)."""

    player: int
    how: str
    frame: int
    at: tuple[float, float]
    watch: Watch


class Referee:
    def __init__(self, restart: str | None = None) -> None:
        self.restart = restart  # the restart the run opens with: its first kick
        self.kicks = 0
        self.watch: Watch | None = None

    # --- Law 11 ----------------------------------------------------------------------------

    def kick(self, sim: Simulation, kicker: int, kick: Event) -> None:
        """A player plays the ball: note his teammates' offside positions at this moment."""
        attacking = int(sim.team[kicker])
        restart = self.restart if self.kicks == 0 else None
        self.kicks += 1
        if not _judgeable(sim, attacking):
            self.watch = None
            return
        ball = sim.ball_pos[:2]
        margins = laws.offside_margins(sim.pos, sim.team, ball, attacking)
        flags = laws.offside_positions(sim.pos, sim.team, ball, attacking, kicker=kicker)
        self.watch = Watch(
            frame=sim.frame,
            team=attacking,
            kicker=kicker,
            kick=kick,
            in_position=frozenset(int(j) for j in np.flatnonzero(flags)),
            margins=tuple(float(m) for m in margins),
            line_by=line_setter(sim.pos, sim.team, ball, attacking, sim.ids),
            restart=restart,
        )

    def shot(self, sim: Simulation, shooter: int, keeper: int) -> Offence | None:
        """At a strike: a teammate in an offside position blocking the keeper's view of it."""
        w = self.watch
        if w is None or keeper < 0:
            return None
        for j in sorted(w.in_position):
            if laws.obstructs_view(sim.pos[keeper], sim.ball_pos[:2], sim.pos[j]):
                how = laws.offside_offence(True, blocked_view=True)
                return Offence(j, how, sim.frame, _xy(sim.pos[j]), w)
        return None

    def touch(self, sim: Simulation, player: int) -> Offence | None:
        """A free ball is about to be controlled by `player`: was that an offside offence?

        A teammate of the kicker who was in an offside position plays the ball; or an opponent
        plays it while an attacker in an offside position challenges him for it. Either way the
        offside phase ends with this touch (an opponent's deliberate play resets it)."""
        w, self.watch = self.watch, None
        if w is None:
            return None
        if int(sim.team[player]) == w.team:
            how = laws.offside_offence(player in w.in_position, restart=w.restart, played_ball=True)
            return Offence(player, how, sim.frame, _xy(sim.pos[player]), w) if how else None
        near = np.linalg.norm(sim.pos - sim.ball_pos[:2], axis=-1) <= laws.CHALLENGE_RADIUS
        for j in sorted(w.in_position):
            if near[j]:
                how = laws.offside_offence(True, challenged=True)
                return Offence(j, how, sim.frame, _xy(sim.pos[j]), w)
        return None

    def offside_now(self, sim: Simulation, team: int, kicker: int) -> np.ndarray:
        """(N,) who of `team` would be in an offside position if `kicker` played the ball now."""
        return laws.offside_positions(sim.pos, sim.team, sim.ball_pos[:2], team, kicker=kicker)

    # --- players who know the law -----------------------------------------------------------

    def hold_the_line(self, sim: Simulation, target: np.ndarray) -> np.ndarray:
        """Movement targets with every attacker onside while his team has the ball.

        While a teammate has the ball, or a teammate's pass is on its way to someone else, an
        attacker keeps HOLD_MARGIN short of the offside line: the furthest of the halfway line,
        the ball and the second-last defender (Law 11.1). The intended receiver of a pass in
        flight runs to meet it; nobody holds a loose ball. Keepers are left alone."""
        if sim.owner >= 0:
            holder, receiver = sim.owner, -1
        elif sim.pass_in_flight is not None:
            holder, receiver = sim.pass_in_flight["passer"], sim.pass_in_flight["intended"]
        else:
            return target
        attacking = int(sim.team[holder])
        if not _judgeable(sim, attacking):
            return target
        line = max(
            0.0,
            float(laws.depth(sim.ball_pos[:2], attacking)),
            laws.second_last_depth(sim.pos, sim.team, attacking),
        )
        sign = laws.attack_sign(attacking)
        limit = line - HOLD_MARGIN
        out = target.copy()
        for j in np.flatnonzero(sim.team == attacking):
            if j in (sim.owner, receiver) or sim.players[j].role == "GK":
                continue
            if sign * out[j, 0] > limit:
                out[j, 0] = sign * limit
        return out

    def keep_back(self, sim: Simulation, target: np.ndarray) -> np.ndarray:
        """Until the run's opening set piece is taken, opponents' targets lie outside its zone:
        9.15 m from the corner arc (Law 17.1) or from the ball (Laws 8.1, 13.2), 2 m from a
        throw-in (Law 15.1), outside the penalty area at a goal kick (Law 16.1)."""
        if self.restart is None or self.kicks > 0 or sim.owner < 0:
            return target
        taker = sim.owner
        ball = sim.ball_pos[:2]
        if self.restart == "corner":
            centre, radius = (
                laws.nearest_corner(ball),
                laws.CORNER_ARC_RADIUS + laws.RESTART_DISTANCE,
            )
        elif self.restart == "throw_in":
            centre, radius = ball, laws.THROW_IN_DISTANCE
        elif self.restart in ("kick_off", "free_kick"):
            centre, radius = ball, laws.RESTART_DISTANCE
        else:
            return target  # a goal kick's zone is the penalty area: not used by any scenario
        out = target.copy()
        for j in np.flatnonzero(sim.team != sim.team[taker]):
            gap = out[j] - centre
            d = float(np.linalg.norm(gap))
            if d < radius:
                out[j] = centre + (gap / d if d > 1e-9 else np.array([0.0, 1.0])) * radius
        return out


def line_setter(pos: np.ndarray, team: np.ndarray, ball: np.ndarray, attacking: int, ids) -> str:
    """What sets the offside line: the second-last opponent's id, "ball" or "halfway"."""
    opp = np.flatnonzero(np.asarray(team) != attacking)
    d = laws.depth(laws.clip_to_field(pos[opp]), attacking)
    order = np.argsort(d, kind="stable")
    second, d2 = opp[order[-2]], float(d[order[-2]])
    db = float(laws.depth(np.asarray(ball)[:2], attacking))
    best = max(0.0, db, d2)
    return "halfway" if best == 0.0 else "ball" if best == db else ids[second]


def _judgeable(sim: Simulation, attacking: int) -> bool:
    """Offside needs a second-last opponent: a hand-built test scene may have fewer than two."""
    return int(np.count_nonzero(sim.team != attacking)) >= 2


def _xy(p: np.ndarray) -> tuple[float, float]:
    return float(p[0]), float(p[1])
