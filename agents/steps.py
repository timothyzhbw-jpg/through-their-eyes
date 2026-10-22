"""Scan step-through (SPEC 7): every look the hero takes before the ball reaches him, as a freeze
frame, then his decision, in verified lines.

    uv run python -m agents.steps --seed 3
    uv run python -m agents.steps --scenario press_escape --seed 0 -l zh

One step per `scan` event of the hero that starts before his reception, in each run of the hero
moment. In the run without the key scan (`drop_scan`) that look is a missing step at the same
time. A step freezes at the middle of the scan's dwell: the frames its head is within the sim's
`scan_out_tolerance` of where the scan turned to. The last step is his decision.

Every line is a template whose numbers and names are slots, checked by the Verifier on the run it
describes (`cf` for the counterfactual run). No model is called. Lines, in order:
- how many times he looks away from the ball before it reaches him;
- per step: where and when he looks (as Take his eyes places a look: the side from the ball, over
  his shoulder from 120 deg), and who comes into his sight on it: out of it as the look began, in
  it on some frame of the look; or, for a missing step, that he takes no look then;
- at the decision: the look that brought the player who mattered into his sight; how far off his
  picture of that player was; what he did; and who the decision turns on (the two players the
  final freeze leaves lit, the rest dimmed): a pass's receiver and the opponent nearest him, a
  carrier and the opponent nearest him, a shooter and the keeper.

The decision model runs only at the decision (SPEC 3.5), so the options a step can show are the
decision record's: there is no record of options at the time of a look.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field

import numpy as np

from agents.context import MomentContext
from agents.look import ACTION_WORDS, OVER_THE_SHOULDER, SEEN
from agents.schemas import Language, Persona
from analytics.stats import display
from analytics.vision import wrap_angle
from explain.claims import Claim, Predicate, Slot, fn, slot
from explain.render import RenderPayload, build_payload
from explain.render import ScriptLine as RenderLine
from explain.verifier import Verifier
from sim.config import SimParams
from sim.counterfactual import CounterfactualResult
from sim.model import Decision, Event
from sim.run import MatchRun

STEPS_VERSION = 1
DWELL_TOLERANCE = SimParams().scan_out_tolerance  # rad: the sim's own "reached" test


@dataclass(frozen=True)
class Step:
    scan: Event  # the scan; for a missing step, the factual run's
    frame: int  # the freeze frame: the middle of the dwell
    side: str  # "left" or "right" of the ball
    over: bool  # over his shoulder: at least OVER_THE_SHOULDER from the ball
    missing: bool  # dropped in this run
    sight: list[str]  # players out of his sight as the look began and in it during the look


@dataclass
class RunSteps:
    name: str  # "factual" or "counterfactual"
    run: MatchRun
    cf: str | None  # the evaluator's counterfactual id, None for the factual run
    forced: bool  # the decision in this run was forced (a what-if), not his
    reception: Event
    decision: Decision
    steps: list[Step]
    focus: tuple[str, str]  # the two players the final freeze leaves lit
    claims: list[Claim] = field(default_factory=list)
    lines: dict[str, list[str]] = field(default_factory=dict)  # "intro", scan id, "final"


@dataclass(frozen=True)
class StepsAnswer:
    runs: dict[str, RunSteps]
    payloads: dict[str, dict[str, RenderPayload]]  # run -> language -> verified lines


def dwell_frame(run: MatchRun, scan: Event) -> int:
    """The middle frame of a scan's dwell: its head within the sim's tolerance of the direction it
    turned to. A turn that never got there (its out deadline) freezes where it came closest."""
    i = run.index(scan.player)
    lo, hi = scan.frame, int(scan.attrs["end"])
    off = np.abs(wrap_angle(run.head_yaw[lo : hi + 1, i] - float(scan.attrs["direction"])))
    near = np.flatnonzero(off <= DWELL_TOLERANCE + 1e-9)
    return lo + int(near[len(near) // 2] if len(near) else np.argmin(off))


def _side(run: MatchRun, scan: Event) -> str:
    """As `explain.functions.scan_side(..., against="ball")`."""
    i = run.index(scan.player)
    to_ball = run.ball_pos[scan.frame, :2] - run.pos[scan.frame, i]
    turn = float(wrap_angle(float(scan.attrs["direction"]) - np.arctan2(to_ball[1], to_ball[0])))
    return "left" if turn > 0 else "right"


def _reception(run: MatchRun, player: str, before: int) -> Event:
    return max(
        (e for e in run.events
         if e.type == "reception" and e.player == player and e.frame <= before),
        key=lambda e: e.frame,
    )  # fmt: skip


def _action_event(run: MatchRun, player: str, frame: int) -> Event | None:
    return next(
        (e for e in run.events
         if e.player == player and e.frame == frame and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip


def _keeper(run: MatchRun, player: str) -> str | None:
    team = run.players[run.index(player)].team
    return next((p.id for p in run.players if p.team != team and p.role == "GK"), None)


def _nearest_opponent(run: MatchRun, player: str, f: int) -> str:
    i = run.index(player)
    team = np.array([p.team for p in run.players])
    opp = np.flatnonzero(team != team[i])
    return run.ids[opp[int(np.argmin(np.linalg.norm(run.pos[f, opp] - run.pos[f, i], axis=1)))]]


def focus_pair(run: MatchRun, decision: Decision) -> tuple[str, str]:
    """Who a decision turns on: a pass's receiver and the opponent nearest him, a shooter and the
    keeper, a carrier and the opponent nearest him. True positions at the decision."""
    f, hero, chosen = decision.frame, decision.player, decision.chosen
    if chosen.startswith("pass:"):
        receiver = chosen.removeprefix("pass:")
        return receiver, _nearest_opponent(run, receiver, f)
    keeper = _keeper(run, hero)
    if chosen.startswith("shot") and keeper:
        return hero, keeper
    return hero, _nearest_opponent(run, hero, f)


class _Builder:
    """Claims of one run, checked on that run (`cf` set for the counterfactual)."""

    def __init__(self, ctx: MomentContext, rs: RunSteps) -> None:
        self.ctx, self.rs = ctx, rs
        self.hero = rs.decision.player

    def fn(self, name: str, **args):
        return fn(name, **args, **({"cf": self.rs.cf} if self.rs.cf else {}))

    def value(self, operand) -> float:
        return float(self.ctx.evaluator.value(operand))

    def first(self, scan: Event, target: str):
        """His sight of the target as the look began."""
        return self.fn("metric_at", metric="visibility", anchor=scan.id, at=0.0,
                       observer=self.hero, target=target)  # fmt: skip

    def peak(self, scan: Event, target: str):
        """The most he saw of the target on any frame of the look up to his decision: what came
        later did not count for it (and after it the two runs may part)."""
        rs = self.rs
        at = round((rs.decision.frame - rs.reception.frame) * rs.run.dt, 4)
        return self.fn("max_visibility", observer=self.hero, target=target, event=scan.id,
                       until=rs.reception.id, until_s=at)  # fmt: skip

    def at_decision(self, metric: str, **args):
        rs = self.rs
        at = round((rs.decision.frame - rs.reception.frame) * rs.run.dt, 4)
        return self.fn("metric_at", metric=metric, anchor=rs.reception.id, at=at, **args)

    def sight(self, scan: Event) -> list[str]:
        """Who came into his sight on the look, teammates first, each side in shirt order."""
        team = self.rs.run.players[self.rs.run.index(self.hero)].team
        others = [p for p in self.rs.run.players if p.id != self.hero]
        others.sort(key=lambda p: (p.team != team, p.number))
        return [
            p.id
            for p in others
            if self.value(self.first(scan, p.id)) < SEEN <= self.value(self.peak(scan, p.id))
        ]

    # --- lines ---------------------------------------------------------------------------------

    def intro(self) -> Claim:
        rs = self.rs
        n = sum(not s.missing for s in rs.steps)
        before = round(rs.reception.frame * rs.run.dt, 4)
        count = self.fn("count_events", type="scan", anchor=rs.reception.id, from_=-before,
                        to=-rs.run.dt, player=slot("player"))  # fmt: skip
        slots = {"player": Slot(ref=self.hero)}
        if n == 0:
            rhs: object = 0
            template = "{player} does not look away from the ball before it reaches him."
            zh = "球到达之前，{player}没有把视线从球上移开。"
        else:
            slots["n"] = Slot(value=n)
            rhs = slot("n")
            template = "Before the ball reaches {player}, he takes {n|look|looks} away from it."
            zh = "球到达之前，{player}把视线从球上移开了{n:times}。"
        return Claim(id="steps_count", template=template, templates={"zh": zh}, slots=slots,
                     predicate=Predicate(op="eq", lhs=count, rhs=rhs),
                     evidence=[rs.reception.id])  # fmt: skip

    def when(self, k: int, step: Step) -> Claim:
        rs, e = self.rs, step.scan
        where_en = f"over his {step.side} shoulder" if step.over else f"to his {step.side}"
        where_zh = {
            ("left", True): "扭头看向左后方", ("right", True): "扭头看向右后方",
            ("left", False): "向左看", ("right", False): "向右看",
        }[(step.side, step.over)]  # fmt: skip
        seconds = display((rs.reception.frame - e.frame) * rs.run.dt, 1)
        checks = [
            Predicate(op="eq", lhs=self.fn("scan_side", scan=e.id, against="ball"), rhs=step.side),
            Predicate(op="ge" if step.over else "lt",
                      lhs=self.fn("event_attr", event=e.id, attr="amplitude"),
                      rhs=OVER_THE_SHOULDER),
            Predicate(op="eq", lhs=self.fn("event_attr", event=e.id, attr="player"),
                      rhs=slot("player")),
            Predicate(op="approx", lhs=self.fn("seconds_between", a=e.id, b=rs.reception.id),
                      rhs=slot("s"), abs_tol=0.05),
        ]  # fmt: skip
        return Claim(
            id=f"step{k}_when",
            template=f"{{player}} looks {where_en} {{s}} s before the ball reaches him.",
            templates={"zh": f"{{player}}在球到达前{{s}}秒{where_zh}。"},
            slots={"player": Slot(ref=self.hero), "s": Slot(value=seconds, decimals=1)},
            predicate=Predicate(op="all", args=checks),
            evidence=[e.id],
        )

    def sight_line(self, k: int, step: Step) -> Claim:
        e = step.scan
        if not step.sight:  # everyone: in sight as it began, or never in it during the look
            others = [p.id for p in self.rs.run.players if p.id != self.hero]
            return Claim(
                id=f"step{k}_sight",
                template="That look brings no one new into his sight.",
                templates={"zh": "这一眼没有让他看到任何原本看不到的球员。"},
                predicate=Predicate(op="all", args=[
                    Predicate(op="ge", lhs=self.first(e, m), rhs=SEEN)
                    if self.value(self.first(e, m)) >= SEEN
                    else Predicate(op="lt", lhs=self.peak(e, m), rhs=SEEN)
                    for m in others
                ]),
                evidence=[e.id],
            )  # fmt: skip
        slots = {f"p{j + 1}": Slot(ref=m) for j, m in enumerate(step.sight)}
        checks = []
        for name in slots:
            checks += [Predicate(op="lt", lhs=self.first(e, slot(name)), rhs=SEEN),
                       Predicate(op="ge", lhs=self.peak(e, slot(name)), rhs=SEEN)]  # fmt: skip
        names = [f"{{{name}}}" for name in slots]
        en = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
        zh = names[0] if len(names) == 1 else "、".join(names[:-1]) + "和" + names[-1]
        return Claim(
            id=f"step{k}_sight",
            template=f"That look brings {en} into his sight.",
            templates={"zh": f"这一眼让他看到了原本看不到的{zh}。"},
            slots=slots,
            predicate=Predicate(op="all", args=checks),
            evidence=[e.id],
        )

    def late(self, k: int, step: Step) -> Claim | None:
        """The look lasts past his decision: it is his last scan before it (the one the decision's
        time since the last scan counts from), and it takes longer than that."""
        rs, e = self.rs, step.scan
        last = max((s for s in rs.steps if not s.missing), key=lambda s: s.scan.frame)
        if step is not last or int(e.attrs["end"]) <= rs.decision.frame:
            return None
        return Claim(
            id=f"step{k}_late",
            template="His head is still turning when he has to decide.",
            templates={"zh": "他必须做决定时，头还在转。"},
            predicate=Predicate(op="all", args=[
                Predicate(op="eq", lhs=self.at_decision("chosen", player=self.hero),
                          rhs=rs.decision.chosen),
                Predicate(op="gt", lhs=self.fn("event_attr", event=e.id, attr="duration_s"),
                          rhs=self.at_decision("time_since_last_scan", player=self.hero)),
            ]),
            evidence=[e.id],
        )  # fmt: skip

    def missing(self, k: int, step: Step) -> Claim:
        rs = self.rs
        since = round((rs.reception.frame - step.scan.frame) * rs.run.dt, 4)
        count = self.fn("count_events", type="scan", anchor=rs.reception.id, from_=-since,
                        to=-rs.run.dt, player=slot("player"))  # fmt: skip
        return Claim(
            id=f"step{k}_missing",
            template="Without that look, {player} takes no look from then until the ball "
                     "reaches him.",
            templates={"zh": "没有这一眼，{player}从那时到球到达都没有再观察。"},
            slots={"player": Slot(ref=self.hero)},
            predicate=Predicate(op="eq", lhs=count, rhs=0),
            evidence=[step.scan.id],
        )  # fmt: skip

    def saw(self, mate: str) -> Claim | None:
        """The look that brought `mate` into his sight, if one did."""
        own = [(k, s) for k, s in enumerate(self.rs.steps, 1) if not s.missing]
        hit = next(((k, s) for k, s in own if mate in s.sight), None)
        if hit is None:
            return None
        k, step = hit
        where_en = f"over his {step.side} shoulder" if step.over else f"to his {step.side}"
        where_zh = {
            ("left", True): "扭头看向左后方", ("right", True): "扭头看向右后方",
            ("left", False): "向左看", ("right", False): "向右看",
        }[(step.side, step.over)]  # fmt: skip
        e = step.scan
        return Claim(
            id="final_saw",
            template=f"It is his look {where_en} that brings {{mate}} into his sight.",
            templates={"zh": f"是{where_zh}的那一眼让他看到了{{mate}}。"},
            slots={"mate": Slot(ref=mate)},
            predicate=Predicate(op="all", args=[
                Predicate(op="eq", lhs=self.fn("scan_side", scan=e.id, against="ball"),
                          rhs=step.side),
                Predicate(op="ge" if step.over else "lt",
                          lhs=self.fn("event_attr", event=e.id, attr="amplitude"),
                          rhs=OVER_THE_SHOULDER),
                Predicate(op="lt", lhs=self.first(e, slot("mate")), rhs=SEEN),
                Predicate(op="ge", lhs=self.peak(e, slot("mate")), rhs=SEEN),
            ]),
            evidence=[e.id],
        )  # fmt: skip

    def belief(self, mate: str) -> Claim:
        rs = self.rs
        err = rs.decision.belief_error[mate]
        age = rs.decision.belief_age[mate]
        error = self.at_decision("belief_error", observer=self.hero, target=slot("mate"))
        aged = self.at_decision("belief_age", observer=self.hero, target=slot("mate"))
        checks = [Predicate(op="approx", lhs=error, rhs=slot("err"), abs_tol=0.05)]
        slots = {"mate": Slot(ref=mate), "err": Slot(value=display(err, 1), decimals=1)}
        if display(age, 1) >= 0.1:
            slots["age"] = Slot(value=display(age, 1), decimals=1)
            checks.append(Predicate(op="approx", lhs=aged, rhs=slot("age"), abs_tol=0.05))
            template = (
                "When he decides, he pictures {mate} {err} m from where he really is: "
                "he last saw him {age} s earlier."
            )
            zh = "做决定时，他脑海中{mate}的位置与实际相差{err}米：他上一次看到对方是在{age}秒前。"
        else:
            checks.append(Predicate(op="lt", lhs=aged, rhs=0.05))
            template = "When he decides, he has {mate} in sight, and pictures him {err} m off."
            zh = "做决定时，{mate}就在他的视野里，他脑海中的位置与实际相差{err}米。"
        evidence = self._decision_evidence()
        return Claim(id="final_belief", template=template, templates={"zh": zh}, slots=slots,
                     predicate=Predicate(op="all", args=checks), evidence=evidence)  # fmt: skip

    def _decision_evidence(self) -> list[str]:
        rs = self.rs
        action = _action_event(rs.run, self.hero, rs.decision.frame)
        return [action.id if action is not None else rs.reception.id]

    def choice(self) -> Claim | None:
        rs = self.rs
        chosen = rs.decision.chosen
        checks = [Predicate(op="eq", lhs=self.at_decision("chosen", player=self.hero),
                            rhs=chosen)]  # fmt: skip
        slots: dict[str, Slot] = {}
        if chosen.startswith("pass:"):
            action = _action_event(rs.run, self.hero, rs.decision.frame)
            if action is None:
                return None
            slots["receiver"] = Slot(ref=chosen.removeprefix("pass:"))
            checks.append(Predicate(op="eq", lhs=self.fn("event_attr", event=action.id, attr="to"),
                                    rhs=slot("receiver")))  # fmt: skip
            en, zh = "passes to {receiver}", "传给{receiver}"
        elif chosen in ACTION_WORDS:
            en, _, zh = ACTION_WORDS[chosen]
        else:
            return None
        if rs.forced:
            template, zh_text = f"In this what-if he {en} instead.", f"在这个假设里，他改为{zh}。"
        else:
            template, zh_text = f"So he {en}.", f"于是他{zh}。"
        return Claim(id="final_choice", template=template, templates={"zh": zh_text}, slots=slots,
                     predicate=Predicate(op="all", args=checks),
                     evidence=self._decision_evidence())  # fmt: skip

    def pair(self) -> Claim | None:
        """The two players the final freeze leaves lit, in a line."""
        rs = self.rs
        a, b = rs.focus
        if rs.decision.chosen.startswith("shot"):
            shot = _action_event(rs.run, self.hero, rs.decision.frame)
            if shot is None or shot.attrs.get("keeper") != b:
                return None
            return Claim(
                id="final_pair",
                template="{keeper} is the keeper he has to beat.",
                templates={"zh": "他要面对的门将是{keeper}。"},
                slots={"keeper": Slot(ref=b)},
                predicate=Predicate(op="eq", lhs=self.fn("event_attr", event=shot.id,
                                                         attr="keeper"), rhs=slot("keeper")),
                evidence=[shot.id],
            )  # fmt: skip
        f = rs.decision.frame
        d = float(np.linalg.norm(rs.run.pos[f, rs.run.index(a)] - rs.run.pos[f, rs.run.index(b)]))
        slots = {"opponent": Slot(ref=b), "d": Slot(value=display(d, 1), decimals=1)}
        if a == self.hero:
            who: object = self.hero
            template = "{opponent} is the opponent nearest to him, {d} m away."
            zh = "离他最近的对手是{opponent}，相距{d}米。"
        else:
            slots["player"] = Slot(ref=a)
            who = slot("player")
            template = "{opponent} is the opponent nearest to {player}, {d} m from him."
            zh = "离{player}最近的对手是{opponent}，相距{d}米。"
        checks = [
            Predicate(op="eq", lhs=self.at_decision("nearest_opponent", player=who),
                      rhs=slot("opponent")),
            Predicate(op="approx", lhs=self.at_decision("nearest_opponent_distance", player=who),
                      rhs=slot("d"), abs_tol=0.05),
        ]  # fmt: skip
        return Claim(id="final_pair", template=template, templates={"zh": zh}, slots=slots,
                     predicate=Predicate(op="all", args=checks),
                     evidence=self._decision_evidence())  # fmt: skip


def _mate(ctx: MomentContext) -> str | None:
    runner = getattr(ctx.run, "runner", None) or _scenario_runner(ctx)
    if runner:
        return runner
    chosen = ctx.run.hero_decision().chosen
    return chosen.removeprefix("pass:") if chosen.startswith("pass:") else None


def _scenario_runner(ctx: MomentContext) -> str | None:
    from sim.scenarios import SCENARIOS

    return getattr(SCENARIOS[ctx.scenario], "runner", None)


def _steps(run: MatchRun, factual: MatchRun, hero: str, reception: Event, decided: int,
           dropped: str | None) -> list[Step]:  # fmt: skip
    """His scans that start before the ball reaches him, and the dropped one (missing). A look
    still under way when he decides freezes at his decision: what came later did not count."""
    own = [e for e in run.events
           if e.type == "scan" and e.player == hero and e.frame < reception.frame]  # fmt: skip
    gone = [
        e for e in factual.events
        if e.id == dropped and e.frame < reception.frame and not any(o.id == e.id for o in own)
    ]  # fmt: skip
    out = [(e, run, False) for e in own] + [(e, factual, True) for e in gone]
    out.sort(key=lambda x: x[0].frame)
    return [
        Step(scan=e, frame=min(dwell_frame(src, e), decided), side=_side(src, e),
             over=float(e.attrs["amplitude"]) >= OVER_THE_SHOULDER, missing=missing, sight=[])
        for e, src, missing in out
    ]  # fmt: skip


def build_steps(ctx: MomentContext) -> dict[str, RunSteps]:
    """The steps of both runs of the hero moment, with their claims, in line order."""
    factual = ctx.run
    decision = factual.hero_decision()
    if decision is None:
        raise ValueError(f"{ctx.scenario} seed {ctx.seed}: no decision on the ball")
    hero = decision.player
    cf = ctx.cf
    dropped = cf.scan_id if isinstance(cf, CounterfactualResult) else None
    forced = not isinstance(cf, CounterfactualResult)
    out: dict[str, RunSteps] = {}
    for name, run, cf_id in (("factual", factual, None),
                             ("counterfactual", cf.counterfactual, cf.scan_id)):  # fmt: skip
        d = next(x for x in run.decisions if x.player == hero and x.frame == decision.frame)
        reception = _reception(run, hero, d.frame)
        steps = _steps(run, factual, hero, reception, d.frame,
                       dropped if name != "factual" else None)  # fmt: skip
        rs = RunSteps(name=name, run=run, cf=cf_id, forced=forced and name != "factual",
                      reception=reception, decision=d, steps=steps,
                      focus=focus_pair(run, d))  # fmt: skip
        b = _Builder(ctx, rs)
        rs.steps = [s if s.missing else Step(**{**s.__dict__, "sight": b.sight(s.scan)})
                    for s in steps]  # fmt: skip
        claims: list[Claim | None] = [b.intro()]
        rs.lines["intro"] = ["steps_count"]
        for k, s in enumerate(rs.steps, 1):
            if s.missing:
                these = [b.missing(k, s)]
            else:
                these = [c for c in (b.when(k, s), b.sight_line(k, s), b.late(k, s)) if c]
            claims += these
            rs.lines[s.scan.id] = [c.id for c in these]
        mate = _mate(ctx)
        final = [b.saw(mate) if mate else None, b.belief(mate) if mate else None, b.choice(),
                 b.pair()]  # fmt: skip
        claims += final
        rs.lines["final"] = [c.id for c in final if c is not None]
        rs.claims = [c for c in claims if c is not None]
        out[name] = rs
    return out


def answer_steps(
    ctx: MomentContext,
    languages: tuple[Language, ...] = ("en", "zh"),
    persona: Persona = "analyst",
) -> StepsAnswer:
    """Both runs' steps and their verified lines as SPEC 5.3 render payloads, one per run and
    language. A line whose claim is not supported is left out of the payload."""
    runs = build_steps(ctx)
    verifier = Verifier(ctx.evaluator, sink=ctx.audit)
    payloads: dict[str, dict[str, RenderPayload]] = {}
    for name, rs in runs.items():
        verdicts = {c.id: verifier.verify(c) for c in rs.claims}
        by_id = {c.id: c for c in rs.claims}
        payloads[name] = {}
        for lang in languages:
            lines = [RenderLine(id=c.id, text=c.template_for(lang), claims=[c.id])
                     for c in rs.claims]  # fmt: skip
            built = build_payload(f"{ctx.card.id}?steps:{name}", persona, lang, lines, by_id,
                                  verdicts, ctx.names)  # fmt: skip
            payloads[name][lang] = built.payload
    return StepsAnswer(runs=runs, payloads=payloads)


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan step-through: the hero's looks, verified.")
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--language", "-l", default="en", choices=["en", "zh"])
    args = parser.parse_args()
    ctx = MomentContext.load(args.scenario, args.seed)
    answer = answer_steps(ctx, (args.language,))
    for name, rs in answer.runs.items():
        payload = answer.payloads[name][args.language]
        text = {line.id: line.text for line in payload.lines}
        print(f"{name}: {len(rs.steps)} step(s), decision {rs.decision.chosen} at "
              f"{rs.decision.frame}, focus {rs.focus[0]} + {rs.focus[1]}")  # fmt: skip
        for key, ids in rs.lines.items():
            for cid in ids:
                print(f"  [{key}] {text.get(cid, f'<withheld: {cid}>')}")


if __name__ == "__main__":
    main()


__all__ = ["STEPS_VERSION", "Step", "RunSteps", "answer_steps", "build_steps", "dwell_frame",
           "focus_pair"]  # fmt: skip
