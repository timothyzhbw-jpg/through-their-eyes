"""Verifier acceptance checks (SPEC 5.3): predicates evaluated against a sim run.

Expected values are computed here straight from the MatchRun arrays and event list, not through
explain/, so a wrong kernel in the verifier cannot agree with itself.
"""

import numpy as np
import pytest

from analytics.pitch_control import pitch_control, pitch_grid
from analytics.vision import visibility
from explain.builders import HeroRefs
from explain.claims import Claim, Predicate, Slot, event, fn, slot
from explain.functions import EvalContext
from explain.verifier import Verifier
from sim.counterfactual import drop_scan_counterfactual

SCENARIO = "blind_side_run"


@pytest.fixture(scope="module")
def hero():
    return drop_scan_counterfactual(SCENARIO, seed=3)


@pytest.fixture(scope="module")
def run(hero):
    return hero.factual


@pytest.fixture(scope="module")
def refs(run):
    return HeroRefs.of(run)


@pytest.fixture(scope="module")
def ctx(hero):
    return EvalContext(hero.factual, counterfactuals={hero.scan_id: hero})


def check(ctx, predicate, slots=None, evidence=()):
    claim = Claim(
        id="t", template="", slots=slots or {}, predicate=predicate, evidence=list(evidence)
    )
    return Verifier(ctx).verify(claim)


def eq(lhs, rhs):
    return Predicate(op="eq", lhs=lhs, rhs=rhs)


def scans(run, player, lo, hi):
    return sum(e.type == "scan" and e.player == player and lo <= e.frame <= hi for e in run.events)


# --- functions ---------------------------------------------------------------------------


def test_count_events_counts_the_event_store_in_a_window(ctx, run, refs):
    r = refs.reception
    n = scans(run, "H8", r.frame - 50, r.frame)
    count = fn("count_events", type="scan", player="H8", from_=-2.0, to=0.0, anchor=r.id)
    assert check(ctx, eq(count, n)).status == "supported"
    assert check(ctx, eq(count, n + 1)).status == "refuted"
    passes = sum(e.type == "pass" and e.frame <= r.frame for e in run.events)
    since_kickoff = fn("count_events", type="pass", from_=-r.t, to=0.0, anchor=r.id)
    assert check(ctx, eq(since_kickoff, passes)).status == "supported"
    keyed = fn("count_events", type="scan", where={"key": True}, from_=-r.t, to=0.0, anchor=r.id)
    assert check(ctx, eq(keyed, 1)).status == "supported"
    beyond = fn("count_events", type="pass", from_=0.0, to=60.0, anchor=r.id)
    assert check(ctx, eq(beyond, passes)).status == "inconclusive"


def test_scans_in_window_counts_scans_before_the_anchor(ctx, run, refs):
    r = refs.reception
    n = scans(run, "H8", r.frame - 50, r.frame)
    window = fn("scans_in_window", player="H8", anchor=r.id, window_s=2.0)
    assert check(ctx, eq(window, n)).status == "supported"
    assert check(ctx, eq(window, n - 1)).status == "refuted"


def test_a_window_reaching_before_the_recorded_run_is_inconclusive(ctx, refs):
    window = fn("scans_in_window", player="H8", anchor=refs.reception.id, window_s=10.0)
    verdict = check(ctx, eq(window, 2))
    assert verdict.status == "inconclusive"
    assert "before the recorded run" in verdict.reason


def test_event_attr_reads_recorded_and_derived_attributes(ctx, run, refs):
    p, k = refs.hero_pass, refs.key_scan
    assert check(ctx, eq(fn("event_attr", event=p.id, attr="to"), "H9")).status == "supported"
    assert check(ctx, eq(fn("event_attr", event=p.id, attr="to"), "H4")).status == "refuted"
    assert check(ctx, eq(fn("event_attr", event=p.id, attr="player"), "H8")).status == "supported"
    dist = Predicate(op="approx", lhs=fn("event_attr", event=p.id, attr="distance"),
                     rhs=round(p.attrs["distance"], 1), abs_tol=0.05)  # fmt: skip
    assert check(ctx, dist).status == "supported"
    duration = (k.attrs["end"] - k.frame) * run.dt
    dur = Predicate(op="approx", lhs=fn("event_attr", event=k.id, attr="duration_s"),
                    rhs=duration, abs_tol=1e-9)  # fmt: skip
    assert check(ctx, dur).status == "supported"
    assert check(ctx, eq(fn("event_attr", event=k.id, attr="key"), True)).status == "supported"
    unknown = check(ctx, eq(fn("event_attr", event=p.id, attr="spin"), 1))
    assert unknown.status == "inconclusive"


