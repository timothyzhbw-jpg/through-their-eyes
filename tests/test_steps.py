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
from explain.belief_options import option_changes
from sim.export import export_steps, steps_json
from tests import canonical

DATA = Path(__file__).parent.parent / "web" / "public" / "data"
FILES = {
    ("blind_side_run", 3): "steps_seed3.json",
    ("press_escape", 0): "steps_press_escape_seed0.json",
    ("pro_scan", 116): "steps_pro_scan_seed116.json",  # the teaching scenario's held-out seed
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
    return MomentContext.load("pro_scan", 116)


def test_the_teaching_steps_follow_the_coachs_sequence(coach):
    """`pro_scan`: start view, look left, drop-back, look right, half-turn, forward pass, in time
    order; without the key (right) look, that look is missing and he receives square."""
    runs = build_steps(coach)
    fac, cf = runs["factual"], runs["counterfactual"]
    assert [s.direction for s in fac.steps] == ["L", "R"]
    assert [(s.direction, s.missing) for s in cf.steps] == [("L", False), ("R", True)]
    assert [(b.id, b.happened) for b in fac.beats] == [("drop_back", True), ("half_turn", True)]
    assert [(b.id, b.happened) for b in cf.beats] == [("drop_back", True), ("half_turn", False)]
    assert fac.decision.chosen == "pass:H9" and cf.decision.chosen != "pass:H9"
    for rs in runs.values():
        left, right = rs.steps
        drop, turn = rs.beats
        assert left.frame < drop.frame < right.frame < turn.frame <= rs.decision.frame
        assert turn.frame == rs.reception.frame == drop.end
        # Rule 1 acted after the left look was over, rule 2 after the right one.
        assert int(left.scan.attrs["end"]) < rs.rules["drop_back"]["frame"] == drop.start
        assert int(right.scan.attrs["end"]) < rs.rules["half_turn"]["frame"] < turn.frame
        assert list(rs.lines) == ["intro", left.scan.id, "drop_back", right.scan.id,
                                  "half_turn", "final"]  # fmt: skip
    assert fac.rules["drop_back"]["nearest"] == "A6" and fac.rules["half_turn"]["nearest"] == "A5"
    assert fac.rules["half_turn"]["side"] != 0 and cf.rules["half_turn"]["side"] == 0
    answer = answer_steps(coach)
    for name, rs in answer.runs.items():
        for lang in ("en", "zh"):
            payload = answer.payloads[name][lang]
            assert [line.id for line in payload.lines] == [c.id for c in rs.claims], (name, lang)
            assert all(c.verdict == "supported" for c in payload.claims)


def test_every_look_brings_news_that_opens_or_closes_options(coach):
    """The product owner's rule for the coach's example: each look shows something new, and it
    opens or closes options."""
    fac = build_steps(coach)["factual"]
    for s in fac.steps:
        p = fac.pictures[s.scan.id]
        assert [n for n in p["news"] if n["moved"] > 1.0], s.direction
        assert p["opened"] or p["closed"], s.direction
    left, right = (fac.pictures[s.scan.id] for s in fac.steps)
    assert left["news"][0]["id"] == "A6" and left["news"][0]["after"] < left["news"][0]["before"]
    assert right["news"][0]["id"] == "A5" and "pass:H9" in right["opened"]
    assert "carry" in right["closed"]


@pytest.mark.parametrize("key", [("blind_side_run", 3), ("pro_scan", 116)])
def test_a_pictures_opened_and_closed_follow_its_options(key):
    """The bundle's opened/closed lists are the diff of the options it carries, as the screen
    recomputes it; the start view comes before every look."""
    data = export_steps(*key)
    for raw in data["runs"].values():
        frozen = [s["picture"] for s in raw["steps"] if not s["missing"]]
        frozen += [b["picture"] for b in raw.get("beats", [])]
        assert raw["start"]["frame"] < min(s["start"] for s in raw["steps"])
        for p in frozen:
            was = {o["action"]: o["p"] for o in p["before"]}
            now = {o["action"]: o["p"] for o in p["options"]}
            assert option_changes(was, now) == (p["opened"], p["closed"])
        for s in raw["steps"]:
            assert (s["picture"] is None) is s["missing"]


def test_only_the_teaching_export_carries_labels_and_beats():
    data = export_steps("pro_scan", 116)
    assert data["teaching"] is True
    for raw in data["runs"].values():
        assert [s["direction"] for s in raw["steps"]] == ["L", "R"]
        assert [b["id"] for b in raw["beats"]] == ["drop_back", "half_turn"]
        assert {b["id"]: b["rule"]["frame"] for b in raw["beats"]}["drop_back"] == \
            raw["beats"][0]["frame"]  # fmt: skip
    for key in (("blind_side_run", 3), ("press_escape", 0)):
        text = steps_json(export_steps(*key))
        assert '"teaching"' not in text and '"beats"' not in text and '"direction"' not in text
        assert '"picture"' in text and '"start"' in text


@canonical.linux_only()
@pytest.mark.parametrize(("key", "name"), list(FILES.items()))
def test_committed_steps_files_are_current(key, name):
    fresh = steps_json(export_steps(*key))
    committed = (DATA / name).read_text()
    assert fresh == committed, f"web/public/data/{name} is stale: {canonical.message()}"
