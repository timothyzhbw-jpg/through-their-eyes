"""The live ingest stream (SPEC 2): a recorded synthetic match replayed at wall-clock speed.

Messages, in order: `hello`; then per frame a `frame`, followed by the `event`s of that frame and
the `moment`s whose window ends on it; finally `end`. Live overlays (sprint tags) are computed
ahead of time, so a frame costs no analytics at send time. The client may send
`{"type": "pause" | "resume" | "stop"}`, `{"type": "seek", "f": 120}` or
`{"type": "speed", "x": 2.0}`.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from api.store import Match


@dataclass
class Control:
    speed: float
    seek: int | None = None
    paused: bool = False
    stopped: bool = False
    changed: asyncio.Event = field(default_factory=asyncio.Event)


async def _listen(ws: WebSocket, control: Control) -> None:
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "pause":
                control.paused = True
            elif kind == "resume":
                control.paused = False
            elif kind == "stop":
                control.stopped = True
            elif kind == "seek":
                control.seek = int(msg.get("f", 0))
            elif kind == "speed":
                control.speed = min(max(float(msg.get("x", 1.0)), 0.1), 1000.0)
            control.changed.set()
    except (WebSocketDisconnect, RuntimeError):
        control.stopped = True
        control.changed.set()


async def stream(ws: WebSocket, match: Match, speed: float = 1.0, start: int = 0) -> None:
    run = match.export["runs"]["factual"]
    dt, frames = match.export["dt"], run["frames"]
    events: dict[int, list[dict]] = defaultdict(list)
    for e in run["events"]:
        events[e["frame"]].append(e)
    moments: dict[int, list[dict]] = defaultdict(list)
    for card in match.cards:
        moments[card["frame_end"]].append(card)

    await ws.send_json({
        "type": "hello", "match": match.id, "dt": dt, "frames": frames,
        "players": match.export["players"], "hero": match.export["hero"],
    })  # fmt: skip
    control = Control(speed=min(max(speed, 0.1), 1000.0))
    listener = asyncio.create_task(_listen(ws, control))
    loop = asyncio.get_running_loop()
    f, next_at = min(max(start, 0), frames - 1), loop.time()
    try:
        while f < frames and not control.stopped:
            if control.seek is not None:
                f, control.seek = min(max(control.seek, 0), frames - 1), None
                next_at = loop.time()
            if control.paused:
                control.changed.clear()
                await control.changed.wait()
                next_at = loop.time()
                continue
            await ws.send_json(_frame(match, run, f, dt))
            for e in events.get(f, ()):
                await ws.send_json({"type": "event", "event": e})
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
        await ws.send_json({"type": "end", "f": f})
    except WebSocketDisconnect:
        pass
    finally:
        listener.cancel()


def _frame(match: Match, run: dict[str, Any], f: int, dt: float) -> dict[str, Any]:
    return {
        "type": "frame", "f": f, "t": round(f * dt, 3),
        "pos": run["pos"][f], "body": run["body"][f], "head": run["head"][f],
        "ball": run["ball"][f], "owner": run["owner"][f], "sprint": match.sprint[f],
    }  # fmt: skip
