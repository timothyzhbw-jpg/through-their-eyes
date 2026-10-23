"""Goalkeeper positioning (SPEC 3.2): where a keeper stands when no script moves him.

**Angle.** On the bisector of the angle the ball makes with his two posts: the spot that leaves
equal room inside each post (the angle-play model of goalkeeping geometry; docs/REFERENCES.md,
"Goalkeepers").

**Depth off his goal line** follows his defensive line, by two published anchors from FIFA's
optical tracking of open play (docs/REFERENCES.md):
- GAP_TO_LINE: at the 2022 World Cup keepers stood on average 20.4 m behind their defensive line
  and 13.1 m off their goal line;
- DEPTH_FLOOR: at the 2021 Club World Cup one keeper with the highest line of the teams compared
  (17.4 m from goal on average) averaged 4.8 m off his goal line.
Holding the gap to the line down to the floor is our model, a style knob: no source prints the
keeper's depth against the line's or the ball's. It reproduces both anchors: a line 33.5 m out
puts him 13.1 m off his line, a 17.4 m line puts him on the 4.8 m floor.

**Limits.** Inside his penalty area, KEEPER_INSIDE from its edges (he may handle only there, IFAB
Laws of the Game, Law 12.1), and never further out than the ball.

The defensive line here is his team's deepest outfield player (with a team shape, the shape's
back line, `sim.team_shape`). A keeper leaves this spot for a pass only to claim it inside his
own area (`claims_in_area`), so he no longer chases a ball across the pitch.
"""

from __future__ import annotations

import numpy as np

from sim import laws

GAP_TO_LINE = 20.4  # m, keeper to defensive line, World Cup 2022 open play (FIFA)
DEPTH_FLOOR = 4.8  # m off the goal line, one keeper behind a 17.4 m line (FIFA, CWC 2021)
KEEPER_INSIDE = 1.0  # m, his spot stays this far inside his penalty area's edges
BALL_GAP = 1.0  # m, he stays at least this much nearer his goal line than the ball


def defensive_line(pos: np.ndarray, team: np.ndarray, roles: list[str], t: int) -> float:
    """Depth (m from his own goal line) of team `t`'s deepest outfield player; the pitch's length
    when he has no outfield team-mates (a test set-up), so nothing holds him back."""
    team = np.asarray(team)
    outfield = (team == t) & np.array([r != "GK" for r in roles])
    if not outfield.any():
        return laws.PITCH_LENGTH
    own = -laws.attack_sign(t) * laws.HALF_LENGTH  # x of the goal line team t defends
    return float(np.min(laws.attack_sign(t) * (np.asarray(pos)[outfield, 0] - own)))


def keeper_spot(ball: np.ndarray, defensive_line: float, sign: float) -> np.ndarray:
    """His spot for the ball at `ball`, his team attacking `sign` (+1 home), its defensive line
    `defensive_line` m out from his goal line."""
    ball = np.asarray(ball, dtype=float)[:2]
    goal_x = -sign * laws.HALF_LENGTH
    ball_depth = sign * (ball[0] - goal_x)
    depth = float(np.clip(defensive_line - GAP_TO_LINE, DEPTH_FLOOR,
                          laws.PENALTY_AREA_DEPTH - KEEPER_INSIDE))  # fmt: skip
    depth = min(depth, max(ball_depth - BALL_GAP, KEEPER_INSIDE / 2.0))
    x = goal_x + sign * depth
    # The bisector from the ball: the sum of the unit vectors to the two posts.
    posts = np.array([[goal_x, laws.GOAL_HALF_WIDTH], [goal_x, -laws.GOAL_HALF_WIDTH]])
    u = posts - ball
    u /= np.maximum(np.linalg.norm(u, axis=1, keepdims=True), 1e-9)
    w = u.sum(axis=0)
    if abs(w[0]) < 1e-9:  # the ball on his goal line: stand in front of the near post
        y = float(np.clip(ball[1], -laws.GOAL_HALF_WIDTH, laws.GOAL_HALF_WIDTH))
    else:
        y = float(ball[1] + (x - ball[0]) / w[0] * w[1])
    edge = laws.PENALTY_AREA_HALF_WIDTH - KEEPER_INSIDE
    return np.array([x, float(np.clip(y, -edge, edge))])


def claims_in_area(point: np.ndarray, team: int) -> bool:
    """Whether a keeper of `team` may go for a ball at `point`: only inside his own area."""
    return bool(laws.in_penalty_area(np.asarray(point, dtype=float)[:2], team))
