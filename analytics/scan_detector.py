"""Scan detector (SPEC 4.7): find scans in tracking data, without any sim-internal state.

Input per player: the head-yaw time series and the player's and the ball's positions (for the
ball direction). A scan is an excursion of the head away from the ball direction and back:
1. Onset: the head turns faster than `omega_threshold` (world-frame angular velocity) and the
   turn takes it further from the ball direction.
2. The excursion is measured from the head's offset just before the onset, so slow drift of the
   resting gaze neither adds to nor subtracts from it. It must leave that offset by more than
   `return_tolerance` within `onset_frames` frames of the onset.
3. It ends when the head is back within `return_tolerance` of that offset. An excursion that
   does not come back within `max_duration_s` is a re-orientation, not a scan.
4. Its peak must reach `min_excursion`: a part-way turn that comes straight back keeps the ball
   in view and is not a scan.
The defaults are the values chosen by `eval/scan_detector.py` on tuning seeds; see
eval/reports/scan_detector.md.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from analytics.vision import wrap_angle


@dataclass(frozen=True)
class ScanDetectorParams:
    # Chosen on tuning seeds by eval/scan_detector.py (F1 is flat across 125-275 deg/s there).
    omega_threshold: float = np.deg2rad(200.0)  # rad/s, head angular velocity at the onset
    min_excursion: float = np.deg2rad(55.0)  # rad, peak turn away from the pre-onset offset
    return_tolerance: float = np.deg2rad(15.0)  # rad
    onset_frames: int = 2  # the excursion must pass return_tolerance this soon after the onset
    # Aksum et al. (2021) time scans with the ball out of frame for up to 3.28 s; add the turns.
    max_duration_s: float = 4.0


DEFAULT_PARAMS = ScanDetectorParams()


@dataclass(frozen=True)
class DetectedScan:
    start: int  # onset frame: the head starts to turn between start and start + 1
    end: int  # first frame back near the pre-onset offset
    peak: int  # frame of the largest excursion
    amplitude: float  # rad, the largest excursion
    direction: float  # rad, world head yaw at the peak
    side: int  # +1 counter-clockwise (to the player's left of the ball), -1 clockwise


def ball_offset(head_yaw: np.ndarray, player_pos: np.ndarray, ball_pos: np.ndarray) -> np.ndarray:
    """Signed angle from the ball direction to the head direction, in [-pi, pi)."""
    to_ball = np.asarray(ball_pos, dtype=float)[..., :2] - np.asarray(player_pos, dtype=float)
    return wrap_angle(np.asarray(head_yaw) - np.arctan2(to_ball[..., 1], to_ball[..., 0]))


def detect_scans(
    head_yaw: np.ndarray,
    player_pos: np.ndarray,
    ball_pos: np.ndarray,
    dt: float,
    params: ScanDetectorParams = DEFAULT_PARAMS,
) -> list[DetectedScan]:
    """Scans of one player. head_yaw (F,) rad, player_pos (F, 2) m, ball_pos (F, 2 or 3) m."""
    yaw = np.asarray(head_yaw, dtype=float)
    offset = ball_offset(yaw, player_pos, ball_pos)
    omega = wrap_angle(np.diff(yaw)) / dt  # [t]: from frame t to t + 1
    away = np.abs(offset[1:]) > np.abs(offset[:-1])
    onsets = np.flatnonzero((np.abs(omega) >= params.omega_threshold) & away)
    horizon = round(params.max_duration_s / dt)
    scans: list[DetectedScan] = []
    free_from = 0
    for s in onsets:
        if s < free_from:
            continue
        side = 1 if wrap_angle(offset[s + 1] - offset[s]) > 0 else -1
        excursion = side * wrap_angle(offset[s + 1 : s + 1 + horizon] - offset[s])
        out = np.flatnonzero(excursion[: params.onset_frames] > params.return_tolerance)
        if out.size == 0:
            continue
        back = np.flatnonzero(excursion[out[0] :] <= params.return_tolerance)
        if back.size == 0:
            continue
        k_end = out[0] + back[0]
        k_peak = out[0] + int(np.argmax(excursion[out[0] : k_end]))
        if excursion[k_peak] < params.min_excursion:
            continue
        end = s + 1 + k_end
        scans.append(
            DetectedScan(
                start=int(s),
                end=int(end),
                peak=int(s + 1 + k_peak),
                amplitude=float(excursion[k_peak]),
                direction=float(yaw[s + 1 + k_peak]),
                side=side,
            )
        )
        free_from = end
    return scans


def detect_all(
    head_yaw: np.ndarray,
    player_pos: np.ndarray,
    ball_pos: np.ndarray,
    dt: float,
    params: ScanDetectorParams = DEFAULT_PARAMS,
) -> list[list[DetectedScan]]:
    """Scans of every player. head_yaw (F, N), player_pos (F, N, 2), ball_pos (F, 2 or 3)."""
    ball = np.asarray(ball_pos, dtype=float)[:, :2]
    return [
        detect_scans(head_yaw[:, i], player_pos[:, i], ball, dt, params)
        for i in range(np.shape(head_yaw)[1])
    ]
