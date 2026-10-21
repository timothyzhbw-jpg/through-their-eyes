"""Hero scenario: the winger checks the box before a cutback (SPEC 3.6).

Home attack +x. H2 releases H7 at the right byline, while H9 attacks the near post under A5's
tight marking. H8 arrives late at the penalty spot: A8 has followed the ball toward the right
channel instead of tracking him. The rest of the away back line protects the goal and far post;
home retain two centre-backs and a holding midfielder behind the attack.

Hero design rule: an early look shows H8 alongside A8 outside the box. H7 then watches the
incoming ball, with H8's run behind his field of view. Only his key scan into the box reveals
the free arrival. Dropping that scan leaves the old marked position in his belief. Both passes
use the ordinary ground-ball physics; H7 chooses on belief, and nobody decides after reception.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from sim.ball import flight_time
from sim.config import DT
from sim.decision import pass_speed
from sim.engine import DRIBBLE_OFFSET
from sim.perception import ForcedScan
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation


# id, role, x, y — an established attack down the home right (negative y).
HOME = [
    ("H1", "GK", -38.0, 0.0),
    ("H2", "FB", 45.0, -28.0),
    ("H3", "FB", 27.0, 24.0),
    ("H4", "CB", 5.0, -9.0),
    ("H5", "CB", 5.0, 10.0),
    ("H6", "DM", 23.0, 1.0),
    ("H8", "CM", 34.0, -1.0),
    ("H10", "CM", 35.0, 17.0),
    ("H7", "W", 47.8, -17.8),
    ("H11", "W", 44.0, 9.0),
    ("H9", "ST", 45.5, -8.0),
]
AWAY = [
    ("A1", "GK", 51.5, -3.0),
    ("A2", "FB", 42.0, 15.0),
    ("A3", "FB", 51.0, -9.0),
    ("A4", "CB", 48.5, 5.0),
    ("A5", "CB", 50.3, -4.8),
    ("A6", "DM", 38.0, 8.0),
    ("A8", "DM", 35.4, -0.2),
    ("A10", "AM", 28.0, -7.0),
    ("A7", "AM", 25.0, 22.0),
    ("A11", "AM", 27.0, -22.0),
    ("A9", "ST", 13.0, 0.0),
]


class CutbackScan(Scenario):
    name = "cutback_scan"
    hero = "H7"
    runner = "H8"
    marker = "A8"
    passer = "H2"
    lens = "scan"
    intervention = "drop_scan"

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        ids = [p.id for p in players]
        self.i = {pid: ids.index(pid) for pid in ids}
        self.i_hero, self.i_runner = self.i[self.hero], self.i[self.runner]
        self.i_passer, self.i_marker = self.i[self.passer], self.i[self.marker]
        pos = np.array([[x, y] for _, _, x, y in rows])
        pos += gen.uniform(-0.25, 0.25, pos.shape)
        pos[self.i_marker] = pos[self.i_runner] + np.array([-1.0, -1.4])
        pos[self.i["A5"]] = pos[self.i["H9"]] + np.array([0.9, 0.3])
        self.spots = pos.copy()
        self.run_target = np.array([40.5, -2.0]) + gen.uniform(-0.35, 0.35, 2)
        self.near_post = pos[self.i["H9"]] + np.array([3.5, 2.5])
        self.marker_hold = np.array([42.0, -16.0]) + gen.uniform(-0.3, 0.3, 2)
        self.fullback_close = np.array([50.0, -16.0]) + gen.uniform(-0.2, 0.2, 2)
        self.early_scan_frame = 1
        self.run_start = 30 + int(gen.integers(0, 4))
        self.kick_frame = 105 + int(gen.integers(0, 5))
        ball = pos[self.i_passer] + np.array([DRIBBLE_OFFSET, 0.0])
        distance = float(np.linalg.norm(pos[self.i_hero] - ball))
        arrival = flight_time(pass_speed(distance), distance - 1.0)
        self.reception_frame = self.kick_frame + round(arrival / DT)
        self.scan_frame = self.reception_frame - round(gen.uniform(0.70, 0.80) / DT)
        self.scan_dwell = float(gen.uniform(0.10, 0.16))
        return Setup(players=players, pos=pos, ball_owner=self.i_passer)

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        out = {j: (self.spots[j], 3.0) for j in range(len(sim.ids))}
        if frame >= self.run_start:
            out[self.i_runner] = (self.run_target, 4.5)
            out[self.i_marker] = (self.marker_hold, 3.0)
            out[self.i["A3"]] = (self.fullback_close, 3.0)
        out[self.i["H9"]] = (self.near_post, 3.5)
        out[self.i["A5"]] = (self.near_post + np.array([0.9, 0.3]), 3.5)
        # Let the engine execute H7's chosen carry, if any. Before the decision he holds the
        # receiving spot; the engine itself steers the intended receiver of each ground pass.
        if sim.hero_acted:
            out.pop(self.i_hero)
        return out

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        if frame == self.kick_frame:
            target = self.spots[self.i_hero]
            return ForcedPass(self.passer, self.hero, (float(target[0]), float(target[1])))
        return None

    def forced_scans(self, sim: Simulation, frame: int) -> dict[int, ForcedScan]:
        if frame not in (self.early_scan_frame, self.scan_frame):
            return {}
        me = sim.pos[self.i_hero]
        runner = sim.pos[self.i_runner] + 0.25 * sim.vel[self.i_runner]
        runner_dir = float(np.arctan2(*(runner - me)[::-1]))
        # Look across the box, between the penalty spot and the goal-side defenders. The
        # binocular cone includes both the runner and the players who could cut out his pass.
        yaw = runner_dir - np.deg2rad(25.0)
        return {
            self.i_hero: ForcedScan(
                target_yaw=yaw,
                dwell_s=self.scan_dwell,
                key=frame == self.scan_frame,
            )
        }

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        """H7's two scripted looks are his only looks away before choosing the cutback."""
        mask = np.zeros(len(sim.ids), dtype=bool)
        mask[self.i_hero] = not sim.hero_acted
        return mask

    def decides(self, sim: Simulation, player: int) -> bool:
        return player == self.i_hero and not sim.hero_acted
