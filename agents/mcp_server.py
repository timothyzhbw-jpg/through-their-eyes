"""Our MCP tool server (SPEC 6): the Analyst's view of one moment, or of a whole match.

    uv run python -m agents.mcp_server --scenario blind_side_run --seed 3   # stdio, one moment
    uv run python -m agents.mcp_server --recap out/recap_evidence_match1.json   # a match's recap
    uv run python -m agents.mcp_server --match 1   # the same, simulating the match first

Agent Framework connects to it with `MCPStdioTool`; any other MCP client can too. A recap's
server reads the evidence the API already verified (`RecapContext.evidence()`), so it starts
without simulating anything.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from agents import tools
from agents.context import MomentContext
from analytics.live_stats import StatsTimeline


def build_server(ctx: MomentContext, stats: StatsTimeline | None = None) -> FastMCP:
    # WARNING: at INFO every request is logged to stderr, which the API's container logs inherit.
    server = FastMCP("through-their-eyes", log_level="WARNING")

    @server.tool()
    def get_moment(moment_id: str | None = None) -> str:
        """The MomentCard (JSON): window, players, anchors, metrics and all three lenses."""
        return tools.get_moment(ctx, moment_id)

    @server.tool()
    def list_claims(language: str = "en") -> str:
        """Every verified claim about the moment: id, kind, verdict, template, slots, evidence."""
        return tools.list_claims(ctx, language)

    @server.tool()
    def get_vision(player: str, frame: int) -> str:
        """Who `player` could see at `frame`, with each player's visibility in [0, 1]."""
        return tools.get_vision(ctx, player, frame)

    @server.tool()
    def get_pitch_control(x: float, y: float, frame: int) -> str:
        """Probability that each team controls point (x, y) in metres at `frame`."""
        return tools.get_pitch_control(ctx, x, y, frame)

    @server.tool()
    def get_xt(x: float, y: float, team: int = 0) -> str:
        """Expected threat of point (x, y) for team 0 (home, attacks +x) or 1 (away)."""
        return tools.get_xt(ctx, x, y, team)

    @server.tool()
    def get_pressing(frame: int) -> str:
        """Pressing intensity on the ball carrier at `frame`."""
        return tools.get_pressing(ctx, frame)

    @server.tool()
    def get_live_stats(player: str | None = None, frame: int | None = None) -> str:
        """Live match stats measured from tracking and events (SPEC 4.6): per player distance,
        top speed, sprints, passes (accuracy, difficulty 0-1) and shots, plus timecoded cues.
        `player` filters to one player; `frame` is the snapshot frame (default: the last).
        Metrics, not verified claims."""
        return tools.get_live_stats(ctx, player, frame, stats)

    @server.tool()
    def run_counterfactual(scan_id: str | None = None) -> str:
        """Re-simulate without one scan (default: the key scan): both decisions and the delta xT."""
        return tools.run_counterfactual(ctx, scan_id)

    @server.tool()
    def list_options() -> str:
        """The options the hero evaluated at his decision: action, probability, value."""
        return tools.list_options(ctx)

    @server.tool()
    def what_if(action: str) -> str:
        """Re-simulate the moment with the hero forced to take `action` (an option id)."""
        return tools.what_if(ctx, action)

    return server


def build_recap_server(evidence: dict[str, Any]) -> FastMCP:
    """The recap's Analyst tools, over a match's verified evidence."""
    server = FastMCP("through-their-eyes-recap", log_level="WARNING")

    @server.tool()
    def get_match_stats() -> str:
        """The match's verified totals (claims with values): the final score, then per team
        passes completed of played, scans and balls won back."""
        return tools.get_match_stats(evidence)

    @server.tool()
    def list_key_moments() -> str:
        """Key-moment candidates, most important first: kind, actor, lens, counterfactual impact
        in expected threat, and the ids of their verified claims."""
        return tools.list_key_moments(evidence)

    @server.tool()
    def list_recap_claims() -> str:
        """Every verified claim the recap may air: id, kind, verdict, template, values, moment."""
        return tools.list_recap_claims(evidence)

    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="MCP tool server for one moment or a match.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--recap", help="a recap's evidence file (RecapContext.evidence())")
    parser.add_argument("--match", type=int, help="a stitched match's seed: its recap's tools")
    args = parser.parse_args()
    if args.recap:
        build_recap_server(json.loads(Path(args.recap).read_text())).run()
    elif args.match is not None:
        from agents.recap_context import RecapContext

        build_recap_server(RecapContext.for_match(args.match).evidence()).run()
    else:
        build_server(MomentContext.load(args.scenario, args.seed)).run()


if __name__ == "__main__":
    main()
