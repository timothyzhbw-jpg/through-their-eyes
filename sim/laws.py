"""The Laws of the Game as hard rules for the sim (SPEC 3.9).

Constants and pure checks over one frame or one event, cited by law and section as "IFAB Laws of
the Game, Law 11.1". The source is the 2026/27 edition on theifab.com (www.theifab.com/laws/latest,
read law by law on 2026-10-22; docs/REFERENCES.md). The rules are restated in our own words: no
text, diagram or figure of the Laws is reproduced here. Dimensions are facts and are given as
numbers.

Nothing here imports the engine: every check takes plain arrays, so the referee inside the sim
(`sim.engine`), the audit (`eval/laws.py`) and the tests judge with the same code.

Conventions (SPEC 3.1): metres, the origin on the centre mark, x along the touchlines. The home
team (0) attacks +x and the away team (1) attacks -x; a stitched match has no second half, so the
ends never change. A team's "depth" of a point is how far it lies toward the goal that team
attacks: `attack_sign(team) * x`.

**Body model.** The sim's players are points: the tracked position, the centre of the body on the
ground. For offside the Laws count the head, body and feet, never the hands or arms (up to the
bottom of the armpit; Law 11.1), and compare the attacker's part nearest the goal line with the
second-last opponent's. We give every player the same body, so its depth cancels between
attacker and defender: the comparison is point against point. The ball is compared by its
centre. "Level" (onside) is within `LEVEL_TOLERANCE`, the 1 mm resolution positions are written
at (SPEC 3.7).

**Lines.** HALF_LENGTH and HALF_WIDTH are the outer edges of the goal lines and touchlines. The
lines belong to the areas they bound (Law 1.2), so the field of play ends there, and a player or
ball on a line is inside the area that line bounds.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# --- Law 1, the field of play -------------------------------------------------------------------
# Inside the ranges Law 1.4 allows for international matches (100-110 m by 64-75 m).
PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0
HALF_LENGTH = PITCH_LENGTH / 2.0  # outer edge of each goal line
HALF_WIDTH = PITCH_WIDTH / 2.0  # outer edge of each touchline
LINE_WIDTH = 0.12  # m, at most 12 cm, every line the same (1.2); goal lines as wide as the posts
GOAL_WIDTH = 7.32  # m, between the inner edges of the posts (1.10)
GOAL_HALF_WIDTH = GOAL_WIDTH / 2.0
GOAL_HEIGHT = 2.44  # m, from the ground to the lower edge of the crossbar (1.10)
POST_WIDTH = LINE_WIDTH  # m, depth and width of the posts and the crossbar, at most 12 cm (1.10)
# Round posts (Law 1.10 allows square, rectangular, round, elliptical or hybrid ones) on the goal
# line, their backs on its outer edge and their inner edges GOAL_WIDTH apart: centres at
# (±POST_X, ±POST_Y).
POST_RADIUS = POST_WIDTH / 2.0
POST_X = HALF_LENGTH - POST_RADIUS
POST_Y = GOAL_HALF_WIDTH + POST_RADIUS
POSTS = np.array([[sx * POST_X, sy * POST_Y] for sx in (1, -1) for sy in (1, -1)])
GOAL_AREA_DEPTH = 5.5  # m into the field, and 5.5 m out from the inside of each post (1.5)
GOAL_AREA_HALF_WIDTH = GOAL_HALF_WIDTH + GOAL_AREA_DEPTH  # 9.16 m
PENALTY_AREA_DEPTH = 16.5  # m into the field, and 16.5 m out from the inside of each post (1.6)
PENALTY_AREA_HALF_WIDTH = GOAL_HALF_WIDTH + PENALTY_AREA_DEPTH  # 20.16 m
PENALTY_MARK_DISTANCE = 11.0  # m from the midpoint between the posts (1.6)
CENTRE_CIRCLE_RADIUS = 9.15  # m, around the centre mark (1.2)
PENALTY_ARC_RADIUS = 9.15  # m, around each penalty mark, drawn outside the penalty area (1.6)
CORNER_ARC_RADIUS = 1.0  # m, a quarter circle from each corner flagpost, inside the field (1.7)

# --- Law 2, the ball ----------------------------------------------------------------------------
BALL_CIRCUMFERENCE = (0.68, 0.70)  # m, Law 2.1
BALL_RADIUS_RANGE = (BALL_CIRCUMFERENCE[0] / (2 * math.pi), BALL_CIRCUMFERENCE[1] / (2 * math.pi))
BALL_RADIUS = 0.11  # m, the sim's ball (`sim.ball.BallParams.radius`), inside the range
BALL_MASS_RANGE = (0.410, 0.450)  # kg at the start of the match, Law 2.1

# --- Law 3, the players -------------------------------------------------------------------------
PLAYERS_PER_TEAM = 11  # Law 3.1: at most eleven, one of them the goalkeeper (at least seven)
KEEPERS_PER_TEAM = 1

# --- Laws 8 and 13-17, restarts -----------------------------------------------------------------
RESTART_DISTANCE = 9.15  # m: kick-off (8.1), free kicks (13.2), corner kicks (17.1, from the arc)
THROW_IN_DISTANCE = 2.0  # m from the point on the touchline where the throw is taken (15.1)
THROW_IN_PLACE_TOLERANCE = 1.0  # m: ours, how far from where the ball left a throw may be taken
KICK_OFF_PLACE_TOLERANCE = 0.25  # m: ours, the ball on the centre mark
RESTARTS = ("kick_off", "free_kick", "corner", "goal_kick", "throw_in")
# Law 11.3: there is no offside offence for receiving the ball directly from one of these.
NO_OFFSIDE_RESTARTS = frozenset({"goal_kick", "throw_in", "corner"})

# --- Law 11, offside ----------------------------------------------------------------------------
LEVEL_TOLERANCE = 0.001  # m, positions are written to 1 mm (SPEC 3.7): closer is level, onside
# Half-width of a body that blocks a line of sight: the vision model's occluding body
# (`analytics.vision.VisionParams.body_radius`), so "obstructs his view" means what the sim's own
# perception means by it.
BODY_RADIUS = 0.3
# A player this close to a free ball can play it (`sim.config.SimParams.control_radius`): an
# attacker in an offside position this close to the ball when an opponent plays it was challenging
# him for it (Law 11.2, interfering with an opponent).
CHALLENGE_RADIUS = 1.0

LAWS = {
    "1": "the field of play",
    "2": "the ball",
    "3": "the players",
    "8": "the start and restart of play",
    "9": "the ball in and out of play",
    "10": "determining the outcome of a match",
    "11": "offside",
    "12": "fouls and misconduct",
    "13": "free kicks",
    "15": "the throw-in",
    "16": "the goal kick",
    "17": "the corner kick",
}


def attack_sign(team: int) -> int:
    """+1 if `team` attacks +x (home), -1 if it attacks -x (away)."""
    return 1 if int(team) == 0 else -1


def depth(xy: np.ndarray, team: int) -> np.ndarray:
    """How far each point lies toward the goal `team` attacks (m, 0 on the halfway line)."""
    return attack_sign(team) * np.asarray(xy, dtype=float)[..., 0]


# --- geometry -----------------------------------------------------------------------------------


def on_field(xy: np.ndarray) -> np.ndarray:
    """Whether each point is on the field of play, lines included."""
    xy = np.asarray(xy, dtype=float)
    return (np.abs(xy[..., 0]) <= HALF_LENGTH) & (np.abs(xy[..., 1]) <= HALF_WIDTH)


def distance_outside(xy: np.ndarray) -> np.ndarray:
    """How far each point lies beyond the outer edge of the lines (m, 0 on the field)."""
    xy = np.asarray(xy, dtype=float)
    dx = np.maximum(np.abs(xy[..., 0]) - HALF_LENGTH, 0.0)
    dy = np.maximum(np.abs(xy[..., 1]) - HALF_WIDTH, 0.0)
    return np.hypot(dx, dy)


def clip_to_field(xy: np.ndarray) -> np.ndarray:
    """Points moved onto the nearest line when they are off the field.

    For offside a defender who has left the field without permission counts as on his goal line
    or touchline, until the next stoppage or until his team has played the ball toward the halfway
    line and out of its penalty area; an attacker who comes back on from beyond the goal line and
    becomes involved counts as on the goal line (Law 11.4). The sim keeps every player on the field
    (`sim.movement.steer` with bounds), so this only guards the audit of older runs.
    """
    lo, hi = [-HALF_LENGTH, -HALF_WIDTH], [HALF_LENGTH, HALF_WIDTH]
    return np.clip(np.asarray(xy, dtype=float), lo, hi)


def in_penalty_area(xy: np.ndarray, team: int) -> np.ndarray:
    """Whether each point is inside the penalty area `team` defends, lines included."""
    d = -depth(xy, team)  # toward the goal it defends
    y = np.abs(np.asarray(xy, dtype=float)[..., 1])
    inside = (d >= HALF_LENGTH - PENALTY_AREA_DEPTH) & (d <= HALF_LENGTH)
    return inside & (y <= PENALTY_AREA_HALF_WIDTH)


def in_goal_area(xy: np.ndarray, team: int) -> np.ndarray:
    """Whether each point is inside the goal area `team` defends, lines included."""
    d = -depth(xy, team)
    y = np.abs(np.asarray(xy, dtype=float)[..., 1])
    return (d >= HALF_LENGTH - GOAL_AREA_DEPTH) & (d <= HALF_LENGTH) & (y <= GOAL_AREA_HALF_WIDTH)


def nearest_corner(xy: np.ndarray) -> np.ndarray:
    """The corner (x, y) nearest a point."""
    x, y = np.asarray(xy, dtype=float)[:2]
    return np.array([math.copysign(HALF_LENGTH, x), math.copysign(HALF_WIDTH, y)])


def in_corner_area(xy: np.ndarray, corner: np.ndarray | None = None, radius: float = 0.0) -> bool:
    """Whether a point is inside a corner area (on the field, within the corner arc; Law 1.7).
    With the ball's `radius`, whether the ball is placed in it: part of the ball over the arc is
    enough (Law 17.1)."""
    xy = np.asarray(xy, dtype=float)[:2]
    corner = nearest_corner(xy) if corner is None else np.asarray(corner, dtype=float)
    within = float(np.linalg.norm(xy - corner)) <= CORNER_ARC_RADIUS + radius
    return within and bool(on_field(xy))


def penalty_mark(team: int) -> np.ndarray:
    """The penalty mark in front of the goal `team` defends."""
    return np.array([-attack_sign(team) * (HALF_LENGTH - PENALTY_MARK_DISTANCE), 0.0])


# --- Law 9, the ball in and out of play ----------------------------------------------------------


def ball_out(ball: np.ndarray, radius: float = BALL_RADIUS) -> str | None:
    """Which line the whole ball has crossed, or None while any part of it is on or over the field.

    The ball is out of play only once all of it is beyond a goal line or a touchline, on the
    ground or in the air (Law 9.1). A ball beyond both is called over the goal line.
    """
    x, y = float(ball[0]), float(ball[1])
    if abs(x) > HALF_LENGTH + radius:
        return "goal_line"
    if abs(y) > HALF_WIDTH + radius:
        return "touchline"
    return None


# --- Law 10, a goal -----------------------------------------------------------------------------


@dataclass(frozen=True)
class GoalLineCrossing:
    """Where the whole ball crossed a goal line between two frames (Law 10.1)."""

    end: int  # +1: the goal line at +x (the away team's goal), -1: at -x
    fraction: float  # of the way from the first frame to the second
    y: float  # ball centre at the crossing
    z: float
    verdict: str  # "goal" | "post" | "wide" | "over"
    y_posts: float = 0.0  # ball centre as it passes the posts


def goal_line_crossing(
    before: np.ndarray, after: np.ndarray, radius: float = BALL_RADIUS
) -> GoalLineCrossing | None:
    """The whole ball crossing a goal line on the straight path from `before` to `after` (x, y, z).

    A goal is scored only when all of the ball has passed over the goal line between the posts
    and under the crossbar (Law 10.1). A ground ball rolls straight, so the line through the two
    points is its path past the posts (`POSTS`). Its verdict:
    - "goal": the path stays clear of both posts, the ball's centre passes inside them, and the
      whole ball is under the bar: all of it went between the posts;
    - "post": the path meets a post or the bar, so the ball strikes the woodwork. The engine
      bounces it off (`sim.ball.post_contact`) before it can cross, so only a run without that
      physics shows this verdict;
    - "wide" / "over": the whole ball passes outside a post or above the bar.
    `y` is the ball's centre where it has wholly crossed, `y_posts` where it passes the posts.
    None when the whole ball does not cross a goal line between the two points.
    """
    b0, b1 = np.asarray(before, dtype=float), np.asarray(after, dtype=float)
    line = HALF_LENGTH + radius
    for end in (1, -1):
        a = np.array([end * b0[0], b0[1]])  # mirrored so that this goal line is at +x
        b = np.array([end * b1[0], b1[1]])
        if not a[0] <= line < b[0]:
            continue
        s = (line - a[0]) / (b[0] - a[0])
        y = float(a[1] + s * (b[1] - a[1]))
        z = float(b0[2] + s * (b1[2] - b0[2])) if len(b0) > 2 else radius
        y_posts = float(a[1] + (POST_X - a[0]) / (b[0] - a[0]) * (b[1] - a[1]))
        reach = radius + POST_RADIUS
        post = any(_approach(a, b, np.array([POST_X, sy * POST_Y]), line) < reach for sy in (1, -1))
        inside = abs(y_posts) < GOAL_HALF_WIDTH
        if z - radius > GOAL_HEIGHT + POST_WIDTH:
            verdict = "over"
        elif post or (inside and z + radius > GOAL_HEIGHT):
            verdict = "post"
        else:
            verdict = "goal" if inside else "wide"
        return GoalLineCrossing(end, float(s), y, z, verdict, y_posts)
    return None


def _approach(a: np.ndarray, b: np.ndarray, c: np.ndarray, x_max: float) -> float:
    """Closest approach to c of the ball's path from a toward b, until it has wholly crossed
    (x <= x_max; it moves toward +x). Only from a on: a ball that came off a post moves away
    from it. A ball slow enough to pass the posts a frame earlier met them, if at all, then;
    the engine's post physics checks every frame."""
    d = b - a
    t = float((c - a) @ d) / max(float(d @ d), 1e-12)
    t = min(max(t, 0.0), (x_max - a[0]) / d[0])
    return float(np.linalg.norm(a + t * d - c))


