"""Service settings, from the environment (documented in .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_MATCHES = [("blind_side_run", 3)]


def match_id(scenario: str, seed: int) -> str:
    return f"{scenario}-{seed}"


def _matches(text: str) -> list[tuple[str, int]]:
    """Parse "blind_side_run:3,blind_side_run:5" into [("blind_side_run", 3), ...]."""
    out = []
    for item in filter(None, (part.strip() for part in text.split(","))):
        scenario, _, seed = item.partition(":")
        out.append((scenario, int(seed or 3)))
    return out


def _rate(text: str) -> tuple[int, float]:
    """Parse "3/600": 3 requests per client per 600 s."""
    count, _, window = text.partition("/")
    return int(count), float(window or 600)


@dataclass
class Settings:
    matches: list[tuple[str, int]] = field(default_factory=lambda: list(DEFAULT_MATCHES))
    cache_dir: Path = Path("out/cache")
    rate_limit: tuple[int, float] = (3, 600.0)
    web_origin: str = "*"
    daily_model_cap: int = 40  # model-backed regenerations per UTC day, all clients (SPEC 8)
    cosmos_endpoint: str = ""  # set: Cosmos DB instead of the file store (SPEC 8)
    cosmos_database: str = "tte"
    tts_rate_limit: tuple[int, float] = (60, 600.0)  # speech requests per client per window
    daily_tts_cap: int = 200  # speech syntheses (audio cache misses) per UTC day, all clients

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            matches=_matches(os.environ.get("TTE_MATCHES", "")) or list(DEFAULT_MATCHES),
            cache_dir=Path(os.environ.get("TTE_CACHE_DIR", "out/cache")),
            rate_limit=_rate(os.environ.get("TTE_RATE_LIMIT", "3/600")),
            web_origin=os.environ.get("TTE_WEB_ORIGIN", "*"),
            daily_model_cap=int(os.environ.get("TTE_DAILY_MODEL_CAP") or 40),
            cosmos_endpoint=os.environ.get("TTE_COSMOS_ENDPOINT", "").strip(),
            cosmos_database=os.environ.get("TTE_COSMOS_DATABASE", "").strip() or "tte",
            tts_rate_limit=_rate(os.environ.get("TTE_TTS_RATE_LIMIT", "60/600")),
            daily_tts_cap=int(os.environ.get("TTE_DAILY_TTS_CAP") or 200),
        )
