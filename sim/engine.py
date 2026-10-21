"""Frame loop of the synthetic match engine (SPEC 3).

Each step from frame f to f + 1:
  1. perception at f: who sees whom, belief update;
  2. scripted actions and due decisions (on belief);
  3. heads and scans;
  4. player movement;
  5. ball: attached to its owner (an opponent may tackle it, in scenarios with tackles), or
     rolling; control and out-of-play checks at f + 1;
  6. record frame f + 1.
`snapshot()` / `resume(snapshot, overrides)` re-simulate from any frame (SPEC 3.7).
"""

from __future__ import annotations

import copy
from typing import TYPE_CHECKING

import numpy as np

from analytics.tti import time_to_intercept
from analytics.vision import player_visibility, wrap_angle
from sim.ball import BallParams, advance, path_distances
from sim.config import DT, HALF_LENGTH, HALF_WIDTH, SimParams
from sim.decision import (
    DecisionContext,
    DecisionParams,
    choose,
    evaluate_options,
    gumbel,
    pass_speed,
)
from sim.model import Decision, Event
from sim.movement import steer, turn_toward
from sim.perception import BeliefStore, FinishedScan, HeadModel, head_turn_id, scan_id
from sim.rng import KeyedRng
from sim.run import MatchRun

if TYPE_CHECKING:
    from sim.scenarios.base import Scenario

DRIBBLE_OFFSET = 0.3  # m, ball ahead of the carrier
PREDICTION_FRAMES = 100  # free-ball path prediction horizon (4 s)
RECEIVER_EXTRAPOLATION_S = 1.5  # how far a receiver's run is projected when a pass is played


