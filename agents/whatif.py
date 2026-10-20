""" "What if…?" questions answered by re-simulation (SPEC 3.7 force_action, SPEC 6).

    uv run --env-file .env python -m agents.whatif --seed 3 "What if he passed to the keeper?"
    uv run python -m agents.whatif --seed 3 --offline --language zh "如果他传给H4呢？"

The question is mapped to one of the options the player evaluated — by the Analyst when a model is
configured, by a small rule parser otherwise — and nothing else. That option is forced and the
moment re-simulated. The answer is counterfactual claims, verified like any other line, and the id
of the what-if run for the ghost path. A question that maps to no option gets a fixed refusal,
never narration.

Viewers name receivers by role ("the centre-back") as often as by shirt. Both mappers see each pass
option's receiver with his role and where he stood at the decision (behind, level with or ahead of
the ball; left, centre or right as his team attacks), nearest receiver first. When a role fits
more than one receiver (two centre-backs), "left"/"right" in the question picks the one furthest
to that side; otherwise the nearer receiver is meant. The model is told the same rule, so both
mappers resolve "the centre-back" to the same player.
"""

from __future__ import annotations

import argparse
import asyncio
import re
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from pydantic import create_model

from agents.context import MomentContext
from agents.llm import DEFAULT_TIMEOUT_S, ask, client_from_env
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
Never invent an option, and never swap in a different action: a shot when no shot is listed is null.
Each pass option names its receiver, his role and where he stood; a role word (centre-back, keeper,
winger…) means a receiver with that role. Left and right are as his team attacks. Passes are listed
nearest receiver first: when several receivers fit and the question does not say which side, choose
the first one listed."""

REFUSAL: dict[Language, str] = {
    "en": "That is not something he could do from there.",
    "zh": "他当时没有这个选项。",
}
ROLE_NAMES = {
    "GK": "goalkeeper", "CB": "centre-back", "FB": "full-back", "DM": "defensive midfielder",
    "CM": "central midfielder", "AM": "attacking midfielder", "W": "winger", "ST": "striker",
}  # fmt: skip
_ACTIONS = {"carry": "run with the ball", "shot": "shoot at goal"}
_PLAYER = re.compile(r"(?<![A-Z0-9])([HA]\d{1,2})(?!\d)", re.IGNORECASE)
_KEYWORDS = {
    "carry": ("carry", "carried", "dribble", "run with", "带球", "盘带"),
    "shot": ("shoot", "shot", "射门"),
}
# Words a viewer may use for a receiver's role. Bare "back" and "forward" are directions, not roles.
_ROLE_WORDS: dict[tuple[str, ...], tuple[str, ...]] = {
    ("GK",): ("goalkeeper", "goal keeper", "keeper", "goalie", "gk", "门将", "守门员"),
    ("CB",): ("centre-back", "center-back", "central defender", "cb", "中后卫", "中卫"),
    ("FB",): ("full-back", "wing-back", "left-back", "right-back", "fb", "lb", "rb",
              "边后卫", "左后卫", "右后卫"),
    ("DM",): ("defensive midfielder", "holding midfielder", "defensive mid", "holding mid", "dm",
              "cdm", "后腰"),
    ("CM",): ("central midfielder", "centre midfielder", "center midfielder", "cm"),
    ("AM",): ("attacking midfielder", "cam", "前腰"),
    ("W",): ("winger", "wide man", "lw", "rw", "边锋"),
    ("ST",): ("striker", "centre-forward", "center-forward", "cf", "st", "前锋", "中锋"),
    ("CB", "FB"): ("defender", "后卫"),
    ("DM", "CM", "AM"): ("midfielder", "中场"),
}  # fmt: skip
_ROLES_OF = {re.sub(r"[-\s]", "", w): roles for roles, words in _ROLE_WORDS.items() for w in words}
_WORDS = [w for words in _ROLE_WORDS.values() for w in words]


def _word(w: str) -> str:
    """A role word as a regex: whole words only, and "centre-back" also as "centre back"."""
    if not w.isascii():
        return re.escape(w)
    parts = map(re.escape, re.split(r"[-\s]", w))
    return r"(?<![a-z0-9])" + r"[-\s]*".join(parts) + r"(?![a-z0-9])"


_ROLE = re.compile("|".join(_word(w) for w in sorted(_WORDS, key=len, reverse=True)),
                   re.IGNORECASE)  # fmt: skip
_ACTION = re.compile("|".join(re.escape(w) for ws in _KEYWORDS.values() for w in ws), re.I)
_SIDE_BEFORE = re.compile(r"(?:(?<![a-z])(left|right)[-\s]*|(左|右))$", re.IGNORECASE)
_RULED_OUT = re.compile(r"instead of|rather than|而不是", re.IGNORECASE)


@dataclass(frozen=True)
class Receiver:
    """A pass option's receiver as he stood at the decision, seen from the passer's team."""

    action: str
    player: str
    role: str
    distance: float  # m from the ball
    ahead: float  # m ahead of the ball toward the goal his team attacks
    left: float  # m left of the pitch's long axis, as his team attacks

    @property
    def name(self) -> str:
        """His role in words; a full-back also as the left-back or right-back he is."""
        name = ROLE_NAMES.get(self.role, self.role)
        if self.role == "FB":
            name += f" ({'left' if self.left > 0 else 'right'}-back)"
        return name

    @property
    def where(self) -> str:
        depth = ("ahead of" if self.ahead > 3.0 else "behind" if self.ahead < -3.0
                 else "level with")  # fmt: skip
        flank = "on the left" if self.left > 5.0 else "on the right" if self.left < -5.0 else ""
        return f"{depth} the ball, {flank or 'in the centre'}"


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


def receivers(ctx: MomentContext) -> list[Receiver]:
    """His pass options' receivers at the decision, nearest first (ties in option order)."""
    decision, run = ctx.run.hero_decision(), ctx.run
    if decision is None:
        return []
    sign = 1 if run.players[run.index(decision.player)].team == 0 else -1  # home attacks +x
    ball = run.ball_pos[decision.frame, :2]
    out = []
    for o in decision.options:
        if o.target_player is None:
            continue
        i = run.index(o.target_player)
        pos = run.pos[decision.frame, i]
        out.append(Receiver(o.action, o.target_player, run.players[i].role,
                            float(np.hypot(*(pos - ball))), float(sign * (pos[0] - ball[0])),
                            float(sign * pos[1])))  # fmt: skip
    return sorted(out, key=lambda r: r.distance)


