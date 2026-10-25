"""Teaching scenario: back to goal, a look left, a look right, then the half-turn (SPEC 3.6,
"Teaching").

A coach's example, in the coach's order. The centre-back H4 plays into the central midfielder H8,
who stands near the centre circle with his back to the opponents' goal.
1. The start: he faces his own half, toward H4 on the ball: where the ball comes from. That is his
   view as the run starts (the sim's gaze follows the ball, SPEC 3.4), not a scan.
2. He looks LEFT, once. The holding midfielder A6 has drifted in behind his left shoulder while he
   could not see him; the look shows him closer than he thought. Rule 1 acts on that: he drops
   back from his spot toward the ball, so that he receives with space.
3. He looks RIGHT, once. The central defender A5 has stepped out of the back line to press him
   from behind his right shoulder; the look shows him closing. Rule 2 acts on that: he will
   receive on the half-turn, side-on, his body open away from A5.
4. He receives and decides: the decision model on his belief (SPEC 3.5), most often forward to
   the striker H9.
There is no look behind him toward goal and no forward look up the pitch: the striker and the
central defender come into his picture through these two looks and the half-turn, as the sim's
vision gives them.

The look TIMES are scripted for teaching (`LOOKS`, as `ForceScans` makes a look: a direction from
where his body faces, the scan's keyed peak speed, the median dwell; SPEC 3.7). What he sees,
believes and does follows the sim: vision and belief as everywhere (SPEC 3.4), his pass from the
decision model on his belief. Two small rules, scoped to this scenario, act on his belief, never
the truth, each once, RULE_DELAY_S after its look was scripted to start (by then the look is
over), whether or not he took it:
1. The drop-back (`receiving_spot`), after the left look. If he believes an opponent will be
   within NEAR_M of him when the ball arrives (his belief carried forward, at most the sim's
   one-second belief horizon), his receiving spot moves back along the line to the ball, up to
   MAX_SHIFT_M, to the point furthest from those opponents; he moves there at SHIFT_SPEED and the
   pass is played to it. Otherwise he stays on his spot.
2. The half-turn (`half_turn_side`), after the right look. If he believes an opponent will be
   within HALF_TURN_M of him when the ball arrives, he will receive side-on: from when the ball is
   HALF_TURN_START_S from him until he plays it, his body turns OPEN_DEG from facing the ball, away
   from that opponent, toward the forward lane on the other side. Otherwise he stays square.
Without a look the rule still acts at its time, on what he believes then: so a dropped look changes
the rule's outcome only through his belief.
The sim has no first touch or reception mechanics: the ball is at his feet as soon as he
controls it, 0.3 m along his body (`sim.engine.DRIBBLE_OFFSET`). So the half-turn changes his
body angle, and with it where the ball sits, where his eyes rest while he has it (his body's
direction, SPEC 3.4), what an opponent can win ball-first (tackles are on) and so the options he
weighs; not the touch.

Spontaneous scans of H8 are off until he plays, so his looks are exactly the scripted ones and
dropping one (`DropScan`) is the only difference between runs. The app's intervention is the one
every scan hero has, `drop_scan` of the key look (the right one); `eval/pro_scan.py` compares both
looks with none, the left only and the right only.

Per seed (keyed draws): positions jitter, when the pass is played, how fast A5 steps out, and
where A6 and A8 drift to while H8 cannot see them.
"""

from __future__ import annotations

from dataclasses import dataclass
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

# id, role, x, y: the home team attacks +x. H8 faces his own half, so his left is -y. A6 drifts in
# behind his left shoulder; A5 stands in the lane between H8 and the striker H9 and steps out to
# press him from behind his right shoulder.
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
    ("A6", "DM", 16.5, -12.5),
    ("A8", "DM", 19.0, 13.0),
    ("A10", "AM", 4.0, 12.0),
    ("A7", "AM", 6.0, -22.0),
    ("A11", "AM", 8.0, 24.0),
    ("A9", "ST", -1.0, 20.0),
]

# His looks, in this order: (label, direction from where his body faces in whole degrees, seconds
# before the planned reception). Left over his left shoulder, then right over his right shoulder.
# The right one, which shows the presser, is the key look.
LOOKS = (("L", "120", 3.2), ("R", "-120", 1.5))
KEY = "R"
RULE_DELAY_S = 0.8  # each rule acts this long after its look was scripted to start
STEP_OUT_S = (2.6, 2.8)  # A5 steps out this long before the planned reception
PRESS_SIDE = (1.0, 2.0)  # m: where A5 presses, beside H8 (behind his right shoulder)
# Unseen drift: spot, m/s. A6 comes in behind his left shoulder, A8 holds his right.
DRIFT = {"A6": ((14.5, -9.0), 3.0), "A8": ((17.0, 9.0), 2.0)}
DRIFT_JITTER = 1.0  # m
KICK_FRAMES = (76, 84)
# Rule 1, the drop-back.
NEAR_M = 7.0  # opponents he believes this close to him count
MAX_SHIFT_M = 3.0  # never further than this back from the spot the pass was meant for
DROP_CONE_DEG = 45.0  # back toward the ball: within this of the line from his spot to it
SHIFT_SPEED = 4.0  # m/s
GRID_M = 0.25
# Rule 2, the half-turn.
HALF_TURN_M = 6.0  # an opponent he believes this close presses him
OPEN_DEG = 70.0  # side-on: this far from square, inside 45-90
HALF_TURN_START_S = 0.4  # the body starts to turn this long before the ball reaches him


