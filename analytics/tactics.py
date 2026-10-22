"""Tactics cards (SPEC 4.8): two questions a fan asks, answered only from what the sim records.

- **Why build from the back?** A team's passes kicked in its own half: how often they are
  completed with and without pressure on the passer, short against long, how many break a line,
  what they gain in expected threat and what a lost one hands the opponent. Where the sim records
  the alternatives (the decision model's options, SPEC 3.5), what the carrier chose against his
  best short and best long option.
- **Why focus on set pieces?** Corners, the shots and expected goals that follow them, the share
  of the match's shots and xG from set pieces, and how much threat a corner reaches against the
  open-play passages.

Inputs are what the live stream carries (SPEC 4.6): the stats timeline's pass cues (outcome from
the feed, pressing on the passer at the kick), tracking, the event feed and each possession's
restart. The alternatives are the exception: decisions are sim records, not stream data, and the
card says so. Nothing here is fitted or tuned to an outcome; every threshold is a module constant.

The rest of a tactics table (high press, counter-attack, wide overloads, ...) needs events the
sim does not have yet; docs/TACTICS.md lists what each would need.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field

from analytics.live_stats import PassCue, StatsTimeline
from analytics.xt import GOAL_X, xt_for

PRESSED = 0.7  # pressing intensity on the passer at the kick: the lexicon's "heavy pressure"
LONG_PASS_M = 32.0  # a pass to a teammate this far away at the kick is long (35 yards)
MIN_BYPASSED = 2  # a line-breaking pass goes past this many outfield opponents (explain.moments)
SET_PIECES = ("corner",)  # restarts that count as set pieces; the sim plays only corners
OPEN_PLAY = "open_play"  # a lone hero run's restart, unless its scenario is a set piece
VERSION = 1
SOURCES = (
    "Bekkers (2025), Pressing Intensity, arXiv:2501.04712",
    "Singh (2019), Expected Threat (xT)",
)


def _r(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def _ratio(num: int, den: int) -> float | None:
    return None if den == 0 else _r(num / den)


def _mean(values: Sequence[float]) -> float | None:
    return None if not values else _r(float(np.mean(values)))


# --- what the cards are made from --------------------------------------------------------------


@dataclass(frozen=True)
class Passage:
    """One scenario possession on the match clock: frames [start, end)."""

    index: int
    start: int
    end: int
    restart: str  # kick_off | throw_in | goal_kick | corner | cut | open_play
    scenario: str


@dataclass(frozen=True)
class OptionRecord:
    action: str
    kind: str  # pass | carry | shot
    to: str | None
    p_success: float
    value: float  # the decision model's value, in expected threat (SPEC 3.5)


@dataclass(frozen=True)
class DecisionRecord:
    """A decision the sim recorded (SPEC 3.5), on the match clock."""

    frame: int
    player: str
    chosen: str
    options: tuple[OptionRecord, ...]


def decision_records(decisions: Iterable[Any], start: int = 0) -> list[DecisionRecord]:
    """Plain records of a run's decisions (`sim.model.Decision`), moved by `start` frames."""
    return [
        DecisionRecord(
            frame=int(d.frame) + start,
            player=d.player,
            chosen=d.chosen,
            options=tuple(
                OptionRecord(o.action, o.kind, o.target_player, float(o.p_success), float(o.value))
                for o in d.options
            ),
        )
        for d in decisions
    ]


@dataclass
class TacticsInput:
    """Tracking in metres, the feed and the possessions, as the stats timeline read them."""

    timeline: StatsTimeline
    pos: np.ndarray  # (F, N, 2) m
    ball: np.ndarray  # (F, 2) m
    events: list[dict[str, Any]]
    passages: list[Passage]
    decisions: list[DecisionRecord]

    @property
    def ids(self) -> list[str]:
        return self.timeline.ids

    @property
    def team(self) -> np.ndarray:
        return self.timeline.team

    @property
    def roles(self) -> list[str]:
        return [str(p["role"]) for p in self.timeline.players]

    @property
    def dt(self) -> float:
        return self.timeline.dt

    @property
    def frames(self) -> int:
        return self.timeline.frames

    def passage_of(self, frame: int) -> Passage:
        starts = [p.start for p in self.passages]
        return self.passages[int(np.searchsorted(starts, frame, side="right")) - 1]


