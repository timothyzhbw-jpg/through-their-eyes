"""Acceptance checks for the live match stats timeline (SPEC 4.6, analytics/live_stats.py).

Built only from what the live stream carries: mm tracking, the owner and the event feed. Causal
(truncating the stream at a frame changes nothing up to it), pass outcomes read from the feed
agree with the sim's own, totals add up, the same seed gives the same bytes, and every player
has a fictional name.
"""

import copy
from pathlib import Path

import numpy as np
import pytest

from analytics import stats
from analytics.live_stats import MatchStats, compute_stats, stats_from_run
from sim.export import export_hero, export_match
from sim.roster import ROSTER, full_name, short_name
from tests import canonical

DT = 0.04
WEB_FIXTURE = Path(__file__).resolve().parents[1] / "web/src/stats/fixture_seed3.json"


@pytest.fixture(scope="module")
def hero():
    return export_hero("blind_side_run", 3)


@pytest.fixture(scope="module")
def press():
    return export_hero("press_escape", 0)


@pytest.fixture(scope="module")
def match():
    return export_match(1)


@pytest.fixture(scope="module")
def hero_stats(hero):
    return compute_stats(hero, "blind_side_run-3")


@pytest.fixture(scope="module")
def match_stats(match):
    return compute_stats(match, "match-1")


def truncate(export: dict, frame: int) -> dict:
    """What a live client holds at `frame`: the factual run up to it, events up to it."""
    out = copy.deepcopy(export)
    run = out["runs"]["factual"]
    for key in ("pos", "head", "body", "ball", "owner"):
        run[key] = run[key][: frame + 1]
    run["frames"] = frame + 1
    run["events"] = [e for e in run["events"] if e["frame"] <= frame]
    out["runs"] = {"factual": run}
    return out


def _comparable(snapshot: MatchStats) -> dict:
    data = snapshot.model_dump(mode="json")
    data.pop("frames")  # a truncated stream is shorter; everything else must agree
    return data


# --- a hand-built stream with known answers -----------------------------------------------


def _mm(points) -> list:
    return np.rint(np.asarray(points, dtype=float) * 1000).astype(int).tolist()


def tiny_export(*, possessions=None, frames=60, pass_frames=(10, 35), shot_at=45):
    """H8 passes 20 m along +x to H9 at 20 m/s (kick at 10, received at 35), A4 stands 30 m away;
    then H9 shoots at 30 m/s. Positions in mm, as the stream sends them."""
    players = [
        {"id": "H8", "team": 0, "role": "CM", "number": 8},
        {"id": "H9", "team": 0, "role": "ST", "number": 9},
        {"id": "A4", "team": 1, "role": "CB", "number": 4},
    ]
    kick, received = pass_frames
    ball, owner = [], []
    for f in range(frames):
        if f <= kick:
            b, o = (0.0, 0.0), 0
        elif f < received:
            b, o = (20.0 * DT * (f - kick), 0.0), -1
        elif shot_at is None or f <= shot_at:
            b, o = (20.0, 0.0), 1
        else:
            b, o = (20.0 + 30.0 * DT * (f - shot_at), 0.0), -1
        ball.append(b)
        owner.append(o)
    pos = [_mm([0.0, 0.0, 20.0, 0.0, 10.0, 30.0]) for _ in range(frames)]
    events = [
        {"id": f"pass:H8:{kick:04d}", "type": "pass", "frame": kick, "player": "H8",
         "attrs": {"to": "H9", "outcome": "complete"}},
        {"id": f"reception:H9:{received:04d}", "type": "reception", "frame": received,
         "player": "H9", "attrs": {"at": [20.0, 0.0]}},
    ]  # fmt: skip
    if shot_at is not None:
        events.append({"id": f"shot:H9:{shot_at:04d}", "type": "shot", "frame": shot_at,
                       "player": "H9", "attrs": {}})  # fmt: skip
    run = {"frames": frames, "pos": pos, "ball": _mm(ball), "owner": owner, "events": events,
           "head": [[0, 0, 0]] * frames, "body": [[0, 0, 0]] * frames}  # fmt: skip
    export = {"version": 5, "scenario": "tiny", "seed": 0, "dt": DT, "players": players,
              "runs": {"factual": run}}  # fmt: skip
    if possessions is not None:
        export |= {"kind": "match", "match": {"possessions": possessions}}
    return export


