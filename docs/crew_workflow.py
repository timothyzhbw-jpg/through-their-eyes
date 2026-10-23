"""The crew's workflow diagram, drawn by Microsoft Agent Framework itself (SPEC 6).

    uv run python docs/crew_workflow.py            # docs/crew_workflow.mmd, .dot, .svg, -dark.svg
    uv run python docs/crew_workflow.py --check   # exit 1 if a committed file has drifted

WorkflowViz(build_workflow(Crew(None, None))) supplies the graph. to_mermaid() and to_digraph()
are kept verbatim, then annotations derived from the code are appended and marked as not drawn by
WorkflowViz: the MCP tool server and its tools, the Verifier rewrite loop (at most MAX_REWRITES
rounds), and the failure drill with checkpoint bring-back. Templates are left off so the diagram
stays readable. The SVGs are Graphviz renderings of the DOT, light and a dark variant held only
in memory. Without `dot` on PATH the text files are still written and the process exits 2,
printing the Docker command that renders them. tests/test_crew_workflow_diagram.py fails when the
committed files drift.
"""

from __future__ import annotations

import argparse
import asyncio
import functools
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

from agent_framework import WorkflowViz

# The repo root, so `agents` imports when this file runs as a script from docs/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.mcp_server import build_server  # noqa: E402
from agents.workflow import (  # noqa: E402
    MAX_REWRITES,
    AgentBack,
    AgentDown,
    Analyst,
    Crew,
    Verifier,
    build_workflow,
)

DOCS = Path(__file__).resolve().parent
MMD = DOCS / "crew_workflow.mmd"
DOT = DOCS / "crew_workflow.dot"
SVG = DOCS / "crew_workflow.svg"
SVG_DARK = DOCS / "crew_workflow-dark.svg"

_NOTE = "Annotations from the code (agents/…), not drawn by WorkflowViz:"
_DRILL = "Producer desk failure drill · Agent Framework checkpoint storage (every superstep)"
_MCP_EDGE = "tool calls (high priority)"
_DOWN = "down: template, then request_info(AgentDown)"
_BACK = "AgentBack: re-run from the latest checkpoint"
# One two-way edge per agent step; what the two directions mean is in the drill node's label.
_DRILL_LABEL = f"{_DRILL}\n→ {_DOWN}\n← {_BACK}"
# `filled` is required for fillcolor to paint; `dashed` sets the notes apart from WorkflowViz.
_NOTE_STYLE = 'style="filled,dashed", fillcolor="#fff8e1", fontcolor="#13201a"'
_NOTE_IDS = ("mcp", "rewrite", "drill")
_DIGRAPH_OPEN = "digraph Workflow {\n"
# WorkflowViz's own edge default. Colours stated before it lose to it.
_VIZ_EDGE_DEFAULT = "  edge [color=black, arrowhead=vee];\n"
_DARK_DEFAULTS = (
    '  graph [bgcolor="#0d1117", fontcolor="#e6edf3"];\n'
    '  node [fontcolor="#e6edf3", color="#c9d1d9", fillcolor="#161b22"];\n'
    '  edge [color="#c9d1d9", fontcolor="#e6edf3"];\n'
)
_NAMED_LIGHT_FILL = re.compile(
    r'"([^"]+)" \[[^\[\]]*fillcolor=(lightgreen|lightgoldenrod|lightblue)\b'
)
_ARROW = re.compile(r"<-->|==>|-\.->|-->")
_RENDER_WITH_DOT = (
    'docker run --rm -v "$PWD":/app -w /app python:3.11-slim bash -c '
    '"apt-get update -qq && apt-get install -y -qq graphviz >/dev/null && '
    "pip install -q uv && uv sync --locked -q && "
    'uv run --no-sync python docs/crew_workflow.py"'
)


@functools.cache
def _workflow():
    return build_workflow(Crew(None, None))


def mcp_tools() -> list[str]:
    """Tool names the Analyst's MCP server exposes, in the server's order."""
    server = build_server(None)
    return [tool.name for tool in asyncio.run(server.list_tools())]


