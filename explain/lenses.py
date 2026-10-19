"""Lens selection by counterfactual impact (SPEC 5.2).

Every lens is scored in one currency: the expected possession value of an action that the
decision model assigns (SPEC 3.5), P(success) * xT(target) - (1 - P) * xT_opp(target), evaluated
on the TRUE state at the decision frame (true positions and velocities, belief age zero) rather
than on the player's belief. Truth is the common yardstick: the scan lens changes the belief, so
belief-based values of the factual and counterfactual actions would not be comparable.

Each lens asks how much value hinged on one factor, through one counterfactual:
- scan: drop the most informative scan (the largest belief update about the eventual target) and
  re-simulate (`sim.counterfactual.drop_scan_counterfactual`; keyed randomness and Gumbel-max
  decisions make the two runs share every random draw).
  delta = V(factual action) - V(the action taken without the scan).
- space: delta = V(chosen) - max V(other options): the margin over the best alternative on the
  board. Pitch control and xT at both targets are recorded as supporting metrics.
- pressure: delta = PI * (V(chosen) - V(turnover)), where PI is the pressing intensity on the
  carrier at the decision (SPEC 4.3) and V(turnover) = -xT_opp(ball): the value the action kept
  away from the press, if a press that arrives in time wins the ball.

Selection: the lens with the largest |delta|. Lenses within TIE_TOLERANCE_XT of the largest are
tied, and a tie goes to the lens that comes first in LENS_PRECEDENCE — the causal order of a
decision: perception, then the option it reveals, then executing it under pressure. Ties are
structural, not rare: when the player without the scan would have played the best alternative,
the scan's whole effect is to reveal the option whose margin the space lens measures, and the two
deltas are equal. Everything is deterministic for a given scenario and seed.

    uv run python -m explain.lenses --seed 100          # hero MomentCard JSON
    uv run python -m explain.lenses --seeds 100-139     # lens deltas per seed (markdown)
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from analytics.pitch_control import pitch_control
from analytics.pressing import frame_pressing
from analytics.vision import player_visibility
from analytics.xt import xt_for
from explain.cards import LensName, LensResult, MomentCard, rounded
from explain.moments import (
    SCANS_WINDOW_S,
    action_event,
    attack_sign,
    chosen_option,
    decision_at,
    detect_moments,
)
from sim.config import SimParams
from sim.counterfactual import CounterfactualResult, drop_scan_counterfactual
from sim.decision import DecisionContext, OptionEval, _pass_success, evaluate_options
from sim.engine import Simulation
from sim.model import Decision, Event
from sim.perception import BeliefStore
from sim.run import MatchRun

LENS_PRECEDENCE: tuple[LensName, ...] = ("scan", "space", "pressure")
TIE_TOLERANCE_XT = 0.001  # tunable; above rounding noise, small against hero deltas (~0.04)


# --- belief reconstruction (SPEC 3.4) ------------------------------------------------------


@dataclass(frozen=True)
class BeliefSnapshot:
    """One observer's mental map after a frame's perception update."""

    pos: np.ndarray  # (N, 2) at each player's last sighting
    vel: np.ndarray  # (N, 2)
    seen_frame: np.ndarray  # (N,)
    horizon_s: float

    def estimate(self, frame: int, dt: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Believed positions, velocities and ages (s) at `frame`."""
        age = (frame - self.seen_frame) * dt
        pos = self.pos + self.vel * np.minimum(age, self.horizon_s)[:, None]
        return pos, self.vel.copy(), age


def replay_belief(
    run: MatchRun, observer: int, until: int, params: SimParams = SimParams()
) -> list[BeliefSnapshot]:
    """The observer's belief after each frame 0..until, rebuilt from the tracking output with the
    engine's own visibility model, threshold and belief store."""
    store = BeliefStore(len(run.players), 0, run.pos[0], run.vel[0])
    out = []
    for f in range(until + 1):
        speed = np.linalg.norm(run.vel[f], axis=-1)
        seen = player_visibility(run.pos[f], run.head_yaw[f], speed) >= params.perception_threshold
        store.update(seen, f, run.pos[f], run.vel[f])
        out.append(
            BeliefSnapshot(
                store.pos[observer].copy(),
                store.vel[observer].copy(),
                store.frame[observer].copy(),
                params.belief_horizon_s,
            )
        )
    return out