def _prompt(ctx: MomentContext, question: str, available: list[str], recv: list[Receiver]) -> str:
    decision = ctx.run.hero_decision()
    role = ctx.run.players[ctx.run.index(decision.player)].role
    lines = [f"Question: {question}",
             f"He is {decision.player}, the {ROLE_NAMES.get(role, role)}, on the ball. "
             "His options, passes nearest receiver first:"]  # fmt: skip
    lines += [f"- {r.action}: pass to {r.player}, the {r.name}, {r.where}" for r in recv]
    passes = {r.action for r in recv}
    lines += [f"- {a}: {_ACTIONS.get(a, a)}" for a in available if a not in passes]
    return "\n".join(lines)


def _side(question: str, m: re.Match[str]) -> str | None:
    """The side a role word names (left-back, LW, left winger, 左边锋), else None."""
    word = m.group(0).lower()
    before = _SIDE_BEFORE.search(question, 0, m.start())
    named = (before.group(1) or before.group(2)).lower() if before else ""
    if word.startswith(("left", "左")) or word in ("lb", "lw") or named in ("left", "左"):
        return "left"
    if word.startswith(("right", "右")) or word in ("rb", "rw") or named in ("right", "右"):
        return "right"
    return None


def _cues(question: str, available: list[str], recv: list[Receiver]) -> list[tuple]:
    """(start, end, options it names, nearest first) for each player id, role word and action
    keyword in the question; options is None for an action he did not have (no shot from there)."""
    cues: list[tuple] = []
    for m in _PLAYER.finditer(question):
        action = f"pass:{m.group(1).upper()}"
        cues.append((m.start(), m.end(), [action] if action in available else []))
    for m in _ROLE.finditer(question):
        roles = _ROLES_OF[re.sub(r"[-\s]", "", m.group(0).lower())]
        fits = [r for r in recv if r.role in roles]
        if (side := _side(question, m)) and fits:
            fits = [max(fits, key=lambda r: r.left if side == "left" else -r.left)]
        cues.append((m.start(), m.end(), [r.action for r in fits]))
    for m in _ACTION.finditer(question):
        action = next(a for a, ws in _KEYWORDS.items() if m.group(0).lower() in ws)
        cues.append((m.start(), m.end(), [action] if action in available else None))
    return sorted(cues, key=lambda c: c[0])


def _rule_map(question: str, available: list[str], recv: list[Receiver]) -> str | None:
    """The first option the question names. A cue right after "instead of" is ruled out; an
    action he did not have refuses the question rather than falling through to a later cue."""
    prev = 0
    for start, end, named in _cues(question, available, recv):
        ruled_out = _RULED_OUT.search(question, prev, start)
        prev = end
        if ruled_out:
            continue
        if named is None:
            return None
        if named:
            return named[0]
    return None


async def map_question(
    ctx: MomentContext,
    question: str,
    client: Any | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> tuple[str | None, str]:
    """(option id or None, "llm" | "template"). A model answer outside the options is ignored."""
    available, recv = options(ctx), receivers(ctx)
    if client is not None:
        prompt = _prompt(ctx, question, available, recv)
        schema = create_model("WhatIfChoice", __base__=Strict,
                              action=(Literal[tuple(available)] | None, ...))  # fmt: skip
        attempt = await ask(client, name="whatif", instructions=WHATIF, prompt=prompt,
                            schema=schema, timeout_s=timeout_s)  # fmt: skip
        if attempt.value is not None and attempt.value.action in available:
            return attempt.value.action, "llm"
    return _rule_map(question, available, recv), "template"


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


async def _main_async(args: argparse.Namespace) -> tuple[MomentContext, WhatIfAnswer]:
    ctx = MomentContext.load(args.scenario, args.seed)
    client, close = (None, None) if args.offline else client_from_env()
    try:
        return ctx, await answer_question(ctx, args.question, args.language, client=client)
    finally:
        if close is not None:
            await close()


def main() -> None:
    parser = argparse.ArgumentParser(description='Answer a "What if…?" question by re-simulation.')
    parser.add_argument("question")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--language", default="en", choices=["en", "zh"])
    parser.add_argument("--offline", action="store_true", help="rule parser only, no model call")
    args = parser.parse_args()
    ctx, a = asyncio.run(_main_async(args))
    print(f"options: {[f'{r.action} ({r.role})' for r in receivers(ctx)]} + "
          f"{[o for o in options(ctx) if not o.startswith('pass:')]}")  # fmt: skip
    print(f"mapped to {a.action} ({a.source}); he actually chose {a.factual_action}")
    if a.refusal:
        print(a.refusal)
    for line in a.payload.lines if a.payload else []:
        print(f"  {line.text}")


if __name__ == "__main__":
    main()
