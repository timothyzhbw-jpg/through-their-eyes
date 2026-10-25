"""The Tactics lab's TypeScript pressing constants mirror the Python reference (SPEC 4.8)."""

from __future__ import annotations

import re
from pathlib import Path

from analytics import pressing, tactics, tti

METRICS_TS = Path(__file__).resolve().parent.parent / "web/src/tacticslab/metrics.ts"


def _ts_constant(name: str) -> float:
    m = re.search(rf"const {name} = ([0-9.]+);", METRICS_TS.read_text())
    assert m, f"{name} not found in metrics.ts"
    return float(m.group(1))


def test_ts_constants_match_python_reference() -> None:
    expected = {
        "PRESSED": tactics.PRESSED,
        "MIN_BYPASSED": tactics.MIN_BYPASSED,
        "PRESS_REACTION_S": tti.REACTION_S,
        "PRESS_V_MAX": tti.V_MAX,
        "PRESS_THRESHOLD_S": pressing.TIME_THRESHOLD_S,
        "PRESS_SIGMA_S": pressing.SIGMA_S,
        "PRESS_TARGET_LEAD_S": pressing.TARGET_LEAD_S,
    }
    for name, value in expected.items():
        assert _ts_constant(name) == value, name