def passages_of(export: dict[str, Any], frames: int) -> list[Passage]:
    """A stitched match's possessions from its export; a hero run is one passage."""
    if export.get("kind") == "match":
        return [
            Passage(int(p["index"]), int(p["start"]), int(p["start"]) + int(p["frames"]),
                    str(p["restart"]), str(p["scenario"]))
            for p in export["match"]["possessions"]
        ]  # fmt: skip
    return [lone_passage(str(export.get("scenario", "hero")), frames)]


def tactics_input(
    timeline: StatsTimeline,
    passages: Sequence[Passage] | None = None,
    decisions: Sequence[DecisionRecord] = (),
) -> TacticsInput:
    """The cards' input from a stats timeline (its export carries the tracking and the feed)."""
    export = timeline.export
    n = len(timeline.ids)
    run = export["runs"]["factual"]
    frames = timeline.frames
    pos = np.asarray(run["pos"], dtype=np.float64).reshape(-1, n, 2)[:frames] / 1000.0
    ball = np.asarray(run["ball"], dtype=np.float64).reshape(-1, 2)[:frames] / 1000.0
    return TacticsInput(
        timeline=timeline,
        pos=pos,
        ball=ball,
        events=[e for e in run["events"] if int(e["frame"]) < frames],
        passages=list(passages) if passages is not None else passages_of(export, frames),
        decisions=sorted(decisions, key=lambda d: (d.frame, d.player)),
    )


# --- the cards ---------------------------------------------------------------------------------


class Group(BaseModel):
    """Passes of one kind: how many, how many completed, and their mean xT added."""

    passes: int
    completed: int
    completion: float | None
    xt: float | None  # mean ΔxT per pass (a lost pass: minus the opponent's xT where it was won)


class TeamBuildUp(BaseModel):
    team: int
    all: Group
    pressed: Group
    unpressed: Group
    short: Group
    long: Group
    pressed_short: Group
    unpressed_short: Group
    line_breaking: int  # completed, past MIN_BYPASSED or more outfield opponents
    line_breaking_pressed: int
    lost: int
    lost_xt: float | None  # mean xT the opponent had where it won the ball
    lost_pressed_short: int
    lost_pressed_short_xt: float | None
    pressed_short_ids: list[str]  # the pass events of `pressed_short`


class OptionOut(BaseModel):
    action: str
    kind: str
    to: str | None
    length_m: float | None  # ball to the intended receiver at the decision
    long: bool
    p_success: float
    value: float


class Alternative(BaseModel):
    """A recorded decision in the carrier's own half: what he chose, and his other options."""

    id: str
    frame: int
    t: float
    possession: int
    scenario: str
    player: str
    team: int
    pressure: float | None  # on the passer at the kick, when the choice was a pass
    options: int
    chosen: OptionOut
    best_short: OptionOut | None
    best_long: OptionOut | None
    safest: OptionOut | None  # the pass most likely to arrive


class BuildUpCard(BaseModel):
    team: int  # the team that played the most passes in its own half (ties: home)
    teams: list[TeamBuildUp]
    alternatives: list[Alternative]


class Corner(BaseModel):
    possession: int
    scenario: str
    frame: int  # the corner's first kick
    t: float
    team: int
    played: bool  # False: given as a corner, restarted as open play by the stitch (SPEC 3.1)
    shots: int
    xg: float
    peak_xt: float | None  # the best reception's xT for the taking team
    peak_frame: int | None
    peak_s: float | None  # from the first kick to that reception
    peak_player: str | None
    peak_pass: str | None  # the pass event received there


