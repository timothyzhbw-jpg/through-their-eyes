"""Take his eyes (SPEC 3.7, 7): what one look the viewer chose for the hero changes, in verified
lines.

    uv run python -m agents.look --seed 3 --frame 50 --offset -150
    uv run python -m agents.look --scenario press_escape --seed 0 --frame 41 --offset 90 -l zh

The look is a re-simulation (`sim.counterfactual.look_counterfactual`): from the pass to him until
his decision, the hero looks only there. Every line is a template whose numbers and names are
slots, checked by the Verifier on that run (and on the run with no look at all, for the belief
he had without it). No model is called, so no line can carry a number the sim did not produce.

Lines, in order (each only when it applies):
- when and where he looked ("over his right shoulder 0.8 s before the ball reaches him");
- that his head was still turning when he had to decide (a look that came too late);
- which teammates he saw in it before he decided, or that he saw none;
- how far off his picture of the player that mattered most was, with the look and without one;
- what he did, against what he really did;
- what came of it, and its value in expected threat against what he really did.
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass

from agents.context import MomentContext
from agents.schemas import Language, Persona
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.render import RenderPayload, build_payload
from explain.render import ScriptLine as RenderLine
from explain.verifier import Verifier
from sim.config import SimParams
from sim.counterfactual import LookResult, look_id
from sim.model import Event
from sim.run import MatchRun

OVER_THE_SHOULDER = 2.09  # rad (120 deg): a look this far from the ball goes over his shoulder
MOVED_M = 1.0  # m: a belief that moved less than this between the two runs is not worth a line
SEEN = SimParams().perception_threshold


@dataclass(frozen=True)
class LookAnswer:
    look: str  # the look's id
    claims: list[Claim]
    payloads: dict[str, RenderPayload]  # by language; only verified lines


def _action_event(run: MatchRun, player: str, frame: int) -> Event | None:
    return next(
        (e for e in run.events
         if e.player == player and e.frame == frame and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip


def _reception(run: MatchRun, player: str, before: int) -> Event:
    return max(
        (e for e in run.events
         if e.type == "reception" and e.player == player and e.frame <= before),
        key=lambda e: e.frame,
    )  # fmt: skip


def _teammates(look: LookResult) -> list[str]:
    """His pass options' receivers, in option order."""
    return [o.target_player for o in look.factual_decision.options if o.target_player]


def _when(look: LookResult, ctx: MomentContext) -> Claim:
    hero, e, cf = look.player, look.look, look.id
    reception = _reception(look.counterfactual, hero, look.factual_decision.frame)
    turn = float(look.offset or 0.0)
    side = "left" if turn > 0 else "right"
    over = abs(turn) >= OVER_THE_SHOULDER
    where_en = f"over his {side} shoulder" if over else f"to his {side}"
    where_zh = {
        ("left", True): "越过左肩向后看", ("right", True): "越过右肩向后看",
        ("left", False): "向左看", ("right", False): "向右看",
    }[(side, over)]  # fmt: skip
    since = fn("metric_at", metric="time_since_last_scan", anchor=reception.id, player=hero, cf=cf)
    checks = [
        Predicate(op="eq", lhs=fn("scan_side", scan=e.id, cf=cf), rhs=side),
        Predicate(op="ge" if over else "lt",
                  lhs=fn("event_attr", event=e.id, attr="amplitude", cf=cf),
                  rhs=OVER_THE_SHOULDER),
        Predicate(op="eq", lhs=fn("event_attr", event=e.id, attr="player", cf=cf),
                  rhs=slot("player")),
    ]  # fmt: skip
    seconds = round((reception.frame - e.frame) * look.counterfactual.dt, 1)
    slots = {"player": Slot(ref=hero)}
    if e.frame >= reception.frame:  # the look starts as the ball reaches him
        checks.append(Predicate(op="approx", lhs=since, rhs=0.0, abs_tol=0.001))
        template = f"You make {{player}} look {where_en} as the ball reaches him."
        zh = f"你让{{player}}在球到脚下的那一刻{where_zh}。"
    else:
        checks.append(Predicate(op="approx", lhs=since, rhs=slot("s"), abs_tol=0.05))
        slots["s"] = Slot(value=seconds, decimals=1)
        template = f"You make {{player}} look {where_en} {{s}} s before the ball reaches him."
        zh = f"你让{{player}}在球到达前{{s}}秒{where_zh}。"
    return Claim(id="look_when", template=template, templates={"zh": zh}, slots=slots,
                 predicate=Predicate(op="all", args=checks), evidence=[reception.id])  # fmt: skip


