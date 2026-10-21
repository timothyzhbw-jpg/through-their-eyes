"""Take his eyes: the viewer chooses when and where the hero looks, and the moment is re-simulated
with that look (SPEC 3.7 `AddScan`, `look:` what-ifs; SPEC 7).

From the pass to him until his decision, the hero looks only where the viewer says: his own scans
in that window (the key scan, spontaneous and partial ones) give way to the viewer's one look.
"""

import numpy as np
import pytest

from analytics.vision import wrap_angle
from sim.config import SimParams
from sim.counterfactual import (
    drop_scan_counterfactual,
    look_counterfactual,
    look_id,
    look_window,
    parse_look_id,
    what_if_from_id,
)
from sim.engine import Simulation
from sim.overrides import AddScan

BLIND, PRESS = ("blind_side_run", 3), ("press_escape", 0)
P = SimParams()


@pytest.fixture(scope="module")
def blind_factual():
    return Simulation.from_scenario(*BLIND).run()


@pytest.fixture(scope="module")
def behind_at_his_time():
    """Over his right shoulder, as far as a scan turns, when he really looked (frame 50)."""
    return look_counterfactual(*BLIND, frame=50, offset_deg=-150)


def _scans_in(run, player, lo, hi, types=("scan", "head_turn")):
    return [e for e in run.events if e.player == player and e.type in types and lo <= e.frame < hi]


# --- the override is a scan like any other -------------------------------------------------------


def test_a_look_turns_where_and_when_it_is_asked(behind_at_his_time):
    run, hero = behind_at_his_time.counterfactual, "H8"
    look = run.event("scan:H8:0050")
    assert look.attrs["added"] is True and look.attrs["key"] is False
    i = run.index(hero)
    to_ball = run.ball_pos[50, :2] - run.pos[50, i]
    expected = wrap_angle(np.arctan2(to_ball[1], to_ball[0]) + np.deg2rad(-150))
    assert look.attrs["direction"] == pytest.approx(float(expected), abs=1e-9)
    assert behind_at_his_time.look is look


def test_a_look_turns_the_head_no_faster_than_a_scan_can(behind_at_his_time):
    run = behind_at_his_time.counterfactual
    look, i = run.event("scan:H8:0050"), run.index("H8")
    yaw = run.head_yaw[look.frame : look.attrs["end"] + 1, i]
    peak = float(np.max(np.abs(wrap_angle(np.diff(yaw)))) / run.dt)
    mean, sd = P.scan_omega
    assert P.scan_omega_min - 1e-9 <= peak <= P.head_omega_max + 1e-9
    assert abs(peak - mean) <= 3 * sd  # a keyed draw from the published 404 +- 51 deg/s


@pytest.mark.parametrize("offset", [np.deg2rad(40), np.deg2rad(-60), np.deg2rad(170)])
def test_a_turn_a_scan_cannot_make_is_refused(offset):
    sim = Simulation.from_scenario(*BLIND)
    with pytest.raises(ValueError, match="scan turns"):
        AddScan("H8", 40, offset).apply(sim)


def test_a_dwell_longer_than_any_scan_is_refused():
    sim = Simulation.from_scenario(*BLIND)
    with pytest.raises(ValueError, match="dwells"):
        AddScan("H8", 40, np.deg2rad(90), dwell_s=P.scan_dwell_max_s + 0.1).apply(sim)


def test_the_look_dwells_for_the_median_scan_by_default():
    sim = Simulation.from_scenario(*BLIND)
    AddScan("H8", 40, np.deg2rad(90)).apply(sim)
    assert sim.added_scans[(sim.index("H8"), 40)] == (np.deg2rad(90), P.scan_dwell_s[0])


@pytest.mark.parametrize("frame", [5, 75, 90])
def test_a_look_outside_the_window_from_the_pass_to_his_decision_is_refused(frame):
    with pytest.raises(ValueError, match="window"):
        look_counterfactual(*BLIND, frame=frame, offset_deg=90)


# --- his eyes are the viewer's: his own looks in the window give way -----------------------------


@pytest.mark.parametrize("case", [BLIND, PRESS])
def test_the_look_replaces_his_own_looks_from_the_pass_to_his_decision(case):
    factual = Simulation.from_scenario(*case).run()
    hero = factual.hero
    start, end = look_window(factual, hero)
    assert _scans_in(factual, hero, start, end, ("scan",))  # he did look in the window
    frame = (start + end) // 2
    result = look_counterfactual(*case, frame=frame, offset_deg=90)
    looks = _scans_in(result.counterfactual, hero, start, end)
    assert [e.id for e in looks] == [f"scan:{hero}:{frame:04d}"]
    assert result.dropped == [e.id for e in _scans_in(factual, hero, start, end, ("scan",))]


def test_the_window_runs_from_the_pass_to_him_to_his_decision(blind_factual):
    d = blind_factual.hero_decision()
    kick = next(e for e in blind_factual.events if e.type == "pass" and e.attrs["to"] == "H8")
    assert look_window(blind_factual, "H8") == (kick.frame, d.frame)