# --- Law 11, offside ----------------------------------------------------------------------------


def second_last_depth(pos: np.ndarray, team: np.ndarray, attacking: int) -> float:
    """Depth (toward the goal `attacking` attacks) of the second-last opponent: the defender who
    is second nearest his own goal line. Defenders off the field count as on its lines."""
    team = np.asarray(team)
    d = np.sort(depth(clip_to_field(pos)[team != attacking], attacking))
    if len(d) < 2:
        raise ValueError("offside needs at least two opponents")
    return float(d[-2])


def offside_margins(
    pos: np.ndarray, team: np.ndarray, ball: np.ndarray, attacking: int
) -> np.ndarray:
    """(N,) how far each player of `attacking` is beyond the offside line, in m (≤ 0: not).

    The line is the furthest of the halfway line, the ball and the second-last opponent, toward
    the goal his team attacks (Law 11.1): he is in an offside position when he is in the
    opponents' half and nearer their goal line than both the ball and the second-last opponent.
    Opponents' entries are -inf. Positions are clipped to the field first (`clip_to_field`).
    """
    team = np.asarray(team)
    line = max(0.0, float(depth(np.asarray(ball, dtype=float)[:2], attacking)),
               second_last_depth(pos, team, attacking))  # fmt: skip
    margin = depth(clip_to_field(pos), attacking) - line
    return np.where(team == attacking, margin, -np.inf)


