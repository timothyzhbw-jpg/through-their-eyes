"""Teaching scenario: back to goal, three looks, then the half-turn (SPEC 3.6, "Teaching").

A coach's example. The centre-back H4 plays into the central midfielder H8, who has his back to
goal. Before the ball arrives H8 looks over his left shoulder, over his right shoulder and behind
him toward goal; as the ball comes, a last look up the pitch shows him the striker H9 and the
central defender A5, who has stepped out of the back line into the space between them. A5 is the
threat: he closes to press. So H8 drops back to receive with space, opens his body on the
half-turn, away from A5, and decides.

The look TIMES are scripted for teaching (`LOOKS`, as `ForceScans` makes a look: a direction from
where his body faces, the scan's keyed peak speed, the median dwell; SPEC 3.7). What he sees,
believes and does follows the sim: vision and belief as everywhere (SPEC 3.4), his pass from the
decision model on his belief (SPEC 3.5). Two small rules, scoped to this scenario, act on his
belief, never the truth:
1. Where he receives (`receiving_spot`). After each of his looks, his receiving spot moves to
   the point within MAX_SHIFT_M of the spot the pass was meant for that is furthest from the
   opponents he believes will be within NEAR_M of him when the ball arrives (his belief carried
   forward, at most the sim's one-second belief horizon), at most SHIFT_SPEED. Once the ball is on
   its way, only along its line, back toward the passer, so that he still meets it: the drop-back.
2. The half-turn (`half_turn_yaw`). From when the ball is HALF_TURN_START_S from him until he
   plays it, if he believes an opponent is within HALF_TURN_M, his body turns side-on, OPEN_DEG
   from facing the ball, away from that opponent (toward the forward lane on the other side).
   Otherwise he stays square to the ball.
The sim has no first touch or reception mechanics: the ball is at his feet as soon as he
controls it, 0.3 m along his body (`sim.engine.DRIBBLE_OFFSET`). So the half-turn changes his
body angle, and with it where the ball sits, where his eyes rest while he has it (his body's
direction, SPEC 3.4) and what an opponent can win ball-first (tackles are on); not the touch.

Spontaneous scans of H8 are off until he plays, so his looks are exactly the scripted ones and
dropping one (`DropScan`) is the only difference between runs. The app's intervention is the one
every scan hero has, `drop_scan` of the key look (the last, forward one); `eval/pro_scan.py`
compares the three looks with one (behind only).

Per seed (keyed draws): positions jitter, when the pass is played, how fast A5 steps out, and
where A6 and A8 drift to while H8 cannot see them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from analytics.vision import wrap_angle
from sim.ball import flight_time
from sim.config import DT
from sim.decision import pass_speed
from sim.engine import DRIBBLE_OFFSET
from sim.overrides import scan_direction_deg
from sim.perception import ForcedScan, scan_id, scan_turn
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation
    from sim.run import MatchRun

# id, role, x, y: the home team attacks +x. H8 faces his own half, so his left is -y. A5 stands in
# the lane between H8 and the striker H9, and steps out to press him from behind his right shoulder.
HOME = [
    ("H1", "GK", -46.0, 0.0),
    ("H2", "FB", 0.0, -27.0),
    ("H3", "FB", 2.0, 26.0),
    ("H4", "CB", -10.0, -6.0),
    ("H5", "CB", -9.0, 9.0),
    ("H6", "DM", 2.0, 4.0),
    ("H8", "CM", 12.0, -4.0),
    ("H10", "CM", 18.0, 16.0),
    ("H7", "W", 24.0, -27.0),
    ("H11", "W", 27.0, 25.0),
    ("H9", "ST", 34.0, -7.0),
]
AWAY = [
    ("A1", "GK", 48.0, 0.0),
    ("A2", "FB", 37.0, 19.0),
    ("A3", "FB", 37.0, -19.0),
    ("A4", "CB", 39.0, 2.0),
    ("A5", "CB", 21.0, 0.5),
    ("A6", "DM", 17.0, -16.0),
    ("A8", "DM", 19.0, 13.0),
    ("A10", "AM", 4.0, 12.0),
    ("A7", "AM", 6.0, -22.0),
    ("A11", "AM", 8.0, 24.0),
    ("A9", "ST", -1.0, 20.0),
]

# His looks: (label, direction from where his body faces in whole degrees, seconds before the
# planned reception). Left and right over his shoulders; behind him toward goal (over his left
# shoulder, as far as a scan turns); the forward look up the pitch toward the striker (over his
# right shoulder), as the ball comes. The last is the key look.
LOOKS = (("L", "120", 5.15), ("R", "-120", 3.9), ("B", "150", 2.7), ("F", "-150", 1.25))
KEY = "F"
STEP_OUT_S = (1.9, 2.1)  # A5 steps out this long before the planned reception
PRESS_SIDE = (1.0, 2.0)  # m: where A5 presses, beside H8 (behind his right shoulder)
DRIFT = {"A6": ((15.0, -12.0), 2.0), "A8": ((17.0, 9.0), 2.0)}  # unseen drift: spot, m/s
DRIFT_JITTER = 1.0  # m
KICK_FRAMES = (76, 84)
# Rule 1, where he receives.
NEAR_M = 7.0  # opponents he believes this close to him count
MAX_SHIFT_M = 3.0  # never further than this from the spot the pass was meant for
SHIFT_SPEED = 4.0  # m/s
GRID_M = 0.25
# Rule 2, the half-turn.
HALF_TURN_M = 6.0  # X: an opponent he believes this close presses him
OPEN_DEG = 70.0  # side-on: this far from square, inside 45-90
HALF_TURN_START_S = 0.4  # the body starts to turn this long before the ball reaches him


def _bearing(a: np.ndarray, b: np.ndarray) -> float:
    d = np.asarray(b, dtype=float) - np.asarray(a, dtype=float)
    return float(np.arctan2(d[1], d[0]))


def receiving_spot(
    spot: np.ndarray,
    me: np.ndarray,
    believed: np.ndarray,
    aim: np.ndarray | None = None,
    ball_from: np.ndarray | None = None,
) -> np.ndarray | None:
    """Rule 1: where he now wants to receive. Among the points within MAX_SHIFT_M of `spot` (the
    spot the pass was planned for), the one whose nearest opponent is furthest, counting the
    opponents he believes ((K, 2), his belief) are within NEAR_M of him at `me`; of equals, the
    one nearest `spot`. Once the ball is on its way (`aim`, where it was played, and `ball_from`,
    where from), only points on its line up to MAX_SHIFT_M from `aim` back toward the passer, so
    he still meets it: the drop-back. None when he believes nobody is near."""
    near = believed[np.linalg.norm(believed - me, axis=-1) <= NEAR_M]
    if not len(near):
        return None
    if aim is None or ball_from is None:
        k = np.arange(-MAX_SHIFT_M, MAX_SHIFT_M + 1e-9, GRID_M)
        grid = np.stack(np.meshgrid(k, k), axis=-1).reshape(-1, 2)
        grid = grid[np.linalg.norm(grid, axis=-1) <= MAX_SHIFT_M + 1e-9]
        points = spot + grid[np.argsort(np.linalg.norm(grid, axis=-1), kind="stable")]
    else:
        back = np.asarray(ball_from, dtype=float) - aim
        back /= max(float(np.linalg.norm(back)), 1e-9)
        points = aim + np.arange(0.0, MAX_SHIFT_M + 1e-9, GRID_M)[:, None] * back
    gap = np.linalg.norm(points[:, None, :] - near[None, :, :], axis=-1).min(axis=1)
    return points[int(np.argmax(gap))]


def half_turn_yaw(
    me: np.ndarray, ball_from: np.ndarray, believed: np.ndarray
) -> tuple[float, bool]:
    """Rule 2: (body yaw, side-on). Square faces where the ball comes from. Side-on when he
    believes an opponent ((K, 2)) within HALF_TURN_M: OPEN_DEG from square, turned away from the
    nearest of them."""
    square = _bearing(me, ball_from)
    d = np.linalg.norm(believed - me, axis=-1)
    if not len(d) or float(d.min()) > HALF_TURN_M:
        return square, False
    presser = believed[int(np.argmin(d))]
    side = 1.0 if float(wrap_angle(_bearing(me, presser) - square)) > 0 else -1.0
    return float(wrap_angle(square - side * np.deg2rad(OPEN_DEG))), True


class ProScan(Scenario):
    name = "pro_scan"
    hero = "H8"
    lens = "scan"
    intervention = "drop_scan"
    teaching = True
    tackles = True
    passer = "H4"
    runner = "H9"  # the striker he plays forward to
    defender = "A5"  # the central defender between them
    looks = LOOKS

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        ids = [p.id for p in players]
        pos = np.array([[x, y] for _, _, x, y in rows])
        pos += np.clip(gen.normal(0.0, 0.7, pos.shape), -1.5, 1.5)
        self.ids = ids
        self.i_hero, self.i_passer = ids.index(self.hero), ids.index(self.passer)
        self.i_defender = ids.index(self.defender)
        self.spot = pos[self.i_hero].copy()
        self.kick_frame = int(gen.integers(*KICK_FRAMES))
        ball = pos[self.i_passer] + np.array([DRIBBLE_OFFSET, 0.0])
        dist = float(np.linalg.norm(self.spot - ball))
        t_ball = flight_time(pass_speed(dist), dist - 1.0)
        self.reception_frame = self.kick_frame + round(t_ball / DT)
        self.look_frames = {
            label: self.reception_frame - round(s / DT) for label, _, s in LOOKS
        }  # fmt: skip
        self.step_out = self.reception_frame - round(gen.uniform(*STEP_OUT_S) / DT)
        self.drift = {
            ids.index(pid): (np.array(at) + gen.uniform(-DRIFT_JITTER, DRIFT_JITTER, 2), speed)
            for pid, (at, speed) in DRIFT.items()
        }
        self.holds = {self.i_defender: pos[self.i_defender].copy()}
        # His receiving spot (rule 1), from the last look he finished; the ball's start once played.
        self.target = self.spot.copy()
        self.aim: np.ndarray | None = None
        self.ball_from: np.ndarray | None = None
        self.looked = -1  # the start frame of the last look rule 1 acted on
        self.shifts: list[tuple[int, list[float]]] = []  # (frame, new spot): the export's beats
        self.turns: list[tuple[int, bool]] = []  # (frame, side-on) whenever rule 2 changes
        return Setup(players=players, pos=pos, ball_owner=self.i_passer)

    # --- the looks -------------------------------------------------------------------------

    def forced_scans(self, sim: Simulation, frame: int) -> dict[int, ForcedScan]:
        for label, direction, _ in LOOKS:
            if frame != self.look_frames[label]:
                continue
            i = self.i_hero
            angle = np.deg2rad(scan_direction_deg(int(direction)))
            base = _bearing(sim.pos[i], sim.ball_pos[:2])
            turn = scan_turn(float(sim.body_yaw[i]) + angle - base, sim.params)
            if turn is None:
                return {}
            return {i: ForcedScan(target_yaw=base + turn, dwell_s=sim.params.scan_dwell_s[0],
                                  key=label == KEY)}  # fmt: skip
        return {}

    def scan_suppressed(self, sim: Simulation, frame: int) -> np.ndarray:
        """His looks are exactly the scripted ones until he plays: no spontaneous or partial
        scan of his own."""
        mask = np.zeros(len(sim.ids), dtype=bool)
        mask[self.i_hero] = not sim.hero_acted
        return mask

    # --- rule 1: where he receives ---------------------------------------------------------

    def _believed_opponents(self, sim: Simulation, frame: int, ahead: int = 0) -> np.ndarray:
        """Where he believes the outfield opponents are, `ahead` frames from now: his belief
        extrapolated, at most the sim's belief horizon (SPEC 3.4)."""
        i = self.i_hero
        pos, _, _ = sim.beliefs.estimate(i, frame + ahead, DT, sim.params.belief_horizon_s)
        opp = [j for j, p in enumerate(sim.players) if p.team != sim.team[i] and p.role != "GK"]
        return pos[opp]

    def _update_spot(self, sim: Simulation, frame: int) -> None:
        """After each look, once his head has turned to where it looks, his receiving spot from
        what he now believes."""
        scan = sim.head.active[self.i_hero]
        if scan is None or scan.partial or scan.phase == "out" or scan.start <= self.looked:
            return
        self.looked = scan.start
        ahead = max(self.reception_frame - frame, 0)  # when he expects the ball
        believed = self._believed_opponents(sim, frame, ahead)
        new = receiving_spot(self.spot, sim.pos[self.i_hero], believed, self.aim, self.ball_from)
        if new is not None and float(np.linalg.norm(new - self.target)) > 1e-9:
            self.target = new
            self.shifts.append((frame, [float(new[0]), float(new[1])]))

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        if sim.hero_acted:
            return {}
        out: dict[int, tuple[np.ndarray, float]] = {}
        self._update_spot(sim, frame)
        if sim.owner != self.i_hero:
            moved = float(np.linalg.norm(self.target - self.spot)) > 1e-9
            out[self.i_hero] = (self.target, SHIFT_SPEED if moved else 3.0)
        d = self.i_defender
        if frame >= self.step_out:  # A5 steps out of the lane and closes to press
            out[d] = (sim.pos[self.i_hero] + np.array(PRESS_SIDE), sim.params.press_speed)
        else:
            out[d] = (self.holds[d], 2.0)
        for j, (at, speed) in self.drift.items():
            out[j] = (at, speed)
        return out

    def receiver_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        """While the ball comes he keeps to his own spot, on its line, instead of the engine's
        meeting point."""
        flight = sim.pass_in_flight
        if sim.hero_acted or flight is None or flight["intended"] != self.i_hero:
            return {}
        if self.ball_from is None:
            self.ball_from = np.asarray(flight["event"].attrs["start"], dtype=float)
            self.aim = np.asarray(flight["event"].attrs["target"], dtype=float)
        moved = float(np.linalg.norm(self.target - self.spot)) > 1e-9
        return {self.i_hero: (self.target, SHIFT_SPEED if moved else 3.0)}

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        if frame == self.kick_frame:
            aim = (float(self.target[0]), float(self.target[1]))  # his spot as the pass is played
            return ForcedPass(self.passer, self.hero, aim)
        return None

    # --- rule 2: the half-turn ---------------------------------------------------------------

    def body_targets(self, sim: Simulation, frame: int) -> dict[int, float]:
        """Back to goal, he faces the ball until rule 2 takes over: from when it is
        HALF_TURN_START_S from him until he plays it."""
        i = self.i_hero
        if sim.hero_acted:
            return {}
        flight = sim.pass_in_flight
        if sim.owner != i:
            to_him = flight is not None and flight["intended"] == i
            gap = float(np.linalg.norm(sim.ball_pos[:2] - sim.pos[i]))
            speed = float(np.linalg.norm(sim.ball_vel[:2]))
            if not to_him or self.ball_from is None or gap > HALF_TURN_START_S * max(speed, 1e-9):
                return {i: _bearing(sim.pos[i], sim.ball_pos[:2])}
        yaw, side_on = half_turn_yaw(sim.pos[i], self.ball_from,
                                     self._believed_opponents(sim, frame))  # fmt: skip
        if not self.turns or self.turns[-1][1] != side_on:
            self.turns.append((frame, side_on))
        return {i: yaw}

    def decides(self, sim: Simulation, player: int) -> bool:
        return player == self.i_hero and not sim.hero_acted


