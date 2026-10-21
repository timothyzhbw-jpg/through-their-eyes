"""Quickstart for the synthetic match dataset (docs/DATASET.md).

    uv run python -m sim.dataset --matches 10 --out out/dataset/
    uv run python examples/dataset_quickstart.py --data out/dataset

Pass completion per team and scans per minute per role need only the standard library
(`events.csv`, `metadata.json`); top speeds read `tracking.parquet` with pyarrow. Every number
is a property of the simulator, not a finding about real football.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def events(data: Path) -> list[dict[str, str]]:
    with (data / "events.csv").open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def metadata(data: Path) -> dict:
    return json.loads((data / "metadata.json").read_text(encoding="utf-8"))


def pass_completion(data: Path) -> dict[int, tuple[int, int]]:
    """(completed, resolved) passes per team. A pass is resolved when it was received,
    intercepted or went out; one still rolling when its possession ended has no outcome."""
    done: Counter[int] = Counter()
    resolved: Counter[int] = Counter()
    for e in events(data):
        if e["type"] == "pass" and e["outcome"]:
            team = int(e["team"])
            resolved[team] += 1
            done[team] += e["outcome"] == "complete"
    return {team: (done[team], resolved[team]) for team in sorted(resolved)}


def scans_per_minute(data: Path) -> dict[str, float]:
    """Scans per player per minute of play, by role, over every match in the files."""
    meta = metadata(data)
    role = {p["id"]: p["role"] for p in meta["players"]}
    players = Counter(role.values())
    minutes = sum(m["duration_s"] for m in meta["matches"]) / 60
    scans = Counter(role[e["player"]] for e in events(data) if e["type"] == "scan")
    return {r: scans[r] / players[r] / minutes for r in sorted(players)}


def top_speeds(data: Path) -> dict[str, float]:
    """Each role's highest speed in the tracking (m/s), from tracking.parquet."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    t = pq.read_table(data / "tracking.parquet", columns=["player", "vx", "vy"])
    speed = pc.sqrt(pc.add(pc.multiply(t["vx"], t["vx"]), pc.multiply(t["vy"], t["vy"])))
    per_player = t.append_column("speed", speed).group_by("player").aggregate([("speed", "max")])
    role = {p["id"]: p["role"] for p in metadata(data)["players"]}
    best: dict[str, float] = {}
    for row in per_player.to_pylist():
        r = role[row["player"]]
        best[r] = max(best.get(r, 0.0), row["speed_max"])
    return dict(sorted(best.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, default=Path("out/dataset"))
    args = parser.parse_args()
    meta = metadata(args.data)
    minutes = sum(m["duration_s"] for m in meta["matches"]) / 60
    print(f"{len(meta['matches'])} matches, {minutes:.1f} min of play (synthetic)")
    for team, (done, n) in pass_completion(args.data).items():
        name = meta["teams"][team]["name"]
        print(f"pass completion {name}: {done}/{n} = {done / n:.1%}")
    print("scans per player per minute:")
    for r, rate in scans_per_minute(args.data).items():
        print(f"  {r:<3} {rate:5.2f}")
    try:
        speeds = top_speeds(args.data)
    except ImportError:
        print("(top speeds need pyarrow: uv sync)")
        return
    print("top speed (m/s):  " + "  ".join(f"{r} {s:.1f}" for r, s in speeds.items()))


if __name__ == "__main__":
    main()