class ShotOut(BaseModel):
    id: str
    frame: int
    t: float
    player: str
    team: int
    possession: int
    set_piece: bool
    xg: float


class SetPieceCard(BaseModel):
    awarded: int  # possessions that restart with a corner
    corners: int  # of them, played as corners (a set-piece scenario)
    shots_from_corners: int
    xg_from_corners: float
    xg_per_corner: float | None
    shots: int  # the whole match
    xg: float
    shot_share: float | None  # from set pieces
    xg_share: float | None
    open_play: int  # open-play passages with a completed pass
    open_play_peak_median: float | None
    best: Corner | None  # the played corner whose best reception is worth the most
    below_best: int  # open-play passages whose best reception is worth less than `best`'s
    corner_list: list[Corner]
    shot_list: list[ShotOut]


class TacticsDefinitions(BaseModel):
    pressed: float = PRESSED
    long_pass_m: float = LONG_PASS_M
    min_bypassed: int = MIN_BYPASSED
    set_pieces: list[str] = Field(default_factory=lambda: list(SET_PIECES))
    sources: list[str] = Field(default_factory=lambda: list(SOURCES))


class TacticsCards(BaseModel):
    version: int = VERSION
    match: str
    kind: Literal["hero", "match"]
    dt: float
    source: Literal["tracking"] = "tracking"
    definitions: TacticsDefinitions = Field(default_factory=TacticsDefinitions)
    build_up: BuildUpCard
    set_pieces: SetPieceCard


# --- kernels -----------------------------------------------------------------------------------


def attack_sign(team: int) -> int:
    """+1 for the home team (attacks +x), −1 for the away team."""
    return 1 if int(team) == 0 else -1


def own_half(ball_x: float, team: int) -> bool:
    return attack_sign(team) * float(ball_x) < 0.0


def bypassed(
    pos_kick: np.ndarray,
    pos_end: np.ndarray,
    ball_kick: np.ndarray,
    ball_end: np.ndarray,
    opponents: np.ndarray,
    sign: int,
) -> int:
    """Outfield opponents (`opponents`: their indices) goal-side of the ball at the kick and
    behind it at the reception, as `explain.moments.bypassed_opponents` on tracking."""
    ahead = sign * pos_kick[opponents, 0] > sign * float(ball_kick[0])
    behind = sign * pos_end[opponents, 0] < sign * float(ball_end[0])
    return int(np.count_nonzero(ahead & behind))


def pass_value(ball_kick: np.ndarray, ball_end: np.ndarray, completed: bool, sign: int) -> float:
    """xT added by a pass: completed, the xT where it was received minus where it was played;
    lost, minus the opponent's xT where they won it, minus where it was played."""
    before = float(xt_for(ball_kick, sign))
    if completed:
        return float(xt_for(ball_end, sign)) - before
    return -float(xt_for(ball_end, -sign)) - before


def distance_xg_at(point: np.ndarray, team: int) -> float:
    """The sim's distance xG (`sim.decision.distance_xg`) of a shot from `point`."""
    from sim.decision import distance_xg

    goal = np.array([attack_sign(team) * GOAL_X, 0.0])
    return distance_xg(float(np.linalg.norm(goal - np.asarray(point, dtype=float))))


@dataclass(frozen=True)
class _Pass:
    cue: PassCue
    team: int
    length_m: float
    pressed: bool
    long: bool
    completed: bool
    delta_xt: float
    lost_xt: float | None
    bypassed: int


def _group(passes: Sequence[_Pass]) -> Group:
    done = sum(p.completed for p in passes)
    return Group(
        passes=len(passes),
        completed=done,
        completion=_ratio(done, len(passes)),
        xt=_mean([p.delta_xt for p in passes]),
    )


