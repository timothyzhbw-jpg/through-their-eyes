"""Cosmos DB behind the existing store interfaces (SPEC 8): containers `cache` and `claims_audit`.

Tested against an in-memory fake of the azure-cosmos container API, never the network.
"""

import copy
from datetime import UTC, datetime, timedelta

import pytest
from azure.core.exceptions import ServiceRequestError
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from fastapi.testclient import TestClient

from api.main import create_app
from api.settings import Settings
from api.store import CosmosResultCache, ResultCache, open_storage
from explain.audit import AuditRecord, CosmosAuditSink

PARTITION_KEYS = {"cache": "/kind", "claims_audit": "/match_id"}  # as provisioned (SPEC 8)


class FakeContainer:
    """The part of azure.cosmos.ContainerProxy the stores use; items carry system fields."""

    def __init__(self, partition_key: str) -> None:
        self.pk = partition_key.lstrip("/")
        self.items: dict[tuple[str, str], dict] = {}
        self.queries: list[tuple[str, dict, str]] = []
        self.down = False

    def _check(self) -> None:
        if self.down:
            raise ServiceRequestError("Cosmos DB unreachable")

    def upsert_item(self, body: dict) -> dict:
        self._check()
        assert isinstance(body["id"], str) and isinstance(body[self.pk], str)
        item = {**copy.deepcopy(body), "_rid": "r", "_self": "s", "_etag": '"e"', "_ts": 1}
        self.items[(body[self.pk], body["id"])] = item
        return item

    def read_item(self, item: str, partition_key: str) -> dict:
        self._check()
        if (partition_key, item) not in self.items:
            raise CosmosResourceNotFoundError(message=f"{item} not found")
        return copy.deepcopy(self.items[(partition_key, item)])

    def query_items(self, query: str, parameters=None, partition_key=None, **kwargs):
        """Only the audit sink's query: TOP @n, one match, newest first."""
        self._check()
        params = {p["name"]: p["value"] for p in parameters or []}
        self.queries.append((query, params, partition_key))
        assert "c.match_id = @match_id" in query and "ORDER BY c.decided_at DESC" in query
        assert "TOP @n" in query and partition_key == params["@match_id"]
        rows = [v for (pk, _), v in self.items.items() if pk == partition_key]
        rows.sort(key=lambda v: v["decided_at"], reverse=True)
        return iter(copy.deepcopy(rows[: params["@n"]]))


class FakeDatabase:
    def __init__(self, containers: dict[str, FakeContainer]) -> None:
        self.containers = containers

    def get_container_client(self, name: str) -> FakeContainer:
        return self.containers[name]


class FakeCosmos:
    """A CosmosClient whose account already has the provisioned containers."""

    def __init__(self) -> None:
        self.databases: dict[str, FakeDatabase] = {}

    def get_database_client(self, name: str) -> FakeDatabase:
        if name not in self.databases:
            containers = {n: FakeContainer(pk) for n, pk in PARTITION_KEYS.items()}
            self.databases[name] = FakeDatabase(containers)
        return self.databases[name]


def _record(match: str, n: int) -> AuditRecord:
    at = datetime(2026, 10, 21, 12, 0, tzinfo=UTC) + timedelta(seconds=n)
    return AuditRecord(
        id=f"{match}#{n}", match=match, match_id=match, run_hash="ab" * 32, counterfactuals=[],
        claim={"id": f"c{n}"}, claim_fingerprint=f"f{n}",
        verdict={"status": "supported", "reason": "holds", "trace": []},
        started_at=at.isoformat(), decided_at=(at + timedelta(milliseconds=5)).isoformat(),
        duration_ms=5.0, verifier_version="1",
    )  # fmt: skip


# --- the result cache: id = content key, partition key /kind -------------------------------------


def test_result_cache_round_trip():
    container = FakeContainer("/kind")
    cache = CosmosResultCache(container, "breakdowns")
    value = {"source": "offline", "result": {"scripts": [{"lines": ["一", "two"]}]}}
    assert cache.get("k1") is None
    cache.put("k1", value)
    item = container.items[("breakdowns", "k1")]
    assert item["id"] == "k1" and item["kind"] == "breakdowns" and item["value"] == value
    assert CosmosResultCache(container, "breakdowns").get("k1") == value  # a new replica reads it
    assert CosmosResultCache(container, "whatif").get("k1") is None  # kinds do not mix


def test_result_cache_keeps_working_when_cosmos_fails():
    container = FakeContainer("/kind")
    cache = CosmosResultCache(container, "whatif")
    container.down = True
    cache.put("k1", {"answer": 1})  # logged, not raised
    assert cache.get("k1") == {"answer": 1}  # still served from memory
    assert CosmosResultCache(container, "whatif").get("k1") is None


# --- the claims audit: one item per verdict, partition key /match_id ------------------------------


