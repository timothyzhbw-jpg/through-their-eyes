"""His options on his belief at any frame, and what a look added to his picture (SPEC 3.4, 3.5, 7).

The decision model runs once, at his decision (SPEC 3.5). The scan story asks a question the run
does not record: what options did he have after each look? Here the same model
(`sim.decision.evaluate_options`) is run on his belief at any frame, rebuilt from the run as the
sim keeps it (SPEC 3.4): for every other player, the last sighting extrapolated at most
`belief_horizon_s`, everyone known at frame 0 (`explain.lenses.sightings`). At his decision frame
this reproduces the decision record exactly (tests/test_belief_options.py). Before he has the ball
the options are scored as if it were at his feet where he stands. Read only: nothing here touches
the sim or a run.

"New in his picture" on a look: the players who came into his sight on it (out of it as it began,
in it on some frame of it), and every player whose believed position at its end is more than
NEW_M from where he would have believed them without that look's sightings.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np

from explain.lenses import sightings
from sim.config import SimParams
from sim.decision import DecisionContext, OptionEval, evaluate_options
from sim.run import MatchRun
from sim.scenarios import SCENARIOS

NEW_M = 1.0  # a believed position that moved further than this on a look is news
OPEN_P = 0.5  # an option is open when he believes it succeeds at least this often


def belief_state(
    run: MatchRun,
    observer: str,
    frame: int,
    seen: np.ndarray | None = None,
    ignore: tuple[int, int] | None = None,
    params: SimParams = SimParams(),
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """His believed positions, velocities and belief ages (s) of every player at `frame`, as the
    sim's `BeliefStore.estimate`; his own entries are the truth. Sightings in the inclusive frame
    range `ignore` are left out (a look he did not take)."""
    i = run.index(observer)
    seen = sightings(run, observer, params) if seen is None else seen
    col = seen[: frame + 1].copy()
    col[0] = True
    if ignore is not None:
        col[max(1, ignore[0]) : ignore[1] + 1] = False
    last = np.array([int(np.flatnonzero(col[:, j])[-1]) for j in range(col.shape[1])])
    every = np.arange(len(last))
    age = (frame - last) * run.dt
    ahead = np.minimum(age, params.belief_horizon_s)[:, None]
    pos = run.pos[last, every] + run.vel[last, every] * ahead
    vel = run.vel[last, every].copy()
    pos[i], vel[i], age[i] = run.pos[frame, i], run.vel[frame, i], 0.0
    return pos, vel, age


def options_on_belief(
    run: MatchRun,
    player: str,
    frame: int,
    seen: np.ndarray | None = None,
    ignore: tuple[int, int] | None = None,
) -> list[OptionEval]:
    """Every option the decision model weighs on his belief at `frame` (without the sightings in
    `ignore`, as `belief_state`), with the ball where it is when he has it, else at his feet where
    he stands."""
    i = run.index(player)
    pos, vel, age = belief_state(run, player, frame, seen, ignore)
    team = np.array([p.team for p in run.players])
    ball = run.ball_pos[frame, :2].copy() if run.owner[frame] == i else run.pos[frame, i].copy()
    shot_fields = {}
    if SCENARIOS[run.scenario].shots:
        passes = [e for e in run.events if e.type == "pass" and e.frame <= frame
                  and e.attrs.get("to") == player]  # fmt: skip
        keeper = next(
            (j for j, p in enumerate(run.players) if p.team != team[i] and p.role == "GK"), -1
        )
        from_y = float(passes[-1].attrs["start"][1]) if passes else 0.0
        shot_fields = {"shots": True, "keeper": keeper, "from_y": from_y}
    ctx = DecisionContext(
        carrier=i,
        team=team,
        pos=pos,
        vel=vel,
        age_s=age,
        ids=run.ids,
        attack_sign=1 if team[i] == 0 else -1,
        ball=ball,
        temperature=run.players[i].temperature,
        **shot_fields,
    )
    return evaluate_options(ctx)


def look_options(
    run: MatchRun, player: str, start: int, end: int, seen: np.ndarray | None = None
) -> tuple[list[OptionEval], list[OptionEval]]:
    """His options at the end of a look over frames `start`..`end`: (without the look's
    sightings, with them). The same frame and ball, so the difference is the look's alone."""
    seen = sightings(run, player) if seen is None else seen
    before = options_on_belief(run, player, end, seen, ignore=(start, end))
    return before, options_on_belief(run, player, end, seen)


def option_changes(
    was: Mapping[str, float], now: Mapping[str, float]
) -> tuple[list[str], list[str]]:
    """(opened, closed) actions, from each option's believed success before and after (action ->
    p): an option opens when it reaches OPEN_P from below or from not playable; it closes when it
    falls below OPEN_P or stops being playable. In the order of `now`, then the options gone."""
    opened = [a for a, p in now.items() if p >= OPEN_P and was.get(a, 0.0) < OPEN_P]
    closed = [a for a, p in now.items() if p < OPEN_P <= was.get(a, 0.0)]
    closed += [a for a, p in was.items() if a not in now and p >= OPEN_P]
    return opened, closed


@dataclass(frozen=True)
class News:
    """A player new in his picture on a look."""

    player: str
    entered: bool  # came into his sight on the look
    moved_m: float  # how far the look moved where he believes him, at its end
    gap_before_m: float  # how far from him he would have believed him without the look
    gap_after_m: float  # and with it


def new_in_picture(
    run: MatchRun, observer: str, start: int, end: int, seen: np.ndarray | None = None
) -> list[News]:
    """Who is new in his picture after a look over frames `start`..`end`: came into his sight on
    it, or believed more than NEW_M from where he would have believed them without it. Largest
    move first; ties in the run's player order."""
    seen = sightings(run, observer) if seen is None else seen
    i = run.index(observer)
    with_look, _, _ = belief_state(run, observer, end, seen)
    without, _, _ = belief_state(run, observer, end, seen, ignore=(start, end))
    moved = np.linalg.norm(with_look - without, axis=-1)
    me = run.pos[end, i]
    before = seen[start - 1] if start > 0 else np.ones(len(run.ids), dtype=bool)
    entered = ~before & seen[start : end + 1].any(axis=0)
    out = [
        News(run.ids[j], bool(entered[j]), float(moved[j]),
             float(np.linalg.norm(without[j] - me)), float(np.linalg.norm(with_look[j] - me)))
        for j in range(len(run.ids)) if j != i and (entered[j] or moved[j] > NEW_M)
    ]  # fmt: skip
    return sorted(out, key=lambda n: -n.moved_m)
