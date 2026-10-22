"""Team shape (SPEC 3.2): each player's formation slot, placed relative to his team's block.

Behind `Scenario.team_shape`; with it off the engine keeps its anchors shifted with the ball.

A formation is a set of slots in the team's own frame: `depth` from the back line (0) to the front
line (1), `lateral` from the right touchline side (-1) to the left (+1), as the team faces the goal
it attacks. The block is where those slots land on the pitch, per team and frame:

- **Phase.** The team with the ball (its carrier, the passer of a ball in flight, else the last
  kicker) is in its attacking shape, the other in its defending shape. The phase switches on the
  frame possession changes; the players then move there under the engine's speed and acceleration
  limits, so a transition is the movement between the two shapes, not a third template.
- **Back line.** The back line's depth (metres from the team's own goal line) stays `gap` metres
  goal-side of the ball, within `[line_min, line_max]`: the line steps up as the ball goes
  forward and drops as it comes back, every defender on the same depth.
- **Length.** The front line is `length` metres ahead of the back line, but never beyond the
  opponents' back line (where an offside line would be) unless the ball is beyond it.
- **Width and side.** The slots span `width` metres across, centred `shift` × the ball's y, and
  kept `margin` metres inside the touchlines.
- **Roles.** In possession the full-backs push on to `fullback_push` (slot depth). Out of it the
  wide player on the side away from the ball tucks in to `far_tuck` of his lateral slot. The
  keeper is not in the block: he stands on the line from his goal's centre to the ball, at
  `keeper_share` of the back line's depth, inside his penalty area.

Movement targets only: the engine steers to them with its usual limits and clamps them to the
pitch, and scenario scripts (marking, pressing, a receiver's run) still override them.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from sim.config import HALF_LENGTH, HALF_WIDTH

PITCH_LENGTH = 2.0 * HALF_LENGTH
# Laws of the Game: the penalty area reaches 16.5 m from the goal line and 16.5 m beside each
# post of the 7.32 m goal, 40.32 m across.
PENALTY_DEPTH = 16.5
PENALTY_HALF_WIDTH = 20.16
KEEPER_INSIDE = 1.0  # m, the keeper's target stays this far inside his penalty area's edges
MIN_LENGTH = 10.0  # m, the block never collapses below this between two back lines


@dataclass(frozen=True)
class Slot:
    depth: float  # 0 the back line ... 1 the front line, in possession
    lateral: float  # -1 his right-hand side ... +1 his left, as the team faces its attack
    line: str  # keeper | defence | midfield | attack
    fullback: bool = False
    wide: bool = False  # a wide forward or wide midfielder, who tucks in on the far side
    depth_out: float | None = None  # out of possession, if he drops or steps up; else `depth`

    @property
    def defending_depth(self) -> float:
        return self.depth if self.depth_out is None else self.depth_out


def _slot(depth: float, lateral: float, line: str, depth_out: float | None = None,
          **kw: bool) -> Slot:  # fmt: skip
    return Slot(depth, lateral, line, depth_out=depth_out, **kw)


KEEPER = Slot(0.0, 0.0, "keeper")
BACK_FOUR = {
    "RB": _slot(0.0, -1.0, "defence", fullback=True),
    "RCB": _slot(0.0, -0.33, "defence"),
    "LCB": _slot(0.0, 0.33, "defence"),
    "LB": _slot(0.0, 1.0, "defence", fullback=True),
}
# In possession a 4-3-3 and a 4-2-3-1; out of it the wide players drop into the midfield line, a
# 4-1-4-1 and a 4-4-1-1. Shaw & Glickman measure formations with and without the ball apart: their
# 4-1-4-1 and 4-4-2 clusters are 94% out of possession (docs/REFERENCES.md, "Team shape"). The
# depths and laterals are ours.
FORMATIONS: dict[str, dict[str, Slot]] = {
    "4-3-3": {
        "GK": KEEPER,
        **BACK_FOUR,
        "DM": _slot(0.3, 0.0, "midfield", 0.25),
        "RCM": _slot(0.55, -0.45, "midfield", 0.5),
        "LCM": _slot(0.55, 0.45, "midfield", 0.5),
        "RW": _slot(0.9, -1.0, "attack", 0.5, wide=True),
        "LW": _slot(0.9, 1.0, "attack", 0.5, wide=True),
        "ST": _slot(1.0, 0.0, "attack"),
    },
    "4-2-3-1": {
        "GK": KEEPER,
        **BACK_FOUR,
        "RDM": _slot(0.3, -0.3, "midfield"),
        "LDM": _slot(0.3, 0.3, "midfield"),
        "RAM": _slot(0.65, -0.85, "midfield", 0.35, wide=True),
        "CAM": _slot(0.7, 0.0, "midfield", 0.75),
        "LAM": _slot(0.65, 0.85, "midfield", 0.35, wide=True),
        "ST": _slot(1.0, 0.0, "attack"),
    },
}


@dataclass(frozen=True)
class PhaseShape:
    length: float  # m, back line to front line
    width: float  # m, across the slots at lateral -1 and +1
    gap: float  # m the back line stays goal-side of the ball
    line_min: float  # m from the own goal line: the deepest the back line goes
    line_max: float  # m from the own goal line: the highest
    shift: float  # block centre's y as a share of the ball's y


# Fitted by hand on possession_play tuning seeds 0-39 so that the measured shape (eval/realism.py,
# team shape) lands on the published means: length, width and the deepest player's height in and
# out of possession (Castellano et al. 2013, Table 1 and Results), and out of possession the
# length, width and inter-line distances of settled defence (Forcher et al. 2024, Table 7.1). The
# templates are larger than what is measured: pressing, marking and runs pull players off their
# slots, and the offside cap shortens the block. The realism report checks held-out seeds.
@dataclass(frozen=True)
class ShapeParams:
    attack: PhaseShape = PhaseShape(
        length=46.0, width=41.5, gap=16.0, line_min=22.0, line_max=50.0, shift=0.3
    )
    defence: PhaseShape = PhaseShape(
        length=31.0, width=34.5, gap=15.0, line_min=12.0, line_max=37.0, shift=0.5
    )
    # A player making for his slot jogs when he is near it and runs harder the further out of
    # position he is, at full speed from `sprint_distance` (style knobs). The jog is below the
    # 19.8 km/h (5.5 m/s) entry speed of high-speed running most studies use (Gualtieri et al.
    # 2023, docs/REFERENCES.md). Pressing, marking and runs to the ball keep their own speeds.
    slot_speed: float = 3.0  # m/s
    sprint_distance: float = 25.0  # m
    # The block follows the ball smoothed over this time constant, not the ball itself: a pass
    # moves the ball at 10-20 m/s, and a block that followed it would sprint (a style knob).
    ball_follow_s: float = 1.0
    fullback_push: float = 0.5  # slot depth of the full-backs in possession
    far_tuck: float = 0.4  # far-side wide player's share of his lateral slot out of possession
    keeper_share: float = 0.4  # keeper's depth as a share of the back line's
    margin: float = 2.0  # m, the block's outer slots stay this far inside the touchlines


SHAPE = ShapeParams()


@dataclass(frozen=True)
class Formation:
    """Slots for every player of a match-up, in player order, and each team's attack sign."""

    slots: tuple[Slot, ...]
    team: np.ndarray  # (N,) 0 home, 1 away
    attack_sign: tuple[int, int] = (1, -1)  # the home team attacks +x

    @classmethod
    def from_names(
        cls, team: np.ndarray, formation: tuple[str, str], names: list[str]
    ) -> Formation:
        """Player i plays slot `names[i]` of his team's formation."""
        return cls(
            tuple(FORMATIONS[formation[int(t)]][n] for t, n in zip(team, names, strict=True)),
            np.asarray(team),
        )

    def array(self, field: str) -> np.ndarray:
        return np.array([getattr(s, field) for s in self.slots])