def look_ids(scenario: ProScan, labels: str = "LRBF") -> list[str]:
    """The scan ids his scripted looks get (`labels`, e.g. "LRF"), whether or not they start."""
    return [scan_id(scenario.hero, scenario.look_frames[label]) for label in labels]


def run_with_looks(seed: int, keep: str = "LRBF") -> tuple[MatchRun, ProScan]:
    """The run where he takes only the scripted looks in `keep` (the others dropped with
    `DropScan`, re-simulated from the first of them, SPEC 3.7), and its scenario's state: the
    receiving spots rule 1 chose (`shifts`) and when rule 2 turned him (`turns`)."""
    from sim.engine import Simulation
    from sim.overrides import DropScan

    sim = Simulation.from_scenario(ProScan.name, seed)
    drop = [label for label, _, _ in LOOKS if label not in keep]
    if drop:
        frames = sim.scenario.look_frames
        sim.run_until(min(frames[label] for label in drop))
        dropped = [DropScan(s) for s in look_ids(sim.scenario, "".join(drop))]
        sim = Simulation.resume(sim.snapshot(), dropped)
    run = sim.run()
    return run, sim.scenario


def body_angle(run: MatchRun, scenario: ProScan, frame: int) -> float:
    """Degrees between his body and square (facing where the pass came from), 0-180."""
    i = run.index(scenario.hero)
    if scenario.ball_from is None:
        raise ValueError("no pass to him in this run")
    square = _bearing(run.pos[frame, i], scenario.ball_from)
    return abs(float(np.rad2deg(wrap_angle(run.body_yaw[frame, i] - square))))
