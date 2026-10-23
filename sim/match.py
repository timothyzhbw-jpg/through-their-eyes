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
from sim.scenarios import SCENARIOS

SEED_BASE = 1_000_000
# Scenarios that open with a set piece begin with it, whatever the previous possession did
# (`Scenario.restart`).
SET_PIECES = {name: cls.restart for name, cls in SCENARIOS.items() if cls.restart}
# Open play, and the same with the away team on the ball first (`PossessionPlay.start_team`): the
# name says which, so a re-simulation by (scenario, seed) plays the same passage.
OPEN_PLAY, OPEN_PLAY_AWAY = "possession_play", "possession_play_away"


@dataclass(frozen=True)
class PossessionSpec:
    scenario: str
    seed: int | None = None  # None: an open-play passage keyed off the match seed
    max_s: float | None = None  # its cap; None: the scenario's default (SimParams)


def _open(max_s: float) -> PossessionSpec:
    """An open-play passage (`possession_play`): until the ball goes out, at most `max_s`."""
    return PossessionSpec(OPEN_PLAY, max_s=max_s)


# 15 open-play passages and 4 heroes; at most 13:28 of play. Hero seeds are the demo seeds:
# blind_side_run 3 (the deployed hero), press_escape 0 and corner_blind_side 0 (each scenario's
# first design seed), far_post_finish 11 (a typical design seed: the far post and a goal with the
# look, the near post and a save without it). The kick-off passage is short, so the first hero
# comes within 35 s; the caps vary so that open play has a rhythm, and a passage that puts the
# ball out ends there. After the goal the away team takes the corner at 1–0.
DEFAULT_PLAN: tuple[PossessionSpec, ...] = (
    _open(30.0),  # kick-off
    PossessionSpec("blind_side_run", 3),  # the scan hero, by 0:30
    *map(_open, (50.0, 65.0, 40.0, 60.0, 55.0)),
    PossessionSpec("press_escape", 0),  # the pressure hero, about 4:30
    *map(_open, (45.0, 70.0, 50.0)),
    PossessionSpec("far_post_finish", 11),  # the shot hero: 1–0, about 7:00
    *map(_open, (60.0, 40.0)),
    PossessionSpec("corner_blind_side", 0),  # the set-piece hero, about 8:40
    *map(_open, (55.0, 65.0, 45.0, 50.0)),
)


# match-2: three of match-1's heroes (not the shot) on other design seeds, in another order, each
# gated like its demo seed
# (hero moment and lens, the intervention changes the outcome, every claim supported, an offline
# breakdown with no render violation): the pressure hero first, then the short corner, then the
# blind-side run. 17 possessions, at most 12:23 of play, 0–0.
MATCH_2: tuple[PossessionSpec, ...] = (
    _open(25.0),  # kick-off
    PossessionSpec("press_escape", 1),  # without carrying it he finds the full-back H3, by 0:25
    *map(_open, (55.0, 40.0, 65.0, 50.0)),
    PossessionSpec("corner_blind_side", 2),  # separation 3.0 m with the look, 8.1 m without
    *map(_open, (60.0, 45.0, 70.0, 40.0, 55.0)),
    PossessionSpec("blind_side_run", 11),  # without the look he plays it wide to H7
    *map(_open, (50.0, 65.0, 45.0, 60.0)),
)

# Other matches' plans, by match seed; any other seed plays DEFAULT_PLAN.
PLANS: dict[int, tuple[PossessionSpec, ...]] = {2: MATCH_2}


def plan_for(seed: int) -> tuple[PossessionSpec, ...]:
    return PLANS.get(seed, DEFAULT_PLAN)


def match_heroes(seed: int) -> list[tuple[str, int]]:
    """(scenario, seed) of every hero possession in match `seed`'s plan, in order, once each."""
    heroes = [(s.scenario, s.seed) for s in plan_for(seed) if s.seed is not None]
    return list(dict.fromkeys(heroes))


