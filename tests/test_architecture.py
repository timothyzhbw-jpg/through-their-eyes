"""The architecture diagram (docs/architecture.py; SPEC 2, 10) cannot silently drift from main.

It must parse, name every component the README and SPEC claim, draw the agent workflow's real edges,
say only what the code does (SPEC 11), and be exactly what the generator writes. Regenerate with
`python3 docs/architecture.py`, and the video frame with `--png --chrome <chrome-headless-shell>`.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import importlib.util
import re
import struct
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import get_args

import pytest

from agents.mcp_server import build_server
from agents.schemas import Language
from agents.workflow import MAX_REWRITES, Crew, build_workflow
from api.store import AUDIT_CONTAINER, CACHE_CONTAINER

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SVGS = [DOCS / "architecture.svg", DOCS / "architecture-dark.svg"]
PNG = DOCS / "architecture.png"
NS = "{http://www.w3.org/2000/svg}"

# Everything the diagram has to name, as a viewer reads it.
COMPONENTS = [
    # The brief's pipeline over the repo's packages.
    "Ingest", "Interpret", "Explain", "Render", "Personalize",
    "sim/", "analytics/", "explain/", "agents/ + api/", "web/",
    # The Agent Framework workflow.
    "Microsoft Agent Framework", "Director", "Analyst", "MCP tool server", "Telestrator",
    "Narration", "Commentator + Co-commentator", "Verifier", "Voice", "fan-out", "fan-in",
    "rewrite",
    # The deterministic Verifier and the claims audit.
    "Deterministic Verifier", "claims audit",
    # Where it runs.
    "Microsoft Foundry", "gpt-4.1-mini", "Azure AI Speech", "Azure Container Apps",
    "Azure Storage static website", "Azure Cosmos DB", "Application Insights", "GitHub Actions",
    "OIDC",
]  # fmt: skip

GROUPS = {"SingleEdgeGroup": "single", "FanOutEdgeGroup": "fan-out", "FanInEdgeGroup": "fan-in"}


@functools.cache
def _generator():
    """docs/architecture.py, loaded from its path (docs/ is not a package)."""
    spec = importlib.util.spec_from_file_location("docs_architecture", DOCS / "architecture.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # its dataclasses look the module up while it loads
    spec.loader.exec_module(module)
    return module


def _text(path: Path) -> str:
    """All visible text in document order: one <text> per phrase, its lines joined by spaces."""
    root = ET.parse(path).getroot()
    phrases = [" ".join(t.itertext()) for t in root.iter(f"{NS}text")]
    return re.sub(r"\s+", " ", " ".join(phrases))


@pytest.fixture(scope="module")
def text() -> str:
    return _text(SVGS[0])


@pytest.mark.parametrize("path", SVGS, ids=lambda p: p.name)
def test_the_svg_parses_and_is_a_video_frame(path):
    root = ET.parse(path).getroot()
    assert root.tag == f"{NS}svg"
    assert (root.get("width"), root.get("height"), root.get("viewBox")) == (
        "1920", "1080", "0 0 1920 1080",
    )  # fmt: skip
    assert root.find(f"{NS}title").text and root.find(f"{NS}desc").text


@pytest.mark.parametrize("component", COMPONENTS)
def test_the_diagram_names_every_component(text, component):
    assert component.lower() in text.lower()


def test_both_themes_say_the_same_thing():
    assert _text(SVGS[0]) == _text(SVGS[1])


def test_the_committed_svgs_are_what_the_generator_writes():
    for path, svg in _generator().outputs().items():
        assert path.read_text(encoding="utf-8") == svg, (
            f"stale {path.name}: python3 docs/architecture.py"
        )


def test_the_png_is_a_1920x1080_frame_of_the_current_svg():
    data = PNG.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", data[16:24]) == (1920, 1080)  # IHDR width, height
    chunks, at = {}, 8
    while at < len(data):
        (length,) = struct.unpack(">I", data[at : at + 4])
        kind, body = data[at + 4 : at + 8], data[at + 8 : at + 8 + length]
        if kind == b"tEXt":
            key, _, value = body.partition(b"\0")
            chunks[key.decode("latin-1")] = value.decode("latin-1")
        at += 12 + length
    name, _, digest = chunks["source"].partition(" sha256:")
    assert name in {p.name for p in SVGS}
    current = hashlib.sha256((DOCS / name).read_bytes()).hexdigest()
    assert digest == current, "stale PNG: python3 docs/architecture.py --png --chrome <path>"


def test_the_drawn_workflow_is_the_graph_the_crew_runs():
    workflow = build_workflow(Crew(ctx=None, client=None))
    real = {
        (GROUPS[type(group).__name__], edge.source_id, edge.target_id)
        for group in workflow.edge_groups
        if type(group).__name__ in GROUPS
        for edge in group.edges
    }
    root = ET.parse(SVGS[0]).getroot()
    drawn = {
        (p.get("data-group"), *p.get("data-edge").split())
        for p in root.iter(f"{NS}path")
        if p.get("data-edge")
    }
    assert drawn == real
    nodes = {g.get("id") for g in root.iter(f"{NS}g")}
    assert set(workflow.executors) <= nodes


def test_numbers_and_names_on_the_diagram_match_the_code(text):
    assert _generator().MAX_REWRITES == MAX_REWRITES
    assert f"rewrite ≤ {MAX_REWRITES}" in text
    tools = asyncio.run(build_server(None).list_tools())
    assert f"{len(tools)} tools" in text
    assert f"{CACHE_CONTAINER}:" in text and f"{AUDIT_CONTAINER}:" in text
    assert f"({', '.join(get_args(Language))})" in text
    # The deployed model: the first candidate infra/m0_provision.sh deploys.
    provision = (ROOT / "infra" / "m0_provision.sh").read_text()
    model = re.search(r"CANDIDATES=\$\{MODEL_CANDIDATES:-([\w.-]+)", provision)[1]
    assert model in text
    deploy = (ROOT / ".github" / "workflows" / "deploy.yml").read_text()
    assert "id-token: write" in deploy and "azure/login" in deploy  # OIDC, no stored secret


def test_mcp_is_labelled_cli_only_while_the_api_does_not_use_it(text):
    """SPEC 11: claim only what we use. The API's breakdowns run without the MCP server today;
    once api/ passes use_mcp, drop the label and the dashed outline."""
    api_uses_mcp = "use_mcp" in (ROOT / "api" / "main.py").read_text()
    labelled = "CLI only, not in the deployed API" in text and "agents.run --mcp" in text
    assert labelled != api_uses_mcp


@pytest.mark.parametrize("path", SVGS, ids=lambda p: p.name)
def test_text_only_no_images_or_outside_references(path):
    """No logos or marks of any kind (CLAUDE.md rule 2): product names are plain text."""
    root = ET.parse(path).getroot()
    assert not list(root.iter(f"{NS}image"))
    for el in root.iter():
        for name, value in el.attrib.items():
            assert not name.endswith("href"), (el.tag, name)
            assert "http" not in value or name == "xmlns", (el.tag, name, value)
