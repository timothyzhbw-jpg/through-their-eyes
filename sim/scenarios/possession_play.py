"""Possession play (SPEC 3.4, 4.7): no hero moment, just passing, for evals that need volume.

Both teams in shape. The ball carrier keeps the ball for a short time (keyed draw) and plays it to
an open outfield teammate in range; the nearest opponent closes him down to a few metres, and
defenders step in on passes they can reach, so possession changes hands now and then. The other
defenders mark (SPEC 3.4, 3.8): each takes an attacker in his zone and stays goal-side of him, a
few metres off or, in some spells, tight. So a receiver under tight pressure has usually been
marked for a while, as in real play, instead of meeting a defender who arrived with the ball.
Nothing here depends on perception: no decisions, no forced or suppressed scans. Heads, scans and
head nuisance come from the normal engine. Hero runs last about 6 s, so run this one longer:

    Simulation.from_scenario("possession_play", seed, params=SimParams(max_duration_s=45.0))

The run ends early if the ball goes out of play (there are no restarts yet).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from sim import team_shape
from sim.ball import flight_time
from sim.config import DT, HALF_LENGTH, HALF_WIDTH
from sim.decision import pass_speed
from sim.scenarios.base import ForcedPass, Scenario, Setup, make_player

if TYPE_CHECKING:
    from sim.engine import Simulation

# id, role, x, y — 4-3-3 against 4-2-3-1, the home team attacks +x.
HOME = [
    ("H1", "GK", -45.0, 0.0),
    ("H2", "FB", -18.0, -24.0),
    ("H3", "FB", -18.0, 24.0),
    ("H4", "CB", -30.0, -8.0),
    ("H5", "CB", -30.0, 8.0),
    ("H6", "DM", -16.0, 0.0),
    ("H8", "CM", -5.0, -12.0),
    ("H10", "CM", -5.0, 12.0),
    ("H7", "W", 8.0, -26.0),
    ("H11", "W", 8.0, 26.0),
    ("H9", "ST", 12.0, 0.0),
]
AWAY = [
    ("A1", "GK", 45.0, 0.0),
    ("A2", "FB", 20.0, 22.0),
    ("A3", "FB", 20.0, -22.0),
    ("A4", "CB", 22.0, 7.0),
    ("A5", "CB", 22.0, -7.0),
    ("A6", "DM", 8.0, 6.0),
    ("A8", "DM", 8.0, -6.0),
    ("A10", "AM", -3.0, 0.0),
    ("A7", "AM", -1.0, 18.0),
    ("A11", "AM", -1.0, -18.0),
    ("A9", "ST", -14.0, 0.0),
]

# Each player's slot in his team's formation (`sim.team_shape`): right and left as the team faces
# the goal it attacks, so the away team's right-hand side is +y.
SLOTS = {
    "H1": "GK", "H2": "RB", "H3": "LB", "H4": "RCB", "H5": "LCB", "H6": "DM", "H8": "RCM",
    "H10": "LCM", "H7": "RW", "H11": "LW", "H9": "ST",
    "A1": "GK", "A2": "RB", "A3": "LB", "A4": "RCB", "A5": "LCB", "A6": "RDM", "A8": "LDM",
    "A10": "CAM", "A7": "RAM", "A11": "LAM", "A9": "ST",
}  # fmt: skip

HOLD_S = (0.6, 1.6)  # time on the ball before passing
PASS_RANGE = (8.0, 35.0)  # m
OPEN_ENOUGH = 8.0  # m to the nearest opponent; more space than this does not make a better pass
PRESS_DISTANCE = 3.0  # m, the closest opponent stops this far from the carrier
# Marking. A defender keeps his attacker until the attacker leaves his zone (RELEASE_RADIUS
# around the defender's formation spot) or the other team wins the ball. Unmarked attackers are
# picked up nearest first, within ZONE_RADIUS; a defender with nobody in his zone holds his spot.
# The one pressing the carrier keeps his attacker and returns to him after the pass. Each
# defender draws one gap per spell (keyed draws), so a tight pair stays tight for the spell.
# Style knobs, not fitted; no cited paper prints marking distances.
ZONE_RADIUS = 15.0  # m
RELEASE_RADIUS = 20.0  # m, more than ZONE_RADIUS so a pair does not flicker at the edge
MARK_SPELL_S = 10.0  # each defender's spells start at his own keyed phase
TIGHT_SHARE = 0.5  # share of spells marked tightly
TIGHT_GAP = (1.0, 2.0)  # m, goal-side of the attacker
LOOSE_GAP = (3.0, 6.0)  # m
# With a team shape (`team_shape`) marking is zonal, so the block keeps its shape: a defender picks
# up an attacker within SHAPE_ZONE_RADIUS of his slot and follows him goal-side while that keeps
# him within SHAPE_LEASH of it; beyond, he lets him go to the next zone and returns to his slot.
# Style knobs, not fitted.
SHAPE_ZONE_RADIUS = 12.0  # m
SHAPE_LEASH = 15.0  # m
# With a team shape the ball is played ahead of a moving receiver, by at most this long of his run,
# and at least a metre inside the lines.
LEAD_MAX_S = 2.0
LEAD_INSIDE = np.array([HALF_LENGTH - 1.0, HALF_WIDTH - 1.0])


class PossessionPlay(Scenario):
    name = "possession_play"
    hero = None
    # Both teams keep a formation-based shape (SPEC 3.2): 4-3-3 at home, 4-2-3-1 away.
    team_shape = True
    formation = ("4-3-3", "4-2-3-1")
    slots = SLOTS

    def setup(self, gen: np.random.Generator) -> Setup:
        rows = HOME + AWAY
        players = [make_player(pid, role) for pid, role, _, _ in rows]
        pos = np.array([[x, y] for _, _, x, y in rows])
        noise = np.clip(gen.normal(0.0, 1.5, pos.shape), -3.0, 3.0)
        self.holder, self.release, self.last_passer = -1, 0, -1
        self.marking_team, self.marks = -1, {}  # attacking team, defender -> attacker
        self.phases: dict[int, int] = {}  # defender -> frames into his first spell
        self.gaps: dict[tuple[int, int], float] = {}  # (defender, spell start) -> marking gap
        owner = [p.id for p in players].index(str(gen.choice(["H4", "H5", "H6"])))
        if not self.team_shape:
            return Setup(players=players, pos=pos + noise, ball_owner=owner)
        pos = self.lined_up(players, owner, pos[owner]) + noise
        for i, p in enumerate(players):  # the keepers start inside their areas
            if p.role == "GK":
                pos[i] = team_shape.in_penalty_area(pos[i], 1 if p.team == 0 else -1)
        return Setup(players=players, pos=pos, ball_owner=owner)

    def lined_up(self, players: list, owner: int, ball: np.ndarray) -> np.ndarray:
        """Every player on his slot, the home team on the ball and its carrier on his own slot."""
        team = np.array([p.team for p in players])
        names = [self.slots[p.id] for p in players]
        form = team_shape.Formation.from_names(team, self.formation, names)
        for _ in range(3):  # the carrier's slot moves with the ball he carries
            pos = team_shape.spots(form, ball, possession=0)
            ball = pos[owner]
        return pos

    def forced_pass(self, sim: Simulation, frame: int) -> ForcedPass | None:
        i = sim.owner
        if i != self.holder:
            if self.holder >= 0 and i < 0:
                self.last_passer = self.holder
            self.holder = i
            if i >= 0:
                u = sim.rng.uniform_for("possession_hold", frame, sim.ids[i])
                self.release = frame + round((HOLD_S[0] + (HOLD_S[1] - HOLD_S[0]) * u) / DT)
        if i < 0 or frame < self.release:
            return None
        mates = np.flatnonzero((sim.team == sim.team[i]) & (np.arange(len(sim.ids)) != i))
        opponents = np.flatnonzero(sim.team != sim.team[i])
        dist = np.linalg.norm(sim.pos[mates] - sim.pos[i], axis=-1)
        # Space to receive: the nearest opponent who is not beyond the receiver along the pass. A
        # marker goal-side of him cannot reach a ball played to his feet first.
        line = sim.pos[mates] - sim.pos[i]
        along = np.einsum("od,md->mo", sim.pos[opponents] - sim.pos[i], line)
        along /= np.maximum(np.sum(line**2, axis=-1), 1e-9)[:, None]
        gap = np.linalg.norm(sim.pos[mates][:, None, :] - sim.pos[opponents][None, :, :], axis=-1)
        space = np.where(along > 1.0, np.inf, gap).min(axis=1)
        jitter = sim.rng.uniform("possession_pass", frame, len(mates))
        score = np.minimum(space, OPEN_ENOUGH) * (0.5 + jitter)
        keeper = np.array([sim.players[j].role == "GK" for j in mates])
        out_of_range = (dist < PASS_RANGE[0]) | (dist > PASS_RANGE[1])
        score[out_of_range | keeper | (mates == self.last_passer)] = -1.0
        to = mates[int(np.argmax(score))] if score.max() > 0 else mates[int(np.argmin(dist))]
        if not self.team_shape:
            return ForcedPass(sim.ids[i], sim.ids[to])
        return ForcedPass(sim.ids[i], sim.ids[to], target=tuple(self.lead(sim, i, to)))

    def lead(self, sim: Simulation, i: int, to: int) -> np.ndarray:
        """Where to play the ball to a team-mate on the move: where his run takes him by the
        time it gets there (two passes of the estimate), kept on the pitch. With a team shape
        players move between slots as the ball moves; a pass to where he stood went behind him."""
        ball = sim.ball_pos[:2]
        target = sim.pos[to].copy()
        for _ in range(2):
            d = float(np.linalg.norm(target - ball))
            t = min(flight_time(pass_speed(d, sim.decision_params, sim.ball_params), d,
                                sim.ball_params), LEAD_MAX_S)  # fmt: skip
            target = sim.pos[to] + sim.vel[to] * t
        return np.clip(target, -LEAD_INSIDE, LEAD_INSIDE)

    def scripted_targets(self, sim: Simulation, frame: int) -> dict[int, tuple[np.ndarray, float]]:
        i = sim.owner
        if i >= 0:
            attacking = int(sim.team[i])
        elif sim.pass_in_flight is not None:
            attacking = int(sim.team[sim.pass_in_flight["passer"]])
        elif sim.last_kicker >= 0:
            attacking = int(sim.team[sim.last_kicker])
        else:
            return {}
        targets, presser = {}, -1
        if i >= 0:
            opponents = np.flatnonzero(sim.team != sim.team[i])
            if self.team_shape:  # the keeper keeps to his area
                opponents = np.array([j for j in opponents if sim.players[j].role != "GK"])
            presser = opponents[np.argmin(np.linalg.norm(sim.pos[opponents] - sim.pos[i], axis=-1))]
            away = sim.pos[presser] - sim.pos[i]
            dist = float(np.linalg.norm(away))
            if dist < 1e-6:
                away, dist = np.array([1.0 if sim.team[presser] == 1 else -1.0, 0.0]), 1.0
            targets[presser] = (sim.pos[i] + PRESS_DISTANCE * away / dist, sim.params.press_speed)
        self.update_marks(sim, frame, attacking, presser)
        for j, a in self.marks.items():
            if j == presser or a == i:
                continue
            targets[j] = (self.mark_point(sim, frame, j, a), sim.v_max[j])
        return targets

    def mark_point(self, sim: Simulation, frame: int, j: int, a: int) -> np.ndarray:
        """Where defender j marks attacker a: goal-side of him at j's gap for this spell."""
        own_goal = np.array([HALF_LENGTH if sim.team[j] == 1 else -HALF_LENGTH, 0.0])
        goal_side = own_goal - sim.pos[a]
        goal_side /= max(float(np.linalg.norm(goal_side)), 1e-6)
        return sim.pos[a] + self.gap(sim, frame, j) * goal_side

    def update_marks(self, sim: Simulation, frame: int, attacking: int, presser: int) -> None:
        """Keep the pairs still in their zone, then pair free defenders and attackers."""
        if attacking != self.marking_team:
            self.marking_team, self.marks = attacking, {}
        spots = sim.formation_spots()
        if self.team_shape:
            zone = SHAPE_ZONE_RADIUS

            def keeps(j: int, a: int) -> bool:
                return bool(np.linalg.norm(self.mark_point(sim, frame, j, a) - spots[j])
                            <= SHAPE_LEASH)  # fmt: skip
        else:
            zone = ZONE_RADIUS

            def keeps(j: int, a: int) -> bool:
                return bool(np.linalg.norm(sim.pos[a] - spots[j]) <= RELEASE_RADIUS)

        self.marks = {j: a for j, a in self.marks.items() if keeps(j, a)}
        outfield = np.array([p.role != "GK" for p in sim.players])
        busy = {*self.marks, presser}
        taken = {*self.marks.values(), sim.owner}
        defenders = [j for j in np.flatnonzero(outfield & (sim.team != attacking)) if j not in busy]
        attackers = [
            a for a in np.flatnonzero(outfield & (sim.team == attacking)) if a not in taken
        ]
        if not defenders or not attackers:
            return
        dist = np.linalg.norm(spots[defenders][:, None, :] - sim.pos[attackers][None], axis=-1)
        for flat in np.argsort(dist, axis=None, kind="stable"):
            d, a = divmod(int(flat), len(attackers))
            if dist[d, a] > zone:
                break
            if defenders[d] in self.marks or attackers[a] in self.marks.values():
                continue
            if self.team_shape and not keeps(int(defenders[d]), int(attackers[a])):
                continue
            self.marks[int(defenders[d])] = int(attackers[a])

    def gap(self, sim: Simulation, frame: int, j: int) -> float:
        """Defender j's marking gap in the spell that contains `frame` (keyed draws, SPEC 3.7)."""
        pid, spell = sim.ids[j], round(MARK_SPELL_S / DT)
        if j not in self.phases:
            self.phases[j] = round(sim.rng.uniform_for("marking_phase", 0, pid) * spell)
        phase = self.phases[j]
        start = (frame + phase) // spell * spell - phase
        if (j, start) not in self.gaps:
            tight = sim.rng.uniform_for("marking_tight", start, pid) < TIGHT_SHARE
            lo, hi = TIGHT_GAP if tight else LOOSE_GAP
            self.gaps[(j, start)] = lo + (hi - lo) * sim.rng.uniform_for("marking_gap", start, pid)
        return self.gaps[(j, start)]