class Simulation:
    def __init__(
        self,
        scenario: Scenario,
        seed: int,
        params: SimParams = SimParams(),
        record_draws: bool = False,
    ) -> None:
        self.scenario = scenario
        self.seed = seed
        self.params = params
        self.decision_params = DecisionParams()
        self.ball_params = BallParams()
        self.rng = KeyedRng(seed, record=record_draws)
        setup = scenario.setup(self.rng.generator("scenario", 0))
        self.players = setup.players
        self.ids = [p.id for p in self.players]
        self.team = np.array([p.team for p in self.players])
        self.v_max = np.array([p.v_max for p in self.players])
        self.a_max = np.array([p.a_max for p in self.players])
        self.d_max = np.array([p.d_max for p in self.players])
        self.scan_rate = np.array([p.scan_rate for p in self.players])
        n = len(self.players)

        self.frame = 0
        self.pos = np.array(setup.pos, dtype=float)
        self.vel = np.zeros((n, 2))
        self.owner = setup.ball_owner
        carrier = self.pos[self.owner]
        self.ball_pos = np.array([*carrier, self.ball_params.radius])
        self.ball_vel = np.zeros(3)
        to_ball = self.ball_pos[:2] - self.pos
        self.body_yaw = np.arctan2(to_ball[:, 1], to_ball[:, 0])
        self.body_yaw[self.owner] = 0.0 if self.team[self.owner] == 0 else np.pi
        self.head_yaw = self.body_yaw.copy()
        self._attach_ball()
        self.anchor = self.pos.copy()
        self.ball_anchor = self.ball_pos[:2].copy()

        self.beliefs = BeliefStore(n, 0, self.pos, self.vel)
        self.head = HeadModel(n)
        self.dropped_scans: set[str] = set()
        self.frozen_belief: dict[int, int] = {}
        self.forced_actions: dict[tuple[int, int], str] = {}  # (player, frame) -> action
        self.events: list[Event] = []
        self.decisions: list[Decision] = []
        self.pending_decision: tuple[int, int] | None = None
        self.pass_in_flight: dict | None = None
        self.carry: dict[int, tuple[np.ndarray, int]] = {}
        self.tackle_lockout: dict[int, int] = {}  # player -> first frame he may tackle again
        self.last_kicker = -1
        self.kick_frame = -(10**9)
        self.hero_acted = False
        self.hero_resolved_frame: int | None = None
        self.done = False
        if scenario.decides(self, self.owner):  # e.g. open play: the first carrier decides too
            self.pending_decision = (self.owner, round(params.first_touch_s / DT))
        self.history: dict[str, list[np.ndarray]] = {
            k: []
            for k in ("pos", "vel", "body", "head", "head_obs", "ball_pos", "ball_vel", "owner")
        }
        self._record()

    # --- public API ----------------------------------------------------------------------

    @classmethod
    def from_scenario(
        cls, name: str, seed: int, record_draws: bool = False, params: SimParams = SimParams()
    ) -> Simulation:
        from sim.scenarios import SCENARIOS

        return cls(SCENARIOS[name](), seed, params, record_draws)

    @classmethod
    def resume(cls, snapshot: Simulation, overrides=()) -> Simulation:
        sim = copy.deepcopy(snapshot)
        for override in overrides:
            override.apply(sim)
        return sim

    def snapshot(self) -> Simulation:
        return copy.deepcopy(self)

    @property
    def max_frames(self) -> int:
        return round(self.params.max_duration_s / DT)

    def index(self, player_id: str) -> int:
        return self.ids.index(player_id)

    def run_until(self, frame: int) -> None:
        while not self.done and self.frame < frame:
            self.step()

    def run(self) -> MatchRun:
        self.run_until(self.max_frames)
        return self.result()

    def result(self) -> MatchRun:
        h = {k: np.array(v) for k, v in self.history.items()}
        return MatchRun(
            scenario=self.scenario.name,
            seed=self.seed,
            dt=DT,
            players=list(self.players),
            hero=self.scenario.hero,
            pos=h["pos"],
            vel=h["vel"],
            body_yaw=h["body"],
            head_yaw=h["head"],
            head_yaw_observed=h["head_obs"],
            ball_pos=h["ball_pos"],
            ball_vel=h["ball_vel"],
            owner=h["owner"].astype(np.int64),
            events=copy.deepcopy(self.events),
            decisions=copy.deepcopy(self.decisions),
            draws=None if self.rng.recorded is None else dict(self.rng.recorded),
        )

    # --- frame loop ----------------------------------------------------------------------

    def step(self) -> None:
        f, p = self.frame, self.params
        n = len(self.ids)
        speed = np.linalg.norm(self.vel, axis=-1)

        # 1. Perception at frame f.
        seen = player_visibility(self.pos, self.head_yaw, speed) >= p.perception_threshold
        for i, at in self.frozen_belief.items():
            if f >= at:
                seen[i, :] = False
        self.beliefs.update(seen, f, self.pos, self.vel)

        # 2. Scripted actions, then decisions that are due.
        forced = self.scenario.forced_pass(self, f)
        if forced is not None and self.owner == self.index(forced.passer):
            target = forced.target if forced.target is not None else self.pos[self.index(forced.to)]
            self._kick_pass(self.index(forced.passer), np.asarray(target), self.index(forced.to), f)
        if self.pending_decision is not None and self.pending_decision[1] == f:
            i = self.pending_decision[0]
            self.pending_decision = None
            if self.owner == i:
                self._decide(i, f)

        # 3. Heads and scans.
        to_ball = self.ball_pos[:2] - self.pos
        ball_dir = np.arctan2(to_ball[:, 1], to_ball[:, 0])
        base = ball_dir.copy()
        if self.owner >= 0:
            base[self.owner] = self.body_yaw[self.owner]
        trigger = self.rng.uniform("scan_trigger", f, n, entities=self.ids)
        draws = self.rng.uniform("scan_params", f, n, (3,), entities=self.ids)
        # Head nuisance draws are made every frame, whether or not the nuisance is switched on.
        partial_draws = self.rng.uniform("partial_scan", f, n, entities=self.ids)
        drift_noise = self.rng.normal("head_drift", f, n, entities=self.ids)
        speed_noise = self.rng.normal("scan_speed", f, n, entities=self.ids)
        allowed = ~self.scenario.scan_suppressed(self, f)
        p_scan = self.scan_rate * self._pressure_factor() * DT
        spontaneous = allowed & (trigger < p_scan)
        # The same trigger draw: just above the scan probability, a scan starts and is aborted.
        partial = allowed & ~spontaneous & (trigger < p_scan * (1 + p.partial_scan_ratio))
        self.head_yaw, finished = self.head.step(
            f,
            self.head_yaw,
            base,
            spontaneous,
            draws,
            self.scenario.forced_scans(self, f),
            self.dropped_scans,
            self.ids,
            p,
            DT,
            partial=partial,
            partial_draws=partial_draws,
            drift_noise=drift_noise,
            speed_noise=speed_noise,
        )
        for scan in finished:
            self._emit_scan(scan)

        # 4. Movement.
        target, cap = self._movement_targets(f)
        self.pos, self.vel = steer(
            self.pos, self.vel, target, np.minimum(cap, self.v_max), self.a_max, self.d_max, DT
        )
        moving = np.linalg.norm(self.vel, axis=-1) > 1.0
        body_target = np.where(moving, np.arctan2(self.vel[:, 1], self.vel[:, 0]), ball_dir)
        self.body_yaw = wrap_angle(turn_toward(self.body_yaw, body_target, p.body_turn_rate * DT))

        # 5. Ball.
        self.frame = f + 1
        if self.owner >= 0:
            self._attach_ball()
            if self.scenario.tackles:
                self._check_tackle()
        else:
            self._roll_ball()
            if not self._check_out():
                self._check_control()

        # 6. Record and stop conditions.
        self._record()
        tail = round(p.tail_s / DT)
        if self.frame >= self.max_frames or (
            self.hero_resolved_frame is not None and self.frame >= self.hero_resolved_frame + tail
        ):
            self.done = True

    # --- pieces --------------------------------------------------------------------------

    def _record(self) -> None:
        noise = self.rng.normal("sensor_noise", self.frame, len(self.ids), entities=self.ids)
        h = self.history
        h["pos"].append(self.pos.copy())
        h["vel"].append(self.vel.copy())
        h["body"].append(self.body_yaw.copy())
        h["head"].append(self.head_yaw.copy())
        h["head_obs"].append(wrap_angle(self.head_yaw + noise * self.params.sensor_noise))
        h["ball_pos"].append(self.ball_pos.copy())
        h["ball_vel"].append(self.ball_vel.copy())
        h["owner"].append(np.array(self.owner))

    def _pressure_factor(self) -> np.ndarray:
        """Scan-rate factor per player from the closest opponent's distance (SPEC 3.4)."""
        p = self.params
        gap = np.linalg.norm(self.pos[:, None, :] - self.pos[None, :, :], axis=-1)
        closest = np.where(self.team[:, None] != self.team[None, :], gap, np.inf).min(axis=1)
        near, far = p.pressure_scan_range
        ramp = np.clip((closest - near) / (far - near), 0.0, 1.0)
        return p.pressure_scan_factor + (1.0 - p.pressure_scan_factor) * ramp

    def _attach_ball(self) -> None:
        i = self.owner
        yaw = self.body_yaw[i]
        self.ball_pos = np.array(
            [*(self.pos[i] + DRIBBLE_OFFSET * np.array([np.cos(yaw), np.sin(yaw)])),
             self.ball_params.radius]
        )  # fmt: skip
        self.ball_vel = np.array([*self.vel[i], 0.0])

    def _roll_ball(self) -> None:
        v = self.ball_vel[:2]
        speed = float(np.linalg.norm(v))
        if speed == 0.0:
            return
        direction = v / speed
        dist, new_speed = advance(speed, DT, self.ball_params)
        self.ball_pos[:2] += direction * dist
        self.ball_vel[:2] = direction * new_speed

    def _predicted_path(self) -> tuple[np.ndarray, np.ndarray]:
        times = DT * np.arange(1, PREDICTION_FRAMES + 1)
        v = self.ball_vel[:2]
        speed = float(np.linalg.norm(v))
        direction = v / speed if speed > 0 else np.zeros(2)
        path = (
            self.ball_pos[:2] + path_distances(speed, times, self.ball_params)[:, None] * direction
        )
        return times, path

    def formation_spots(self) -> np.ndarray:
        """(N, 2) formation anchors shifted with the ball (SPEC 3.2)."""
        shift = (self.ball_pos[:2] - self.ball_anchor) * np.array(self.params.formation_shift)
        return self.anchor + shift

    def _movement_targets(self, f: int) -> tuple[np.ndarray, np.ndarray]:
        p = self.params
        target = self.formation_spots()
        cap = self.v_max.copy()

        if self.owner >= 0:
            i = self.owner
            target[i] = self.pos[i]
            opponents = np.flatnonzero(self.team != self.team[i])
            dist = np.linalg.norm(self.pos[opponents] - self.pos[i], axis=-1)
            presser = opponents[np.argmin(dist)]
            target[presser], cap[presser] = self.pos[i], p.press_speed
            if i in self.carry and f < self.carry[i][1]:
                target[i] = self.carry[i][0]

        for i, (t, c) in self.scenario.scripted_targets(self, f).items():
            target[i], cap[i] = t, c

        if self.owner < 0 and self.pass_in_flight is not None:
            times, path = self._predicted_path()
            margin = time_to_intercept(self.pos, self.vel, path) - times[None, :]
            passer_team = self.team[self.pass_in_flight["passer"]]
            defenders = np.flatnonzero(self.team != passer_team)
            best = defenders[np.argmin(margin[defenders].min(axis=1))]
            feasible = np.flatnonzero(margin[best] <= 0.0)
            if feasible.size:
                target[best], cap[best] = path[feasible[0]], self.v_max[best]
            r = self.pass_in_flight["intended"]
            target[r], cap[r] = self.pass_in_flight["meet"], self.v_max[r]
        return target, cap

    def _kick_pass(self, i: int, target: np.ndarray, intended: int, f: int) -> None:
        ball = self.ball_pos[:2].copy()
        dist = float(np.linalg.norm(target - ball))
        v0 = pass_speed(dist, self.decision_params, self.ball_params)
        direction = (target - ball) / dist
        self.ball_vel = np.array([*(direction * v0), 0.0])
        self.owner, self.last_kicker, self.kick_frame = -1, i, f
        # The receiver heads for the point where the ball's line comes closest to his run,
        # fixed when the pass is played (no feedback from his own later movement).
        times, path = self._predicted_path()
        run = (
            self.pos[intended]
            + self.vel[intended] * np.minimum(times, RECEIVER_EXTRAPOLATION_S)[:, None]
        )
        meet = path[np.argmin(np.linalg.norm(path - run, axis=-1))]
        event = Event(
            id=f"pass:{self.ids[i]}:{f:04d}",
            type="pass",
            frame=f,
            t=f * DT,
            player=self.ids[i],
            team=int(self.team[i]),
            attrs={
                "to": self.ids[intended],
                "start": [float(ball[0]), float(ball[1])],
                "target": [float(target[0]), float(target[1])],
                "speed": v0,
                "distance": dist,
                "outcome": None,
                "end": None,
            },
        )
        self.events.append(event)
        self.pass_in_flight = {
            "event": event,
            "passer": i,
            "intended": intended,
            "target": np.asarray(target, dtype=float),
            "meet": meet,
            "hero": self.scenario.ends_on_pass(self, i),
        }

    def _decide(self, i: int, f: int) -> None:
        pos, vel, age = self.beliefs.estimate(i, f, DT, self.params.belief_horizon_s)
        pos[i], vel[i], age[i] = self.pos[i], self.vel[i], 0.0
        ctx = DecisionContext(
            carrier=i,
            team=self.team,
            pos=pos,
            vel=vel,
            age_s=age,
            ids=self.ids,
            attack_sign=1 if self.team[i] == 0 else -1,
            ball=self.ball_pos[:2].copy(),
            temperature=self.players[i].temperature,
            params=self.decision_params,
            ball_params=self.ball_params,
        )
        options = evaluate_options(ctx)
        noise = {
            o.action: gumbel(self.rng.uniform_for("decision", f, f"{self.ids[i]}|{o.action}"))
            for o in options
        }
        chosen = choose(options, noise, ctx.temperature)
        forced = self.forced_actions.get((i, f))
        if forced is not None:  # a what-if override (SPEC 3.7): the noise is still drawn
            chosen = next((o for o in options if o.action == forced), None)
            if chosen is None:
                raise ValueError(f"{forced} is not an option of {self.ids[i]} at frame {f}")
        error = np.linalg.norm(pos - self.pos, axis=-1)
        self.decisions.append(
            Decision(
                frame=f,
                player=self.ids[i],
                options=options,
                chosen=chosen.action,
                noise=noise,
                belief_error={pid: float(e) for pid, e in zip(self.ids, error, strict=True)},
                belief_age={pid: float(a) for pid, a in zip(self.ids, age, strict=True)},
            )
        )
        hero = self.ids[i] == self.scenario.hero
        self.hero_acted = self.hero_acted or hero
        if chosen.kind == "pass":
            self._kick_pass(i, np.array(chosen.target), self.index(chosen.target_player), f)
        elif chosen.kind == "carry":
            until = f + round(self.decision_params.carry_time / DT)
            self.carry[i] = (np.array(chosen.target), until)
            if hero:
                self.hero_resolved_frame = until
            if self.scenario.decides(self, i):  # he decides again when the carry ends
                self.pending_decision = (i, until)
        else:  # shot: struck at goal; the outcome model is later work (M4)
            self._kick_pass(i, np.array(chosen.target), i, f)
            self.events[-1].type = "shot"
            self.events[-1].id = f"shot:{self.ids[i]}:{f:04d}"

    def _check_out(self) -> bool:
        x, y = self.ball_pos[:2]
        if abs(x) <= HALF_LENGTH and abs(y) <= HALF_WIDTH:
            return False
        self.ball_vel[:] = 0.0
        last = self.last_kicker
        self.events.append(
            Event(f"out:{self.ids[last]}:{self.frame:04d}", "out", self.frame, self.frame * DT,
                  self.ids[last], int(self.team[last]), {"at": [float(x), float(y)]})
        )  # fmt: skip
        self._resolve_pass(None, "out")
        if self.hero_resolved_frame is None:  # out of play before the hero moment: nothing left
            self.done = True
        return True

    def _check_control(self) -> None:
        dist = np.linalg.norm(self.pos - self.ball_pos[:2], axis=-1)
        eligible = dist <= self.params.control_radius
        lockout = round(self.params.kick_lockout_s / DT)
        if self.last_kicker >= 0 and self.frame - self.kick_frame < lockout:
            eligible[self.last_kicker] = False
        if not eligible.any():
            return
        i = int(np.argmin(np.where(eligible, dist, np.inf)))
        passer = self.pass_in_flight["passer"] if self.pass_in_flight else self.last_kicker
        same_team = passer >= 0 and self.team[i] == self.team[passer]
        etype = "reception" if same_team else "interception"
        self.events.append(
            Event(f"{etype}:{self.ids[i]}:{self.frame:04d}", etype, self.frame, self.frame * DT,
                  self.ids[i], int(self.team[i]),
                  {"at": [float(self.ball_pos[0]), float(self.ball_pos[1])]})
        )  # fmt: skip
        if not same_team:
            self.events.append(
                Event(f"possession_change:{self.ids[i]}:{self.frame:04d}", "possession_change",
                      self.frame, self.frame * DT, self.ids[i], int(self.team[i]), {})
            )  # fmt: skip
        self._resolve_pass(i, "complete" if same_team else "intercepted")
        self.owner = i
        self._attach_ball()
        if self.scenario.decides(self, i):
            self.pending_decision = (i, self.frame + round(self.params.first_touch_s / DT))

    def _check_tackle(self) -> None:
        """An opponent within the control radius of a carried ball wins it, as he would win a free
        ball there (scenarios with `tackles`; no draw, so no randomness). The nearest one wins it;
        the player who lost it cannot win it back for `tackle_lockout_s`."""
        i = self.owner
        dist = np.linalg.norm(self.pos - self.ball_pos[:2], axis=-1)
        eligible = (self.team != self.team[i]) & (dist <= self.params.control_radius)
        for j, until in self.tackle_lockout.items():
            if self.frame < until:
                eligible[j] = False
        if not eligible.any():
            return
        j = int(np.argmin(np.where(eligible, dist, np.inf)))
        at = [float(self.ball_pos[0]), float(self.ball_pos[1])]
        for etype, attrs in (("tackle", {"won_from": self.ids[i], "at": at}),
                             ("possession_change", {})):  # fmt: skip
            self.events.append(
                Event(f"{etype}:{self.ids[j]}:{self.frame:04d}", etype, self.frame,
                      self.frame * DT, self.ids[j], int(self.team[j]), attrs)
            )  # fmt: skip
        self.tackle_lockout[i] = self.frame + round(self.params.tackle_lockout_s / DT)
        self.carry.pop(i, None)
        if self.pending_decision is not None and self.pending_decision[0] == i:
            self.pending_decision = None
        if self.ids[i] == self.scenario.hero and self.hero_acted:
            resolved = self.hero_resolved_frame
            self.hero_resolved_frame = self.frame if resolved is None else min(resolved, self.frame)
        self.owner = j
        self._attach_ball()

    def _resolve_pass(self, receiver: int | None, outcome: str) -> None:
        flight = self.pass_in_flight
        if flight is None:
            return
        flight["event"].attrs.update(
            outcome=outcome,
            end=self.frame,
            end_at=[float(self.ball_pos[0]), float(self.ball_pos[1])],
            receiver=None if receiver is None else self.ids[receiver],
        )
        if flight["hero"]:
            self.hero_resolved_frame = self.frame
        self.pass_in_flight = None

    def _emit_scan(self, finished: FinishedScan) -> None:
        i, scan = finished.player, finished.scan
        attrs = {"end": finished.end, "direction": scan.target, "amplitude": scan.amplitude}
        if scan.partial:  # aborted: head motion that is not a scan (sim.perception)
            etype, eid, attrs["partial"] = "head_turn", head_turn_id(self.ids[i], scan.start), True
        else:
            etype, eid, attrs["key"] = "scan", scan_id(self.ids[i], scan.start), scan.key
        self.events.append(
            Event(eid, etype, scan.start, scan.start * DT, self.ids[i], int(self.team[i]), attrs)
        )
