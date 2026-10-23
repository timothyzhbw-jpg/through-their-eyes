"""Acceptance checks for the tactics cards (SPEC 4.8, analytics/tactics.py, explain/tactics.py).

- The kernels give the known answers on a hand-built two-passage match: which passes are build-up,
  pressed, short or long, line-breaking or lost, their xT, the corner's peak, its shot and xG.
- On the heroes they read what the sim did: the pressure hero's escape and its recorded options,
  the corner hero's cutback.
- The cards of an export equal the cards of the run it was made from, so the panel's numbers and
  the Verifier's are the same measurement; same input, same bytes.
- Each card's sentence is a supported claim that renders in English and Chinese, and a wrong
  number in it is refuted.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from analytics.live_stats import compute_stats
from analytics.tactics import (
    LONG_PASS_M,
    MIN_BYPASSED,
    PRESSED,
    Passage,
    TacticsCards,
    attack_sign,
    bypassed,
    distance_xg_at,
    match_passages,
    own_half,
    pass_value,
    passages_of,
    stat,
    tactics_cards,
    tactics_from_run,
    tactics_input,
)
from analytics.xt import xt_for
from explain.claims import Slot
from explain.functions import EvalContext
from explain.recap import stitched_run
from explain.render import check_payload
from explain.tactics import (
    WEB_FIXTURE,
    fixture_view,
    tactics_claims,
    view_for_match,
    view_for_run,
    web_fixture,
)
from explain.verifier import Verifier
from sim.decision import distance_xg
from sim.engine import Simulation
from sim.export import export_match
from sim.match import PossessionSpec, build_match
from tests import canonical

DT = 0.04

# --- a hand-built match: home build-up, then an away corner ----------------------------------

PLAYERS = [
    ("H1", 0, "GK"), ("H4", 0, "CB"), ("H5", 0, "CB"), ("H7", 0, "W"),
    ("A1", 1, "GK"), ("A9", 1, "ST"), ("A10", 1, "AM"),
]  # fmt: skip
# Passage 0 (frames 0–59): H5 plays long to H7 past A9 and A10; H4, with A9 at his shoulder,
# plays short to H5 and A9 cuts it out. Passage 1 (60–119): A10's corner to A9, who shoots.
OPEN = {"H1": (-50, 0), "H4": (-30, 0), "H5": (-30, 10), "H7": (5, 10),
        "A1": (50, 0), "A9": (-29, 1), "A10": (-20, 15)}  # fmt: skip
CORNER = {"H1": (-51, 0), "H4": (-45, 3), "H5": (-44, -4), "H7": (-30, 20),
          "A1": (50, 0), "A9": (-40, 5), "A10": (-52, 33)}  # fmt: skip
INTERCEPTED_AT = (-29.0, 1.0)
GOAL = (-52.5, 0.0)


def _path(ball: np.ndarray, f0: int, f1: int, a, b) -> None:
    for f in range(f0, f1 + 1):
        u = (f - f0) / (f1 - f0)
        ball[f] = (1 - u) * np.asarray(a, float) + u * np.asarray(b, float)


def toy_export() -> dict:
    frames = 120
    ids = [p for p, _, _ in PLAYERS]
    pos = np.zeros((frames, len(ids), 2))
    for f in range(frames):
        where = OPEN if f < 60 else CORNER
        pos[f] = [where[p] for p in ids]
    ball = np.zeros((frames, 2))
    ball[:5] = OPEN["H5"]
    _path(ball, 5, 25, OPEN["H5"], OPEN["H7"])
    ball[26:30] = OPEN["H4"]
    _path(ball, 30, 34, OPEN["H4"], INTERCEPTED_AT)
    ball[35:60] = INTERCEPTED_AT
    ball[60:65] = CORNER["A10"]
    _path(ball, 65, 85, CORNER["A10"], CORNER["A9"])
    ball[86:90] = CORNER["A9"]
    _path(ball, 90, 100, CORNER["A9"], GOAL)
    ball[101:] = GOAL

    def ev(kind: str, frame: int, player: str, **attrs) -> dict:
        return {"id": f"{kind}:{player}:{frame:04d}", "type": kind, "frame": frame,
                "player": player, "attrs": attrs}  # fmt: skip

    events = [
        ev("pass", 5, "H5", to="H7"), ev("reception", 25, "H7"),
        ev("pass", 30, "H4", to="H5"), ev("interception", 34, "A9"),
        ev("pass", 65, "A10", to="A9"), ev("reception", 85, "A9"),
        ev("shot", 90, "A9"),
    ]  # fmt: skip
    mm = lambda a: np.rint(a * 1000).astype(int).reshape(frames, -1).tolist()  # noqa: E731
    return {
        "kind": "match",
        "dt": DT,
        "players": [
            {"id": p, "team": t, "role": r, "number": i + 1} for i, (p, t, r) in enumerate(PLAYERS)
        ],  # fmt: skip
        "match": {
            "possessions": [
                {
                    "index": 0,
                    "start": 0,
                    "frames": 60,
                    "restart": "kick_off",
                    "scenario": "possession_play",
                },
                {
                    "index": 1,
                    "start": 60,
                    "frames": 60,
                    "restart": "corner",
                    "scenario": "corner_blind_side",
                },
            ]
        },  # fmt: skip
        "runs": {"factual": {"frames": frames, "pos": mm(pos), "ball": mm(ball), "events": events}},
    }


@pytest.fixture(scope="module")
def toy() -> TacticsCards:
    timeline = compute_stats(toy_export(), "toy")
    return tactics_cards(tactics_input(timeline))


def test_the_toy_setup_presses_h4_and_not_h5():
    cues = {c.player: c for c in compute_stats(toy_export(), "toy").cues if c.kind == "pass"}
    assert cues["H4"].components.passer >= PRESSED > cues["H5"].components.passer


def test_build_up_counts_on_the_toy_match(toy):
    home, away = toy.build_up.teams
    assert toy.build_up.team == 0  # the home team played the build-up passes
    assert (home.all.passes, home.all.completed, home.all.completion) == (2, 1, 0.5)
    assert (home.pressed.passes, home.pressed.completed) == (1, 0)
    assert (home.unpressed.passes, home.unpressed.completed) == (1, 1)
    assert (home.short.passes, home.short.completed) == (1, 0)  # H4 → H5, 10 m
    assert (home.long.passes, home.long.completed) == (1, 1)  # H5 → H7, 35 m
    assert (home.pressed_short.passes, home.lost_pressed_short) == (1, 1)
    assert home.pressed_short_ids == ["pass:H4:0030"]
    assert (home.line_breaking, home.line_breaking_pressed) == (1, 0)
    assert away.all.passes == 0  # A10's corner is in the away team's attacking half


def test_build_up_xt_on_the_toy_match(toy):
    home = toy.build_up.teams[0]
    gained = xt_for(np.array(OPEN["H7"], float), 1) - xt_for(np.array(OPEN["H5"], float), 1)
    handed = xt_for(np.array(INTERCEPTED_AT), -1)
    lost = -handed - xt_for(np.array(OPEN["H4"], float), 1)
    assert home.long.xt == pytest.approx(gained, abs=1e-4)
    assert home.short.xt == pytest.approx(lost, abs=1e-4)
    assert home.lost_xt == home.lost_pressed_short_xt == pytest.approx(handed, abs=1e-4)


def test_set_pieces_on_the_toy_match(toy):
    sp = toy.set_pieces
    assert (sp.awarded, sp.corners, sp.shots, sp.shots_from_corners) == (1, 1, 1, 1)
    xg = distance_xg(math.dist(GOAL, CORNER["A9"]))
    assert sp.xg_from_corners == sp.xg == sp.xg_per_corner == pytest.approx(xg, abs=1e-4)
    assert sp.shot_share == sp.xg_share == 1.0
    best = sp.best
    assert best is not None and best.team == 1 and best.played and best.peak_player == "A9"
    assert best.peak_pass == "pass:A10:0065" and best.peak_s == pytest.approx(20 * DT)
    assert best.peak_xt == pytest.approx(xt_for(np.array(CORNER["A9"], float), -1), abs=1e-4)
    open_peak = xt_for(np.array(OPEN["H7"], float), 1)  # passage 0's only completed pass
    assert sp.open_play == 1 and sp.open_play_peak_median == pytest.approx(open_peak, abs=1e-4)
    assert sp.below_best == 1


def test_a_corner_restarted_as_open_play_is_awarded_but_not_played():
    export = toy_export()
    export["match"]["possessions"][1]["scenario"] = "possession_play"
    cards = tactics_cards(tactics_input(compute_stats(export, "toy")))
    sp = cards.set_pieces
    assert (sp.awarded, sp.corners, sp.shots_from_corners, sp.best) == (1, 0, 0, None)
    assert sp.xg_per_corner is None and sp.shot_share == 0.0


# --- the kernels on their own ------------------------------------------------------------------


def test_own_half_and_attack_sign():
    assert attack_sign(0) == 1 and attack_sign(1) == -1
    assert own_half(-0.1, 0) and not own_half(0.1, 0)
    assert own_half(0.1, 1) and not own_half(-0.1, 1)


def test_bypassed_counts_opponents_goal_side_at_the_kick_and_behind_at_the_reception():
    kick = np.array([[-10.0, 0], [5.0, 3], [20.0, -4], [-15.0, 2]])
    end = np.array([[-10.0, 0], [5.0, 3], [20.0, -4], [-15.0, 2]])
    ball0, ball1 = np.array([0.0, 0]), np.array([10.0, 0])
    assert bypassed(kick, end, ball0, ball1, np.arange(4), 1) == 1  # only the one at x = 5
    assert bypassed(-kick, -end, -ball0, -ball1, np.arange(4), -1) == 1  # mirrored, away team
    assert bypassed(kick, end, ball0, ball1, np.array([0, 2, 3]), 1) == 0
    assert MIN_BYPASSED == 2


def test_pass_value_is_symmetric_under_team_swap_and_pitch_flip():
    a, b = np.array([-20.0, 5.0]), np.array([10.0, -8.0])
    for completed in (True, False):
        assert pass_value(a, b, completed, 1) == pytest.approx(pass_value(-a, -b, completed, -1))
    assert pass_value(a, b, True, 1) == pytest.approx(xt_for(b, 1) - xt_for(a, 1))
    assert pass_value(a, b, False, 1) == pytest.approx(-xt_for(b, -1) - xt_for(a, 1))


def test_distance_xg_is_the_sim_shot_model():
    assert distance_xg_at(np.array([46.5, 0.0]), 0) == pytest.approx(0.35)
    assert distance_xg_at(np.array([-46.5, 0.0]), 1) == pytest.approx(0.35)
    assert distance_xg_at(np.array([52.0, 0.0]), 0) == 0.6  # capped
    far = distance_xg_at(np.array([20.0, 0.0]), 0)
    assert far == pytest.approx(0.35 * math.exp(-(32.5 - 6.0) / 7.0))


def test_stat_reads_the_cards_by_path(toy):
    assert stat(toy, "build_up.pressed_short.passes", 0) == 1
    assert stat(toy, "set_pieces.best.peak_player") == "A9"
    for bad in (("build_up.all.passes", None), ("nope.x", 0), ("set_pieces.nope", None)):
        with pytest.raises(KeyError):
            stat(toy, *bad)


# --- the heroes ---------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def press_run():
    return Simulation.from_scenario("press_escape", 0).run()


def test_the_pressure_hero_records_the_long_escape_and_the_short_options(press_run):
    cards = tactics_from_run(press_run, "press_escape-0", None, _decisions(press_run))
    (alt,) = cards.build_up.alternatives
    decision = press_run.hero_decision()
    assert alt.player == decision.player == "H4" and alt.frame == decision.frame
    assert alt.chosen.action == decision.chosen == "pass:H7" and alt.chosen.long
    options = {o.action: o for o in decision.options}
    passes = [o for o in decision.options if o.kind == "pass"]
    shorts = [o for o in passes if not _long(press_run, o, alt.frame)]
    assert alt.best_short is not None and not alt.best_short.long
    assert alt.best_short.action == max(shorts, key=lambda o: o.value).action
    assert alt.best_short.value == pytest.approx(options[alt.best_short.action].value, abs=1e-4)
    assert alt.safest is not None and alt.safest.p_success == pytest.approx(
        max(o.p_success for o in decision.options if o.kind == "pass"), abs=1e-4
    )
    assert alt.pressure is not None and alt.pressure >= PRESSED
    assert alt.options == len(decision.options)


def test_the_corner_hero_reaches_the_cutback_and_takes_no_shot():
    run = Simulation.from_scenario("corner_blind_side", 0).run()
    sp = tactics_from_run(run, "corner_blind_side-0").set_pieces
    assert (sp.awarded, sp.corners, sp.shots, sp.xg_from_corners) == (1, 1, 0, 0.0)
    cutback = next(e for e in run.events if e.type == "pass" and e.player == "A11")
    assert sp.best is not None and sp.best.peak_player == cutback.attrs["to"] == "A9"
    assert sp.best.peak_pass == cutback.id


def _decisions(run):
    from analytics.tactics import decision_records

    return decision_records(run.decisions)


def _long(run, option, frame) -> bool:
    j = run.index(option.target_player)
    return float(np.linalg.norm(run.pos[frame, j] - run.ball_pos[frame, :2])) >= LONG_PASS_M


# --- the export and the run measure the same; the sentences are verified -----------------------


@pytest.fixture(scope="module")
def short_match():
    plan = (
        PossessionSpec("possession_play", max_s=20.0),
        PossessionSpec("press_escape", 0),
        PossessionSpec("possession_play", max_s=20.0),
        PossessionSpec("corner_blind_side", 0),
    )
    return build_match(1, plan)


def test_the_cards_of_the_export_equal_the_cards_of_the_run(short_match):
    export = export_match(1, short_match)
    timeline = compute_stats(export, "fixture")
    passages = passages_of(export, timeline.frames)
    assert passages == match_passages(short_match)
    from_export = tactics_cards(tactics_input(timeline, passages))
    from_run = tactics_from_run(stitched_run(short_match), "fixture", passages)
    assert from_export.model_dump() == from_run.model_dump()


def test_same_input_same_bytes(short_match):
    a = view_for_match(short_match, "fixture").model_dump_json()
    b = view_for_match(short_match, "fixture").model_dump_json()
    assert a == b


def test_each_sentence_is_supported_and_renders_in_both_languages(short_match):
    view = view_for_match(short_match, "fixture")
    for lang in ("en", "zh"):
        payload = view.lines[lang]
        assert [line.id for line in payload.lines] == ["build_up", "set_pieces"]
        assert all(c.verdict == "supported" for c in payload.claims)
        assert check_payload(payload) == []
    en = {line.id: line.text for line in view.lines["en"].lines}
    assert en["build_up"].startswith("Building short under pressure, Home kept the ball on ")
    assert "A9 got the ball" in en["set_pieces"] and "no shot followed" in en["set_pieces"]


def test_a_wrong_number_in_a_sentence_is_refuted(short_match):
    cards = view_for_match(short_match, "fixture").cards
    run = stitched_run(short_match)
    ctx = EvalContext(run, resimulate=False, passages=tuple(match_passages(short_match)))
    for claim in tactics_claims(cards):
        assert Verifier(ctx).verify(claim).supported, claim.id
        for name, s in claim.slots.items():
            if s.value is None:
                continue
            wrong = s.value + 1 if isinstance(s.value, int) else round(s.value * 1.2 + 0.1, 3)
            bad = claim.model_copy(
                update={"slots": {**claim.slots, name: Slot(value=wrong, decimals=s.decimals)}}
            )
            assert Verifier(ctx).verify(bad).status == "refuted", (claim.id, name)


def test_a_hero_without_a_corner_has_no_set_piece_sentence(press_run):
    view = view_for_run(press_run, "press_escape-0")
    assert [line.id for line in view.lines["en"].lines] == ["build_up"]
    assert view.cards.set_pieces.awarded == 0


def test_a_lone_hero_is_one_passage():
    run = Simulation.from_scenario("corner_blind_side", 0).run()
    cards = tactics_from_run(run, "corner_blind_side-0")
    assert cards.kind == "hero" and cards.set_pieces.corner_list[0].possession == 0
    assert (
        Passage(0, 0, len(run.owner), "corner", "corner_blind_side")
        == (passages_of({"scenario": "corner_blind_side"}, len(run.owner))[0])
    )


@canonical.linux_only()
def test_the_web_fixture_is_current():
    """The viewer's tests (web/src/tactics/) run on this output.

    The short match's decisions are ties at the last digit on some seeds, so macOS and Linux (CI)
    play it differently (10 against 11 passes in one block): like every committed artifact it is
    generated on Linux (`tests/canonical.py`), and this check skips elsewhere.
    """
    assert WEB_FIXTURE.read_text() == web_fixture(fixture_view()), (
        f"web/src/tactics/fixture.json is stale: {canonical.message()}"
    )
