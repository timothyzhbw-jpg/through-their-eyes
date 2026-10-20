"""What the service keeps: loaded matches, cached results, and per-client rate limits.

Matches load lazily, once, in a worker thread (the sim and the claim checks take a few seconds).
Results are cached in memory and as JSON files keyed by a content hash, so a restart or a new
replica serves them again; Cosmos DB can take the place of the files later (SPEC 8).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from agents.context import MomentContext
from api.settings import Settings, match_id
from sim.export import export_hero

SPRINT_MPS = 7.0  # SPEC 4.6


@dataclass
class Match:
    id: str
    scenario: str
    seed: int
    ctx: MomentContext
    export: dict[str, Any]
    cards: list[dict[str, Any]]
    sprint: list[list[str]]  # per frame: players above sprint speed (live overlay)

    @classmethod
    def load(cls, scenario: str, seed: int) -> Match:
        ctx = MomentContext.load(scenario, seed)
        export = export_hero(scenario, seed)
        run = ctx.run
        speed = np.linalg.norm(run.vel, axis=-1)
        sprint = [[run.ids[j] for j in np.flatnonzero(row > SPRINT_MPS)] for row in speed]
        cards = [c.model_dump(mode="json") for c in ctx.cards.values()]
        return cls(match_id(scenario, seed), scenario, seed, ctx, export, cards, sprint)


class MatchStore:
    def __init__(self, settings: Settings) -> None:
        self.known = {match_id(s, seed): (s, seed) for s, seed in settings.matches}
        self._loaded: dict[str, Match] = {}
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def get(self, mid: str) -> Match | None:
        if mid not in self.known:
            return None
        async with self._locks[mid]:
            if mid not in self._loaded:
                self._loaded[mid] = await asyncio.to_thread(Match.load, *self.known[mid])
        return self._loaded[mid]


def content_key(**parts: Any) -> str:
    blob = json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


class ResultCache:
    """Memory in front of one JSON file per key."""

    def __init__(self, root: Path, kind: str) -> None:
        self.dir = Path(root) / kind
        self._memory: dict[str, dict[str, Any]] = {}

    def get(self, key: str) -> dict[str, Any] | None:
        if key in self._memory:
            return self._memory[key]
        path = self.dir / f"{key}.json"
        if path.exists():
            self._memory[key] = json.loads(path.read_text())
            return self._memory[key]
        return None

    def put(self, key: str, value: dict[str, Any]) -> None:
        self._memory[key] = value
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / f"{key}.json.tmp"
        tmp.write_text(json.dumps(value, ensure_ascii=False))
        tmp.replace(self.dir / f"{key}.json")


class RateLimiter:
    """At most `count` events per `window_s` seconds per client."""

    def __init__(self, count: int, window_s: float) -> None:
        self.count, self.window_s = count, window_s
        self._seen: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, client: str) -> bool:
        now = time.monotonic()
        seen = self._seen[client]
        while seen and now - seen[0] > self.window_s:
            seen.popleft()
        if len(seen) >= self.count:
            return False
        seen.append(now)
        return True
