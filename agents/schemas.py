"""Typed handoffs between the agents (SPEC 6).

Models the language model fills (`DirectorChoice`, `AnalystChoice`, `TelestrationPlan`,
`NarrationDraft`) have every field required, so they work as strict structured outputs. The rest is
what the crew passes along and returns. `TelestrationPlan` mirrors web/src/plan/schema.ts.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator

from explain.cards import LensName
from explain.numbers import number_tokens
from explain.render import RenderPayload

Persona = Literal["casual", "analyst", "player_fan", "coach"]
Language = Literal["en", "zh"]
Speaker = Literal["pbp", "color"]  # play-by-play commentator, co-commentator (analysis)
Tier = Literal["calm", "excited", "clutch"]
Priority = Literal["low", "normal", "high"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


PLAYER_ID = re.compile(r"(?<![A-Za-z0-9])[HA]\d{1,2}(?!\d)")


def no_numbers(text: str) -> str:
    """Model free text (a reason, an angle) may name players (H8) but never carry a number.

    Numbers reach viewers only through verified claims (CLAUDE.md: LLMs never write digits). The
    same detector as the render check: digits, English number words, Chinese numeral + measure.
    """
    tokens = number_tokens(PLAYER_ID.sub("X", text))
    if tokens:
        raise ValueError(f"no numbers in free text ({len(tokens)} found)")
    return text


# --- Director ------------------------------------------------------------------------------------


class DirectorChoice(Strict):
    # Who gets the breakdown is the request's call; the Director sets its priority (SPEC 6).
    priority: Priority
    reason: str = Field(max_length=400)

    _no_numbers = field_validator("reason")(no_numbers)


class BreakdownRequest(Strict):
    moment: str  # MomentCard id
    personas: list[Persona]
    languages: list[Language]
    priority: Priority
    reason: str


# --- Analyst -------------------------------------------------------------------------------------


class AnalystChoice(Strict):
    lens: LensName
    headline: list[str]  # claim ids, most important first
    supporting: list[str]  # claim ids
    angle: str = Field(max_length=400)  # the story in one sentence, for the other agents

    _no_numbers = field_validator("angle")(no_numbers)


class Findings(Strict):
    moment: str
    lens: LensName
    headline: list[str]
    supporting: list[str]
    angle: str


# --- Telestrator: the plan (mirror of web/src/plan/schema.ts) -------------------------------------

Rel = Annotated[float, Field(ge=-60.0, le=60.0)]  # s of match time relative to the anchor
Speed = Annotated[float, Field(ge=0.1, le=2.0)]
PlayerId = Annotated[str, Field(pattern=r"^[HA]\d{1,2}$")]


class _Step(Strict):
    t: float = Field(ge=0.0)  # s since the plan started


class Freeze(_Step):
    do: Literal["freeze"]


class Rewind(_Step):
    do: Literal["rewind"]
    to: Rel


class Play(_Step):
    do: Literal["play"]
    to: Rel
    speed: Speed


class Camera(_Step):
    do: Literal["camera"]
    mode: Literal["split", "pov", "tactical"]


class Pov(_Step):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    do: Literal["pov"]
    player: PlayerId
    from_: Rel = Field(alias="from")
    to: Rel
    speed: Speed


class ScanMarker(_Step):
    do: Literal["scan_marker"]
    scan: str
    label_claim: str | None


class Zone(_Step):
    do: Literal["zone"]
    layer: Literal["vision"]
    player: PlayerId


class Ghost(_Step):
    do: Literal["ghost"]
    kind: Literal["belief", "counterfactual"]
    cf: str | None


class Voice(_Step):
    do: Literal["voice"]
    line: str


PlanStep = Annotated[
    Freeze | Rewind | Play | Camera | Pov | ScanMarker | Zone | Ghost | Voice,
    Field(discriminator="do"),
]


class PlanDraft(Strict):
    """The Telestrator's structured output. Same fields as `TelestrationPlan`, but the steps are a
    plain union: Azure OpenAI structured outputs accept `anyOf`, not the `oneOf` that a
    discriminated union produces. `to_plan` applies the full checks."""

    moment: str
    duration_s: float
    steps: list[Freeze | Rewind | Play | Camera | Pov | ScanMarker | Zone | Ghost | Voice]

    def to_plan(self) -> TelestrationPlan:
        return TelestrationPlan.model_validate(self.model_dump(by_alias=True))


class TelestrationPlan(Strict):
    moment: str
    duration_s: float = Field(gt=0.0, le=120.0)
    steps: list[PlanStep] = Field(min_length=1, max_length=100)

    def to_web(self) -> dict:
        """JSON for web/src/plan/schema.ts: aliases, and no nulls for optional fields."""
        return self.model_dump(by_alias=True, exclude_none=True)


# --- Commentator and Co-commentator ---------------------------------------------------------------


class DraftLine(Strict):
    text: str = Field(max_length=300)  # placeholders like {player}; never digits or names
    claims: list[str]  # ids of the claims the line states


class NarrationDraft(Strict):
    lines: list[DraftLine] = Field(max_length=8)


# Connectives a narration line may consist of; each passes `explain.lexicon.is_connective`.
CONNECTIVES: dict[Language, tuple[str, ...]] = {
    "en": ("What did he see?", "Watch this.", "Look again.", "Here's why.", "Now watch.",
           "This is the moment.", "See it again."),
    "zh": ("他看到了什么？", "注意看。", "再看看。", "关键在这里。", "就是这个瞬间。", "为什么？"),
}  # fmt: skip


def _enum(values: list[str] | tuple[str, ...]):
    return Literal[tuple(values)] if values else Literal["__none__"]


def anchored_draft_model(claim_ids: list[str], language: Language) -> type[BaseModel]:
    """What a narration agent may return: per line, a verified claim id or an allowed connective.

    The ids and connectives are enums in the JSON schema, so structured outputs cannot contain
    free text: the spoken sentence of a claim is its verified template (SPEC 6).
    """
    line = create_model(
        "AnchoredLine", __base__=Strict,
        claim=(_enum(claim_ids) | None, ...), connective=(_enum(CONNECTIVES[language]) | None, ...),
    )  # fmt: skip
    return create_model("AnchoredDraft", __base__=Strict, lines=(list[line], Field(max_length=8)))


def analyst_model(claim_ids: list[str]) -> type[BaseModel]:
    """`AnalystChoice` with the claim ids as an enum: the Analyst can only pick verified claims."""
    claim = _enum(claim_ids)
    return create_model(
        "AnalystChoice", __base__=Strict, lens=(LensName, ...),
        headline=(list[claim], Field(min_length=1, max_length=3)),
        supporting=(list[claim], Field(max_length=6)), angle=(str, Field(max_length=400)),
        __validators__={"angle_no_numbers": field_validator("angle")(no_numbers)},
    )  # fmt: skip


class ScriptLine(Strict):
    id: str
    speaker: Speaker
    text: str
    claims: list[str]


# --- what the crew returns ------------------------------------------------------------------------


class DroppedLine(Strict):
    id: str
    speaker: Speaker
    text: str
    reason: str  # the first violation kind: number, banned, lexicon, entity, placeholder, ...
    detail: str


class VoiceCue(Strict):
    line: str
    speaker: Speaker
    t: float  # s on the plan clock
    voice: str
    style: str | None  # SSML speaking style, when the voice has one for the tier
    ssml: str
    cache_key: str


class ScriptResult(Strict):
    persona: Persona
    language: Language
    lines: list[ScriptLine]  # approved lines, with placeholders
    payload: RenderPayload  # what a viewer receives (SPEC 5.3)
    dropped: list[DroppedLine]
    rewrites: int  # rewrite rounds the Verifier requested
    voice: list[VoiceCue]


class StepTrace(Strict):
    step: str
    source: Literal["llm", "template", "code"]
    attempts: int
    ms: float
    error: str | None
    notes: list[str]


class BreakdownResult(Strict):
    request: BreakdownRequest
    findings: Findings
    plan: TelestrationPlan
    plan_source: Literal["agent", "template"]
    plan_errors: list[str]
    tier: Tier
    scripts: list[ScriptResult]
    trace: list[StepTrace]
    total_ms: float  # wall time of the whole breakdown
