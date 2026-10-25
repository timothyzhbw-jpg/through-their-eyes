"""His options on his belief at any frame, and what a look added to his picture (SPEC 3.4, 3.5, 7).

The decision model runs once, at his decision (SPEC 3.5). The scan story asks a question the run
does not record: what options did he have after each look? Here the same model
(`sim.decision.evaluate_options`) is run on his belief at any frame, rebuilt from the run as the
sim keeps it (SPEC 3.4): for every other player, the last sighting extrapolated at most
`belief_horizon_s`, everyone known at frame 0 (`explain.lenses.sightings`). At his decision frame
this reproduces the decision record exactly (tests/test_belief_options.py). Before he has the ball
the options are scored as if it were at his feet where he stands. The factual run is never mutated.

"Without this look" resumes the sim with `DropScan` for that scan, preserving any intervention
already in the run. Its sightings replace the factual ones only from the look's start through
the requested cutoff (the frozen frame on a story card). Earlier sightings, positions, the frame
and the ball remain factual, so the comparison isolates what the look showed. If dropping the
scan changes physical play by the cutoff, those sightings would describe different geometry;
the comparison is ill-defined and is rejected rather than mixing the runs.

"New in his picture" on a look: the players out of sight as it began who came into sight by the
cutoff and would not have been seen by then without that scan, and every player whose believed
position at the cutoff is more than NEW_M from where he would have believed them without it.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np

from explain.lenses import sightings
from sim.config import SimParams
from sim.decision import DecisionContext, OptionEval, evaluate_options
from sim.engine import Simulation
from sim.overrides import DropScan, ForceAction
from sim.run import MatchRun
from sim.scenarios import SCENARIOS

NEW_M = 1.0  # a believed position that moved further than this on a look is news
OPEN_P = 0.5  # an option is open when he believes it succeeds at least this often


class IllDefinedLook(ValueError):
    """The dropped scan changes physical play before the information comparison's cutoff."""


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
    range `ignore` are left out (a sighting ablation, not the run without a scan)."""
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


def without_look_sightings(
    run: MatchRun,
    player: str,
    start: int,
    end: int,
    seen: np.ndarray | None = None,
    overrides: Sequence[DropScan | ForceAction] = (),
) -> np.ndarray:
    """Factual sightings except over `start`..`end`, where they come from the run resumed with
    this scan dropped. Everything before the look is unchanged.

    `overrides` must reproduce the supplied run (e.g. its already dropped scan or forced action).
    As in `sim.counterfactual.drop_scan_counterfactual`, resume a snapshot just before this scan
    with `DropScan(scan.id)`. Only run through the cutoff; later outcomes do not enter the card.
    Reject a replay that does not match the supplied run, or physical divergence by `end`: masks
    from different player/body/ball trajectories would not isolate the look on factual geometry.
    """
    if not 0 <= start <= end < len(run.pos):
        raise ValueError(f"invalid look frames {start}..{end}")
    seen = sightings(run, player) if seen is None else seen
    scan = next(
        (e for e in run.events if e.type == "scan" and e.player == player and e.frame == start),
        None,
    )
    if scan is None:
        raise ValueError(f"no scan by {player} at frame {start}")
    sim = Simulation.resume(Simulation.from_scenario(run.scenario, run.seed), overrides)
    sim.run_until(start)
    replay = sim.result()
    physical = ("pos", "vel", "body_yaw", "ball_pos", "ball_vel", "owner")
    if any(not np.array_equal(getattr(replay, key), getattr(run, key)[: start + 1])
           for key in (*physical, "head_yaw")):  # fmt: skip
        raise ValueError(f"replay before {scan.id} does not match the supplied run's interventions")
    dropped_sim = Simulation.resume(sim.snapshot(), [DropScan(scan.id)])
    dropped_sim.run_until(end)
    dropped = dropped_sim.result()
    if end >= len(dropped.pos):
        raise IllDefinedLook(f"the run without {scan.id} ends before frame {end}")
    if any(not np.array_equal(getattr(dropped, key), getattr(run, key)[: end + 1])
           for key in physical):  # fmt: skip
        raise IllDefinedLook(f"dropping {scan.id} changes physical play by frame {end}")
    without = seen.copy()
    without[start : end + 1] = sightings(dropped, player)[start : end + 1]
    return without


def look_options(
    run: MatchRun,
    player: str,
    start: int,
    end: int,
    seen: np.ndarray | None = None,
    without_seen: np.ndarray | None = None,
) -> tuple[list[OptionEval], list[OptionEval]]:
    """His options at the end of a look over frames `start`..`end`: (in the run without that scan,
    with it). The same factual frame, positions and ball, so the difference is the look's alone."""
    seen = sightings(run, player) if seen is None else seen
    if without_seen is None:
        without_seen = without_look_sightings(run, player, start, end, seen)
    before = options_on_belief(run, player, end, without_seen)
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
    entered: bool  # came into sight by the cutoff, unseen without the scan
    moved_m: float  # how far the look moved where he believes him, at its end
    gap_before_m: float  # how far from him he would have believed him without the look
    gap_after_m: float  # and with it


def new_in_picture(
    run: MatchRun,
    observer: str,
    start: int,
    end: int,
    seen: np.ndarray | None = None,
    without_seen: np.ndarray | None = None,
) -> list[News]:
    """Who the look adds by `end`: entered sight by then, unseen without the scan, or believed
    more than NEW_M from where he would have believed them without it. Largest move first;
    ties in the run's player order."""
    seen = sightings(run, observer) if seen is None else seen
    if without_seen is None:
        without_seen = without_look_sightings(run, observer, start, end, seen)
    i = run.index(observer)
    with_look, _, _ = belief_state(run, observer, end, seen)
    without, _, _ = belief_state(run, observer, end, without_seen)
    moved = np.linalg.norm(with_look - without, axis=-1)
    me = run.pos[end, i]
    before = seen[start - 1] if start > 0 else np.ones(len(run.ids), dtype=bool)
    entered = (~before & seen[start : end + 1].any(axis=0)
               & ~without_seen[start : end + 1].any(axis=0))  # fmt: skip
    out = [
        News(run.ids[j], bool(entered[j]), float(moved[j]),
             float(np.linalg.norm(without[j] - me)), float(np.linalg.norm(with_look[j] - me)))
        for j in range(len(run.ids)) if j != i and (entered[j] or moved[j] > NEW_M)
    ]  # fmt: skip
    return sorted(out, key=lambda n: -n.moved_m)
