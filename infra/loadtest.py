"""A light load test of a LOCAL API (SPEC 8): live viewers on the WebSocket, then a burst of
breakdown and what-if requests, with latency, errors and the container's memory.

    docker build -t tte-api .
    docker run -d --name tte-load --cpus 0.5 --memory 1g -p 8797:8000 tte-api
    uv run python -m infra.loadtest --api http://localhost:8797 --container tte-load

The image runs offline (no Foundry, Speech, Cosmos or Application Insights variables), on the
deployed 0.5 vCPU / 1 GiB. It refuses any host but localhost: never load-test the live service.
Each viewer and each request sends its own X-Forwarded-For hop, so the per-client limits see
different viewers, as they would behind the Container Apps ingress.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import itertools
import json
import statistics
import subprocess
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx
from websockets.asyncio.client import connect

LOCAL = {"localhost", "127.0.0.1", "::1"}
PERSONAS = ["casual", "analyst", "coach", "player_fan", "audio_description"]
QUESTIONS = [
    "What if he passed to H4?",
    "What if he had played it back to the centre-back?",
    "What if he had carried it forward?",
    "What if he passed it wide left?",
    "What if he went long?",
]


def _ip(n: int) -> dict[str, str]:
    return {"x-forwarded-for": f"198.18.{n // 250}.{n % 250 + 1}"}


def _pct(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, round(p / 100 * (len(xs) - 1)))]


@dataclass
class Viewer:
    lags: list[tuple[float, float]] = field(default_factory=list)  # (wall time, lag s)
    frames: int = 0
    connect_s: float = float("nan")
    closed: str = ""


async def _view(ws_url: str, n: int, speed: float, until: float, out: Viewer) -> None:
    t0 = time.monotonic()
    try:
        async with connect(f"{ws_url}?speed={speed}", additional_headers=_ip(n),
                           open_timeout=30) as ws:  # fmt: skip
            out.connect_s = time.monotonic() - t0
            dt, first = 0.04, None
            while time.monotonic() < until:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), until - time.monotonic()))
                except TimeoutError:
                    break
                now = time.monotonic()
                if msg["type"] == "hello":
                    dt = msg["dt"]
                elif msg["type"] == "frame":
                    out.frames += 1
                    if first is None:
                        first = (now, msg["f"])
                    expected = first[0] + (msg["f"] - first[1]) * dt / speed
                    out.lags.append((now, now - expected))
                elif msg["type"] in ("error", "end"):
                    out.closed = msg.get("detail") or msg["type"]
                    return
            out.closed = "ok"
    except Exception as e:  # noqa: BLE001 - a load test reports every failure
        out.closed = f"{type(e).__name__}: {e}"[:120]


async def _post(c: httpx.AsyncClient, path: str, body: dict, n: int) -> tuple[float, int]:
    t0 = time.monotonic()
    try:
        r = await c.post(path, json=body, headers=_ip(1000 + n))
        return time.monotonic() - t0, r.status_code
    except httpx.HTTPError:
        return time.monotonic() - t0, 0


def _burst_bodies(match: str, moment: str | None, breakdowns: int, whatifs: int):
    combos = [[p] for p in PERSONAS] + [list(c) for c in itertools.combinations(PERSONAS, 2)]
    langs = [["en"], ["zh"], ["en", "zh"]]
    bodies = [{"match": match, "moment": moment, "personas": p, "languages": lang}
              for p, lang in itertools.product(combos, langs)][:breakdowns]  # fmt: skip
    asks = [{"match": match, "moment": moment, "question": q, "language": lang}
            for q, lang in itertools.product(QUESTIONS, ["en", "zh"])]  # fmt: skip
    return bodies, (asks * (1 + whatifs // max(1, len(asks))))[:whatifs]


def _memory(container: str, stop: asyncio.Event, samples: list[tuple[float, float, float]]):
    """`docker stats` every ~2 s: (wall time, MiB used, CPU % of one core)."""

    async def run() -> None:
        while not stop.is_set():
            out = await asyncio.to_thread(
                subprocess.run,
                ["docker", "stats", "--no-stream", "--format", "{{.MemUsage}};{{.CPUPerc}}",
                 container], capture_output=True, text=True,
            )  # fmt: skip
            with contextlib.suppress(ValueError, IndexError):
                mem, cpu = out.stdout.strip().split(";")
                used = mem.split("/")[0].strip()
                mib = float(used[:-3]) * (1024 if used.endswith("GiB") else 1)
                samples.append((time.monotonic(), mib, float(cpu.rstrip("%"))))
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), 2.0)

    return run()


async def main_async(args: argparse.Namespace) -> str:
    host = urlsplit(args.api).hostname
    if host not in LOCAL:
        raise SystemExit(f"refusing {host}: this load test runs against a local API only")
    api = args.api.rstrip("/")
    ws_url = api.replace("http", "ws", 1) + f"/ws/matches/{args.match}/live"
    async with httpx.AsyncClient(base_url=api, timeout=300) as c:
        info = (await c.get(f"/api/matches/{args.match}")).json()
    moment = info["hero_moment"]

    stop, samples = asyncio.Event(), []
    mem_task = None
    if args.container:
        mem_task = asyncio.create_task(_memory(args.container, stop, samples))
    start = time.monotonic()
    until = start + args.duration
    viewers = [Viewer() for _ in range(args.viewers + args.fast)]
    tasks = [
        asyncio.create_task(_view(ws_url, i, args.fast_speed if i >= args.viewers else 1.0,
                                  until, v))
        for i, v in enumerate(viewers)
    ]  # fmt: skip

    await asyncio.sleep(args.burst_at)
    bodies, asks = _burst_bodies(args.match, moment, args.breakdowns, args.whatifs)
    burst_start = time.monotonic()
    async with httpx.AsyncClient(base_url=api, timeout=600) as c:
        probe_lat: list[float] = []

        async def probe() -> None:  # a small GET every second: is the API still responsive?
            while time.monotonic() < until:
                t0 = time.monotonic()
                with contextlib.suppress(httpx.HTTPError):
                    await c.get(f"/api/matches/{args.match}/moments", headers=_ip(5000))
                probe_lat.append(time.monotonic() - t0)
                await asyncio.sleep(1.0)

        probe_task = asyncio.create_task(probe())
        results = await asyncio.gather(
            *[_post(c, "/api/breakdowns", b, i) for i, b in enumerate(bodies)],
            *[_post(c, "/api/whatif", a, 500 + i) for i, a in enumerate(asks)],
        )
        burst_end = time.monotonic()
        await asyncio.gather(*tasks)
        probe_task.cancel()
    stop.set()
    if mem_task:
        await mem_task

    slow = viewers[: args.viewers]
    lags = [lag for v in slow for _, lag in v.lags]
    during = [lag for v in slow for t, lag in v.lags if burst_start <= t <= burst_end]
    before = [lag for v in slow for t, lag in v.lags if t < burst_start]
    bd = [r for r in results[: len(bodies)]]
    wi = [r for r in results[len(bodies) :]]
    closed = [v.closed for v in viewers if v.closed not in ("ok", "end")]
    peak = max((m for _, m, _ in samples), default=float("nan"))
    cpu = [p for _, _, p in samples]
    lines = [
        f"# Load test: {args.viewers} viewers at 1x"
        + (f" + {args.fast} at {args.fast_speed:g}x" if args.fast else "")
        + f" on {args.match}, {args.duration:g} s; burst at {args.burst_at:g} s of "
        f"{len(bodies)} breakdowns + {len(asks)} what-ifs",
        "",
        f"- viewers connected: {sum(v.frames > 0 for v in slow)}/{len(slow)}, connect p95 "
        f"{_pct([v.connect_s for v in slow], 95):.2f} s, frames received "
        f"{sum(v.frames for v in slow)}, abnormal closes {len(closed)}"
        + (f" ({closed[0]})" if closed else ""),
        f"- frame lag before the burst: p50 {_pct(before, 50) * 1000:.0f} ms, p95 "
        f"{_pct(before, 95) * 1000:.0f} ms, max {max(before, default=0) * 1000:.0f} ms",
        f"- frame lag during the burst: p50 {_pct(during, 50) * 1000:.0f} ms, p95 "
        f"{_pct(during, 95) * 1000:.0f} ms, max {max(during, default=0) * 1000:.0f} ms",
        f"- frame lag overall: p95 {_pct(lags, 95) * 1000:.0f} ms",
        f"- breakdowns: {_count(bd)}, latency p50 {_pct([t for t, _ in bd], 50):.1f} s, "
        f"p95 {_pct([t for t, _ in bd], 95):.1f} s, max {max((t for t, _ in bd), default=0):.1f} s",
        f"- what-ifs: {_count(wi)}, latency p50 {_pct([t for t, _ in wi], 50):.1f} s, "
        f"p95 {_pct([t for t, _ in wi], 95):.1f} s, max {max((t for t, _ in wi), default=0):.1f} s",
        f"- burst wall time {burst_end - burst_start:.1f} s; small GET while it ran: p50 "
        f"{_pct(probe_lat, 50) * 1000:.0f} ms, p95 {_pct(probe_lat, 95) * 1000:.0f} ms, max "
        f"{max(probe_lat, default=0) * 1000:.0f} ms",
    ]
    if samples:
        lines.append(
            f"- container memory: peak {peak:.0f} MiB of 1024; CPU mean "
            f"{statistics.mean(cpu):.0f}% / max {max(cpu):.0f}% of one core "
            f"({len(samples)} samples)"
        )
    if args.fast:
        fast = viewers[args.viewers :]
        lines.append(f"- fast viewers: frames {sum(v.frames for v in fast)}")
    return "\n".join(lines)


def _count(rs: list[tuple[float, int]]) -> str:
    codes: dict[int, int] = {}
    for _, code in rs:
        codes[code] = codes.get(code, 0) + 1
    return ", ".join(f"{n}× {code or 'failed'}" for code, n in sorted(codes.items()))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--api", default="http://localhost:8797")
    p.add_argument("--container", help="docker container name, for its memory and CPU")
    p.add_argument("--match", default="match-1")
    p.add_argument("--viewers", type=int, default=50)
    p.add_argument("--fast", type=int, default=0, help="extra viewers at --fast-speed")
    p.add_argument("--fast-speed", type=float, default=1000.0)
    p.add_argument("--duration", type=float, default=90.0)
    p.add_argument("--burst-at", type=float, default=30.0)
    p.add_argument("--breakdowns", type=int, default=20)
    p.add_argument("--whatifs", type=int, default=20)
    print(asyncio.run(main_async(p.parse_args())))


if __name__ == "__main__":
    main()
