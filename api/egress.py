"""A budget for the bytes the API sends (SPEC 8, docs/OPERATIONS.md).

Azure bills internet egress past 100 GB a month, and the subscription's credit has a spending
limit: when it runs out, the subscription stops, and the demo with it. Match-1's export is 4 MB
gzipped (12 MB raw) and its live stream 13 MB, so a script that downloads either in a loop could
spend the credit in hours. Every HTTP response body (`EgressLimit`) and every live-stream message
(api/live.py) is therefore charged to the client address the rate limits use, and to the UTC
day across all clients.

A client may start a download while its bucket and the day both have bytes left. The bytes are
charged as they are sent, so one export or stream may take either below zero; the next request
is refused until the bucket has refilled (at `per_client` bytes per `window_s`) or the day ends.
Refused: 429 for HTTP, 4429 for a live stream. A normal session (the export, the whole live
match, a few breakdowns and their audio) is about 25 MB.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, date, datetime

from fastapi.requests import HTTPConnection
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MB = 1_000_000
EXEMPT = frozenset({"/health"})  # the probe: never refused


class Egress:
    """Bytes sent per client (a bucket of `per_client` bytes, refilled over `window_s`) and per UTC
    day across all clients (`daily`). Memory is bounded: a full bucket is not kept, and past
    `max_clients` the least recently charged client is dropped (it starts afresh)."""

    def __init__(
        self,
        per_client: int,
        window_s: float,
        daily: int,
        clock: Callable[[], datetime] | None = None,
        max_clients: int = 10_000,
    ) -> None:
        self.per_client, self.rate, self.daily = per_client, per_client / window_s, daily
        self.max_clients = max_clients
        self._clock = clock or (lambda: datetime.now(UTC))
        self._buckets: OrderedDict[str, tuple[float, float]] = OrderedDict()  # (left, at)
        self._day: date | None = None
        self._sent = 0

    def _left(self, client: str, now: float) -> float:
        left, at = self._buckets.get(client, (self.per_client, now))
        return min(self.per_client, left + (now - at) * self.rate)

    def today_left(self) -> int:
        day = self._clock().astimezone(UTC).date()
        if day != self._day:
            self._day, self._sent = day, 0
        return self.daily - self._sent

    def refused(self, client: str) -> str | None:
        """Why `client` may not start a download now, or None."""
        if self.today_left() <= 0:
            return "today's download budget is used up; try again tomorrow (UTC)"
        if self._left(client, time.monotonic()) <= 0:
            return "too much downloaded from this address; try again later"
        return None

    def charge(self, client: str, n: int) -> None:
        if n <= 0:
            return
        now = time.monotonic()
        left = self._left(client, now) - n
        self.today_left()  # rolls the day over first
        self._sent += n
        self._buckets.pop(client, None)
        self._buckets[client] = (left, now)  # most recently charged last
        while self._buckets:  # drop refilled buckets, oldest first, and keep within max_clients
            oldest, (was, at) = next(iter(self._buckets.items()))
            if len(self._buckets) <= self.max_clients and was + (now - at) * self.rate < (
                self.per_client
            ):
                break
            self._buckets.pop(oldest)

    def __len__(self) -> int:
        return len(self._buckets)


class EgressLimit:
    """Charges every HTTP response body to the client and the day (`Egress`); 429 once either
    is spent. Installed inside CORS, so the browser can read the 429."""

    def __init__(
        self, app: ASGIApp, egress: Egress, client_ip: Callable[[HTTPConnection], str]
    ) -> None:
        self.app, self.egress, self.client_ip = app, egress, client_ip

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in EXEMPT:
            return await self.app(scope, receive, send)
        client = self.client_ip(HTTPConnection(scope))
        if why := self.egress.refused(client):
            refusal = JSONResponse({"detail": why}, 429, headers={"retry-after": "600"})
            return await refusal(scope, receive, send)

        async def charged(message: Message) -> None:
            if message["type"] == "http.response.body":
                self.egress.charge(client, len(message.get("body", b"")))
            await send(message)

        await self.app(scope, receive, charged)
