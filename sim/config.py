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
    # Spontaneous scans per second while the head is free (no scan, partial scan or refractory
    # under way) and no opponent is within 10 m. Measured rates are 40-60% of it.
    scan_rate: float
    temperature: float  # softmax temperature of the decision model


# Scan rates are fitted on possession_play tuning seeds 0-99 by eval/scan_calibration.py: about
# 3 scans in the 10 s before receiving (SPEC 3.4), and per-group means placed by a weighted
# least-squares fit of the effect sizes Jordet et al. (2020) print in Figure 2 — central
# midfielders highest, then central defenders, wingers, side defenders, forwards. The paper has
# one central-midfielder group, so DM, CM and AM share a rate. Goalkeepers are not in its sample.
ROLES = {
    "GK": Role(7.0, 0.15, 0.010),
    "CB": Role(8.0, 0.74, 0.010),
    "FB": Role(9.0, 0.56, 0.010),
    "DM": Role(8.3, 1.19, 0.009),
    "CM": Role(8.5, 1.19, 0.008),
    "AM": Role(8.7, 1.19, 0.009),
    "W": Role(9.5, 0.74, 0.010),
    "ST": Role(9.3, 0.66, 0.010),
}


@dataclass(frozen=True)
class SimParams:
    control_radius: float = 1.0  # m, a free ball this close is controlled
    first_touch_s: float = 0.2  # from control to the decision
    kick_lockout_s: float = 0.25  # the kicker cannot regain the ball this soon
    # Head dynamics: proportional gain with an angular-velocity cap.
    head_gain: float = 25.0  # 1/s
    head_omega_max: float = 12.0  # rad/s (about 690 deg/s), the cap on any head motion
    body_turn_rate: float = 6.0  # rad/s
    # Each scan (and each partial scan) turns at its own peak speed, drawn per scan: Kokubu et al.
    # (2026, Results 3.1) print 404.2 +- 50.7 deg/s for scans they detect at 250 deg/s.
    scan_omega: tuple[float, float] = (np.deg2rad(404.2), np.deg2rad(50.7))  # mean, SD
    scan_omega_min: float = np.deg2rad(250.0)
    # Spontaneous scans: a rapid turn away from the ball, a dwell, and a turn back.
    scan_amplitude: tuple[float, float] = (np.deg2rad(70.0), np.deg2rad(150.0))
    # Dwell: lognormal (median, log SD), capped. Most scans barely pause; a few hold the look.
    # Fitted by eval/scan_calibration.py so that the time the ball is out of an 82 deg head-fixed
    # frame matches Aksum et al. (2021): 90.3% <= 0.66 s, SD 0.28 s, longest 3.28 s.
    scan_dwell_s: tuple[float, float] = (0.019, 1.86)
    scan_dwell_max_s: float = 2.6  # with the turns, at most about the longest scan they timed
    scan_out_tolerance: float = np.deg2rad(5.0)
    scan_return_tolerance: float = np.deg2rad(10.0)
    scan_max_out_s: float = 0.8  # a 150 deg turn at 250 deg/s takes 0.6 s
    scan_refractory_s: float = 0.3
    # Scanning drops under tight pressure (Jordet et al. 2020, Figure 3): the spontaneous scan rate
    # is scaled by the closest opponent's distance, from pressure_scan_factor at the near end of
    # pressure_scan_range (the paper's 0-1 m bin) linearly up to 1 at the far end (its 10+ m bin).
    # Factor: the printed d = 0.57 between those bins times the printed SD of 0.30 scans/s is a
    # drop of 0.17 scans/s, 39% of the printed mean of 0.44 scans/s.
    pressure_scan_range: tuple[float, float] = (1.0, 10.0)  # m
    pressure_scan_factor: float = 0.61
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
