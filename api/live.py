"""The live ingest stream (SPEC 2): a recorded synthetic match replayed at wall-clock speed.

Messages, in order: `hello`; then per frame a `frame`, followed by the `event`s of that frame, the
`stat` cues whose value is final on it (SPEC 4.6) and the `moment`s whose window ends on it;
finally `end`, with `full_time: true` when the stream reached the last frame (the web app's cue
for the end-of-match recap). Live overlays (sprint tags, blind-side alerts, stats) are computed
ahead of time, so a frame costs no analytics at send time; a stat cue uses frames up to its own
only. A frame's
`blind_side` lists the alerts on as [observer, target, frames unseen] (player indices,
SPEC 4.4). The client may send `{"type": "pause" | "resume" | "stop"}`,
`{"type": "seek", "f": 120}` (a frame of the match) or `{"type": "speed", "x": 2.0}` (clamped to
0.1–1000).

The stream is public, so it is bounded: a few open at once per client and a ceiling across all
clients (`Slots`), a session length with paused time included, and control messages that are
exactly one of the forms above. Anything else gets an `error` with the reason, then the stream
closes: 4400 for a malformed control message, 4408 past the session length, 4429 for too many
streams (4404: unknown match). A frame larger than the server's `--ws-max-size` (Dockerfile) is
refused by uvicorn from its header, with 1009, before it is buffered.

A stitched match (SPEC 3.1) streams the same way over its whole clock: `hello` says
`kind: "match"`, every event carries its `possession`, and the moments of every possession are
announced as their windows close.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from api.store import Match

MIN_SPEED, MAX_SPEED = 0.1, 1000.0
MAX_CONTROL_CHARS = 256  # the longest valid control message is about 30


@dataclass
class Control:
    speed: float
    frames: int
    seek: int | None = None
    paused: bool = False
    stopped: bool = False
    refused: str | None = None  # why a control message was refused; the stream then closes
    changed: asyncio.Event = field(default_factory=asyncio.Event)


class Slots:
    """Live streams open at once: at most `per_client` per client address and `total` in all.

    The per-client count trusts the address the ingress saw; `total` bounds the process even if
    that address can be faked.
    """

    def __init__(self, per_client: int, total: int = 64) -> None:
        self.per_client, self.total = per_client, total
        self._open: dict[str, int] = defaultdict(int)
        self._count = 0

    def take(self, client: str) -> str | None:
        """Take a slot for `client`; None if taken, else why not."""
        if self._count >= self.total:
            return "the server has too many live streams open; try again shortly"
        if self._open[client] >= self.per_client:
            return "too many live streams from this address"
        self._open[client] += 1
        self._count += 1
        return None

    def give(self, client: str) -> None:
        self._count -= 1
        self._open[client] -= 1
        if self._open[client] <= 0:
            del self._open[client]


def _speed(x: Any) -> float | None:
    """A finite number clamped to the speed range; None for anything else."""
    if isinstance(x, bool) or not isinstance(x, int | float) or not math.isfinite(x):
        return None
    return min(max(float(x), MIN_SPEED), MAX_SPEED)


def _apply(control: Control, text: str | None) -> str | None:
    """Apply one control message; return why it is refused, or None."""
    if text is None or len(text) > MAX_CONTROL_CHARS:
        return "control messages are short JSON text"
    try:
        msg = json.loads(text)
    except ValueError:
        return "a control message is not JSON"
    kind = msg.get("type") if isinstance(msg, dict) else None
    if kind == "pause":
        control.paused = True
    elif kind == "resume":
        control.paused = False
    elif kind == "stop":
        control.stopped = True
    elif kind == "seek":
        f = msg.get("f")
        if isinstance(f, bool) or not isinstance(f, int) or not 0 <= f < control.frames:
            return f"seek needs a frame from 0 to {control.frames - 1}"
        control.seek = f
    elif kind == "speed":
        if (x := _speed(msg.get("x"))) is None:
            return "speed needs a finite number"
        control.speed = x
    else:
        return "unknown control message"
    return None


async def _listen(ws: WebSocket, control: Control) -> None:
    try:
        while not control.stopped:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            control.refused = _apply(control, msg.get("text"))
            control.changed.set()
            if control.refused:
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        control.stopped = True
        control.changed.set()


async def stream(
    ws: WebSocket, match: Match, speed: float = 1.0, start: int = 0, max_s: float = 600.0
) -> None:
    """Replay `match` on the accepted socket `ws`, then close it."""
    run = match.export["runs"]["factual"]
    dt, frames = match.export["dt"], run["frames"]
    events: dict[int, list[dict]] = defaultdict(list)
    for e in run["events"]:
        events[e["frame"]].append(e)
    moments: dict[int, list[dict]] = defaultdict(list)
    for card in match.cards:
        moments[card["frame_end"]].append(card)
    stat_cues: dict[int, list[dict]] = defaultdict(list)
    if match.stats is not None:
        for cue in match.stats.snapshot().cues:
            stat_cues[cue.frame].append(cue.model_dump(mode="json"))

    control = Control(speed=_speed(speed) or 1.0, frames=frames)  # NaN in the query: 1x
    listener = asyncio.create_task(_listen(ws, control))
    loop = asyncio.get_running_loop()
    f, next_at = min(max(start, 0), frames - 1), loop.time()
    try:
        await ws.send_json({
            "type": "hello", "match": match.id, "dt": dt, "frames": frames,
            "players": match.export["players"], "hero": match.export["hero"],
            "kind": match.export.get("kind", "hero"),
        })  # fmt: skip
        try:
            async with asyncio.timeout(max_s):
                while f < frames and not control.stopped:
                    if control.seek is not None:
                        f, control.seek = control.seek, None
                        next_at = loop.time()
                    if control.paused:
                        control.changed.clear()
                        await control.changed.wait()
                        next_at = loop.time()
                        continue
                    await ws.send_json(_frame(match, run, f, dt))
                    for e in events.get(f, ()):
                        await ws.send_json({"type": "event", "event": e})
                    for cue in stat_cues.get(f, ()):
                        await ws.send_json({"type": "stat", "cue": cue})
                    for card in moments.get(f, ()):
                        await ws.send_json({"type": "moment", "card": card})
                    f += 1
                    next_at += dt / control.speed
                    delay = next_at - loop.time()
                    if delay > 0:
                        control.changed.clear()
                        with contextlib.suppress(TimeoutError):  # wake early on a control message
                            await asyncio.wait_for(control.changed.wait(), delay)
                    else:
                        await asyncio.sleep(0)
        except TimeoutError:
            control.refused, code = f"the live stream reached its time limit of {max_s:g} s", 4408
        else:
            code = 4400 if control.refused else 1000
        if control.refused:
            await ws.send_json({"type": "error", "detail": control.refused})
        else:
            # Full time: the stream reached the match's last frame (not a stop or a seek).
            await ws.send_json({"type": "end", "f": f, "full_time": f >= frames})
        await ws.close(code)
    except (WebSocketDisconnect, RuntimeError):
        pass  # the client is gone
    finally:
        listener.cancel()


def _frame(match: Match, run: dict[str, Any], f: int, dt: float) -> dict[str, Any]:
    return {
        "type": "frame", "f": f, "t": round(f * dt, 3),
        "pos": run["pos"][f], "body": run["body"][f], "head": run["head"][f],
        "ball": run["ball"][f], "owner": run["owner"][f], "sprint": match.sprint[f],
        "blind_side": run["blind_side"]["frames"][f],
    }  # fmt: skip