def _bearing(a: np.ndarray, b: np.ndarray) -> float:
    d = np.asarray(b, dtype=float) - np.asarray(a, dtype=float)
    return float(np.arctan2(d[1], d[0]))


def receiving_spot(
    spot: np.ndarray, me: np.ndarray, believed: np.ndarray, ball_from: np.ndarray
) -> np.ndarray | None:
    """Rule 1: where he now wants to receive. Among the points on the line from `spot` (where the
    pass was planned to) back toward the ball at `ball_from`, up to MAX_SHIFT_M, the one whose
    nearest opponent is furthest, counting the opponents he believes ((K, 2), his belief) will be
    within NEAR_M of him at `me`; of equals, the one nearest `spot`. None when he believes nobody
    is near."""
    near = believed[np.linalg.norm(believed - me, axis=-1) <= NEAR_M]
    if not len(near):
        return None
    k = np.arange(-MAX_SHIFT_M, MAX_SHIFT_M + 1e-9, GRID_M)
    grid = np.stack(np.meshgrid(k, k), axis=-1).reshape(-1, 2)
    grid = grid[np.argsort(np.linalg.norm(grid, axis=-1), kind="stable")]
    back = np.asarray(ball_from, dtype=float) - spot
    angle = np.abs(wrap_angle(np.arctan2(grid[:, 1], grid[:, 0]) - np.arctan2(back[1], back[0])))
    r = np.linalg.norm(grid, axis=-1)
    keep = (r <= MAX_SHIFT_M + 1e-9) & ((r < 1e-9) | (angle <= np.deg2rad(DROP_CONE_DEG) + 1e-9))
    points = spot + grid[keep]
    gap = np.linalg.norm(points[:, None, :] - near[None, :, :], axis=-1).min(axis=1)
    return points[int(np.argmax(gap))]


def half_turn_side(me: np.ndarray, ball_from: np.ndarray, believed: np.ndarray) -> int:
    """Rule 2: the side his body opens to, +1 counter-clockwise or -1 clockwise from square
    (facing `ball_from`), away from the nearest opponent he believes ((K, 2)) within HALF_TURN_M;
    0 (square) when he believes none is."""
    d = np.linalg.norm(believed - me, axis=-1)
    if not len(d) or float(d.min()) > HALF_TURN_M:
        return 0
    presser = believed[int(np.argmin(d))]
    square = _bearing(me, ball_from)
    return -1 if float(wrap_angle(_bearing(me, presser) - square)) > 0 else 1


def half_turn_yaw(me: np.ndarray, ball_from: np.ndarray, side: int) -> float:
    """His body yaw: square to `ball_from`, opened OPEN_DEG to `side` (0: square)."""
    return float(wrap_angle(_bearing(me, ball_from) + side * np.deg2rad(OPEN_DEG)))


@dataclass(frozen=True)
class RuleCall:
    """What a rule saw and did, for the export (not part of the run): the frame it acted, the
    opponents he believed would be within its radius when the ball arrived (id, believed
    position), the outfield opponent he believed would be nearest and how far, and its outcome:
    the new receiving spot (rule 1) or the side his body opens to (rule 2)."""

    rule: str  # "drop_back" or "half_turn"
    frame: int
    near: list[tuple[str, list[float]]]
    nearest: str
    nearest_m: float
    spot: list[float] | None = None  # rule 1: the new receiving spot; None: he stays
    side: int = 0  # rule 2: +1 / -1 opens his body, 0 square