def _too_late(look: LookResult, until: Event) -> Claim | None:
    e = look.look
    reception = _reception(look.counterfactual, look.player, look.factual_decision.frame)
    if int(e.attrs["end"]) <= until.frame:
        return None
    return Claim(
        id="look_late",
        template="His head is still turning when he has to decide.",
        templates={"zh": "他必须做决定时，头还在转。"},
        predicate=Predicate(op="gt", lhs=fn("event_attr", event=e.id, attr="end", cf=look.id),
                            rhs=fn("event_attr", event=until.id, attr="frame", cf=look.id)),
        evidence=[reception.id],
    )  # fmt: skip


def _saw(look: LookResult, ctx: MomentContext, until: Event) -> Claim:
    """The teammates the look brought into his sight before he decided: out of it as the look
    began (his head still on the ball), in it at some frame of the look up to his decision. Up to
    two, the one he chose first; or that it brought none."""
    hero, e, cf = look.player, look.look, look.id
    reception = _reception(look.counterfactual, hero, look.factual_decision.frame)
    at = round((e.frame - reception.frame) * look.counterfactual.dt, 4)

    def peak(m):
        return fn("max_visibility", observer=hero, target=m, event=e.id, until=until.id, cf=cf)

    def first(m):
        return fn("metric_at", metric="visibility", anchor=reception.id, at=at, observer=hero,
                  target=m, cf=cf)  # fmt: skip

    mates = _teammates(look)
    value = ctx.evaluator.value
    new = {m: value(peak(m)) for m in mates if value(first(m)) < SEEN}
    chosen = look.counterfactual_decision.options if look.counterfactual_decision else []
    picked = next((o.target_player for o in chosen
                   if o.action == look.counterfactual_action), None)  # fmt: skip
    seen = sorted((m for m, v in new.items() if v >= SEEN),
                  key=lambda m: (m != picked, -new[m]))[:2]  # fmt: skip
    if not seen:  # each teammate: in sight as the look began, or never in it until he decided
        return Claim(
            id="look_saw",
            template="Before he decides, that look brings none of his teammates into his sight.",
            templates={"zh": "在他做决定之前，这一眼没有让他看到任何原本看不到的队友。"},
            predicate=Predicate(op="all", args=[
                Predicate(op="ge", lhs=first(m), rhs=SEEN) if m not in new
                else Predicate(op="lt", lhs=peak(m), rhs=SEEN)
                for m in mates
            ]),
            evidence=[reception.id],
        )  # fmt: skip
    slots = {f"mate{k + 1}": Slot(ref=m) for k, m in enumerate(seen)}
    checks = []
    for k in range(len(seen)):
        name = slot(f"mate{k + 1}")
        checks += [Predicate(op="lt", lhs=first(name), rhs=SEEN),
                   Predicate(op="ge", lhs=peak(name), rhs=SEEN)]  # fmt: skip
    if len(seen) == 1:
        template = "Before he decides, that look brings {mate1} into his sight."
        zh = "在他做决定之前，这一眼让他看到了原本看不到的{mate1}。"
    else:
        template = "Before he decides, that look brings {mate1} and {mate2} into his sight."
        zh = "在他做决定之前，这一眼让他看到了原本看不到的{mate1}和{mate2}。"
    return Claim(id="look_saw", template=template, templates={"zh": zh}, slots=slots,
                 predicate=Predicate(op="all", args=checks), evidence=[reception.id])  # fmt: skip


def _belief(look: LookResult, none: LookResult) -> Claim | None:
    """How far off his picture of one teammate was when he decided, with the look and with none:
    the receiver he chose if the look moved his picture of him, else the teammate it moved most."""
    if look.counterfactual_decision is None or none.counterfactual_decision is None:
        return None
    after = look.counterfactual_decision.belief_error
    before = none.counterfactual_decision.belief_error
    mates = _teammates(look)
    if not mates:
        return None
    moved = {m: abs(before[m] - after[m]) for m in mates}
    picked = (look.counterfactual_action or "").removeprefix("pass:")
    mate = picked if moved.get(picked, 0.0) >= MOVED_M else max(mates, key=moved.__getitem__)
    if moved[mate] < MOVED_M:
        return None
    reception = _reception(look.counterfactual, look.player, look.factual_decision.frame)
    at = round((look.factual_decision.frame - reception.frame) * look.counterfactual.dt, 4)
    err = lambda cf: fn("metric_at", metric="belief_error", anchor=reception.id, at=at,  # noqa: E731
                        observer=look.player, target=slot("mate"), cf=cf)  # fmt: skip
    return Claim(
        id="look_belief",
        template="When he decides, he pictures {mate} {after} m from where he really is; "
                 "with no look at all, {before} m.",
        templates={"zh": "做决定时，他脑海中{mate}的位置与实际相差{after}米；"
                         "如果一眼都不看，相差{before}米。"},
        slots={"mate": Slot(ref=mate), "after": Slot(value=round(after[mate], 1), decimals=1),
               "before": Slot(value=round(before[mate], 1), decimals=1)},
        predicate=Predicate(op="all", args=[
            Predicate(op="approx", lhs=err(look.id), rhs=slot("after"), abs_tol=0.05),
            Predicate(op="approx", lhs=err(none.id), rhs=slot("before"), abs_tol=0.05),
        ]),
        evidence=[reception.id],
    )  # fmt: skip


