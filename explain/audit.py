"""Claims audit log (SPEC 5.3): every verdict, with its inputs and timestamps.

Sinks share one interface, `AuditSink.write(record)`. `JsonlAuditSink` appends to a local file;
`CosmosAuditSink` writes to the Cosmos DB container `claims_audit` (SPEC 8). Records are
Cosmos-shaped: a unique `id` and a `match_id` partition key. The memory and Cosmos sinks also list
a match's latest verdicts (`recent`), for the API's audit view.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Protocol

from azure.core.exceptions import AzureError
from pydantic import BaseModel

log = logging.getLogger(__name__)


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

    def recent(self, match_id: str, limit: int = 50) -> list[AuditRecord]:
        return [r for r in self.records if r.match_id == match_id][-limit:]


class JsonlAuditSink:
    """One JSON object per line, appended."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def write(self, record: AuditRecord) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(record.model_dump_json() + "\n")


class CosmosAuditSink:
    """One item per verdict in a Cosmos DB container partitioned by `/match_id` (SPEC 8).

    `container` is an azure-cosmos ContainerProxy. A failed write is logged, not raised: the
    verdict itself stands, and a viewer's request should not fail on the audit log.
    """

    QUERY = "SELECT TOP @n * FROM c WHERE c.match_id = @match_id ORDER BY c.decided_at DESC"

    def __init__(self, container: Any) -> None:
        self.container = container

    def write(self, record: AuditRecord) -> None:
        try:
            self.container.upsert_item(record.model_dump(mode="json"))
        except AzureError as e:
            log.error("audit record %s not written: %s", record.id, type(e).__name__)

    def recent(self, match_id: str, limit: int = 50) -> list[AuditRecord]:
        """The match's latest `limit` verdicts, oldest first."""
        params = [{"name": "@n", "value": limit}, {"name": "@match_id", "value": match_id}]
        try:
            items = list(self.container.query_items(query=self.QUERY, parameters=params,
                                                    partition_key=match_id))  # fmt: skip
        except AzureError as e:
            log.error("audit records of %s not read: %s", match_id, type(e).__name__)
            return []
        return [AuditRecord.model_validate(item) for item in reversed(items)]