def test_with_no_look_the_scan_hero_replays_the_run_without_his_key_scan_byte_for_byte():
    none = look_counterfactual(*BLIND, frame=None, offset_deg=None)
    assert none.look is None
    without = drop_scan_counterfactual(*BLIND)
    assert none.counterfactual.to_bytes() == without.counterfactual.to_bytes()


# --- only his head and what he believes change until he decides ----------------------------------


@pytest.mark.parametrize("case", [BLIND, PRESS])
def test_until_his_decision_a_look_moves_only_his_head(case):
    factual = Simulation.from_scenario(*case).run()
    _, end = look_window(factual, factual.hero)
    cf = look_counterfactual(*case, frame=end - 30, offset_deg=-150).counterfactual
    i = cf.index(factual.hero)
    upto = slice(0, end + 1)
    assert np.array_equal(cf.pos[upto], factual.pos[upto])
    assert np.array_equal(cf.ball_pos[upto], factual.ball_pos[upto])
    others = np.arange(len(cf.players)) != i
    assert np.array_equal(cf.head_yaw[upto][:, others], factual.head_yaw[upto][:, others])
    assert cf.hero_decision().frame == factual.hero_decision().frame


def test_a_look_leaves_every_random_draw_unchanged():
    result = look_counterfactual(*BLIND, frame=40, offset_deg=-150, record_draws=True)
    for player in ("H8", "H9", "A5", "H4", "A1"):
        f, c = result.factual.draws_for(player), result.counterfactual.draws_for(player)
        common = f.keys() & c.keys()
        assert len(common) > 0.9 * min(len(f), len(c))
        assert all(f[k] == c[k] for k in common)


def test_the_same_look_twice_is_byte_identical(behind_at_his_time):
    again = look_counterfactual(*BLIND, frame=50, offset_deg=-150)
    assert again.counterfactual.to_bytes() == behind_at_his_time.counterfactual.to_bytes()


# --- ids -----------------------------------------------------------------------------------------


def test_look_ids_name_the_player_the_frame_and_the_turn():
    assert look_id("H8", 50, -150) == "look:H8:0050:-150"
    assert look_id("H4", 21, 90) == "look:H4:0021:+090"
    assert look_id("H8", None, None) == "look:H8:none"
    assert parse_look_id("look:H8:0050:-150") == ("H8", 50, -150)
    assert parse_look_id("look:H8:none") == ("H8", None, None)
    with pytest.raises(ValueError):
        parse_look_id("force:H8:0075:pass:H4")


def test_a_look_id_re_simulates_the_same_run(behind_at_his_time):
    assert behind_at_his_time.id == "look:H8:0050:-150"
    again = what_if_from_id(*BLIND, "look:H8:0050:-150")
    assert again.counterfactual.to_bytes() == behind_at_his_time.counterfactual.to_bytes()
    assert again.scan_id == again.id


# --- the hero moment's design, seen through his eyes (blind_side_run seed 3) ---------------------


def test_looking_behind_him_when_he_really_looked_finds_the_runner(behind_at_his_time):
    assert behind_at_his_time.factual_action == "pass:H9"
    assert behind_at_his_time.counterfactual_action == "pass:H9"


def test_looking_the_other_way_misses_the_runner():
    left = look_counterfactual(*BLIND, frame=50, offset_deg=90)
    assert left.counterfactual_action == "pass:H4"
    assert left.delta_xt > 0


def test_a_look_as_the_ball_arrives_comes_too_late():
    late = look_counterfactual(*BLIND, frame=70, offset_deg=-150)
    assert late.look is not None
    assert late.look.attrs["end"] > late.counterfactual_decision.frame
    assert late.counterfactual_action == "pass:H4"


# --- the grid the web ships (sim.export.export_looks) and its verified lines --------------------


def test_the_grid_looks_every_four_tenths_of_a_second_back_from_the_reception():
    from sim.export import look_grid_frames

    assert look_grid_frames(15, 70) == [20, 30, 40, 50, 60, 70]
    assert look_grid_frames(14, 61) == [21, 31, 41, 51, 61]


@pytest.fixture(scope="module")
def ctx():
    from agents.context import MomentContext

    return MomentContext.load(*BLIND)


@pytest.mark.parametrize(
    ("frame", "offset"), [(20, -150), (30, -90), (50, -150), (50, 90), (60, 150), (70, -150)]
)
def test_every_line_of_a_look_is_verified_and_slot_filled(ctx, frame, offset):
    from agents.look import answer_look
    from explain.render import check_payload

    look = look_counterfactual(*BLIND, frame=frame, offset_deg=offset)
    none = look_counterfactual(*BLIND, frame=None, offset_deg=None)
    answer = answer_look(ctx, look, none)
    ids = [c.id for c in answer.claims]
    assert ids[0] == "look_when" and "look_choice" in ids and "look_outcome" in ids
    for lang, payload in answer.payloads.items():
        assert len(payload.lines) == len(answer.claims), lang  # every claim verified
        assert check_payload(payload, ctx.names) == [], lang  # no digit outside a slot


