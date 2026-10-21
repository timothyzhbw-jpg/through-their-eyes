""" "What if…?" questions answered by re-simulation (SPEC 3.7 force_action, SPEC 6).

    uv run --env-file .env python -m agents.whatif --seed 3 "What if he passed to the keeper?"
    uv run python -m agents.whatif --seed 3 --offline --language zh "如果他传给H4呢？"

The question is mapped to one of the options the player evaluated — by the Analyst when a model is
configured, by a small rule parser otherwise — and nothing else. That option is forced and the
moment re-simulated. The answer is counterfactual claims, verified like any other line, and the id
of the what-if run for the ghost path. A question that maps to no option gets a fixed refusal,
never narration: so does a model answer of null, and a moment without his decision.

Viewers name receivers by role ("the centre-back") as often as by shirt. Both mappers get each pass
option's receiver with his role and where he stood at the decision, nearest receiver first, and
both pick by one rule (PICK, given to the model word for word):
- a side named with a role picks the receiver labelled with it: of the receivers sharing a role,
  the one furthest left as his team attacks is "the left …", the one furthest right "the right …";
- otherwise "back" or "forward" picks a receiver behind or ahead of the ball (DEPTH_M);
- otherwise the nearest. So "the centre-back" is H4 on the seed-3 hero moment, for both.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import re
from collections.abc import Iterable
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
from sim.model import Decision
from sim.run import MatchRun

PICK = """Picking a receiver:
- A shirt (H4) names him. A role word (centre-back, keeper, winger…) names the receivers with that
  role; left-back and right-back are full-backs.
- A side with the role (left-back, left centre-back, the winger on the right) means the receiver
  whose label carries that side. When only one receiver has the role, he is meant whatever the side.
- Otherwise "back" or "behind" means a receiver behind the ball and "forward" or "ahead" one ahead
  of it, when a receiver with the role stood there.
- Otherwise the role word means the only receiver with that role, or the one the prompt says it
  means; a question that sends the ball back ("back", "behind") or forward ("forward", "ahead")
  changes that only where the prompt says so.
- Left and right are as his team attacks. "Left of centre" and "right of centre" only say where on
  the pitch a receiver stood; they never decide a side named with a role.
