"""A stitched match (SPEC 3.1): 15–25 scenario possessions, 10–15 min, on one clock.

A match is a plan of possessions, each one scenario run with its own seed. Hero possessions keep
the seed the plan gives them (the demo heroes). Each open-play passage is the first keyed
candidate that ends with the ball out of play inside its window, so every stitch between
open-play passages is a stoppage; a hero ends in play and the next possession is a cut. Open-play
seeds are keyed by (match seed, passage, attempt), all at least 1,000,000 (SPEC 3.7), so the same
match seed gives the same match byte for byte and never coincides with a design or eval seed.

- **Time is continuous.** Possession k starts on the frame after possession k − 1 ended; its
  frames, event ids and frame-valued attributes move to match time by adding its start frame.
- **Restarts.** The first possession kicks off. A goal is followed by a kick-off (the other team).
  Otherwise play restarts the way the previous possession stopped: a throw-in, goal kick or corner
  when the ball went out, or a cut when it ended in play. A set-piece scenario declares its own
  restart and begins with it. The next scenario then sets up its own situation: the stitch is an
  edit, not a simulated restart.
- **Score.** Goals are `goal` events. The sim has no shot outcomes yet (M4), so a match stays 0–0
  unless a possession produces one; the score is carried, never invented.

Each possession is simulated on its own and stays a plain `MatchRun`, so the explain layer, the
counterfactuals and the agents keep working on (scenario, seed) with local frames;
`explain.match.match_moments` lifts its moments to match time.

    uv run python -m sim.match --seed 1
    uv run python -m sim.match --seed 1 --search
"""

from __future__ import annotations

import argparse
import hashlib
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, replace

from sim.config import DT, HALF_LENGTH, HALF_WIDTH, SimParams
from sim.engine import Simulation
from sim.model import Event, PlayerInfo
from sim.rng import KeyedRng
from sim.run import MatchRun

SEED_BASE = 1_000_000
KICK_OFF_S = (15.0, 30.0)  # the first passage, so the first hero comes within ~35 s of kick-off
OPEN_PLAY_S = (25.0, 60.0)  # every other open-play passage
OUT_OF_PLAY = frozenset({"throw_in", "goal_kick", "corner"})
# Scenarios that open with a set piece begin with it, whatever the previous possession did.
SET_PIECES = {"corner_blind_side": "corner"}


# `seed` None is an open-play passage keyed off the match seed, and then `window_s` is required:
# open play ends out of play inside `[lo, hi]` seconds, and the run's max_duration_s is `hi`.
@dataclass(frozen=True)
class PossessionSpec:
    scenario: str
    seed: int | None = None
    window_s: tuple[float, float] | None = None


def _open(window_s: tuple[float, float] = OPEN_PLAY_S) -> PossessionSpec:
    """An open-play passage (`possession_play`) that ends out of play inside `window_s`."""
    return PossessionSpec("possession_play", window_s=window_s)


# 17 open-play passages and 3 heroes. Hero seeds are the demo seeds: blind_side_run 3 (the
# deployed hero), press_escape 0 and corner_blind_side 0 (each scenario's first design seed).
# Times are match 1's.
DEFAULT_PLAN: tuple[PossessionSpec, ...] = (
    _open(KICK_OFF_S),  # kick-off; out of play within 30 s
    PossessionSpec("blind_side_run", 3),  # the scan hero (the deployed hero), 0:19
    *(_open(),) * 5,
    PossessionSpec("press_escape", 0),  # the pressure hero, 4:28
    *(_open(),) * 9,  # in match 1 the last one ends with H9 putting it over his own line
    PossessionSpec("corner_blind_side", 0),  # the set-piece hero: that corner, 10:40
    *(_open(),) * 2,
)

# Match 1's edit: for each open-play passage, the first candidate (attempt) that ends out of play
# inside its window. `python -m sim.match --seed 1 --search` finds them again.
EDITS: dict[int, tuple[int, ...]] = {
    1: (1, 0, 15, 4, 11, 11, 5, 3, 9, 1, 7, 0, 4, 0, 12, 0, 12),
}


@dataclass
class Possession:
    index: int
    scenario: str
    seed: int
    attempt: int | None  # open-play candidate number; None for a hero
    start: int  # match frame of its first frame
    restart: str  # kick_off | throw_in | goal_kick | corner | cut
    score_before: tuple[int, int]  # (home, away)
    run: MatchRun

    @property
    def frames(self) -> int:
        return len(self.run.owner)

    @property
    def end(self) -> int:
        """Match frame after its last frame."""
        return self.start + self.frames


