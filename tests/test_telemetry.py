"""Tracing for the agent crew (SPEC 8): one trace per breakdown, one child span per workflow step.

Spans are collected with the OpenTelemetry SDK's in-memory exporter; nothing leaves the process.
"""

import asyncio
import re
from collections import Counter

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from agents import telemetry
from agents.context import MomentContext
from agents.testing import FakeChatClient
from agents.workflow import breakdown
from tests.test_agents import _good_replies

STEPS = ["director", "analyst", "telestrator", "narration", "verifier", "voice"]
ATTRIBUTES = {
    "tte.moment", "tte.personas", "tte.languages", "tte.persona", "tte.language", "tte.speaker",
    "tte.model", "tte.attempts", "tte.source", "tte.error_class", "tte.rewrites", "tte.dropped",
    "tte.ms", "tte.round", "tte.failed", "tte.lines", "tte.down", "tte.bring_back", "tte.resumed",
}  # fmt: skip
ID = re.compile(r"^[\w:.\-]+$")  # ids, names and classes: no spaces, so no sentences


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


@pytest.fixture(scope="module")
def exporter():
    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):  # the global provider can be set only once
        provider = TracerProvider()
        trace.set_tracer_provider(provider)
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    yield exporter
    exporter.shutdown()


def _trace(exporter):
    """(breakdown span, its step spans, every span of the run)."""
    spans = exporter.get_finished_spans()
    (root,) = [s for s in spans if s.name == "breakdown"]
    steps = [s for s in spans if s.parent is not None and s.parent.span_id == root.context.span_id
             and s.name in STEPS]  # fmt: skip
    return root, sorted(steps, key=lambda s: s.start_time), spans


def _only_ids_and_counts(spans, texts):
    for s in spans:
        if s.name in STEPS + ["breakdown"]:
            assert set(s.attributes) <= ATTRIBUTES, f"{s.name}: {set(s.attributes) - ATTRIBUTES}"
            for v in s.attributes.values():
                for item in v if isinstance(v, tuple) else (v,):
                    assert not isinstance(item, str) or ID.match(item), (s.name, item)
        for v in s.attributes.values():  # no span in the trace, ours or Agent Framework's
            assert not any(t in str(v) for t in texts), (s.name, v)


def test_an_offline_breakdown_is_one_trace_with_a_span_per_step(ctx, exporter):
    exporter.clear()
    r = breakdown(ctx, client=None, personas=("casual", "analyst"), languages=("en", "zh"))
    root, steps, spans = _trace(exporter)
    assert root.parent is None
    assert {s.context.trace_id for s in spans} == {root.context.trace_id}
    assert len(steps) == len([s for s in spans if s.name in STEPS])  # all children of breakdown
    assert Counter(s.name for s in steps) == {
        "director": 1, "analyst": 1, "telestrator": 1, "narration": 8, "verifier": 1, "voice": 1,
    }  # fmt: skip
    firsts = list(dict.fromkeys(s.name for s in steps))
    assert firsts == STEPS

    a = root.attributes
    assert a["tte.moment"] == ctx.card.id and a["tte.model"] == "offline"
    assert a["tte.personas"] == ("casual", "analyst") and a["tte.languages"] == ("en", "zh")
    assert a["tte.rewrites"] == 0 and a["tte.dropped"] == sum(len(s.dropped) for s in r.scripts)
    assert a["tte.ms"] > 0

    by = {s.name: s.attributes for s in steps}
    for name in ("director", "analyst", "telestrator"):
        assert by[name]["tte.source"] == "template" and by[name]["tte.attempts"] == 0
        assert "tte.error_class" not in by[name]
    voices = {(s.attributes["tte.persona"], s.attributes["tte.language"],
               s.attributes["tte.speaker"]) for s in steps if s.name == "narration"}  # fmt: skip
    assert voices == {(p, lg, sp) for p in ("casual", "analyst") for lg in ("en", "zh")
                      for sp in ("pbp", "color")}  # fmt: skip
    assert all(s.attributes["tte.source"] == "template" for s in steps if s.name == "narration")
    assert by["verifier"]["tte.source"] == "code" and by["verifier"]["tte.round"] == 0
    assert by["verifier"]["tte.dropped"] == a["tte.dropped"]
    assert by["voice"]["tte.source"] == "code"
    assert by["voice"]["tte.lines"] == sum(len(s.voice) for s in r.scripts)
    assert all(s.attributes["tte.moment"] == ctx.card.id for s in steps)
    assert all(s.status.status_code != StatusCode.ERROR for s in steps)
    _only_ids_and_counts(spans, {line.text for s in r.scripts for line in s.lines})


def test_the_parallel_lanes_overlap_and_stay_children_of_the_breakdown(ctx, exporter):
    """The Telestrator and narration run at the same time; the Verifier waits for both."""
    exporter.clear()
    delays = {"telestrator": 0.4, "pbp": 0.2, "color": 0.2}
    fake = FakeChatClient(_good_replies(ctx), delays=delays)
    breakdown(ctx, client=fake, personas=("analyst",), languages=("en",))
    root, steps, spans = _trace(exporter)
    assert len(steps) == len([s for s in spans if s.name in STEPS])  # all children of breakdown
    assert list(dict.fromkeys(s.name for s in steps)) == STEPS
    (tele,) = [s for s in steps if s.name == "telestrator"]
    narration = [s for s in steps if s.name == "narration"]
    (verifier,) = [s for s in steps if s.name == "verifier"]
    assert len(narration) == 2
    assert all(n.start_time < tele.end_time and tele.start_time < n.end_time for n in narration)
    assert verifier.start_time >= max([tele.end_time] + [n.end_time for n in narration])