@dataclass
class Possession:
    index: int
    scenario: str
    seed: int
    start: int  # match frame of its first frame
    restart: str  # kick_off | throw_in | goal_kick | corner | free_kick | cut
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
    """How play restarts after a possession (SPEC 3.9): a kick-off after a goal, an indirect free
    kick after offside (Law 11.4), else where the whole ball went out (Laws 15-17), or a cut
    when it ended in play."""
    if any(e.type == "goal" for e in run.events):
        return "kick_off"  # the other team kicks off
    if any(e.type == "offside" for e in run.events):
        return "free_kick"  # to the defenders, where the offence was
    outs = [e for e in run.events if e.type == "out"]
    if not outs:
        return "cut"
    out = max(outs, key=lambda e: e.frame)
    x, y = out.attrs["at"]
    if out.attrs.get("line", "touchline" if abs(y) > HALF_WIDTH else "goal_line") == "touchline":
        return "throw_in"
    if abs(x) > HALF_LENGTH:
        defending = 1 if x > 0 else 0  # the away team defends +x, the home team -x
        return "goal_kick" if out.team != defending else "corner"
    return "cut"


def awarded_team(run, restart: str) -> int | None:
    """The team the Laws award the restart after a possession to (SPEC 3.9): the side that
    conceded kicks off (Law 8.1); a throw-in goes to the opponents of the last player to touch
    the ball (Law 15), a corner to the attackers and a goal kick to the defenders (Laws 16, 17);
    the free kick after offside to the defenders (Law 11.4). None after a cut: no law awards it."""
    if restart == "kick_off":
        goal = next((e for e in run.events if e.type == "goal"), None)
        return None if goal is None else 1 - goal.team
    if restart == "free_kick":
        call = next(e for e in run.events if e.type == "offside")
        return int(call.attrs["awarded_to"])
    if restart not in ("throw_in", "goal_kick", "corner"):
        return None
    out = max((e for e in run.events if e.type == "out"), key=lambda e: e.frame)
    if restart == "throw_in":
        return 1 - out.team
    defending = 1 if out.attrs["at"][0] > 0 else 0  # the away team defends +x
    return defending if restart == "goal_kick" else 1 - defending


def score_after(score: tuple[int, int], events: list[Event]) -> tuple[int, int]:
    home, away = score
    for e in events:
        if e.type == "goal":
            home, away = (home + 1, away) if e.team == 0 else (home, away + 1)
    return home, away


def build_match(seed: int, plan: tuple[PossessionSpec, ...] | None = None) -> StitchedMatch:
    """Match `seed`, played to `plan` (default: `plan_for(seed)`)."""
    plan = plan_for(seed) if plan is None else plan
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
        restart = "kick_off" if k == 0 else restart_after(possessions[-1].run)
        team = None if k == 0 else awarded_team(possessions[-1].run, restart)
        # An open-play passage starts with the team the Laws award the restart to (SPEC 3.9).
        scenario = OPEN_PLAY_AWAY if spec.scenario == OPEN_PLAY and team == 1 else spec.scenario
        run = Simulation.from_scenario(scenario, pseed, params=params).run()
        restart = SET_PIECES.get(spec.scenario, restart)
        if players is None:
            players = run.players
        elif [p.id for p in run.players] != [p.id for p in players]:
            raise ValueError(f"{spec.scenario} lists other players than the first possession")
        possessions.append(Possession(k, scenario, pseed, start, restart, score, run))
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
        print(f"{p.index:>2}  {p.start * DT:6.1f} s  {p.restart:<9} {p.scenario:<20} "
              f"seed {p.seed:<10} {p.frames * DT:5.1f} s  {home}-{away}")  # fmt: skip
    home, away = match.score
    print(f"{len(match.possessions)} possessions, {match.duration_s:.1f} s, {home}-{away}, "
          f"{match.output_hash()[:16]}")  # fmt: skip


if __name__ == "__main__":
    main()