def test_a_hand_built_pass_and_shot_give_the_known_numbers():
    s = compute_stats(tiny_export(), "tiny").snapshot()
    (pass_cue,) = [c for c in s.cues if c.kind == "pass"]
    assert (pass_cue.kick, pass_cue.frame) == (10, 35)
    assert (pass_cue.player, pass_cue.receiver) == ("H8", "H9")
    assert pass_cue.outcome == "complete"
    assert pass_cue.distance_m == pytest.approx(20.0)
    assert pass_cue.ball_kmh == pytest.approx(72.0)
    # A4 is 30 m away and the passer and receiver are unpressed: only the distance term is left.
    assert pass_cue.components.lane == pytest.approx(0.0, abs=1e-3)
    assert pass_cue.components.passer == pytest.approx(0.0, abs=1e-3)
    assert pass_cue.components.receiver == pytest.approx(0.0, abs=1e-3)
    assert pass_cue.components.distance == pytest.approx(0.4)
    assert pass_cue.difficulty == pytest.approx(0.08, abs=1e-3)
    assert pass_cue.band == "routine"
    (shot,) = [c for c in s.cues if c.kind == "shot"]
    assert (shot.kick, shot.frame, shot.player) == (45, 50, "H9")  # final 0.2 s after the strike
    assert shot.speed_kmh == pytest.approx(108.0)
    h8 = next(p for p in s.players if p.id == "H8")
    assert (h8.passes, h8.completed, h8.accuracy) == (1, 1, 1.0)
    h9 = next(p for p in s.players if p.id == "H9")
    assert (h9.shots, h9.top_shot_kmh) == (1, pytest.approx(108.0))
    home = next(t for t in s.teams if t.team == 0)
    assert (home.passes, home.completed, home.shots) == (1, 1, 1)


def test_without_shot_events_there_are_no_shot_cues():
    s = compute_stats(tiny_export(shot_at=None), "tiny").snapshot()
    assert not [c for c in s.cues if c.kind == "shot"]
    assert all(p.top_shot_kmh is None for p in s.players)


def test_a_pass_still_in_flight_when_the_possession_ends_is_not_counted():
    possessions = [{"index": 0, "start": 0}, {"index": 1, "start": 30}]
    export = tiny_export(possessions=possessions, shot_at=None)
    s = compute_stats(export, "tiny").snapshot()
    assert not [c for c in s.cues if c.kind == "pass"]  # kicked at 10, the cut came at 30
    assert all(p.passes == 0 for p in s.players)


# --- causality: what is known at a frame never changes later -----------------------------


