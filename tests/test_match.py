"""A stitched match (SPEC 3.1): possessions back to back on one clock, with restarts and a score."""

import numpy as np
import pytest

from explain.match import match_moments
from sim.config import DT
from sim.export import export_match
from sim.match import (
    DEFAULT_PLAN,
    EDITS,
    KICK_OFF_S,
    OPEN_PLAY_S,
    OUT_OF_PLAY,
    SET_PIECES,
    PossessionSpec,
    build_match,
    ends_out_of_play,
    first_fit,
    global_id,
    open_play_seed,
    restart_after,
    score_after,
)
from sim.model import Event

SEED = 1


@pytest.fixture(scope="module")
def match():
    return build_match(SEED)


@pytest.fixture(scope="module")
def moments(match):
    return match_moments(match)


@pytest.fixture(scope="module")
def export(match, moments):
    return export_match(SEED, match, moments)


def test_the_default_match_has_15_to_25_possessions_and_10_to_15_min_of_play(match):
    assert 15 <= len(DEFAULT_PLAN) <= 25
    assert len(match.possessions) == len(DEFAULT_PLAN)
    assert 600 <= match.duration_s <= 900


def test_the_default_match_includes_every_scenario_on_main(match):
    scenarios = {p.scenario for p in match.possessions}
    assert {"possession_play", "blind_side_run", "press_escape", "corner_blind_side"} <= scenarios


def test_time_is_continuous_across_possessions(match):
    start = 0
    for p in match.possessions:
        assert p.start == start
        start += p.frames
    assert match.frames == start
    assert match.duration_s == pytest.approx(start * DT)


def test_hero_possessions_keep_their_seeds_and_open_play_is_keyed_by_the_match(match):
    heroes = {p.scenario: p.seed for p in match.possessions if p.scenario != "possession_play"}
    assert heroes == {"blind_side_run": 3, "press_escape": 0, "corner_blind_side": 0}
    play = [p for p in match.possessions if p.scenario == "possession_play"]
    assert len({p.seed for p in play}) == len(play)
    assert all(p.seed >= 1_000_000 for p in play)  # never a design or eval seed
    edit = EDITS[SEED]
    assert [p.seed for p in play] == [open_play_seed(SEED, n, edit[n]) for n in range(len(play))]
    assert open_play_seed(1, 0) != open_play_seed(2, 0)
    assert open_play_seed(1, 0) != open_play_seed(1, 0, 1)


def test_every_open_play_passage_ends_out_of_play_inside_its_window(match):
    edit = EDITS[SEED]
    n = 0
    for spec, p in zip(DEFAULT_PLAN, match.possessions, strict=True):
        if spec.seed is not None:
            assert p.attempt is None
            continue
        assert spec.window_s is not None
        assert p.attempt == edit[n]
        assert ends_out_of_play(p.run, spec.window_s)
        n += 1
    assert n == len(edit)


def test_the_edit_is_the_first_attempt_that_ends_out_of_play():
    assert first_fit(SEED, 0, KICK_OFF_S) == EDITS[SEED][0]
    assert first_fit(SEED, 1, OPEN_PLAY_S) == EDITS[SEED][1]


def test_a_stale_or_wrong_length_edit_is_refused():
    # The committed kick-off fit is attempt 1 (see first_fit), so attempt 0 does not fit.
    assert EDITS[SEED][0] == 1
    with pytest.raises(ValueError, match=r"passage 0 \(possession 0\)"):
        build_match(SEED, edit=(0,) * 17)
    with pytest.raises(ValueError, match="the edit lists"):
        build_match(SEED, edit=(1,))


def test_a_plan_without_an_edit_is_not_checked_and_seeds_differ():
    plan = (PossessionSpec("possession_play", window_s=(0.0, 5.0)),) * 2
    a, b = build_match(2, plan), build_match(3, plan)
    assert [p.attempt for p in a.possessions] == [0, 0]
    assert a.to_bytes() != b.to_bytes()


def test_same_match_seed_is_byte_identical(match):
    assert build_match(SEED).to_bytes() == match.to_bytes()


def test_restarts_follow_the_stoppage_except_a_set_piece_declares_its_own(match):
    assert match.possessions[0].restart == "kick_off"
    pairs = zip(DEFAULT_PLAN, match.possessions, match.possessions[1:], strict=False)
    for spec, prev, cur in pairs:
        if cur.scenario in SET_PIECES:
            assert cur.restart == SET_PIECES[cur.scenario]
        else:
            assert cur.restart == restart_after(prev.run)
        if spec.seed is None:  # the possession after an open-play passage is a real stoppage
            assert cur.restart in OUT_OF_PLAY


