"""Service settings, from the environment (documented in .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

# "match" is a stitched match (sim.match, SPEC 3.1); the number is its match seed. Its hero
# possessions are served on their own too, listed here or not (api/store.py MatchStore): the web
# app opens their breakdowns from those exports.
DEFAULT_MATCHES = [
    ("blind_side_run", 3), ("corner_blind_side", 0), ("match", 1), ("match", 2),
    ("press_escape", 0),
]  # fmt: skip


JUDGING = "2026-10-27/2026-11-10"  # the hackathon's judging, UTC days (CLAUDE.md)


def match_id(scenario: str, seed: int) -> str:
    return f"{scenario}-{seed}"


def _matches(text: str) -> list[tuple[str, int]]:
    """Parse "blind_side_run:3,match:1" into [("blind_side_run", 3), ("match", 1)]."""
    out = []
    for item in filter(None, (part.strip() for part in text.split(","))):
        scenario, _, seed = item.partition(":")
        out.append((scenario, int(seed or 3)))
    return out


def _flag(text: str | None, default: bool) -> bool:
    """Off for "0", "false", "no" or "off"; unset or empty keeps the default."""
    text = (text or "").strip().lower()
    return default if not text else text not in ("0", "false", "no", "off")


def _window(text: str) -> tuple[date, date] | None:
    """Parse "2026-10-27/2026-11-10" (UTC days, both included); "", "0" or "off": no window."""
    text = text.strip()
    if text.lower() in ("", "0", "off", "none"):
        return None
    first, _, last = text.partition("/")
    return date.fromisoformat(first.strip()), date.fromisoformat((last or first).strip())


def _rate(text: str) -> tuple[int, float]:
    """Parse "3/600": 3 requests per client per 600 s."""
    count, _, window = text.partition("/")
    return int(count), float(window or 600)


@dataclass
class Settings:
    matches: list[tuple[str, int]] = field(default_factory=lambda: list(DEFAULT_MATCHES))
    cache_dir: Path = Path("out/cache")
    rate_limit: tuple[int, float] = (3, 600.0)
    verify_rate_limit: tuple[int, float] = (20, 60.0)  # tamper checks per client (no model)
    web_origin: str = "*"
    daily_model_cap: int = 40  # model-backed regenerations per UTC day, all clients (SPEC 8)
    cosmos_endpoint: str = ""  # set: Cosmos DB instead of the file store (SPEC 8)
    cosmos_database: str = "tte"
    tts_rate_limit: tuple[int, float] = (60, 600.0)  # speech requests per client per window
    daily_tts_cap: int = 200  # speech syntheses (audio cache misses) per UTC day, all clients
    tts_concurrency: int = 4  # Azure Speech calls in flight at once, this process
    live_per_client: int = 4  # live streams open at once per client address
    live_max_total: int = 64  # live streams open at once, all clients, this process
    live_max_s: float = 1200.0  # longest live stream, paused time included
    analyst_mcp: bool = True  # the Analyst inspects the moment through our MCP server (SPEC 6, 8)
    egress_per_client: tuple[int, float] = (500, 3600.0)  # MB sent per client per window (s)
    daily_egress_gb: float = 10.0  # GB sent per UTC day, all clients (api/egress.py)
    crew_concurrency: int = 2  # crew runs with a model at once, this process (MCP subprocesses)
    # The judging window (UTC days, both included): its own per-client limit and daily model cap,
    # so that a judge's tour (what-if, drill, bring-back, recap) fits, and judges behind one NAT
    # too. From the environment it defaults to the hackathon's judging, 2026-10-27/2026-11-10.
    judging_window: tuple[date, date] | None = None
    judging_rate_limit: tuple[int, float] = (8, 600.0)
    judging_daily_model_cap: int = 100
    warm: bool = False  # load every match before the port opens (from the environment: on)

    def limits_on(self, day: date) -> tuple[tuple[int, float], int]:
        """(per-client rate limit, daily model cap) on UTC `day`."""
        w = self.judging_window
        if w is not None and w[0] <= day <= w[1]:
            return self.judging_rate_limit, self.judging_daily_model_cap
        return self.rate_limit, self.daily_model_cap

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            matches=_matches(os.environ.get("TTE_MATCHES", "")) or list(DEFAULT_MATCHES),
            cache_dir=Path(os.environ.get("TTE_CACHE_DIR", "out/cache")),
            rate_limit=_rate(os.environ.get("TTE_RATE_LIMIT", "3/600")),
            verify_rate_limit=_rate(os.environ.get("TTE_VERIFY_RATE_LIMIT", "20/60")),
            web_origin=os.environ.get("TTE_WEB_ORIGIN", "*"),
            daily_model_cap=int(os.environ.get("TTE_DAILY_MODEL_CAP") or 40),
            cosmos_endpoint=os.environ.get("TTE_COSMOS_ENDPOINT", "").strip(),
            cosmos_database=os.environ.get("TTE_COSMOS_DATABASE", "").strip() or "tte",
            tts_rate_limit=_rate(os.environ.get("TTE_TTS_RATE_LIMIT", "60/600")),
            daily_tts_cap=int(os.environ.get("TTE_DAILY_TTS_CAP") or 200),
            tts_concurrency=int(os.environ.get("TTE_TTS_CONCURRENCY") or 4),
            live_per_client=int(os.environ.get("TTE_LIVE_PER_CLIENT") or 4),
            live_max_total=int(os.environ.get("TTE_LIVE_MAX_TOTAL") or 64),
            live_max_s=float(os.environ.get("TTE_LIVE_MAX_S") or 1200),
            analyst_mcp=_flag(os.environ.get("TTE_ANALYST_MCP"), True),
            egress_per_client=_rate(os.environ.get("TTE_EGRESS_PER_CLIENT") or "500/3600"),
            daily_egress_gb=float(os.environ.get("TTE_DAILY_EGRESS_GB") or 10),
            crew_concurrency=int(os.environ.get("TTE_CREW_CONCURRENCY") or 2),
            judging_window=_window(os.environ.get("TTE_JUDGING_WINDOW", JUDGING)),
            judging_rate_limit=_rate(os.environ.get("TTE_JUDGING_RATE_LIMIT") or "8/600"),
            judging_daily_model_cap=int(os.environ.get("TTE_JUDGING_DAILY_MODEL_CAP") or 100),
            warm=_flag(os.environ.get("TTE_WARM"), True),
        )
