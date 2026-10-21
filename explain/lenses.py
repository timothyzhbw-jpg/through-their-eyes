"""Lens selection by counterfactual impact (SPEC 5.2).

For a moment with a decision, three candidate explanations are computed and all of them are
recorded in the MomentCard; the one with the largest |delta_xt| is selected. Every delta is in the
same unit, xT of the acting team (expected threat after the action), and the scan and space lenses
share one value function, so their deltas are directly comparable:

    V(option) = PC * xT(target) - (1 - PC) * xT_opp(target)

on the true positions at the decision, PC being the acting team's pitch control at the option's
target (a shot keeps its xG: pitch control at the goal mouth says nothing). A placed shot
(`shot:near` / `shot:far`, Module A) is worth its chance of a goal on the truth: P(on target) ×
(1 − E[P(save)]) with the keeper where he really is, the decision model's own value re-scored on
the true state (`sim.decision.placed_shot_value`).

- `scan`: drop the most informative scan (the one whose sightings move the decision-time belief
  about the eventual target the most) and re-simulate with
  `sim.counterfactual.drop_scan_counterfactual`.
  delta = V(factual choice) - V(the choice made without the scan). The realised difference in
  possession value (`CounterfactualResult.delta_xt`, where each action actually ended) is recorded
  as `realized_delta_xt`; it is not used for selection because it mixes outcome luck with a
  different value function.
- `space`: delta = V(chosen option) - V(best alternative).
- `pressure`: expected turnover cost = pressing intensity on the ball carrier (P(a defender gets
  there within T), SPEC 4.3) times the stake at the ball, xT_own + xT_opp (what the team keeps
  plus what the opponent gains if the press wins the ball). delta = cost on the actor at the
  decision minus cost after the action (on the receiver at reception; 1 x stake where possession
  was lost; 0 after a shot).

A `marker_scan` (a defender's look at the man he marks, no decision on the ball) has only the scan
lens. Its value is the pressure lens's currency from the defending side: the expected turnover
when the pass to his man resolves, pressing intensity on whoever has the ball then times the stake
at the ball (a ball the defence wins counts 1 x stake). delta = that with the look minus that
without it (the marker's most informative scan before the pass dropped and re-simulated). The
space and pressure lenses need a decision on the ball and are unavailable.

A keeper's step for a sightline (`keeper_step`) has only the `sight` lens: the goals his step
prevents in expectation, P(save) with the step minus P(save) with it dropped and re-simulated
(`sim.counterfactual.drop_step_counterfactual`), both from the save model on the shot's crossing
(Module A). A goal is worth 1 in xT units, so the delta is in the same unit as the others.

Consequence of the shared value function: if dropping the scan makes the player pick one of his
other options, delta_scan >= delta_space up to small belief-driven shifts of the option targets,
so the scan lens wins exactly when the scan was decisive; if the decision does not change,
delta_scan is about 0 and the space (or pressure) story wins. Ties break in `LENS_ORDER`, so
selection is deterministic for a given seed.

    uv run python -m explain.lenses --scenario blind_side_run --seed 3
"""

from __future__ import annotations

import argparse

import numpy as np

from analytics.pitch_control import pitch_control
from analytics.pressing import frame_pressing
from analytics.vision import player_visibility
from analytics.xt import xt_for
from explain.cards import LensName, LensResult, MomentCard
from explain.moments import detect_moments, hero_card
from sim.config import SimParams
from sim.counterfactual import drop_scan_counterfactual, drop_step_counterfactual
from sim.decision import DecisionParams, OptionEval, placed_shot_value
from sim.model import Decision, Event
from sim.run import MatchRun

LENS_ORDER: tuple[LensName, ...] = ("scan", "space", "pressure", "sight")
SCAN_LOOKBACK_S = 10.0  # scans considered before the decision
DIGITS = 6


def _r(x: float, digits: int = DIGITS) -> float:
    return round(float(x), digits)


def _sign(run: MatchRun, player: str) -> int:
    return 1 if run.players[run.index(player)].team == 0 else -1


def _team(run: MatchRun) -> np.ndarray:
    return np.array([p.team for p in run.players])


def _decision_for(run: MatchRun, card: MomentCard) -> Decision | None:
    return next(
        (d for d in run.decisions if d.player == card.actor and d.frame == card.anchor_frame), None
    )