def build_up_passes(inp: TacticsInput) -> list[_Pass]:
    """Every resolved pass kicked in the passer's own half, measured."""
    index = {pid: j for j, pid in enumerate(inp.ids)}
    to = {e["id"]: (e.get("attrs") or {}).get("to") for e in inp.events if e["type"] == "pass"}
    outfield = np.asarray([r != "GK" for r in inp.roles])
    out: list[_Pass] = []
    for cue in inp.timeline.cues:
        if not isinstance(cue, PassCue):
            continue
        team = int(inp.team[index[cue.player]])
        k0, k1 = cue.kick, cue.frame
        b0, b1 = inp.ball[k0], inp.ball[k1]
        if not own_half(b0[0], team):
            continue
        sign = attack_sign(team)
        mate = to.get(cue.id)
        length = (
            float(np.linalg.norm(inp.pos[k0, index[mate]] - b0))
            if mate in index
            else float(np.linalg.norm(b1 - b0))
        )
        completed = cue.outcome == "complete"
        opponents = np.flatnonzero((inp.team != team) & outfield)
        out.append(
            _Pass(
                cue=cue,
                team=team,
                length_m=length,
                pressed=cue.components.passer >= PRESSED,
                long=length >= LONG_PASS_M,
                completed=completed,
                delta_xt=pass_value(b0, b1, completed, sign),
                lost_xt=None if completed else float(xt_for(b1, -sign)),
                bypassed=bypassed(inp.pos[k0], inp.pos[k1], b0, b1, opponents, sign)
                if completed
                else 0,
            )
        )
    return out


def team_build_up(passes: Sequence[_Pass], team: int) -> TeamBuildUp:
    mine = [p for p in passes if p.team == team]
    pressed = [p for p in mine if p.pressed]
    unpressed = [p for p in mine if not p.pressed]
    breaking = [p for p in mine if p.completed and p.bypassed >= MIN_BYPASSED]
    lost = [p for p in mine if not p.completed]
    lost_ps = [p for p in lost if p.pressed and not p.long]
    return TeamBuildUp(
        team=team,
        all=_group(mine),
        pressed=_group(pressed),
        unpressed=_group(unpressed),
        short=_group([p for p in mine if not p.long]),
        long=_group([p for p in mine if p.long]),
        pressed_short=_group([p for p in pressed if not p.long]),
        unpressed_short=_group([p for p in unpressed if not p.long]),
        line_breaking=len(breaking),
        line_breaking_pressed=sum(p.pressed for p in breaking),
        lost=len(lost),
        lost_xt=_mean([p.lost_xt for p in lost if p.lost_xt is not None]),
        lost_pressed_short=len(lost_ps),
        lost_pressed_short_xt=_mean([p.lost_xt for p in lost_ps if p.lost_xt is not None]),
        pressed_short_ids=[p.cue.id for p in pressed if not p.long],
    )


def _option(inp: TacticsInput, o: OptionRecord, frame: int) -> OptionOut:
    length = None
    if o.kind == "pass" and o.to in inp.ids:
        length = _r(np.linalg.norm(inp.pos[frame, inp.ids.index(o.to)] - inp.ball[frame]), 2)
    return OptionOut(
        action=o.action,
        kind=o.kind,
        to=o.to,
        length_m=length,
        long=length is not None and length >= LONG_PASS_M,
        p_success=_r(o.p_success),
        value=_r(o.value),
    )


def alternatives(inp: TacticsInput) -> list[Alternative]:
    """Recorded decisions with the ball in the carrier's own half."""
    index = {pid: j for j, pid in enumerate(inp.ids)}
    kicks = {(c.player, c.kick): c for c in inp.timeline.cues if isinstance(c, PassCue)}
    out: list[Alternative] = []
    for d in inp.decisions:
        f = d.frame
        if not 0 <= f < inp.frames or d.player not in index:
            continue
        team = int(inp.team[index[d.player]])
        if not own_half(inp.ball[f, 0], team):
            continue
        options = [_option(inp, o, f) for o in d.options]
        chosen = next(o for o in options if o.action == d.chosen)
        passes = [o for o in options if o.kind == "pass"]
        short = [o for o in passes if not o.long]
        long = [o for o in passes if o.long]
        cue = kicks.get((d.player, f))
        p = inp.passage_of(f)
        out.append(
            Alternative(
                id=f"decision:{d.player}:{f:04d}",
                frame=f,
                t=_r(f * inp.dt, 2),
                possession=p.index,
                scenario=p.scenario,
                player=d.player,
                team=team,
                pressure=None if cue is None else cue.components.passer,
                options=len(options),
                chosen=chosen,
                best_short=max(short, key=lambda o: o.value, default=None),
                best_long=max(long, key=lambda o: o.value, default=None),
                safest=max(passes, key=lambda o: o.p_success, default=None),
            )
        )
    return out