- Taking a player on or dribbling past him is a carry: that player is an opponent, not a receiver.
- What the question rules out ("instead of shooting", "didn't carry it") is not the answer."""

WHATIF = f"""ROLE: whatif
{CREW}
A viewer asks what would have happened if the player had done something else. Map the question to
exactly one of the options he evaluated (their ids are given), or to null when no option matches.
Never invent an option, and never swap in a different action: a shot when no shot is listed is null.
{PICK}"""

REFUSAL: dict[Language, str] = {
    "en": "That is not something he could do from there.",
    "zh": "他当时没有这个选项。",
}
ROLE_NAMES = {
    "GK": "goalkeeper", "CB": "centre-back", "FB": "full-back", "DM": "defensive midfielder",
    "CM": "central midfielder", "AM": "attacking midfielder", "W": "winger", "ST": "striker",
}  # fmt: skip
DEPTH_M = 3.0  # m along the attack: closer than this to the ball, a receiver is level with it
CENTRE_M = 5.0  # m across: closer than this to the long axis, he stood in the middle
_ACTIONS = {"carry": "run with the ball", "shot": "shoot at goal"}
_PLAYER = re.compile(r"(?<![A-Z0-9])([HA]\d{1,2})(?!\d)", re.IGNORECASE)
_KEYWORDS = {
    "carry": ("carry", "carries", "carried", "carrying", "dribble", "dribbles", "dribbled",
              "dribbling", "run with", "runs with", "ran with", "running with", "take on",
              "takes on", "took on", "taking on", "带球", "盘带", "过人"),
    "shot": ("shoot", "shoots", "shooting", "shot", "shots", "射门"),
}  # fmt: skip
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


def _key(text: str) -> str:
    return re.sub(r"[-\s]", "", text.lower())


def _words(words: Iterable[str], plural: bool) -> re.Pattern[str]:
    """Whole words, longest first; "centre-back" also as "centre back" or "centreback", and with
    `plural` as "centre-backs"."""
    alternatives = []
    for w in sorted(words, key=len, reverse=True):
        if not w.isascii():
            alternatives.append(re.escape(w))
            continue
        body = r"[-\s]*".join(map(re.escape, re.split(r"[-\s]", w)))
        alternatives.append(rf"(?<![a-z0-9]){body}{'s?' if plural else ''}(?![a-z0-9])")
    return re.compile("|".join(alternatives), re.IGNORECASE)


_ROLES_OF = {_key(w): roles for roles, words in _ROLE_WORDS.items() for w in words}
_ACTION_OF = {_key(w): action for action, words in _KEYWORDS.items() for w in words}
_ROLE = _words([w for words in _ROLE_WORDS.values() for w in words], plural=True)
_ACTION = _words([w for words in _KEYWORDS.values() for w in words], plural=False)
_SIDE_BEFORE = re.compile(
    r"(?:(?<![a-z])(left|right)(?:[-\s]*sided|[-\s]+side)?[-\s]*|(左|右)[边侧]?的?)$", re.IGNORECASE
)
_SIDE_AFTER = re.compile(
    r"[\s,]*(?:(?:out|over|wide|up|down)\s+)?(?:on|to|in|down)\s+(?:the\s+)?(left|right)(?![a-z])",
    re.IGNORECASE,
)
_LEFT, _RIGHT = ("left", "左", "lb", "lw"), ("right", "右", "rb", "rw")
_BACK = re.compile(r"(?<![a-z])(?:back(?:wards?)?|behind)(?![a-z])|回传|回敲", re.IGNORECASE)
_FORWARD = re.compile(r"(?<![a-z])(?:forwards?|ahead|upfield)(?![a-z])|向前|往前|直塞", re.I)
_CLAUSE = re.compile(r"[,;.!?，；。！？]")
# "instead of" rules out the next cue in its clause; "not" only a cue at most _NEAR words after it.
_NEGATION = re.compile(
    r"(?P<phrase>instead of|rather than|而不是|不是)"
    r"|(?P<word>(?<![a-z])(?:not|never|without)(?![a-z])|n['’]t(?![a-z])|没有|不|没|别)",
    re.IGNORECASE,
)
_NEAR = 3  # words, or CJK characters


@dataclass(frozen=True)
class Receiver:
    """A pass option's receiver as he stood at the decision, seen from the passer's team."""

    action: str
    player: str
    role: str
    distance: float  # m from the ball
    ahead: float  # m ahead of the ball toward the goal his team attacks
    left: float  # m left of the pitch's long axis, as his team attacks
    side: str | None = None  # "left"/"right" when another receiver shares his role (_labelled)

    @property
    def depth(self) -> str:
        return "ahead" if self.ahead > DEPTH_M else "behind" if self.ahead < -DEPTH_M else "level"

    @property
    def name(self) -> str:
        """His role in words, with his side when he shares it: the left centre-back, the
        right-back."""
        role = ROLE_NAMES.get(self.role, self.role)
        if self.side is None:
            return role
        return f"{self.side}-back ({role})" if self.role == "FB" else f"{self.side} {role}"

    @property
    def where(self) -> str:
        depth = {"ahead": "ahead of", "behind": "behind", "level": "level with"}[self.depth]
        flank = ("left of centre" if self.left > CENTRE_M else "right of centre"
                 if self.left < -CENTRE_M else "in the middle")  # fmt: skip
        return f"{depth} the ball, {flank}"


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


def _furthest(fits: list[Receiver], side: str) -> Receiver:
    """Of these receivers, the one furthest to `side` as his team attacks."""
    return max(fits, key=lambda r: r.left if side == "left" else -r.left)


def _labelled(recv: list[Receiver]) -> list[Receiver]:
    """Each receiver who shares his role with another labelled with his side: of them, the one
    furthest left is "left" and the one furthest right "right". Order kept."""
    side: dict[str, str] = {}
    for role in {r.role for r in recv}:
        fits = [r for r in recv if r.role == role]
        if len(fits) > 1:
            side[_furthest(fits, "left").action] = "left"
            side[_furthest(fits, "right").action] = "right"
    return [dataclasses.replace(r, side=side.get(r.action)) for r in recv]


def receivers(run: MatchRun, decision: Decision) -> list[Receiver]:
    """A decision's pass options as receivers at its frame, nearest first (ties in option order),
    sides labelled."""
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
    return _labelled(sorted(out, key=lambda r: r.distance))


def _option_lines(recv: list[Receiver], available: list[str]) -> list[str]:
    passes = {r.action for r in recv}
    return [f"- {r.action}: pass to {r.player}, the {r.name}, {r.where}" for r in recv] + [
        f"- {a}: {_ACTIONS.get(a, a)}" for a in available if a not in passes
    ]


def _meant(recv: list[Receiver], role: str, depth: str | None = None) -> Receiver:
    """Who a role word with no side means: the nearest receiver with the role, at the depth the
    question sends the ball to when one stood there."""
    fits = [r for r in recv if r.role == role]
    return next((r for r in fits if r.depth == depth), fits[0])


def _defaults(recv: list[Receiver]) -> str | None:
    """Who a role word with no side means, said outright for each role receivers share (Foundry did
    not reliably take "the nearest" from the order of the list)."""
    parts = []
    for role in dict.fromkeys(r.role for r in recv):  # nearest first
        if sum(r.role == role for r in recv) < 2:
            continue
        base = _meant(recv, role)
        alts = [f"{_meant(recv, role, depth).player} if sent {word}"
                for word, depth in (("back", "behind"), ("forward", "ahead"))
                if _meant(recv, role, depth) != base]  # fmt: skip
        parts.append(f'"the {ROLE_NAMES.get(role, role)}" means {base.player}'
                     + (f" ({', '.join(alts)})" if alts else ""))  # fmt: skip
    return f"Unless a side is named: {'; '.join(parts)}." if parts else None


def _prompt(
    run: MatchRun, decision: Decision, question: str, available: list[str], recv: list[Receiver]
) -> str:
    role = run.players[run.index(decision.player)].role
    defaults = _defaults(recv)
    return "\n".join([
        f"Question: {question}",
        f"He is {decision.player}, the {ROLE_NAMES.get(role, role)}, on the ball. "
        "His options, passes nearest receiver first:",
        *_option_lines(recv, available),
        *([defaults] if defaults else []),
    ])  # fmt: skip


def _side(question: str, m: re.Match[str]) -> str | None:
    """The side named with a role word: left-back, LW, left(-sided) winger, the winger on the left,
    左边锋, 左边的中后卫; else None."""
    word = _key(m.group(0))
    before = _SIDE_BEFORE.search(question, 0, m.start())
    after = _SIDE_AFTER.match(question, m.end())
    said = [g.lower() for x in (before, after) if x for g in x.groups() if g]
    for side, marks in (("left", _LEFT), ("right", _RIGHT)):
        if word.startswith(marks) or any(s in marks for s in said):
            return side
    return None


def _depth(question: str, m: re.Match[str]) -> str | None:
    """The depth the role word's clause names: "behind" for back, "ahead" for forward."""
    lo = max((c.end() for c in _CLAUSE.finditer(question, 0, m.start())), default=0)
    hi = next((c.start() for c in _CLAUSE.finditer(question, m.end())), len(question))
    clause = _ROLE.sub(lambda r: " " * len(r.group(0)), question[lo:hi])  # no "back" in full-back
    back, forward = _BACK.search(clause), _FORWARD.search(clause)
    if back and not forward:
        return "behind"
    if forward and not back:
        return "ahead"
    return None