def _probe_frames(timeline) -> list[int]:
    """Frames inside a pass's flight and inside a sprint, plus a few fixed ones."""
    cues = timeline.snapshot().cues
    frames = [40, timeline.frames // 2]
    if passes := [c for c in cues if c.kind == "pass"]:
        frames.append((passes[0].kick + passes[0].frame) // 2)
    if sprints := [c for c in cues if c.kind == "sprint"]:
        frames.append((sprints[0].start + sprints[0].end) // 2)
    return sorted(set(frames))


@pytest.mark.parametrize("which", ["hero_stats", "match_stats"])
def test_stats_are_causal_truncating_the_stream_changes_nothing_up_to_that_frame(which, request):
    timeline = request.getfixturevalue(which)
    export = request.getfixturevalue("hero" if which == "hero_stats" else "match")
    for f in _probe_frames(timeline):
        live = compute_stats(truncate(export, f), timeline.match).snapshot()
        assert _comparable(live) == _comparable(timeline.snapshot(frame=f)), f"frame {f}"


@pytest.mark.parametrize("cut", [48, 52, 58])
def test_a_shot_is_causal_whether_the_cut_comes_inside_or_after_its_release_window(cut):
    """Shot at 45; its release window ends at 50. A cut at 48 ends it early (cued at 48)."""
    possessions = [{"index": 0, "start": 0}, {"index": 1, "start": cut}]
    export = tiny_export(possessions=possessions)
    full = compute_stats(export, "tiny")
    shots = [c for c in full.snapshot().cues if c.kind == "shot"]
    assert [c.frame for c in shots] == [48 if cut == 48 else 50]
    for f in range(40, 60):
        live = compute_stats(truncate(export, f), "tiny").snapshot()
        assert _comparable(live) == _comparable(full.snapshot(frame=f)), f"frame {f}"


def test_a_snapshot_only_holds_cues_final_by_its_frame(match_stats):
    f = match_stats.frames // 3
    snap = match_stats.snapshot(frame=f)
    assert snap.frame == f and snap.t == pytest.approx(round(f * DT, 2))
    assert snap.cues and all(c.frame <= f for c in snap.cues)
    later = match_stats.snapshot()
    assert len(later.cues) > len(snap.cues)


# --- passes read from the feed agree with the sim -------------------------------------------


@pytest.mark.parametrize("which", ["hero", "press", "match"])
def test_pass_outcomes_from_the_feed_match_the_sims_own(which, request):
    export = request.getfixturevalue(which)
    events = export["runs"]["factual"]["events"]
    passes = {e["id"]: e for e in events if e["type"] == "pass"}
    cues = {c.id: c for c in compute_stats(export, which).snapshot().cues if c.kind == "pass"}
    resolved = {pid for pid, e in passes.items() if e["attrs"].get("outcome") is not None}
    assert set(cues) == resolved
    for pid, cue in cues.items():
        attrs = passes[pid]["attrs"]
        assert cue.outcome == attrs["outcome"], pid
        assert cue.kick == passes[pid]["frame"]
        assert cue.frame == attrs["end"], pid
        if cue.outcome == "complete":
            assert cue.receiver == attrs.get("receiver", attrs["to"]), pid


# --- cues and totals ------------------------------------------------------------------------


def test_cues_are_sorted_and_timecoded(hero_stats, match_stats):
    for timeline, is_match in ((hero_stats, False), (match_stats, True)):
        cues = timeline.snapshot().cues
        assert [c.frame for c in cues] == sorted(c.frame for c in cues)
        assert len({c.id for c in cues}) == len(cues)
        for c in cues:
            assert c.t == pytest.approx(round(c.frame * DT, 2))
            assert (c.possession is not None) == is_match
    # A cue belongs to the possession where it happened: the kick, the sprint's first frame.
    starts = [p["start"] for p in match_stats.export["match"]["possessions"]]
    for c in match_stats.snapshot().cues:
        at = {"pass": "kick", "shot": "kick", "sprint": "start", "distance": "frame"}[c.kind]
        assert c.possession == int(np.searchsorted(starts, getattr(c, at), side="right")) - 1


def test_sprint_and_distance_cues_meet_their_thresholds(match_stats):
    snap = match_stats.snapshot()
    sprints = [c for c in snap.cues if c.kind == "sprint"]
    assert sprints, "match-1 has sprints"
    for c in sprints:
        assert c.peak_kmh > 25.2 and c.end - c.start >= stats.SPRINT_MIN_FRAMES
        assert c.start <= c.peak_frame < c.end <= c.frame
        assert c.distance_m > 0
    distances = [c for c in snap.cues if c.kind == "distance"]
    assert distances, "match-1 players pass 250 m"
    for c in distances:
        assert c.metres % 250 == 0 and c.metres > 0
        j = match_stats.ids.index(c.player)
        assert match_stats.distance[c.frame, j] >= c.metres > match_stats.distance[c.frame - 1, j]


def test_player_and_team_totals_add_up(match_stats):
    snap = match_stats.snapshot()
    cues = snap.cues
    for p in snap.players:
        mine = [c for c in cues if c.kind == "pass" and c.player == p.id]
        assert p.passes == len(mine)
        assert p.completed == sum(c.outcome == "complete" for c in mine)
        if mine:
            assert p.accuracy == pytest.approx(p.completed / p.passes, abs=1e-4)
            mean = np.mean([c.difficulty for c in mine])
            assert p.mean_difficulty == pytest.approx(mean, abs=0.01)
        else:
            assert p.accuracy is None and p.mean_difficulty is None
        runs = [c for c in cues if c.kind == "sprint" and c.player == p.id]
        assert p.sprints == len(runs)
        assert all(p.top_kmh >= c.peak_kmh for c in runs)
        assert p.distance_m >= p.hsr_m >= p.sprint_m >= 0
    for t in snap.teams:
        mine = [p for p in snap.players if p.team == t.team]
        assert t.passes == sum(p.passes for p in mine)
        assert t.completed == sum(p.completed for p in mine)
        assert t.distance_m == pytest.approx(sum(p.distance_m for p in mine), abs=0.5)


def test_difficulty_is_in_the_unit_interval_and_its_parts_follow_the_formula(match_stats):
    for c in (c for c in match_stats.snapshot().cues if c.kind == "pass"):
        parts = c.components.model_dump()
        value, _ = stats.pass_difficulty(
            parts["lane"], parts["passer"], parts["receiver"], c.distance_m
        )
        assert 0.0 <= c.difficulty <= 1.0
        assert c.difficulty == pytest.approx(value, abs=0.01)  # parts are rounded to 0.01
        assert c.band == stats.difficulty_band(c.difficulty)


# --- tracks for viewers ---------------------------------------------------------------------


def test_tracks_carry_checkpoints_ball_speed_and_runs_above_high_speed(match_stats):
    snap = match_stats.snapshot(tracks=True)
    tr = snap.tracks
    assert tr is not None and tr.every == 25
    n = len(snap.players)
    frames = match_stats.frames
    assert len(tr.distance_dm) == (frames - 1) // 25 + 1
    for c in (0, 7, len(tr.distance_dm) - 1):
        f = c * 25
        assert tr.distance_dm[c] == np.rint(match_stats.distance[f] * 10).astype(int).tolist()
        at = match_stats.snapshot(frame=f)
        assert [p.distance_m for p in at.players] == pytest.approx(
            [d / 10 for d in tr.distance_dm[c]], abs=0.051
        )
    assert len(tr.ball_kmh10) == frames
    assert tr.ball_kmh10 == np.rint(match_stats.ball_speed * 36).astype(int).tolist()
    above = np.zeros((frames, n), dtype=bool)
    fast = np.zeros((frames, n), dtype=bool)
    for r in tr.speed:
        j = match_stats.ids.index(r.player)
        above[r.start : r.start + len(r.kmh10), j] = True
        assert min(r.kmh10) >= 198  # rounded to 0.1 km/h: 5.5 m/s is 198.0
        for a, b in r.sprint:  # stretches above 25.2 km/h, compared in m/s as the cues are
            assert r.start <= a < b <= r.start + len(r.kmh10)
            fast[a:b, j] = True
        assert (
            r.kmh10
            == np.rint(match_stats.speed[r.start : r.start + len(r.kmh10), j] * 36)
            .astype(int)
            .tolist()
        )
    assert np.array_equal(above, match_stats.speed > stats.HSR_MPS)
    assert np.array_equal(fast, match_stats.speed > stats.SPRINT_MPS)
    # Top speed so far at every checkpoint, for players who never pass 19.8 km/h too.
    top = np.maximum.accumulate(match_stats.speed, axis=0)
    assert len(tr.top_kmh10) == len(tr.distance_dm)
    for c, row in enumerate(tr.top_kmh10):
        assert row == np.rint(top[c * 25] * 36).astype(int).tolist()
    assert match_stats.snapshot().tracks is None  # only when asked for


# --- determinism, names, other inputs -------------------------------------------------------


def test_the_same_seed_gives_byte_identical_stats(match_stats):
    again = compute_stats(export_match(1), "match-1")
    a = match_stats.snapshot(tracks=True).model_dump_json()
    assert a == again.snapshot(tracks=True).model_dump_json()


def test_every_player_has_a_fictional_name(match_stats):
    players = match_stats.snapshot().players
    assert {p.id for p in players} <= set(ROSTER)
    assert len({full_name(pid) for pid in ROSTER}) == len(ROSTER)
    assert len({ROSTER[pid][1] for pid in ROSTER}) == len(ROSTER)  # surnames tell them apart
    for p in players:
        first, last = ROSTER[p.id]
        assert p.name == f"{first} {last}" == full_name(p.id)
        assert p.short == f"{first[0]}. {last}" == short_name(p.id)
    assert full_name("X99") == "X99" and short_name("X99") == "X99"  # unknown ids stay ids


def test_stats_from_a_sim_run_equal_the_stats_from_its_export(hero, hero_stats):
    from sim.engine import Simulation

    run = Simulation.from_scenario("blind_side_run", 3).run()
    assert stats_from_run(run, "blind_side_run-3").snapshot().model_dump() == (
        hero_stats.snapshot().model_dump()
    )


@canonical.linux_only()
def test_the_web_fixture_is_current(hero_stats):
    """The viewer's parity test (web/src/stats/stats.test.ts) runs on this output."""
    from analytics.live_stats import FIXTURE_FRAMES, web_fixture

    assert all(f % 25 == 0 for f in FIXTURE_FRAMES)
    assert WEB_FIXTURE.read_text() == web_fixture(hero_stats), (
        "stale: uv run python -m analytics.live_stats --scenario blind_side_run --seed 3 "
        "--web-fixture web/src/stats/fixture_seed3.json"
    )
