"""Sim parameters (SPEC 3.2, 3.4). Values are tunable starting points, not commitments."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FPS = 25
DT = 1.0 / FPS
HALF_LENGTH = 52.5
HALF_WIDTH = 34.0

A_MAX = 3.5  # m/s^2
D_MAX = 5.0  # m/s^2


@dataclass(frozen=True)
class Role:
    v_max: float  # m/s
    scan_rate: float  # spontaneous scans per second, before context factors
    temperature: float  # softmax temperature of the decision model


# Centre midfielders and centre-backs scan most, forwards least (Jordet et al.).
ROLES = {
    "GK": Role(7.0, 0.15, 0.010),
    "CB": Role(8.0, 0.40, 0.010),
    "FB": Role(9.0, 0.30, 0.010),
    "DM": Role(8.3, 0.42, 0.009),
    "CM": Role(8.5, 0.45, 0.008),
    "AM": Role(8.7, 0.35, 0.009),
    "W": Role(9.5, 0.25, 0.010),
    "ST": Role(9.3, 0.22, 0.010),
}


@dataclass(frozen=True)
class SimParams:
    control_radius: float = 1.0  # m, a free ball this close is controlled
    first_touch_s: float = 0.2  # from control to the decision
    kick_lockout_s: float = 0.25  # the kicker cannot regain the ball this soon
    # Head dynamics: proportional gain with an angular-velocity cap.
    head_gain: float = 25.0  # 1/s
    head_omega_max: float = 12.0  # rad/s (about 690 deg/s)
    body_turn_rate: float = 6.0  # rad/s
    # Spontaneous scans: a rapid turn away from the ball and back.
    scan_amplitude: tuple[float, float] = (np.deg2rad(70.0), np.deg2rad(150.0))
    scan_dwell_s: tuple[float, float] = (0.06, 0.18)
    scan_out_tolerance: float = np.deg2rad(5.0)
    scan_return_tolerance: float = np.deg2rad(10.0)
    scan_max_out_s: float = 0.5
    scan_refractory_s: float = 0.3
    sensor_noise: float = np.deg2rad(2.0)  # on the head yaw written to tracking output
    # Non-scan head motion (SPEC 3.4 nuisance), switched as a whole by head_nuisance. Sensor noise
    # is a property of the tracking, not of the head, and has its own knob above.
    head_nuisance: bool = True
    # Partial (aborted) scans: a turn away from the ball that comes straight back, without a dwell,
    # before the ball leaves the 60 degree binocular half-cone (analytics.vision). Not scans.
    partial_scan_ratio: float = 0.5  # aborted scans per completed spontaneous scan
    partial_scan_amplitude: tuple[float, float] = (np.deg2rad(10.0), np.deg2rad(50.0))
    # Slow drift: the resting gaze wanders around the ball (a mean-reverting offset driven by a
    # smooth, mean-reverting rate), so it never moves faster than a few tens of deg/s.
    drift_sigma: float = np.deg2rad(6.0)  # stationary std of the offset
    drift_tau_s: float = 2.0  # mean reversion of the offset
    drift_rate_tau_s: float = 0.5  # correlation time of the drift rate
    # Perception and belief.
    perception_threshold: float = 0.5  # visibility at which a player counts as seen
    belief_horizon_s: float = 1.0  # beliefs are extrapolated at most this far
    # Off-ball movement.
    formation_shift: tuple[float, float] = (0.2, 0.25)  # fraction of ball displacement
    press_speed: float = 6.0  # m/s, nearest opponent closing down the carrier
    # Run length.
    max_duration_s: float = 12.0
    tail_s: float = 1.0  # keep simulating this long after the hero's pass is resolved