def _named(question: str, m: re.Match[str], recv: list[Receiver]) -> list[str]:
    """The pass options a role word names, best first, by PICK."""
    key = _key(m.group(0))
    roles = _ROLES_OF.get(key) or _ROLES_OF[key.removesuffix("s")]
    fits = [r for r in recv if r.role in roles]
    if fits and (side := _side(question, m)):
        return [_furthest(fits, side).action]
    depth = _depth(question, m)
    return [r.action for r in sorted(fits, key=lambda r: r.depth != depth)]  # stable: nearest first


def _cues(question: str, available: list[str], recv: list[Receiver]) -> list[tuple]:
    """(start, end, options it names, best first) for each player id, role word and action keyword
    in the question; options is None for an action he did not have (no shot from there)."""
    cues: list[tuple] = []
    for m in _PLAYER.finditer(question):
        action = f"pass:{m.group(1).upper()}"
        cues.append((m.start(), m.end(), [action] if action in available else []))
    for m in _ROLE.finditer(question):
        cues.append((m.start(), m.end(), _named(question, m, recv)))
    for m in _ACTION.finditer(question):
        action = _ACTION_OF[_key(m.group(0))]
        cues.append((m.start(), m.end(), [action] if action in available else None))
    return sorted(cues, key=lambda c: c[0])


