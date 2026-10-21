"""Pass metrics and speeds (SPEC 4.6).

Causal: a value at frame f uses frames <= f only. Speed is smoothed over the last 0.2 s and never
crosses a tracking segment (a stitched match's possessions). High-speed running and sprint entry
speeds are the most common ones for men in Gualtieri, Rampinini, Dello Iacono & Beato (2023),
Front. Sports Act. Living 5:1116293. Lane risk follows Spearman, Basye, Dick, Hotovy & Pop (2017),
MIT Sloan Sports Analytics Conference, "Physics-Based Modeling of Pass Probabilities in Soccer",
as the decision model's chance of winning the ball. The passer and receiver terms are pressing
intensity (Bekkers 2025).
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from analytics.pitch_control import logistic
from analytics.pressing import intercept_probability
from analytics.tti import REACTION_S as REACTION_S
from analytics.tti import V_MAX as V_MAX
from analytics.tti import time_to_intercept

SMOOTH_FRAMES = 5  # 0.2 s at 25 Hz
RELEASE_FRAMES = 5  # release speed over the first 0.2 s
HSR_MPS = 5.5  # 19.8 km/h
SPRINT_MPS = 7.0  # 25.2 km/h
SPRINT_MIN_FRAMES = 10  # 0.4 s, as the sprint moment (explain/moments.py MIN_SPRINT_S)
DISTANCE_STEP_M = 250.0
LANE_SIGMA_S = 0.45
RUN_IN_SPREAD_M = 0.3  # a fresh sighting's position spread, as sim/decision.py uncertainty0
CONTROL_RADIUS_M = 1.0  # as SimParams.control_radius
FRAME_HZ = 25  # SMOOTH_FRAMES and RELEASE_FRAMES are 0.2 s at this rate
DIFFICULTY_WEIGHTS = {"lane": 0.4, "passer": 0.2, "receiver": 0.2, "distance": 0.2}
DISTANCE_SCALE_M = 50.0
BANDS = ((0.25, "routine"), (0.5, "moderate"), (0.75, "hard"))  # else "very hard"
SOURCES = (
    "Gualtieri, Rampinini, Dello Iacono & Beato (2023), Front. Sports Act. Living 5:1116293",
    "Spearman, Basye, Dick, Hotovy & Pop (2017), MIT Sloan SAC, "
    "Physics-Based Modeling of Pass Probabilities in Soccer",
    "Bekkers (2025), Pressing Intensity, arXiv:2501.04712",
)


def segment_starts(frames: int, breaks: Sequence[int]) -> np.ndarray:
    """(F,) first frame of the segment containing each frame. Frame 0 always starts one."""
    seg = np.zeros(frames, dtype=np.int64)
    bounds = [0]
    for raw in breaks:
        b = int(raw)
        if 0 < b < frames:
            bounds.append(b)
    bounds = sorted(set(bounds))
    for i, start in enumerate(bounds):
        stop = bounds[i + 1] if i + 1 < len(bounds) else frames
        seg[start:stop] = start
    return seg


def smoothed_velocity(
    track: np.ndarray, dt: float, breaks: Sequence[int] = (), window: int = SMOOTH_FRAMES
) -> np.ndarray:
    """Velocity over the last `window` frames of the same segment; 0 on a segment's first frame.

    `track` is (F, ..., 2). k = min(window, f - segment_start[f]);
    v[f] = (track[f] - track[f - k]) / (k * dt) when k > 0.
    """
    track = np.asarray(track, dtype=float)
    frames = track.shape[0]
    index = np.arange(frames)
    k = np.minimum(window, index - segment_starts(frames, breaks))
    delta = track - track[index - k]
    denom = (np.maximum(k, 1) * dt).reshape((-1,) + (1,) * (track.ndim - 1))
    return delta / denom


def smoothed_speed(
    track: np.ndarray, dt: float, breaks: Sequence[int] = (), window: int = SMOOTH_FRAMES
) -> np.ndarray:
    """Speed (m/s), the norm of `smoothed_velocity` over the last axis."""
    return np.linalg.norm(smoothed_velocity(track, dt, breaks, window), axis=-1)


def cumulative_distance(
    track: np.ndarray, breaks: Sequence[int] = (), mask: np.ndarray | None = None
) -> np.ndarray:
    """(F, N) metres covered. The step into a segment start is 0; row 0 is 0.

    With a (F, N) mask, a step counts only when the mask is true on the frame it ends on.
    """
    track = np.asarray(track, dtype=float)
    frames = track.shape[0]
    step = np.zeros(track.shape[:2], dtype=float)
    if frames > 1:
        step[1:] = np.linalg.norm(track[1:] - track[:-1], axis=-1)
    seg = segment_starts(frames, breaks)
    step[np.arange(frames) == seg] = 0.0
    if mask is not None:
        step *= np.asarray(mask, dtype=float)
    return np.cumsum(step, axis=0)


def runs_above(
    values: np.ndarray, threshold: float, min_frames: int, breaks: Sequence[int] = ()
) -> list[tuple[int, int]]:
    """Maximal runs of frames with values > threshold, split at segment starts.

    A run is kept when its length is at least `min_frames`. Ends are exclusive.
    """
    values = np.asarray(values, dtype=float)
    frames = len(values)
    seg = segment_starts(frames, breaks)
    above = values > threshold
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for f in range(frames):
        if start is not None and int(seg[f]) == f:
            if f - start >= min_frames:
                runs.append((start, f))
            start = None
        if above[f]:
            if start is None:
                start = f
        elif start is not None:
            if f - start >= min_frames:
                runs.append((start, f))
            start = None
    if start is not None and frames - start >= min_frames:
        runs.append((start, frames))
    return runs


def milestones(cum: np.ndarray, step: float) -> list[tuple[int, int]]:
    """(frame, k * step) for each k whose cumulative value is first reached at that frame."""
    cum = np.asarray(cum, dtype=float)
    if cum.size == 0 or not step or cum[-1] < step:
        return []
    out: list[tuple[int, int]] = []
    k = 1
    while k * step <= cum[-1]:
        target = k * step
        out.append((int(np.searchsorted(cum, target, side="left")), int(target)))
        k += 1
    return out


def release_frame(kick: int, end: int) -> int:
    """The frame of the release window: five frames after the kick, or the resolution."""
    return kick + max(1, min(RELEASE_FRAMES, end - kick))


def release_speed(ball: np.ndarray, kick: int, end: int, dt: float) -> float:
    """Mean ball speed (m/s) from the kick to `release_frame`."""
    r = release_frame(kick, end)
    return float(np.linalg.norm(ball[r] - ball[kick]) / ((r - kick) * dt))


def run_in_miss(
    pos: np.ndarray,
    vel: np.ndarray,
    times: np.ndarray,
    path: np.ndarray,
    reaction: float = REACTION_S,
) -> np.ndarray:
    """Closest approach (m) of each player to the ball while he has not reacted yet.

    He keeps his velocity (pos + vel * t); the ball is at `path` ((K, 2)) at `times` ((K,),
    ascending, from 0) and moves linearly in between. Only t <= reaction counts. inf when the
    path starts after the reaction time.
    """
    pos = np.asarray(pos, dtype=float)
    vel = np.asarray(vel, dtype=float)
    times = np.asarray(times, dtype=float)
    path = np.asarray(path, dtype=float)
    k = int(np.searchsorted(times, reaction, side="right"))
    if k == 0:
        return np.full(len(pos), np.inf)
    t, b = times[:k], path[:k]
    if k < len(times) and t[-1] < reaction:  # close the window at the reaction time
        frac = (reaction - t[-1]) / (times[k] - t[-1])
        t = np.append(t, reaction)
        b = np.vstack([b, path[k - 1] + frac * (path[k] - path[k - 1])])
    gap = b[None, :, :] - (pos[:, None, :] + vel[:, None, :] * t[None, :, None])
    if len(t) == 1:
        return np.linalg.norm(gap[:, 0], axis=-1)
    start, step = gap[:, :-1], np.diff(gap, axis=1)
    s = -np.einsum("nkd,nkd->nk", start, step) / np.maximum(
        np.einsum("nkd,nkd->nk", step, step), 1e-12
    )
    closest = start + np.clip(s, 0.0, 1.0)[..., None] * step
    return np.linalg.norm(closest, axis=-1).min(axis=1)


def lane_risk(
    pos: np.ndarray,
    vel: np.ndarray,
    path: np.ndarray,
    times: np.ndarray,
    *,
    per_opponent: bool = False,
) -> float | tuple[float, np.ndarray]:
    """Interception risk along the ball's path: 1 - prod(1 - p) over opponents.

    Per opponent, the larger of two chances: he reaches a point of the path before the ball
    (time to intercept), or the ball comes within the control radius of his run before he reacts.
    No opponents: 0. With `per_opponent`, also return each opponent's p.
    """
    pos = np.asarray(pos, dtype=float).reshape(-1, 2)
    if len(pos) == 0:
        empty = np.zeros(0)
        return (0.0, empty) if per_opponent else 0.0
    vel = np.asarray(vel, dtype=float).reshape(-1, 2)
    path = np.asarray(path, dtype=float)
    times = np.asarray(times, dtype=float)
    tti = time_to_intercept(pos, vel, path)
    p_tti = intercept_probability(tti, threshold=times[None, :], sigma=LANE_SIGMA_S).max(axis=1)
    miss = run_in_miss(pos, vel, times, path)
    scale = np.pi / (np.sqrt(3.0) * RUN_IN_SPREAD_M)
    p_run = logistic(scale * (CONTROL_RADIUS_M - miss))
    p = np.maximum(p_tti, p_run)
    risk = float(1.0 - np.prod(1.0 - p))
    return (risk, p) if per_opponent else risk


def pass_difficulty(
    lane: float, passer: float, receiver: float, distance_m: float
) -> tuple[float, dict[str, float]]:
    """Weighted difficulty in [0, 1] and its four parts. Distance saturates at 50 m."""
    parts = {
        "lane": float(lane),
        "passer": float(passer),
        "receiver": float(receiver),
        "distance": float(min(distance_m / DISTANCE_SCALE_M, 1.0)),
    }
    value = float(sum(DIFFICULTY_WEIGHTS[k] * parts[k] for k in DIFFICULTY_WEIGHTS))
    return value, parts


def difficulty_band(x: float) -> str:
    """Viewer band: below 0.25 routine, 0.5 moderate, 0.75 hard, otherwise very hard."""
    for limit, name in BANDS:
        if x < limit:
            return name
    return "very hard"
