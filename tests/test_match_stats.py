"""Match statistics (SPEC 3.1, 9): the eval's arithmetic on a hand-made match, then a real one."""

import re
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from eval.match_stats import (
    COLUMNS,
    NO_REFERENCE,
    SPEC_SOURCE,
    TeamPossession,
    measure,
    render,
    rows_for,
    team_possessions,
)
from sim.match import Possession, PossessionSpec, StitchedMatch, build_match
from sim.model import Event
from sim.scenarios.base import make_player

SPEC = (Path(__file__).parents[1] / "docs" / "SPEC.md").read_text()
DT = 0.04
PLAYERS = [make_player("H4", "CB"), make_player("H8", "CM"), make_player("A4", "CB"),
           make_player("A9", "ST")]  # fmt: skip
TEAM = {p.id: p.team for p in PLAYERS}


def _event(etype: str, player: str, frame: int, **attrs) -> Event:
    return Event(f"{etype}:{player}:{frame:04d}", etype, frame, frame * DT, player, TEAM[player],
                 attrs)  # fmt: skip


def _owner(frames: int, spans: list[tuple[int, int, int]]) -> np.ndarray:
    owner = np.full(frames, -1)
    for first, last, i in spans:
        owner[first:last] = i
    return owner


def _possession(index: int, restart: str, owner: np.ndarray, events, decisions=()) -> Possession:
    run = SimpleNamespace(players=PLAYERS, owner=owner, events=list(events),
                          decisions=list(decisions))  # fmt: skip
    return Possession(index, "possession_play", 1_000_000 + index, 0, restart, (0, 0), run)


def _open_play(index: int = 0) -> Possession:
    """4 s: H4 → H8, H8's pass (his decision) is intercepted by A4, A4 → A9, A9's pass is still
    rolling at the cut."""
    return _possession(
        index, "kick_off", _owner(100, [(0, 10, 0), (20, 40, 1), (50, 70, 2), (80, 95, 3)]),
        [
            _event("pass", "H4", 10, outcome="complete", end=20),
            _event("reception", "H8", 20),
            _event("pass", "H8", 40, outcome="intercepted", end=50),
            _event("interception", "A4", 50),
            _event("possession_change", "A4", 50),
            _event("pass", "A4", 70, outcome="complete", end=80),
            _event("reception", "A9", 80),
            _event("pass", "A9", 95, outcome=None, end=None),
            _event("scan", "H8", 30),
        ],
        [SimpleNamespace(player="H8", frame=40)],
    )  # fmt: skip


def _match_a() -> StitchedMatch:
    """Open play, then H4 passes out for a throw-in, then A9 tackles H4 and shoots."""
    out_of_play = _possession(
        1, "cut", _owner(20, [(0, 5, 0)]),
        [_event("pass", "H4", 5, outcome="out", end=15),
         _event("out", "H4", 15, at=[10.0, 34.5])],
    )  # fmt: skip
    tackled = _possession(
        2, "throw_in", _owner(25, [(0, 10, 0), (10, 20, 3)]),
        [_event("tackle", "A9", 10, won_from="H4"),
         _event("possession_change", "A9", 10),
         _event("shot", "A9", 20, outcome=None, end=None)],
    )  # fmt: skip
    return StitchedMatch(1, PLAYERS, [_open_play(), out_of_play, tackled], DT)


def test_a_set_piece_scenario_declares_its_own_restart_and_is_no_restart_after_an_out():
    """match-1's corner hero starts with a corner whatever the possession before it did."""
    corner = _possession(1, "corner", _owner(20, [(0, 20, 0)]), [])
    corner = Possession(1, "corner_blind_side", 0, 100, "corner", (0, 0), corner.run)
    m = {
        k: float(v[0])
        for k, v in measure(StitchedMatch(3, PLAYERS, [_open_play(), corner], DT))["match"].items()
    }
    assert (m["cuts"], m["out_restarts"], m["out_restarts_kept"]) == (0, 0, 0)


def _match_b() -> StitchedMatch:
    return StitchedMatch(2, PLAYERS, [_open_play()], DT)


def _by_metric(rows):
    return {r.metric: r for r in rows}


def test_team_possessions_split_at_each_change_and_end_at_the_cut_or_the_out():
    a = _match_a()
    assert team_possessions(a.possessions[0]) == [
        TeamPossession(0, 0, 50, 2, "interception"),
        TeamPossession(1, 50, 100, 2, "cut"),
    ]
    assert team_possessions(a.possessions[1]) == [TeamPossession(0, 0, 15, 1, "out")]
    assert team_possessions(a.possessions[2]) == [
        TeamPossession(0, 0, 10, 0, "tackle"),
        TeamPossession(1, 10, 25, 0, "cut"),  # a shot is not a pass
    ]


def test_measure_counts_one_match():
    tables = measure(_match_a())
    m = {k: float(v[0]) for k, v in tables["match"].items()}
    assert m["duration"] == pytest.approx(145 * DT)
    assert (m["possessions"], m["spells"]) == (3, 5)
    assert (m["passes"], m["decided"], m["completed"], m["resolved"], m["unresolved"]) == (
        5, 1, 2, 4, 1
    )  # fmt: skip
    assert (m["changes"], m["interception"], m["tackle"], m["out"]) == (3, 1, 1, 1)
    assert (m["shots"], m["goals"]) == (1, 0)
    # The cut after open play took the ball from the away team; the throw-in went back to H4's
    # team, which had put the ball out.
    assert (m["cuts"], m["cut_switches"], m["out_restarts"], m["out_restarts_kept"]) == (1, 1, 1, 1)
    assert m["spell_time"] == pytest.approx((50 + 50 + 15 + 10 + 15) * DT)
    assert m["home_time"] == pytest.approx((50 + 15 + 10) * DT)
    own = tables["possessions"]
    np.testing.assert_allclose(own["length"], np.array([50, 50, 15, 10, 15]) * DT)
    assert own["passes"].tolist() == [2, 2, 1, 0, 0]
    assert own["ended"].tolist() == ["interception", "cut", "out", "tackle", "cut"]
    assert tables["scenarios"]["home_start"].tolist() == [True, True, True]


