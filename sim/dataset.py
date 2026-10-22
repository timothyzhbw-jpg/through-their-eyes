"""A downloadable dataset of stitched synthetic matches (SPEC 3.1; datasheet: docs/DATASET.md).

    uv run python -m sim.dataset --matches 10 --out out/dataset/

N stitched matches from fixed match seeds (SPEC 3.7, seed registry: 5001 onwards). Each match
plays `PLAN`: 15 open-play passages to fixed caps and the four heroes on main, each hero with a
fresh seed keyed by (match seed, plan position), so no possession repeats across matches and none
is a design, eval or demo seed. Written to `--out`, in open formats:

- `metadata.json`: teams, the fictional players and their sim parameters, every match's
  possessions, restarts and score, the units;
- `events.csv` / `.parquet`: the sim's events in match time (passes, receptions, interceptions,
  tackles, possession changes, shots, dives, saves, goals, out of play, scans, head turns), plus
  each possession's restart (from the stitch) and heavy-pressure spells (derived: SPEC 4.3
  pressing intensity on the carrier from tracking, the lexicon's threshold);
- `tracking.parquet` and `ball.parquet`: 25 Hz, positions, velocities, body and head yaw;
- `receptions.csv` / `.parquet` and `beliefs.parquet`: at every reception, the receiver's scans
  in the 10 s before it and his belief about every other player against the truth;
- `decisions.csv` / `.parquet`: every option a ball carrier weighed on his belief (heroes only;
  open-play passing is a rule, not a decision);
- `manifest.json` (sizes, row counts, SHA-256), and the datasheet as `DATASHEET.md`.

Everything is recorded by the sim or read off its state, except the rows marked `derived`. The
same seeds give byte-identical files and archive on the same platform (SPEC 3.7). Also writes a
deterministic tar.gz (`--archive`), and with `--sample DIR` one possession of the first match as a
small sample in the same formats.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import platform
import shutil
import tarfile
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from analytics.pressing import frame_pressing
from analytics.vision import player_visibility
from explain.lexicon import TERMS
from sim.config import DT, FPS, HALF_LENGTH, HALF_WIDTH, SimParams
from sim.export import _match_event
from sim.match import SEED_BASE, Possession, PossessionSpec, StitchedMatch, build_match
from sim.perception import BeliefStore
from sim.rng import KeyedRng
from sim.roster import club_name, full_name
from sim.run import MatchRun, _plain

VERSION = 1
NAME = "through-their-eyes-synthetic-matches"
ARCHIVE_ROOT = f"{NAME}-v{VERSION}"
DATASHEET = Path(__file__).resolve().parents[1] / "docs" / "DATASET.md"

FIRST_SEED = 5001  # SPEC 3.7 seed registry: 5001-5100 are the dataset's match seeds
MAX_MATCHES = 100
OPEN_PLAY = "possession_play"
# match-1's layout with the shot hero: open-play caps (s) and the heroes, in order.
LAYOUT: tuple[float | str, ...] = (
    30.0, "blind_side_run", 50.0, 65.0, 40.0, 60.0, 55.0, "press_escape", 45.0, 70.0, 50.0,
    "far_post_finish", 60.0, 40.0, "corner_blind_side", 55.0, 65.0, 45.0, 50.0,
)  # fmt: skip

SCAN_WINDOW_S = 10.0  # scans before a reception, as eval/realism.py counts them (Jordet 2013)
HEAVY_PRESSURE = TERMS["under heavy pressure"].threshold  # pressing intensity, SPEC 4.3


def match_seeds(n: int) -> list[int]:
    if not 1 <= n <= MAX_MATCHES:
        raise ValueError(f"the seed registry reserves {MAX_MATCHES} match seeds, not {n}")
    return list(range(FIRST_SEED, FIRST_SEED + n))


def hero_seed(match_seed: int, k: int) -> int:
    """A fresh seed for the hero at plan position k, keyed by (match seed, k)."""
    gen = KeyedRng(match_seed).generator("dataset_hero", k)
    return SEED_BASE + int(gen.integers(0, 2**31 - SEED_BASE))


def dataset_plan(match_seed: int) -> tuple[PossessionSpec, ...]:
    """`LAYOUT` with fresh hero seeds; open-play seeds are keyed by `build_match` itself."""
    return tuple(
        PossessionSpec(OPEN_PLAY, max_s=x)
        if isinstance(x, float)
        else PossessionSpec(x, hero_seed(match_seed, k))
        for k, x in enumerate(LAYOUT)
    )


# --- the schema --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Column:
    name: str
    type: pa.DataType
    unit: str  # "" when it has none
    doc: str
    nullable: bool = False


def _c(name: str, type: pa.DataType, unit: str, doc: str, nullable: bool = False) -> Column:
    return Column(name, type, unit, doc, nullable)


I32, I8, F64, F32 = pa.int32(), pa.int8(), pa.float64(), pa.float32()
STR, BOOL = pa.string(), pa.bool_()
MATCH = _c("match_id", I32, "", "match seed; joins metadata.json matches[].match_id")
FRAME = _c("frame", I32, "frame", "match frame at 25 Hz, from 0 at the kick-off")
POSSESSION = _c("possession", I32, "", "index of the stitched possession in its match")

TABLES: dict[str, tuple[Column, ...]] = {
    "events": (
        MATCH,
        _c("event_id", STR, "", "<type>:<player>:<frame>, unique within a match"),
        _c("type", STR, "", "event type (datasheet: event types)"),
        _c("source", STR, "", "sim: emitted by the engine; stitch: a restart; derived: analytics"),
        POSSESSION,
        FRAME,
        _c("t", F64, "s", "frame / 25"),
        _c("player", STR, "", "player id; the actor (pressure: the main presser)"),
        _c("team", I8, "", "the player's team: 0 home, 1 away"),
        _c("x", F64, "m", "where it happened (datasheet: per type)", True),
        _c("y", F64, "m", "where it happened (datasheet: per type)", True),
        _c(
            "end_frame",
            I32,
            "frame",
            "pass/shot resolved, scan/head turn over, pressure ended",
            True,
        ),
        _c("end_x", F64, "m", "ball position when a pass or shot was resolved", True),
        _c("end_y", F64, "m", "ball position when a pass or shot was resolved", True),
        _c(
            "outcome",
            STR,
            "",
            "pass: complete/intercepted/out; shot: goal/saved/wide/blocked",
            True,
        ),
        _c("recipient", STR, "", "pass: the teammate it was played to", True),
        _c("receiver", STR, "", "pass: who controlled it (teammate or interceptor)", True),
        _c("attrs", STR, "", "every attribute the sim recorded, as JSON (match frames)"),
    ),  # fmt: skip
    "tracking": (
        MATCH,
        FRAME,
        POSSESSION,
        _c("player", STR, "", "player id"),
        _c("team", I8, "", "0 home, 1 away"),
        _c("x", F32, "m", "position, origin at the centre spot, home attacks +x"),
        _c("y", F32, "m", "position, +y to the home team's left"),
        _c("vx", F32, "m/s", "velocity"),
        _c("vy", F32, "m/s", "velocity"),
        _c("body_yaw", F32, "rad", "body orientation, counter-clockwise from +x, in [-pi, pi]"),
        _c("head_yaw", F32, "rad", "head orientation as tracked (with 2 deg sensor noise)"),
        _c("head_yaw_true", F32, "rad", "the head orientation the player saw with"),
        _c("has_ball", BOOL, "", "he controls the ball this frame"),
    ),
    "ball": (
        MATCH,
        FRAME,
        POSSESSION,
        _c("x", F32, "m", "ball position"),
        _c("y", F32, "m", "ball position"),
        _c("z", F32, "m", "ball height (centre; on the ground = radius 0.11 m)"),
        _c("vx", F32, "m/s", "ball velocity"),
        _c("vy", F32, "m/s", "ball velocity"),
        _c("vz", F32, "m/s", "ball velocity"),
        _c("owner", STR, "", "player who controls it; null while it is free", True),
    ),
    "receptions": (
        MATCH,
        _c("event_id", STR, "", "the reception event"),
        FRAME,
        POSSESSION,
        _c("player", STR, "", "the receiver"),
        _c("team", I8, "", "0 home, 1 away"),
        _c("role", STR, "", "the receiver's role"),
        _c("scans", I32, "", "his scan onsets in the window (scan events; head turns excluded)"),
        _c("window_s", F64, "s", "10 s, less when his team's spell or the possession is younger"),
        _c("belief_error_teammates_m", F64, "m", "mean distance, believed to true, teammates"),
        _c("belief_error_opponents_m", F64, "m", "mean distance, believed to true, opponents"),
        _c("belief_error_max_m", F64, "m", "largest distance, believed to true, anyone"),
    ),
    "beliefs": (
        MATCH,
        _c("event_id", STR, "", "the reception event"),
        FRAME,
        _c("observer", STR, "", "the receiver, whose belief this is"),
        _c("target", STR, "", "the player he holds a belief about"),
        _c("believed_x", F64, "m", "where he believes the target is"),
        _c("believed_y", F64, "m", "where he believes the target is"),
        _c("true_x", F64, "m", "where the target is"),
        _c("true_y", F64, "m", "where the target is"),
        _c("error_m", F64, "m", "distance from believed to true position"),
        _c("age_s", F64, "s", "time since he last saw the target (0: in sight now)"),
    ),
    "decisions": (
        MATCH,
        FRAME,
        POSSESSION,
        _c("player", STR, "", "the ball carrier deciding"),
        _c("action", STR, "", "pass:<id>, carry, shot:near or shot:far"),
        _c("kind", STR, "", "pass, carry or shot"),
        _c("target_player", STR, "", "pass: the teammate", True),
        _c("target_x", F64, "m", "where the action aims"),
        _c("target_y", F64, "m", "where the action aims"),
        _c("p_success", F64, "", "P(success) on his belief"),
        _c("value", F64, "xT", "expected threat after the action, on his belief"),
        _c("prob", F64, "", "softmax probability of choosing it"),
        _c("noise", F64, "", "the keyed Gumbel noise of the choice (argmax value / T + noise)"),
        _c("chosen", BOOL, "", "the option he took"),
    ),
}
CSV_TABLES = ("events", "receptions", "decisions")


def schema(table: str) -> pa.Schema:
    fields = [
        pa.field(c.name, c.type, c.nullable, {"unit": c.unit, "description": c.doc})
        for c in TABLES[table]
    ]
    return pa.schema(fields, metadata={"dataset": NAME, "version": str(VERSION), "table": table})


# --- one match -----------------------------------------------------------------------------------


class BeliefReplay:
    """The sim's belief store (SPEC 3.4), rebuilt from a run's tracking: each frame, every
    player sees whoever has visibility >= the perception threshold from his true head yaw, as the
    engine's perception step does. `at(observer, frame)` is his belief after he perceives that
    frame; frames must not go back. Reproduces every `Decision`'s belief error exactly
    (tests/test_dataset.py)."""

    def __init__(self, run: MatchRun, params: SimParams = SimParams()) -> None:
        self.run, self.params = run, params
        self.store = BeliefStore(len(run.players), 0, run.pos[0], run.vel[0])
        self.next = 0

    def at(self, observer: int, frame: int) -> tuple[np.ndarray, np.ndarray]:
        run, p = self.run, self.params
        if frame < self.next - 1:
            raise ValueError(f"frame {frame} is before the replay's frame {self.next - 1}")
        while self.next <= frame:
            f = self.next
            speed = np.linalg.norm(run.vel[f], axis=-1)
            seen = player_visibility(run.pos[f], run.head_yaw[f], speed) >= p.perception_threshold
            self.store.update(seen, f, run.pos[f], run.vel[f])
            self.next += 1
        pos, _, age = self.store.estimate(observer, frame, run.dt, p.belief_horizon_s)
        return pos, age


def _m(x: Any) -> float:
    return round(float(x), 3)


def _xy(attrs: dict, key: str) -> tuple[float | None, float | None]:
    v = attrs.get(key)
    return (None, None) if v is None else (_m(v[0]), _m(v[1]))


LOCATION = {"pass": "start", "shot": "start", "reception": "at", "interception": "at",
            "tackle": "at", "out": "at", "goal": "at", "save": "at", "offside": "at",
            "post": "at"}  # fmt: skip


def _event_row(match_id: int, e, p: Possession) -> dict[str, Any]:
    lifted = _match_event(e, p)
    attrs = lifted["attrs"]
    x, y = _xy(attrs, LOCATION.get(e.type, ""))
    end_x, end_y = _xy(attrs, "end_at")
    has_end = e.type in ("pass", "shot", "scan", "head_turn")
    return {
        "match_id": match_id,
        "event_id": lifted["id"],
        "type": e.type,
        "source": "sim",
        "possession": p.index,
        "frame": lifted["frame"],
        "t": round(lifted["frame"] * DT, 2),
        "player": e.player,
        "team": e.team,
        "x": x,
        "y": y,
        "end_frame": attrs.get("end") if has_end else None,
        "end_x": end_x,
        "end_y": end_y,
        "outcome": attrs.get("outcome"),
        "recipient": attrs.get("to") if e.type == "pass" else None,
        "receiver": attrs.get("receiver") if e.type == "pass" else None,
        "attrs": json.dumps(attrs, sort_keys=True),
    }


def _row(
    match_id: int, etype: str, source: str, p: Possession, frame: int, player: str, team: int,
    x: float, y: float, attrs: dict, end_frame: int | None = None,
) -> dict[str, Any]:  # fmt: skip
    """An event that is not the sim's (a restart, a pressure spell); `frame` is local."""
    f = frame + p.start
    return {
        "match_id": match_id, "event_id": f"{etype}:{player}:{f:04d}", "type": etype,
        "source": source, "possession": p.index, "frame": f, "t": round(f * DT, 2),
        "player": player, "team": team, "x": _m(x), "y": _m(y),
        "end_frame": None if end_frame is None else end_frame + p.start, "end_x": None,
        "end_y": None, "outcome": None, "recipient": None, "receiver": None,
        "attrs": json.dumps(_plain(attrs), sort_keys=True),
    }  # fmt: skip


