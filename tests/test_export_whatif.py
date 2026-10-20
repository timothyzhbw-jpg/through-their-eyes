"""Precomputed "What if…?" answers for the viewer (SPEC 3.7, 6, 7)."""

import json
from pathlib import Path

import numpy as np
import pytest

from sim.counterfactual import force_action_counterfactual
from sim.export import export_hero, export_what_ifs, what_if_question

SCENARIO, SEED = "blind_side_run", 3
WEB_WHAT_IF = Path(__file__).parent.parent / "web" / "public" / "data" / "whatif_seed3.json"


@pytest.fixture(scope="module")
def data():
    return export_what_ifs(SCENARIO, SEED)


@pytest.fixture(scope="module")
def hero():
    return export_hero(SCENARIO, SEED)


def _asked(data):
    return [o for o in data["options"] if not o["factual"]]


def test_every_option_has_a_question_and_the_choice_is_marked(data, hero):
    decision = hero["runs"]["factual"]["decision"]
    assert [o["action"] for o in data["options"]] == [o["action"] for o in decision["options"]]
    factual = [o for o in data["options"] if o["factual"]]
    assert [o["action"] for o in factual] == [decision["chosen"]] == [data["factual_action"]]
    assert "answers" not in factual[0]  # what he did is not a what-if
    for o in data["options"]:
        assert set(o["question"]) == {"en", "zh"}
    assert data["moment"] == f"m:decision_after_scan:H8:{decision['frame']:04d}"


def test_questions_read_naturally():
    assert what_if_question("pass:H4", "en") == "What if he passed to H4?"
    assert what_if_question("pass:H4", "zh") == "如果他传给H4呢？"
    assert what_if_question("carry", "en") == "What if he carried it?"
    with pytest.raises(ValueError):
        what_if_question("dribble", "en")


def test_answers_are_verified_counterfactual_payloads(data):
    for o in _asked(data):
        assert o["id"] == f"force:H8:{data['decision_frame']:04d}:{o['action']}"
        for lang in ("en", "zh"):
            payload = o["answers"][lang]
            assert payload["language"] == lang
            assert payload["moment"] == f"{data['moment']}?{o['id']}"
            assert payload["lines"], (o["action"], lang)
            claims = {c["id"]: c for c in payload["claims"]}
            assert {cid for line in payload["lines"] for cid in line["claims"]} == set(claims)
            assert {c["kind"] for c in claims.values()} == {"counterfactual"}
            assert {c["verdict"] for c in claims.values()} == {"supported"}


def test_the_pass_back_to_h4(data):
    h4 = next(o for o in data["options"] if o["action"] == "pass:H4")
    texts = [line["text"] for line in h4["answers"]["en"]["lines"]]
    assert texts[0] == "If H8 had passed to H4, H4 would have received it."
    assert "less in expected threat than what he did" in texts[-1]


def test_forced_runs_branch_at_the_decision_and_match_the_backend(data, hero):
    start = data["start"]
    factual_at_start = np.array(hero["runs"]["factual"]["pos"][start])
    for o in _asked(data):
        pos = np.array(o["pos"])
        assert pos.shape == (o["frames"], 44)
        assert len(o["ball"]) == o["frames"]
        assert np.abs(pos[0] - factual_at_start).max() <= 1  # same state when the decision is made
        assert all(e["frame"] >= start for e in o["events"])
    h4 = next(o for o in _asked(data) if o["action"] == "pass:H4")
    w = force_action_counterfactual(SCENARIO, SEED, "pass:H4")
    exported = np.array(h4["pos"]).reshape(-1, 22, 2) / 1000
    assert np.abs(exported - w.counterfactual.pos[start:]).max() <= 0.0005 + 1e-12
    assert any(e["id"] == f"pass:H8:{start:04d}" and e["attrs"]["to"] == "H4" for e in h4["events"])


def test_committed_what_ifs_match_the_generator(data):
    committed = json.loads(WEB_WHAT_IF.read_text())
    assert committed["version"] == data["version"]
    assert [o["action"] for o in committed["options"]] == [o["action"] for o in data["options"]]
    for got, want in zip(committed["options"], data["options"], strict=True):
        assert got["question"] == want["question"]
        assert got.get("frames") == want.get("frames")
        for lang in want.get("answers", {}):
            assert [line["text"] for line in got["answers"][lang]["lines"]] == [
                line["text"] for line in want["answers"][lang]["lines"]
            ]