def _action_for(run: MatchRun, player: str, frame: int) -> Event | None:
    return next(
        (e for e in run.events
         if e.player == player and e.frame == frame and e.type in ("pass", "shot")),
        None,
    )  # fmt: skip


def _unavailable(lens: LensName, note: str) -> LensResult:
    return LensResult(lens=lens, available=False, note=note)


def _chosen(decision: Decision) -> OptionEval:
    return next(o for o in decision.options if o.action == decision.chosen)


# --- belief reconstruction (same perception model as the sim, SPEC 3.4) --------------------


def sightings(run: MatchRun, observer: str, params: SimParams = SimParams()) -> np.ndarray:
    """(F, N) whether `observer` saw each player on each frame (visibility >= threshold)."""
    i = run.index(observer)
    speed = np.linalg.norm(run.vel, axis=-1)
    frames = range(len(run.owner))
    vis = np.array([player_visibility(run.pos[f], run.head_yaw[f], speed[f])[i] for f in frames])
    return vis >= params.perception_threshold


def believed_position(
    run: MatchRun,
    observer: str,
    target: str,
    frame: int,
    ignore: tuple[int, int] | None = None,
    seen: np.ndarray | None = None,
    params: SimParams = SimParams(),
) -> np.ndarray:
    """Where `observer` believes `target` is at `frame`: the last sighting at or before it,
    extrapolated at most `belief_horizon_s`. Sightings in the inclusive frame range `ignore` are
    left out (a scan that did not happen). Everyone is known at frame 0, as in the sim."""
    j = run.index(target)
    col = (sightings(run, observer, params) if seen is None else seen)[: frame + 1, j].copy()
    col[0] = True
    if ignore is not None:
        col[max(1, ignore[0]) : ignore[1] + 1] = False
    last = int(np.flatnonzero(col)[-1])
    age = (frame - last) * run.dt
    return run.pos[last, j] + run.vel[last, j] * min(age, params.belief_horizon_s)


def scan_candidates(run: MatchRun, decision: Decision) -> list[dict]:
    """The decision-maker's scans before the decision, with how far each one's sightings move
    the decision-time belief about the eventual target (m). Without a pass target, the largest
    move over all players counts."""
    chosen = _chosen(decision)
    targets = [chosen.target_player] if chosen.target_player else [
        p.id for p in run.players if p.id != decision.player
    ]  # fmt: skip
    lo = decision.frame - round(SCAN_LOOKBACK_S / run.dt)
    scans = sorted(
        (e for e in run.events
         if e.type == "scan" and e.player == decision.player and lo <= e.frame < decision.frame),
        key=lambda e: (e.frame, e.id),
    )  # fmt: skip
    if not scans:
        return []
    seen = sightings(run, decision.player)
    out = []
    for s in scans:
        window = (s.frame, min(int(s.attrs["end"]), decision.frame))
        moves = [
            np.linalg.norm(
                believed_position(run, decision.player, t, decision.frame, seen=seen)
                - believed_position(run, decision.player, t, decision.frame, window, seen)
            )
            for t in targets
        ]
        out.append(
            {"scan_id": s.id, "start_frame": s.frame, "end_frame": int(s.attrs["end"]),
             "belief_update_m": _r(max(moves), 3)}
        )  # fmt: skip
    return out


# --- the three lenses --------------------------------------------------------------------


def option_values(run: MatchRun, frame: int, player: str, options: list[OptionEval]):
    """V(option) on the true positions at `frame`, with the pitch control and xT behind it."""
    me = run.players[run.index(player)]
    team, sign = _team(run), _sign(run, player)
    own, opp = team == me.team, team != me.team
    targets = np.array([o.target for o in options], dtype=float).reshape(-1, 2)
    pc = pitch_control(
        targets, run.pos[frame, own], run.vel[frame, own], run.pos[frame, opp], run.vel[frame, opp]
    )
    xt_own, xt_opp = xt_for(targets, sign), xt_for(targets, -sign)
    value = pc * xt_own - (1.0 - pc) * xt_opp
    for k, o in enumerate(options):
        if o.kind == "shot":
            value[k] = o.value
            if o.action.startswith("shot:"):  # a placed shot: its chance of a goal on the truth
                from explain.functions import true_decision_context

                truth = true_decision_context(run, run.index(player), frame)
                value[k] = placed_shot_value(truth, o.action.removeprefix("shot:"))
    return value, pc, xt_own