@dataclass
class StitchedMatch:
    seed: int
    players: list[PlayerInfo]
    possessions: list[Possession]
    dt: float = DT

    @property
    def frames(self) -> int:
        return sum(p.frames for p in self.possessions)

    @property
    def duration_s(self) -> float:
        return self.frames * self.dt

    @property
    def score(self) -> tuple[int, int]:
        last = self.possessions[-1]
        return score_after(last.score_before, last.run.events)

    def to_bytes(self) -> bytes:
        """Each possession's canonical run (SPEC 3.7) behind a line saying where it sits."""
        parts = []
        for p in self.possessions:
            head = f"possession {p.index} {p.scenario} {p.seed} {p.start} {p.restart} "
            parts.append((head + f"{p.score_before[0]}-{p.score_before[1]}\n").encode())
            parts.append(p.run.to_bytes())
        return b"".join(parts)

    def output_hash(self) -> str:
        return hashlib.sha256(self.to_bytes()).hexdigest()


def open_play_seed(match_seed: int, n: int, attempt: int = 0) -> int:
    """The n-th open-play passage's candidate seed number `attempt`.

    `n` counts open-play passages only, so inserting a hero possession does not move a seed.
    """
    gen = KeyedRng(match_seed).generator("open_play", n, str(attempt))
    return SEED_BASE + int(gen.integers(0, 2**31 - SEED_BASE))


def global_id(local_id: str, start: int) -> str:
    """An event or moment id ("<...>:<frame>") moved to match time."""
    head, _, frame = local_id.rpartition(":")
    return f"{head}:{int(frame) + start:04d}"


def restart_after(run) -> str:
    """How play restarts after a possession: a kick-off after a goal, else where the ball went
    out, or a cut when it ended in play."""
    if any(e.type == "goal" for e in run.events):
        return "kick_off"  # the other team kicks off
    outs = [e for e in run.events if e.type == "out"]
    if not outs:
        return "cut"
    out = max(outs, key=lambda e: e.frame)
    x, y = out.attrs["at"]
    if abs(y) > HALF_WIDTH:
        return "throw_in"
    if abs(x) > HALF_LENGTH:
        defending = 1 if x > 0 else 0  # the away team defends +x, the home team -x
        return "goal_kick" if out.team != defending else "corner"
    return "cut"


def ends_out_of_play(run, window_s: tuple[float, float]) -> bool:
    """The passage ended on a throw-in, goal kick or corner, no earlier than `window_s[0]`."""
    return restart_after(run) in OUT_OF_PLAY and len(run.owner) * run.dt >= window_s[0]


def score_after(score: tuple[int, int], events: list[Event]) -> tuple[int, int]:
    home, away = score
    for e in events:
        if e.type == "goal":
            home, away = (home + 1, away) if e.team == 0 else (home, away + 1)
    return home, away


def _fitting_attempt(job: tuple[int, int, float, float, int]) -> int | None:
    """The attempt when that keyed `possession_play` ends out of play, else None.

    Module-level so a process pool can pickle it.
    """
    match_seed, n, lo, hi, attempt = job
    window_s = (lo, hi)
    params = replace(SimParams(), max_duration_s=hi)
    run = Simulation.from_scenario(
        "possession_play", open_play_seed(match_seed, n, attempt), params=params
    ).run()
    return attempt if ends_out_of_play(run, window_s) else None


def _no_attempt(
    match_seed: int, n: int, window_s: tuple[float, float], start: int, stop: int
) -> ValueError:
    return ValueError(
        f"match {match_seed}: no attempt in [{start}, {stop}) ends open-play passage {n} "
        f"out of play in {window_s} s"
    )


def first_fit(
    match_seed: int,
    n: int,
    window_s: tuple[float, float],
    start: int = 0,
    stop: int = 1000,
) -> int:
    """The first attempt in `[start, stop)` whose passage ends out of play in `window_s`."""
    for attempt in range(start, stop):
        if _fitting_attempt((match_seed, n, window_s[0], window_s[1], attempt)) is not None:
            return attempt
    raise _no_attempt(match_seed, n, window_s, start, stop)


def _first_fit_parallel(
    pool: ProcessPoolExecutor,
    match_seed: int,
    n: int,
    window_s: tuple[float, float],
    workers: int,
    stop: int = 1000,
) -> int:
    """`first_fit` over batches of `workers` attempts: the smallest fit of the first batch that
    has one, so a later attempt cannot win just because its worker finished first."""
    start = 0
    while start < stop:
        end = min(start + workers, stop)
        jobs = [(match_seed, n, window_s[0], window_s[1], a) for a in range(start, end)]
        fits = [a for a in pool.map(_fitting_attempt, jobs) if a is not None]
        if fits:
            return min(fits)
        start = end
    raise _no_attempt(match_seed, n, window_s, 0, stop)


