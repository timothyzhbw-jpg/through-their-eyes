"""Recorded failure drills (SPEC 6, docs/OPERATIONS.md): what a limited viewer sees instead of
a 429.

Every drill the service runs, and every bring-back, is recorded as the response it gave, under a
key of what shaped it: the moment card, personas, languages, prompt and pipeline versions, the
agents taken down at first (`down`) and the agents brought back since, in order (`path`). When a
drill or a bring-back is limited (per client or by a daily cap), the recording of the same drill
in the same state is served, labelled with the time it ran. A recording's own bring-backs are its
recorded children, so a viewer can follow a recorded drill as far as it was recorded.

Recordings live on this replica's disk like the drills themselves (never in Cosmos DB), one JSON
file each, the most recent `keep` only. A model run's recording is not replaced by an offline
one.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from api.store import content_key


def recording_key(card: str, personas: list[str], languages: list[str], prompts: str,
                  pipeline: str, down: list[str], path: list[str]) -> str:  # fmt: skip
    return content_key(kind="drill-recording", card=card, personas=sorted(personas),
                       languages=sorted(languages), prompts=prompts, pipeline=pipeline,
                       down=sorted(down), path=list(path))  # fmt: skip


class Recordings:
    def __init__(self, root: Path, keep: int) -> None:
        self.root, self.keep = Path(root), keep

    def get(self, key: str) -> dict[str, Any] | None:
        try:
            return json.loads((self.root / f"{key}.json").read_text())
        except (OSError, ValueError):
            return None

    def has(self, key: str) -> bool:
        return (self.root / f"{key}.json").is_file()

    def put(self, key: str, recording: dict[str, Any]) -> None:
        """Record `recording` (with `at`, the time it ran) unless a model run is recorded here."""
        old = self.get(key)
        sources = (old or {}).get("response", {}).get("source"), recording["response"]["source"]
        if sources == ("model", "offline"):
            return
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.root / f"{key}.json.tmp"
        tmp.write_text(json.dumps(recording, ensure_ascii=False))
        tmp.replace(self.root / f"{key}.json")
        files = sorted(self.root.glob("*.json"), key=lambda f: f.stat().st_mtime)
        for old_file in files[: max(0, len(files) - self.keep)]:
            old_file.unlink(missing_ok=True)


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