def test_a_possession_change_without_interception_or_tackle_is_refused():
    p = _possession(0, "kick_off", _owner(10, [(0, 10, 0)]), [_event("possession_change", "A4", 5)])
    with pytest.raises(ValueError, match="possession change"):
        measure(StitchedMatch(1, PLAYERS, [p], DT))


def test_rows_pool_the_matches_and_scale_counts_to_90_minutes():
    rows = _by_metric(rows_for([measure(_match_a()), measure(_match_b())]))
    # Counts per 90 min pool the matches: total count over total clock (5.8 s + 4.0 s), not the
    # mean of the per-match rates (that would be 5,028 passes).
    assert rows["Passes attempted per 90 min"].sim == "4,959 (4.5 ± 0.7 per match, n = 2 matches)"
    assert rows["Passes completed per 90 min"].sim == "2,204 (2.0 ± 0.0 per match, n = 2 matches)"
    assert rows["Pass completion (%)"].sim == "57.1% (n = 7 resolved passes)"  # 4 / 7
    assert rows["Possession changes per 90 min"].sim.startswith("2,204 (2.0 ± 1.4 per match")
    assert rows["Possession changes by interception per 90 min"].sim.startswith("1,102 (1.0 ±")
    assert rows["Possession changes by tackle per 90 min"].sim.startswith("551 (0.5 ±")
    assert rows["Possession changes out of play per 90 min"].sim.startswith("551 (0.5 ±")
    assert rows["Team possessions per 90 min"].sim.startswith("3,857 (3.5 ± 2.1 per match")
    assert rows["Team possession length (s)"].sim == "1.4 ± 0.8 (n = 7 team possessions)"
    assert rows["Passes per team possession"].sim == "1.29 ± 0.95 (n = 7 team possessions)"
    # Home time 3.0 s + 2.0 s over 5.6 s + 4.0 s of team possession.
    assert rows["Home team's share of possession time (%)"].sim.startswith("52.1%")
    assert rows["Shots per 90 min"].sim.startswith("551 (0.5 ±")
    assert rows["Shot outcomes (goals, saves, misses)"].sim == "0 goals of 1 shot"
    play = rows["Play per match (min)"]
    assert play.sim == "0.08 ± 0.02 (n = 2 matches)"  # (5.8 s + 4.0 s) / 2 / 60
    assert play.inside == "inconclusive"  # fewer than 10 matches
    assert rows["Scenario possessions per match"].sim == "2.0 ± 1.4 (n = 2 matches)"


def test_targets_come_only_from_spec_3_and_the_rest_say_so():
    rows = rows_for([measure(_match_a())] * 10)
    targeted = [r for r in rows if r.published != NO_REFERENCE]
    metrics = [r.metric for r in targeted]
    assert metrics == ["Play per match (min)", "Scenario possessions per match"]
    for r in targeted:
        assert r.source == SPEC_SOURCE and r.inside == "❌ outside", r
    for r in rows:
        if r.published == NO_REFERENCE:
            assert (r.range, r.source, r.inside) == ("—", "—", "—"), r
    # The quoted design targets are SPEC 3.1's own words.
    spec = re.sub(r"\s+", " ", SPEC.replace("**", ""))
    assert "A match is 15–25 scenario-driven possessions (§3.6) stitched together with " in spec
    assert "(kick-off, throw-in, goal kick, corner): 10–15 min of play in total" in spec
    assert "Rates in the realism report are normalised per 90 min." in spec


def test_the_report_has_one_line_per_row_and_is_deterministic():
    per_match = [measure(_match_a()), measure(_match_b())]
    rows = rows_for(per_match)
    markdown = render(rows, [1, 2])
    table = [line for line in markdown.splitlines() if line.startswith("|")]
    assert table[0] == "| " + " | ".join(COLUMNS) + " |"
    assert len(table) == 2 + len(rows)
    assert "**0 inside, 0 outside, 2 inconclusive, 13 with no published reference" in markdown
    assert render(rows_for(per_match), [1, 2]) == markdown


def test_a_real_stitched_match_is_fully_accounted_for():
    plan = (PossessionSpec("possession_play", max_s=5.0),) * 2
    match = build_match(7, plan)
    tables = measure(match)
    m = {k: float(v[0]) for k, v in tables["match"].items()}
    kicks = [e for p in match.possessions for e in p.run.events if e.type == "pass"]
    assert m["passes"] == len(kicks) > 0
    assert m["resolved"] + m["unresolved"] == len(kicks)
    assert tables["possessions"]["passes"].sum() == m["passes"]  # every pass in one spell
    # Team possessions cover the clock but for the dead ball after an out.
    dead = sum(p.frames - e.frame for p in match.possessions for e in p.run.events
               if e.type == "out") * match.dt  # fmt: skip
    assert m["spell_time"] == pytest.approx(m["duration"] - dead)
    assert render(rows_for([tables]), [7]) == render(rows_for([measure(build_match(7, plan))]), [7])
