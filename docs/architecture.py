"""The architecture diagram for the README and the video's closing segment (SPEC 2, 10).

    python3 docs/architecture.py                         # docs/architecture.svg and -dark.svg
    python3 docs/architecture.py --png --chrome <path to chrome-headless-shell>
                                                         # also docs/architecture.png (dark)

Boxes are placed by hand on a 1920×1080 canvas, the video frame, and written as plain SVG with the
standard library only, so the diagram is diffable and one command regenerates it. Both themes share
the same body; only the style sheet differs. The PNG is a screenshot of the dark SVG (the web app is
dark) by chrome-headless-shell, Chrome for Testing's headless build (Playwright installs it as
chromium_headless_shell); nothing is installed for it. Full Chrome's --headless counts a hidden
window frame in --window-size and leaves the bottom of the PNG blank.

Everything drawn must be true of main (SPEC 11, "claim only what we use").
tests/test_architecture.py checks that the diagram names every component, agrees with the code,
and that the committed files are what this script writes.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import struct
import subprocess
import tempfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

DOCS = Path(__file__).resolve().parent
W, H = 1920, 1080
MAX_REWRITES = 2  # agents/workflow.py; the test checks they agree
SANS = "'Segoe UI', 'Helvetica Neue', Inter, Arial, 'Liberation Sans', sans-serif"
MONO = "'Cascadia Mono', 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace"


@dataclass(frozen=True)
class Theme:
    bg: str
    panel: str
    line: str
    fg: str
    muted: str
    wire: str
    model: str  # agent steps that call the model
    model_fill: str
    code: str  # deterministic steps
    code_fill: str
    azure: str  # Azure and GitHub services
    azure_fill: str


# Dark follows web/src/styles.css, so the video's closing frame matches the app.
DARK = Theme(
    bg="#0b1210", panel="#111a17", line="#2b3d35", fg="#e6eee9", muted="#9db3a9", wire="#8ea39a",
    model="#7fb2ff", model_fill="#122036", code="#ffd36b", code_fill="#272210",
    azure="#a6ecff", azure_fill="#0e2228",
)  # fmt: skip
LIGHT = Theme(
    bg="#ffffff", panel="#f4f7f5", line="#c9d4ce", fg="#13201a", muted="#4a5d55", wire="#5d7068",
    model="#1d5bd6", model_fill="#eaf1ff", code="#8a5a00", code_fill="#fff4d6",
    azure="#03789b", azure_fill="#e4f5fa",
)  # fmt: skip
THEMES = {"light": LIGHT, "dark": DARK}


def style(t: Theme) -> str:
    return f"""
