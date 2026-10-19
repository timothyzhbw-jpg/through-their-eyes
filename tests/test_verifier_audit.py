"""Claims audit log (SPEC 5.3): every verdict is written with its inputs and timestamps."""

import json
from datetime import UTC, datetime

import pytest

from explain.audit import AuditRecord, JsonlAuditSink, MemoryAuditSink
from explain.builders import HeroRefs
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.functions import EvalContext
from explain.verifier import Verifier
from sim.engine import Simulation

SCENARIO = "blind_side_run"


@pytest.fixture(scope="module")
def run():
    return Simulation.from_scenario(SCENARIO, seed=3).run()


def _claims(run):
    p = HeroRefs.of(run).hero_pass
    to = fn("event_attr", event=p.id, attr="to")
    return [
        Claim(id="ok", template="{to}", slots={"to": Slot(ref="H9")},
              predicate=Predicate(op="eq", lhs=to, rhs=slot("to"))),
        Claim(id="bad", template="{to}", slots={"to": Slot(ref="H4")},
              predicate=Predicate(op="eq", lhs=to, rhs=slot("to"))),
        Claim(id="unknown", template="",
              predicate=Predicate(op="ge", rhs=0.7, lhs=fn(
                  "metric_at", metric="heart_rate", player="H8", anchor=p.id))),
    ]  # fmt: skip


def _clock():
    ticks = iter(range(100))
    return lambda: datetime(2026, 10, 21, 12, 0, next(ticks), tzinfo=UTC)


def test_every_verdict_is_audited_with_inputs_and_timestamps(run):
    sink = MemoryAuditSink()
    verifier = Verifier(EvalContext(run), sink=sink, clock=_clock())
    verdicts = verifier.verify_all(_claims(run))
    assert [v.status for v in verdicts.values()] == ["supported", "refuted", "inconclusive"]
    assert [r.claim["id"] for r in sink.records] == ["ok", "bad", "unknown"]
    first = sink.records[0]
    assert first.match == f"{SCENARIO}:3"
    assert first.run_hash == run.output_hash()
    assert first.started_at == "2026-10-21T12:00:00+00:00"
    assert first.decided_at == "2026-10-21T12:00:01+00:00"
    assert first.verdict["status"] == "supported"
    assert first.verdict["trace"][0]["lhs"] == "H9"
    assert first.claim["predicate"]["lhs"]["fn"] == "event_attr"
    assert first.claim_fingerprint == _claims(run)[0].fingerprint()
    assert len({r.id for r in sink.records}) == 3
    assert "unknown metric" in sink.records[2].verdict["reason"]


def test_the_jsonl_sink_appends_one_parseable_line_per_verdict(run, tmp_path):
    path = tmp_path / "audit" / "claims.jsonl"
    sink = JsonlAuditSink(path)
    Verifier(EvalContext(run), sink=sink).verify_all(_claims(run))
    Verifier(EvalContext(run), sink=sink).verify(_claims(run)[0])
    lines = path.read_text().splitlines()
    assert len(lines) == 4
    records = [AuditRecord.model_validate(json.loads(line)) for line in lines]
    assert [r.verdict["status"] for r in records] == [
        "supported", "refuted", "inconclusive", "supported"
    ]  # fmt: skip
    for r in records:
        assert datetime.fromisoformat(r.decided_at).tzinfo is not None
        assert r.match_id == r.match  # Cosmos DB partition key


def test_counterfactuals_used_by_a_verdict_are_recorded(run):
    sink = MemoryAuditSink()
    key = run.key_scan().id
    claim = Claim(
        id="cf", template="",
        predicate=Predicate(op="gt", lhs=fn("cf_delta", of="possession_value", scan=key),
                            rhs=0.0),
    )  # fmt: skip
    Verifier(EvalContext(run), sink=sink).verify(claim)
    assert sink.records[0].counterfactuals == [key]
