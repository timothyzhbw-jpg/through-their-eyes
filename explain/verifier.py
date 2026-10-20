"""Verifier (SPEC 5.3): evaluate claim predicates against the event store.

Verdicts are `supported | refuted | inconclusive`; only `supported` claims render. A claim is
`inconclusive` before its predicate is even evaluated when
- a slot is not bound to the predicate (its value would render unchecked), or
- an evidence id cannot be resolved (`refuted` if it names an event that did not happen).

Every verdict is written to the audit sink with the claim, the evaluated values, the run hash,
the counterfactuals used, and timestamps.
"""

from __future__ import annotations

import math
import time
import uuid
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field

from explain import lexicon
from explain.audit import AuditRecord, AuditSink
from explain.claims import Claim, Predicate
from explain.functions import EvalContext, Evaluator, Inconclusive, Refuted, is_number

VERSION = "1"
EPS = 1e-9  # float slack on comparisons; tolerances are explicit in `approx`

Status = Literal["supported", "refuted", "inconclusive"]


class Verdict(BaseModel):
    claim_id: str
    status: Status
    reason: str
    fingerprint: str  # of the claim this verdict is about; rendering re-checks it
    terms: list[str] = Field(default_factory=list)  # lexicon terms this claim backs
    trace: list[dict[str, Any]] = Field(default_factory=list)  # one entry per comparison
    counterfactuals: list[str] = Field(default_factory=list)

    @property
    def supported(self) -> bool:
        return self.status == "supported"


def _plain(x: Any) -> Any:
    if isinstance(x, np.bool_):
        return bool(x)
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.floating):
        return float(x)
    if isinstance(x, list | tuple):
        return [_plain(v) for v in x]
    if isinstance(x, dict):
        return {str(k): _plain(v) for k, v in x.items()}
    return x


def compare(p: Predicate, a: Any, b: Any) -> bool:
    """Apply a binary op; raise Inconclusive when the values cannot be compared."""
    a, b = _plain(a), _plain(b)
    if a is None or b is None:
        raise Inconclusive(f"value not available ({a!r} vs {b!r})")
    if p.op in ("eq", "ne"):
        if is_number(a) and is_number(b):
            same = math.isclose(a, b, rel_tol=EPS, abs_tol=EPS)
        elif type(a) is type(b) or (isinstance(a, list | tuple) and isinstance(b, list | tuple)):
            same = list(a) == list(b) if isinstance(a, list | tuple) else a == b
        else:
            raise Inconclusive(f"cannot compare {type(a).__name__} with {type(b).__name__}")
        return same if p.op == "eq" else not same
    if not (is_number(a) and is_number(b)):
        raise Inconclusive(f"`{p.op}` needs numbers, got {a!r} and {b!r}")
    a, b = float(a), float(b)
    if p.op == "approx":
        return abs(a - b) <= max((p.tol or 0.0) * abs(a), p.abs_tol or 0.0) + EPS
    return {
        "lt": a < b,
        "le": a <= b + EPS,
        "gt": a > b,
        "ge": a >= b - EPS,
        "before": a < b,
    }[p.op]


class Verifier:
    def __init__(
        self,
        ctx: EvalContext,
        sink: AuditSink | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.ctx = ctx
        self.sink = sink
        self.clock = clock or (lambda: datetime.now(UTC))

    def verify_all(self, claims: Iterable[Claim]) -> dict[str, Verdict]:
        return {c.id: self.verify(c) for c in claims}

    def verify(self, claim: Claim) -> Verdict:
        started, t0 = self.clock(), time.perf_counter()
        evaluator = Evaluator(self.ctx, {k: s.raw for k, s in claim.slots.items()})
        trace: list[dict[str, Any]] = []
        status, reason = self._check(claim, evaluator, trace)
        terms = [t for t in claim.terms if lexicon.backs(t, claim.predicate)]
        verdict = Verdict(
            claim_id=claim.id,
            status=status,
            reason=reason,
            fingerprint=claim.fingerprint(),
            terms=terms if status == "supported" else [],
            trace=_plain(trace),
            counterfactuals=list(evaluator.used_counterfactuals),
        )
        if self.sink is not None:
            decided = self.clock()
            self.sink.write(
                AuditRecord(
                    id=uuid.uuid4().hex,
                    match=self.ctx.match,
                    match_id=self.ctx.match,
                    run_hash=self.ctx.run_hash,
                    counterfactuals=verdict.counterfactuals,
                    claim=claim.model_dump(mode="json"),
                    claim_fingerprint=verdict.fingerprint,
                    verdict=verdict.model_dump(mode="json"),
                    started_at=started.isoformat(),
                    decided_at=decided.isoformat(),
                    duration_ms=1000.0 * (time.perf_counter() - t0),
                    verifier_version=VERSION,
                )
            )
        return verdict

    def _check(self, claim: Claim, ev: Evaluator, trace: list) -> tuple[Status, str]:
        unbound = sorted(set(claim.slots) - claim.slot_refs())
        if unbound:
            return "inconclusive", f"slots not bound to the predicate: {', '.join(unbound)}"
        try:
            for event_id in claim.evidence:
                self.ctx.event(self.ctx.run, event_id)
        except Refuted as e:
            return "refuted", f"evidence: {e}"
        except Inconclusive as e:
            return "inconclusive", f"evidence: {e}"
        return self._predicate(claim.predicate, ev, trace)

    def _predicate(self, p: Predicate, ev: Evaluator, trace: list) -> tuple[Status, str]:
        if p.op == "all":
            results = [self._predicate(q, ev, trace) for q in p.args or ()]
            for wanted in ("refuted", "inconclusive"):
                bad = [reason for status, reason in results if status == wanted]
                if bad:
                    return wanted, "; ".join(bad)  # type: ignore[return-value]
            return "supported", f"all {len(results)} conditions hold"
        try:
            if p.op == "exists":
                try:
                    a = ev.value(p.lhs, self.ctx.run)
                except Refuted:
                    a = None
                b, holds = None, a is not None
            else:
                a, b = ev.value(p.lhs, self.ctx.run), ev.value(p.rhs, self.ctx.run)
                holds = compare(p, a, b)
        except Inconclusive as e:
            trace.append({"op": p.op, "error": str(e)})
            return "inconclusive", str(e)
        except Refuted as e:
            trace.append({"op": p.op, "error": str(e)})
            return "refuted", str(e)
        trace.append({"op": p.op, "lhs": a, "rhs": b, "holds": holds})
        if holds:
            return "supported", f"{p.op}({a!r}, {b!r}) holds"
        return "refuted", f"{p.op}({a!r}, {b!r}) is false"


def verify(claim: Claim, ctx: EvalContext, sink: AuditSink | None = None) -> Verdict:
    return Verifier(ctx, sink).verify(claim)