def _choice(look: LookResult) -> Claim | None:
    """What he did with the look, against what he really did (passes and carries)."""
    hero, frame = look.player, look.factual_decision.frame
    mine, his = look.counterfactual_action, look.factual_action
    if mine is None or not all(a.startswith("pass:") or a == "carry" for a in (mine, his)):
        return None
    reception = _reception(look.counterfactual, hero, frame)
    at = round((frame - reception.frame) * look.counterfactual.dt, 4)
    chose = lambda cf: fn("metric_at", metric="chosen", anchor=reception.id, at=at,  # noqa: E731
                          player=hero, **({"cf": cf} if cf else {}))  # fmt: skip
    slots: dict[str, Slot] = {}
    words: dict[str, dict[str, str]] = {}
    for key, action in (("mine", mine), ("his", his)):
        if action == "carry":
            words[key] = {"en": "carries the ball", "past": "carried the ball", "zh": "带球"}
        else:
            slots[key] = Slot(ref=action.removeprefix("pass:"))
            words[key] = {"en": f"passes to {{{key}}}", "past": f"passed to {{{key}}}",
                          "zh": f"传给{{{key}}}"}  # fmt: skip
    checks = [Predicate(op="eq", lhs=chose(look.id), rhs=mine),
              Predicate(op="eq", lhs=chose(None), rhs=his)]  # fmt: skip
    for key, run, cf in (("mine", look.counterfactual, look.id), ("his", look.factual, None)):
        if key in slots:  # the name on screen is the receiver of the pass in that run
            event = _action_event(run, hero, frame)
            if event is None:
                return None
            to = fn("event_attr", event=event.id, attr="to", **({"cf": cf} if cf else {}))
            checks.append(Predicate(op="eq", lhs=to, rhs=slot(key)))
    if mine == his:
        template = f"He still {words['mine']['en']}, as he really did."
        zh = f"他仍然{words['mine']['zh']}，和实际一样。"
        slots.pop("his", None)
        checks = [c for c in checks if c.rhs != slot("his")]
    else:
        template = f"So he {words['mine']['en']}; he really {words['his']['past']}."
        zh = f"于是他{words['mine']['zh']}；实际上他{words['his']['zh']}。"
    return Claim(id="look_choice", template=template, templates={"zh": zh}, slots=slots,
                 predicate=Predicate(op="all", args=checks),
                 evidence=[reception.id])  # fmt: skip


def _outcome(look: LookResult) -> Claim | None:
    hero, cf = look.player, look.id
    frame = look.factual_decision.frame
    action = _action_event(look.counterfactual, hero, frame)
    if action is not None and action.type == "pass":
        outcome, receiver = action.attrs.get("outcome"), action.attrs.get("receiver")
        at = {"event": action.id, "cf": cf}
        if outcome == "complete" and receiver:
            return Claim(
                id="look_outcome",
                template="{receiver} receives it.",
                templates={"zh": "{receiver}接到了球。"},
                slots={"receiver": Slot(ref=receiver)},
                predicate=Predicate(op="all", args=[
                    Predicate(op="eq", lhs=fn("event_attr", attr="outcome", **at), rhs="complete"),
                    Predicate(op="eq", lhs=fn("event_attr", attr="receiver", **at),
                              rhs=slot("receiver")),
                ]),
                evidence=[action.id],
            )  # fmt: skip
        if outcome == "intercepted" and receiver:
            return Claim(
                id="look_outcome",
                template="{interceptor} intercepts it.",
                templates={"zh": "球被{interceptor}断下。"},
                slots={"interceptor": Slot(ref=receiver)},
                predicate=Predicate(op="all", args=[
                    Predicate(op="eq", lhs=fn("event_attr", attr="outcome", **at),
                              rhs="intercepted"),
                    Predicate(op="eq", lhs=fn("event_attr", attr="receiver", **at),
                              rhs=slot("interceptor")),
                ]),
                evidence=[action.id],
            )  # fmt: skip
        return None
    if look.counterfactual_action == "carry":
        tackle = next((e for e in look.counterfactual.events
                       if e.type == "tackle" and e.attrs.get("won_from") == hero
                       and e.frame > frame), None)  # fmt: skip
        if tackle is not None:
            at = {"event": tackle.id, "cf": cf}
            return Claim(
                id="look_outcome",
                template="{tackler} wins the ball off him.",
                templates={"zh": "{tackler}把球抢走了。"},
                slots={"tackler": Slot(ref=tackle.player)},
                predicate=Predicate(op="all", args=[
                    Predicate(op="eq", lhs=fn("event_attr", attr="type", **at), rhs="tackle"),
                    Predicate(op="eq", lhs=fn("event_attr", attr="player", **at),
                              rhs=slot("tackler")),
                ]),
                evidence=[tackle.id],
            )  # fmt: skip
    return None