def offside_positions(
    pos: np.ndarray, team: np.ndarray, ball: np.ndarray, attacking: int, kicker: int | None = None
) -> np.ndarray:
    """(N,) bool: players of `attacking` in an offside position (Law 11.1) when the ball is where
    it is. Level with the line (within LEVEL_TOLERANCE) is not offside. The player playing the
    ball (`kicker`) is never in an offside position."""
    out = offside_margins(pos, team, ball, attacking) > LEVEL_TOLERANCE
    if kicker is not None and kicker >= 0:
        out[kicker] = False
    return out


def obstructs_view(
    viewer: np.ndarray, ball: np.ndarray, player: np.ndarray, body_radius: float = BODY_RADIUS
) -> bool:
    """Whether `player` stands in the line of sight from `viewer` (the keeper) to the ball: within
    a body's half-width of the segment, between the two (Law 11.2, interfering with an opponent
    by obstructing his line of vision)."""
    v, b, p = (np.asarray(a, dtype=float)[:2] for a in (viewer, ball, player))
    seg = b - v
    length2 = float(seg @ seg)
    if length2 < 1e-12:
        return False
    s = float((p - v) @ seg) / length2
    if not 0.0 < s < 1.0:
        return False
    return float(np.linalg.norm(p - (v + s * seg))) <= body_radius