def scan_lens(run: MatchRun, decision: Decision | None, scan_id: str | None = None) -> LensResult:
    """`scan_id` overrides the choice of the most informative scan."""
    if decision is None:
        return _unavailable("scan", "no decision in this moment")
    hero = run.hero_decision()
    if hero is None or (hero.player, hero.frame) != (decision.player, decision.frame):
        return _unavailable("scan", "drop_scan re-simulation compares the scenario hero's decision")
    candidates = scan_candidates(run, decision)
    if not candidates:
        return _unavailable("scan", f"no scan by {decision.player} before the decision")
    # Most informative first; ties go to the latest scan.
    best = max(candidates, key=lambda c: (c["belief_update_m"], c["start_frame"]))
    if scan_id is not None:
        best = next((c for c in candidates if c["scan_id"] == scan_id), None)
        if best is None:
            raise ValueError(f"{scan_id} is not a scan of {decision.player} before the decision")
    cf = drop_scan_counterfactual(run.scenario, run.seed, best["scan_id"])
    f, c = cf.factual_decision, cf.counterfactual_decision
    fo, co = _chosen(f), _chosen(c)
    v_f = option_values(cf.factual, f.frame, f.player, [fo])[0][0]
    v_c = option_values(cf.counterfactual, c.frame, c.player, [co])[0][0]
    target = fo.target_player
    metrics = {
        "scan_id": best["scan_id"],
        "belief_update_m": best["belief_update_m"],
        "factual_action": cf.factual_action,
        "counterfactual_action": cf.counterfactual_action,
        "decision_changed": cf.factual_action != cf.counterfactual_action,
        "factual_value_xt": _r(v_f),
        "counterfactual_value_xt": _r(v_c),
        "realized_delta_xt": _r(cf.delta_xt),
        "p_factual_action_with_scan": _r(fo.prob),
        "p_factual_action_without_scan": _r(
            next((o.prob for o in c.options if o.action == f.chosen), 0.0)
        ),
    }
    if target is not None:
        metrics["target"] = target
        metrics["belief_error_target_with_scan_m"] = _r(f.belief_error[target], 3)
        metrics["belief_error_target_without_scan_m"] = _r(c.belief_error[target], 3)
    return LensResult(
        lens="scan",
        available=True,
        delta_xt=_r(round(v_f, DIGITS) - round(v_c, DIGITS)),
        metrics=metrics,
        rows=candidates,
        evidence=[best["scan_id"]],
        note="V(factual choice) - V(choice re-simulated without this scan), "
        "V = PC*xT - (1-PC)*xT_opp at the option's target on true positions",
    )


def space_lens(run: MatchRun, decision: Decision | None) -> LensResult:
    if decision is None:
        return _unavailable("space", "no decision in this moment")
    if len(decision.options) < 2:
        return _unavailable("space", "no alternative option")
    value, pc, xt_own = option_values(run, decision.frame, decision.player, decision.options)
    rows = [
        {"action": o.action, "target_x": _r(o.target[0], 2), "target_y": _r(o.target[1], 2),
         "pitch_control": _r(pc[k], 4), "xt": _r(xt_own[k], 4), "value_xt": _r(value[k])}
        for k, o in enumerate(decision.options)
    ]  # fmt: skip
    chosen = next(k for k, o in enumerate(decision.options) if o.action == decision.chosen)
    alt = max((k for k in range(len(value)) if k != chosen), key=lambda k: (value[k], -k))
    return LensResult(
        lens="space",
        available=True,
        delta_xt=_r(round(value[chosen], DIGITS) - round(value[alt], DIGITS)),
        metrics={
            "chosen": decision.chosen,
            "chosen_value_xt": _r(value[chosen]),
            "chosen_pitch_control": _r(pc[chosen], 4),
            "best_alternative": decision.options[alt].action,
            "best_alternative_value_xt": _r(value[alt]),
        },
        rows=rows,
        note="V(chosen option) - V(best alternative), "
        "V = PC*xT - (1-PC)*xT_opp at the option's target on true positions",
    )


