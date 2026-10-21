"""Claims (SPEC 5.3): every factual sentence on screen is backed by a machine-checkable predicate.

A claim is a sentence template, the slot values that fill it, and a predicate over the event
store. Slots are *bound*: the predicate refers to them with `{"slot": name}`, so the value that
renders is the value that was checked. A slot the predicate never reads cannot be verified, and
the verifier returns `inconclusive` for the whole claim (see `explain.verifier`).

Operands inside a predicate (`lhs`, `rhs` and function arguments) are JSON:
- a literal: number, string, bool, null, or a list of operands;
- `{"fn": name, "args": {...}}`: a function call (`explain.functions`);
- `{"slot": name, "scale": k}`: a slot value, optionally multiplied by `k` (e.g. -1, 1 / 3.6);
- `{"event": id}`: the time of an event in seconds (for `before` and `exists`);
- any other object: its values are operands (e.g. a `where` filter).

Every claim has a kind, shown to viewers next to its evidence (SPEC 5.3). It is derived from the
predicate, never taken on trust: a claim that declares a different kind fails validation.
- `observed`: events and tracking only (counts, event attributes, distances, speeds);
- `computed`: reads an analytics model (vision, pitch control, xT, beliefs, pressing);
- `counterfactual`: reads a re-simulation (`cf_delta`, or any function with `cf`).
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Op = Literal["eq", "ne", "lt", "le", "gt", "ge", "approx", "exists", "before", "all"]
ClaimKind = Literal["observed", "computed", "counterfactual"]
BINARY_OPS = {"eq", "ne", "lt", "le", "gt", "ge", "approx", "before"}
MAX_TOL = 0.2  # SPEC 5.3: approx tolerances are < 20%, so ±20% perturbations are refutable

# "{name}", "{claim.name}", "{name:fmt}", "{name|singular|plural}", "{name:fmt|one|many}".
PLACEHOLDER = re.compile(
    r"\{(?P<claim>[A-Za-z_]\w*\.)?(?P<name>[A-Za-z_]\w*)(?::(?P<fmt>\w+))?"
    r"(?:\|(?P<one>[^{}|]*)\|(?P<many>[^{}|]*))?\}"
)


OBSERVED_FUNCTIONS = {
    "count_events",
    "event_attr",
    "distance",
    "scans_in_window",
    "scan_side",
    "opponents_bypassed",
    "seconds_between",
}
OBSERVED_METRICS = {
    "distance",
    "speed",
    "ball_speed",
    "nearest_opponent_distance",
    "nearest_opponent",
    "pitch_band",
    "pitch_lane",
    "time_since_last_scan",
}
_KIND_ORDER: tuple[ClaimKind, ...] = ("observed", "computed", "counterfactual")


def fn(name: str, **args: Any) -> dict[str, Any]:
    """Function operand. A trailing underscore is dropped, so `from_=` gives `"from"`."""
    return {"fn": name, "args": {k.removesuffix("_"): v for k, v in args.items()}}


def slot(name: str, scale: float | None = None) -> dict[str, Any]:
    return {"slot": name} if scale is None else {"slot": name, "scale": scale}


def event(ref: Any) -> dict[str, Any]:
    return {"event": ref}


def _check_operand(value: Any) -> None:
    if isinstance(value, list):
        for v in value:
            _check_operand(v)
    elif isinstance(value, dict):
        if "fn" in value:
            if not isinstance(value["fn"], str) or not isinstance(value.get("args", {}), dict):
                raise ValueError(f"malformed function operand: {value}")
            _check_operand(value.get("args", {}))
        elif "slot" in value:
            if not isinstance(value["slot"], str):
                raise ValueError(f"malformed slot operand: {value}")
        else:
            for v in value.values():
                _check_operand(v)


def _slot_refs(value: Any, out: set[str]) -> None:
    if isinstance(value, list):
        for v in value:
            _slot_refs(v, out)
    elif isinstance(value, dict):
        if "slot" in value:
            out.add(value["slot"])
        for k, v in value.items():
            if k != "slot":
                _slot_refs(v, out)


def _operand_kind(value: Any) -> int:
    """Index into _KIND_ORDER of the strongest kind an operand reads."""
    if isinstance(value, list):
        return max((_operand_kind(v) for v in value), default=0)
    if not isinstance(value, dict):
        return 0
    if "fn" not in value:
        return max((_operand_kind(v) for k, v in value.items() if k != "slot"), default=0)
    args = value.get("args", {})
    if value["fn"] == "cf_delta" or "cf" in args:
        return 2
    if value["fn"] in ("metric_at", "metric_delta"):
        own = 0 if args.get("metric") in OBSERVED_METRICS else 1
    else:
        own = 0 if value["fn"] in OBSERVED_FUNCTIONS else 1
    return max(own, _operand_kind(args))


class Slot(BaseModel):
    """An entity reference (player or event id) or a literal value that fills a placeholder."""

    model_config = ConfigDict(extra="forbid")

    ref: str | None = None
    value: bool | int | float | str | None = None
    decimals: int | None = Field(default=None, ge=0, le=3)

    @model_validator(mode="after")
    def _one_of(self) -> Slot:
        if (self.ref is None) == (self.value is None):
            raise ValueError("a slot holds exactly one of `ref` or `value`")
        return self

    @property
    def raw(self) -> Any:
        return self.ref if self.ref is not None else self.value


class Predicate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Op
    lhs: Any = None
    rhs: Any = None
    tol: float | None = Field(default=None, ge=0.0, lt=MAX_TOL)  # relative to lhs (approx)
    abs_tol: float | None = Field(default=None, ge=0.0)  # absolute (approx)
    args: list[Predicate] | None = None  # conjuncts (all)

    @model_validator(mode="after")
    def _shape(self) -> Predicate:
        if self.op == "all":
            if not self.args or self.lhs is not None or self.rhs is not None:
                raise ValueError("`all` takes a non-empty `args` list and nothing else")
        elif self.args is not None:
            raise ValueError(f"`{self.op}` takes no `args`")
        if self.op in BINARY_OPS and (self.lhs is None or self.rhs is None):
            raise ValueError(f"`{self.op}` needs `lhs` and `rhs`")
        if self.op == "exists" and (self.lhs is None or self.rhs is not None):
            raise ValueError("`exists` takes `lhs` only")
        if self.op == "approx" and self.tol is None and self.abs_tol is None:
            raise ValueError("`approx` needs `tol` and/or `abs_tol`")
        if self.op != "approx" and (self.tol is not None or self.abs_tol is not None):
            raise ValueError("tolerances apply to `approx` only")
        _check_operand(self.lhs)
        _check_operand(self.rhs)
        return self

    def slot_refs(self) -> set[str]:
        out: set[str] = set()
        _slot_refs(self.lhs, out)
        _slot_refs(self.rhs, out)
        for p in self.args or ():
            out |= p.slot_refs()
        return out

    def kind(self) -> ClaimKind:
        parts = [_operand_kind(self.lhs), _operand_kind(self.rhs)]
        parts += [_KIND_ORDER.index(p.kind()) for p in self.args or ()]
        return _KIND_ORDER[max(parts)]

    def conjuncts(self) -> list[Predicate]:
        """This predicate, or the leaves of nested `all`s."""
        if self.op != "all":
            return [self]
        return [leaf for p in self.args or () for leaf in p.conjuncts()]


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: ClaimKind | None = None  # derived from the predicate when omitted
    template: str  # English; slot placeholders like "{player}" or "{n:times}"
    templates: dict[str, str] = Field(default_factory=dict)  # per-language, e.g. {"zh": ...}
    slots: dict[str, Slot] = Field(default_factory=dict)
    predicate: Predicate
    evidence: list[str] = Field(default_factory=list)  # event ids
    terms: list[str] = Field(default_factory=list)  # lexicon terms this claim verifies

    @model_validator(mode="after")
    def _placeholders_name_slots(self) -> Claim:
        for lang, text in {"en": self.template, **self.templates}.items():
            for m in PLACEHOLDER.finditer(text):
                if m["claim"] or m["name"] not in self.slots:
                    raise ValueError(f"placeholder {m[0]!r} ({lang}) does not name a slot")
        derived = self.predicate.kind()
        if self.kind is None:
            self.kind = derived
        elif self.kind != derived:
            raise ValueError(f"kind {self.kind!r}, but the predicate is {derived!r}")
        return self

    def template_for(self, lang: str) -> str:
        return self.templates.get(lang, self.template)

    def slot_refs(self) -> set[str]:
        return self.predicate.slot_refs()

    def fingerprint(self) -> str:
        """Content hash; a verdict is valid only for the exact claim it was computed on."""
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()