def offside_offence(
    in_position: bool,
    *,
    restart: str | None = None,
    played_ball: bool = False,
    challenged: bool = False,
    blocked_view: bool = False,
) -> str | None:
    """How a player who was in an offside position when a teammate played the ball became
    involved in active play, which makes it an offence (Law 11.2), or None.

    Being in an offside position is not an offence in itself (Law 11.1). It becomes one when he
    plays or touches the ball (interfering with play); when he challenges an opponent for it, or
    clearly blocks the keeper's line of vision (interfering with an opponent); or when he plays it
    after it came back off the woodwork (gaining an advantage: the referee keeps his offside
    watch across a post rebound, and a sim save always holds the ball). Two cases of interfering
    with an opponent are judgement calls the sim has no data for, a clear attempt to play a close
    ball and an obvious action, so it never gives them. Receiving the ball directly from a goal
    kick, a throw-in or a corner kick is never an offence (Law 11.3).
    """
    if not in_position:
        return None
    if played_ball and restart not in NO_OFFSIDE_RESTARTS:
        return "played the ball"
    if challenged:
        return "challenged an opponent"
    if blocked_view:
        return "blocked the keeper's view"
    return None


# --- Law 12, fouls and misconduct ----------------------------------------------------------------


def keeper_may_handle(xy: np.ndarray, team: int) -> bool:
    """A goalkeeper may handle the ball only inside his own penalty area (Law 12.1). The sim's
    keepers handle only to save an opponent's shot, never a team-mate's back pass or throw-in
    (Law 12.2), and hold it far less than eight seconds (the corner kick of Law 12.3)."""
    return bool(in_penalty_area(np.asarray(xy, dtype=float)[:2], team))