.bg {{ fill: {t.bg}; }}
.panel {{ fill: {t.panel}; stroke: {t.line}; stroke-width: 2; }}
.model {{ fill: {t.model_fill}; stroke: {t.model}; stroke-width: 2.5; }}
.code {{ fill: {t.code_fill}; stroke: {t.code}; stroke-width: 2.5; }}
.azure {{ fill: {t.azure_fill}; stroke: {t.azure}; stroke-width: 2; }}
.dashed {{ stroke-dasharray: 9 7; }}
.wire {{ fill: none; stroke: {t.wire}; stroke-width: 2.5; }}
.head {{ fill: {t.wire}; }}
text {{ fill: {t.fg}; }}
.muted {{ fill: {t.muted}; }}
.c-model {{ fill: {t.model}; }}
.c-code {{ fill: {t.code}; }}
.c-azure {{ fill: {t.azure}; }}
.mono {{ font-family: {MONO}; }}
.b {{ font-weight: 700; }}
.sb {{ font-weight: 600; }}
.caps {{ letter-spacing: 2px; }}
""".strip()


class Canvas:
    def __init__(self) -> None:
        self.parts: list[str] = []

    def rect(self, x: float, y: float, w: float, h: float, cls: str, rx: float = 14) -> None:
        box = f'x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"'
        self.parts.append(f'<rect {box} class="{cls}"/>')

    def text(
        self, x: float, y: float, lines: str | list[str], size: int, cls: str = "",
        lh: float | None = None, anchor: str = "start",
    ) -> None:  # fmt: skip
        """One <text>; each line is a <tspan> `lh` below the last (default 1.25 × size)."""
        lines = [lines] if isinstance(lines, str) else lines
        lh = lh or round(size * 1.25)
        attrs = f' class="{cls}"' if cls else ""
        attrs += f' text-anchor="{anchor}"' if anchor != "start" else ""
        spans = "".join(
            f'<tspan x="{x}" dy="{0 if i == 0 else lh}">{escape(line)}</tspan>'
            for i, line in enumerate(lines)
        )
        self.parts.append(f'<text x="{x}" y="{y}" font-size="{size}"{attrs}>{spans}</text>')

    def wire(
        self, d: str, arrow: bool = True, dashed: bool = False, edge: str = "", group: str = ""
    ) -> None:
        """A connector. `edge` ("source target") and `group` name the workflow edge it draws, so
        tests can compare the drawing with the graph agents/workflow.py builds."""
        cls = "wire dashed" if dashed else "wire"
        attrs = ' marker-end="url(#head)"' if arrow else ""
        attrs += f' data-edge="{edge}" data-group="{group}"' if edge else ""
        self.parts.append(f'<path d="{d}" class="{cls}"{attrs}/>')

    def open(self, gid: str) -> None:
        self.parts.append(f'<g id="{gid}">')

    def close(self) -> None:
        self.parts.append("</g>")


def node(
    c: Canvas, gid: str, x: float, y: float, w: float, h: float, kind: str, name: str,
    desc: list[str], tag: str,
) -> None:  # fmt: skip
    """A workflow step: name, two short lines, and a tag naming who does the work."""
    c.open(gid)
    c.rect(x, y, w, h, kind, rx=12)
    c.text(x + 18, y + 36, name, 26, "b")
    if tag:
        c.text(x + w - 14, y + 30, tag, 16, f"sb c-{kind}", anchor="end")
    c.text(x + 18, y + 66, desc, 19, "muted", lh=24)
    c.close()


def pipeline(c: Canvas) -> None:
    """The brief's five stages over the repo's top-level packages."""
    stages = [
        ("ingest", "1  INGEST", "sim/",
         ["synthetic matches at 25 Hz", "scans, vision and belief",
          "counterfactual re-simulation"]),
        ("interpret", "2  INTERPRET", "analytics/",
         ["pitch control, pressing, xT", "time to intercept, vision",
          "scan detector from head yaw"]),
        ("explain", "3  EXPLAIN", "explain/",
         ["moments; lens picked by", "counterfactual impact", "claims + Verifier (code)"]),
        ("render", "4  RENDER", "agents/ + api/",
         ["the agent crew below", "FastAPI: live WebSocket,", "breakdowns, what-if, TTS"]),
        ("personalize", "5  PERSONALIZE", "web/",
         ["React + three.js replay:", "first person and tactical", "persona × language (en, zh)"]),
    ]  # fmt: skip
    x, y, w, h, gap = 48, 146, 332, 172, 41
    c.open("pipeline")
    for i, (gid, stage, module, desc) in enumerate(stages):
        left = x + i * (w + gap)
        c.open(gid)
        c.rect(left, y, w, h, "panel")
        c.text(left + 20, y + 34, stage, 18, "b caps muted")
        c.text(left + 20, y + 72, module, 30, "mono b")
        c.text(left + 20, y + 106, desc, 20, "muted", lh=25)
        c.close()
        if i < len(stages) - 1:
            c.wire(f"M{left + w + 6},{y + h / 2} H{left + w + gap - 6}")
    c.close()


def workflow(c: Canvas) -> None:
    """agents/workflow.py: the executors, their typed edges, and the MCP server."""
    c.open("workflow")
    c.rect(48, 342, 1824, 474, "panel", rx=18)
    c.text(80, 384, "agents/  ·  Microsoft Agent Framework workflow", 27, "b")
    c.text(
        80, 414,
        "one typed message per edge · Telestrator and narration run concurrently · "
        "a span per step in Application Insights",
        19, "muted",
    )  # fmt: skip

    # Shared state every executor reads.
    c.open("shared-state")
    c.rect(80, 444, 432, 38, "panel", rx=19)
    c.text(98, 469, "shared state: MomentCard + verified claims", 19, "muted")
    c.close()
    c.wire("M195,482 V516")

    top, mid, low, h = 446, 518, 590, 104  # node tops: upper lane, middle row, lower lane
    node(c, "director", 80, mid, 230, h, "model", "Director",
         ["builds the request;", "model sets priority"], "Foundry")  # fmt: skip
    node(c, "analyst", 350, mid, 240, h, "model", "Analyst",
         ["picks the lens and", "headline claim ids"], "Foundry")  # fmt: skip
    node(c, "telestrator", 700, top, 340, h, "model", "Telestrator",
         ["camera, freeze, POV, ghosts;", "validated, else template plan"], "Foundry")  # fmt: skip
    node(c, "narration", 700, low, 340, h, "model", "Narration",
         ["Commentator + Co-commentator", "lines anchored to claim ids"], "Foundry")  # fmt: skip
    node(c, "verifier", 1110, low, 240, h, "code", "Verifier",
         ["no model: checks", "every line"], "code")  # fmt: skip
    node(c, "voice", 1450, mid, 200, h, "code", "Voice",
         ["SSML, two voices", "per language"], "code")  # fmt: skip
    node(c, "breakdown", 1680, mid, 160, h, "panel", "Result",
         ["plan, script,", "voice cues"], "")  # fmt: skip

    cy = mid + h / 2  # 570: the middle row's centre line
    ty, ly = top + h / 2 - 4, low + h / 2 - 4  # lane wires, a little above centre
    c.wire(f"M310,{cy} H348", edge="director analyst", group="single")
    c.wire(f"M590,{cy} H640", arrow=False)
    c.wire(f"M640,{cy} V{ty} H698", edge="analyst telestrator", group="fan-out")
    c.wire(f"M640,{cy} V{ly} H698", edge="analyst narration", group="fan-out")
    c.text(640, ty - 16, "fan-out", 19, "muted", anchor="middle")
    c.wire(f"M1040,{ly} H1108", edge="narration verifier", group="single")
    c.wire(f"M1170,{low} V{cy} H962 V{low - 2}", edge="verifier narration", group="single")
    c.text(1184, cy + 9, f"rewrite ≤ {MAX_REWRITES}, then drop", 19, "muted")
    c.wire(f"M1040,{ty} H1400 V{cy} H1448", edge="telestrator voice", group="single")
    c.wire(f"M1350,{ly} H1400 V{cy}", arrow=False, edge="verifier voice", group="single")
    c.text(1400, ty - 16, "joined in code", 19, "muted", anchor="middle")
    c.wire(f"M1650,{cy} H1678")  # Voice → result

    # The Analyst's MCP tools: a subprocess per model breakdown, in the API and the CLI.
    c.open("mcp")
    c.wire("M455,622 V662")
    c.wire("M495,664 V624")
    c.rect(330, 664, 290, 140, "code", rx=12)
    c.text(348, 694, "MCP tool server", 22, "b")
    c.text(348, 722, ["10 tools: moment, claims,", "stats, vision, pitch control,",
                      "xT, pressing, re-sim, what-if"], 19, "muted", lh=24)  # fmt: skip
    c.text(348, 792, "TTE_ANALYST_MCP", 18, "mono c-code")
    c.close()

    # What "verified" means, under the steps it governs.
    c.open("verifier-detail")
    c.rect(700, 718, 1140, 88, "code", rx=12)
    c.text(720, 746, "Deterministic Verifier  ·  explain/verifier.py, explain/render.py", 20,
           "b c-code")  # fmt: skip
    c.text(
        720, 772,
        ["Claims are predicates checked against the simulated match; every verdict is written "
         "to the claims audit.",
         "A line airs only with supported claims, numbers from verified slots and no banned "
         "judgement words."],
        19, "muted", lh=24,
    )  # fmt: skip
    c.close()
    c.close()


def azure(c: Canvas) -> None:
    """Where it runs: one card per service, saying what uses it."""
    cards = [
        ("foundry", "Microsoft Foundry", "gpt-4.1-mini", 238,
         ["structured outputs for", "every model step and", "what-if questions"]),
        ("speech", "Azure AI Speech", "neural TTS", 244,
         ["speaks the SSML from", "the Voice step through", "/api/tts; audio cached",
          "by content hash"]),
        ("container-apps", "Azure Container Apps", "tte-api", 266,
         ["runs api/ and the crew;", "keyless managed identity", "for Foundry, Cosmos DB",
          "and Container Registry"]),
        ("static-website", "Azure Storage", "static website", 232,
         ["hosts web/, the static", "React build, uploaded", "with Entra ID, no keys"]),
        ("cosmos", "Azure Cosmos DB", "serverless", 230,
         ["cache: breakdowns,", "what-if answers", "claims_audit: every", "claim verdict"]),
        ("app-insights", "Application Insights", "OpenTelemetry", 252,
         ["one trace per", "breakdown, a span per", "step with its source",
          "(model or template)"]),
        ("github-actions", "GitHub Actions", "OIDC deploy", 266,
         ["CI on PRs and on main;", "a green main rolls out", "the API and the web app",
          "with no stored secret"]),
    ]  # fmt: skip
    x, y, h, gap = 48, 840, 200, 16
    c.open("azure")
    for gid, name, sub, w, desc in cards:
        c.open(gid)
        c.rect(x, y, w, h, "azure", rx=12)
        c.text(x + 18, y + 36, name, 21, "b")
        c.text(x + 18, y + 64, sub, 18, "mono c-azure")
        c.text(x + 18, y + 100, desc, 19, "muted", lh=24)
        c.close()
        x += w + gap
    c.close()


def header(c: Canvas) -> None:
    c.text(48, 84, "Through Their Eyes  ·  architecture", 44, "b")
    c.text(48, 120, "Synthetic matches only. Every number on screen is checked by code before "
                    "it airs.", 22, "muted")  # fmt: skip
    # Legend, right-aligned to the panels.
    c.open("legend")
    c.rect(1290, 58, 34, 22, "model", rx=6)
    c.text(1336, 76, "model step on Microsoft Foundry, template fallback", 19)
    c.rect(1290, 96, 34, 22, "code", rx=6)
    c.text(1336, 114, "deterministic code", 19)
    c.close()


DESC = (
    "The brief's pipeline Ingest, Interpret, Explain, Render, Personalize over sim/, analytics/, "
    "explain/, agents/ + api/ and web/. The Microsoft Agent Framework workflow: Director, Analyst "
    "(with our MCP tool server), then Telestrator and narration concurrently, "
    "narration and the deterministic Verifier in a rewrite loop, and Voice joining both lanes. "
    "It runs on Microsoft Foundry, Azure AI Speech, Azure Container Apps, an Azure Storage static "
    "website, Azure Cosmos DB, Application Insights and GitHub Actions."
)


def render(theme: Theme) -> str:
    c = Canvas()
    header(c)
    pipeline(c)
    workflow(c)
    azure(c)
    body = "\n".join(c.parts)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc" font-family="{SANS}">
<title id="title">Through Their Eyes architecture</title>
<desc id="desc">{escape(DESC)}</desc>
<defs>
<style>
{style(theme)}
</style>
<marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="head"/></marker>
</defs>
<rect width="{W}" height="{H}" class="bg"/>
{body}
</svg>
"""  # noqa: E501


