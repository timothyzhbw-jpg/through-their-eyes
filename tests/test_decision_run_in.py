"""Decision model (SPEC 3.5): an opponent's run before he reacts is on the ball's way too.

Time to intercept (SPEC 4.1) has a player keep his velocity for the reaction time. A presser
sprinting at the carrier therefore meets the ball during that time; the sim's tackle and control
rules (control radius 1 m) take it from there. The decision model has to see that, or carrying
into the presser and passing through him look safe (found in PR #31 on `press_escape`).

Pinned numbers are the model's own (SPEC 3.5); "TTI only" means the run-in switched off.
"""

import numpy as np
import pytest

import sim.decision
from sim.decision import DecisionContext, DecisionParams, evaluate_options, option_success

SPRINT = 7.0  # m/s, a presser at full speed


def _options(defender_vel, defender_pos=(4.0, 0.0), age=0.0, params=None):
    """Carrier at the origin attacking +x, a teammate standing 15 m ahead, one opponent."""
    ctx = DecisionContext(
        carrier=0,
        team=np.array([0, 0, 1]),
        pos=np.array([[0.0, 0.0], [15.0, 0.0], defender_pos]),
        vel=np.array([[0.0, 0.0], [0.0, 0.0], defender_vel]),
        age_s=np.array([0.0, 0.0, age]),
        ids=["H1", "H2", "A1"],
        attack_sign=1,
        params=params or DecisionParams(),
    )
    return ctx, {o.action: o for o in evaluate_options(ctx)}


def _tti_only(monkeypatch, *args, **kwargs):
    """The same options with the run-in switched off."""
    with monkeypatch.context() as mp:
        mp.setattr(sim.decision, "_p_run_in", lambda ctx, players, miss: np.zeros(len(players)))
        return _options(*args, **kwargs)[1]


def test_a_presser_running_at_the_carrier_makes_the_carry_unattractive():
    _, at = _options((-SPRINT, 0.0))
    _, away = _options((SPRINT, 0.0))
    assert at["carry"].p_success < 0.01  # he runs into the 5 m carry (TTI only: 0.958)
    assert away["carry"].p_success == pytest.approx(0.846, abs=0.02)  # gone before it gets there
    assert at["carry"].value < away["carry"].value
    assert max(at.values(), key=lambda o: o.value).action != "carry"


def test_a_pass_along_the_pressers_line_is_likely_intercepted():
    _, at = _options((-SPRINT, 0.0))
    _, away = _options((SPRINT, 0.0))
    _, off_the_lane = _options((0.0, SPRINT))  # the same sprint, away from the passing lane
    assert at["pass:H2"].p_success < 0.01  # the ball runs into him (TTI only: 0.964)
    # Running away along the lane he is still in it after his reaction: TTI alone says so.
    assert away["pass:H2"].p_success == pytest.approx(0.189, abs=0.02)
    assert off_the_lane["pass:H2"].p_success == pytest.approx(0.966, abs=0.02)
    assert off_the_lane["carry"].p_success == pytest.approx(0.923, abs=0.02)
    assert at["pass:H2"].value < off_the_lane["pass:H2"].value


def test_an_opponent_standing_on_the_passing_lane_is_in_the_way():
    _, on = _options((0.0, 0.0))
    _, beside = _options((0.0, 0.0), defender_pos=(4.0, 3.0))
    assert on["pass:H2"].p_success < 0.01  # TTI only: 0.685
    assert on["carry"].p_success == pytest.approx(0.046, abs=0.02)  # TTI only: 0.412
    assert beside["pass:H2"].p_success > 0.9


def test_an_opponent_on_the_ball_when_it_starts_is_counted():
    """The run-in starts at t = 0, not at the first sample of the ball's path."""
    on_the_ball = ((0.0, SPRINT), (0.0, 0.95))  # inside the radius, leaving it at a sprint
    _, o = _options(*on_the_ball)
    assert o["carry"].p_success < 0.5
    assert o["pass:H2"].p_success < 0.5


def test_a_defender_who_has_crossed_the_line_and_is_leaving_keeps_the_tti_only_value(monkeypatch):
    """Where his run went before the ball got there does not count: the approach is timed."""
    leaving = ((0.0, -SPRINT), (4.0, -0.5))  # 0.5 m past the line of the carry and the pass
    _, o = _options(*leaving)
    tti = _tti_only(monkeypatch, *leaving)
    assert o["carry"].p_success == pytest.approx(tti["carry"].p_success, abs=1e-3)
    assert o["pass:H2"].p_success == pytest.approx(tti["pass:H2"].p_success, abs=1e-3)


def test_after_the_reaction_a_carry_is_scored_along_its_path():
    """A carry faster than v_max outruns the TTI margin, so its endpoint is not its worst point:
    a defender beside the middle of the carry gets there in time, the endpoint is too far."""
    fast = DecisionParams(carry_distance=12.0, carry_time=1.0, reaction=0.3)
    _, o = _options((0.0, 0.0), defender_pos=(5.0, 1.5), params=fast)
    assert o["carry"].p_success < 0.75  # the endpoint alone gives about 0.93


def test_an_older_sighting_of_the_presser_is_less_certain():
    _, fresh = _options((-SPRINT, 0.0))
    _, stale = _options((-SPRINT, 0.0), age=1.0)
    assert fresh["carry"].p_success < stale["carry"].p_success < 0.5


@pytest.mark.parametrize(
    "vel,pos",
    [
        ((-SPRINT, 0.0), (4.0, 0.0)),
        ((SPRINT, 0.0), (4.0, 0.0)),
        ((0.0, SPRINT), (4.0, 0.0)),
        ((0.0, 0.0), (4.0, 0.0)),
        ((0.0, SPRINT), (0.0, 0.95)),
    ],
)
def test_option_success_scores_the_run_in_the_same_way(vel, pos):
    ctx, options = _options(vel, pos)
    for o in options.values():
        assert option_success(ctx, o.action, o.target) == pytest.approx(o.p_success, abs=1e-12)