NO_BALL_DECISION = "no decision on the ball in this moment (a marker's look)"


def marker_candidates(run: MatchRun, card: MomentCard) -> list[dict]:
    """The marker's scans before the pass to his man, with how far each one's sightings move his
    belief about the man at the moment the ball is played (m)."""
    played = run.event(card.anchors["pass"])
    f = played.frame
    lo = f - round(SCAN_LOOKBACK_S / run.dt)
    scans = sorted(
        (e for e in run.events
         if e.type == "scan" and e.player == card.actor and lo <= e.frame <= f),
        key=lambda e: (e.frame, e.id),
    )  # fmt: skip
    seen = sightings(run, card.actor)
    out = []
    for s in scans:
        window = (s.frame, min(int(s.attrs["end"]), f))
        move = np.linalg.norm(
            believed_position(run, card.actor, card.receiver, f, seen=seen)
            - believed_position(run, card.actor, card.receiver, f, window, seen)
        )
        out.append(
            {"scan_id": s.id, "start_frame": s.frame, "end_frame": int(s.attrs["end"]),
             "belief_update_m": _r(move, 3)}
        )  # fmt: skip
    return out


def turnover_at_resolution(run: MatchRun, pass_id: str) -> dict | None:
    """Expected turnover where a pass resolved, from the passing team's side (the pressure lens's
    cost): pressing intensity on the receiver times the stake at the ball, or 1 x stake when the
    pass was lost. None when this run has no such pass or it was still rolling at the end."""
    played = next((e for e in run.events if e.id == pass_id), None)
    if played is None or played.attrs.get("outcome") is None:
        return None
    sign = _sign(run, played.player)
    after = min(int(played.attrs["end"]), len(run.owner) - 1)
    if played.attrs["outcome"] == "complete":
        receiver = run.index(played.attrs["receiver"])
        pressure, stake, presser = _pressure_cost(run, after, receiver, sign)
    else:
        end_at = np.array(played.attrs["end_at"])
        pressure, stake = 1.0, float(xt_for(end_at, sign) + xt_for(end_at, -sign))
        presser = played.attrs.get("receiver")
    return {"frame": after, "outcome": played.attrs["outcome"],
            "receiver": played.attrs.get("receiver"), "pressure": pressure, "stake": stake,
            "cost": pressure * stake, "presser": presser}  # fmt: skip


def marker_scan_lens(run: MatchRun, card: MomentCard, scan_id: str | None = None) -> LensResult:
    """The scan lens for a `marker_scan`; `scan_id` overrides the most informative scan."""
    candidates = marker_candidates(run, card)
    if not candidates:
        return _unavailable("scan", f"no scan by {card.actor} before the pass")
    best = max(candidates, key=lambda c: (c["belief_update_m"], c["start_frame"]))
    if scan_id is not None:
        best = next((c for c in candidates if c["scan_id"] == scan_id), None)
        if best is None:
            raise ValueError(f"{scan_id} is not a scan of {card.actor} before the pass")
    cf = drop_scan_counterfactual(run.scenario, run.seed, best["scan_id"])
    pass_id = card.anchors["pass"]
    f, c = (
        turnover_at_resolution(cf.factual, pass_id),
        turnover_at_resolution(cf.counterfactual, pass_id),
    )
    if f is None or c is None:
        return _unavailable("scan", f"{pass_id} is not resolved in both runs")
    played = run.event(pass_id).frame
    marker, man = card.actor, card.receiver

    def separation(r: MatchRun, frame: int) -> float:
        return float(np.linalg.norm(r.pos[frame, r.index(marker)] - r.pos[frame, r.index(man)]))

    def belief_error(r: MatchRun) -> float:
        believed = believed_position(r, marker, man, played)
        return float(np.linalg.norm(believed - r.pos[played, r.index(man)]))

    return LensResult(
        lens="scan",
        available=True,
        delta_xt=_r(round(f["cost"], DIGITS) - round(c["cost"], DIGITS)),
        metrics={
            "scan_id": best["scan_id"],
            "key_scan": bool(run.event(best["scan_id"]).attrs.get("key")),
            "belief_update_m": best["belief_update_m"],
            "pass": pass_id,
            "outcome_with_scan": f["outcome"],
            "outcome_without_scan": c["outcome"],
            "separation_with_scan_m": _r(separation(cf.factual, f["frame"]), 3),
            "separation_without_scan_m": _r(separation(cf.counterfactual, c["frame"]), 3),
            "pressure_with_scan": _r(f["pressure"]),
            "pressure_without_scan": _r(c["pressure"]),
            "stake_with_scan_xt": _r(f["stake"]),
            "stake_without_scan_xt": _r(c["stake"]),
            "belief_error_with_scan_m": _r(belief_error(cf.factual), 3),
            "belief_error_without_scan_m": _r(belief_error(cf.counterfactual), 3),
        },
        rows=candidates,
        evidence=[best["scan_id"], pass_id],
        note="expected turnover where the pass to his man resolved (pressing intensity x stake, "
        "the pressure lens's cost) with this scan minus without it",
    )