def test_the_corner_hero_takes_the_corner_the_passage_before_it_gave_away(match):
    # The away team's corner at the home goal (corner_blind_side): in match 1 the open-play
    # passage before it ends with a home player putting the ball over his own goal line.
    k = next(p.index for p in match.possessions if p.scenario == "corner_blind_side")
    before = match.possessions[k - 1]
    out = max((e for e in before.run.events if e.type == "out"), key=lambda e: e.frame)
    assert restart_after(before.run) == "corner" == match.possessions[k].restart
    assert out.team == 0 and out.attrs["at"][0] < 0 and out.attrs["at"][1] > 0  # its flag side


def _out(x: float, y: float, team: int) -> Event:
    return Event("out:H4:0010", "out", 10, 0.4, "H4" if team == 0 else "A4", team,
                 {"at": [x, y]})  # fmt: skip


@pytest.mark.parametrize(
    ("x", "y", "team", "restart"),
    [(10.0, 34.5, 0, "throw_in"), (53.0, 5.0, 0, "goal_kick"), (53.0, 5.0, 1, "corner"),
     (-53.0, 5.0, 1, "goal_kick"), (-53.0, 5.0, 0, "corner")],
)  # fmt: skip
def test_a_ball_out_of_play_sets_the_restart(x, y, team, restart):
    class Run:
        events = [_out(x, y, team)]

    assert restart_after(Run) == restart


def test_a_possession_that_ends_in_play_is_a_cut():
    class Run:
        events = []

    assert restart_after(Run) == "cut"


def test_a_goal_is_followed_by_a_kick_off():
    class Run:
        events = [Event("goal:H9:0100", "goal", 100, 4.0, "H9", 0, {})]

    assert restart_after(Run) == "kick_off"


def test_the_score_counts_goals_and_carries_over(match):
    goal = Event("goal:H9:0100", "goal", 100, 4.0, "H9", 0, {})
    assert score_after((0, 0), [goal]) == (1, 0)
    assert score_after((1, 2), []) == (1, 2)
    score = (0, 0)
    for p in match.possessions:
        assert p.score_before == score
        score = score_after(score, p.run.events)
    assert match.score == score == (0, 0)


def test_event_ids_move_to_match_time():
    assert global_id("pass:H8:0075", 1000) == "pass:H8:1075"
    assert global_id("m:decision_after_scan:H8:0075", 1000) == "m:decision_after_scan:H8:1075"


def test_the_first_hero_moment_comes_within_40_s_of_kick_off(moments):
    hero = next(m for m in moments if m["hero"])
    assert hero["anchor_t"] <= 40


def test_moments_are_detected_in_every_possession_and_lifted_to_match_time(match, moments):
    ids = [m["id"] for m in moments]
    assert len(ids) == len(set(ids))
    by_possession = {m["possession"] for m in moments}
    hero = [p.index for p in match.possessions if p.run.hero_decision() is not None]
    assert set(hero) <= by_possession
    for m in moments:
        p = match.possessions[m["possession"]]
        assert p.start <= m["frame_start"] <= m["anchor_frame"] <= m["frame_end"] < p.end
        assert m["anchor_t"] == pytest.approx(m["anchor_frame"] * DT, abs=1e-4)
        assert m["id"] == global_id(m["local_id"], p.start)
    lenses = {m["actor"]: m["selected_lens"] for m in moments if m["hero"]}
    assert lenses == {"H8": "scan", "H4": "pressure"}


def test_the_match_export_is_the_hero_run_schema_plus_a_match_block(match, export):
    f = export["runs"]["factual"]
    assert export["kind"] == "match"
    assert f["frames"] == match.frames
    for key in ("pos", "head", "body", "ball", "owner"):
        assert len(f[key]) == match.frames
    assert len(f["blind_side"]["frames"]) == match.frames
    frames = [e["frame"] for e in f["events"]]
    assert frames == sorted(frames) and frames[-1] < match.frames
    assert len({e["id"] for e in f["events"]}) == len(f["events"])
    blocks = export["match"]["possessions"]
    assert [b["start"] for b in blocks] == [p.start for p in match.possessions]
    assert [b["restart"] for b in blocks] == [p.restart for p in match.possessions]
    assert export["match"]["score"] == {"home": match.score[0], "away": match.score[1]}
    assert [m["id"] for m in export["moments"]] == [m["id"] for m in match_moments(match)]


def test_the_match_export_keeps_the_tracking_of_each_possession(match, export):
    f = export["runs"]["factual"]
    p = next(p for p in match.possessions if p.scenario == "blind_side_run")
    k = p.start + 10
    np.testing.assert_array_equal(
        np.array(f["pos"][k]).reshape(-1, 2), np.rint(p.run.pos[10] * 1000).astype(int)
    )
    events = {e["id"]: e for e in f["events"]}
    local = next(e for e in p.run.events if e.type == "pass" and e.attrs.get("end") is not None)
    lifted = events[global_id(local.id, p.start)]
    assert lifted["frame"] == local.frame + p.start
    assert lifted["attrs"]["end"] == local.attrs["end"] + p.start
    assert lifted["possession"] == p.index
