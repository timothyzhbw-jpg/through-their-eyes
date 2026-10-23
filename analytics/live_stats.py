"""The live match-stats timeline (SPEC 4.6).

Built only from what the live stream carries — positions and the ball in mm, the owner and the
event feed — never from sim attributes such as pass outcomes. Causal: a value at frame f uses
frames <= f only, and each cue's `frame` is when its value is final. A snapshot at f holds only
cues with frame <= f.

    uv run python -m analytics.live_stats --match 1
    uv run python -m analytics.live_stats --scenario blind_side_run --seed 3 [--out file.json]
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Any, Literal

import numpy as np
from pydantic import BaseModel, Field

from analytics.pressing import aggregate, frame_pressing
from analytics.stats import (
    BANDS,
    CONTROL_RADIUS_M,
    DIFFICULTY_WEIGHTS,
    DISTANCE_SCALE_M,
    DISTANCE_STEP_M,
    FRAME_HZ,
    HSR_MPS,
    LANE_SIGMA_S,
    REACTION_S,
    RELEASE_FRAMES,
    RUN_IN_SPREAD_M,
    SMOOTH_FRAMES,
    SOURCES,
    SPRINT_MIN_FRAMES,
    SPRINT_MPS,
    V_MAX,
    cumulative_distance,
    difficulty_band,
    display,
    lane_risk,
    milestones,
    pass_difficulty,
    pass_length,
    release_speed,
    runs_above,
    segment_starts,
    smoothed_speed,
    smoothed_velocity,
)
from sim.roster import full_name, short_name

FIXTURE_FRAMES = (0, 25, 75, 100, 150)
_KIND_ORDER = {"pass": 0, "shot": 1, "sprint": 2, "distance": 3}
_PASS_END = {"reception", "interception", "out"}
_KICKS = {"pass", "shot"}
_SHOT_END = {"reception", "interception", "out", "save", "goal"}
_OUTCOME = {"reception": "complete", "interception": "intercepted", "out": "out"}


class Parts(BaseModel):
    lane: float
    passer: float
    receiver: float
    distance: float


class PassCue(BaseModel):
    kind: Literal["pass"] = "pass"
    id: str
    frame: int
    t: float
    possession: int | None
    kick: int
    player: str
    receiver: str | None
    outcome: Literal["complete", "intercepted", "out"]
    distance_m: float
    ball_kmh: float
    difficulty: float
    band: str
    components: Parts


class ShotCue(BaseModel):
    kind: Literal["shot"] = "shot"
    id: str
    frame: int
    t: float
    possession: int | None
    kick: int
    player: str
    speed_kmh: float


class SprintCue(BaseModel):
    kind: Literal["sprint"] = "sprint"
    id: str
    frame: int
    t: float
    possession: int | None
    player: str
    start: int
    end: int
    peak_frame: int
    peak_kmh: float
    distance_m: float


class DistanceCue(BaseModel):
    kind: Literal["distance"] = "distance"
    id: str
    frame: int
    t: float
    possession: int | None
    player: str
    metres: int


Cue = Annotated[PassCue | ShotCue | SprintCue | DistanceCue, Field(discriminator="kind")]


class PlayerTotals(BaseModel):
    id: str
    team: int
    number: int
    role: str
    name: str
    short: str
    distance_m: float
    hsr_m: float
    sprint_m: float
    top_kmh: float
    sprints: int
    passes: int
    completed: int
    accuracy: float | None
    mean_difficulty: float | None
    shots: int
    top_shot_kmh: float | None


class TeamTotals(BaseModel):
    team: int
    distance_m: float
    passes: int
    completed: int
    accuracy: float | None
    mean_difficulty: float | None
    shots: int
    top_shot_kmh: float | None
    top_kmh: float


class SpeedRun(BaseModel):
    player: str
    start: int
    kmh10: list[int]
    sprint: list[tuple[int, int]]  # [start, end) absolute frames, speed > SPRINT_MPS


class Tracks(BaseModel):
    every: int = 25
    distance_dm: list[list[int]]
    hsr_dm: list[list[int]]
    sprint_dm: list[list[int]]
    top_kmh10: list[list[int]]
    ball_kmh10: list[int]
    speed: list[SpeedRun]


class Definitions(BaseModel):
    """Every constant a viewer needs, filled from analytics.stats."""

    hsr_kmh: float = round(HSR_MPS * 3.6, 1)
    sprint_kmh: float = round(SPRINT_MPS * 3.6, 1)
    sprint_min_s: float = SPRINT_MIN_FRAMES / FRAME_HZ
    smooth_s: float = SMOOTH_FRAMES / FRAME_HZ
    release_s: float = RELEASE_FRAMES / FRAME_HZ
    distance_step_m: float = DISTANCE_STEP_M
    difficulty_weights: dict[str, float] = Field(default_factory=lambda: dict(DIFFICULTY_WEIGHTS))
    distance_scale_m: float = DISTANCE_SCALE_M
    lane_sigma_s: float = LANE_SIGMA_S
    reaction_s: float = REACTION_S
    v_max_mps: float = V_MAX
    control_radius_m: float = CONTROL_RADIUS_M
    run_in_spread_m: float = RUN_IN_SPREAD_M
    bands: list[tuple[float, str]] = Field(
        default_factory=lambda: [(float(limit), name) for limit, name in BANDS]
    )
    sources: list[str] = Field(default_factory=lambda: list(SOURCES))


class MatchStats(BaseModel):
    version: int = 1
    match: str
    kind: Literal["hero", "match"]
    dt: float
    frames: int
    frame: int
    t: float
    source: Literal["tracking"] = "tracking"
    definitions: Definitions
    players: list[PlayerTotals]
    teams: list[TeamTotals]
    cues: list[Cue]
    tracks: Tracks | None = None


def _r1(value: float) -> float:
    return display(value, 1)


def _kmh(mps: float) -> float:
    """km/h as shown, to 0.1 (`display`): a claim about the same speed reads the same."""
    return display(float(mps) * 3.6, 1)


def _ints(row: np.ndarray) -> list[int]:
    return [int(v) for v in row]


@dataclass
class StatsTimeline:
    """Cues and running totals for one export. `snapshot` is what a viewer holds at a frame."""

    match: str
    export: dict[str, Any]
    kind: Literal["hero", "match"]
    dt: float
    frames: int
    ids: list[str]
    players: list[dict[str, Any]]
    team: np.ndarray
    breaks: list[int]
    seg: np.ndarray
    speed: np.ndarray
    ball_speed: np.ndarray
    vel: np.ndarray
    distance: np.ndarray
    hsr: np.ndarray
    sprint: np.ndarray
    cues: list[Cue]

    def snapshot(self, frame: int | None = None, tracks: bool = False) -> MatchStats:
        last = self.frames - 1
        f = last if frame is None else min(max(int(frame), 0), last)
        visible = [c for c in self.cues if c.frame <= f]
        players, raw = self._players(f, visible)
        return MatchStats(
            match=self.match,
            kind=self.kind,
            dt=self.dt,
            frames=self.frames,
            frame=f,
            t=round(f * self.dt, 2),
            definitions=Definitions(),
            players=players,
            teams=self._teams(players, raw, visible),
            cues=visible,
            tracks=self._tracks(f) if tracks else None,
        )

    def _players(self, f: int, cues: Sequence[Cue]) -> tuple[list[PlayerTotals], list[float]]:
        rows: list[PlayerTotals] = []
        raw: list[float] = []
        for j, info in enumerate(self.players):
            pid = info["id"]
            passes = [c for c in cues if c.kind == "pass" and c.player == pid]
            shots = [c for c in cues if c.kind == "shot" and c.player == pid]
            sprints = [c for c in cues if c.kind == "sprint" and c.player == pid]
            dist = float(self.distance[f, j])
            raw.append(dist)
            done = sum(c.outcome == "complete" for c in passes if isinstance(c, PassCue))
            rows.append(
                PlayerTotals(
                    id=pid,
                    team=int(info["team"]),
                    number=int(info["number"]),
                    role=str(info["role"]),
                    name=full_name(pid),
                    short=short_name(pid),
                    distance_m=_r1(dist),
                    hsr_m=_r1(self.hsr[f, j]),
                    sprint_m=_r1(self.sprint[f, j]),
                    top_kmh=_kmh(self.speed[: f + 1, j].max()),
                    sprints=len(sprints),
                    passes=len(passes),
                    completed=done,
                    accuracy=None if not passes else round(done / len(passes), 4),
                    mean_difficulty=None
                    if not passes
                    else round(float(np.mean([c.difficulty for c in passes])), 2),
                    shots=len(shots),
                    top_shot_kmh=None if not shots else max(c.speed_kmh for c in shots),
                )
            )
        return rows, raw

    def _teams(
        self, players: list[PlayerTotals], raw: list[float], cues: Sequence[Cue]
    ) -> list[TeamTotals]:
        teams: list[TeamTotals] = []
        for side in (0, 1):
            idx = [j for j, p in enumerate(players) if p.team == side]
            ids = {players[j].id for j in idx}
            passes = [c for c in cues if c.kind == "pass" and c.player in ids]
            shots = [c for c in cues if c.kind == "shot" and c.player in ids]
            done = sum(c.outcome == "complete" for c in passes if isinstance(c, PassCue))
            teams.append(
                TeamTotals(
                    team=side,
                    distance_m=_r1(sum(raw[j] for j in idx)),
                    passes=len(passes),
                    completed=done,
                    accuracy=None if not passes else round(done / len(passes), 4),
                    mean_difficulty=None
                    if not passes
                    else round(float(np.mean([c.difficulty for c in passes])), 2),
                    shots=len(shots),
                    top_shot_kmh=None if not shots else max(c.speed_kmh for c in shots),
                    top_kmh=max((players[j].top_kmh for j in idx), default=0.0),
                )
            )
        return teams

    def _tracks(self, f: int) -> Tracks:
        checkpoints = list(range(0, f + 1, 25))
        idx = np.asarray(checkpoints)

        def dm(values: np.ndarray) -> list[list[int]]:
            return np.rint(values[idx] * 10).astype(int).tolist()

        top = [np.rint(self.speed[: c + 1].max(axis=0) * 36).astype(int).tolist() for c in idx]
        return Tracks(
            distance_dm=dm(self.distance),
            hsr_dm=dm(self.hsr),
            sprint_dm=dm(self.sprint),
            top_kmh10=top,
            ball_kmh10=np.rint(self.ball_speed[: f + 1] * 36).astype(int).tolist(),
            speed=self._speed_runs(f),
        )

    def _speed_runs(self, f: int) -> list[SpeedRun]:
        runs: list[SpeedRun] = []
        limit = f + 1
        for j, pid in enumerate(self.ids):
            above = self.speed[:limit, j] > HSR_MPS
            start: int | None = None
            for i in range(limit):
                boundary = i > 0 and int(self.seg[i]) == i
                if start is not None and (not above[i] or boundary):
                    runs.append(self._one_run(pid, j, start, i))
                    start = None
                if above[i] and start is None:
                    start = i
            if start is not None:
                runs.append(self._one_run(pid, j, start, limit))
        runs.sort(key=lambda r: (r.start, self.ids.index(r.player)))
        return runs

    def _one_run(self, pid: str, j: int, start: int, end: int) -> SpeedRun:
        column = self.speed[start:end, j]
        sprint: list[tuple[int, int]] = []
        opened: int | None = None
        for i in range(start, end):
            if self.speed[i, j] > SPRINT_MPS:
                if opened is None:
                    opened = i
            elif opened is not None:
                sprint.append((opened, i))
                opened = None
        if opened is not None:
            sprint.append((opened, end))
        return SpeedRun(
            player=pid, start=start, kmh10=_ints(np.rint(column * 36).astype(int)), sprint=sprint
        )


def _possession(kind: str, starts: np.ndarray, anchor: int) -> int | None:
    if kind != "match":
        return None
    return int(np.searchsorted(starts, anchor, side="right") - 1)


def _t(frame: int, dt: float) -> float:
    return round(frame * dt, 2)


def _crossed(kick: int, frame: int, breaks: Sequence[int]) -> bool:
    return any(kick < b <= frame for b in breaks)


def _pass_cues(
    events: list[dict[str, Any]],
    *,
    pos: np.ndarray,
    vel: np.ndarray,
    ball: np.ndarray,
    team: np.ndarray,
    ids: list[str],
    breaks: Sequence[int],
    kind: str,
    starts: np.ndarray,
    dt: float,
) -> list[PassCue]:
    index = {pid: i for i, pid in enumerate(ids)}

    def _key(event: dict[str, Any]) -> tuple[int, int, str]:
        return (int(event["frame"]), 0 if event["type"] in _PASS_END else 1, event["id"])

    ordered = sorted(events, key=_key)
    in_flight: dict[str, Any] | None = None
    cues: list[PassCue] = []
    for event in ordered:
        frame = int(event["frame"])
        if in_flight is not None and _crossed(int(in_flight["frame"]), frame, breaks):
            in_flight = None
        if event["type"] in _KICKS:
            in_flight = event
            continue
        if event["type"] not in _PASS_END or in_flight is None or in_flight["type"] != "pass":
            if event["type"] in _PASS_END:
                in_flight = None
            continue
        cues.append(_one_pass(in_flight, event, pos, vel, ball, team, index, kind, starts, dt))
        in_flight = None
    return cues


def _one_pass(
    kick: dict[str, Any],
    resolution: dict[str, Any],
    pos: np.ndarray,
    vel: np.ndarray,
    ball: np.ndarray,
    team: np.ndarray,
    index: dict[str, int],
    kind: str,
    starts: np.ndarray,
    dt: float,
) -> PassCue:
    k0, k1 = int(kick["frame"]), int(resolution["frame"])
    outcome = _OUTCOME[resolution["type"]]
    if outcome == "complete":
        receiver = resolution["player"]
    else:
        receiver = (kick.get("attrs") or {}).get("to")
    if receiver not in index:
        receiver = None
    passer = kick["player"]
    pj = index[passer]
    opp = np.flatnonzero(team != team[pj])
    times = dt * np.arange(k1 - k0 + 1)
    lane = float(lane_risk(pos[k0, opp], vel[k0, opp], ball[k0 : k1 + 1], times))
    passer_p = float(frame_pressing(pos[k0], vel[k0], team, ball[k0], pj).on_carrier)
    if receiver is None:
        receiver_p = 0.0
    else:
        r = index[receiver]
        column = frame_pressing(
            pos[k1], vel[k1], team, ball[k1], -1, pressed_team=int(team[r])
        ).column(r)
        receiver_p = float(aggregate(column))
    dist = pass_length(ball, k0, k1)
    value, parts = pass_difficulty(lane, passer_p, receiver_p, dist)
    difficulty = round(value, 2)
    return PassCue(
        id=kick["id"],
        frame=k1,
        t=_t(k1, dt),
        possession=_possession(kind, starts, k0),
        kick=k0,
        player=passer,
        receiver=receiver,
        outcome=outcome,  # type: ignore[arg-type]
        distance_m=display(dist, 0),  # whole metres, as every view shows a pass's length
        ball_kmh=_kmh(release_speed(ball, k0, k1, dt)),
        difficulty=difficulty,
        band=difficulty_band(difficulty),
        components=Parts(**{name: round(part, 2) for name, part in parts.items()}),
    )


def _shot_cues(
    events: list[dict[str, Any]],
    *,
    ball: np.ndarray,
    breaks: Sequence[int],
    kind: str,
    starts: np.ndarray,
    dt: float,
    frames: int,
) -> list[ShotCue]:
    cues: list[ShotCue] = []
    for event in events:
        if event["type"] != "shot":
            continue
        found = shot_release(ball, int(event["frame"]), events, breaks, frames, dt)
        if found is None:
            continue
        speed, cue_frame = found
        k0 = int(event["frame"])
        cues.append(
            ShotCue(
                id=event["id"],
                frame=cue_frame,
                t=_t(cue_frame, dt),
                possession=_possession(kind, starts, k0),
                kick=k0,
                player=event["player"],
                speed_kmh=_kmh(speed),
            )
        )
    return cues


def shot_release(
    ball: np.ndarray,
    k0: int,
    events: list[dict[str, Any]],
    breaks: Sequence[int],
    frames: int,
    dt: float,
) -> tuple[float, int] | None:
    """(release speed in m/s, cue frame) of the shot struck at `k0`, once final, else None: the
    ball's mean speed over its release window (`_shot_window`). The one definition of shot speed:
    the SHOT chip, the shot log and the claim measure it so. `ball`: (F, 2), `feed_track`."""
    found = _shot_window(k0, events, breaks, frames)
    if found is None:
        return None
    rel, cue_frame = found
    return float(np.linalg.norm(ball[rel] - ball[k0])) / ((rel - k0) * dt), cue_frame


def _shot_window(
    k0: int, events: list[dict[str, Any]], breaks: Sequence[int], frames: int
) -> tuple[int, int] | None:
    """(release frame, cue frame) once the release speed is final, else None.

    The release window is the RELEASE_FRAMES after the strike. It ends early at a resolution
    (the cue is that frame) or at a possession cut (the last frame before it; the cue is the
    cut's frame, when the cut is known). Otherwise it is final, and cued, at its last frame. Only
    frames already received count: a cut or a resolution beyond them has not happened yet.
    """
    window = k0 + RELEASE_FRAMES
    resolution = min(
        (int(e["frame"]) for e in events
         if e["type"] in _SHOT_END and k0 < int(e["frame"]) < min(window, frames)),
        default=None,
    )  # fmt: skip
    cut = min((b for b in breaks if k0 < b <= window and b < frames), default=None)
    if cut is not None and (resolution is None or cut <= resolution):
        return (cut - 1, cut) if cut - 1 > k0 else None
    if resolution is not None:
        return resolution, resolution
    return (window, window) if window <= frames - 1 else None


def _sprint_cues(
    speed: np.ndarray,
    distance: np.ndarray,
    *,
    ids: list[str],
    breaks: Sequence[int],
    kind: str,
    starts: np.ndarray,
    dt: float,
    frames: int,
) -> list[SprintCue]:
    cues: list[SprintCue] = []
    for j, pid in enumerate(ids):
        for start, end in runs_above(speed[:, j], SPRINT_MPS, SPRINT_MIN_FRAMES, breaks):
            if end >= frames:  # still on as the data ends: not final
                continue
            peak = start + int(np.argmax(speed[start:end, j]))
            before = float(distance[start - 1, j]) if start else 0.0
            cues.append(
                SprintCue(
                    id=f"sprint:{pid}:{start:04d}",
                    frame=end,
                    t=_t(end, dt),
                    possession=_possession(kind, starts, start),
                    player=pid,
                    start=start,
                    end=end,
                    peak_frame=peak,
                    peak_kmh=_kmh(speed[peak, j]),
                    distance_m=_r1(float(distance[end - 1, j]) - before),
                )
            )
    return cues


def _distance_cues(
    distance: np.ndarray,
    *,
    ids: list[str],
    kind: str,
    starts: np.ndarray,
    dt: float,
) -> list[DistanceCue]:
    cues: list[DistanceCue] = []
    for j, pid in enumerate(ids):
        for frame, metres in milestones(distance[:, j], DISTANCE_STEP_M):
            cues.append(
                DistanceCue(
                    id=f"distance:{pid}:{metres}",
                    frame=frame,
                    t=_t(frame, dt),
                    possession=_possession(kind, starts, frame),
                    player=pid,
                    metres=metres,
                )
            )
    return cues


def compute_stats(export: dict[str, Any], match_id: str) -> StatsTimeline:
    """The timeline of one export. Only the live-stream keys are read."""
    dt = float(export["dt"])
    players = list(export["players"])
    kind: Literal["hero", "match"] = "match" if export.get("kind", "hero") == "match" else "hero"
    run = export["runs"]["factual"]
    frames = int(run["frames"])
    ids = [p["id"] for p in players]
    team = np.asarray([int(p["team"]) for p in players], dtype=int)
    pos = np.asarray(run["pos"], dtype=np.float64).reshape(-1, len(ids), 2)[:frames] / 1000.0
    ball = np.asarray(run["ball"], dtype=np.float64).reshape(-1, 2)[:frames] / 1000.0
    frames = int(pos.shape[0])
    events = [e for e in run["events"] if int(e["frame"]) < frames]
    starts_list = (
        [int(p["start"]) for p in export["match"]["possessions"]] if kind == "match" else []
    )
    starts = np.asarray(starts_list, dtype=int)
    breaks = starts_list
    seg = segment_starts(frames, breaks)
    vel = smoothed_velocity(pos, dt, breaks)
    speed = np.linalg.norm(vel, axis=-1)
    distance = cumulative_distance(pos, breaks)
    shared = {"kind": kind, "starts": starts, "dt": dt}
    cues: list[Cue] = []
    cues += _pass_cues(
        events, pos=pos, vel=vel, ball=ball, team=team, ids=ids, breaks=breaks, **shared
    )
    cues += _shot_cues(events, ball=ball, breaks=breaks, frames=frames, **shared)
    cues += _sprint_cues(speed, distance, ids=ids, breaks=breaks, frames=frames, **shared)
    cues += _distance_cues(distance, ids=ids, **shared)
    cues.sort(key=lambda c: (c.frame, _KIND_ORDER[c.kind], c.id))
    return StatsTimeline(
        match=match_id,
        export=export,
        kind=kind,
        dt=dt,
        frames=frames,
        ids=ids,
        players=players,
        team=team,
        breaks=breaks,
        seg=seg,
        speed=speed,
        ball_speed=smoothed_speed(ball, dt, breaks),
        vel=vel,
        distance=distance,
        hsr=cumulative_distance(pos, breaks, speed > HSR_MPS),
        sprint=cumulative_distance(pos, breaks, speed > SPRINT_MPS),
        cues=cues,
    )


def _mm(values: np.ndarray) -> list:
    """Integer millimetres, as sim/export.py `_mm`."""
    scaled = np.rint(np.asarray(values) * 1000).astype(np.int64)
    return scaled.reshape(len(scaled), -1).tolist()


def stats_from_run(run: Any, match_id: str, starts: Sequence[int] | None = None) -> StatsTimeline:
    """The same timeline `compute_stats` builds, from a sim run's tracking and events. With
    `starts` (each possession's first frame) the run is a stitched match on one clock
    (`explain.recap.stitched_run`), as `sim.export.export_match` streams it."""
    from sim.run import _plain

    export: dict[str, Any] = {
        "dt": run.dt,
        "players": [
            {"id": p.id, "team": p.team, "role": p.role, "number": p.number} for p in run.players
        ],
        "runs": {
            "factual": {
                "frames": len(run.owner),
                "pos": _mm(run.pos),
                "ball": _mm(run.ball_pos[:, :2]),
                "owner": run.owner.tolist(),
                "events": [
                    {
                        "id": e.id,
                        "type": e.type,
                        "frame": e.frame,
                        "player": e.player,
                        "attrs": _plain(e.attrs),
                    }
                    for e in run.events
                ],
            }
        },
    }
    if starts is not None:
        export["kind"] = "match"
        export["match"] = {"possessions": [{"start": int(b)} for b in starts]}
    return compute_stats(export, match_id)


def stats_for(scenario: str, seed: int) -> StatsTimeline:
    from sim.export import export_hero

    return compute_stats(export_hero(scenario, seed), f"{scenario}-{seed}")


def stats_for_match(seed: int) -> StatsTimeline:
    from sim.export import export_match

    return compute_stats(export_match(seed), f"match-{seed}")


def web_fixture(timeline: StatsTimeline) -> str:
    """JSON the viewer's parity test reads: the full tracks plus snapshots at fixed frames."""
    body = {
        "stats": timeline.snapshot(tracks=True).model_dump(mode="json"),
        "snapshots": {str(f): timeline.snapshot(f).model_dump(mode="json") for f in FIXTURE_FRAMES},
    }
    return json.dumps(body, indent=1) + "\n"


def _print_table(snap: MatchStats) -> None:
    print(f"{snap.match}  t={snap.t:.2f}s  frame {snap.frame}")
    print(f"{'id':<6}{'name':<22}{'m':>10}{'km/h':>8}{'sprints':>8}{'passes':>12}{'acc':>8}")
    for p in snap.players:
        acc = "n/a" if p.accuracy is None else f"{p.accuracy * 100:.1f}%"
        passes = f"{p.completed}/{p.passes}"
        print(
            f"{p.id:<6}{p.name:<22}{p.distance_m:10.1f}{p.top_kmh:8.1f}"
            f"{p.sprints:8d}{passes:>12}{acc:>8}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Live match stats from a synthetic match (SPEC 4.6)"
    )
    parser.add_argument("--match", type=int, default=None, help="stitched-match seed")
    parser.add_argument("--scenario", default=None)
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--out", type=argparse.FileType("w"), default=None)
    parser.add_argument("--web-fixture", default=None)
    args = parser.parse_args()
    if args.match is not None:
        timeline = stats_for_match(args.match)
    elif args.scenario:
        timeline = stats_for(args.scenario, args.seed)
    else:
        parser.error("pass --match SEED or --scenario NAME --seed N")
    if args.web_fixture:
        from pathlib import Path

        path = Path(args.web_fixture)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(web_fixture(timeline))
    snap = timeline.snapshot(tracks=True)
    if args.out is not None:
        args.out.write(snap.model_dump_json())
        return
    _print_table(snap)


if __name__ == "__main__":
    main()
