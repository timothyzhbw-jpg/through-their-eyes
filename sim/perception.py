"""Perception (SPEC 3.4): head dynamics, scans, and each player's belief state.

- Baseline gaze tracks the ball. A scan is a rapid turn away from it, a short dwell, and a turn
  back; scans are ground-truth `scan` events.
- Non-scan head motion (SPEC 3.4 nuisance, `SimParams.head_nuisance`): slow drift of the resting
  gaze around the ball, and partial scans — a turn away that comes straight back, without a dwell,
  before the ball leaves the binocular cone. Partial scans are `scan` events with
  `attrs["partial"] = True` and do not count as scans: the player never took his eyes off the
  ball. Anything that counts scans (metrics, detector ground truth) filters them out. The
  scenario's forced scans are never partial and never blocked by nuisance.
- What a player sees comes from `analytics.vision.player_visibility` on his true head yaw.
- Belief (mental map): for every other player, the position and velocity at the last sighting and
  when it was. The belief is that sighting extrapolated, at most `horizon_s` ahead.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from analytics.vision import wrap_angle
from sim.config import SimParams


class BeliefStore:
    def __init__(self, n: int, frame: int, pos: np.ndarray, vel: np.ndarray) -> None:
        self.pos = np.broadcast_to(np.asarray(pos, dtype=float), (n, n, 2)).copy()
        self.vel = np.broadcast_to(np.asarray(vel, dtype=float), (n, n, 2)).copy()
        self.frame = np.full((n, n), frame, dtype=np.int64)

    def update(self, seen: np.ndarray, frame: int, pos: np.ndarray, vel: np.ndarray) -> None:
        """seen[i, j]: observer i saw player j this frame."""
        n = self.frame.shape[0]
        self.pos[seen] = np.broadcast_to(np.asarray(pos, dtype=float), (n, n, 2))[seen]
        self.vel[seen] = np.broadcast_to(np.asarray(vel, dtype=float), (n, n, 2))[seen]
        self.frame[seen] = frame

    def estimate(
        self, observer: int, frame: int, dt: float, horizon_s: float
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Believed positions, velocities and ages (s) of every player for one observer."""
        age = (frame - self.frame[observer]) * dt
        pos = self.pos[observer] + self.vel[observer] * np.minimum(age, horizon_s)[:, None]
        return pos, self.vel[observer].copy(), age


@dataclass
class ForcedScan:
    """A scan the scenario requires, e.g. the key scan of a hero moment."""

    target_yaw: float
    dwell_s: float
    key: bool = False


@dataclass
class ActiveScan:
    start: int
    target: float
    amplitude: float
    dwell_frames: int
    out_deadline: int
    key: bool
    phase: str = "out"
    dwell_until: int = 0
    partial: bool = False


@dataclass
class FinishedScan:
    player: int
    scan: ActiveScan
    end: int


def scan_id(player_id: str, frame: int) -> str:
    return f"scan:{player_id}:{frame:04d}"


