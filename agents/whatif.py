""" "What if…?" questions answered by re-simulation (SPEC 3.7 force_action, SPEC 6).

    uv run python -m agents.whatif --seed 3 "What if he passed to H4?"
    uv run python -m agents.whatif --seed 3 --language zh "如果他传给H4呢？"

The question is mapped to one of the options the player evaluated — by the Analyst when a model is
configured, by a small rule parser otherwise — and nothing else. That option is forced and the
moment re-simulated. The answer is counterfactual claims, verified like any other line, and the id
of the what-if run for the ghost path. A question that maps to no option gets a fixed refusal,
never narration.
"""

from __future__ import annotations

import argparse
import asyncio
import re
from typing import Any

from agents.context import MomentContext
from agents.llm import DEFAULT_TIMEOUT_S, ask
from agents.prompts import CREW
from agents.schemas import Language, Persona, Strict
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.render import RenderPayload, build_payload
from explain.render import ScriptLine as RenderLine
from explain.verifier import Verifier
from sim.counterfactual import WhatIfResult, what_if_id

WHATIF = f"""ROLE: whatif
{CREW}
A viewer asks what would have happened if the player had done something else. Map the question to
exactly one of the options he evaluated (their ids are given), or to null when no option matches.
Never invent an option."""

REFUSAL: dict[Language, str] = {
    "en": "That is not something he could do from there.",
    "zh": "他当时没有这个选项。",
}
_PLAYER = re.compile(r"(?<![A-Z0-9])([HA]\d{1,2})(?!\d)")
_KEYWORDS = {
    "carry": ("carry", "carried", "dribble", "run with", "带球", "盘带"),
    "shot": ("shoot", "shot", "射门"),
}


class WhatIfChoice(Strict):
    action: str | None  # an option id, or null when the question matches none


class WhatIfAnswer(Strict):
    question: str
    language: Language
    action: str | None
    source: str  # "llm" or "template": who mapped the question
    refusal: str | None
    counterfactual: str | None  # what-if run id, for the ghost path
    factual_action: str | None
    claims: list[Claim]
    payload: RenderPayload | None


def options(ctx: MomentContext) -> list[str]:
    decision = ctx.run.hero_decision()
    return [o.action for o in decision.options] if decision else []


def _rule_map(question: str, available: list[str]) -> str | None:
    text = question.upper()
    for pid in _PLAYER.findall(text):
        if f"pass:{pid}" in available:
            return f"pass:{pid}"
    lower = question.lower()
    for action, words in _KEYWORDS.items():
        if action in available and any(w in lower for w in words):
            return action
    return None