def sight_lens(run: MatchRun, card: MomentCard) -> LensResult:
    """The `sight` lens of a keeper's step: P(save) with the step minus without it."""
    step_id, shot_id = card.anchors["step"], card.anchors["shot"]
    cf = drop_step_counterfactual(run.scenario, run.seed, step_id)
    shots = [next((e for e in r.events if e.id == shot_id), None)
             for r in (cf.factual, cf.counterfactual)]  # fmt: skip
    if any(e is None or e.attrs.get("p_save") is None for e in shots):
        return _unavailable("sight", f"{shot_id} did not reach the save model in both runs")
    with_step, without = shots

    def delay(e: Event) -> float | None:
        seen = e.attrs.get("seen")
        return None if seen is None else _r((int(seen) - e.frame) * run.dt, 3)

    p1, p0 = float(with_step.attrs["p_save"]), float(without.attrs["p_save"])
    return LensResult(
        lens="sight",
        available=True,
        delta_xt=_r(round(p1, DIGITS) - round(p0, DIGITS)),
        metrics={
            "step_id": step_id,
            "step_m": _r(run.event(step_id).attrs["lateral_m"], 3),
            "shot": shot_id,
            "p_save_with_step": _r(p1),
            "p_save_without_step": _r(p0),
            "first_sight_with_step_s": delay(with_step),
            "first_sight_without_step_s": delay(without),
            "reach_with_step_m": _r(with_step.attrs.get("reach", 0.0), 3),
            "reach_without_step_m": _r(without.attrs.get("reach", 0.0), 3),
            "outcome_with_step": with_step.attrs.get("outcome"),
            "outcome_without_step": without.attrs.get("outcome"),
        },
        evidence=[step_id, shot_id],
        note="P(save) of the shot with the keeper's step minus without it (the save model on "
        "the shot's crossing, Module A): the goals the step prevents in expectation",
    )


def _pressure_cost(run: MatchRun, frame: int, carrier: int, sign: int) -> tuple[float, float, str]:
    """(pressure on the carrier, stake at the ball, main presser) at one frame."""
    ball = run.ball_pos[frame, :2]
    pf = frame_pressing(run.pos[frame], run.vel[frame], _team(run), ball, carrier)
    column = pf.column(carrier)
    presser = run.ids[int(pf.defenders[int(np.argmax(column))])]
    stake = float(xt_for(ball, sign) + xt_for(ball, -sign))
    return pf.on_carrier, stake, presser