def annotated_steps() -> list[str]:
    """Executor ids that ask to be brought back, in the workflow's order."""
    pair = (AgentDown, AgentBack)
    return [
        executor_id
        for executor_id, executor in _workflow().executors.items()
        if pair in executor._response_handlers
    ]


def source_hash(text: str) -> str:
    """sha256 hex of `text` as UTF-8, the digest stamped into each SVG."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _executor_id(kind: type) -> str:
    found = [eid for eid, executor in _workflow().executors.items() if isinstance(executor, kind)]
    if len(found) != 1:
        raise RuntimeError(f"expected one {kind.__name__} executor, found {found}")
    return found[0]


def _note_ids() -> tuple[str, str, str]:
    clash = set(_NOTE_IDS) & set(_workflow().executors)
    if clash:
        raise RuntimeError(f"annotation ids clash with executors: {sorted(clash)}")
    return _NOTE_IDS


def _rewrite_label() -> str:
    return f"rewrite ≤ {MAX_REWRITES} rounds, then drop the line"


def _dot_escape(label: str) -> str:
    return label.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _note(node_id: str, label: str) -> str:
    return f'  "{node_id}" [label="{_dot_escape(label)}", {_NOTE_STYLE}];'


def _dot_annotations() -> str:
    _note_ids()
    analyst, verifier = _executor_id(Analyst), _executor_id(Verifier)
    mcp_label = "MCP tool server (stdio)\n" + "\n".join(mcp_tools())
    lines = [
        f"  // {_NOTE}",
        _note("mcp", mcp_label),
        _note("rewrite", _rewrite_label()),
        _note("drill", _DRILL_LABEL),
        f'  {{ rank=same; "{analyst}"; "mcp"; }}',
        f'  {{ rank=same; "{verifier}"; "rewrite"; }}',
        '  { rank=sink; "drill"; }',
        f'  "{analyst}" -> "mcp" [style=dashed, dir=both, label="{_MCP_EDGE}"];',
        f'  "rewrite" -> "{verifier}" [style=dotted, arrowhead=none];',
    ]
    for step in annotated_steps():
        # constraint=false: the drill's edges do not move WorkflowViz's ranks.
        lines.append(f'  "{step}" -> "drill" [style=dashed, dir=both, constraint=false];')
    return "\n" + "\n".join(lines) + "\n"


def _arrow_count(text: str) -> int:
    return len(_ARROW.findall(text))


def _mermaid_annotations(drawn: str) -> str:
    mcp, rewrite, drill = _note_ids()
    analyst, verifier = _executor_id(Analyst), _executor_id(Verifier)
    tools = "<br/>".join(mcp_tools())
    lines = [
        f"  %% {_NOTE}",
        f'  {mcp}["MCP tool server (stdio)<br/>{tools}"];',
        f'  {rewrite}["{_rewrite_label()}"];',
        f'  {drill}["{_DRILL}<br/>→ {_DOWN}<br/>← {_BACK}"];',
    ]
    edges = [
        (f'{analyst} <-->|"{_MCP_EDGE}"| {mcp};', "dashed"),
        (f"{rewrite} -.-> {verifier};", "dotted"),
    ]
    for step in annotated_steps():
        edges.append((f"{step} <--> {drill};", "dashed"))
    lines.extend(f"  {edge}" for edge, _style in edges)
    # linkStyle numbers every arrow in order, WorkflowViz's included.
    start = _arrow_count(drawn)
    for offset, (_edge, style) in enumerate(edges):
        dash = "5 5" if style == "dashed" else "1 3"
        lines.append(f"  linkStyle {start + offset} stroke-dasharray:{dash};")
    lines.append("  classDef note stroke-dasharray:5 5,fill:#fff8e1,stroke:#8a5a00;")
    lines.append(f"  class {','.join(_note_ids())} note;")
    return "\n".join(lines) + "\n"


def mermaid() -> str:
    drawn = WorkflowViz(_workflow()).to_mermaid()
    return drawn + "\n\n" + _mermaid_annotations(drawn)


def _keep_light_fills_readable(text: str) -> str:
    """A node that names a light fill keeps it. The dark theme's default font is light, so
    restate a dark font on that node or the label sinks into the fill."""
    nodes = _NAMED_LIGHT_FILL.findall(text)
    if not nodes:
        return text
    extra = "\n".join(f'  "{node}" [fontcolor="#13201a"];' for node, _fill in nodes)
    head, brace, tail = text.rpartition("}")
    return f"{head}{extra}\n{brace}{tail}"


def _darken(text: str) -> str:
    """Same graph, dark ground. WorkflowViz's lines stay. Graph, node and edge defaults go in
    right after `digraph Workflow {`. They apply only to objects declared later, and WorkflowViz
    then sets fillcolor and the edge colour, so the same defaults are stated again after those
    lines, where they win."""
    if not text.startswith(_DIGRAPH_OPEN):
        raise RuntimeError("WorkflowViz digraph did not open with 'digraph Workflow {'")
    text = _DIGRAPH_OPEN + _DARK_DEFAULTS + text[len(_DIGRAPH_OPEN) :]
    if _VIZ_EDGE_DEFAULT not in text:
        raise RuntimeError("WorkflowViz edge default changed; the dark theme would not apply")
    text = text.replace(_VIZ_EDGE_DEFAULT, _VIZ_EDGE_DEFAULT + _DARK_DEFAULTS, 1)
    return _keep_light_fills_readable(text)


def dot(dark: bool = False) -> str:
    drawn = WorkflowViz(_workflow()).to_digraph()
    if not drawn.endswith("}"):
        raise RuntimeError("WorkflowViz digraph did not end with '}'")
    text = drawn[:-1] + _dot_annotations() + "}\n"
    return _darken(text) if dark else text


def _stamp(svg: str, source: str) -> str:
    """The line after the XML declaration names the DOT this SVG was drawn from."""
    comment = f"<!-- crew_workflow source sha256: {source_hash(source)} -->"
    lines = svg.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if line.startswith("<?xml") and "?>" in line:
            lines.insert(index + 1, comment + "\n")
            return "".join(lines)
    raise RuntimeError("Graphviz SVG has no <?xml ...?> declaration")


def _render_svg(path: Path, source: str) -> None:
    rendered = subprocess.run(
        ["dot", "-Tsvg"], input=source, capture_output=True, text=True, check=True
    )
    path.write_text(_stamp(rendered.stdout, source), encoding="utf-8")


def _check() -> int:
    """Exit status: 0 when the committed files match, 1 and the file's name when one does not."""
    expected = {MMD: mermaid(), DOT: dot()}
    bad: list[Path] = []
    for path, text in expected.items():
        if not path.is_file() or path.read_text(encoding="utf-8") != text:
            bad.append(path)
    for path, source in ((SVG, dot()), (SVG_DARK, dot(dark=True))):
        comment = f"<!-- crew_workflow source sha256: {source_hash(source)} -->"
        if not path.is_file() or comment not in path.read_text(encoding="utf-8"):
            bad.append(path)
    for path in bad:
        print(f"{path.relative_to(DOCS.parent)} differs")
    return 1 if bad else 0


def _write() -> None:
    for path, text in ((MMD, mermaid()), (DOT, dot())):
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(DOCS.parent)}")
    if shutil.which("dot") is None:
        print(_RENDER_WITH_DOT)
        raise SystemExit(2)
    for path, source in ((SVG, dot()), (SVG_DARK, dot(dark=True))):
        _render_svg(path, source)
        print(f"wrote {path.relative_to(DOCS.parent)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the crew workflow diagram.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="write nothing; exit 1 if a committed file has drifted",
    )
    args = parser.parse_args()
    if args.check:
        raise SystemExit(_check())
    _write()


if __name__ == "__main__":
    main()