def spots(
    form: Formation,
    ball: np.ndarray,
    possession: int,
    params: ShapeParams | None = None,
) -> np.ndarray:
    """(N, 2) slot positions for the ball at `ball` with team `possession` on it."""
    params = SHAPE if params is None else params
    lateral, line = form.array("lateral"), form.array("line")
    depth_in, depth_out = form.array("depth"), form.array("defending_depth")
    fullback, wide = form.array("fullback"), form.array("wide")
    out = np.zeros((len(form.slots), 2))
    signs = np.array(form.attack_sign, dtype=float)
    ball_depth = HALF_LENGTH + signs * ball[0]  # per team, from its own goal line
    shapes = [params.attack if t == possession else params.defence for t in (0, 1)]
    back = np.array([
        np.clip(ball_depth[t] - s.gap, s.line_min, s.line_max) for t, s in enumerate(shapes)
    ])  # fmt: skip
    for t, s in enumerate(shapes):
        sign, mine = signs[t], form.team == t
        # The opponents' back line, in this team's depth: no slot beyond it unless the ball is.
        offside = max(PITCH_LENGTH - back[1 - t], ball_depth[t])
        length = max(min(s.length, offside - back[t]), MIN_LENGTH)
        room = max(HALF_WIDTH - s.width / 2.0 - params.margin, 0.0)
        centre = float(np.clip(s.shift * ball[1], -room, room))
        v = lateral.copy()
        if t == possession:
            u = np.where(fullback, params.fullback_push, depth_in)
        else:
            u = depth_out
            # The far side is away from the ball across the block's centre line, in world y.
            far = sign * v * (ball[1] - centre) < 0.0
            v = np.where(wide & far, v * params.far_tuck, v)
        depth = back[t] + u * length
        y = centre + sign * v * s.width / 2.0
        out[mine, 0] = sign * (depth[mine] - HALF_LENGTH)
        out[mine, 1] = y[mine]
        keeper = mine & (line == "keeper")
        if keeper.any():
            out[keeper] = keeper_spot(ball, back[t], sign, params)
    return out