def pressure_lens(run: MatchRun, card: MomentCard) -> LensResult:
    frame, actor = card.anchor_frame, card.actor
    i = run.index(actor)
    if run.owner[frame] != i:
        return _unavailable("pressure", f"{actor} does not have the ball at the anchor frame")
    sign = _sign(run, actor)
    p0, stake0, presser = _pressure_cost(run, frame, i, sign)
    action = _action_for(run, actor, frame)
    last = len(run.owner) - 1
    evidence = [action.id] if action else []
    if action is not None and action.type == "shot":
        after, p1, stake1, how = None, 0.0, 0.0, "shot"
    elif action is not None:
        outcome, end = action.attrs.get("outcome"), action.attrs.get("end")
        if outcome == "complete":
            after = min(int(end), last)
            receiver = run.index(action.attrs["receiver"])
            p1, stake1, _ = _pressure_cost(run, after, receiver, sign)
            how = "pass completed"
        elif outcome is None:  # still rolling when the run ended: inconclusive
            return _unavailable("pressure", "the pass was not resolved before the run ended")
        else:
            after = min(int(end), last)
            end_at = np.array(action.attrs["end_at"])
            p1, stake1, how = 1.0, float(xt_for(end_at, sign) + xt_for(end_at, -sign)), outcome
    else:  # carry (or no action recorded): the actor at the end of the carry
        steps = round(DecisionParams().carry_time / run.dt)
        after = min(frame + steps, last)
        owner = int(run.owner[after])
        if owner == i:
            p1, stake1, _ = _pressure_cost(run, after, i, sign)
            how = "carry kept"
        else:
            ball = run.ball_pos[after, :2]
            stake1 = float(xt_for(ball, sign) + xt_for(ball, -sign))
            if owner >= 0 and run.players[owner].team != run.players[i].team:
                p1, how = 1.0, "carry lost"
            else:  # free ball or a teammate: pressure on the ball
                team = _team(run)
                pf = frame_pressing(run.pos[after], run.vel[after], team, ball, -1, int(team[i]))
                p1, how = pf.on_ball, "carry released"
    cost0, cost1 = p0 * stake0, p1 * stake1
    return LensResult(
        lens="pressure",
        available=True,
        delta_xt=_r(round(cost0, DIGITS) - round(cost1, DIGITS)),
        metrics={
            "pressure_before": _r(p0),
            "stake_before_xt": _r(stake0),
            "cost_before_xt": _r(cost0),
            "main_presser": presser,
            "pressure_after": _r(p1),
            "stake_after_xt": _r(stake1),
            "cost_after_xt": _r(cost1),
            "after_frame": after,
            "escaped": bool(p1 < p0),
            "how": how,
        },
        evidence=evidence,
        note="expected turnover cost (pressing intensity x stake) on the actor at the anchor "
        "minus after the action",
    )


# --- selection ---------------------------------------------------------------------------


def pick_lens(lenses: list[LensResult]) -> LensName | None:
    """Largest |delta_xt| among available lenses; ties break in LENS_ORDER."""
    usable = [lens for lens in lenses if lens.available and lens.delta_xt is not None]
    if not usable:
        return None
    best = max(usable, key=lambda lens: (abs(lens.delta_xt), -LENS_ORDER.index(lens.lens)))
    return best.lens


def explain_moment(card: MomentCard, run: MatchRun) -> MomentCard:
    """A copy of the card with all candidate lenses computed and the strongest one selected.
    `run` must be the factual run of (card.scenario, card.seed)."""
    out = card.model_copy(deep=True)
    if card.live_only or not card.candidate_lenses:
        return out
    decision = _decision_for(run, card)
    compute = {
        "scan": lambda: scan_lens(run, decision),
        "space": lambda: space_lens(run, decision),
        "pressure": lambda: pressure_lens(run, card),
    }
    if card.kind == "keeper_step":
        compute = {"sight": lambda: sight_lens(run, card)}
    if card.kind == "marker_scan":
        compute = {
            "scan": lambda: marker_scan_lens(run, card),
            "space": lambda: _unavailable("space", NO_BALL_DECISION),
            "pressure": lambda: _unavailable("pressure", NO_BALL_DECISION),
        }
    out.lenses = [compute[name]() for name in LENS_ORDER if name in card.candidate_lenses]
    out.selected_lens = pick_lens(out.lenses)
    return out


def explain_moments(run: MatchRun) -> list[MomentCard]:
    return [explain_moment(card, run) for card in detect_moments(run)]


def main() -> None:
    from sim.engine import Simulation
    from sim.scenarios import SCENARIOS

    parser = argparse.ArgumentParser(description="Print the hero MomentCard with all lenses.")
    parser.add_argument("--scenario", default="blind_side_run", choices=sorted(SCENARIOS))
    parser.add_argument("--seed", type=int, default=3)
    args = parser.parse_args()
    run = Simulation.from_scenario(args.scenario, args.seed).run()
    card = hero_card(run, detect_moments(run))
    if card is not None:
        print(explain_moment(card, run).model_dump_json(indent=2))


if __name__ == "__main__":
    main()
