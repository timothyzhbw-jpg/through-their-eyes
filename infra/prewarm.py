"""Pre-warm the deployed breakdown cache (SPEC 2, 8), so judges get model breakdowns without
waiting for one or spending the daily model cap.

A viewer opens one persona in one language for one hero moment at a time (web/src/api/client.ts
`breakdown`), so that is what this asks the live API for: every hero moment of every served match,
times every persona and language. Standalone heroes go first; a stitched match's heroes have the
same cards, so by then they are cache hits.

A cached breakdown costs nothing. A missing one costs one unit of the daily model cap
(`TTE_DAILY_MODEL_CAP`, 40) and one of this address's per-client limit (`TTE_RATE_LIMIT`, 3 per
10 min), so new ones are paced to that limit, and `--max-new` (default 20) leaves the rest of the
cap to visitors. Past the cap the API makes no new ones and serves templates; the run still asks
for every view (that is free) to report which are cached. Run it again after 00:00 UTC.

The cache key holds the moment card, the prompt and pipeline versions and the model, so every
deploy that changes one of them empties it: run this after the last deploy, and after any later
one. `--tts` also speaks every voice cue once: the audio cache is on the replica's disk and every
new revision starts without it.

    uv run python -m infra.prewarm --api <API URL>          # or set TTE_API_URL
    uv run python -m infra.prewarm --api <API URL> --dry-run  # GET requests only: what it would ask
    uv run python -m infra.prewarm --api <API URL> --tts --out out/prewarm.json

Exit code: 0 when every view is a clean model breakdown (no step from a template), 1 when some are
missing or degraded, 3 when the daily cap was reached.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, get_args

from agents.schemas import Language, Persona

PERSONAS: tuple[str, ...] = get_args(Persona)
LANGUAGES: tuple[str, ...] = get_args(Language)
CAPPED = 3  # exit code: the daily model cap was reached
RETRIES = 6  # attempts per view while this address is rate-limited
MARGIN_S = 5.0  # past the end of the API's window, so its strict comparison has passed

# (method, path, JSON body or None) -> (HTTP status, parsed JSON, or bytes for audio)
Http = Callable[[str, str, "dict[str, Any] | None"], "tuple[int, Any]"]


def urllib_http(base: str, timeout_s: float = 120.0) -> Http:
    """The live API at `base`, standard library only."""

    def call(method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(base + path, data=data, method=method,
                                     headers={"content-type": "application/json",
                                              "user-agent": "tte-prewarm"})  # fmt: skip
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as r:
                status, kind, raw = r.status, r.headers.get("content-type", ""), r.read()
        except urllib.error.HTTPError as e:
            status, kind, raw = e.code, e.headers.get("content-type", ""), e.read()
        return status, (json.loads(raw) if "json" in kind else raw)

    return call


def parse_rate(text: str) -> tuple[int, float]:
    """Parse "3/600" (3 per 600 s) as api/settings.py reads TTE_RATE_LIMIT."""
    count, _, window = text.partition("/")
    return int(count), float(window or 600)


@dataclass(frozen=True)
class View:
    """One breakdown a viewer can open."""

    match: str
    moment: str
    persona: str
    language: str

    def body(self, regenerate: bool = False) -> dict[str, Any]:
        return {"match": self.match, "moment": self.moment, "personas": [self.persona],
                "languages": [self.language], "regenerate": regenerate}  # fmt: skip


@dataclass
class Row:
    view: View
    status: str  # cached | new | rate_limited | capped | skipped | error
    key: str | None = None
    problems: list[str] = field(default_factory=list)  # why it is not a clean model breakdown
    detail: str | None = None


@dataclass
class Outcome:
    rows: list[Row]
    cues: int = 0  # distinct voice cues spoken (with --tts)
    tts_failed: list[str] = field(default_factory=list)
    code: int = 0


def views(http: Http) -> list[View]:
    """Every hero moment of every served match × persona × language; hero scenarios first."""
    status, matches = http("GET", "/api/matches", None)
    if status != 200:
        raise RuntimeError(f"GET /api/matches: HTTP {status}")
    infos = []
    for m in matches:
        status, info = http("GET", f"/api/matches/{m['id']}", None)
        if status != 200:
            raise RuntimeError(f"GET /api/matches/{m['id']}: HTTP {status}")
        infos.append(info)
    infos.sort(key=lambda i: i.get("kind") != "hero")  # stable: the API's order otherwise
    return [View(i["id"], moment, p, lang) for i in infos for moment in i["hero_moments"]
            for p in PERSONAS for lang in LANGUAGES]  # fmt: skip


def problems(res: dict[str, Any]) -> list[str]:
    """Why a served breakdown is not a clean model breakdown; empty when it is."""
    if res.get("source") != "model":
        return [f"source {res.get('source')}"]
    result = res.get("result") or {}
    out = ["plan from template"] if result.get("plan_source") != "agent" else []
    return out + [f"{s['step']} from template" for s in result.get("trace", ())
                  if s.get("source") == "template"]  # fmt: skip


def _cues(res: dict[str, Any]) -> list[str]:
    scripts = (res.get("result") or {}).get("scripts") or ()
    return [c["cache_key"] for s in scripts for c in s.get("voice") or ()]


class Pacer:
    """This address's side of the API's per-client window (api/store.py RateLimiter): at most
    `count` new breakdowns per `window_s`."""

    def __init__(self, count: int, window_s: float, clock: Callable[[], float],
                 sleep: Callable[[float], None]) -> None:  # fmt: skip
        self.count, self.window_s, self.clock, self.sleep = count, window_s, clock, sleep
        self.seen: deque[float] = deque()

    def wait(self) -> None:
        now = self.clock()
        while self.seen and now - self.seen[0] > self.window_s + MARGIN_S:
            self.seen.popleft()
        if len(self.seen) >= self.count:
            self.sleep(self.seen[0] + self.window_s + MARGIN_S - now)
            self.seen.popleft()

    def spent(self) -> None:
        self.seen.append(self.clock())

    def fill(self) -> None:
        """Someone else on this address used the window: wait a whole one."""
        self.seen = deque([self.clock()] * self.count)


def run(http: Http, *, rate: tuple[int, float] = (3, 600.0), max_new: int = 20,
        regenerate_degraded: bool = False, tts: bool = False, tts_gap_s: float = 10.5,
        clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep,
        log: Callable[[str], None] = print) -> Outcome:  # fmt: skip
    """Ask for every view; new breakdowns paced to `rate`, at most `max_new` of them.

    A first pass asks for every view without waiting: cache hits are free, and past this
    address's limit the API answers at once with a template (no model call). The second pass asks
    again for those, paced. `tts_gap_s` spaces speech requests under the API's per-client limit
    (60 per 10 min) and Speech F0's own request rate.
    """
    pacer = Pacer(*rate, clock=clock, sleep=sleep)
    state = {"new": 0, "capped": False}
    cues: dict[str, None] = {}  # voice cue keys of the breakdowns served, in order

    def ask(view: View, regenerate: bool = False) -> Row:
        status, res = http("POST", "/api/breakdowns", view.body(regenerate))
        if status != 200:
            detail = res.get("detail") if isinstance(res, dict) else None
            return Row(view, "error", detail=f"HTTP {status}: {detail}")
        if res["rate_limited"]:
            return Row(view, "rate_limited", res["key"])
        if res["capped"]:
            state["capped"] = True
            if not (res["cached"] and res["source"] == "model"):
                return Row(view, "capped", res["key"])
        status = "cached" if res["cached"] else "new"
        if status == "new":
            state["new"] += 1
            pacer.spent()
        cues.update(dict.fromkeys(_cues(res)))
        return Row(view, status, res["key"], problems(res))

    def stopped(view: View) -> Row | None:
        if state["new"] >= max_new:
            return Row(view, "skipped", detail=f"--max-new {max_new} reached")
        return None

    rows: list[Row | None] = []
    later: list[tuple[int, View, bool]] = []  # (row index, view, regenerate)
    for view in views(http):
        row = stopped(view) or ask(view)
        if row.status == "rate_limited" or (regenerate_degraded and row.problems
                                            and row.status == "cached"):  # fmt: skip
            later.append((len(rows), view, row.status == "cached"))
            rows.append(None)
            continue
        log(_line(row))
        rows.append(row)
    for i, view, regenerate in later:
        row = stopped(view)
        for _ in range(RETRIES):
            if row is not None:
                break
            pacer.wait()
            row = ask(view, regenerate)
            if row.status == "rate_limited":
                pacer.fill()
                row = None
        row = row or Row(view, "rate_limited", detail=f"still limited after {RETRIES} tries")
        log(_line(row))
        rows[i] = row

    out = Outcome([r for r in rows if r is not None])
    if tts:
        _speak(http, list(cues), out, tts_gap_s, clock, sleep, log)
    bad = any(r.status not in ("cached", "new") or r.problems for r in out.rows)
    out.code = CAPPED if state["capped"] else 1 if bad or out.tts_failed else 0
    return out


def _speak(http: Http, keys: list[str], out: Outcome, gap_s: float, clock, sleep, log) -> None:
    """POST /api/tts once per voice cue, `gap_s` apart; the API caches the audio by key."""
    last = None
    for key in keys:
        for attempt in range(2):
            if last is not None and (wait := last + gap_s - clock()) > 0:
                sleep(wait)
            last = clock()
            status, res = http("POST", "/api/tts", {"key": key})
            detail = res.get("detail", "") if isinstance(res, dict) else ""
            if status == 429 and "budget" not in detail and attempt == 0:
                sleep(600.0)  # this address's speech window is full: wait it out once
                continue
            break
        if status == 200:
            out.cues += 1
        else:
            out.tts_failed.append(f"{key}: HTTP {status} {detail}".strip())
            if status == 429 and "budget" in detail:
                log(f"speech: today's budget is used up after {out.cues} cues")
                return
    log(f"speech: {out.cues} cues spoken or cached, {len(out.tts_failed)} failed")


def _line(row: Row) -> str:
    v = row.view
    extra = "; ".join(row.problems) or row.detail or ""
    return f"{v.match:18s} {v.moment:32s} {v.persona:18s} {v.language}  {row.status:12s} {extra}"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--api", default=os.environ.get("TTE_API_URL"),
                   help="the API's base URL (default: TTE_API_URL)")  # fmt: skip
    p.add_argument(
        "--max-new",
        type=int,
        default=20,
        help="new model breakdowns at most, this run (the daily cap is 40)",
    )
    p.add_argument("--rate", default="3/600", help="the API's TTE_RATE_LIMIT (default 3/600)")
    p.add_argument(
        "--regenerate-degraded",
        action="store_true",
        help="ask again for a cached breakdown that has a template step (costs a call)",
    )
    p.add_argument("--tts", action="store_true", help="also speak every voice cue once")
    p.add_argument("--dry-run", action="store_true", help="GET requests only: list the views")
    p.add_argument("--out", type=Path, help="write every row as JSON here")
    a = p.parse_args(argv)
    if not a.api:
        p.error("give --api or set TTE_API_URL")
    http = urllib_http(a.api.rstrip("/"))
    if a.dry_run:
        found = views(http)
        for v in found:
            print(f"{v.match:18s} {v.moment:32s} {v.persona:18s} {v.language}")
        print(f"{len(found)} views; a cached one costs nothing, a new one a unit of the daily cap")
        return 0
    out = run(http, rate=parse_rate(a.rate), max_new=a.max_new,
              regenerate_degraded=a.regenerate_degraded, tts=a.tts)  # fmt: skip
    counts: dict[str, int] = {}
    for r in out.rows:
        counts[r.status] = counts.get(r.status, 0) + 1
    degraded = sum(bool(r.problems) for r in out.rows)
    print(f"{len(out.rows)} views: " + ", ".join(f"{n} {s}" for s, n in sorted(counts.items()))
          + f"; {degraded} degraded" + (f"; {out.cues} cues spoken" if a.tts else ""))  # fmt: skip
    if out.code == CAPPED:
        print("the daily model cap was reached: run again after 00:00 UTC")
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        rows = [{**asdict(r), "view": asdict(r.view)} for r in out.rows]
        a.out.write_text(
            json.dumps(
                {"rows": rows, "cues": out.cues, "tts_failed": out.tts_failed, "code": out.code},
                indent=1,
            )
        )
    return out.code


if __name__ == "__main__":
    sys.exit(main())
