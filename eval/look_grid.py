"""Take his eyes (SPEC 3.7, 7): which looks change the hero's decision, on the demo seed and on
held-out seeds.

    uv run python -m eval.look_grid --scenario blind_side_run
    uv run python -m eval.look_grid --scenario press_escape

The viewer picks one look for the hero, from the pass to him until his decision: when (every
0.4 s back from the reception, `sim.export.look_grid_frames`) and where (to his left, over his
left shoulder, over his right shoulder, to his right: +90, +150, -150, -90 degrees from the ball).
Each look is a re-simulation (`sim.counterfactual.look_counterfactual`) in which that is his only
look. This counts, honestly, how often a look changes what he does:
- against the run with no look at all (did this look matter?);
- against the factual run (did it change what he really did?);
- for a scenario with a runner, how often the look finds him: he plays the runner in.

The demo seed's grid is what the web app ships (`sim.export.export_looks`); the held-out seeds
show whether that grid is typical. Nothing here was tuned: the grid was fixed on the demo seed
before any other seed was run. Writes eval/reports/look_grid_<scenario>.md.
"""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from sim.config import DT
from sim.counterfactual import look_counterfactual, look_overrides, possession_result
from sim.engine import Simulation
from sim.export import LOOK_OFFSETS, look_grid_frames
from sim.scenarios import SCENARIOS

REPORTS = Path(__file__).parent / "reports"
DEMO = {"blind_side_run": 3, "press_escape": 0}
HELD_OUT = {"blind_side_run": range(100, 140), "press_escape": range(200, 240)}
WHERE = {90: "to his left", 150: "over his left shoulder", -150: "over his right shoulder",
         -90: "to his right"}  # fmt: skip


def _grid(scenario: str, seed: int) -> dict:
    """One seed: his factual and no-look decisions, and every look of the grid by
    (seconds before the reception, degrees)."""
    factual = Simulation.from_scenario(scenario, seed).run()
    hero = factual.hero
    (start, end), own, _ = look_overrides(factual, hero, None, None)
    reception = max(e.frame for e in factual.events
                    if e.type == "reception" and e.player == hero and e.frame <= end)  # fmt: skip
    none = look_counterfactual(scenario, seed, None, None)
    cells = {}
    for f in look_grid_frames(start, reception):
        before = round((reception - f) * DT, 1)
        for offset in LOOK_OFFSETS:
            try:
                look = look_counterfactual(scenario, seed, f, offset)
            except ValueError:
                cells[(before, offset)] = None
                continue
            cells[(before, offset)] = (look.counterfactual_action,
                                       possession_result(look.counterfactual))  # fmt: skip
    return {
        "seed": seed,
        "factual": (factual.hero_decision().chosen, possession_result(factual)),
        "none": (none.counterfactual_action, possession_result(none.counterfactual)),
        "own": [e.id for e in own],
        "cells": cells,
        "runner": getattr(SCENARIOS[scenario], "runner", None),
    }


def _share(n: int, d: int) -> str:
    return f"{n}/{d} ({100 * n / d:.0f}%)" if d else "–"


def _counts(grids: list[dict]) -> dict:
    c = Counter()
    for g in grids:
        mattered = False
        for cell in g["cells"].values():
            c["cells"] += 1
            if cell is None:
                continue
            c["available"] += 1
            c["vs_none"] += cell[0] != g["none"][0]
            c["vs_factual"] += cell[0] != g["factual"][0]
            c["outcome_vs_factual"] += cell[1] != g["factual"][1]
            mattered |= cell[0] != g["none"][0]
            if g["runner"]:
                c["runner"] += cell[0] == f"pass:{g['runner']}"
        c["seeds_mattered"] += mattered
        c["none_is_factual"] += g["none"][0] == g["factual"][0]
    return c


def _demo_table(g: dict) -> list[str]:
    times = sorted({t for t, _ in g["cells"]}, reverse=True)
    head = "| before the reception | " + " | ".join(WHERE[o] for o in LOOK_OFFSETS) + " |"
    rows = [head, "|" + "---|" * (len(LOOK_OFFSETS) + 1)]
    for t in times:
        cells = []
        for o in LOOK_OFFSETS:
            cell = g["cells"][(t, o)]
            if cell is None:
                cells.append("no look possible")
                continue
            action, result = cell
            mark = " **≠ no look**" if action != g["none"][0] else ""
            cells.append(f"`{action}` {result}{mark}")
        rows.append(f"| {t:.1f} s | " + " | ".join(cells) + " |")
    return rows