def _restart(match_id: int, p: Possession) -> dict[str, Any]:
    """How the possession began (SPEC 3.1): the stitch's label, its first carrier and the ball."""
    run, i = p.run, int(p.run.owner[0])
    ball = run.ball_pos[0]
    attrs = {"kind": p.restart, "scenario": p.scenario}
    return _row(match_id, "restart", "stitch", p, 0, run.ids[i], run.players[i].team,
                ball[0], ball[1], attrs)  # fmt: skip


def pressure_spells(run: MatchRun) -> list[tuple[int, int, int, int, float, int]]:
    """Heavy-pressure spells on the ball carrier: runs of frames with one carrier and pressing
    intensity on him (SPEC 4.3, as explain's `pressing_intensity` reads it) >= HEAVY_PRESSURE.
    Each is (start, end inclusive, carrier, main presser at the peak, peak, peak frame)."""
    team = np.array([p.team for p in run.players])
    spells: list[tuple[int, int, int, int, float, int]] = []
    current: list | None = None
    for f in range(len(run.owner)):
        carrier = int(run.owner[f])
        level, presser = 0.0, -1
        if carrier >= 0:
            pf = frame_pressing(run.pos[f], run.vel[f], team, run.ball_pos[f], carrier)
            level = pf.on_carrier
            presser = int(pf.defenders[int(np.argmax(pf.column(carrier)))])
        heavy = carrier >= 0 and level >= HEAVY_PRESSURE
        if current is not None and (not heavy or carrier != current[2]):
            spells.append(tuple(current))
            current = None
        if heavy:
            if current is None:
                current = [f, f, carrier, presser, level, f]
            current[1] = f
            if level > current[4]:
                current[3], current[4], current[5] = presser, level, f
    if current is not None:
        spells.append(tuple(current))
    return spells