def _open_windows(plan: tuple[PossessionSpec, ...]) -> list[tuple[float, float]]:
    windows = []
    for spec in plan:
        if spec.seed is not None:
            continue
        if spec.window_s is None:
            raise ValueError("an open-play passage needs a window_s")
        windows.append(spec.window_s)
    return windows


def search_edit(
    match_seed: int,
    plan: tuple[PossessionSpec, ...] = DEFAULT_PLAN,
    workers: int | None = None,
) -> tuple[int, ...]:
    """The first out-of-play attempt of every open-play passage in `plan`.

    With more than one worker, candidates run in batches of that many consecutive attempts and
    the smallest fit in the first batch that has one is kept, so the edit does not depend on how
    many workers run. One worker calls `first_fit` in this process.
    """
    windows = _open_windows(plan)
    n_workers = workers if workers is not None else (os.cpu_count() or 1)
    if n_workers == 1:
        return tuple(first_fit(match_seed, n, window) for n, window in enumerate(windows))
    with ProcessPoolExecutor(n_workers) as pool:
        return tuple(
            _first_fit_parallel(pool, match_seed, n, window, n_workers)
            for n, window in enumerate(windows)
        )


def build_match(
    seed: int,
    plan: tuple[PossessionSpec, ...] = DEFAULT_PLAN,
    edit: tuple[int, ...] | None = None,
) -> StitchedMatch:
    """Stitch `plan` onto one clock.

    `edit` None with the default plan uses the committed `EDITS` for this seed; with any other
    plan, or a seed that has no edit, each open-play passage runs at attempt 0 and is not
    checked. An edit lists one attempt per open-play passage, and that passage has to end out
    of play in its window.
    """
    if edit is None and plan is DEFAULT_PLAN:
        edit = EDITS.get(seed)
    windows = _open_windows(plan)
    if edit is not None and len(edit) != len(windows):
        raise ValueError(
            f"match {seed}: the edit lists {len(edit)} open-play attempts, "
            f"the plan has {len(windows)}"
        )
    possessions: list[Possession] = []
    players: list[PlayerInfo] | None = None
    start, score, n = 0, (0, 0), 0
    for k, spec in enumerate(plan):
        if spec.seed is None:
            window = spec.window_s
            if window is None:  # _open_windows already refused this
                raise ValueError("an open-play passage needs a window_s")
            attempt = 0 if edit is None else edit[n]
            pseed = open_play_seed(seed, n, attempt)
            params = replace(SimParams(), max_duration_s=window[1])
            run = Simulation.from_scenario(spec.scenario, pseed, params=params).run()
            if edit is not None and not ends_out_of_play(run, window):
                raise ValueError(
                    f"match {seed}: open-play passage {n} (possession {k}) no longer ends "
                    f"out of play in {spec.window_s} s; "
                    f"re-run python -m sim.match --seed {seed} --search"
                )
            n += 1
        else:
            attempt = None
            pseed = spec.seed
            run = Simulation.from_scenario(spec.scenario, pseed).run()
        restart = "kick_off" if k == 0 else restart_after(possessions[-1].run)
        restart = SET_PIECES.get(spec.scenario, restart)
        if players is None:
            players = run.players
        elif [p.id for p in run.players] != [p.id for p in players]:
            raise ValueError(f"{spec.scenario} lists other players than the first possession")
        possessions.append(Possession(k, spec.scenario, pseed, attempt, start, restart, score, run))
        start += len(run.owner)
        score = score_after(score, run.events)
    return StitchedMatch(seed=seed, players=players or [], possessions=possessions)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a stitched match and summarise it.")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument(
        "--search", action="store_true", help="find the open-play edit and print it"
    )
    parser.add_argument("--workers", type=int, default=os.cpu_count())
    args = parser.parse_args()
    if args.search:
        found = search_edit(args.seed, workers=args.workers)
        print(f"EDITS[{args.seed}] = {found}")
        same = found == EDITS.get(args.seed)
        print("equals the committed edit" if same else "differs from the committed edit")
        if not same:
            raise SystemExit(1)
        return
    match = build_match(args.seed)
    for p in match.possessions:
        home, away = p.score_before
        attempt = "-" if p.attempt is None else str(p.attempt)
        print(f"{p.index}  {p.start * DT:6.1f} s  {p.restart:<9} {p.scenario:<18} "
              f"seed {p.seed:<10} {attempt:>3} {p.frames * DT:5.1f} s  {home}-{away}")  # fmt: skip
    home, away = match.score
    print(f"{match.duration_s:.1f} s, {home}-{away}, {match.output_hash()[:16]}")
    print(f"{len(match.possessions)} possessions")


if __name__ == "__main__":
    main()
