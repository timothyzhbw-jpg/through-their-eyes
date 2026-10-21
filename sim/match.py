"""A stitched match (SPEC 3.1): 15–25 scenario possessions, 10–15 min, on one clock.

A match is a plan of possessions, each one scenario run with its own seed. Hero possessions keep
the seed the plan gives them (the demo heroes). An open-play passage gets a seed keyed by (match
seed, n), where n counts open-play passages only, so inserting a hero moves no open-play seed;
derived seeds start at 1,000,000 and never coincide with a design or eval seed (SPEC 3.7). It
plays until the ball goes out or its cap: the caps are fixed in the plan, so how long the match
can be does not depend on the platform, though where the ball goes out does (SPEC 3.7: byte for
byte only within one platform). The same match seed gives the same match byte for byte.

- **Time is continuous.** Possession k starts on the frame after possession k − 1 ended; its
  frames, event ids and frame-valued attributes move to match time by adding its start frame.
- **Restarts.** The first possession kicks off. A goal is followed by a kick-off (the other team).
  Otherwise play restarts the way the previous possession stopped: a throw-in, goal kick or corner
  when the ball went out, or a cut when it ended in play. A set-piece scenario declares its own
  restart and begins with it. The next scenario then sets up its own situation: the stitch is an
  edit, not a simulated restart.
- **Score.** Goals are `goal` events from scenarios with shots enabled; the score is carried,
  never invented.

Each possession is simulated on its own and stays a plain `MatchRun`, so the explain layer, the
counterfactuals and the agents keep working on (scenario, seed) with local frames;
`explain.match.match_moments` lifts its moments to match time.

    uv run python -m sim.match --seed 1
"""

from __future__ import annotations

import argparse
import hashlib
from dataclasses import dataclass, replace

from sim.config import DT, HALF_LENGTH, HALF_WIDTH, SimParams
from sim.engine import Simulation
from sim.model import Event, PlayerInfo
from sim.rng import KeyedRng
from sim.run import MatchRun

SEED_BASE = 1_000_000
# Scenarios that open with a set piece begin with it, whatever the previous possession did.
SET_PIECES = {"corner_blind_side": "corner"}


@dataclass(frozen=True)
class PossessionSpec:
    scenario: str
    seed: int | None = None  # None: an open-play passage keyed off the match seed
    max_s: float | None = None  # its cap; None: the scenario's default (SimParams)


def _open(max_s: float) -> PossessionSpec:
    """An open-play passage (`possession_play`): until the ball goes out, at most `max_s`."""
    return PossessionSpec("possession_play", max_s=max_s)


# 15 open-play passages and 3 heroes; at most 13:18 of play. Hero seeds are the demo seeds:
# blind_side_run 3 (the deployed hero), press_escape 0 and corner_blind_side 0 (each scenario's
# first design seed). The kick-off passage is short, so the first hero comes within 35 s; the caps
# vary so that open play has a rhythm, and a passage that puts the ball out ends there.
DEFAULT_PLAN: tuple[PossessionSpec, ...] = (
    _open(30.0),  # kick-off
    PossessionSpec("blind_side_run", 3),  # the scan hero, by 0:30
    *map(_open, (50.0, 65.0, 40.0, 60.0, 55.0)),
    PossessionSpec("press_escape", 0),  # the pressure hero, about 4:30
    *map(_open, (45.0, 70.0, 50.0, 60.0, 40.0)),
    PossessionSpec("corner_blind_side", 0),  # the set-piece hero, about 8:30
    *map(_open, (55.0, 65.0, 45.0, 50.0)),
)


@dataclass
class Possession:
    index: int
    scenario: str
    seed: int
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


def open_play_seed(match_seed: int, n: int) -> int:
    """The seed of the n-th open-play passage, keyed by (match seed, n). `n` counts open-play
    passages only, so inserting a hero possession does not move a seed."""
    gen = KeyedRng(match_seed).generator("open_play", n)
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


def score_after(score: tuple[int, int], events: list[Event]) -> tuple[int, int]:
    home, away = score
    for e in events:
        if e.type == "goal":
            home, away = (home + 1, away) if e.team == 0 else (home, away + 1)
    return home, away


def build_match(seed: int, plan: tuple[PossessionSpec, ...] = DEFAULT_PLAN) -> StitchedMatch:
    possessions: list[Possession] = []
    players: list[PlayerInfo] | None = None
    start, score, n = 0, (0, 0), 0
    for k, spec in enumerate(plan):
        if spec.seed is None:
            pseed, n = open_play_seed(seed, n), n + 1
        else:
            pseed = spec.seed
        params = SimParams()
        if spec.max_s is not None:
            params = replace(params, max_duration_s=spec.max_s)
        run = Simulation.from_scenario(spec.scenario, pseed, params=params).run()
        restart = "kick_off" if k == 0 else restart_after(possessions[-1].run)
        restart = SET_PIECES.get(spec.scenario, restart)
        if players is None:
            players = run.players
        elif [p.id for p in run.players] != [p.id for p in players]:
            raise ValueError(f"{spec.scenario} lists other players than the first possession")
        possessions.append(Possession(k, spec.scenario, pseed, start, restart, score, run))
        start += len(run.owner)
        score = score_after(score, run.events)
    return StitchedMatch(seed=seed, players=players or [], possessions=possessions)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a stitched match and summarise it.")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    match = build_match(args.seed)
    for p in match.possessions:
        home, away = p.score_before
        print(f"{p.index:>2}  {p.start * DT:6.1f} s  {p.restart:<9} {p.scenario:<18} "
              f"seed {p.seed:<10} {p.frames * DT:5.1f} s  {home}-{away}")  # fmt: skip
    home, away = match.score
    print(f"{len(match.possessions)} possessions, {match.duration_s:.1f} s, {home}-{away}, "
          f"{match.output_hash()[:16]}")  # fmt: skip


if __name__ == "__main__":
    main()
