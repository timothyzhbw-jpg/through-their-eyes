"""Decision model (SPEC 3.5): an opponent's run before he reacts is on the ball's way too.

Time to intercept (SPEC 4.1) has a player keep his velocity for the reaction time. A presser
sprinting at the carrier therefore meets the ball during that time; the sim's tackle and control
rules (control radius 1 m) take it from there. The decision model has to see that, or carrying
into the presser and passing through him look safe (found in PR #31 on `press_escape`).
"""

import numpy as np
import pytest

from sim.decision import DecisionContext, evaluate_options, option_success

SPRINT = 7.0  # m/s, a presser at full speed


def _options(defender_vel, defender_pos=(4.0, 0.0), age=0.0):
    """Carrier at the origin attacking +x, a teammate standing 15 m ahead, one opponent."""
    ctx = DecisionContext(
        carrier=0,
        team=np.array([0, 0, 1]),
        pos=np.array([[0.0, 0.0], [15.0, 0.0], defender_pos]),
        vel=np.array([[0.0, 0.0], [0.0, 0.0], defender_vel]),
        age_s=np.array([0.0, 0.0, age]),
        ids=["H1", "H2", "A1"],
        attack_sign=1,
    )
    return ctx, {o.action: o for o in evaluate_options(ctx)}


def test_a_presser_running_at_the_carrier_makes_the_carry_unattractive():
    _, at = _options((-SPRINT, 0.0))
    _, away = _options((SPRINT, 0.0))
    assert at["carry"].p_success < 0.2  # he runs into the 5 m carry
    assert away["carry"].p_success > 0.8  # he is gone before the carry gets there
    assert at["carry"].value < away["carry"].value
    assert max(at.values(), key=lambda o: o.value).action != "carry"


def test_a_pass_along_the_pressers_line_is_likely_intercepted():
    _, at = _options((-SPRINT, 0.0))
    _, off_the_lane = _options((0.0, SPRINT))  # the same sprint, away from the passing lane
    assert at["pass:H2"].p_success < 0.2  # the ball runs into him
    assert off_the_lane["pass:H2"].p_success > 0.9
    assert at["pass:H2"].value < off_the_lane["pass:H2"].value


def test_an_opponent_standing_on_the_passing_lane_is_in_the_way():
    _, on = _options((0.0, 0.0))
    _, beside = _options((0.0, 0.0), defender_pos=(4.0, 3.0))
    assert on["pass:H2"].p_success < 0.2
    assert beside["pass:H2"].p_success > 0.9


def test_an_older_sighting_of_the_presser_is_less_certain():
    _, fresh = _options((-SPRINT, 0.0))
    _, stale = _options((-SPRINT, 0.0), age=1.0)
    assert fresh["carry"].p_success < stale["carry"].p_success < 0.5


@pytest.mark.parametrize("vel", [(-SPRINT, 0.0), (SPRINT, 0.0), (0.0, SPRINT), (0.0, 0.0)])
def test_option_success_scores_the_run_in_the_same_way(vel):
    ctx, options = _options(vel)
    for o in options.values():
        assert option_success(ctx, o.action, o.target) == pytest.approx(o.p_success, abs=1e-12)