def _pressure(match_id: int, p: Possession) -> list[dict[str, Any]]:
    run, rows = p.run, []
    for start, end, carrier, presser, peak, peak_frame in pressure_spells(run):
        x, y = run.pos[start, carrier]
        attrs = {"carrier": run.ids[carrier], "peak": peak, "peak_frame": peak_frame + p.start,
                 "threshold": HEAVY_PRESSURE}  # fmt: skip
        rows.append(_row(match_id, "pressure", "derived", p, start, run.ids[presser],
                         run.players[presser].team, x, y, attrs, end_frame=end))  # fmt: skip
    return rows


def _spell_start(owner_team: np.ndarray, frame: int, team: int) -> int:
    """First frame of the spell in which `team` has had the ball up to `frame`; a free ball
    belongs to the team that last had it (as eval/realism.py's `possession_start`)."""
    carried = owner_team.copy()
    for f in range(1, len(carried)):
        if carried[f] < 0:
            carried[f] = carried[f - 1]
    f = frame
    while f > 0 and carried[f - 1] == team:
        f -= 1
    return f


def _perception(match_id: int, p: Possession) -> tuple[list[dict], list[dict]]:
    """Per reception: his scans in the window before it, and his belief at it."""
    run = p.run
    team = np.array([pl.team for pl in run.players])
    owner_team = np.where(run.owner >= 0, team[np.maximum(run.owner, 0)], -1)
    onsets: dict[str, list[int]] = {}
    for e in run.events:
        if e.type == "scan":
            onsets.setdefault(e.player, []).append(e.frame)
    replay = BeliefReplay(run)
    receptions, beliefs = [], []
    for e in sorted(run.events, key=lambda e: (e.frame, e.id)):
        if e.type != "reception":
            continue
        i, f = run.index(e.player), e.frame
        start = max(f - round(SCAN_WINDOW_S / DT), _spell_start(owner_team, f, team[i]))
        pos, age = replay.at(i, f)
        error = np.linalg.norm(pos - run.pos[f], axis=-1)
        others = np.arange(len(run.players)) != i
        mates, opps = others & (team == team[i]), team != team[i]
        event_id = _match_event(e, p)["id"]
        receptions.append({
            "match_id": match_id, "event_id": event_id, "frame": f + p.start,
            "possession": p.index, "player": e.player, "team": e.team,
            "role": run.players[i].role,
            "scans": sum(start <= s < f for s in onsets.get(e.player, [])),
            "window_s": round((f - start) * DT, 2),
            "belief_error_teammates_m": _m(error[mates].mean()),
            "belief_error_opponents_m": _m(error[opps].mean()),
            "belief_error_max_m": _m(error[others].max()),
        })  # fmt: skip
        for j in np.flatnonzero(others):
            beliefs.append({
                "match_id": match_id, "event_id": event_id, "frame": f + p.start,
                "observer": e.player, "target": run.ids[j],
                "believed_x": _m(pos[j, 0]), "believed_y": _m(pos[j, 1]),
                "true_x": _m(run.pos[f, j, 0]), "true_y": _m(run.pos[f, j, 1]),
                "error_m": _m(error[j]), "age_s": round(float(age[j]), 2),
            })  # fmt: skip
    return receptions, beliefs


