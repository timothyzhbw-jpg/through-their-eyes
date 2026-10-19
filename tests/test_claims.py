"""Claim schema (SPEC 5.3): the JSON shape the Analyst emits and the verifier consumes."""

import pytest
from pydantic import ValidationError

from explain.claims import Claim, Predicate, Slot, event, fn, slot

SPEC_EXAMPLE = {
    "id": "c17",
    "template": "{player} scanned {n_scans} times in the {window_s} seconds before receiving.",
    "slots": {"player": {"ref": "H8"}, "n_scans": {"value": 3}, "window_s": {"value": 6}},
    "predicate": {
        "op": "eq",
        "lhs": {
            "fn": "count_events",
            "args": {"type": "scan", "player": "H8", "from": -6.0, "to": 0.0,
                     "anchor": "m12.reception"},
        },
        "rhs": 3,
    },
    "evidence": ["e4512", "e4519", "e4533"],
}  # fmt: skip


def _claim(**kw) -> Claim:
    base = {
        "id": "c1",
        "template": "{player} scanned {n} times.",
        "slots": {"player": Slot(ref="H8"), "n": Slot(value=2)},
        "predicate": Predicate(
            op="eq",
            lhs=fn("scans_in_window", player=slot("player"), anchor="reception:H8:0070",
                   window_s=2.0),
            rhs=slot("n"),
        ),
    }  # fmt: skip
    return Claim(**(base | kw))


def test_the_spec_example_parses_and_round_trips():
    claim = Claim.model_validate(SPEC_EXAMPLE)
    assert claim.slots["player"].ref == "H8"
    assert claim.slots["n_scans"].value == 3
    assert claim.predicate.op == "eq"
    assert claim.predicate.lhs["fn"] == "count_events"
    assert claim.evidence == ["e4512", "e4519", "e4533"]
    assert Claim.model_validate_json(claim.model_dump_json()) == claim


def test_helpers_build_the_spec_operand_shapes():
    assert fn("count_events", type="scan", from_=-6.0, to=0.0) == {
        "fn": "count_events",
        "args": {"type": "scan", "from": -6.0, "to": 0.0},
    }
    assert slot("window_s", scale=-1) == {"slot": "window_s", "scale": -1}
    assert slot("n") == {"slot": "n"}
    assert event("scan:H8:0050") == {"event": "scan:H8:0050"}


def test_a_slot_holds_exactly_one_of_ref_or_value():
    Slot(ref="H8")
    Slot(value=0)
    Slot(value=False)
    with pytest.raises(ValidationError):
        Slot()
    with pytest.raises(ValidationError):
        Slot(ref="H8", value=3)


def test_slot_values_keep_their_json_type():
    assert type(Slot(value=3).value) is int
    assert type(Slot(value=3.5).value) is float
    assert type(Slot(value=True).value) is bool
    assert type(Slot(value="H9").value) is str


@pytest.mark.parametrize(
    "bad",
    [
        {"op": "eq", "lhs": 1},  # binary op without rhs
        {"op": "approx", "lhs": 1, "rhs": 1},  # approx without a tolerance
        {"op": "approx", "lhs": 1, "rhs": 1, "tol": 0.2},  # SPEC: tolerances < 20%
        {"op": "eq", "lhs": 1, "rhs": 1, "tol": 0.1},  # tolerance on a non-approx op
        {"op": "exists", "lhs": {"event": "x"}, "rhs": 1},
        {"op": "all", "args": []},
        {"op": "all", "lhs": 1, "args": [{"op": "eq", "lhs": 1, "rhs": 1}]},
        {"op": "contains", "lhs": 1, "rhs": 1},
        {"op": "eq", "lhs": {"fn": 3, "args": {}}, "rhs": 1},
        {"op": "eq", "lhs": {"fn": "distance", "args": []}, "rhs": 1},
        {"op": "eq", "lhs": {"slot": 7}, "rhs": 1},
    ],
)
def test_malformed_predicates_fail_schema_validation(bad):
    with pytest.raises(ValidationError):
        Predicate.model_validate(bad)


def test_template_placeholders_must_name_slots():
    with pytest.raises(ValidationError):
        _claim(template="{player} scanned {count} times.")
    with pytest.raises(ValidationError):
        _claim(templates={"zh": "{player}扫视了{count}次。"})
    _claim(templates={"zh": "{player}扫视了{n:times}。"})


def test_slot_references_are_collected_from_the_whole_predicate():
    claim = _claim(
        predicate=Predicate(
            op="all",
            args=[
                Predicate(op="eq", lhs=fn("event_attr", event=slot("scan"), attr="player"),
                          rhs=slot("player")),
                Predicate(op="before", lhs=event(slot("scan")), rhs=event("reception:H8:0070")),
                Predicate(op="eq", lhs=fn("count_events", type="scan",
                                          where={"key": slot("key")}), rhs=slot("n")),
            ],
        ),
        slots={"player": Slot(ref="H8"), "scan": Slot(ref="scan:H8:0050"), "n": Slot(value=1),
               "key": Slot(value=True)},
    )  # fmt: skip
    assert claim.slot_refs() == {"player", "scan", "n", "key"}


def test_the_fingerprint_changes_with_any_slot_value():
    a = _claim()
    assert a.fingerprint() == _claim().fingerprint()
    b = _claim(slots={"player": Slot(ref="H8"), "n": Slot(value=3)})
    assert a.fingerprint() != b.fingerprint()


def test_templates_fall_back_to_the_english_template():
    claim = _claim(templates={"zh": "{player}扫视了{n:times}。"})
    assert claim.template_for("zh") == "{player}扫视了{n:times}。"
    assert claim.template_for("en") == claim.template
    assert claim.template_for("es") == claim.template