def ball_first(tackler: np.ndarray, carrier: np.ndarray, ball: np.ndarray) -> bool:
    """Whether a tackle reaches the ball before the man: the tackler is nearer the ball than the
    carrier's body. Players are points, so this is our stand-in for Law 12.1's careless challenge
    that goes through the opponent to get to the ball (the sim has no contact model)."""
    t = np.asarray(tackler, dtype=float)[:2]
    return float(np.linalg.norm(t - np.asarray(ball, dtype=float)[:2])) < float(
        np.linalg.norm(t - np.asarray(carrier, dtype=float)[:2])
    )


# --- Laws 8 and 13-17, restarts ------------------------------------------------------------------


@dataclass(frozen=True)
class Breach:
    """One rule a restart breaks: a player too close, or the ball in the wrong place."""

    law: str  # "8.1", "13.2", "15.1", "16.1", "17.1"
    rule: str  # what the rule asks, in our words
    player: int | None  # index of the player who breaks it; None for the ball's place
    value: float  # what was measured (m)
    required: float  # the Law's distance (m)


def restart_breaches(
    kind: str,
    ball: np.ndarray,
    pos: np.ndarray,
    team: np.ndarray,
    taker: int,
    *,
    out_at: np.ndarray | None = None,
    taker_team: int | None = None,
) -> list[Breach]:
    """Every rule of restart `kind` broken in one frame before the ball is in play.

    `taker` is the player taking it (index), `out_at` where the ball left the field (throw-ins and
    corners). Distances are from the ball (kick-off, free kick), from the corner arc (corner), or
    from the point on the touchline where the throw is taken (throw-in). An opponent left in the
    penalty area at a goal kick, or at a free kick in the defenders' own area, may stay if he had
    no time to leave (Laws 16.1, 13.3): that is the referee's judgement, so the check flags him.
    """
    if kind not in RESTARTS:
        raise ValueError(f"unknown restart {kind!r}")
    team = np.asarray(team)
    own = int(team[taker]) if taker_team is None else int(taker_team)
    pos = np.asarray(pos, dtype=float)
    ball = np.asarray(ball, dtype=float)[:2]
    opponents = np.flatnonzero(team != own)
    out: list[Breach] = []

    def too_close(law: str, rule: str, gap: np.ndarray, required: float) -> None:
        for j, g in zip(opponents, gap, strict=True):
            if g < required - LEVEL_TOLERANCE:
                out.append(Breach(law, rule, int(j), float(g), required))

    if kind == "kick_off":  # Law 8.1
        if float(np.linalg.norm(ball)) > KICK_OFF_PLACE_TOLERANCE:
            out.append(Breach("8.1", "ball on the centre mark", None, float(np.linalg.norm(ball)),
                              KICK_OFF_PLACE_TOLERANCE))  # fmt: skip
        for j in range(len(team)):
            if j != taker and depth(pos[j], int(team[j])) > LEVEL_TOLERANCE:
                out.append(Breach("8.1", "every player in his own half", j,
                                  float(depth(pos[j], int(team[j]))), 0.0))  # fmt: skip
        gap = np.linalg.norm(pos[opponents] - ball, axis=-1)
        too_close("8.1", "opponents 9.15 m from the ball", gap, RESTART_DISTANCE)
    elif kind == "free_kick":  # Law 13.2 (a wall's 1 m needs a free kick the sim never plays)
        gap = np.linalg.norm(pos[opponents] - ball, axis=-1)
        # Defenders may stand on their own goal line between the posts for an indirect free kick
        # closer than 9.15 m to their goal.
        on_line = (np.abs(depth(pos[opponents], own) - HALF_LENGTH) <= LINE_WIDTH) & (
            np.abs(pos[opponents][:, 1]) <= GOAL_HALF_WIDTH
        )
        gap = np.where(on_line, np.inf, gap)
        too_close("13.2", "opponents 9.15 m from the ball", gap, RESTART_DISTANCE)
        if in_penalty_area(ball, own):  # a free kick in his own area: opponents outside it
            for j in opponents:
                if in_penalty_area(pos[j], own):
                    out.append(Breach("13.2", "opponents outside the penalty area", int(j), 0.0,
                                      0.0))  # fmt: skip
    elif kind == "corner":  # Law 17.1
        corner = nearest_corner(ball if out_at is None else np.asarray(out_at, dtype=float))
        if not in_corner_area(ball, corner, BALL_RADIUS):  # part of the ball over the arc will do
            out.append(Breach("17.1", "ball in the corner area", None,
                              float(np.linalg.norm(ball - corner)),
                              CORNER_ARC_RADIUS + BALL_RADIUS))  # fmt: skip
        gap = np.maximum(np.linalg.norm(pos[opponents] - corner, axis=-1) - CORNER_ARC_RADIUS, 0.0)
        too_close("17.1", "opponents 9.15 m from the corner arc", gap, RESTART_DISTANCE)
    elif kind == "goal_kick":  # Law 16.1
        if not in_goal_area(ball, own):
            out.append(Breach("16.1", "ball in the goal area", None, 0.0, 0.0))
        for j in opponents:
            if in_penalty_area(pos[j], own):
                out.append(Breach("16.1", "opponents outside the penalty area", int(j), 0.0, 0.0))
    elif kind == "throw_in":  # Law 15.1
        spot = ball if out_at is None else np.asarray(out_at, dtype=float)[:2]
        spot = np.array([float(np.clip(spot[0], -HALF_LENGTH, HALF_LENGTH)),
                         math.copysign(HALF_WIDTH, float(spot[1]))])  # fmt: skip
        if out_at is not None:
            off = float(np.linalg.norm(ball - spot))
            if off > THROW_IN_PLACE_TOLERANCE:
                out.append(Breach("15.1", "thrown from where the ball left the field", None, off,
                                  THROW_IN_PLACE_TOLERANCE))  # fmt: skip
        gap = np.linalg.norm(pos[opponents] - spot, axis=-1)
        too_close("15.1", "opponents 2 m from the throw", gap, THROW_IN_DISTANCE)
    return out


def team_sheet_breaches(teams: list[int], roles: list[str]) -> list[str]:
    """What breaks Law 3.1 in a line-up as the sim plays it: eleven a side, one of them the
    goalkeeper. (The Law allows a team down to seven; the sim always fields eleven.)"""
    out = []
    for t in (0, 1):
        n = sum(1 for k in teams if k == t)
        keepers = sum(1 for k, r in zip(teams, roles, strict=True) if k == t and r == "GK")
        if n != PLAYERS_PER_TEAM:
            out.append(f"team {t} has {n} players")
        if keepers != KEEPERS_PER_TEAM:
            out.append(f"team {t} has {keepers} goalkeepers")
    return out