def test_distance_and_metric_at_read_positions_at_the_anchor(ctx, run, refs):
    f = refs.hero_pass.frame
    h9, a5 = run.index("H9"), run.index("A5")
    gap = float(np.linalg.norm(run.pos[f, h9] - run.pos[f, a5]))
    dist = fn("distance", a="H9", b="A5", anchor=refs.hero_pass.id)
    assert check(ctx, Predicate(op="approx", lhs=dist, rhs=gap, abs_tol=1e-6)).status == (
        "supported"
    )
    opp = [i for i, p in enumerate(run.players) if p.team == 1]
    nearest = float(np.linalg.norm(run.pos[f, opp] - run.pos[f, h9], axis=1).min())
    metric = fn("metric_at", metric="nearest_opponent_distance", player="H9",
                anchor=refs.hero_pass.id)  # fmt: skip
    assert check(ctx, Predicate(op="approx", lhs=metric, rhs=nearest, abs_tol=1e-6)).status == (
        "supported"
    )
    speed = float(np.linalg.norm(run.vel[f + 10, h9]))
    at = fn("metric_at", metric="speed", player="H9", anchor=refs.hero_pass.id, at=0.4)
    assert check(ctx, Predicate(op="approx", lhs=at, rhs=speed, abs_tol=1e-6)).status == (
        "supported"
    )
    ball = float(np.linalg.norm(run.ball_pos[f, :2] - run.pos[f, h9]))
    to_ball = fn("distance", a="ball", b="H9", anchor=refs.hero_pass.id)
    assert check(ctx, Predicate(op="approx", lhs=to_ball, rhs=ball, abs_tol=1e-6)).status == (
        "supported"
    )


def test_metric_delta_is_the_change_between_two_offsets(ctx, run, refs):
    r = refs.reception
    h9, a5 = run.index("H9"), run.index("A5")
    gap = lambda f: float(np.linalg.norm(run.pos[f, h9] - run.pos[f, a5]))  # noqa: E731
    delta = gap(r.frame) - gap(r.frame - 25)
    d = fn("metric_delta", metric="distance", a="H9", b="A5", anchor=r.id, from_=-1.0, to=0.0)
    assert check(ctx, Predicate(op="approx", lhs=d, rhs=delta, abs_tol=1e-6)).status == (
        "supported"
    )
    assert check(ctx, Predicate(op="gt", lhs=d, rhs=0.0)).status == (
        "supported" if delta > 0 else "refuted"
    )


def test_time_since_last_scan_is_measured_from_the_scan_start(ctx, run, refs):
    since = (refs.reception.frame - refs.key_scan.frame) * run.dt
    m = fn("metric_at", metric="time_since_last_scan", player="H8", anchor=refs.reception.id)
    assert check(ctx, Predicate(op="approx", lhs=m, rhs=since, abs_tol=1e-9)).status == (
        "supported"
    )


def test_belief_metrics_come_from_the_decision_record(ctx, refs):
    d = refs.decision
    err = fn("metric_at", metric="belief_error", observer="H8", target="H9",
             anchor=refs.hero_pass.id)  # fmt: skip
    expected = d.belief_error["H9"]
    assert check(ctx, Predicate(op="approx", lhs=err, rhs=expected, abs_tol=1e-9)).status == (
        "supported"
    )
    elsewhere = fn("metric_at", metric="belief_error", observer="H8", target="H9",
                   anchor=refs.reception.id)  # fmt: skip
    verdict = check(ctx, Predicate(op="lt", lhs=elsewhere, rhs=1.0))
    assert verdict.status == "inconclusive"
    assert "decision" in verdict.reason


def test_observed_share_weights_vision_by_opponent_control(ctx, run, refs):
    f, i = refs.reception.frame, run.index("H8")
    grid = pitch_grid()
    team = np.array([p.team for p in run.players])
    mates, opps = np.flatnonzero(team == 0), np.flatnonzero(team == 1)
    others = np.delete(run.pos[f], i, axis=0)
    v = visibility(run.pos[f, i], run.head_yaw[f, i], np.linalg.norm(run.vel[f, i]), grid, others)
    p_def = pitch_control(grid, run.pos[f, opps], run.vel[f, opps], run.pos[f, mates],
                          run.vel[f, mates])  # fmt: skip
    share = float((v * p_def).sum() / p_def.sum())
    at = fn("observed_share", player="H8", anchor=refs.reception.id)
    assert check(ctx, Predicate(op="approx", lhs=at, rhs=share, abs_tol=1e-6)).status == (
        "supported"
    )
    window = fn("observed_share", player="H8", anchor=refs.reception.id, window_s=1.0)
    assert check(ctx, Predicate(op="ge", lhs=window, rhs=share)).status == "supported"
    assert check(ctx, Predicate(op="le", lhs=window, rhs=1.0)).status == "supported"