def test_audit_sink_writes_and_lists_the_newest_verdicts_of_a_match():
    container = FakeContainer("/match_id")
    sink = CosmosAuditSink(container)
    for n in range(4):
        sink.write(_record("blind_side_run:3", n))
    sink.write(_record("blind_side_run:5", 9))
    assert len(container.items) == 5
    stored = container.items[("blind_side_run:3", "blind_side_run:3#0")]
    assert stored["claim"] == {"id": "c0"} and stored["decided_at"].endswith("+00:00")
    recent = sink.recent("blind_side_run:3", limit=2)
    assert [r.id for r in recent] == ["blind_side_run:3#2", "blind_side_run:3#3"]  # oldest first
    assert all(isinstance(r, AuditRecord) for r in recent)
    assert container.queries[-1][2] == "blind_side_run:3"  # a single-partition query
    container.down = True
    sink.write(_record("blind_side_run:3", 7))  # logged, not raised
    assert sink.recent("blind_side_run:3") == []


# --- selection by environment --------------------------------------------------------------------


def test_file_store_unless_a_cosmos_endpoint_is_set(monkeypatch, tmp_path):
    monkeypatch.delenv("TTE_COSMOS_ENDPOINT", raising=False)
    monkeypatch.delenv("TTE_COSMOS_DATABASE", raising=False)
    monkeypatch.setenv("TTE_CACHE_DIR", str(tmp_path))
    settings = Settings.from_env()
    assert settings.cosmos_endpoint == "" and settings.cosmos_database == "tte"
    storage = open_storage(settings, cosmos_client=FakeCosmos())
    assert isinstance(storage.breakdowns, ResultCache) and isinstance(storage.answers, ResultCache)
    assert storage.audit is None  # each match keeps its verdicts in memory, as before


def test_cosmos_store_when_the_endpoint_is_set(monkeypatch):
    monkeypatch.setenv("TTE_COSMOS_ENDPOINT", "https://tte-test.documents.azure.com:443/")
    monkeypatch.delenv("TTE_COSMOS_DATABASE", raising=False)
    fake = FakeCosmos()
    storage = open_storage(Settings.from_env(), cosmos_client=fake)
    assert isinstance(storage.breakdowns, CosmosResultCache)
    assert isinstance(storage.audit, CosmosAuditSink)
    storage.breakdowns.put("k", {"v": 1})
    storage.answers.put("k", {"v": 2})
    cache = fake.databases["tte"].containers["cache"]
    assert set(cache.items) == {("breakdowns", "k"), ("whatif", "k")}

    monkeypatch.setenv("TTE_COSMOS_DATABASE", "tte-staging")
    open_storage(Settings.from_env(), cosmos_client=fake).audit.write(_record("m:1", 0))
    assert fake.databases["tte-staging"].containers["claims_audit"].items


def test_a_cosmos_endpoint_needs_a_credential(monkeypatch):
    monkeypatch.setenv("TTE_COSMOS_ENDPOINT", "https://tte-test.documents.azure.com:443/")
    with pytest.raises(ValueError, match="credential"):
        open_storage(Settings.from_env())


# --- the service on Cosmos DB --------------------------------------------------------------------


def test_the_api_caches_and_audits_in_cosmos_when_configured(tmp_path):
    settings = Settings(matches=[("blind_side_run", 3)], cache_dir=tmp_path,
                        cosmos_endpoint="https://tte-test.documents.azure.com:443/")  # fmt: skip
    fake = FakeCosmos()
    body = {"match": "blind_side_run-3", "personas": ["analyst"], "languages": ["en"]}
    with TestClient(create_app(settings, cosmos_client=fake)) as c:
        first = c.post("/api/breakdowns", json=body).json()
        records = c.get("/api/matches/blind_side_run-3/audit?limit=3").json()
    with TestClient(create_app(settings, cosmos_client=fake)) as c:  # a restart
        again = c.post("/api/breakdowns", json=body).json()
    db = fake.databases["tte"]
    assert first["cached"] is False and again["cached"] is True and again["key"] == first["key"]
    assert ("breakdowns", first["key"]) in db.containers["cache"].items
    assert not list(tmp_path.iterdir())  # nothing went to the file store
    audit = db.containers["claims_audit"].items
    assert audit and {pk for pk, _ in audit} == {"blind_side_run:3"}
    assert len(records) == 3 and {"claim", "verdict", "decided_at"} <= set(records[0])


def test_tamper_checks_never_reach_cosmos(tmp_path):
    """POST /api/verify runs the verifier without the audit sink: anyone can call it (SPEC 8)."""
    settings = Settings(matches=[("blind_side_run", 3)], cache_dir=tmp_path,
                        cosmos_endpoint="https://tte-test.documents.azure.com:443/")  # fmt: skip
    fake = FakeCosmos()
    body = {"match": "blind_side_run-3", "claim": "cf_value", "slot": "dxt", "value": 0.5}
    with TestClient(create_app(settings, cosmos_client=fake)) as c:
        c.get("/api/matches/blind_side_run-3/moments")  # loads the match: its claims are audited
        db = fake.databases["tte"]
        before = {n: copy.deepcopy(k.items) for n, k in db.containers.items()}
        out = c.post("/api/verify", json=body).json()
    assert out["status"] == "refuted"
    assert {n: k.items for n, k in db.containers.items()} == before
