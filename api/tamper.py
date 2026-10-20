"""Tamper checks (SPEC 5.3, 7 "producer console"): the verifier on a claim with one number changed.

A viewer picks a numeric slot of one of the moment's claims and a value of their own. The claim
is copied with that value, and the real verifier checks the copy against the same event store
the breakdown was checked against. The reply says what the verifier decided and why, and the
line as it would read with that number: the renderer airs it only when the verdict is
`supported`.

Nothing here is written to the audit log: anyone can call this, and the log records what the
service decided to air (SPEC 5.3), not what a viewer tried. No model is called.
"""

from __future__ import annotations

import math
from typing import Any

from agents.context import MomentContext
from explain.claims import Slot
from explain.functions import is_number
from explain.render import render_claim
from explain.verifier import Verifier

MAX_ABS = 1e6  # larger values have no meaning in a football match and render as long strings


class TamperError(ValueError):
    """The request names no numeric slot of a known claim (`status`: the HTTP status)."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status, self.detail = status, detail


def numeric(s: Slot) -> bool:
    return is_number(s.value)


def _tampered_slot(s: Slot, value: float) -> Slot:
    """`s` with `value`, if the slot can render it exactly (its decimals, or a whole number)."""
    if not math.isfinite(value) or abs(value) > MAX_ABS:
        raise TamperError(422, f"the value must be a number between -{MAX_ABS:g} and {MAX_ABS:g}")
    if s.decimals is not None:
        if float(f"{value:.{s.decimals}f}") != value:
            raise TamperError(422, f"this slot renders {s.decimals} decimals")
        return s.model_copy(update={"value": float(value)})
    if isinstance(s.value, int):
        if not float(value).is_integer():
            raise TamperError(422, "this slot is a whole number")
        return s.model_copy(update={"value": int(value)})
    return s.model_copy(update={"value": float(value)})


def tamper(ctx: MomentContext, claim_id: str, slot: str, value: float, lang: str) -> dict[str, Any]:
    claim = ctx.claims.get(claim_id)
    if claim is None:
        raise TamperError(404, f"no claim {claim_id} in this match")
    original = claim.slots.get(slot)
    if original is None:
        raise TamperError(404, f"claim {claim_id} has no slot {slot}")
    if not numeric(original):
        raise TamperError(422, f"slot {slot} of {claim_id} is not a number")
    slots = {**claim.slots, slot: _tampered_slot(original, value)}
    copy = claim.model_copy(update={"slots": slots})
    verdict = Verifier(ctx.evaluator).verify(copy)  # no sink: not audited
    gate = render_claim(copy, verdict, lang, ctx.names)
    if gate.ok:
        line = gate.text
    else:  # the same sentence filled in as if it had passed, to show what was kept off air
        as_if = verdict.model_copy(
            update={"status": "supported", "terms": ctx.verdicts[claim_id].terms}
        )
        line = render_claim(copy, as_if, lang, ctx.names).text
    return {
        "claim": claim_id,
        "slot": slot,
        "language": lang,
        "value": copy.slots[slot].value,
        "verified_value": original.value,
        "status": verdict.status,
        "reason": verdict.reason,
        "trace": verdict.trace,
        "line": line,
        "airs": gate.ok,
        "violations": [f"{v.kind}: {v.detail}" for v in gate.violations],
        "audited": False,
    }
