"""A stitched match (SPEC 3.1): scenario possessions back to back on one clock.

A match is a plan of possessions, each one scenario run with its own seed. Hero possessions keep
the seed the plan gives them (the demo heroes); the others get a seed keyed off the match seed
(SPEC 3.7), so the same match seed gives the same match byte for byte. Derived seeds start at
1,000,000 and never coincide with a design or eval seed.

- **Time is continuous.** Possession k starts on the frame after possession k − 1 ended; its
  frames, event ids and frame-valued attributes move to match time by adding its start frame.
- **Restarts.** The first possession kicks off. After that, play restarts the way the previous
  possession stopped: a throw-in, goal kick or corner when the ball went out, or a cut when it
  ended in play (the broadcast cuts to the next passage of play). The next scenario then sets up
  its own situation: the stitch is an edit, not a simulated restart.
- **Score.** Goals are `goal` events. The sim has no shot outcomes yet (M4), so a match stays 0–0
  unless a possession produces one; the score is carried, never invented.

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

POSSESSION_S = 30.0  # longest open-play possession in a match (possession_play runs on to it)
SEED_BASE = 1_000_000


@dataclass(frozen=True)
class PossessionSpec:
    scenario: str
    seed: int | None = None  # None: keyed off the match seed
    max_duration_s: float | None = None  # None: the scenario's default (SimParams)


# Six possessions: open play, the scan hero, open play, the pressure hero, open play twice.
# Hero seeds are the demo seeds: blind_side_run 3 (the deployed hero), press_escape 0 (its first
# design seed).
DEFAULT_PLAN: tuple[PossessionSpec, ...] = (
    PossessionSpec("possession_play", max_duration_s=POSSESSION_S),
    PossessionSpec("blind_side_run", 3),
    PossessionSpec("possession_play", max_duration_s=POSSESSION_S),
    PossessionSpec("press_escape", 0),
    PossessionSpec("possession_play", max_duration_s=POSSESSION_S),
    PossessionSpec("possession_play", max_duration_s=POSSESSION_S),
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


def possession_seed(match_seed: int, index: int) -> int:
    """The seed of an open-play possession, keyed by (match seed, possession index)."""
    gen = KeyedRng(match_seed).generator("possession_seed", index)
    return SEED_BASE + int(gen.integers(0, 2**31 - SEED_BASE))


def global_id(local_id: str, start: int) -> str:
    """An event or moment id ("<...>:<frame>") moved to match time."""
    head, _, frame = local_id.rpartition(":")
    return f"{head}:{int(frame) + start:04d}"


def restart_after(run) -> str:
    """How play restarts after a possession: from where the ball went out, or a cut."""
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
    start, score, restart = 0, (0, 0), "kick_off"
    for k, spec in enumerate(plan):
        pseed = spec.seed if spec.seed is not None else possession_seed(seed, k)
        params = SimParams()
        if spec.max_duration_s is not None:
            params = replace(params, max_duration_s=spec.max_duration_s)
        run = Simulation.from_scenario(spec.scenario, pseed, params=params).run()
        if players is None:
            players = run.players
        elif [p.id for p in run.players] != [p.id for p in players]:
            raise ValueError(f"{spec.scenario} lists other players than the first possession")
        possessions.append(Possession(k, spec.scenario, pseed, start, restart, score, run))
        start += len(run.owner)
        score = score_after(score, run.events)
        restart = restart_after(run)
    return StitchedMatch(seed=seed, players=players or [], possessions=possessions)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a stitched match and summarise it.")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    match = build_match(args.seed)
    for p in match.possessions:
        home, away = p.score_before
        print(f"{p.index}  {p.start * DT:6.1f} s  {p.restart:<9} {p.scenario:<16} "
              f"seed {p.seed:<10} {p.frames * DT:5.1f} s  {home}-{away}")  # fmt: skip
    home, away = match.score
    print(f"{match.duration_s:.1f} s, {home}-{away}, {match.output_hash()[:16]}")


if __name__ == "__main__":
    main()
