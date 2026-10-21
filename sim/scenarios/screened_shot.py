"""The keeper finds a sightline through a crowded six-yard box (hero expansion C2).

Away attacks -x: A8 feeds A10 at the edge of the box. H4 is goal-side of A9 in the
six-yard box, with H5 covering behind H6 near the penalty spot. H4 and A9 overlap
in H1's view of the strike, although their bodies are separated
on the pitch. H5 covers just outside them. A small step opens a gap beside the screen;
H4 then moves across to cover the corner as the shot travels, under the same normal limits.

Every player moves through ordinary steering. The keeper starts his step about 0.9 s
before the estimated strike, allowing normal acceleration and braking to cover it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from sim import shots
from sim.ball import flight_time
from sim.config import DT
from sim.decision import pass_speed
from sim.engine import DRIBBLE_OFFSET
from sim.model import Event
from sim.scenarios.base import ForcedPass, ForcedShot, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation


# Outfield players away from the shot hold these spots. The screen, the passer, the shooter and
# H1 are placed in setup from the drawn ball and the step.
HOME = [
    ("H1", "GK", -51.0, 0.0),
    ("H2", "FB", -46.0, -16.0),
    ("H3", "FB", -46.0, 16.0),
    ("H4", "CB", -49.4, 0.0),
    ("H5", "CB", -44.8, 0.0),
    ("H6", "DM", -40.6, 0.0),
    ("H7", "CM", -29.0, -22.0),
    ("H8", "CM", -32.0, -11.0),
    ("H9", "ST", 8.0, 0.0),
    ("H10", "AM", -32.0, 11.0),
    ("H11", "W", -29.0, 22.0),
]
AWAY = [
    ("A1", "GK", 50.0, 0.0),
    ("A2", "FB", 15.0, -18.0),
    ("A3", "FB", 15.0, 18.0),
    ("A4", "CB", 8.0, -8.0),
    ("A5", "CB", 8.0, 8.0),
    ("A6", "DM", -6.0, -10.0),
    ("A7", "AM", -12.0, 18.0),
    ("A8", "DM", -32.5, 0.0),
    ("A9", "ST", -46.7, 0.0),
    ("A10", "AM", -35.0, 0.0),
    ("A11", "W", -14.0, -20.0),
]

SHOOTER_X = -35.0
PASSER_X = -32.5
POST_INSET = 0.4  # m inside the post; the decision model's inset is 0.5 m and is not used
HOLD_SPEED = 3.0  # m/s, as in far_post_finish; a target, never a position reset
SCREENERS = ("H4", "A9", "H5")
SCREEN_X = (-49.4, -46.7, -44.8)
SCREEN_OFFSETS = (0.12, -0.27, -0.40)  # m toward the step from the starting sightline
COVER_STEP_M = 0.65  # H4 covers the shot side after the strike, through ordinary steering
HOLD_FRAMES = 25
TOUCH_FRAMES = 5  # 0.2 s first touch
STEP_FRAMES = 22  # 0.88 s; normal A_MAX / D_MAX, no special step physics
LEAD_FRAMES = (22, 23)  # 0.88-0.92 s before the estimated strike
FIXED_GEOMETRY = ("H1", "H4", "H5", "H6", "A8", "A9", "A10")


class ScreenedShot(Scenario):
    name = "screened_shot"
    hero = "H1"
    lens = "sight"
    intervention = "drop_step"
    shots = True

    def setup(self, gen: np.random.Generator) -> Setup:
        y0 = float(gen.uniform(-4.0, 4.0))
        lateral = float(gen.uniform(0.63, 0.70))
        self.lead_s = float(gen.uniform(0.88, 0.92))
        self.side = 1.0 if y0 >= 0.0 else -1.0
        self.lateral = lateral
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        self.i = {p.id: j for j, p in enumerate(players)}
        self.i_h1, self.i_a8, self.i_a10 = self.i["H1"], self.i["A8"], self.i["A10"]
        pos = np.array([[x, y] for _, _, x, y in rows], dtype=float)
        jitter = np.clip(gen.normal(0.0, 0.3, pos.shape), -0.5, 0.5)
        for pid in FIXED_GEOMETRY:
            jitter[self.i[pid]] = 0.0
        pos += jitter

        ball = np.array([SHOOTER_X + DRIBBLE_OFFSET, y0])
        self.k0 = shots.bisector_point(ball, -1)
        self.k1 = self.k0 + np.array([0.0, self.side * lateral])
        self.aim = np.array([shots.goal_x(-1), self.side * (shots.GOAL_HALF_WIDTH - POST_INSET)])
        direction = ball - self.k0
        direction /= np.linalg.norm(direction)
        perp = np.array([-direction[1], direction[0]])
        if float(perp[1]) * self.side < 0.0:
            perp = -perp
        pos[self.i_h1] = self.k0
        for x, offset, pid in zip(SCREEN_X, SCREEN_OFFSETS, SCREENERS, strict=True):
            along = (x - float(self.k0[0])) / float(direction[0])
            pos[self.i[pid]] = self.k0 + along * direction + offset * perp
        # H6 protects the penalty spot, off the reception lane and the shot's path.
        pos[self.i["H6"]] = (-40.6, y0 - self.side * 3.0)
        pos[self.i_a8] = (PASSER_X, y0)
        pos[self.i_a10] = (SHOOTER_X, y0)
        self.spots = pos.copy()
        self.step_start = self.step_end = -1
        self.step_id: str | None = None
        self.step_emitted = False
        self.hold_until: int | None = None
        self.passed = False
        self.reception: int | None = None
        self.struck = False
        return Setup(players=players, pos=pos, ball_owner=self.i_a8)

    def _travel_frames(self, sim: Simulation, ball: np.ndarray, target: np.ndarray) -> int:
        distance = float(np.linalg.norm(target - ball))
        speed = pass_speed(distance, sim.decision_params, sim.ball_params)
        duration = flight_time(
            speed, max(distance - sim.params.control_radius, 0.0), sim.ball_params
        )
        return round(duration / DT)

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        if self.passed or sim.owner != self.i_a8:
            return None
        if self.hold_until is None:
            # The short layoff is scheduled now, so the keeper can start before the pass.
            # Starting only when it is kicked would leave too little acceleration time.
            self.hold_until = frame + HOLD_FRAMES
            target = self.spots[self.i_a10]
            travel = self._travel_frames(sim, sim.ball_pos[:2], target)
            lead = int(np.clip(np.rint(self.lead_s / DT), *LEAD_FRAMES))
            self.step_start = self.hold_until + travel + TOUCH_FRAMES - lead
            self.step_end = self.step_start + STEP_FRAMES
            self.step_id = f"step:H1:{self.step_start:04d}"
        if frame < self.hold_until:
            return None
        target = self.spots[self.i_a10]
        self.passed = True
        return ForcedPass("A8", "A10", (float(target[0]), float(target[1])))

    def forced_shot(self, sim: Simulation, frame: int) -> ForcedShot | None:
        if self.struck or sim.owner != self.i_a10:
            return None
        if self.reception is None:
            self.reception = frame
        if frame < self.reception + TOUCH_FRAMES:
            return None
        self.struck = True
        return ForcedShot("A10", "corner", (float(self.aim[0]), float(self.aim[1])))

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        out = {j: (spot, HOLD_SPEED) for j, spot in enumerate(self.spots) if j != self.i_h1}
        if self.struck:
            # The goal-side defender tries to cover the shot corner. This keeps the moving
            # screen physical too: on some inward errors H4 blocks it before the save model.
            cover = self.spots[self.i["H4"]] + np.array([0.0, self.side * COVER_STEP_M])
            out[self.i["H4"]] = (cover, HOLD_SPEED)
        # The ordinary shot/dive targets control H1 after the strike.
        if sim.shot_in_flight is not None and sim.shot_in_flight["keeper"] == self.i_h1:
            return out
        dropped = self.step_id is not None and self.step_id in sim.dropped_steps
        stepping = not dropped and self.step_start >= 0 and frame >= self.step_start
        out[self.i_h1] = (self.k1 if stepping else self.k0, HOLD_SPEED)
        if stepping and frame == self.step_start and not self.step_emitted:
            self.step_emitted = True
            sim.events.append(
                Event(
                    id=self.step_id or "",
                    type="step",
                    frame=frame,
                    t=frame * DT,
                    player="H1",
                    team=0,
                    attrs={
                        "start": [float(self.k0[0]), float(self.k0[1])],
                        "end": [float(self.k1[0]), float(self.k1[1])],
                        "lateral_m": float(self.lateral),
                        "key": True,
                    },
                )
            )
        return out

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        """H1 watches the ball. A scan at the strike would turn him away from it."""
        mask = np.zeros(len(sim.ids), dtype=bool)
        mask[self.i_h1] = True
        return mask

    def decides(self, sim: Simulation, player: int) -> bool:
        return False

    def ends_on_shot(self, sim: Simulation, shooter: int) -> bool:
        return sim.ids[shooter] == "A10"