def test_cf_delta_and_cf_runs_read_the_counterfactual(ctx, hero, refs):
    k = refs.key_scan.id
    value = fn("cf_delta", of="possession_value", scan=k)
    assert check(
        ctx, Predicate(op="approx", lhs=value, rhs=hero.delta_xt, abs_tol=1e-9)
    ).status == ("supported")
    chosen = fn("metric_at", metric="chosen", player="H8", anchor=refs.hero_pass.id, cf=k)
    assert check(ctx, eq(chosen, hero.counterfactual_action)).status == "supported"
    assert check(ctx, eq(chosen, hero.factual_action)).status == "refuted"
    err = fn("metric_at", metric="belief_error", observer="H8", target="H9",
             anchor=refs.hero_pass.id)  # fmt: skip
    delta = fn("cf_delta", of=err, scan=k)
    expected = (
        hero.factual_decision.belief_error["H9"] - hero.counterfactual_decision.belief_error["H9"]
    )
    assert check(ctx, Predicate(op="approx", lhs=delta, rhs=expected, abs_tol=1e-9)).status == (
        "supported"
    )


def test_a_counterfactual_not_supplied_is_resimulated_or_inconclusive(hero, refs):
    value = fn("cf_delta", of="possession_value", scan=refs.key_scan.id)
    claim = Predicate(op="approx", lhs=value, rhs=hero.delta_xt, abs_tol=1e-9)
    assert check(EvalContext(hero.factual), claim).status == "supported"
    lazy = check(EvalContext(hero.factual, resimulate=False), claim)
    assert lazy.status == "inconclusive"
    missing = fn("cf_delta", of="possession_value", scan="scan:H8:0001")
    assert check(EvalContext(hero.factual), eq(missing, 0.0)).status == "refuted"


# --- predicate ops -----------------------------------------------------------------------


def test_comparison_ops(ctx, run, refs):
    n = scans(run, "H8", refs.reception.frame - 50, refs.reception.frame)
    c = fn("scans_in_window", player="H8", anchor=refs.reception.id, window_s=2.0)
    cases = {
        ("eq", n): True, ("eq", n + 1): False,
        ("ne", n + 1): True, ("ne", n): False,
        ("lt", n + 1): True, ("lt", n): False,
        ("le", n): True, ("le", n - 1): False,
        ("gt", n - 1): True, ("gt", n): False,
        ("ge", n): True, ("ge", n + 1): False,
    }  # fmt: skip
    for (op, rhs), holds in cases.items():
        verdict = check(ctx, Predicate(op=op, lhs=c, rhs=rhs))
        assert verdict.status == ("supported" if holds else "refuted"), (op, rhs)


def test_approx_uses_relative_and_absolute_tolerances(ctx, refs):
    d = fn("event_attr", event=refs.hero_pass.id, attr="distance")
    truth = refs.hero_pass.attrs["distance"]
    approx = lambda rhs, **tol: check(ctx, Predicate(op="approx", lhs=d, rhs=rhs, **tol)).status  # noqa: E731
    assert approx(truth * 1.09, tol=0.1) == "supported"
    assert approx(truth * 1.2, tol=0.19) == "refuted"
    assert approx(truth * 0.8, tol=0.19) == "refuted"
    assert approx(round(truth), abs_tol=0.5) == "supported"
    assert approx(round(truth) + 1, abs_tol=0.5) == "refuted"


def test_exists_and_before(ctx, refs):
    k, r = refs.key_scan.id, refs.reception.id
    assert check(ctx, Predicate(op="exists", lhs=event(k))).status == "supported"
    assert check(ctx, Predicate(op="exists", lhs=event("scan:H8:0001"))).status == "refuted"
    assert check(ctx, Predicate(op="before", lhs=event(k), rhs=event(r))).status == "supported"
    assert check(ctx, Predicate(op="before", lhs=event(r), rhs=event(k))).status == "refuted"
    assert check(ctx, Predicate(op="before", lhs=event(k), rhs=event(k))).status == "refuted"
    assert check(ctx, Predicate(op="before", lhs=event(k), rhs=99.0)).status == "supported"


def test_all_is_a_conjunction_with_inconclusive_dominating_supported(ctx, refs):
    p = refs.hero_pass.id
    true = eq(fn("event_attr", event=p, attr="to"), "H9")
    false = eq(fn("event_attr", event=p, attr="to"), "H4")
    unknown = eq(fn("metric_at", metric="pressing_intensity", player="H8", anchor=p), 0.5)
    assert check(ctx, Predicate(op="all", args=[true, true])).status == "supported"
    assert check(ctx, Predicate(op="all", args=[true, false])).status == "refuted"
    assert check(ctx, Predicate(op="all", args=[true, unknown])).status == "inconclusive"
    assert check(ctx, Predicate(op="all", args=[unknown, false])).status == "refuted"


