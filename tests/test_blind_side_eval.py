"""Blind-side alert eval (SPEC 4.4): truth from the sim's beliefs, interval matching, acceptance."""

import numpy as np

from analytics.blind_side import DEFAULT_PARAMS, Alert
from eval.blind_side import _overlap, intervals, score, simulate, truth


def test_truth_intervals_bridge_short_gaps_and_drop_blips():
    mask = np.zeros((100, 2, 2), dtype=bool)
    mask[10:20, 0, 1] = True
    mask[24:40, 0, 1] = True  # 4-frame gap: bridged
    mask[60:63, 0, 1] = True  # 3 frames: dropped
    mask[70:80, 1, 0] = True
    assert intervals(mask) == [Alert(0, 1, 10, 39), Alert(1, 0, 70, 79)]


def test_overlap_needs_the_same_pair_and_allows_a_tolerance():
    a = Alert(0, 1, 50, 60)
    assert _overlap(a, Alert(0, 1, 65, 80), tol=5)
    assert not _overlap(a, Alert(0, 1, 66, 80), tol=5)
    assert not _overlap(a, Alert(1, 0, 50, 60), tol=5)


def test_truth_is_read_from_the_sims_beliefs_and_the_hero_runner_is_in_it():
    s = simulate("blind_side_run", 3)
    assert s.belief_error.shape == (len(s.owner), 22, 22)
    # Sampled before each step's perception, so even the belief about oneself is a frame old.
    assert np.diagonal(s.belief_error, axis1=1, axis2=2).max() < 0.05
    h8, h9 = s.ids.index("H8"), s.ids.index("H9")
    assert any((g.observer, g.target) == (h8, h9) for g in truth(s, DEFAULT_PARAMS))


def test_fresh_held_out_precision_and_recall_meet_the_spec():
    # SPEC 4.4: precision >= 0.8, recall >= 0.7. A subset of the fresh held-out seeds (200+),
    # which no eval looked at before the defaults were chosen on the tuning seeds; the full set
    # gives precision 0.947, recall 0.967 (eval/reports/blind_side.md).
    samples = [simulate("possession_play", seed) for seed in (200, 201, 202)]
    samples += [simulate("blind_side_run", seed) for seed in range(200, 215)]
    counts = score(samples, DEFAULT_PARAMS)
    assert counts.truths >= 100
    assert counts.precision >= 0.8
    assert counts.recall >= 0.7
