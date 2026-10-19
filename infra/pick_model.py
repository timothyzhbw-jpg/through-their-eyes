"""Pick the model to deploy for M0 from what a region actually offers (SPEC §8).

Reads the JSON of `az cognitiveservices model list -l <region>` and
`az cognitiveservices usage list -l <region>`, walks the candidate names in order and prints
`<name> <version> <capacity>` for the first one that is offered with the wanted SKU, is not retired
before judging ends, and has quota left. Diagnostics go to stderr.

    python3 infra/pick_model.py models.json usage.json "gpt-4.1-mini gpt-5-mini" GlobalStandard 20
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any

# Judging ends 2026-11-10; keep a few days of margin.
MUST_LIVE_UNTIL = "2026-11-15"


@dataclass(frozen=True)
class Choice:
    name: str
    version: str
    capacity: int


def _sku(model: dict[str, Any], sku_name: str) -> dict[str, Any] | None:
    for sku in model.get("skus") or []:
        if sku.get("name") == sku_name:
            return sku
    return None


def _retires(model: dict[str, Any], sku: dict[str, Any]) -> str | None:
    date = sku.get("deprecationDate") or (model.get("deprecation") or {}).get("inference")
    return str(date)[:10] if date else None


def pick(
    models: list[dict[str, Any]],
    usages: list[dict[str, Any]],
    candidates: list[str],
    sku_name: str,
    capacity: int,
    must_live_until: str = MUST_LIVE_UNTIL,
) -> tuple[Choice | None, list[str]]:
    """Return the first deployable candidate and a log of why the others were skipped."""
    available = {
        (u.get("name") or {}).get("value"): float(u.get("limit", 0))
        - float(u.get("currentValue", 0))
        for u in usages
    }
    log: list[str] = []
    for name in candidates:
        offered = [
            m["model"]
            for m in models
            if (m.get("model") or {}).get("name") == name
            and m["model"].get("format") == "OpenAI"
            and _sku(m["model"], sku_name)
        ]
        if not offered:
            log.append(f"{name}: not offered with {sku_name} in this region")
            continue
        # Default version first, then newest.
        offered.sort(key=lambda m: (bool(m.get("isDefaultVersion")), m.get("version", "")))
        for model in reversed(offered):
            sku = _sku(model, sku_name)
            assert sku is not None
            retires = _retires(model, sku)
            if retires and retires < must_live_until:
                log.append(f"{name} {model.get('version')}: retires {retires}")
                continue
            usage_name = sku.get("usageName") or f"OpenAI.{sku_name}.{name}"
            left = available.get(usage_name)
            if left is not None and left < 1:
                log.append(f"{name} {model.get('version')}: no quota left ({usage_name})")
                continue
            granted = capacity if left is None else min(capacity, int(left))
            note = "quota unknown" if left is None else f"{int(left)} available"
            log.append(f"{name} {model.get('version')}: OK, capacity {granted} ({note})")
            return Choice(name, str(model.get("version")), granted), log
    return None, log


def main(argv: list[str]) -> int:
    if len(argv) != 6:
        print(__doc__, file=sys.stderr)
        return 2
    _, models_path, usage_path, candidates, sku_name, capacity = argv
    with open(models_path) as f:
        models = json.load(f)
    with open(usage_path) as f:
        usages = json.load(f)
    choice, log = pick(models, usages, candidates.split(), sku_name, int(capacity))
    for line in log:
        print(f"  {line}", file=sys.stderr)
    if choice is None:
        print("No candidate model can be deployed here.", file=sys.stderr)
        return 1
    print(f"{choice.name} {choice.version} {choice.capacity}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