def test_a_telestrator_timeout_is_a_template_span_with_the_error_class(ctx, exporter):
    exporter.clear()
    replies = _good_replies(ctx)
    replies["telestrator"] = FakeChatClient.SLOW
    fake = FakeChatClient(replies)
    r = breakdown(ctx, client=fake, personas=("analyst",), languages=("en",), step_timeout_s=0.2)
    root, steps, spans = _trace(exporter)
    assert root.attributes["tte.model"] == "FakeChatClient"
    by = {s.name: s for s in steps}

    tele = by["telestrator"].attributes
    assert tele["tte.source"] == "template" and tele["tte.error_class"] == "TimeoutError"
    assert tele["tte.attempts"] == 2 and tele["tte.ms"] >= 400
    assert by["telestrator"].status.status_code == StatusCode.ERROR
    assert by["telestrator"].status.description == "TimeoutError"
    assert r.plan_source == "template"

    director = by["director"].attributes
    assert director["tte.source"] == "llm" and director["tte.attempts"] == 1
    assert "tte.error_class" not in director
    narration = [s.attributes for s in steps if s.name == "narration"]
    assert {(n["tte.speaker"], n["tte.source"]) for n in narration} == {
        ("pbp", "llm"), ("color", "llm"),
    }  # fmt: skip
    prompts = [p for role in fake.prompts.values() for p in role]
    _only_ids_and_counts(spans, {line.text for s in r.scripts for line in s.lines} | {"ROLE:"})
    assert all(not any(p in str(v) for v in s.attributes.values()) for s in spans for p in prompts)


def test_rewrites_are_narration_spans_and_each_verifier_round_has_a_span(ctx, exporter):
    """A stale claim fails the render check every round: two rewrites, then the line is dropped."""
    import copy

    stale = copy.copy(ctx)
    stale.claims = dict(ctx.claims)
    stale.claims["blind_side"] = ctx.claims["blind_side"].model_copy(
        update={"template": "{runner} ran on the blind side of {player} today."}
    )
    replies = _good_replies(ctx)
    replies["color"] = {"lines": [{"claim": "blind_side", "connective": None}]}
    exporter.clear()
    breakdown(stale, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    root, steps, _ = _trace(exporter)
    rounds = [s.attributes for s in steps if s.name == "verifier"]
    assert [(v["tte.round"], v["tte.failed"], v["tte.dropped"]) for v in rounds] == [
        (0, 1, 0), (1, 1, 0), (2, 1, 1),
    ]  # fmt: skip
    narration = [s.attributes for s in steps if s.name == "narration"]
    rewrites = [(n["tte.round"], n["tte.speaker"]) for n in narration if "tte.round" in n]
    assert rewrites == [(1, "color"), (2, "color")]
    assert root.attributes["tte.rewrites"] == 2 and root.attributes["tte.dropped"] == 1


def test_the_result_names_its_trace(ctx, exporter):
    """The id to look up in Application Insights (operation_Id) is the breakdown span's trace."""
    exporter.clear()
    r = breakdown(ctx, client=None, personas=("analyst",), languages=("en",))
    root, _, _ = _trace(exporter)
    assert r.trace_id == format(root.context.trace_id, "032x")


def test_a_bring_back_is_its_own_trace_with_only_the_steps_that_ran_again(ctx, exporter, tmp_path):
    from agent_framework import FileCheckpointStorage

    from agents.workflow import run_crew

    replies, one = _good_replies(ctx), {"personas": ("analyst",), "languages": ("en",)}
    exporter.clear()
    first = asyncio.run(run_crew(ctx, client=FakeChatClient(replies), down={"telestrator"},
                                 checkpoints=FileCheckpointStorage(tmp_path), **one))  # fmt: skip
    root, steps, _ = _trace(exporter)
    assert root.attributes["tte.down"] == ("telestrator",)
    (tele,) = [s for s in steps if s.name == "telestrator"]
    assert tele.attributes["tte.error_class"] == "AgentDown"

    exporter.clear()
    back = asyncio.run(run_crew(ctx, client=FakeChatClient(replies), bring_back="telestrator",
                                checkpoints=FileCheckpointStorage(tmp_path), **one))  # fmt: skip
    root, steps, spans = _trace(exporter)
    assert root.attributes["tte.bring_back"] == "telestrator"
    assert root.attributes["tte.resumed"] is True
    assert [s.name for s in steps] == ["telestrator", "voice"]
    assert steps[0].attributes["tte.resumed"] is True
    assert steps[0].attributes["tte.source"] == "llm"
    assert back.result.trace_id == format(root.context.trace_id, "032x") != first.result.trace_id
    _only_ids_and_counts(spans, {line.text for s in back.result.scripts for line in s.lines})


def test_error_class_keeps_only_the_exception_name():
    assert telemetry.error_class("TimeoutError: ") == "TimeoutError"
    assert telemetry.error_class("ValueError: no structured output") == "ValueError"
    assert telemetry.error_class(None) is None


def test_azure_monitor_is_configured_only_with_a_connection_string(monkeypatch):
    import azure.monitor.opentelemetry as azmon

    calls = []
    monkeypatch.setattr(azmon, "configure_azure_monitor", lambda **kw: calls.append(kw))
    monkeypatch.setattr(telemetry, "_configured", False)
    monkeypatch.delenv("APPLICATIONINSIGHTS_CONNECTION_STRING", raising=False)
    assert telemetry.configure_tracing() is False and calls == []
    monkeypatch.setenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=00000000-0")
    assert telemetry.configure_tracing() is True and len(calls) == 1
    assert calls[0]["connection_string"] == "InstrumentationKey=00000000-0"
    assert telemetry.configure_tracing() is True and len(calls) == 1  # once per process
