"""Archetypes (eval/archetypes.py): one player's perception traits, off unless asked for."""

import math
from dataclasses import replace

import numpy as np
import pytest

import eval.archetypes as arch
from sim.config import SimParams
from sim.engine import Simulation
from sim.model import PlayerTraits

SHORT = replace(SimParams(), max_duration_s=8.0)
SEED = 1_234_567


def _run(traits=None, record_draws=False):
    return Simulation.from_scenario(
        "open_play", SEED, params=SHORT, traits=traits, record_draws=record_draws
    ).run()


def test_without_traits_a_run_keeps_its_bytes():
    plain = Simulation.from_scenario("open_play", SEED, params=SHORT).run()
    assert _run(None).to_bytes() == plain.to_bytes() == _run({}).to_bytes()


def test_traits_change_only_the_focal_player():
    traits = {"H8": PlayerTraits(scan_rate=6.0)}
    base, other = _run(record_draws=True), _run(traits, record_draws=True)
    players = {p.id: p for p in other.players}
    assert players["H8"].scan_rate == 6.0
    assert all(p == players[p.id] for p in base.players if p.id != "H8")
    # Keyed draws (SPEC 3.7): another player's draws are the same, frame for frame.
    a, b = base.draws_for("H4"), other.draws_for("H4")
    common = a.keys() & b.keys()
    assert common and all(a[k] == b[k] for k in common)


def _scan_speeds(run, player):
    i = run.index(player)
    yaw = np.unwrap(run.head_yaw[:, i])
    speeds = []
    for e in run.events:
        if e.type == "scan" and e.player == player:
            seg = yaw[e.frame : int(e.attrs["end"]) + 1]
            if len(seg) > 2:
                speeds.append(np.abs(np.diff(seg)).max() / run.dt)
    return speeds


def test_a_slow_head_turns_its_scans_slower():
    fast = _run({"H8": PlayerTraits(scan_rate=6.0)})
    slow = _run({"H8": PlayerTraits(scan_rate=6.0, scan_omega_mean=math.radians(302.8))})
    f, s = _scan_speeds(fast, "H8"), _scan_speeds(slow, "H8")
    assert f and s and np.mean(s) < np.mean(f)


def test_the_configured_rate_is_read_off_the_curve():
    points = [(0.2, 0.1), (1.0, 0.4), (5.0, 0.7)]
    rate, reached = arch.configured_for(0.4, points)
    assert reached and rate == pytest.approx(1.0)
    rate, reached = arch.configured_for(0.55, points)
    assert reached and 1.0 < rate < 5.0
    assert arch.configured_for(0.9, points) == (5.0, False)  # above the curve: not reached


def test_statistics_helpers():
    gen = np.random.default_rng(0)
    x = gen.normal(size=20_000)
    y = (gen.random(20_000) < 1 / (1 + np.exp(-(0.3 + 0.8 * x)))).astype(float)
    assert arch.logistic_slope(x, y) == pytest.approx(0.8, abs=0.05)
    assert arch.cohens_d(np.array([1.0, 2.0, 3.0]), np.array([0.0, 1.0, 2.0])) == pytest.approx(1.0)
    lo, hi = arch.wilson(37, 40)
    assert 0.80 < lo < 0.81 and 0.97 < hi < 0.98


def test_archetypes_are_fictional_and_placed_on_published_values():
    keys = [a.key for a in arch.ARCHETYPES]
    assert keys == ["A", "B", "C", "D", "E"] and arch.TYPICAL == "B"
    for a in arch.ARCHETYPES:
        assert "et al." in a.basis or "sim/config.py" in a.basis
    c = next(a for a in arch.ARCHETYPES if a.key == "C")
    e = next(a for a in arch.ARCHETYPES if a.key == "E")
    assert c.target == e.target and e.omega_deg_s < arch.KOKUBU_MEAN  # frequency vs speed


def test_one_short_run_measures_everything_and_the_report_opens_with_the_framing(monkeypatch):
    monkeypatch.setattr(arch, "PARAMS", replace(SimParams(), max_duration_s=12.0))
    results = [arch.play((SEED, a.key, None if a.key == "B" else 2.0, a.omega_deg_s))
               for a in arch.ARCHETYPES]  # fmt: skip
    for r in results:
        assert set(r) >= {"scan_rates", "decisions", "passes", "flips"}
    assert "validation" in results[1]
    hero = {a.key: [arch.hero_flip((3, a.key, None, None))] for a in arch.ARCHETYPES}
    assert hero["B"] == [True]  # blind_side_run seed 3: no look, another pass (SPEC 3.6)
    rates = {a.key: (None if a.key == "B" else 2.0, True) for a in arch.ARCHETYPES}
    calibration = {"curve": [(1.0, 0.4), (16.0, 0.8)], "slow": {}, "runs": 1, "rates": rates}
    report = arch.render(results, hero, calibration, 1)
    title, blank, framing = report.splitlines()[:3]
    assert title.startswith("# Archetypes") and blank == "" and framing == arch.FRAMING
    sections = (
        "## The archetypes",
        "## Comparison",
        "## The scan hero",
        "## Validation against Jordet et al. (2020)",
        "## What is held fixed",
    )
    assert all(section in report for section in sections)