def _ruled_out(question: str, lo: int, start: int) -> bool:
    """Whether what stands between the previous cue (ending at `lo`) and this one rules it out:
    "instead of" or "rather than" earlier in its clause, or "not", "never", "without" at most _NEAR
    words before it."""
    marks = list(_NEGATION.finditer(question, lo, start))
    if not marks:
        return False
    between = question[marks[-1].end() : start]
    if _CLAUSE.search(between):
        return False
    return (
        bool(marks[-1].group("phrase"))
        or len(re.findall(r"[a-z0-9]+|[^\x00-\x7f]", between, re.IGNORECASE)) <= _NEAR
    )


def _rule_map(question: str, available: list[str], recv: list[Receiver]) -> str | None:
    """The first option the question names and does not rule out. An action he did not have
    refuses the question rather than falling through to a later cue."""
    lo = 0
    for start, end, named in _cues(question, available, recv):
        ruled_out = _ruled_out(question, lo, start)
        lo = end
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
    """(option id or None, "llm" | "template"). The model's answer stands, null included (a
    refusal); the rules answer when there is no model, the call fails or the id is not an option.
    A moment without his decision is refused without asking either."""
    decision, available = ctx.run.hero_decision(), options(ctx)
    if decision is None or not available:
        return None, "template"
    recv = receivers(ctx.run, decision)
    if client is not None:
        prompt = _prompt(ctx.run, decision, question, available, recv)
        schema = create_model("WhatIfChoice", __base__=Strict,
                              action=(Literal[tuple(available)] | None, ...))  # fmt: skip
        attempt = await ask(client, name="whatif", instructions=WHATIF, prompt=prompt,
                            schema=schema, timeout_s=timeout_s)  # fmt: skip
        if attempt.value is not None and attempt.value.action in (*available, None):
            return attempt.value.action, "llm"
    return _rule_map(question, available, recv), "template"


def _decision_evidence(ctx: MomentContext) -> str:
    """An event at the decision to seek to: the key scan, else the action or the reception."""
    if ctx.key_scan is not None:
        return ctx.key_scan.id
    anchors = ctx.card.anchors
    return anchors.get("action") or anchors["reception"]


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
    if w.action == "carry":
        tackle = next(
            (e for e in w.counterfactual.events
             if e.type == "tackle" and e.attrs.get("won_from") == hero
             and e.frame > w.factual_decision.frame),
            None,
        )  # fmt: skip
        if tackle is not None:
            at = {"event": tackle.id, "cf": w.id}
            out.append(Claim(
                id="whatif_outcome",
                template="If {player} had carried it, {tackler} would have won the ball off him.",
                templates={"zh": "如果{player}带球，{tackler}会把球抢走。"},
                slots={"player": Slot(ref=hero), "tackler": Slot(ref=tackle.player)},
                predicate=Predicate(op="all", args=[
                    Predicate(op="eq", lhs=fn("event_attr", attr="type", **at), rhs="tackle"),
                    Predicate(op="eq", lhs=fn("event_attr", attr="player", **at),
                              rhs=slot("tackler")),
                    Predicate(op="eq", lhs=fn("event_attr", attr="won_from", **at),
                              rhs=slot("player")),
                ]),
                evidence=[_decision_evidence(ctx)],
            ))  # fmt: skip
    delta = fn("cf_delta", of="possession_value", scan=w.id)
    value = round(abs(w.delta_xt), 2)
    better = w.delta_xt >= 0  # what he did was worth more than the forced option
    out.append(Claim(
        id="whatif_value",
        template=f"That option would have been worth {{dxt}} {'less' if better else 'more'} in "
                 "expected threat than what he did.",
        templates={"zh": "这个选择比他实际的选择少{dxt}的预期威胁（xT）。" if better
                   else "这个选择比他实际的选择多{dxt}的预期威胁（xT）。"},
        slots={"dxt": Slot(value=value, decimals=2)},
        predicate=Predicate(op="approx", lhs=delta, rhs=slot("dxt", scale=1.0 if better else -1.0),
                            abs_tol=0.005),
        evidence=[p.id for p in passes] or [_decision_evidence(ctx)],
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
    decision = ctx.run.hero_decision()
    recv = receivers(ctx.run, decision) if decision else []
    print(f"options: {[f'{r.action} ({r.role})' for r in recv]} + "
          f"{[o for o in options(ctx) if not o.startswith('pass:')]}")  # fmt: skip
    print(f"mapped to {a.action} ({a.source}); he actually chose {a.factual_action}")
    if a.refusal:
        print(a.refusal)
    for line in a.payload.lines if a.payload else []:
        print(f"  {line.text}")


if __name__ == "__main__":
    main()