def build_up_card(inp: TacticsInput) -> BuildUpCard:
    passes = build_up_passes(inp)
    teams = [team_build_up(passes, t) for t in (0, 1)]
    featured = 1 if teams[1].all.passes > teams[0].all.passes else 0
    return BuildUpCard(team=featured, teams=teams, alternatives=alternatives(inp))


def _first_kick(inp: TacticsInput, p: Passage) -> dict[str, Any] | None:
    return next(
        (e for e in inp.events
         if e["type"] in ("pass", "shot") and p.start <= int(e["frame"]) < p.end),
        None,
    )  # fmt: skip


def _peak(inp: TacticsInput, p: Passage, team: int | None) -> tuple[float, PassCue] | None:
    """The completed pass in the passage (by `team`, or either) received where it was worth the
    most xT to the receiving team."""
    index = {pid: j for j, pid in enumerate(inp.ids)}
    best: tuple[float, PassCue] | None = None
    for cue in inp.timeline.cues:
        if not isinstance(cue, PassCue) or cue.outcome != "complete":
            continue
        if not p.start <= cue.kick < p.end:
            continue
        side = int(inp.team[index[cue.player]])
        if team is not None and side != team:
            continue
        value = float(xt_for(inp.ball[cue.frame], attack_sign(side)))
        if best is None or value > best[0]:
            best = (value, cue)
    return best


def shots(inp: TacticsInput, corners: Sequence[Corner]) -> list[ShotOut]:
    index = {pid: j for j, pid in enumerate(inp.ids)}
    taken = {c.possession: c.team for c in corners if c.played}
    out: list[ShotOut] = []
    for e in inp.events:
        if e["type"] != "shot":
            continue
        f = int(e["frame"])
        team = int(inp.team[index[e["player"]]])
        p = inp.passage_of(f)
        out.append(
            ShotOut(
                id=e["id"],
                frame=f,
                t=_r(f * inp.dt, 2),
                player=e["player"],
                team=team,
                possession=p.index,
                set_piece=taken.get(p.index) == team,
                xg=_r(distance_xg_at(inp.ball[f], team)),
            )
        )
    return out


