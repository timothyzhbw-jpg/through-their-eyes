"""The keeper scans before his first pass (SPEC 3.4–3.7).

Home defend -x. H4 recycles to H1 while A9 curves his press across the return lane.
The near full-back and both centre-backs are covered. Across the pitch H3 drops wide
and deep as A7 abandons his jump to press and retreats toward the midfield line.

An early, non-key look establishes H3 next to A7. H1 returns his attention to H4
before H3 moves, so only the key scan reveals the free outlet. Dropping that scan
leaves the old marked picture in his belief. Neither pass choice is scripted.

Goalkeeper scan rates are not calibrated: Jordet et al. (2020) excluded keepers.
Both looks here are forced; spontaneous H1 scans are suppressed until he acts.
Only H1 decides, and the story resolves at his pass's reception (with the engine's
standard recording tail), without a subsequent action by the receiver.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from analytics.vision import wrap_angle
from sim.ball import flight_time
from sim.config import DT
from sim.decision import pass_speed
from sim.engine import DRIBBLE_OFFSET
from sim.perception import ForcedScan
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation

# A split back four with the keeper supporting the near-side centre-back, a
# midfield three, and a high front three. Away hold a high, man-oriented press.
HOME = [
    ("H1", "GK", -45.0, -8.0),
    ("H2", "FB", -25.0, -29.0),
    ("H3", "FB", -29.0, 23.0),
    ("H4", "CB", -34.0, -19.0),
    ("H5", "CB", -33.0, 8.0),
    ("H6", "DM", -22.0, -1.0),
    ("H8", "CM", -13.0, -15.0),
    ("H10", "CM", -12.0, 13.0),
    ("H7", "W", -10.0, -29.0),
    ("H11", "W", -9.0, 28.0),
    ("H9", "ST", -5.0, -1.0),
]
AWAY = [
    ("A1", "GK", 24.0, 0.0),
    ("A2", "FB", -7.0, 26.0),
    ("A3", "FB", -8.0, -27.0),
    ("A4", "CB", -10.0, 13.0),
    ("A5", "CB", -3.0, -1.0),
    ("A6", "DM", -20.0, -1.0),
    ("A8", "DM", -11.0, -15.0),
    ("A10", "AM", -31.0, 8.0),
    ("A7", "W", -27.4, 24.4),
    ("A11", "W", -23.0, -27.0),
    ("A9", "ST", -31.0, -17.0),
]

# A10 joins A9 on the centre-backs; A6/A8 take the two deeper midfielders.
# A4 steps a few metres out of the high back line with the advanced midfielder.
MARKS = {"A11": "H2", "A10": "H5", "A6": "H6", "A8": "H8", "A4": "H10"}
SCAN_STOP_SHORT = np.deg2rad(40.0)


class KeeperSwitch(Scenario):
    name = "keeper_switch"
    hero = "H1"
    runner = "H3"
    passer = "H4"
    marker = "A7"
    lens = "scan"
    intervention = "drop_scan"

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        self.i = {p.id: j for j, p in enumerate(players)}
        i = self.i
        self.i_hero, self.i_runner = i[self.hero], i[self.runner]
        self.i_passer, self.i_marker = i[self.passer], i[self.marker]
        pos = np.array([[x, y] for _, _, x, y in rows])
        pos += np.clip(gen.normal(0.0, 0.3, pos.shape), -0.6, 0.6)
        # Paired marking offsets stay comfortably above the 0.7 m separation floor.
        for marker, man in MARKS.items():
            pos[i[marker]] = pos[i[man]] + np.array([1.6, 0.8])
        pos[self.i_marker] = pos[self.i_runner] + np.array([1.6, 1.4])
        self.spots = pos.copy()
        self.spot = pos[self.i_hero].copy()
        self.run_target = np.array([-37.0, 29.0]) + gen.uniform(-0.4, 0.4, 2)
        self.marker_push = pos[self.i_runner] + np.array([-1.0, 2.4])
        self.marker_drop = np.array([-17.0, 25.0]) + gen.uniform(-0.5, 0.5, 2)
        self.press_bend = np.array([-38.0, -16.0])
        self.press_target = self.spot + np.array([4.0, -3.0])
        self.survey_frame = 3
        self.run_start = 42 + int(gen.integers(0, 4))
        self.kick_frame = 65 + int(gen.integers(0, 5))
        ball = pos[self.i_passer] + np.array([DRIBBLE_OFFSET, 0.0])
        dist = float(np.linalg.norm(self.spot - ball))
        self.reception_frame = self.kick_frame + round(flight_time(pass_speed(dist), dist - 1) / DT)
        self.scan_frame = self.reception_frame - round(gen.uniform(0.75, 0.85) / DT)
        self.scan_dwell = float(gen.uniform(0.10, 0.14))
        return Setup(players=players, pos=pos, ball_owner=self.i_passer)

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        out = {j: (spot, 3.0) for j, spot in enumerate(self.spots) if j != sim.owner}
        if frame >= self.run_start:
            out[self.i_runner] = (self.run_target, 4.0)
            out[self.i_marker] = (self.marker_drop, 6.0)
        else:
            out[self.i_marker] = (self.marker_push, 2.0)
        if frame < self.kick_frame:
            out[self.i["A9"]] = (self.spots[self.i_passer] + np.array([2.0, 1.5]), 1.0)
        if frame >= self.kick_frame:
            bend = self.press_bend if frame < self.kick_frame + 15 else self.press_target
            out[self.i["A9"]] = (bend, 6.0)
        # Once H1 has played, the receiver's movement is handled by the normal pass
        # interception/control rules. No receiver makes a second decision.
        out.pop(sim.owner, None)
        return out

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        if frame == self.kick_frame:
            return ForcedPass(self.passer, self.hero, (float(self.spot[0]), float(self.spot[1])))
        return None

    def forced_scans(self, sim: Simulation, frame: int) -> dict[int, ForcedScan]:
        if frame not in (self.survey_frame, self.scan_frame):
            return {}
        me = sim.pos[self.i_hero]
        runner = sim.pos[self.i_runner] + 0.25 * sim.vel[self.i_runner]
        runner_dir = float(np.arctan2(*(runner - me)[::-1]))
        yaw = runner_dir
        if frame == self.scan_frame:
            ball_dir = float(np.arctan2(*(sim.ball_pos[:2] - me)[::-1]))
            delta = float(wrap_angle(runner_dir - ball_dir))
            if abs(delta) > np.deg2rad(100.0):
                yaw -= np.sign(delta) * SCAN_STOP_SHORT
        return {
            self.i_hero: ForcedScan(
                target_yaw=yaw, dwell_s=self.scan_dwell, key=frame == self.scan_frame
            )
        }

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        mask = np.zeros(len(sim.ids), dtype=bool)
        mask[self.i_hero] = not sim.hero_acted
        return mask

    def decides(self, sim: Simulation, player: int) -> bool:
        return player == self.i_hero and not sim.hero_acted