def _by_cell(grids: list[dict], key) -> list[str]:
    times = sorted({t for g in grids for t, _ in g["cells"]}, reverse=True)
    rows = ["| before the reception | " + " | ".join(WHERE[o] for o in LOOK_OFFSETS) + " |",
            "|" + "---|" * (len(LOOK_OFFSETS) + 1)]  # fmt: skip
    for t in times:
        out = []
        for o in LOOK_OFFSETS:
            cells = [(g, g["cells"].get((t, o))) for g in grids if (t, o) in g["cells"]]
            ok = [(g, c) for g, c in cells if c is not None]
            out.append(_share(sum(key(g, c) for g, c in ok), len(ok)) if ok else "–")
        rows.append(f"| {t:.1f} s | " + " | ".join(out) + " |")
    return rows


def report(scenario: str, demo: dict, grids: list[dict]) -> str:
    seeds = [g["seed"] for g in grids]
    d, h = _counts([demo]), _counts(grids)
    runner = demo["runner"]
    lines = [
        f"# Take his eyes: the look grid on `{scenario}`",
        "",
        "Generated by `uv run python -m eval.look_grid --scenario "
        f"{scenario}` (SPEC 3.7, 7). The viewer gives the hero one look, from the pass to him "
        "until his decision; his own looks in that window do not happen. Directions are degrees "
        "from the ball (150 is the widest a scan turns); times are back from the reception, "
        "every 0.4 s. Every look is a re-simulation with keyed randomness, so a look changes the "
        "run only through what he sees.",
        "",
        f"## Demo seed {demo['seed']} (shipped in the web app)",
        "",
        f"- What he really did: `{demo['factual'][0]}` ({demo['factual'][1]}); his own looks in "
        f"the window: {', '.join(f'`{s}`' for s in demo['own']) or 'none'}.",
        f"- With no look at all: `{demo['none'][0]}` ({demo['none'][1]}).",
        f"- Looks available: {_share(d['available'], d['cells'])} (a look waits for one under way).",
        f"- Looks that change his decision against no look: {_share(d['vs_none'], d['available'])}.",
        f"- Looks that change what he really did: {_share(d['vs_factual'], d['available'])}; "
        f"the possession result changes in {_share(d['outcome_vs_factual'], d['available'])}.",
        "",
        *_demo_table(demo),
        "",
        f"## Held-out seeds {seeds[0]}–{seeds[-1]}",
        "",
        f"- Looks available: {_share(h['available'], h['cells'])}.",
        f"- Looks that change his decision against no look: {_share(h['vs_none'], h['available'])}; "
        f"seeds where at least one look does: {_share(h['seeds_mattered'], len(grids))}.",
        f"- Looks that change what he really did: {_share(h['vs_factual'], h['available'])}.",
        f"- Seeds where no look at all gives his real decision: "
        f"{_share(h['none_is_factual'], len(grids))}.",
        "",
        "Share of seeds where the look changes his decision against no look:",
        "",
        *_by_cell(grids, lambda g, c: c[0] != g["none"][0]),
    ]
    if runner:
        lines += [
            "",
            f"Share of seeds where he plays the runner {runner} in (with no look at all: "
            f"{_share(sum(g['none'][0] == f'pass:{runner}' for g in grids), len(grids))}):",
            "",
            *_by_cell(grids, lambda g, c: c[0] == f"pass:{runner}"),
        ]
    return "\n".join(lines) + "\n"


def _job(args: tuple[str, int]) -> dict:
    return _grid(*args)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scenario", default="blind_side_run", choices=sorted(DEMO))
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    seeds = [DEMO[args.scenario], *HELD_OUT[args.scenario]]
    with ProcessPoolExecutor() as pool:
        grids = list(pool.map(_job, [(args.scenario, s) for s in seeds]))
    out = args.out or REPORTS / f"look_grid_{args.scenario}.md"
    out.write_text(report(args.scenario, grids[0], grids[1:]))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
