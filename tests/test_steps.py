"""Scan step-through (SPEC 7): the hero's looks before the ball reaches him, then his decision.

Written before the web screen: steps come from the run's scan events, the freeze frame is inside
the scan's dwell, velocities are the sim's, every line verifies, and the final freeze keeps
exactly the two players the decision turns on.
"""

from pathlib import Path

import numpy as np
import pytest

from agents.context import MomentContext
from agents.steps import DWELL_TOLERANCE, answer_steps, build_steps, dwell_frame, focus_pair
from analytics.vision import wrap_angle
from sim.export import export_steps, steps_json
from tests import canonical

DATA = Path(__file__).parent.parent / "web" / "public" / "data"
FILES = {
    ("blind_side_run", 3): "steps_seed3.json",
    ("press_escape", 0): "steps_press_escape_seed0.json",
    ("pro_scan", 126): "steps_pro_scan_seed126.json",  # the teaching scenario's held-out seed
}


@pytest.fixture(scope="module")
def blind():
    return MomentContext.load("blind_side_run", 3)


@pytest.fixture(scope="module")
def press():
    return MomentContext.load("press_escape", 0)


def _scans_before_reception(run, hero):
    reception = min(e.frame for e in run.events if e.type == "reception" and e.player == hero)
    return [e.id for e in run.events
            if e.type == "scan" and e.player == hero and e.frame < reception]  # fmt: skip


def test_steps_resolve_from_scan_events(blind, press):
    runs = build_steps(blind)
    fac, cf = runs["factual"], runs["counterfactual"]
    assert [s.scan.id for s in fac.steps] == _scans_before_reception(blind.run, "H8")
    assert [s.scan.id for s in fac.steps] == ["scan:H8:0050"]
    assert not fac.steps[0].missing
    # Without the key scan, its step stays, shown as missing.
    assert [(s.scan.id, s.missing) for s in cf.steps] == [("scan:H8:0050", True)]
    assert _scans_before_reception(cf.run, "H8") == []
    runs = build_steps(press)
    for rs in runs.values():  # a forced action changes nothing before the decision
        assert [s.scan.id for s in rs.steps] == ["scan:H4:0034", "scan:H4:0057"]
        assert not any(s.missing for s in rs.steps)
    # A head turn that is not a scan (a partial one) is no step.
    turns = [e for e in press.run.events if e.type == "head_turn" and e.player == "H4"]
    assert any(e.frame < 61 for e in turns)


def test_the_freeze_frame_is_in_the_dwell(blind, press):
    for ctx in (blind, press):
        for rs in build_steps(ctx).values():
            for s in rs.steps:
                if s.missing:
                    continue
                end = int(s.scan.attrs["end"])
                assert s.scan.frame <= s.frame <= min(end, rs.decision.frame)
                if s.frame < rs.decision.frame:  # not cut short by his decision
                    i = rs.run.index(s.scan.player)
                    off = wrap_angle(rs.run.head_yaw[s.frame, i] - s.scan.attrs["direction"])
                    assert abs(off) <= DWELL_TOLERANCE + 1e-9
                    assert s.frame == dwell_frame(rs.run, s.scan)


def test_steps_report_who_came_into_sight(blind):
    fac = build_steps(blind)["factual"]
    # The design rule of blind_side_run: the runner is visible to H8 only on the key scan.
    assert "H9" in fac.steps[0].sight
    assert "H8" not in fac.steps[0].sight


def test_the_focus_pair_is_the_receiver_and_his_nearest_opponent(blind, press):
    runs = build_steps(blind)
    for rs in runs.values():
        d = rs.decision
        a, b = focus_pair(rs.run, d)
        assert a != b
        receiver = d.chosen.removeprefix("pass:")
        assert a == receiver
        team = np.array([p.team for p in rs.run.players])
        i = rs.run.index(receiver)
        opp = np.flatnonzero(team != team[i])
        dist = np.linalg.norm(rs.run.pos[d.frame, opp] - rs.run.pos[d.frame, i], axis=1)
        assert b == rs.run.ids[opp[int(np.argmin(dist))]]
    carry = build_steps(press)["counterfactual"]  # "If he carried it": the carrier himself
    assert carry.decision.chosen == "carry"
    assert carry.focus[0] == "H4" and carry.focus[1].startswith("A")


