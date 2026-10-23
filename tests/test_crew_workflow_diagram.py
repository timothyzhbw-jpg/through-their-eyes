"""Acceptance checks for the crew workflow diagram (SPEC 6).

The drawing is Microsoft Agent Framework's own: WorkflowViz on build_workflow(Crew(None, None)).
Regenerate with `uv run python docs/crew_workflow.py` (Graphviz `dot` renders the SVGs; without it
the command writes the text files and exits 2). This module fails when the committed files drift.
"""

from __future__ import annotations

import asyncio
import functools
import importlib.util
import sys
from pathlib import Path

from agent_framework import WorkflowViz

from agents.mcp_server import build_server
from agents.workflow import AgentBack, AgentDown, Crew, build_workflow

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


@functools.cache
def _generator():
    """docs/crew_workflow.py, loaded from its path (docs/ is not a package)."""
    spec = importlib.util.spec_from_file_location("docs_crew_workflow", DOCS / "crew_workflow.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_committed_files_are_what_the_generator_writes():
    gen = _generator()
    mmd = DOCS / "crew_workflow.mmd"
    diagram = DOCS / "crew_workflow.dot"
    assert mmd.read_text(encoding="utf-8") == gen.mermaid(), (
        "stale docs/crew_workflow.mmd: uv run python docs/crew_workflow.py"
    )
    assert diagram.read_text(encoding="utf-8") == gen.dot(), (
        "stale docs/crew_workflow.dot: uv run python docs/crew_workflow.py"
    )


def test_the_files_start_with_workflowviz_output():
    workflow = build_workflow(Crew(None, None))
    viz = WorkflowViz(workflow)
    mermaid = (DOCS / "crew_workflow.mmd").read_text(encoding="utf-8")
    diagram = (DOCS / "crew_workflow.dot").read_text(encoding="utf-8")
    assert mermaid.startswith(viz.to_mermaid())
    drawn = viz.to_digraph()
    assert diagram.startswith(drawn[: drawn.rfind("}")])


def test_every_executor_and_edge_is_in_the_mermaid():
    """WorkflowViz draws every executor and every edge except internal executors, as `a --> b`."""
    workflow = build_workflow(Crew(None, None))
    text = (DOCS / "crew_workflow.mmd").read_text(encoding="utf-8")
    for executor_id in workflow.executors:
        assert executor_id in text
    for group in workflow.edge_groups:
        # WorkflowViz leaves internal executors out unless include_internal_executors is set.
        if type(group).__name__ == "InternalEdgeGroup":
            continue
        for edge in group.edges:
            assert f"{edge.source_id} --> {edge.target_id}" in text


def test_mcp_tools_are_the_servers_and_are_drawn():
    gen = _generator()
    names = [tool.name for tool in asyncio.run(build_server(None).list_tools())]
    assert gen.mcp_tools() == names
    mermaid = (DOCS / "crew_workflow.mmd").read_text(encoding="utf-8")
    diagram = (DOCS / "crew_workflow.dot").read_text(encoding="utf-8")
    for name in names:
        assert name in mermaid
        assert name in diagram


def test_annotated_steps_are_the_bring_back_executors_in_workflow_order():
    gen = _generator()
    workflow = build_workflow(Crew(None, None))
    expected = [
        executor_id
        for executor_id, executor in workflow.executors.items()
        if (AgentDown, AgentBack) in executor._response_handlers
    ]
    assert gen.annotated_steps() == expected
    assert expected == ["director", "analyst", "telestrator", "narration"]


def test_svg_files_carry_the_dot_hash_and_every_executor_title():
    gen = _generator()
    workflow = build_workflow(Crew(None, None))
    pairs = (
        (DOCS / "crew_workflow.svg", gen.dot()),
        (DOCS / "crew_workflow-dark.svg", gen.dot(dark=True)),
    )
    for path, source in pairs:
        assert path.is_file(), path.name
        text = path.read_text(encoding="utf-8")
        assert f"<!-- crew_workflow source sha256: {gen.source_hash(source)} -->" in text
        for executor_id in workflow.executors:
            assert f"<title>{executor_id}</title>" in text
