"""What the service keeps: loaded matches, cached results, rate limits and the daily model cap.

Matches load lazily, once, in a worker thread (the sim and the claim checks take a few seconds).
Results are cached in memory in front of a store keyed by a content hash, so a restart or a new
replica serves them again: JSON files by default, Cosmos DB when `TTE_COSMOS_ENDPOINT` is set
(SPEC 8: container `cache`, and the claims audit in `claims_audit`). The voice cues that
POST /api/tts may speak are kept the same way (kind `voice`, api/tts.py).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections import OrderedDict, defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import numpy as np
from azure.core.exceptions import AzureError, ResourceNotFoundError

from agents.context import MomentContext
from api.settings import Settings, match_id
from explain.audit import AuditSink, CosmosAuditSink
from sim.export import export_hero

log = logging.getLogger(__name__)
CACHE_CONTAINER = "cache"  # partition key /kind
AUDIT_CONTAINER = "claims_audit"  # partition key /match_id

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
    def load(cls, scenario: str, seed: int, audit: AuditSink | None = None) -> Match:
        ctx = MomentContext.load(scenario, seed, audit=audit)
        export = export_hero(scenario, seed)
        run = ctx.run
        speed = np.linalg.norm(run.vel, axis=-1)
        sprint = [[run.ids[j] for j in np.flatnonzero(row > SPRINT_MPS)] for row in speed]
        cards = [c.model_dump(mode="json") for c in ctx.cards.values()]
        return cls(match_id(scenario, seed), scenario, seed, ctx, export, cards, sprint)


class MatchStore:
    def __init__(self, settings: Settings, audit: AuditSink | None = None) -> None:
        self.known = {match_id(s, seed): (s, seed) for s, seed in settings.matches}
        self.audit = audit  # None: each match keeps its verdicts in memory
        self._loaded: dict[str, Match] = {}
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def get(self, mid: str) -> Match | None:
        if mid not in self.known:
            return None
        async with self._locks[mid]:
            if mid not in self._loaded:
                scenario, seed = self.known[mid]
                self._loaded[mid] = await asyncio.to_thread(Match.load, scenario, seed, self.audit)
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


class CosmosResultCache:
    """Memory in front of a Cosmos DB container: one item per key, `id` = the content key and
    partition key `/kind` (SPEC 8). `container` is an azure-cosmos ContainerProxy.

    Cosmos DB errors are logged, not raised: a failed read is a miss, a failed write keeps the
    value in memory only.
    """

    def __init__(self, container: Any, kind: str) -> None:
        self.container, self.kind = container, kind
        self._memory: dict[str, dict[str, Any]] = {}

    def get(self, key: str) -> dict[str, Any] | None:
        if key in self._memory:
            return self._memory[key]
        try:
            item = self.container.read_item(item=key, partition_key=self.kind)
        except ResourceNotFoundError:
            return None
        except AzureError as e:
            log.warning("cache read %s/%s failed: %s", self.kind, key, type(e).__name__)
            return None
        self._memory[key] = item["value"]
        return self._memory[key]

    def put(self, key: str, value: dict[str, Any]) -> None:
        self._memory[key] = value
        try:
            self.container.upsert_item({"id": key, "kind": self.kind, "value": value})
        except AzureError as e:
            log.warning("cache write %s/%s failed: %s", self.kind, key, type(e).__name__)


@dataclass
class Storage:
    breakdowns: ResultCache | CosmosResultCache
    answers: ResultCache | CosmosResultCache  # what-if answers
    audit: AuditSink | None  # None: each match keeps its verdicts in memory
    voice: ResultCache | CosmosResultCache  # voice cue key -> SSML (api/tts.py)
    close: Callable[[], None] = field(default=lambda: None)


def open_storage(
    settings: Settings, credential: Any | None = None, cosmos_client: Any | None = None
) -> Storage:
    """Cosmos DB when `TTE_COSMOS_ENDPOINT` is set, else JSON files under `TTE_CACHE_DIR`.

    `credential` is a synchronous azure-core TokenCredential (in Azure, the app's managed identity);
    this module never creates one. `cosmos_client` stands in for the CosmosClient in tests. The
    database and its containers are provisioned with the infrastructure, not created here.
    """
    if not settings.cosmos_endpoint:
        return Storage(
            ResultCache(settings.cache_dir, "breakdowns"),
            ResultCache(settings.cache_dir, "whatif"),
            None,
            ResultCache(settings.cache_dir, "voice"),
        )
    owned = cosmos_client is None
    if owned:
        if credential is None:
            raise ValueError("TTE_COSMOS_ENDPOINT is set: pass a credential (the managed identity)")
        from azure.cosmos import CosmosClient

        cosmos_client = CosmosClient(settings.cosmos_endpoint, credential=credential)
    database = cosmos_client.get_database_client(settings.cosmos_database)
    cache = database.get_container_client(CACHE_CONTAINER)
    return Storage(
        CosmosResultCache(cache, "breakdowns"),
        CosmosResultCache(cache, "whatif"),
        CosmosAuditSink(database.get_container_client(AUDIT_CONTAINER)),
        CosmosResultCache(cache, "voice"),
        cosmos_client.close if owned else (lambda: None),
    )


class RateLimiter:
    """At most `count` events per `window_s` seconds per client.

    Memory is bounded: a client with no event left in the window is forgotten, and past
    `max_clients` tracked clients the least recently seen one is dropped (it starts afresh).
    """

    def __init__(self, count: int, window_s: float, max_clients: int = 10_000) -> None:
        self.count, self.window_s, self.max_clients = count, window_s, max_clients
        self._seen: OrderedDict[str, deque[float]] = OrderedDict()  # least recently seen first

    def allow(self, client: str) -> bool:
        now = time.monotonic()
        seen = self._seen.pop(client, None) or deque()
        while seen and now - seen[0] > self.window_s:
            seen.popleft()
        allowed = len(seen) < self.count
        if allowed:
            seen.append(now)
        if seen:
            self._forget(now)
            self._seen[client] = seen
        return allowed

    def _forget(self, now: float) -> None:
        """Make room for one more client: idle ones first, then the least recently seen."""
        while self._seen:
            oldest = next(iter(self._seen.values()))
            if now - oldest[-1] <= self.window_s and len(self._seen) < self.max_clients:
                return
            self._seen.popitem(last=False)


class DailyCap:
    """At most `count` events per UTC day across all clients (SPEC 8).

    Counted in process memory: the API runs one replica, and a restart starts the day's count
    again.
    """

    def __init__(self, count: int, clock: Callable[[], datetime] | None = None) -> None:
        self.count = count
        self._clock = clock or (lambda: datetime.now(UTC))
        self._day: date | None = None
        self._used = 0

    def left(self) -> int:
        day = self._clock().astimezone(UTC).date()
        if day != self._day:
            self._day, self._used = day, 0
        return max(0, self.count - self._used)

    def take(self) -> bool:
        if self.left() <= 0:
            return False
        self._used += 1
        return True

    def give(self) -> None:
        """Return a unit whose work failed, so it does not count against the day."""
        self.left()  # rolls the day over first
        self._used = max(0, self._used - 1)
