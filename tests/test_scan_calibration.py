"""Head model and scan scheduling calibrated against published values (SPEC 3.4, 3.8)."""

from dataclasses import replace
from statistics import NormalDist

import numpy as np
import pytest

from analytics.vision import wrap_angle
from eval.realism import GROUPS, MIDFIELD, simulate
from sim.config import DT, SimParams
from sim.engine import Simulation
from sim.perception import longest_scan_s, scan_dwell

POSSESSION = "possession_play"
LONG = replace(SimParams(), max_duration_s=30.0)


@pytest.fixture(scope="module")
def possession():
    return [Simulation.from_scenario(POSSESSION, seed=s, params=LONG).run() for s in (4, 5, 6, 7)]


def test_each_scan_turns_at_its_own_peak_speed_from_the_published_spread(possession):
    p = SimParams()
    peaks = []
    for run in possession:
        for e in run.events:
            if e.type != "scan":
                continue
            yaw = run.head_yaw[e.frame : e.attrs["end"] + 1, run.index(e.player)]
            peaks.append(np.abs(wrap_angle(np.diff(yaw))).max() / DT)
    peaks = np.array(peaks)
    assert len(peaks) > 200
    assert peaks.min() >= p.scan_omega_min - 1e-6 and peaks.max() <= p.head_omega_max + 1e-6
    mean, sd = p.scan_omega  # Kokubu et al. (2026): 404.2 +- 50.7 deg/s
    assert abs(peaks.mean() - mean) < 0.05 * mean
    assert 0.8 * sd < peaks.std() < 1.2 * sd


def test_scan_dwell_is_a_capped_lognormal_of_its_draw():
    p = SimParams()
    median, log_sd = p.scan_dwell_s
    assert scan_dwell(0.5, p) == pytest.approx(median)
    assert scan_dwell(NormalDist().cdf(1.0), p) == pytest.approx(median * np.exp(log_sd))
    u = np.linspace(0.0, 1.0, 101)
    dwell = np.array([scan_dwell(x, p) for x in u])
    assert np.all(np.diff(dwell) >= 0) and dwell[0] >= 0.0
    assert dwell[-1] == p.scan_dwell_max_s


def test_most_scans_are_short_and_a_few_hold_the_look(possession):
    durations = np.array(
        [(e.attrs["end"] - e.frame) * DT for run in possession for e in run.events
         if e.type == "scan"]
    )  # fmt: skip
    assert np.median(durations) < 0.7
    assert np.mean(durations > 1.5) > 0.002  # the long tail exists (Aksum et al.: up to 3.28 s)
    assert durations.max() <= longest_scan_s(SimParams())


def test_the_scan_rate_falls_linearly_from_ten_metres_to_one():
    sim = Simulation.from_scenario(POSSESSION, seed=1)
    p = sim.params
    near, far = p.pressure_scan_range
    i, j = sim.index("H4"), sim.index("A9")  # one home and one away player
    sim.pos = np.column_stack([30.0 * np.arange(len(sim.ids)), np.zeros(len(sim.ids))])
    assert np.all(sim._pressure_factor() == 1.0)  # everyone 30 m from everyone
    for gap, expected in (
        (0.5, p.pressure_scan_factor),
        (near, p.pressure_scan_factor),
        ((near + far) / 2, (1.0 + p.pressure_scan_factor) / 2),
        (far, 1.0),
        (12.0, 1.0),
    ):
        sim.pos[j] = sim.pos[i] + np.array([0.0, gap])
        factor = sim._pressure_factor()
        assert factor[i] == pytest.approx(expected) and factor[j] == pytest.approx(expected)
        others = np.ones(len(sim.ids), dtype=bool)
        others[[i, j]] = False
        assert np.all(factor[others] == 1.0)


def test_the_hero_looks_away_only_for_the_key_scan():
    for seed in range(100, 120):
        run = Simulation.from_scenario("blind_side_run", seed).run()
        decision = run.hero_decision()
        before = [
            e for e in run.events
            if e.player == decision.player and e.type in ("scan", "head_turn")
            and e.frame < decision.frame
        ]  # fmt: skip
        assert [e.id for e in before] == [run.key_scan().id], seed


@pytest.fixture(scope="module")
def receptions():
    tables = [simulate(seed)["receptions"] for seed in range(100, 120)]
    return {k: np.concatenate([t[k] for t in tables]) for k in tables[0]}


def test_spec_scan_statistics_on_twenty_seeds(receptions):
    # SPEC 3.8: mean scans in the 10 s before reception within +-25% of the target of about 3.
    assert 0.75 * 3.0 <= receptions["scans"].mean() <= 1.25 * 3.0
    # Central midfielders scan more than forwards (Jordet et al. 2020).
    rate = receptions["scans"] / receptions["window"]
    group = np.array([GROUPS[r] for r in receptions["role"]])
    assert rate[group == "central midfielders"].mean() > rate[group == "forwards"].mean()


@pytest.fixture(scope="module")
def held_out():
    return [
        Simulation.from_scenario(POSSESSION, seed=s, params=LONG).run() for s in range(100, 120)
    ]


def test_spec_scan_rate_under_pressure_is_lower_than_without(held_out):
    # SPEC 3.8: within one role group, scans start less often while an opponent is close, on 20
    # held-out seeds. (The realism report's comparison at the reception mixes roles; see its note.)
    starts = {"close": 0, "free": 0}
    seconds = {"close": 0.0, "free": 0.0}
    for run in held_out:
        team = np.array([p.team for p in run.players])
        onsets = {(run.index(e.player), e.frame) for e in run.events if e.type == "scan"}
        for i, player in enumerate(run.players):
            if player.role not in MIDFIELD:
                continue
            opponents = team != team[i]
            closest = np.linalg.norm(run.pos[:, opponents] - run.pos[:, None, i], axis=-1).min(1)
            for name, mask in (("close", closest < 4.0), ("free", closest >= 8.0)):
                seconds[name] += mask.sum() * DT
                starts[name] += sum((i, f) in onsets for f in np.flatnonzero(mask))
    assert min(seconds.values()) > 600.0
    assert starts["close"] / seconds["close"] < starts["free"] / seconds["free"]