def _decisions(match_id: int, p: Possession) -> list[dict[str, Any]]:
    rows = []
    for d in p.run.decisions:
        for o in d.options:
            rows.append({
                "match_id": match_id, "frame": d.frame + p.start, "possession": p.index,
                "player": d.player, "action": o.action, "kind": o.kind,
                "target_player": o.target_player, "target_x": _m(o.target[0]),
                "target_y": _m(o.target[1]), "p_success": round(float(o.p_success), 4),
                "value": round(float(o.value), 4), "prob": round(float(o.prob), 4),
                "noise": round(float(d.noise[o.action]), 4), "chosen": o.action == d.chosen,
            })  # fmt: skip
    return rows


def _q(a: np.ndarray, scale: float) -> np.ndarray:
    """Quantised as SPEC 3.7 serialises (1 mm, 1 mm/s, 1e-4 rad), stored as float32."""
    return (np.rint(np.asarray(a, dtype=float) * scale) / scale).astype(np.float32)


def _tracking(match_id: int, m: StitchedMatch) -> tuple[pa.Table, pa.Table]:
    ids = [pl.id for pl in m.players]
    n = len(ids)
    cols: dict[str, list[np.ndarray]] = {}

    def add(name: str, values: np.ndarray) -> None:
        cols.setdefault(name, []).append(values)

    for p in m.possessions:
        run, frames = p.run, p.frames
        f = np.arange(p.start, p.end, dtype=np.int32)
        add("frame", np.repeat(f, n))
        add("possession", np.full(frames * n, p.index, dtype=np.int32))
        add("x", _q(run.pos[..., 0], 1e3).ravel())
        add("y", _q(run.pos[..., 1], 1e3).ravel())
        add("vx", _q(run.vel[..., 0], 1e3).ravel())
        add("vy", _q(run.vel[..., 1], 1e3).ravel())
        add("body_yaw", _q(run.body_yaw, 1e4).ravel())
        add("head_yaw", _q(run.head_yaw_observed, 1e4).ravel())
        add("head_yaw_true", _q(run.head_yaw, 1e4).ravel())
        add("has_ball", (run.owner[:, None] == np.arange(n)[None, :]).ravel())
        add("ball_frame", f)
        add("ball_possession", np.full(frames, p.index, dtype=np.int32))
        for k, name in enumerate(("bx", "by", "bz")):
            add(name, _q(run.ball_pos[:, k], 1e3))
        for k, name in enumerate(("bvx", "bvy", "bvz")):
            add(name, _q(run.ball_vel[:, k], 1e3))
        add("owner", run.owner)
    c = {k: np.concatenate(v) for k, v in cols.items()}
    rows = len(c["frame"])
    tracking = pa.table(
        {
            "match_id": np.full(rows, match_id, dtype=np.int32),
            "frame": c["frame"],
            "possession": c["possession"],
            "player": pa.array(np.tile(ids, rows // n)),
            "team": np.tile(np.array([pl.team for pl in m.players], dtype=np.int8), rows // n),
            **{k: c[k] for k in ("x", "y", "vx", "vy", "body_yaw", "head_yaw", "head_yaw_true")},
            "has_ball": c["has_ball"],
        },
        schema=schema("tracking"),
    )
    owner = [None if o < 0 else ids[o] for o in c["owner"].tolist()]
    ball = pa.table(
        {
            "match_id": np.full(len(owner), match_id, dtype=np.int32),
            "frame": c["ball_frame"],
            "possession": c["ball_possession"],
            "x": c["bx"],
            "y": c["by"],
            "z": c["bz"],
            "vx": c["bvx"],
            "vy": c["bvy"],
            "vz": c["bvz"],
            "owner": pa.array(owner, type=pa.string()),
        },  # fmt: skip
        schema=schema("ball"),
    )
    return tracking, ball


def match_entry(match_id: int, m: StitchedMatch) -> dict[str, Any]:
    """The match in metadata.json."""
    home, away = m.score
    return {
        "match_id": match_id,
        "frames": m.frames,
        "duration_s": round(m.duration_s, 2),
        "score": {"home": home, "away": away},
        "possessions": [
            {
                "index": p.index,
                "scenario": p.scenario,
                "seed": p.seed,
                "start_frame": p.start,
                "frames": p.frames,
                "restart": p.restart,
                "first_team": p.run.players[int(p.run.owner[0])].team,
                "score_before": {"home": p.score_before[0], "away": p.score_before[1]},
                "hero": p.run.hero,
            }
            for p in m.possessions
        ],
    }


def build_tables(match_id: int, m: StitchedMatch) -> dict[str, Any]:
    """Every table of one match, plus its metadata entry and players."""
    events, receptions, beliefs, decisions = [], [], [], []
    for p in m.possessions:
        events.append(_restart(match_id, p))
        events += [_event_row(match_id, e, p) for e in p.run.events]
        events += _pressure(match_id, p)
        r, b = _perception(match_id, p)
        receptions += r
        beliefs += b
        decisions += _decisions(match_id, p)
    events.sort(key=lambda e: (e["frame"], e["event_id"]))
    tracking, ball = _tracking(match_id, m)
    rows = {"events": events, "receptions": receptions, "beliefs": beliefs,
            "decisions": decisions}  # fmt: skip
    tables = {k: pa.Table.from_pylist(v, schema=schema(k)) for k, v in rows.items()}
    return {
        "tables": tables | {"tracking": tracking, "ball": ball},
        "match": match_entry(match_id, m),
        "players": m.players,
    }


def _build_one(args: tuple[int, Callable[[int], tuple[PossessionSpec, ...]]]) -> dict[str, Any]:
    seed, plan = args
    return build_tables(seed, build_match(seed, plan(seed)))


# --- writing -------------------------------------------------------------------------------------


def _csv_value(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    return repr(v) if isinstance(v, float) else str(v)


def write_csv(table: pa.Table, path: Path) -> None:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(table.column_names)
    for row in table.to_pylist():
        writer.writerow([_csv_value(v) for v in row.values()])
    path.write_text(buf.getvalue(), encoding="utf-8")


def write_parquet(table: pa.Table, path: Path) -> None:
    pq.write_table(table, path, compression="zstd", compression_level=9, use_dictionary=True,
                   write_statistics=True)  # fmt: skip


def metadata(players, matches: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "dataset": NAME,
        "version": VERSION,
        "synthetic": True,
        "note": "Generated by a simulator. Fictional teams and players; not real football data.",
        "licence": "TODO(Bowen): proposed CC BY 4.0 for the data (docs/DATASET.md)",
        "frame_rate_hz": FPS,
        "pitch": {
            "length_m": 2 * HALF_LENGTH,
            "width_m": 2 * HALF_WIDTH,
            "origin": "centre spot",
            "home_attacks": "+x",
        },  # fmt: skip
        "units": {
            "position": "m",
            "velocity": "m/s",
            "angle": "rad, counter-clockwise from +x",
            "time": "s",
            "frame": "1/25 s",
        },  # fmt: skip
        "teams": [
            {"id": 0, "name": club_name(0), "side": "home", "attacks": "+x", "fictional": True},
            {"id": 1, "name": club_name(1), "side": "away", "attacks": "-x", "fictional": True},
        ],
        "players": [
            {
                "id": pl.id,
                "team": pl.team,
                "number": pl.number,
                "role": pl.role,
                "name": full_name(pl.id),
                "v_max_mps": pl.v_max,
                "a_max_mps2": pl.a_max,
                "d_max_mps2": pl.d_max,
                "scan_rate_hz": pl.scan_rate,
                "decision_temperature": pl.temperature,
            }
            for pl in players
        ],  # fmt: skip
        "matches": matches,
    }


def _json(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def write_files(
    out: Path, tables: dict[str, pa.Table], meta: dict[str, Any], datasheet: bool = True
) -> dict[str, Any]:
    """Write every table, the metadata, the datasheet and the manifest; returns the manifest."""
    out.mkdir(parents=True, exist_ok=True)
    rows: dict[str, int] = {}
    for name, table in tables.items():
        write_parquet(table, out / f"{name}.parquet")
        rows[f"{name}.parquet"] = table.num_rows
        if name in CSV_TABLES:
            write_csv(table, out / f"{name}.csv")
            rows[f"{name}.csv"] = table.num_rows
    (out / "metadata.json").write_text(_json(meta), encoding="utf-8")
    names = [*rows, "metadata.json"]
    if datasheet:
        shutil.copyfile(DATASHEET, out / "DATASHEET.md")
        names.append("DATASHEET.md")
    files = {}
    for name in sorted(names):
        data = (out / name).read_bytes()
        files[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        if name in rows:
            files[name]["rows"] = rows[name]
    manifest = {
        "dataset": NAME,
        "version": VERSION,
        "matches": [m["match_id"] for m in meta["matches"]],
        # Byte for byte only on the same platform and library versions (SPEC 3.7).
        "generated_with": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pyarrow": pa.__version__,
            "platform": f"{platform.system()}-{platform.machine()}",
        },
        "files": files,
    }
    (out / "manifest.json").write_text(_json(manifest), encoding="utf-8")
    return manifest


def write_archive(out: Path, manifest: dict[str, Any], archive: Path) -> None:
    """A tar.gz of the manifest's files under ARCHIVE_ROOT/, the same bytes every time."""
    archive.parent.mkdir(parents=True, exist_ok=True)
    with (
        archive.open("wb") as raw,
        gzip.GzipFile("", "wb", 9, raw, mtime=0) as gz,
        tarfile.open(fileobj=gz, mode="w", format=tarfile.GNU_FORMAT) as tar,
    ):
        for name in sorted([*manifest["files"], "manifest.json"]):
            data = (out / name).read_bytes()
            info = tarfile.TarInfo(f"{ARCHIVE_ROOT}/{name}")
            info.size, info.mtime, info.mode = len(data), 0, 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            tar.addfile(info, io.BytesIO(data))


def build_dataset(
    seeds: list[int],
    out: Path,
    *,
    plan: Callable[[int], tuple[PossessionSpec, ...]] = dataset_plan,
    archive: Path | None = None,
    workers: int = 1,
) -> dict[str, Any]:
    """Build every match (in parallel with `workers`), write the files and, with `archive`, the
    tar.gz. Returns the manifest."""
    jobs = [(s, plan) for s in seeds]
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            built = list(pool.map(_build_one, jobs))
    else:
        built = [_build_one(j) for j in jobs]
    tables = {name: pa.concat_tables([b["tables"][name] for b in built]) for name in TABLES}
    meta = metadata(built[0]["players"], [b["match"] for b in built])
    manifest = write_files(out, tables, meta)
    if archive is not None:
        write_archive(out, manifest, archive)
    return manifest


SAMPLE_POSSESSION = 11  # the shot hero (`far_post_finish`): passes, a shot, the keeper, scans


def write_sample(out: Path, sample: Path, match_id: int, possession: int) -> dict[str, Any]:
    """One possession of a built dataset, in the same formats (frames stay in match time). The
    datasheet is not copied: the sample lives in the repository next to it."""
    meta = json.loads((out / "metadata.json").read_text())
    tables = {}
    for name in TABLES:
        table = pq.read_table(out / f"{name}.parquet")
        keep = table.column("match_id").to_numpy() == match_id
        if "possession" in table.column_names:
            keep &= table.column("possession").to_numpy() == possession
        else:  # beliefs: by the receptions of that possession
            rec = pq.read_table(out / "receptions.parquet").to_pylist()
            ids = {r["event_id"] for r in rec
                   if r["match_id"] == match_id and r["possession"] == possession}  # fmt: skip
            keep &= np.array([e in ids for e in table.column("event_id").to_pylist()], dtype=bool)
        tables[name] = table.filter(keep).replace_schema_metadata(table.schema.metadata)
    entry = next(m for m in meta["matches"] if m["match_id"] == match_id)
    entry = entry | {"possessions": [p for p in entry["possessions"] if p["index"] == possession]}
    meta["matches"] = [entry]
    meta["sample"] = f"possession {possession} of match {match_id} only"
    return write_files(sample, tables, meta, datasheet=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the synthetic match dataset.")
    parser.add_argument("--matches", type=int, default=10)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--archive", type=Path, help=f"default: {ARCHIVE_ROOT}.tar.gz by --out")
    parser.add_argument("--sample", type=Path, help="also write one possession here")
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    args = parser.parse_args()
    seeds = match_seeds(args.matches)
    archive = args.archive or args.out.parent / f"{ARCHIVE_ROOT}.tar.gz"
    manifest = build_dataset(seeds, args.out, archive=archive, workers=args.workers)
    for name, f in manifest["files"].items():
        rows = f" {f['rows']:>9,} rows" if "rows" in f else ""
        print(f"{name:<22} {f['bytes'] / 1e6:8.2f} MB{rows}")
    print(f"wrote {args.out} ({len(seeds)} matches, seeds {seeds[0]}-{seeds[-1]})")
    print(f"wrote {archive} ({archive.stat().st_size / 1e6:.1f} MB)")
    if args.sample:
        write_sample(args.out, args.sample, seeds[0], SAMPLE_POSSESSION)
        total = sum(p.stat().st_size for p in args.sample.iterdir())
        print(f"wrote {args.sample} ({total / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