@pytest.mark.parametrize("which", ["blind", "press"])
def test_every_line_verifies(which, request):
    ctx = request.getfixturevalue(which)
    answer = answer_steps(ctx)
    for name, rs in answer.runs.items():
        ids = [c.id for c in rs.claims]
        assert sum(rs.lines.values(), []) == ids  # every claim is on a line of a step
        for lang in ("en", "zh"):
            payload = answer.payloads[name][lang]
            assert [line.id for line in payload.lines] == ids, (name, lang)
            assert all(c.verdict == "supported" for c in payload.claims)


def test_the_export_carries_the_sims_velocities_and_the_decision_record(blind):
    data = export_steps("blind_side_run", 3)
    runs = build_steps(blind)
    for name, raw in data["runs"].items():
        rs = runs[name]
        for step, s in zip(raw["steps"], rs.steps, strict=True):
            assert step["frame"] == s.frame
            assert step["vel"] == np.rint(rs.run.vel[s.frame] * 1000).astype(int).tolist()
        final = raw["final"]
        assert final["frame"] == rs.decision.frame
        assert final["chosen"] == rs.decision.chosen
        assert final["focus"] == list(rs.focus)
        assert final["vel"] == np.rint(rs.run.vel[rs.decision.frame] * 1000).astype(int).tolist()
    assert data["runs"]["factual"]["final"]["chosen"] == "pass:H9"
    assert data["runs"]["counterfactual"]["final"]["chosen"] == "pass:H4"


def test_a_hero_with_no_decision_on_the_ball_has_no_steps():
    with pytest.raises(ValueError, match="no decision on the ball"):
        build_steps(MomentContext.load("corner_blind_side", 0))


@pytest.fixture(scope="module")
def coach():
    return MomentContext.load("pro_scan", 126)


def test_the_teaching_steps_label_each_look_and_add_the_two_beats(coach):
    """`pro_scan`: the scripted looks L, R, B, F, the forward one missing without it, and the
    drop-back and half-turn told in both runs, from the run itself."""
    runs = build_steps(coach)
    fac, cf = runs["factual"], runs["counterfactual"]
    assert [s.direction for s in fac.steps] == ["L", "R", "B", "F"]
    assert [(s.direction, s.missing) for s in cf.steps] == [
        ("L", False), ("R", False), ("B", False), ("F", True)
    ]  # fmt: skip
    assert [(b.id, b.happened) for b in fac.beats] == [("drop_back", True), ("half_turn", True)]
    assert [(b.id, b.happened) for b in cf.beats] == [("drop_back", False), ("half_turn", False)]
    for rs in runs.values():
        assert all(b.frame == rs.reception.frame for b in rs.beats)
        assert list(rs.lines)[-3:] == ["drop_back", "half_turn", "final"]
    # Without the forward look he receives the ball, and decides, on other frames.
    assert cf.decision.frame != fac.decision.frame
    answer = answer_steps(coach)
    for name, rs in answer.runs.items():
        for lang in ("en", "zh"):
            payload = answer.payloads[name][lang]
            assert [line.id for line in payload.lines] == [c.id for c in rs.claims], (name, lang)


def test_only_the_teaching_export_carries_labels_and_beats():
    data = export_steps("pro_scan", 126)
    assert data["teaching"] is True
    for raw in data["runs"].values():
        assert [s["direction"] for s in raw["steps"]] == ["L", "R", "B", "F"]
        assert [b["id"] for b in raw["beats"]] == ["drop_back", "half_turn"]
    for key in (("blind_side_run", 3), ("press_escape", 0)):
        text = steps_json(export_steps(*key))
        assert '"teaching"' not in text and '"beats"' not in text and '"direction"' not in text


@canonical.linux_only()
@pytest.mark.parametrize(("key", "name"), list(FILES.items()))
def test_committed_steps_files_are_current(key, name):
    fresh = steps_json(export_steps(*key))
    committed = (DATA / name).read_text()
    assert fresh == committed, f"web/public/data/{name} is stale: {canonical.message()}"
