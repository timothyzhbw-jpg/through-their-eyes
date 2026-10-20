"""Non-scan head motion in the sim (SPEC 3.4 "Non-scan head motion", 3.7 keyed draws).

Partial (aborted) scans and slow gaze drift are real head motion, switchable through
`SimParams.head_nuisance`. Partial scans are `head_turn` events, never `scan` events: they do not
count as scans. The scenario's forced key scan is never touched.
"""

from dataclasses import replace

import numpy as np
import pytest

from analytics.vision import wrap_angle
from sim.config import DT, SimParams
from sim.engine import Simulation
from sim.perception import HeadModel
from sim.rng import KeyedRng

POSSESSION = "possession_play"
HERO_SCENARIO = "blind_side_run"
LONG = replace(SimParams(), max_duration_s=30.0)
NO_HEAD_NUISANCE = replace(LONG, head_nuisance=False)


def _scans(run):
    return [e for e in run.events if e.type == "scan"]


def _head_turns(run):
    return [e for e in run.events if e.type == "head_turn"]


@pytest.fixture(scope="module")
def possession():
    return [Simulation.from_scenario(POSSESSION, seed=s, params=LONG).run() for s in (1, 2, 3)]


def test_possession_play_runs_long_with_passes_and_scans(possession):
    for run in possession:
        assert len(run.owner) >= round(25.0 / DT)  # rarely ends early on a ball out of play
        passes = [e for e in run.events if e.type == "pass"]
        assert len(passes) >= 8
        assert len(_scans(run)) >= 100


def test_partial_scans_are_head_turn_events_and_turn_back_before_the_ball_leaves_the_cone(
    possession,
):
    p = SimParams()
    lo, hi = p.partial_scan_amplitude
    full = [e for run in possession for e in _scans(run)]
    turns = [e for run in possession for e in _head_turns(run)]
    assert full and turns
    assert 0.25 <= len(turns) / len(full) <= 1.0  # configured ratio 0.5, minus blocked starts
    for e in turns:
        assert e.id == f"head_turn:{e.player}:{e.frame:04d}"
        assert set(e.attrs) == {"end", "direction", "amplitude", "partial"}
        assert e.attrs["partial"] is True
        assert lo - 1e-9 <= e.attrs["amplitude"] <= hi + 1e-9
        # Out and straight back, at no less than the slowest scan speed (plus the last few degrees
        # under the proportional gain).
        assert 0 < e.attrs["end"] - e.frame <= round((2 * hi / p.scan_omega_min + 0.1) / DT)
    assert min(e.attrs["amplitude"] for e in full) >= p.scan_amplitude[0] - 1e-9


def test_no_scan_event_is_ever_partial(possession):
    hero_runs = [Simulation.from_scenario(HERO_SCENARIO, seed).run() for seed in range(10)]
    for run in possession + hero_runs:
        for e in _scans(run):
            assert e.id.startswith("scan:")
            assert "partial" not in e.attrs
    assert sum(len(_head_turns(run)) for run in hero_runs) > 0


def test_partial_scans_move_the_true_head_away_from_the_ball_and_back(possession):
    run = possession[0]
    hi = SimParams().partial_scan_amplitude[1]
    for e in _head_turns(run)[:40]:
        i = run.index(e.player)
        frames = np.arange(e.frame, e.attrs["end"] + 1)
        to_ball = run.ball_pos[frames, :2] - run.pos[frames, i]
        offset = wrap_angle(run.head_yaw[frames, i] - np.arctan2(to_ball[:, 1], to_ball[:, 0]))
        excursion = np.abs(wrap_angle(offset - offset[0])).max()
        assert np.deg2rad(5.0) < excursion < hi + np.deg2rad(20.0)


def test_head_nuisance_off_has_no_head_turns_and_no_drift():
    sim = Simulation.from_scenario(POSSESSION, seed=1, params=NO_HEAD_NUISANCE)
    sim.run_until(round(15.0 / DT))
    assert np.all(sim.head.drift == 0.0)
    run = sim.result()
    assert _scans(run) and not _head_turns(run)


