"""The striker reads the keeper before meeting a cutback (hero expansion C1).

H3 switches play through H6 and H7, behind H9's run. His gaze follows the ball away from the
goal, and only the key scan shows him that A1 has crossed to the near side. A1 sets at the
bisector of H7's strike position while the cutback travels. Without the look, H9's last sighting
is the keeper on the opposite side at frame zero. Both shot choices and their outcomes come
from the normal belief decision and save models.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from analytics.vision import wrap_angle
from sim import shots
from sim.ball import flight_time
from sim.config import DT
from sim.decision import pass_speed
from sim.engine import DRIBBLE_OFFSET
from sim.perception import ForcedScan
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation


# Home attacks +x. Outfield players away from the routine hold their spots: the defenders have
# followed the wide players, leaving both the passing lanes and the striker's view of A1 clear.
HOME = [
    ("H1", "GK", -46.0, 0.0),
    ("H2", "FB", -2.0, -29.0),
    ("H3", "FB", 18.0, 24.0),
    ("H4", "CB", -4.0, -8.0),
    ("H5", "CB", -4.0, 8.0),
    ("H6", "DM", 22.0, 4.0),
    ("H8", "CM", 13.0, -15.0),
    ("H10", "CM", 30.0, 17.0),
    ("H7", "W", 34.0, -20.0),
    ("H11", "W", 23.0, 31.0),
    ("H9", "ST", 35.0, 2.0),
]
AWAY = [
    ("A1", "GK", 51.0, 1.3),
    ("A2", "FB", 48.0, 29.0),
    ("A3", "FB", 50.0, -32.0),
    ("A4", "CB", 47.0, 22.0),
    ("A5", "CB", 49.0, -25.0),
    ("A6", "DM", 4.0, -8.0),
    ("A8", "DM", 2.0, 15.0),
    ("A10", "AM", -8.0, 0.0),
    ("A7", "AM", -7.0, 22.0),
    ("A11", "AM", -9.0, -22.0),
    ("A9", "ST", -20.0, -1.0),
]

RUN_TARGET = np.array([41.0, -4.0])
RUN_SETTLE_S = 4.8  # acceleration, run and deceleration before the cutback arrives
SCAN_STOP_SHORT = np.deg2rad(40.0)
HOLD_SPEED = 3.0


class FarPostFinish(Scenario):
    name = "far_post_finish"
    hero = "H9"
    lens = "scan"
    intervention = "drop_scan"
    shots = True

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        self.i = {p.id: j for j, p in enumerate(players)}
        self.i_hero, self.i_keeper = self.i[self.hero], self.i["A1"]
        pos = np.array([[x, y] for _, _, x, y in rows])
        pos += np.clip(gen.normal(0.0, 0.45, pos.shape), -0.9, 0.9)
        ball = pos[self.i["H3"]] + np.array([DRIBBLE_OFFSET, 0.0])
        pos[self.i_keeper] = shots.bisector_point(ball, 1) + np.array(
            [0.0, gen.uniform(-0.15, 0.15)]
        )
        self.spots = pos.copy()
        self.run_target = RUN_TARGET + gen.uniform(-0.8, 0.8, 2)
        self.holds = [round(float(gen.uniform(0.3, 0.5)) / DT) for _ in range(3)]
        self.scan_lead = float(gen.uniform(0.55, 0.75))
        self.scan_dwell = float(gen.uniform(0.10, 0.16))
        self.stage = 0
        self.acquired: int | None = None
        self.keeper_set: np.ndarray | None = None
        self.run_start = self.reception_frame = self.scan_frame = -1
        return Setup(players=players, pos=pos, ball_owner=self.i["H3"])

    def _travel_frames(self, sim: Simulation, ball: np.ndarray, target: np.ndarray) -> int:
        distance = float(np.linalg.norm(target - ball))
        speed = pass_speed(distance, sim.decision_params, sim.ball_params)
        duration = flight_time(
            speed, max(distance - sim.params.control_radius, 0.0), sim.ball_params
        )
        return round(duration / DT)

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        passers, receivers = ("H3", "H6", "H7"), ("H6", "H7", self.hero)
        if self.stage >= len(passers):
            return None
        passer, receiver = passers[self.stage], receivers[self.stage]
        if sim.owner != self.i[passer]:
            return None
        if self.acquired is None:
            self.acquired = frame
        if frame < self.acquired + self.holds[self.stage]:
            return None
        target = self.run_target if receiver == self.hero else self.spots[self.i[receiver]]
        travel = self._travel_frames(sim, sim.ball_pos[:2], target)
        if self.stage == 1:
            # Start during the second pass, so H9 settles facing the incoming cutback. He must
            # not still face the goal when his first touch gives him possession.
            last_ball = self.spots[self.i["H7"]] + np.array([DRIBBLE_OFFSET, 0.0])
            last_travel = self._travel_frames(sim, last_ball, self.run_target)
            receive = frame + travel + self.holds[2] + last_travel
            self.run_start = max(frame, receive - round(RUN_SETTLE_S / DT))
        if self.stage == 2:
            # The final pass uses the actual kick position, rather than a setup-time estimate.
            self.reception_frame = frame + travel
            self.scan_frame = self.reception_frame - round(self.scan_lead / DT)
            self.keeper_set = shots.bisector_point(sim.ball_pos[:2], 1)
        self.stage += 1
        self.acquired = None
        return ForcedPass(passer, receiver, (float(target[0]), float(target[1])))

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        out = {
            j: (spot, HOLD_SPEED)
            for j, spot in enumerate(self.spots)
            if sim.players[j].role != "GK" and j != sim.owner
        }
        if not sim.hero_acted and sim.owner != self.i_hero:
            running = self.run_start >= 0 and frame >= self.run_start
            out[self.i_hero] = (
                self.run_target if running else self.spots[self.i_hero],
                8.5 if running else HOLD_SPEED,
            )
        if self.keeper_set is not None and not sim.hero_acted:
            # A1 sets for the cutback at the same bisector he took up against H7. Holding that
            # spot is part of this routine; the shot model controls him after H9 strikes.
            out[self.i_keeper] = (self.keeper_set, sim.v_max[self.i_keeper])
        return out

    def forced_scans(self, sim: Simulation, frame: int) -> dict[int, ForcedScan]:
        if frame != self.scan_frame:
            return {}
        me = sim.pos[self.i_hero]
        keeper = sim.pos[self.i_keeper]
        keeper_dir = float(np.arctan2(*(keeper - me)[::-1]))
        ball_dir = float(np.arctan2(*(sim.ball_pos[:2] - me)[::-1]))
        delta = float(wrap_angle(keeper_dir - ball_dir))
        yaw = keeper_dir
        if abs(delta) > np.deg2rad(100.0):
            yaw = keeper_dir - np.sign(delta) * SCAN_STOP_SHORT
        return {self.i_hero: ForcedScan(target_yaw=yaw, dwell_s=self.scan_dwell, key=True)}

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        """The key scan is H9's only look away before his decision."""
        mask = np.zeros(len(sim.ids), dtype=bool)
        mask[self.i_hero] = not sim.hero_acted
        return mask

    def decides(self, sim: Simulation, player: int) -> bool:
        return player == self.i_hero and not sim.hero_acted