def most_informative_scan(run: MatchRun, decision: Decision) -> tuple[Event, float] | None:
    """The decision-maker's scan (started in the 10 s before the decision) with the largest
    belief update about the eventual target, and that update in metres.

    Update = how far the scan moved the believed position of the target: the belief at the end of
    the scan minus the belief at its start extrapolated to the same frame. The target is the
    chosen pass's receiver; for a carry or a shot, the mean over all opponents. Ties go to the
    later scan.
    """
    window = round(SCANS_WINDOW_S / run.dt)
    scans = [
        e
        for e in run.events
        if e.type == "scan"
        and e.player == decision.player
        and decision.frame - window <= e.frame < decision.frame
    ]
    if not scans:
        return None
    me = run.index(decision.player)
    target = chosen_option(decision).target_player
    team = run.players[me].team
    targets = (
        [run.index(target)] if target else [k for k, p in enumerate(run.players) if p.team != team]
    )
    beliefs = replay_belief(run, me, decision.frame)

    def update(scan: Event) -> float:
        end = min(int(scan.attrs["end"]), decision.frame)
        prior, _, _ = beliefs[scan.frame].estimate(end, run.dt)
        post, _, _ = beliefs[end].estimate(end, run.dt)
        return float(np.mean(np.linalg.norm(post[targets] - prior[targets], axis=-1)))

    scored = [(update(s), s.frame, s) for s in scans]
    best = max(scored, key=lambda x: (x[0], x[1]))
    return best[2], best[0]


# --- the common currency: option value on the true state -----------------------------------


def truth_context(run: MatchRun, decision: Decision) -> DecisionContext:
    """The decision as a fully informed player would face it: true state, belief age zero."""
    f, i = decision.frame, run.index(decision.player)
    player = run.players[i]
    return DecisionContext(
        carrier=i,
        team=np.array([p.team for p in run.players]),
        pos=run.pos[f].copy(),
        vel=run.vel[f].copy(),
        age_s=np.zeros(len(run.players)),
        ids=run.ids,
        attack_sign=attack_sign(player.team),
        ball=run.ball_pos[f, :2].copy(),
        temperature=player.temperature,
    )


def option_value(ctx: DecisionContext, option: OptionEval) -> tuple[float, float]:
    """(P(success), value) of an option as played (same target) on the context's state."""
    if option.kind != "pass":
        match = next(o for o in evaluate_options(ctx) if o.action == option.action)
        return match.p_success, match.value
    n = len(ctx.team)
    own = ctx.team[ctx.carrier]
    opp = np.flatnonzero(ctx.team != own)
    mates = np.flatnonzero((ctx.team == own) & (np.arange(n) != ctx.carrier))
    target = np.asarray(option.target, dtype=float)
    # Private on purpose: it is the decision model's own completion probability for one target.
    p = _pass_success(ctx, ctx.ids.index(option.target_player), ctx.ball, target, opp, mates)
    p = 0.0 if p is None else p
    sign = ctx.attack_sign
    return p, p * float(xt_for(target, sign)) - (1.0 - p) * float(xt_for(target, -sign))


# --- the three lenses ------------------------------------------------------------------------


@lru_cache(maxsize=16)
def _drop_scan(scenario: str, seed: int, scan_id: str) -> CounterfactualResult:
    return drop_scan_counterfactual(scenario, seed, scan_id)


def _nearest_decision(run: MatchRun, player: str, frame: int) -> Decision | None:
    mine = [d for d in run.decisions if d.player == player]
    return min(mine, key=lambda d: (abs(d.frame - frame), d.frame)) if mine else None


def _unavailable(lens: LensName, note: str) -> LensResult:
    return LensResult(lens=lens, available=False, note=note)


def _evidence(run: MatchRun, decision: Decision, *first: str) -> list[str]:
    action = action_event(run, decision)
    return [*first] + ([action.id] if action is not None else [])


