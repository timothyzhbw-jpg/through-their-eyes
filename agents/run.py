"""Run the crew on a hero moment and write the breakdown (SPEC 6).

    uv run python -m agents.run --seed 3             # Foundry when configured, else templates
    uv run python -m agents.run --seed 3 --offline   # templates only
    uv run --env-file .env python -m agents.run --seed 3 --mcp   # Analyst uses the MCP server

Writes out/breakdown_<scenario>_seed<seed>.json and prints a short summary.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from agents.context import MomentContext
from agents.llm import client_from_env
from agents.workflow import run_breakdown

OUT = Path("out")


async def main_async(args: argparse.Namespace) -> Path:
    ctx = MomentContext.load(args.scenario, args.seed)
    client, close = (None, None) if args.offline else client_from_env()
    try:
        result = await run_breakdown(
            ctx,
            client=client,
            personas=tuple(args.personas.split(",")),
            languages=tuple(args.languages.split(",")),
            step_timeout_s=args.timeout,
            use_mcp=args.mcp,
        )
    finally:
        if close is not None:
            await close()
    OUT.mkdir(exist_ok=True)
    path = OUT / f"breakdown_{args.scenario}_seed{args.seed}.json"
    path.write_text(result.model_dump_json(by_alias=True, indent=1))

    print(f"moment {result.request.moment} · lens {result.findings.lens} · tier {result.tier} · "
          f"plan from {result.plan_source}")  # fmt: skip
    for step in result.trace:
        error = f" · {step.error}" if step.error else ""
        print(
            f"  {step.step:<12} {step.source:<9} attempts {step.attempts} {step.ms:>7.0f} ms{error}"
        )
    for script in result.scripts:
        print(f"\n[{script.persona} · {script.language}] rewrites {script.rewrites}, "
              f"dropped {len(script.dropped)}")  # fmt: skip
        speaker = {line.id: line.speaker for line in script.lines}
        for line in script.payload.lines:
            print(f"  {speaker[line.id]:<5} {line.text}")
    print(f"\nwrote {path}")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the agent crew on a hero moment.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--personas", default="casual,analyst")
    parser.add_argument("--languages", default="en,zh")
    parser.add_argument("--timeout", type=float, default=8.0, help="seconds per agent step")
    parser.add_argument("--offline", action="store_true", help="templates only, no model calls")
    parser.add_argument("--mcp", action="store_true", help="the Analyst uses the MCP tool server")
    asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    main()
