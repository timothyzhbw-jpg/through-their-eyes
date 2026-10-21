"""Hero scenario: the defender reads the run (hero expansion C3).

The away team attacks -x. A8 has the ball in midfield and is about to play a through ball into
the channel behind the centre-back H5. The striker A9 starts beside H4, who marks him, and curls
behind H5, where H5, watching the ball, cannot see him. Just before A8 plays it, H5 decides
(`Scenario.defender_decides`, `sim.decision.evaluate_defender_options`): hold his position, or
cut the lane of one of A8's passes, valued on his belief by the passes A8 would then pick.

Hero design rule: A9 is visible to H5 only during the key scan, a look over his shoulder. His
previous sighting shows A9 beside H4, marked. With the look he cuts A9's lane and the existing
interception rules let him win the ball; without it he holds and A9 receives. The pass itself is
scripted; only H5 decides.

Per seed (keyed draws): positions jitter, when A9 sets off, where he runs, and the key scan's
timing and dwell.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from analytics.vision import wrap_angle
from sim.config import DT
from sim.perception import ForcedScan
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation

# id, role, x, y — the home team defends -x with a back four; the away team builds through A8.
HOME = [
    ("H1", "GK", -50.0, 0.0),
    ("H2", "FB", -30.0, -25.0),
    ("H3", "FB", -31.0, 22.0),
    ("H4", "CB", -31.0, 6.0),
    ("H5", "CB", -31.0, -4.0),
    ("H6", "DM", -20.0, 4.0),
    ("H8", "CM", -11.0, -4.0),
    ("H10", "CM", -12.0, 13.0),
    ("H7", "W", -4.0, -26.0),
    ("H11", "W", -3.0, 25.0),
    ("H9", "ST", 8.0, 0.0),
]
AWAY = [
    ("A1", "GK", 46.0, 0.0),
    ("A2", "FB", -8.0, 23.0),
    ("A3", "FB", -12.0, -27.0),
    ("A4", "CB", 6.0, 7.0),
    ("A5", "CB", 6.0, -7.0),
    ("A6", "DM", -4.0, 2.0),
    ("A8", "DM", -14.0, -11.0),
    ("A10", "AM", -22.0, 14.0),
    ("A7", "AM", -20.0, -22.0),
    ("A11", "W", -24.0, 25.0),
    ("A9", "ST", -29.0, 6.0),
]
HOLD_SPEED = 2.5  # m/s: players away from the ball hold their spots
DECIDE_FRAMES = (64, 72)  # H5 decides at A8's first touch; the pass follows
KICK_AFTER_FRAMES = (5, 8)  # 0.2-0.3 s
RUN_LEAD_S = (2.5, 2.8)  # A9 sets off this long before the pass
RUN_TARGET = (-37.0, -10.0)
RUN_JITTER = 1.0  # m
RUN_SPEED = 8.0  # m/s
SCAN_LEAD_S = (0.45, 0.70)  # the key scan starts this long before H5 decides
SCAN_DWELL_S = (0.10, 0.16)
SCAN_STOP_SHORT = np.deg2rad(40.0)


class ReadTheRun(Scenario):
    name = "read_the_run"
    hero = "H5"
    lens = "scan"
    intervention = "drop_scan"
    passer = "A8"
    runner = "A9"
    marker = "H4"
    key_action = "cut:A9"  # eval.hero_flip: the decision the key scan is for

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        ids = [p.id for p in players]
        self.i = {pid: k for k, pid in enumerate(ids)}
        pos = np.array([[x, y] for _, _, x, y in rows], dtype=float)
        pos += np.clip(gen.normal(0.0, 0.4, pos.shape), -0.8, 0.8)
        self.i_hero, self.i_runner = self.i[self.hero], self.i[self.runner]
        self.i_passer, self.i_marker = self.i[self.passer], self.i[self.marker]
        pos[self.i_runner] = pos[self.i_marker] + np.array([1.4, 0.8])  # H4 goal-side of A9
        self.spots = pos.copy()
        self.decide_frame = int(gen.integers(*DECIDE_FRAMES))
        self.kick_frame = self.decide_frame + int(gen.integers(*KICK_AFTER_FRAMES))
        self.run_start = self.kick_frame - round(gen.uniform(*RUN_LEAD_S) / DT)
        self.run_target = np.array(RUN_TARGET) + gen.uniform(-RUN_JITTER, RUN_JITTER, 2)
        self.scan_frame = self.decide_frame - round(gen.uniform(*SCAN_LEAD_S) / DT)
        self.scan_dwell = float(gen.uniform(*SCAN_DWELL_S))
        return Setup(players=players, pos=pos, ball_owner=self.i_passer)

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        out = {j: (spot, HOLD_SPEED) for j, spot in enumerate(self.spots)
               if j not in (sim.owner, self.i_runner)}  # fmt: skip
        if frame >= self.run_start:
            out[self.i_runner] = (self.run_target, RUN_SPEED)
        else:
            out[self.i_runner] = (self.spots[self.i_runner], HOLD_SPEED)
        if sim.hero_acted:
            out.pop(self.i_hero, None)  # his decision moves him (`Simulation.defending`)
        return out

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        if frame == self.kick_frame:
            t = self.run_target
            return ForcedPass(self.passer, self.runner, (float(t[0]), float(t[1])))
        return None

    def forced_scans(self, sim: Simulation, frame: int) -> dict[int, ForcedScan]:
        if frame != self.scan_frame:
            return {}
        me = sim.pos[self.i_hero]
        runner = sim.pos[self.i_runner] + 0.25 * sim.vel[self.i_runner]
        to_runner = float(np.arctan2(*(runner - me)[::-1]))
        to_ball = float(np.arctan2(*(sim.ball_pos[:2] - me)[::-1]))
        delta = float(wrap_angle(to_runner - to_ball))
        yaw = to_runner
        if abs(delta) > np.deg2rad(100.0):
            yaw -= np.sign(delta) * SCAN_STOP_SHORT
        return {self.i_hero: ForcedScan(target_yaw=yaw, dwell_s=self.scan_dwell, key=True)}

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        """H5 watches the ball: the key scan is his only look away until he decides."""
        mask = np.zeros(len(sim.ids), dtype=bool)
        mask[self.i_hero] = not sim.hero_acted
        return mask

    def defender_decides(self, sim: Simulation, frame: int) -> int | None:
        return self.i_hero if frame == self.decide_frame else None

    def decides(self, sim: Simulation, player: int) -> bool:
        return False

    def ends_on_pass(self, sim: Simulation, passer: int) -> bool:
        return passer == self.i_passer