class HeadModel:
    def __init__(self, n: int) -> None:
        self.active: list[ActiveScan | None] = [None] * n
        self.refractory_until = np.zeros(n, dtype=np.int64)
        self.after_partial = np.zeros(n, dtype=bool)  # the refractory follows a partial scan
        self.drift = np.zeros(n)  # rad, offset of the resting gaze from the ball
        self.drift_rate = np.zeros(n)  # rad/s

    def step(
        self,
        frame: int,
        head: np.ndarray,
        base: np.ndarray,
        spontaneous: np.ndarray,
        draws: np.ndarray,
        forced: dict[int, ForcedScan],
        dropped: set[str],
        ids: list[str],
        params: SimParams,
        dt: float,
        partial: np.ndarray | None = None,
        partial_draws: np.ndarray | None = None,
        drift_noise: np.ndarray | None = None,
    ) -> tuple[np.ndarray, list[FinishedScan]]:
        """Advance every head by one frame.

        base: gaze direction without a scan (toward the ball); spontaneous[i]: a spontaneous scan
        may start now; draws: (N, 3) uniforms for side, amplitude and dwell. Head nuisance, used
        only when params.head_nuisance is on: partial[i]: a partial scan may start now (it takes
        its side from draws), partial_draws: (N,) uniforms for its amplitude, drift_noise: (N,)
        standard normals that drive the drift.
        """
        if params.head_nuisance and drift_noise is not None:
            base = np.asarray(base, dtype=float) + self._advance_drift(drift_noise, params, dt)
        nuisance = params.head_nuisance and partial is not None and partial_draws is not None
        target = np.array(base, dtype=float)
        finished: list[FinishedScan] = []
        lo_amp, hi_amp = params.scan_amplitude
        lo_dwell, hi_dwell = params.scan_dwell_s
        lo_partial, hi_partial = params.partial_scan_amplitude
        for i in range(len(head)):
            sid = scan_id(ids[i], frame)
            if i in forced and sid not in dropped and self._free_for_forced(i, frame):
                if self.active[i] is not None:  # a partial scan gives way to a forced one
                    finished.append(FinishedScan(i, self.active[i], frame))
                f = forced[i]
                self._start(i, frame, f.target_yaw, base[i], f.dwell_s, f.key, params, dt)
            elif (
                self.active[i] is None
                and frame >= self.refractory_until[i]
                and i not in forced
                and sid not in dropped
            ):
                side = 1.0 if draws[i, 0] < 0.5 else -1.0
                if spontaneous[i]:
                    amplitude = lo_amp + (hi_amp - lo_amp) * draws[i, 1]
                    dwell = lo_dwell + (hi_dwell - lo_dwell) * draws[i, 2]
                    yaw = base[i] + side * amplitude
                    self._start(i, frame, yaw, base[i], dwell, False, params, dt)
                elif nuisance and partial[i]:
                    amplitude = lo_partial + (hi_partial - lo_partial) * partial_draws[i]
                    yaw = base[i] + side * amplitude
                    self._start(i, frame, yaw, base[i], 0.0, False, params, dt, partial=True)
            scan = self.active[i]
            if scan is None:
                continue
            if scan.phase == "out":
                reached = abs(wrap_angle(head[i] - scan.target)) < params.scan_out_tolerance
                if scan.partial and frame == scan.start:
                    reached = False  # a partial scan moves the head at least once
                if reached or frame >= scan.out_deadline:
                    scan.phase, scan.dwell_until = "dwell", frame + scan.dwell_frames
            if scan.phase == "dwell" and frame >= scan.dwell_until:
                scan.phase = "back"
            if scan.phase == "back":
                if abs(wrap_angle(head[i] - base[i])) < params.scan_return_tolerance:
                    finished.append(FinishedScan(i, scan, frame))
                    self.active[i] = None
                    self.refractory_until[i] = frame + round(params.scan_refractory_s / dt)
                    self.after_partial[i] = scan.partial
                    continue
            else:
                target[i] = scan.target
        error = wrap_angle(target - head)
        omega = np.clip(params.head_gain * error, -params.head_omega_max, params.head_omega_max)
        return wrap_angle(head + omega * dt), finished

    def _free_for_forced(self, i: int, frame: int) -> bool:
        """A forced scan waits for a scan in progress and its refractory, unless it was partial."""
        scan = self.active[i]
        if scan is not None:
            return scan.partial
        return bool(frame >= self.refractory_until[i] or self.after_partial[i])

    def _advance_drift(self, noise: np.ndarray, params: SimParams, dt: float) -> np.ndarray:
        """d' = -d / tau_d + r, with r an Ornstein-Uhlenbeck rate; std(d) = drift_sigma."""
        tau_d, tau_r = params.drift_tau_s, params.drift_rate_tau_s
        rate_sigma = params.drift_sigma * np.sqrt((tau_d + tau_r) / tau_r) / tau_d
        a_r = np.exp(-dt / tau_r)
        self.drift_rate = a_r * self.drift_rate + rate_sigma * np.sqrt(1.0 - a_r**2) * noise
        self.drift = np.exp(-dt / tau_d) * self.drift + self.drift_rate * dt
        return self.drift

    def _start(
        self,
        i: int,
        frame: int,
        yaw: float,
        base: float,
        dwell_s: float,
        key: bool,
        params: SimParams,
        dt: float,
        partial: bool = False,
    ) -> None:
        self.active[i] = ActiveScan(
            start=frame,
            target=float(wrap_angle(yaw)),
            amplitude=float(abs(wrap_angle(yaw - base))),
            dwell_frames=0 if partial else max(1, round(dwell_s / dt)),
            out_deadline=frame + round(params.scan_max_out_s / dt),
            key=key,
            partial=partial,
        )