def test_head_nuisance_only_changes_head_motion_where_nothing_depends_on_perception():
    # possession_play has no perception-driven decisions, so with and without head nuisance the
    # players and the ball move identically; only the heads differ.
    on = Simulation.from_scenario(POSSESSION, seed=2, params=LONG).run()
    off = Simulation.from_scenario(POSSESSION, seed=2, params=NO_HEAD_NUISANCE).run()
    np.testing.assert_array_equal(on.pos, off.pos)
    np.testing.assert_array_equal(on.ball_pos, off.ball_pos)
    np.testing.assert_array_equal(on.owner, off.owner)
    assert not np.array_equal(on.head_yaw, off.head_yaw)


def test_drift_is_slow_and_bounded():
    p = SimParams()
    n, frames = 40, round(120.0 / DT)
    head_model, rng = HeadModel(n), KeyedRng(7)
    base = np.zeros(n)
    head = np.zeros(n)
    no_scan = np.zeros(n, dtype=bool)
    yaw = []
    for f in range(frames):
        head, finished = head_model.step(
            f, head, base, no_scan, np.zeros((n, 3)), {}, set(), [str(k) for k in range(n)], p,
            DT, drift_noise=rng.normal("head_drift", f, n),
        )  # fmt: skip
        assert not finished
        yaw.append(head)
    yaw = np.array(yaw)
    settled = yaw[round(10.0 / DT) :]
    assert 0.6 * p.drift_sigma < settled.std() < 1.4 * p.drift_sigma
    rate = np.abs(np.diff(yaw, axis=0)) / DT
    assert rate.max() < np.deg2rad(60.0)  # far below any scan-detector threshold (>= 125 deg/s)


def test_nuisance_draws_are_a_fixed_number_per_frame_and_player_whatever_the_switch():
    on = Simulation.from_scenario(HERO_SCENARIO, seed=5, record_draws=True).run()
    off = Simulation.from_scenario(
        HERO_SCENARIO, seed=5, record_draws=True, params=replace(SimParams(), head_nuisance=False)
    ).run()
    steps = set(range(len(on.owner) - 1))
    for player in ("H8", "H9", "A5"):
        draws = on.draws_for(player)
        for purpose in ("partial_scan", "head_drift"):
            frames = {f for (p, f) in draws if p == purpose}
            assert frames == steps
            assert all(len(draws[(purpose, f)]) == 1 for f in frames)
        off_draws = off.draws_for(player)
        common = draws.keys() & off_draws.keys()
        assert all(draws[k] == off_draws[k] for k in common)


def test_the_forced_key_scan_is_untouched_by_nuisance():
    off_params = replace(SimParams(), head_nuisance=False)
    for seed in range(100, 110):
        on = Simulation.from_scenario(HERO_SCENARIO, seed).run()
        off = Simulation.from_scenario(HERO_SCENARIO, seed, params=off_params).run()
        k_on, k_off = on.key_scan(), off.key_scan()
        assert k_on.id == k_off.id and k_on.player == "H8"
        assert k_on.attrs["direction"] == k_off.attrs["direction"]
        assert k_on.attrs == k_off.attrs | {"amplitude": k_on.attrs["amplitude"],
                                            "end": k_on.attrs["end"]}  # fmt: skip
        assert k_on.attrs["key"] is True and "partial" not in k_on.attrs
        # While the ball travels to him the hero makes no other scan, and no partial turn.
        kick = next(e.frame for e in on.events if e.type == "pass")
        decision = on.hero_decision().frame
        others = [
            e for e in _scans(on) + _head_turns(on)
            if e.player == "H8" and kick <= e.frame < decision and e.id != k_on.id
        ]  # fmt: skip
        assert not others


def test_possession_play_with_nuisance_is_deterministic_and_resumable():
    params = replace(SimParams(), max_duration_s=15.0)
    full = Simulation.from_scenario(POSSESSION, seed=4, params=params).run().to_bytes()
    assert full == Simulation.from_scenario(POSSESSION, seed=4, params=params).run().to_bytes()
    sim = Simulation.from_scenario(POSSESSION, seed=4, params=params)
    sim.run_until(140)
    assert Simulation.resume(sim.snapshot()).run().to_bytes() == full
