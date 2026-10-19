"""Offline tests for the M0 setup helpers (no Azure calls)."""

import xml.etree.ElementTree as ET

from infra.pick_model import pick
from infra.smoke import Line, Lines, build_ssml, check_lines


def _model(name, version, *, default=False, retires=None, usage=None):
    sku = {"name": "GlobalStandard"}
    if usage:
        sku["usageName"] = usage
    if retires:
        sku["deprecationDate"] = retires
    return {
        "kind": "OpenAI",
        "model": {
            "name": name,
            "version": version,
            "format": "OpenAI",
            "isDefaultVersion": default,
            "skus": [sku],
        },
    }


def _usage(name, limit, current=0):
    return {"name": {"value": name}, "limit": limit, "currentValue": current}


def test_pick_first_candidate_with_quota():
    models = [_model("a", "1"), _model("b", "1")]
    usages = [_usage("OpenAI.GlobalStandard.a", 0), _usage("OpenAI.GlobalStandard.b", 50)]
    choice, log = pick(models, usages, ["a", "b"], "GlobalStandard", 20)
    assert (choice.name, choice.capacity) == ("b", 20)
    assert "no quota" in log[0]


def test_pick_caps_capacity_at_available_quota():
    choice, _ = pick([_model("a", "1")], [_usage("OpenAI.GlobalStandard.a", 10, 4)], ["a"],
                     "GlobalStandard", 20)  # fmt: skip
    assert choice.capacity == 6


def test_pick_skips_versions_retiring_before_judging_ends():
    models = [_model("a", "2026-01-01", default=True, retires="2026-11-01"), _model("a", "2025")]
    choice, log = pick(models, [], ["a"], "GlobalStandard", 20)
    assert choice.version == "2025"
    assert "retires 2026-11-01" in log[0]


def test_pick_prefers_default_version():
    models = [_model("a", "2026-09", default=False), _model("a", "2026-01", default=True)]
    choice, _ = pick(models, [], ["a"], "GlobalStandard", 20)
    assert choice.version == "2026-01"


def test_pick_reports_when_nothing_is_deployable():
    choice, log = pick([_model("a", "1")], [], ["x"], "GlobalStandard", 20)
    assert choice is None
    assert "not offered" in log[0]


def test_check_lines():
    good = Lines(
        lines=[Line(language="en", text="{player} looks"), Line(language="zh", text="{player}看")]
    )
    assert check_lines(good) == []
    bad = Lines(lines=[Line(language="en", text="He looks")])
    assert check_lines(bad) == ["no 'zh' line", "'en' line lacks the {player} slot"]


def test_build_ssml_is_well_formed_and_escaped():
    ssml = build_ssml("<b> & 'quotes'", "zh")
    root = ET.fromstring(ssml)
    assert root.attrib["{http://www.w3.org/XML/1998/namespace}lang"] == "zh-CN"
    voice = next(iter(root))
    assert voice.attrib["name"] == "zh-CN-XiaoxiaoNeural"
    assert voice.text == "<b> & 'quotes'"