def outputs() -> dict[Path, str]:
    return {
        DOCS / "architecture.svg": render(LIGHT),
        DOCS / "architecture-dark.svg": render(DARK),
    }


def export_png(svg: Path, png: Path, chrome: str) -> None:
    """Screenshot `svg` at 1920×1080 with chrome-headless-shell."""
    with tempfile.TemporaryDirectory() as profile:
        args = [
            chrome, "--headless", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=1", f"--window-size={W},{H}",
            f"--user-data-dir={profile}", f"--screenshot={png}", svg.as_uri(),
        ]  # fmt: skip
        if getattr(os, "geteuid", lambda: 1)() == 0:
            args.insert(1, "--no-sandbox")  # Chromium refuses to run as root with its sandbox
        subprocess.run(args, check=True, capture_output=True, timeout=120)
    stamp(png, svg)


def stamp(png: Path, svg: Path) -> None:
    """Record which SVG the PNG shows (a tEXt chunk before IEND), so a test can tell when the PNG
    is older than the diagram."""
    digest = hashlib.sha256(svg.read_bytes()).hexdigest()
    data = b"source\0" + f"{svg.name} sha256:{digest}".encode("latin-1")
    chunk = struct.pack(">I", len(data)) + b"tEXt" + data
    chunk += struct.pack(">I", zlib.crc32(b"tEXt" + data))
    png_bytes = png.read_bytes()
    end = png_bytes.rindex(b"IEND") - 4  # the IEND chunk's length field
    png.write_bytes(png_bytes[:end] + chunk + png_bytes[end:])


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the architecture diagram.")
    parser.add_argument("--png", action="store_true", help="also write docs/architecture.png")
    parser.add_argument("--chrome", help="chrome-headless-shell binary for --png")
    parser.add_argument("--theme", choices=THEMES, default="dark", help="the PNG's theme")
    args = parser.parse_args()
    for path, svg in outputs().items():
        path.write_text(svg, encoding="utf-8")
        print(f"wrote {path.relative_to(DOCS.parent)}")
    if args.png:
        if not args.chrome:
            parser.error("--png needs --chrome <path to chrome-headless-shell>")
        name = "architecture-dark.svg" if args.theme == "dark" else "architecture.svg"
        export_png(DOCS / name, DOCS / "architecture.png", args.chrome)
        print("wrote docs/architecture.png")


if __name__ == "__main__":
    main()
