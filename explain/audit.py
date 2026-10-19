"""Claims audit log (SPEC 5.3): every verdict, with its inputs and timestamps.

Sinks share one interface, `AuditSink.write(record)`. `JsonlAuditSink` appends to a local file
now; a Cosmos DB sink (container `claims_audit`, SPEC 8) slots in behind the same interface.
Records are already Cosmos-shaped: a unique `id` and a `match_id` partition key.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel


class AuditRecord(BaseModel):
    id: str  # unique per verdict
    match: str  # "<scenario>:<seed>"
    match_id: str  # partition key; same as `match`
    run_hash: str  # sha256 of the factual run's canonical bytes (SPEC 3.7)
    counterfactuals: list[str]  # scans dropped by counterfactuals the verdict read
    claim: dict[str, Any]  # the claim exactly as verified
    claim_fingerprint: str
    verdict: dict[str, Any]  # status, reason, evaluated values (trace)
    started_at: str  # ISO 8601, UTC
    decided_at: str
    duration_ms: float
    verifier_version: str


class AuditSink(Protocol):
    def write(self, record: AuditRecord) -> None: ...


class MemoryAuditSink:
    def __init__(self) -> None:
        self.records: list[AuditRecord] = []

    def write(self, record: AuditRecord) -> None:
        self.records.append(record)


class JsonlAuditSink:
    """One JSON object per line, appended."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def write(self, record: AuditRecord) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(record.model_dump_json() + "\n")
