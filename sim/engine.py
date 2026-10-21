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
import math
from typing import TYPE_CHECKING

import numpy as np

from analytics.tti import time_to_intercept
from analytics.vision import player_visibility, visibility, wrap_angle
from sim import shots
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
from sim.perception import (
    BeliefStore,
    FinishedScan,
    ForcedScan,
    HeadModel,
    head_turn_id,
    scan_id,
)
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
        # (player, frame) -> (offset from the ball in rad, dwell in s): looks added by `AddScan`.
        self.added_scans: dict[tuple[int, int], tuple[float, float]] = {}
        self.no_scans: dict[int, tuple[int, int]] = {}  # player -> [start, end): `NoScans`
        self.events: list[Event] = []
        self.decisions: list[Decision] = []
        self.pending_decision: tuple[int, int] | None = None
        self.pass_in_flight: dict | None = None
        self.carry: dict[int, tuple[np.ndarray, int]] = {}
        # Scenarios with `shots` (Module A): the shot in flight, and each keeper's dive
        # (target, first frame, last frame).
        self.shot_in_flight: dict | None = None
        self.ball_out = False
        self.dives: dict[int, tuple[np.ndarray, int, int]] = {}
        self.tackle_lockout: dict[int, int] = {}  # player -> first frame he may tackle again
        self.last_kicker = -1
        self.kick_frame = -(10**9)
        self.hero_acted = False
        self.hero_resolved_frame: int | None = None
        self.done = False
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
        for i, (start, end) in self.no_scans.items():  # a `NoScans` override (SPEC 3.7)
            if start <= f < end:
                allowed[i] = False
        p_scan = self.scan_rate * self._pressure_factor() * DT
        spontaneous = allowed & (trigger < p_scan)
        # The same trigger draw: just above the scan probability, a scan starts and is aborted.
        partial = allowed & ~spontaneous & (trigger < p_scan * (1 + p.partial_scan_ratio))
        forced_scans = self.scenario.forced_scans(self, f)
        if self.added_scans:  # an `AddScan` override (SPEC 3.7) goes the forced scans' way
            forced_scans = forced_scans | {
                i: ForcedScan(target_yaw=float(base[i] + offset), dwell_s=dwell)
                for (i, at), (offset, dwell) in self.added_scans.items()
                if at == f
            }
        self.head_yaw, finished = self.head.step(
            f,
            self.head_yaw,
            base,
            spontaneous,
            draws,
            forced_scans,
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
        a_max, d_max = self._limits(f)
        self.pos, self.vel = steer(
            self.pos, self.vel, target, np.minimum(cap, self.v_max), a_max, d_max, DT
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
            held = self.shot_in_flight is not None and self._watch_shot()
            if not held and not self._check_out():
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

        if self.scenario.shots:
            self._keeper_targets(target, cap)

        for i, (t, c) in self.scenario.scripted_targets(self, f).items():
            target[i], cap[i] = t, c

        if self.owner < 0 and self.pass_in_flight is not None:
            times, path = self._predicted_path()
            margin = time_to_intercept(self.pos, self.vel, path) - times[None, :]
            passer_team = self.team[self.pass_in_flight["passer"]]
            defenders = np.flatnonzero(self.team != passer_team)
            if self.scenario.shots:
                # Keepers keep their bisector position rather than chasing a passing lane.
                defenders = np.array([j for j in defenders if self.players[j].role != "GK"])
            if defenders.size:
                best = defenders[np.argmin(margin[defenders].min(axis=1))]
                feasible = np.flatnonzero(margin[best] <= 0.0)
                if feasible.size:
                    target[best], cap[best] = path[feasible[0]], self.v_max[best]
            r = self.pass_in_flight["intended"]
            target[r], cap[r] = self.pass_in_flight["meet"], self.v_max[r]
        for k, (t, start, until) in self.dives.items():
            if start <= f <= until:
                target[k], cap[k] = t, shots.KEEPER.v_dive_max
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
            **self._shot_context(i),
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
        elif chosen.kind == "shot" and chosen.action.startswith("shot:"):
            self._kick_shot(i, chosen, f)
        else:  # legacy `shot` (no placement): struck at goal and resolved like a pass
            self._kick_pass(i, np.array(chosen.target), i, f)
            self.events[-1].type = "shot"
            self.events[-1].id = f"shot:{self.ids[i]}:{f:04d}"

    def _check_out(self) -> bool:
        x, y = self.ball_pos[:2]
        if abs(x) <= HALF_LENGTH and abs(y) <= HALF_WIDTH:
            return False
        if self.scenario.shots and self.ball_out:
            return True
        self.ball_vel[:] = 0.0
        last = self.last_kicker
        goal = (
            self.shot_in_flight is not None
            and abs(x) > HALF_LENGTH
            and abs(self.shot_in_flight["event"].attrs["goal_line_y"]) < shots.GOAL_HALF_WIDTH
        )
        etype = "goal" if goal else "out"
        self.events.append(
            Event(f"{etype}:{self.ids[last]}:{self.frame:04d}", etype, self.frame,
                  self.frame * DT, self.ids[last], int(self.team[last]),
                  {"at": [float(x), float(y)]})
        )  # fmt: skip
        if self.scenario.shots:
            self.ball_out = True
        if self.shot_in_flight is not None:
            self._finish_shot("goal" if goal else "wide")
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
        if self.shot_in_flight is not None:  # the save model decides the keeper's part
            eligible[self.shot_in_flight["keeper"]] = False
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
        if self.shot_in_flight is not None:
            self._finish_shot("blocked")
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

    # --- shots and keepers (scenarios with `shots`, SPEC 3.3, Module A) ---------------------

    def _keeper(self, team: int) -> int:
        return next(
            (j for j, p in enumerate(self.players) if p.team == team and p.role == "GK"), -1
        )

    def _shot_context(self, i: int) -> dict:
        """The decision context's shot fields; empty without `shots`, so nothing changes."""
        if not self.scenario.shots:
            return {}
        last = [e for e in self.events if e.type == "pass" and e.attrs.get("to") == self.ids[i]]
        from_y = float(last[-1].attrs["start"][1]) if last else 0.0
        return {"shots": True, "keeper": self._keeper(1 - int(self.team[i])), "from_y": from_y}

    def _keeper_targets(self, target: np.ndarray, cap: np.ndarray) -> None:
        """Each keeper stands on the bisector of the ball's angle to his posts (`sim.shots`)."""
        for team, sign in ((0, -1), (1, 1)):  # the away keeper defends +x
            k = self._keeper(team)
            if k >= 0 and k != self.owner:
                if self.shot_in_flight is not None and k == self.shot_in_flight["keeper"]:
                    # He stays set until he sees the strike and starts his dive.
                    target[k] = self.shot_in_flight["set_position"]
                else:
                    target[k] = shots.bisector_point(self.ball_pos[:2], sign)
                cap[k] = self.v_max[k]

    def _limits(self, f: int) -> tuple[np.ndarray, np.ndarray]:
        """Acceleration limits; a keeper in his dive window moves at the dive's limits."""
        active = [k for k, (_, start, until) in self.dives.items() if start <= f <= until]
        if not active:
            return self.a_max, self.d_max
        a_max, d_max = self.a_max.copy(), self.d_max.copy()
        a_max[active] = d_max[active] = shots.KEEPER.a_dive_max
        return a_max, d_max

    def _kick_shot(self, i: int, option, f: int) -> None:
        """Strike `option` (shot:near | shot:far) at shot speed with an aim error, both keyed
        draws of the shooter at this frame, so a counterfactual elsewhere keeps them."""
        sp, pid = shots.SHOT, self.ids[i]
        lo, hi = sp.speed
        speed = lo + (hi - lo) * self.rng.uniform_for("shot_speed", f, pid)
        error_draw = float(self.rng.generator("shot_error", f, pid).standard_normal())
        if self.rng.recorded is not None:
            self.rng.recorded[(pid, "shot_error", f)] = (error_draw,)
        error = error_draw * sp.sigma_theta
        ball = self.ball_pos[:2].copy()
        aim = np.asarray(option.target, dtype=float)
        u = (aim - ball) / float(np.linalg.norm(aim - ball))
        c, s = math.cos(error), math.sin(error)
        u = np.array([c * u[0] - s * u[1], s * u[0] + c * u[1]])
        self.ball_vel = np.array([*(u * speed), 0.0])
        self.owner, self.last_kicker, self.kick_frame = -1, i, f
        k = self._keeper(1 - int(self.team[i]))
        assert k >= 0, f"{self.ids[i]} takes a placed shot but the defending team has no keeper"
        x_k = float(self.pos[k, 0])
        y_k_line, t_k = shots.crossing(ball, ball + u, x_k, speed, self.ball_params)
        gx = shots.goal_x(1 if self.team[i] == 0 else -1)
        y_goal_line, _ = shots.crossing(ball, ball + u, gx, speed, self.ball_params)
        event = Event(
            id=f"shot:{pid}:{f:04d}",
            type="shot",
            frame=f,
            t=f * DT,
            player=pid,
            team=int(self.team[i]),
            attrs={
                "placement": option.action.partition(":")[2],
                "start": [float(ball[0]), float(ball[1])],
                "aim": [float(aim[0]), float(aim[1])],
                "speed": float(speed),
                "error": error,
                "distance": float(np.linalg.norm(aim - ball)),
                "keeper": self.ids[k],
                "keeper_line_y": y_k_line,
                "goal_line_y": y_goal_line,
                "seen": None,
                "reach": None,
                "keeper_distance": None,
                "p_save": None,
                "outcome": None,
                "end": None,
                "end_at": None,
            },
        )
        self.events.append(event)
        self.shot_in_flight = {
            "event": event,
            "keeper": k,
            "set_position": self.pos[k].copy(),
            "x_k": x_k,
            "y_c": y_k_line,
            "cross": f + round(t_k / DT) if math.isfinite(t_k) else None,
            "seen": None,
            "y_seen": None,
            "decided": False,
            "u": self.rng.uniform_for("save", f, self.ids[k]),
            "hero": self.scenario.ends_on_pass(self, i),
        }
        self._watch_shot()  # The first sighting can be the strike itself, before the ball rolls.

    def _watch_shot(self) -> bool:
        """The keeper's first sight of the ball, his dive, and the save model when the ball
        reaches his line (`sim.shots`). True when he holds it."""
        s, kp, f = self.shot_in_flight, shots.KEEPER, self.frame
        k = s["keeper"]
        if s["seen"] is None:
            others = np.delete(np.arange(len(self.ids)), k)
            v = visibility(self.pos[k], float(self.head_yaw[k]), float(np.linalg.norm(self.vel[k])),
                           self.ball_pos[None, :2], self.pos[others])[0]  # fmt: skip
            if v >= self.params.perception_threshold:
                s["seen"], s["y_seen"] = f, float(self.pos[k, 1])
                cross = s["cross"] if s["cross"] is not None else f
                d = s["y_c"] - s["y_seen"]
                r = shots.reach(max(cross - f, 0) * DT, kp)
                move = math.copysign(max(min(abs(d), r) - kp.arm, 0.0), d)
                start = f + round(kp.react_render_s / DT)
                aim = np.array([s["x_k"], s["y_seen"] + move])
                self.dives[k] = (aim, start, cross + round(kp.dive_hold_s / DT))
                self.events.append(
                    Event(f"dive:{self.ids[k]}:{start:04d}", "dive", start, start * DT,
                          self.ids[k], int(self.team[k]),
                          {"toward": [float(aim[0]), float(aim[1])], "seen": f})
                )  # fmt: skip
        # `stopped` credits the keeper from any distance, but a struck ball does not stop in
        # range with the default ball: distance_to_stop(24 m/s) is about 99 m, shot_range 30 m.
        stopped = float(np.linalg.norm(self.ball_vel[:2])) < 1.0
        if s["decided"] or not (stopped or (s["cross"] is not None and f >= s["cross"])):
            return False
        s["decided"] = True
        seen = s["seen"]
        t = (s["cross"] - seen) * DT if seen is not None and s["cross"] is not None else 0.0
        y_k = s["y_seen"] if seen is not None else float(self.pos[k, 1])
        r = shots.reach(t, kp)
        d = abs(s["y_c"] - y_k)
        p = float(shots.p_save(d, r, kp))
        attrs = s["event"].attrs
        attrs.update(seen=seen, reach=r, keeper_distance=d, p_save=p)
        on_target = abs(attrs["goal_line_y"]) < shots.GOAL_HALF_WIDTH
        if not (stopped or on_target and s["u"] < p):
            return False
        at = [float(self.ball_pos[0]), float(self.ball_pos[1])]
        self.events.append(
            Event(f"save:{self.ids[k]}:{f:04d}", "save", f, f * DT, self.ids[k],
                  int(self.team[k]), {"at": at, "shot": s["event"].id})
        )  # fmt: skip
        self._finish_shot("saved")
        self.owner = k
        self._attach_ball()
        return True

    def _finish_shot(self, outcome: str) -> None:
        s = self.shot_in_flight
        s["event"].attrs.update(
            outcome=outcome,
            end=self.frame,
            end_at=[float(self.ball_pos[0]), float(self.ball_pos[1])],
        )
        if s["hero"]:
            self.hero_resolved_frame = self.frame
        self.shot_in_flight = None

    def _emit_scan(self, finished: FinishedScan) -> None:
        i, scan = finished.player, finished.scan
        attrs = {"end": finished.end, "direction": scan.target, "amplitude": scan.amplitude}
        if scan.partial:  # aborted: head motion that is not a scan (sim.perception)
            etype, eid, attrs["partial"] = "head_turn", head_turn_id(self.ids[i], scan.start), True
        else:
            etype, eid, attrs["key"] = "scan", scan_id(self.ids[i], scan.start), scan.key
            if (i, scan.start) in self.added_scans:
                attrs["added"] = True
        self.events.append(
            Event(eid, etype, scan.start, scan.start * DT, self.ids[i], int(self.team[i]), attrs)
        )