# --- what cannot be computed, and what does not exist -------------------------------------


def test_functions_that_cannot_be_computed_are_inconclusive_never_faked(ctx, refs):
    p = refs.hero_pass.id
    for lhs in (
        fn("expected_goals", player="H8", anchor=p),
        fn("metric_at", metric="heart_rate", player="H8", anchor=p),
        fn("metric_at", metric="pressing_intensity", player="H8", anchor=p),
        fn("count_events", type="scan", player="H8", from_=-1.0, to=0.0, anchor="m12.reception"),
    ):
        verdict = check(ctx, Predicate(op="ge", lhs=lhs, rhs=0.0))
        assert verdict.status == "inconclusive", lhs
    pressing = check(
        ctx, eq(fn("metric_at", metric="pressing_intensity", player="H8", anchor=p), 0.0)
    )
    assert "TODO" in pressing.reason


def test_references_to_things_that_did_not_happen_are_refuted(ctx, refs):
    p = refs.hero_pass.id
    assert check(ctx, eq(fn("event_attr", event="pass:H8:0001", attr="to"), "H9")).status == (
        "refuted"
    )
    assert check(ctx, eq(fn("distance", a="H99", b="A5", anchor=p), 1.0)).status == "refuted"
    on_time = eq(fn("event_attr", event=p, attr="to"), "H9")
    assert check(ctx, on_time, evidence=[refs.key_scan.id]).status == "supported"
    assert check(ctx, on_time, evidence=["scan:H8:0001"]).status == "refuted"


def test_type_mismatches_are_inconclusive(ctx, refs):
    to = fn("event_attr", event=refs.hero_pass.id, attr="to")
    assert check(ctx, Predicate(op="gt", lhs=to, rhs=3)).status == "inconclusive"
    assert check(ctx, eq(to, 3)).status == "inconclusive"


# --- slots: every rendered value must be an input of the predicate ------------------------


def test_slots_bind_into_the_predicate(ctx, run, refs):
    r = refs.reception
    n = scans(run, "H8", r.frame - 50, r.frame)
    slots = {"player": Slot(ref="H8"), "n": Slot(value=n), "window_s": Slot(value=2)}
    count = fn("count_events", type="scan", player=slot("player"),
               from_=slot("window_s", scale=-1), to=0.0, anchor=r.id)  # fmt: skip
    assert check(ctx, eq(count, slot("n")), slots).status == "supported"
    wrong = slots | {"n": Slot(value=n + 1)}
    assert check(ctx, eq(count, slot("n")), wrong).status == "refuted"


def test_a_slot_not_bound_to_the_predicate_is_inconclusive(ctx, run, refs):
    """The SPEC example shape with literals: the rendered numbers would be unchecked."""
    r = refs.reception
    n = scans(run, "H8", r.frame - 50, r.frame)
    count = fn("count_events", type="scan", player="H8", from_=-2.0, to=0.0, anchor=r.id)
    slots = {"player": Slot(ref="H8"), "n_scans": Slot(value=n), "window_s": Slot(value=2)}
    verdict = check(ctx, eq(count, n), slots)
    assert verdict.status == "inconclusive"
    assert "n_scans" in verdict.reason and "window_s" in verdict.reason
    # Swapped slot values would otherwise render a false sentence over a true predicate.
    swapped = {"player": Slot(ref="H8"), "n_scans": Slot(value=2), "window_s": Slot(value=n)}
    assert check(ctx, eq(count, n), swapped).status == "inconclusive"


def test_an_unknown_slot_reference_is_inconclusive(ctx, refs):
    count = fn("scans_in_window", player=slot("who"), anchor=refs.reception.id, window_s=2.0)
    assert check(ctx, eq(count, 1)).status == "inconclusive"


def test_verdicts_are_deterministic_and_fingerprint_the_claim(ctx, refs):
    claim = Claim(
        id="c1", template="{to}", slots={"to": Slot(ref="H9")},
        predicate=eq(fn("event_attr", event=refs.hero_pass.id, attr="to"), slot("to")),
    )  # fmt: skip
    a, b = Verifier(ctx).verify(claim), Verifier(ctx).verify(claim)
    assert a.status == "supported"
    assert a.model_dump() == b.model_dump()
    assert a.fingerprint == claim.fingerprint()
    assert a.trace and a.trace[0]["lhs"] == "H9"