def set_piece_card(inp: TacticsInput) -> SetPieceCard:
    from sim.match import SET_PIECES as PLAYED  # set-piece scenarios begin with their restart

    index = {pid: j for j, pid in enumerate(inp.ids)}
    corners: list[Corner] = []
    for p in inp.passages:
        if p.restart not in SET_PIECES:
            continue
        kick = _first_kick(inp, p)
        if kick is None:
            continue
        team = int(inp.team[index[kick["player"]]])
        k0 = int(kick["frame"])
        peak = _peak(inp, p, team)
        corners.append(
            Corner(
                possession=p.index,
                scenario=p.scenario,
                frame=k0,
                t=_r(k0 * inp.dt, 2),
                team=team,
                played=PLAYED.get(p.scenario) in SET_PIECES,
                shots=0,
                xg=0.0,
                peak_xt=None if peak is None else _r(peak[0]),
                peak_frame=None if peak is None else peak[1].frame,
                peak_s=None if peak is None else _r((peak[1].frame - k0) * inp.dt, 2),
                peak_player=None if peak is None else peak[1].receiver,
                peak_pass=None if peak is None else peak[1].id,
            )
        )
    shot_list = shots(inp, corners)
    for c in corners:
        mine = [s for s in shot_list if s.set_piece and s.possession == c.possession]
        c.shots, c.xg = len(mine), _r(sum(s.xg for s in mine))
    played = [c for c in corners if c.played]
    in_set = {c.possession for c in corners}
    open_peaks = [
        peak[0]
        for p in inp.passages
        if p.index not in in_set and (peak := _peak(inp, p, None)) is not None
    ]
    best = max(
        (c for c in played if c.peak_xt is not None), key=lambda c: c.peak_xt or 0.0, default=None
    )
    from_corners = [s for s in shot_list if s.set_piece]
    xg_corners = _r(sum(s.xg for s in from_corners))
    xg_all = _r(sum(s.xg for s in shot_list))
    return SetPieceCard(
        awarded=len(corners),
        corners=len(played),
        shots_from_corners=len(from_corners),
        xg_from_corners=xg_corners,
        xg_per_corner=None if not played else _r(xg_corners / len(played)),
        shots=len(shot_list),
        xg=xg_all,
        shot_share=_ratio(len(from_corners), len(shot_list)),
        xg_share=None if xg_all <= 0 else _r(xg_corners / xg_all),
        open_play=len(open_peaks),
        open_play_peak_median=None if not open_peaks else _r(float(np.median(open_peaks))),
        best=best,
        below_best=0 if best is None else sum(_r(v) < (best.peak_xt or 0.0) for v in open_peaks),
        corner_list=corners,
        shot_list=shot_list,
    )


def tactics_cards(inp: TacticsInput) -> TacticsCards:
    tl = inp.timeline
    return TacticsCards(
        match=tl.match,
        kind=tl.kind,
        dt=tl.dt,
        build_up=build_up_card(inp),
        set_pieces=set_piece_card(inp),
    )


def stat(cards: TacticsCards, path: str, team: int | None = None) -> Any:
    """A value of the cards by dotted path: `build_up.<field>...` reads the team's TeamBuildUp
    (`team` required), `set_pieces.<field>...` the set-piece card. None when it is undefined."""
    head, _, rest = path.partition(".")
    if head == "build_up":
        if team not in (0, 1):
            raise KeyError("build_up stats need a team, 0 or 1")
        node: Any = cards.build_up.teams[int(team)]
    elif head == "set_pieces":
        node = cards.set_pieces
    else:
        raise KeyError(f"no tactics card {head!r}")
    for name in rest.split("."):
        if node is None:
            return None
        if not isinstance(node, BaseModel) or name not in type(node).model_fields:
            raise KeyError(f"no tactics stat {path!r}")
        node = getattr(node, name)
    return node


def lone_passage(scenario: str, frames: int) -> Passage:
    """One scenario's run as a single passage: a set-piece scenario begins with its restart."""
    from sim.match import SET_PIECES as PLAYED

    return Passage(0, 0, frames, PLAYED.get(scenario, OPEN_PLAY), scenario)


def match_passages(match: Any) -> list[Passage]:
    """A stitched match's possessions (`sim.match.StitchedMatch`) as passages."""
    return [Passage(p.index, p.start, p.end, p.restart, p.scenario) for p in match.possessions]


def tactics_from_run(
    run: Any,
    match_id: str,
    passages: Sequence[Passage] | None = None,
    decisions: Sequence[DecisionRecord] = (),
) -> TacticsCards:
    """The cards of a sim run (`sim.run.MatchRun`): one scenario's run, or with `passages` a
    stitched match on one clock. Measured through `stats_from_run`, so they equal the cards of
    the export the service streams."""
    from analytics.live_stats import stats_from_run

    frames = len(run.owner)
    starts = None if passages is None else [p.start for p in passages]
    timeline = stats_from_run(run, match_id, starts)
    ps = list(passages) if passages is not None else [lone_passage(run.scenario, frames)]
    return tactics_cards(tactics_input(timeline, ps, decisions))
