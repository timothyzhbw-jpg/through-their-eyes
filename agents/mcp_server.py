"""Our MCP tool server (SPEC 6): the Analyst's view of one moment.

    uv run python -m agents.mcp_server --scenario blind_side_run --seed 3   # stdio

Agent Framework connects to it with `MCPStdioTool`; any other MCP client can too.
"""

from __future__ import annotations

import argparse

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


def main() -> None:
    parser = argparse.ArgumentParser(description="MCP tool server for one moment.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    args = parser.parse_args()
    build_server(MomentContext.load(args.scenario, args.seed)).run()


if __name__ == "__main__":
    main()