def _value(look: LookResult) -> Claim | None:
    value = round(abs(look.delta_xt), 2)
    if value < 0.01:
        return None
    better = look.delta_xt > 0  # what he really did was worth more
    action = _action_event(look.counterfactual, look.player, look.factual_decision.frame)
    return Claim(
        id="look_value",
        template=f"That is worth {{dxt}} {'less' if better else 'more'} in expected threat than "
                 "what he really did.",
        templates={"zh": f"这比他实际的选择{'少' if better else '多'}{{dxt}}的预期威胁（xT）。"},
        slots={"dxt": Slot(value=value, decimals=2)},
        predicate=Predicate(op="approx", lhs=fn("cf_delta", of="possession_value", scan=look.id),
                            rhs=slot("dxt", scale=1.0 if better else -1.0), abs_tol=0.005),
        evidence=[action.id if action else _reception(look.factual, look.player,
                                                      look.factual_decision.frame).id],
    )  # fmt: skip


def look_claims(ctx: MomentContext, look: LookResult, none: LookResult) -> list[Claim]:
    """The claims of one look, in line order; `none` is the run with no look at all."""
    out: list[Claim | None] = []
    action = _action_event(look.counterfactual, look.player, look.factual_decision.frame)
    until = action or _reception(look.counterfactual, look.player, look.factual_decision.frame)
    if look.look is not None:
        out += [_when(look, ctx), _too_late(look, until), _saw(look, ctx, until)]
    out += [_belief(look, none) if look.look is not None else None, _choice(look), _outcome(look),
            _value(look)]  # fmt: skip
    return [c for c in out if c is not None]


def answer_look(
    ctx: MomentContext,
    look: LookResult,
    none: LookResult,
    languages: tuple[Language, ...] = ("en", "zh"),
    persona: Persona = "analyst",
) -> LookAnswer:
    """The look's verified lines as SPEC 5.3 render payloads, one per language."""
    for result in (look, none):
        ctx.evaluator.counterfactuals.setdefault(result.id, result)
    claims = look_claims(ctx, look, none)
    verifier = Verifier(ctx.evaluator, sink=ctx.audit)
    verdicts = {c.id: verifier.verify(c) for c in claims}
    claims_by_id = {c.id: c for c in claims}
    payloads = {}
    for lang in languages:
        lines = [RenderLine(id=f"L{k + 1}", text=c.template_for(lang), claims=[c.id])
                 for k, c in enumerate(claims)]  # fmt: skip
        built = build_payload(f"{ctx.card.id}?{look.id}", persona, lang, lines, claims_by_id,
                              verdicts, ctx.names)  # fmt: skip
        payloads[lang] = built.payload
    return LookAnswer(look=look.id, claims=claims, payloads=payloads)


async def _main_async(args: argparse.Namespace) -> None:
    from sim.counterfactual import look_counterfactual

    ctx = MomentContext.load(args.scenario, args.seed)
    look = look_counterfactual(args.scenario, args.seed, args.frame, args.offset)
    none = look_counterfactual(args.scenario, args.seed, None, None)
    answer = answer_look(ctx, look, none, (args.language,))
    print(f"{look.id}: {look.factual_action} -> {look.counterfactual_action} "
          f"(no look: {none.counterfactual_action})")  # fmt: skip
    for line in answer.payloads[args.language].lines:
        print(f"  {line.text}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Take his eyes: re-simulate one look.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--frame", type=int, required=True)
    parser.add_argument("--offset", type=int, required=True, help="degrees from the ball, + left")
    parser.add_argument("--language", "-l", default="en", choices=["en", "zh"])
    asyncio.run(_main_async(parser.parse_args()))


if __name__ == "__main__":
    main()


__all__ = ["LookAnswer", "answer_look", "look_claims", "look_id"]