class ProScan(Scenario):
    name = "pro_scan"
    hero = "H8"
    lens = "scan"
    intervention = "drop_scan"
    teaching = True
    tackles = True
    passer = "H4"
    runner = "H9"  # the striker he plays forward to
    defender = "A5"  # the central defender who steps out to press him
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
        delay = round(RULE_DELAY_S / DT)
        self.rule_frames = {"drop_back": self.look_frames["L"] + delay,
                            "half_turn": self.look_frames["R"] + delay}  # fmt: skip
        self.step_out = self.reception_frame - round(gen.uniform(*STEP_OUT_S) / DT)
        self.drift = {
            ids.index(pid): (np.array(at) + gen.uniform(-DRIFT_JITTER, DRIFT_JITTER, 2), speed)
            for pid, (at, speed) in DRIFT.items()
        }
        self.holds = {self.i_defender: pos[self.i_defender].copy()}
        # His receiving spot (rule 1); the side his body opens to (rule 2); the pass's start.
        self.target = self.spot.copy()
        self.side = 0
        self.ball_from: np.ndarray | None = None
        self.calls: dict[str, RuleCall] = {}  # what each rule saw and did: the export's beats
        self.turns: list[tuple[int, bool]] = []  # (frame, side-on) whenever his body turns
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

    # --- the two rules, on his belief ---------------------------------------------------------

    def _believed(self, sim: Simulation, frame: int) -> tuple[list[int], np.ndarray]:
        """The outfield opponents, and where he believes every player will be when he expects
        the ball (his belief carried forward, at most the sim's belief horizon, SPEC 3.4)."""
        i = self.i_hero
        ahead = max(self.reception_frame - frame, 0)
        pos, _, _ = sim.beliefs.estimate(i, frame + ahead, DT, sim.params.belief_horizon_s)
        opp = [j for j, p in enumerate(sim.players) if p.team != sim.team[i] and p.role != "GK"]
        return opp, pos

    def _call(self, sim: Simulation, rule: str, frame: int, radius: float, opp: list[int],
              believed: np.ndarray, **out) -> RuleCall:  # fmt: skip
        gaps = np.linalg.norm(believed[opp] - sim.pos[self.i_hero], axis=-1)
        k = int(np.argmin(gaps))
        near = [j for j, g in zip(opp, gaps, strict=True) if g <= radius]
        return RuleCall(rule=rule, frame=frame,
                        near=[(sim.ids[j], [float(believed[j, 0]), float(believed[j, 1])])
                              for j in near],
                        nearest=sim.ids[opp[k]], nearest_m=float(gaps[k]), **out)  # fmt: skip

    def _rules(self, sim: Simulation, frame: int) -> None:
        i = self.i_hero
        ball_from = self.ball_from if self.ball_from is not None else sim.ball_pos[:2].copy()
        if frame == self.rule_frames["drop_back"]:
            opp, believed = self._believed(sim, frame)
            new = receiving_spot(self.spot, sim.pos[i], believed[opp], ball_from)
            if new is not None:
                self.target = new
            spot = None if new is None else [float(new[0]), float(new[1])]
            self.calls["drop_back"] = self._call(sim, "drop_back", frame, NEAR_M, opp, believed,
                                                 spot=spot)  # fmt: skip
        if frame == self.rule_frames["half_turn"]:
            opp, believed = self._believed(sim, frame)
            self.side = half_turn_side(sim.pos[i], ball_from, believed[opp])
            self.calls["half_turn"] = self._call(sim, "half_turn", frame, HALF_TURN_M, opp,
                                                 believed, side=self.side)  # fmt: skip

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        if sim.hero_acted:
            return {}
        out: dict[int, tuple[np.ndarray, float]] = {}
        self._rules(sim, frame)
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
        moved = float(np.linalg.norm(self.target - self.spot)) > 1e-9
        return {self.i_hero: (self.target, SHIFT_SPEED if moved else 3.0)}

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        if frame == self.kick_frame:
            aim = (float(self.target[0]), float(self.target[1]))  # his spot as the pass is played
            return ForcedPass(self.passer, self.hero, aim)
        return None

    # --- the half-turn, as rule 2 decided ------------------------------------------------------

    def body_targets(self, sim: Simulation, frame: int) -> dict[int, float]:
        """Back to goal, he faces the ball until the half-turn: from when it is HALF_TURN_START_S
        from him until he plays it, his body opens to the side rule 2 chose (square if none)."""
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
        side_on = self.side != 0
        if not self.turns or self.turns[-1][1] != side_on:
            self.turns.append((frame, side_on))
        return {i: half_turn_yaw(sim.pos[i], self.ball_from, self.side)}

    def decides(self, sim: Simulation, player: int) -> bool:
        return player == self.i_hero and not sim.hero_acted


def look_ids(scenario: ProScan, labels: str = "LR") -> list[str]:
    """The scan ids his scripted looks get (`labels`, e.g. "LR"), whether or not they start."""
    return [scan_id(scenario.hero, scenario.look_frames[label]) for label in labels]


def run_with_looks(seed: int, keep: str = "LR") -> tuple[MatchRun, ProScan]:
    """The run where he takes only the scripted looks in `keep` (the others dropped with
    `DropScan`, re-simulated from the first of them, SPEC 3.7), and its scenario's state: what
    each rule saw and did (`calls`) and when his body turned (`turns`)."""
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
