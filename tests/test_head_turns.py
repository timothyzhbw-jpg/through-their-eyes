"""Partial head turns never reach scan consumers (SPEC 3.1, 3.4, 4.4, 5.1, 5.2).

The sim emits partial (aborted) scans as `head_turn` events, so everything that reads `scan`
events — verified claim functions, moment detection, the scan lens — counts real scans only. The
truth here is logged from the head model itself, independently of the event type.
"""

from dataclasses import replace

import pytest

from explain.functions import EvalContext, count_events, scans_in_window
from explain.lenses import SCAN_LOOKBACK_S, scan_candidates
from explain.moments import SCAN_WINDOW_S, detect_decisions_after_scan
from sim.engine import Simulation
from sim.model import Event

SCENARIO = "blind_side_run"
HERO = "H8"


def _run_with_turn_log(seed: int):
    """A hero run, plus every turn the head model finished: (player, start frame, partial)."""
    sim = Simulation.from_scenario(SCENARIO, seed)
    log: list[tuple[str, int, bool]] = []
    emit = sim._emit_scan

    def logged(finished):
        log.append((sim.ids[finished.player], finished.scan.start, finished.scan.partial))
        emit(finished)

    sim._emit_scan = logged
    return sim.run(), log


@pytest.fixture(scope="module")
def runs():
    return [_run_with_turn_log(seed) for seed in range(10)]


def _real(log, player: str, lo: int, hi: int) -> int:
    return sum(p == player and not partial and lo <= f <= hi for p, f, partial in log)


def _with_head_turn(run, player: str, frame: int):
    turn = Event(
        id=f"head_turn:{player}:{frame:04d}", type="head_turn", frame=frame, t=frame * run.dt,
        player=player, team=run.players[run.index(player)].team,
        attrs={"end": frame + 3, "direction": 0.0, "amplitude": 0.5, "partial": True},
    )  # fmt: skip
    return replace(run, events=[*run.events, turn])


def test_the_runs_have_partial_turns_so_the_checks_below_bite(runs):
    assert sum(partial for _, log in runs for _, _, partial in log) >= 10
    assert any(p == HERO and partial for _, log in runs for p, _, partial in log)


def test_scans_in_window_and_count_events_equal_the_real_scans_for_every_player(runs):
    for run, log in runs:
        ctx = EvalContext(run, resimulate=False)
        anchor = max(run.events, key=lambda e: e.frame)
        window_s = anchor.frame * run.dt  # from the first frame to the anchor
        for player in run.ids:
            expected = _real(log, player, 0, anchor.frame)
            assert scans_in_window(ctx, run, player, anchor.id, window_s) == expected
            assert count_events(ctx, run, "scan", anchor.id, -window_s, 0.0, player) == expected


def test_scans_in_window_ignores_a_head_turn_before_the_reception(runs):
    run, _ = runs[0]
    reception = next(e for e in run.events if e.type == "reception" and e.player == HERO)
    with_turn = _with_head_turn(run, HERO, reception.frame - 10)
    before = scans_in_window(EvalContext(run, resimulate=False), run, HERO, reception.id, 2.0)
    after = scans_in_window(
        EvalContext(with_turn, resimulate=False), with_turn, HERO, reception.id, 2.0
    )
    assert after == before


def test_decision_after_scan_counts_real_scans_and_ignores_head_turns(runs):
    cards = 0
    for run, log in runs:
        for card in detect_decisions_after_scan(run):
            cards += 1
            ids = [*card.events, *card.anchors.values()]
            assert not any(i.startswith("head_turn:") for i in ids)
            reception = run.event(card.anchors["reception"])
            lo = reception.frame - round(SCAN_WINDOW_S / run.dt)
            assert card.metrics["scans_in_window"] == _real(log, card.actor, lo, card.anchor_frame)
            turn_at = min(card.anchor_frame - 1, reception.frame)
            with_turn = _with_head_turn(run, card.actor, turn_at)
            again = next(c for c in detect_decisions_after_scan(with_turn) if c.id == card.id)
            assert again == card
    assert cards >= 5


def test_lens_scan_candidates_are_real_scans_only(runs):
    for run, log in runs:
        decision = run.hero_decision()
        candidates = scan_candidates(run, decision)
        assert all(c["scan_id"].startswith("scan:") for c in candidates)
        lo = decision.frame - round(SCAN_LOOKBACK_S / run.dt)
        assert len(candidates) == _real(log, HERO, lo, decision.frame - 1)
        with_turn = _with_head_turn(run, HERO, decision.frame - 5)
        assert scan_candidates(with_turn, decision) == candidates