def scan_lens(run: MatchRun, decision: Decision) -> LensResult:
    found = most_informative_scan(run, decision)
    if found is None:
        return _unavailable("scan", f"no scan by {decision.player} before the decision")
    scan, update = found
    result = _drop_scan(run.scenario, run.seed, scan.id)
    cf_run = result.counterfactual
    cf_decision = _nearest_decision(cf_run, decision.player, decision.frame)
    if cf_decision is None:
        return _unavailable("scan", f"{decision.player} makes no decision without {scan.id}")
    chosen, cf_chosen = chosen_option(decision), chosen_option(cf_decision)
    _, value = option_value(truth_context(run, decision), chosen)
    _, cf_value = option_value(truth_context(cf_run, cf_decision), cf_chosen)
    target = chosen.target_player
    cf_prob = next((o.prob for o in cf_decision.options if o.action == decision.chosen), 0.0)
    shift = float(np.linalg.norm(np.subtract(chosen.target, cf_chosen.target)))
    return LensResult(
        lens="scan",
        available=True,
        delta_xt=rounded(value - cf_value),
        metrics={
            "scan_id": scan.id,
            "scan_t_s": rounded(scan.t),
            "belief_update_m": rounded(update),
            "target": target,
            "factual_action": decision.chosen,
            "counterfactual_action": cf_decision.chosen,
            "decision_changed": decision.chosen != cf_decision.chosen,
            "target_shift_m": rounded(shift),
            "factual_value": rounded(value),
            "counterfactual_value": rounded(cf_value),
            "factual_prob": rounded(chosen.prob),
            "factual_action_prob_without_scan": rounded(cf_prob),
            "belief_error_target_m": rounded(decision.belief_error[target]) if target else None,
            "belief_error_target_without_scan_m": rounded(cf_decision.belief_error[target])
            if target
            else None,
            "realized_delta_xt": rounded(result.delta_xt)
            if decision.player == run.hero and math.isfinite(result.delta_xt)
            else None,
        },
        evidence=_evidence(run, decision, scan.id),
    )


def space_lens(run: MatchRun, decision: Decision) -> LensResult:
    if len(decision.options) < 2:
        return _unavailable("space", "no alternative option")
    ctx = truth_context(run, decision)
    values = {o.action: option_value(ctx, o) for o in decision.options}
    chosen = chosen_option(decision)
    alt = max(
        (o for o in decision.options if o.action != decision.chosen),
        key=lambda o: (values[o.action][1], o.action),
    )
    sign = ctx.attack_sign
    own = ctx.team == ctx.team[ctx.carrier]
    targets = np.array([chosen.target, alt.target], dtype=float)
    control = pitch_control(targets, ctx.pos[own], ctx.vel[own], ctx.pos[~own], ctx.vel[~own])
    xt = xt_for(targets, sign)
    (p_c, v_c), (p_a, v_a) = values[chosen.action], values[alt.action]
    return LensResult(
        lens="space",
        available=True,
        delta_xt=rounded(v_c - v_a),
        metrics={
            "chosen_action": chosen.action,
            "alternative_action": alt.action,
            "chosen_value": rounded(v_c),
            "alternative_value": rounded(v_a),
            "chosen_p_success": rounded(p_c),
            "alternative_p_success": rounded(p_a),
            "chosen_xt": rounded(xt[0]),
            "alternative_xt": rounded(xt[1]),
            "chosen_pitch_control": rounded(control[0]),
            "alternative_pitch_control": rounded(control[1]),
            "believed_chosen_value": rounded(chosen.value),
            "believed_alternative_value": rounded(alt.value),
        },
        evidence=_evidence(run, decision),
    )


def pressure_lens(run: MatchRun, decision: Decision) -> LensResult:
    f, i = decision.frame, run.index(decision.player)
    if int(run.owner[f]) != i:
        return _unavailable("pressure", f"{decision.player} is not on the ball at the decision")
    ctx = truth_context(run, decision)
    pressing = frame_pressing(run.pos[f], run.vel[f], ctx.team, run.ball_pos[f], run.ball_vel[f], i)
    column = pressing.matrix[:, np.flatnonzero(pressing.attackers == i)[0]]
    top = int(np.argmax(column))
    opponents = pressing.defenders
    nearest = float(np.min(np.linalg.norm(run.pos[f, opponents] - run.pos[f, i], axis=-1)))
    _, value = option_value(ctx, chosen_option(decision))
    turnover = -float(xt_for(ctx.ball, -ctx.attack_sign))
    pi = pressing.on_carrier
    action = action_event(run, decision)
    end = action.attrs.get("end") if action is not None else None
    after = None
    if end is not None and action.attrs.get("outcome") == "complete":
        after_pi = frame_pressing(
            run.pos[end], run.vel[end], ctx.team, run.ball_pos[end], run.ball_vel[end],
            int(run.owner[end]),
        ).on_carrier  # fmt: skip
        after = rounded(after_pi) if math.isfinite(after_pi) else None
    return LensResult(
        lens="pressure",
        available=True,
        delta_xt=rounded(pi * (value - turnover)),
        metrics={
            "pressure_on_carrier": rounded(pi),
            "top_presser": run.ids[opponents[top]],
            "top_presser_p": rounded(column[top]),
            "nearest_opponent_m": rounded(nearest),
            "chosen_value": rounded(value),
            "turnover_value": rounded(turnover),
            "pressure_on_receiver": after,
        },
        evidence=_evidence(run, decision),
    )


