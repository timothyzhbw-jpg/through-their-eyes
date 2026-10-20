"""Service settings, from the environment (documented in .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# "match" is a stitched match (sim.match, SPEC 3.1); the number is its match seed. Its hero
# possessions are served on their own too: the web app opens their breakdowns from those exports.
DEFAULT_MATCHES = [("blind_side_run", 3), ("match", 1), ("press_escape", 0)]


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


def _rate(text: str) -> tuple[int, float]:
    """Parse "3/600": 3 model regenerations per client per 600 s."""
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
    analyst_mcp: bool = True  # the Analyst inspects the moment through our MCP server (SPEC 6, 8)

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
            analyst_mcp=_flag(os.environ.get("TTE_ANALYST_MCP"), True),
        )