async def map_question(
    ctx: MomentContext,
    question: str,
    client: Any | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> tuple[str | None, str]:
    """(option id or None, "llm" | "template"). A model answer outside the options is ignored."""
    available = options(ctx)
    if client is not None:
        prompt = f"Question: {question}\nOptions: {available}"
        attempt = await ask(client, name="whatif", instructions=WHATIF, prompt=prompt,
                            schema=WhatIfChoice, timeout_s=timeout_s)  # fmt: skip
        if attempt.value is not None and attempt.value.action in available:
            return attempt.value.action, "llm"
    return _rule_map(question, available), "template"


def _claims(ctx: MomentContext, w: WhatIfResult) -> list[Claim]:
    hero = w.factual_decision.player
    passes = [
        e for e in w.counterfactual.events
        if e.type == "pass" and e.player == hero and e.frame == w.factual_decision.frame
    ]  # fmt: skip
    out: list[Claim] = []
    if w.action.startswith("pass:") and passes:
        p = passes[0]
        at = {"event": p.id, "cf": w.id}
        target = Slot(ref=w.action.removeprefix("pass:"))
        outcome, receiver = p.attrs.get("outcome"), p.attrs.get("receiver")
        checks = [
            Predicate(op="eq", lhs=fn("event_attr", attr="player", **at), rhs=slot("player")),
            Predicate(op="eq", lhs=fn("event_attr", attr="to", **at), rhs=slot("target")),
            Predicate(op="eq", lhs=fn("event_attr", attr="outcome", **at), rhs=outcome),
        ]
        if outcome == "complete" and receiver:
            checks.append(Predicate(op="eq", lhs=fn("event_attr", attr="receiver", **at),
                                    rhs=slot("receiver")))  # fmt: skip
            out.append(Claim(
                id="whatif_outcome",
                template="If {player} had passed to {target}, {receiver} would have received it.",
                templates={"zh": "如果{player}把球传给{target}，{receiver}会接到球。"},
                slots={"player": Slot(ref=hero), "target": target, "receiver": Slot(ref=receiver)},
                predicate=Predicate(op="all", args=checks), evidence=[p.id],
            ))  # fmt: skip
        elif outcome == "intercepted" and receiver:
            checks.append(Predicate(op="eq", lhs=fn("event_attr", attr="receiver", **at),
                                    rhs=slot("interceptor")))  # fmt: skip
            out.append(Claim(
                id="whatif_outcome",
                template="If {player} had passed to {target}, {interceptor} would have "
                         "intercepted it.",
                templates={"zh": "如果{player}把球传给{target}，球会被{interceptor}断下。"},
                slots={"player": Slot(ref=hero), "target": target,
                       "interceptor": Slot(ref=receiver)},
                predicate=Predicate(op="all", args=checks), evidence=[p.id],
            ))  # fmt: skip
    delta = fn("cf_delta", of="possession_value", scan=w.id)
    value = round(abs(w.delta_xt), 2)
    better = w.delta_xt >= 0  # what he did was worth more than the forced option
    out.append(Claim(
        id="whatif_value",
        template=f"That option would have been worth {{dxt}} {'less' if better else 'more'} in "
                 "expected threat than what he did.",
        templates={"zh": "这样处理比他实际的选择少{dxt}的预期威胁（xT）。" if better
                   else "这样处理比他实际的选择多{dxt}的预期威胁（xT）。"},
        slots={"dxt": Slot(value=value, decimals=2)},
        predicate=Predicate(op="approx", lhs=delta, rhs=slot("dxt", scale=1.0 if better else -1.0),
                            abs_tol=0.005),
        evidence=[p.id for p in passes] or [ctx.key_scan.id],
    ))  # fmt: skip
    return out


async def answer_question(
    ctx: MomentContext,
    question: str,
    language: Language = "en",
    persona: Persona = "analyst",
    client: Any | None = None,
) -> WhatIfAnswer:
    action, source = await map_question(ctx, question, client)
    factual = ctx.run.hero_decision()
    if action is None:
        return WhatIfAnswer(question=question, language=language, action=None, source=source,
                            refusal=REFUSAL[language], counterfactual=None,
                            factual_action=factual.chosen if factual else None, claims=[],
                            payload=None)  # fmt: skip
    cf_id = what_if_id(factual.player, factual.frame, action)
    result = ctx.evaluator.counterfactual(cf_id)  # re-simulated once, then cached
    claims = _claims(ctx, result)
    verifier = Verifier(ctx.evaluator, sink=ctx.audit)
    verdicts = {c.id: verifier.verify(c) for c in claims}
    lines = [RenderLine(id=f"Q{i + 1}", text=c.template_for(language), claims=[c.id])
             for i, c in enumerate(claims)]  # fmt: skip
    built = build_payload(f"{ctx.card.id}?{cf_id}", persona, language, lines,
                          {c.id: c for c in claims}, verdicts, ctx.names)  # fmt: skip
    return WhatIfAnswer(question=question, language=language, action=action, source=source,
                        refusal=None, counterfactual=cf_id, factual_action=factual.chosen,
                        claims=claims, payload=built.payload)  # fmt: skip


def main() -> None:
    parser = argparse.ArgumentParser(description='Answer a "What if…?" question by re-simulation.')
    parser.add_argument("question")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--language", default="en", choices=["en", "zh"])
    args = parser.parse_args()
    ctx = MomentContext.load(args.scenario, args.seed)
    a = asyncio.run(answer_question(ctx, args.question, language=args.language))
    print(f"options: {options(ctx)}")
    print(f"mapped to {a.action} ({a.source}); he actually chose {a.factual_action}")
    if a.refusal:
        print(a.refusal)
    for line in a.payload.lines if a.payload else []:
        print(f"  {line.text}")


if __name__ == "__main__":
    main()