# --- selection ---------------------------------------------------------------------------------


def tied_for_first(lenses: list[LensResult]) -> list[LensResult]:
    """Available lenses whose |delta| is within TIE_TOLERANCE_XT of the largest."""
    usable = [
        lens
        for lens in lenses
        if lens.available and lens.delta_xt is not None and math.isfinite(lens.delta_xt)
    ]
    if not usable:
        return []
    best = max(abs(lens.delta_xt) for lens in usable)
    # Deltas are rounded to 1e-4; the 1e-9 only absorbs float error at the band's edge.
    return [lens for lens in usable if best - abs(lens.delta_xt) <= TIE_TOLERANCE_XT + 1e-9]


def select_lens(lenses: list[LensResult]) -> LensName | None:
    """Largest |delta|; near-ties (within TIE_TOLERANCE_XT) go to LENS_PRECEDENCE order."""
    tied = tied_for_first(lenses)
    if not tied:
        return None
    return min(tied, key=lambda lens: LENS_PRECEDENCE.index(lens.lens)).lens


def compute_lenses(run: MatchRun, card: MomentCard) -> MomentCard:
    """The card with all three candidate lenses and the selected one. Moments without a decision
    (sprints, scripted passes) have no counterfactual to measure and get none."""
    decision = (
        None if card.decision_frame is None else decision_at(run, card.player, card.decision_frame)
    )
    if decision is None or card.live_only:
        return card.model_copy(update={"candidate_lenses": [], "selected_lens": None})
    lenses = [scan_lens(run, decision), space_lens(run, decision), pressure_lens(run, decision)]
    return card.model_copy(
        update={"candidate_lenses": lenses, "selected_lens": select_lens(lenses)}
    )


def hero_card(scenario: str, seed: int) -> MomentCard:
    """The scenario hero's scan-led decision, with its lenses."""
    run = Simulation.from_scenario(scenario, seed).run()
    card = next(
        (
            c
            for c in detect_moments(run)
            if c.kind == "decision_after_scan" and c.player == run.hero
        ),
        None,
    )
    if card is None:
        raise LookupError(f"{scenario} seed {seed}: no decision_after_scan moment for {run.hero}")
    return compute_lenses(run, card)


# --- CLI -----------------------------------------------------------------------------------------


def _table(scenario: str, seeds: list[int]) -> str:
    rows = [
        "| Seed | Factual | Without scan | scan Δ | space Δ | pressure Δ | Selected | Tied |",
        "|---|---|---|---|---|---|---|---|",
    ]
    selected, tied, equal = {}, 0, 0
    for seed in seeds:
        card = hero_card(scenario, seed)
        lenses = {lens.lens: lens for lens in card.candidate_lenses}
        tie = len(tied_for_first(card.candidate_lenses)) > 1
        scan, space = lenses["scan"], lenses["space"]
        tied += tie
        equal += scan.available and space.available and scan.delta_xt == space.delta_xt
        selected[card.selected_lens] = selected.get(card.selected_lens, 0) + 1
        fmt = [
            f"{lenses[n].delta_xt:+.4f}" if lenses[n].available else "n/a" for n in LENS_PRECEDENCE
        ]
        rows.append(
            f"| {seed} | `{scan.metrics.get('factual_action')}` "
            f"| `{scan.metrics.get('counterfactual_action')}` | {' | '.join(fmt)} "
            f"| {card.selected_lens} | {'yes' if tie else ''} |"
        )
    n = len(seeds)
    summary = [
        f"Selected: {', '.join(f'{k} {v}/{n}' for k, v in sorted(selected.items(), key=str))}. "
        f"Tied within {TIE_TOLERANCE_XT} xT (precedence decides): {tied}/{n}; "
        f"scan Δ == space Δ to 4 dp: {equal}/{n}.",
        "",
    ]
    return "\n".join(summary + rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scenario", default="blind_side_run")
    parser.add_argument("--seed", type=int, default=100)
    parser.add_argument("--seeds", help="a range like 100-139: print a table instead")
    args = parser.parse_args()
    if args.seeds:
        lo, _, hi = args.seeds.partition("-")
        print(_table(args.scenario, list(range(int(lo), int(hi or lo) + 1))))
    else:
        print(hero_card(args.scenario, args.seed).model_dump_json(indent=2))


if __name__ == "__main__":
    main()
