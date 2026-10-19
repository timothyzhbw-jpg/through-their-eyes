"""A finished sim run and its canonical serialisation (SPEC 3.1, 3.7)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from sim.model import Decision, Event, PlayerInfo


def _plain(value: Any) -> Any:
    """JSON-ready value with floats rounded, so serialisation is stable."""
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return round(float(value), 4)
    return value


@dataclass
class MatchRun:
    scenario: str
    seed: int
    dt: float
    players: list[PlayerInfo]
    hero: str | None
    pos: np.ndarray  # (F, N, 2) m
    vel: np.ndarray  # (F, N, 2) m/s
    body_yaw: np.ndarray  # (F, N) rad
    head_yaw: np.ndarray  # (F, N) rad, true
    head_yaw_observed: np.ndarray  # (F, N) rad, with sensor noise (tracking output)
    ball_pos: np.ndarray  # (F, 3)
    ball_vel: np.ndarray  # (F, 3)
    owner: np.ndarray  # (F,) player index, -1 when free
    events: list[Event]
    decisions: list[Decision]
    draws: dict[tuple[str, str, int], tuple[float, ...]] | None = None

    @property
    def ids(self) -> list[str]:
        return [p.id for p in self.players]

    def index(self, player_id: str) -> int:
        return self.ids.index(player_id)

    def event(self, event_id: str) -> Event:
        return next(e for e in self.events if e.id == event_id)

    def key_scan(self) -> Event:
        return next(e for e in self.events if e.type == "scan" and e.attrs.get("key"))

    def hero_decision(self) -> Decision | None:
        return next((d for d in self.decisions if d.player == self.hero), None)

    def draws_for(self, entity: str) -> dict[tuple[str, int], tuple[float, ...]]:
        if self.draws is None:
            raise ValueError("run without record_draws=True")
        return {(purpose, f): v for (e, purpose, f), v in self.draws.items() if e == entity}

    def to_bytes(self) -> bytes:
        """Canonical output: tracking quantised to mm, mm/s and 1e-4 rad, then events."""
        lines = [
            json.dumps(
                {"scenario": self.scenario, "seed": self.seed, "dt": self.dt,
                 "players": [asdict(p) for p in self.players]},
                sort_keys=True,
            )
        ]  # fmt: skip
        mm = np.rint(np.concatenate([self.pos, self.vel], axis=-1) * 1000).astype(np.int64)
        yaw = np.rint(np.stack([self.body_yaw, self.head_yaw_observed], axis=-1) * 1e4)
        yaw = yaw.astype(np.int64)
        ball = np.rint(np.concatenate([self.ball_pos, self.ball_vel], axis=-1) * 1000)
        ball = ball.astype(np.int64)
        for f in range(len(self.owner)):
            players = np.concatenate([mm[f], yaw[f]], axis=-1).tolist()
            lines.append(
                json.dumps({"f": f, "p": players, "b": ball[f].tolist(), "o": int(self.owner[f])})
            )
        for e in sorted(self.events, key=lambda e: (e.frame, e.id)):
            lines.append(json.dumps(_plain(asdict(e)), sort_keys=True))
        for d in self.decisions:
            lines.append(json.dumps(_plain(asdict(d)), sort_keys=True))
        return ("\n".join(lines) + "\n").encode()

    def output_hash(self) -> str:
        return hashlib.sha256(self.to_bytes()).hexdigest()
