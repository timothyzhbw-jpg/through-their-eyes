"""Hero scenario: playing out of a high press (SPEC 3.6, "high-press trap").

Home build-up from the back. The centre-back H5 plays square to his partner H4 at the corner of
the box. That pass is the away team's pressing trigger: A11 jumps out of midfield at H4, and A9,
who was closing H5 down, follows the ball to cut off the way back. H4 receives with A11 coming at
him; he has a touch to get the ball out before the press arrives.

This is a pressure story, not a perception one: the presser comes from the side H4 is facing
(the passer's side), so H4 sees him without looking over his shoulder, and nothing here forces,
suppresses or times a scan. What decides the moment is the turnover the press threatens deep in
H4's own half, which is what the pressure lens measures (SPEC 5.2). The intervention that tests it
is `force:carry`: had he kept the ball instead of passing, would the press have won it?

Tackles are on in this scenario (`Simulation._check_tackle`): an opponent who gets as close to a
carried ball as it takes to control a free one wins it. Without them a carry under any press would
keep the ball, and the pressure lens would describe a risk the sim never carries out.

Per seed (keyed draws): positions jitter, how tightly A10 screens the defensive midfielder H6,
when the pass is played, and how close A11 is when H4 has to decide (3.5–6 m).
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import numpy as np

from sim.ball import flight_time
from sim.config import A_MAX, DT, HALF_LENGTH, ROLES
from sim.decision import pass_speed
from sim.engine import DRIBBLE_OFFSET
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation

# id, role, x, y — the home team attacks +x; the away team presses high.
HOME = [
    ("H1", "GK", -48.0, 0.0),
    ("H2", "FB", -30.0, -28.0),
    ("H3", "FB", -28.0, 28.0),
    ("H4", "CB", -38.0, -12.0),
    ("H5", "CB", -38.0, 12.0),
    ("H6", "DM", -26.0, -3.0),
    ("H8", "CM", -18.0, -14.0),
    ("H10", "CM", -16.0, 12.0),
    ("H7", "W", -6.0, -27.0),
    ("H11", "W", -5.0, 27.0),
    ("H9", "ST", 0.0, 0.0),
]
AWAY = [
    ("A1", "GK", 46.0, 0.0),
    ("A2", "FB", -2.0, 22.0),
    ("A3", "FB", -2.0, -22.0),
    ("A4", "CB", 6.0, 5.0),
    ("A5", "CB", 6.0, -5.0),
    ("A6", "DM", -15.0, -14.0),
    ("A8", "DM", -13.0, 12.0),
    ("A10", "AM", -22.0, -2.0),
    ("A7", "AM", -27.0, -25.0),
    ("A11", "AM", -26.0, -11.0),
    ("A9", "ST", -33.0, 10.0),
]

# Man-oriented press: who marks whom once the ball is played back to H4. One of FREE is left
# open (a keyed draw): his marker drops off by LOOSE_GAP; everyone else is marked tightly.
MARKS = {"A10": "H6", "A9": "H5", "A6": "H8", "A8": "H10", "A7": "H2", "A5": "H9"}
FREE = ("H5", "H8")
TIGHT_GAP = (1.2, 2.0)  # m, goal-side of the attacker
LOOSE_GAP = (7.0, 10.0)  # m
DECISION_GAP = (3.5, 6.0)  # m, A11 from H4 when H4 decides
KICK_FRAMES = (8, 16)


def _run_time(distance: float, v_max: float) -> float:
    """Seconds to cover `distance` from a standstill at A_MAX, capped at v_max."""
    ramp = v_max**2 / (2 * A_MAX)
    if distance <= ramp:
        return math.sqrt(2 * distance / A_MAX)
    return v_max / A_MAX + (distance - ramp) / v_max


class PressEscape(Scenario):
    name = "press_escape"
    hero = "H4"
    lens = "pressure"
    intervention = "force:carry"
    tackles = True
    passer = "H6"
    presser = "A11"

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        ids = [p.id for p in players]
        pos = np.array([[x, y] for _, _, x, y in rows])
        pos += np.clip(gen.normal(0.0, 0.7, pos.shape), -1.5, 1.5)
        self.i_hero, self.i_passer = ids.index(self.hero), ids.index(self.passer)
        self.i_presser = ids.index(self.presser)
        self.free = FREE[int(gen.integers(len(FREE)))]
        self.marks = {}  # marker index -> (attacker index, gap)
        for marker, man in MARKS.items():
            gap = gen.uniform(*(LOOSE_GAP if man == self.free else TIGHT_GAP))
            self.marks[ids.index(marker)] = (ids.index(man), float(gap))

        self.spot = pos[self.i_hero].copy()
        self.kick_frame = int(gen.integers(*KICK_FRAMES))
        ball = pos[self.i_passer] + np.array([DRIBBLE_OFFSET, 0.0])
        dist = float(np.linalg.norm(self.spot - ball))
        t_ball = flight_time(pass_speed(dist), dist - 1.0)
        decision_frame = self.kick_frame + round(t_ball / DT) + 5  # first touch 0.2 s
        # A11 sets off so that he is DECISION_GAP away when H4 has to decide.
        run = float(np.linalg.norm(pos[self.i_presser] - self.spot)) - gen.uniform(*DECISION_GAP)
        t_run = _run_time(max(run, 0.0), ROLES["AM"].v_max)
        self.trap_frame = max(self.kick_frame, decision_frame - round(t_run / DT))
        return Setup(players=players, pos=pos, ball_owner=self.i_passer)

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        if sim.hero_acted:
            return {}
        out: dict[int, tuple[np.ndarray, float]] = {}
        if sim.owner != self.i_hero:
            out[self.i_hero] = (self.spot, 3.0)
        if frame >= self.trap_frame:
            out[self.i_presser] = (sim.pos[self.i_hero], sim.v_max[self.i_presser])
        else:
            out[self.i_presser] = (sim.pos[self.i_presser], 0.0)
        goal = np.array([HALF_LENGTH, 0.0])  # the away team defends +x
        for j, (a, gap) in self.marks.items():
            if j == sim.owner or a == sim.owner and frame < self.kick_frame:
                continue  # until the pass, base movement presses the passer
            side = goal - sim.pos[a]
            side /= max(float(np.linalg.norm(side)), 1e-6)
            out[j] = (sim.pos[a] + gap * side, sim.v_max[j])
        return out

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        if frame == self.kick_frame:
            return ForcedPass(self.passer, self.hero, (float(self.spot[0]), float(self.spot[1])))
        return None

    def decides(self, sim: Simulation, player: int) -> bool:
        return player == self.i_hero and not sim.hero_acted
