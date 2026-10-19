"""Ground-ball physics (SPEC 3.3): closed-form rolling with quadratic drag."""

import numpy as np
import pytest

from sim.ball import BallParams, advance, distance_to_stop, flight_time, launch_speed, speed_at

P = BallParams()


@pytest.mark.parametrize("distance", [5.0, 15.0, 30.0, 45.0])
def test_launch_speed_arrives_with_the_requested_speed(distance):
    v0 = launch_speed(distance, 8.0, P)
    assert np.isclose(speed_at(v0, distance, P), 8.0)


@pytest.mark.parametrize("distance", [10.0, 25.0, 40.0])
def test_frame_stepping_matches_closed_form_flight_time(distance):
    v0 = launch_speed(distance, 7.0, P)
    dt, travelled, speed, t = 0.04, 0.0, v0, 0.0
    while travelled < distance:
        step, speed = advance(speed, dt, P)
        travelled += step
        t += dt
    assert abs(t - flight_time(v0, distance, P)) <= dt


def test_rolling_ball_only_loses_energy_and_stops_where_predicted():
    speed, travelled, speeds = 25.0, 0.0, [25.0]
    for _ in range(1000):
        step, speed = advance(speed, 0.04, P)
        travelled += step
        speeds.append(speed)
    assert np.all(np.diff(speeds) <= 0.0)
    assert speed == 0.0
    assert np.isclose(travelled, distance_to_stop(25.0, P))