def test_a_wrong_number_in_a_look_line_is_refuted(ctx):
    from agents.look import look_claims
    from explain.claims import Slot
    from explain.verifier import Verifier

    look = look_counterfactual(*BLIND, frame=50, offset_deg=-150)
    none = look_counterfactual(*BLIND, frame=None, offset_deg=None)
    ctx.evaluator.counterfactuals.update({look.id: look, none.id: none})
    claims = {c.id: c for c in look_claims(ctx, look, none)}
    verifier = Verifier(ctx.evaluator)
    for cid, name in (("look_when", "s"), ("look_belief", "before")):
        claim = claims[cid]
        assert verifier.verify(claim).status == "supported"
        wrong = claim.model_copy(deep=True)
        wrong.slots[name] = Slot(value=claim.slots[name].value + 0.5, decimals=1)
        assert verifier.verify(wrong).status == "refuted", cid


def test_a_wrong_name_in_a_look_line_is_refuted(ctx):
    from agents.look import look_claims
    from explain.claims import Slot
    from explain.verifier import Verifier

    look = look_counterfactual(*BLIND, frame=50, offset_deg=90)
    none = look_counterfactual(*BLIND, frame=None, offset_deg=None)
    ctx.evaluator.counterfactuals.update({look.id: look, none.id: none})
    choice = next(c for c in look_claims(ctx, look, none) if c.id == "look_choice")
    assert {k: s.ref for k, s in choice.slots.items()} == {"mine": "H4", "his": "H9"}
    verifier = Verifier(ctx.evaluator)
    assert verifier.verify(choice).status == "supported"
    for name, wrong in (("mine", "H9"), ("his", "H4")):
        swapped = choice.model_copy(deep=True)
        swapped.slots[name] = Slot(ref=wrong)
        assert verifier.verify(swapped).status == "refuted", name


# --- a placed shot (far_post_finish seed 11, SPEC 3.3): the look that matters finds the keeper -


FINISH = ("far_post_finish", 11)


@pytest.fixture(scope="module")
def finish_ctx():
    from agents.context import MomentContext

    return MomentContext.load(*FINISH)


@pytest.mark.parametrize(
    ("offset", "lines"),
    [
        (
            90,
            [
                "You make H9 look to his left 0.4 s before the ball reaches him.",
                "His head is still turning when he has to decide.",
                "Before he decides, that look brings A1 and H6 into his sight.",
                "When he decides, he pictures A1 0.0 m from where he really is; with no look at"
                " all, 3.0 m.",
                "He still shoots at the far post, as he really did.",
                "It goes in.",
            ],
        ),
        (
            -150,
            [
                "You make H9 look over his right shoulder 0.4 s before the ball reaches him.",
                "Before he decides, that look brings H10 and H6 into his sight.",
                "So he shoots at the near post; he really shot at the far post.",
                "A1 saves it.",
                "That is worth 1.00 less in expected threat than what he really did.",
            ],
        ),
    ],
)
def test_a_look_at_the_keeper_decides_the_placement_in_verified_lines(finish_ctx, offset, lines):
    from agents.look import answer_look
    from explain.render import check_payload

    look = look_counterfactual(*FINISH, frame=183, offset_deg=offset)
    none = look_counterfactual(*FINISH, frame=None, offset_deg=None)
    assert (look.factual_action, none.counterfactual_action) == ("shot:far", "shot:near")
    answer = answer_look(finish_ctx, look, none)
    assert [line.text for line in answer.payloads["en"].lines] == lines
    for lang, payload in answer.payloads.items():
        assert len(payload.lines) == len(answer.claims), lang
        assert check_payload(payload, finish_ctx.names) == [], lang


def test_a_look_as_the_ball_reaches_him_is_sided_from_the_ball_not_his_head(finish_ctx):
    """As he takes the ball his head is not on it: the look's side is measured from the ball, as
    the dial and the grid place it."""
    from agents.look import look_claims
    from explain.verifier import Verifier

    look = look_counterfactual(*FINISH, frame=193, offset_deg=90)
    none = look_counterfactual(*FINISH, frame=None, offset_deg=None)
    finish_ctx.evaluator.counterfactuals.update({look.id: look, none.id: none})
    when = next(c for c in look_claims(finish_ctx, look, none) if c.id == "look_when")
    assert when.template == "You make {player} look to his left as the ball reaches him."
    assert Verifier(finish_ctx.evaluator).verify(when).status == "supported"


def test_what_he_saw_before_deciding_is_read_up_to_his_decision_not_the_reception(ctx):
    """A look's "before he decides" lines read his sight up to the decision and pin that frame
    with the decision model's own record (`chosen`), so a carry, which has no event at the
    decision, is not read only up to the reception."""
    from agents.look import look_claims

    look = look_counterfactual(*BLIND, frame=70, offset_deg=-150)  # as the ball reaches him
    none = look_counterfactual(*BLIND, frame=None, offset_deg=None)
    ctx.evaluator.counterfactuals.update({look.id: look, none.id: none})
    claims = {c.id: c for c in look_claims(ctx, look, none)}
    for cid in ("look_saw", "look_late"):
        text = claims[cid].predicate.model_dump_json()
        assert '"metric":"chosen"' in text and '"anchor":"pass:H8:0075"' in text, cid