def slot_speed(distance: np.ndarray, v_max: np.ndarray, params: ShapeParams | None = None):
    """Speed cap toward the slot `distance` metres away: `slot_speed` near it, up to `v_max` at
    `sprint_distance` and beyond."""
    params = SHAPE if params is None else params
    share = np.clip(distance / params.sprint_distance, 0.0, 1.0)
    return np.minimum(params.slot_speed + (v_max - params.slot_speed) * share, v_max)


def keeper_spot(ball: np.ndarray, back_line: float, sign: float, params: ShapeParams = SHAPE):
    """On the line from his goal's centre to the ball, `keeper_share` of the back line's depth
    out, inside his penalty area."""
    goal_x = -sign * HALF_LENGTH
    ball_depth = sign * (ball[0] - goal_x)
    depth = float(np.clip(params.keeper_share * back_line, KEEPER_INSIDE,
                          PENALTY_DEPTH - KEEPER_INSIDE))  # fmt: skip
    depth = min(depth, max(ball_depth, KEEPER_INSIDE))
    y = ball[1] * depth / max(ball_depth, depth)
    y = float(np.clip(y, -(PENALTY_HALF_WIDTH - KEEPER_INSIDE), PENALTY_HALF_WIDTH - KEEPER_INSIDE))
    return np.array([goal_x + sign * depth, y])


def in_penalty_area(point: np.ndarray, sign: float) -> np.ndarray:
    """`point` moved inside the penalty area of the team attacking `sign` (KEEPER_INSIDE in)."""
    goal_x = -sign * HALF_LENGTH
    depth = np.clip(sign * (point[0] - goal_x), 0.0, PENALTY_DEPTH - KEEPER_INSIDE)
    y = np.clip(point[1], -(PENALTY_HALF_WIDTH - KEEPER_INSIDE), PENALTY_HALF_WIDTH - KEEPER_INSIDE)
    return np.array([goal_x + sign * depth, y])
