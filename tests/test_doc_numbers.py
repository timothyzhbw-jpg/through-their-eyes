"""The judge-facing docs quote the numbers their eval reports hold (SPEC 11).

Every sim change regenerates the reports in eval/reports/; the README, SUBMISSION, RUBRIC_MAP,
EVALS and DEMO_SCRIPT quote some of their numbers. A quoted number is wrapped in a marker,
`<!--num:H1-->33/40<!--/num-->` (GitHub does not render the comments), and this test reads the
same number from the report and fails when they disagree. docs/NUMBERS.md lists every quoted
number, its report and the command that makes it.

- `<!--num:ID-->…<!--/num-->`: the numbers inside, in order, must start the report's tuple for
  ID, so "33/40", "33 of 40" and "33/40 (82%)" all match (33, 40, 82).
- `<!--num:ID.field-->…<!--/num-->`: one field of it, e.g. `R3.outside`.

The reports are committed as generated on Linux (python:3.11-slim, SPEC 3.7); this test only
reads committed files, so it gives the same answer on every platform.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "eval" / "reports"
DOCS = [
    ROOT / "README.md",
    *(ROOT / "docs" / name for name in ("SUBMISSION.md", "RUBRIC_MAP.md", "EVALS.md")),
    ROOT / "docs" / "DEMO_SCRIPT.md",
]

NUM = r"(−?-?\d+(?:\.\d+)?)"
FRACTION = rf"\| {NUM}/{NUM} \({NUM}%\)"

# id → (report, pattern whose groups are the values in order, the groups' field names).
READERS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "H1": (
        "hero_flip_blind_side_run.md",
        rf"\| Decision changed without the key scan {FRACTION}",
        ("k", "n", "pct"),
    ),
    "H2": (
        "hero_lens_blind_side_run.md",
        rf"\| `scan` lens selected {FRACTION}",
        ("k", "n", "pct"),
    ),
    "H3": (
        "hero_lens_press_escape.md",
        rf"\| `pressure` lens selected {FRACTION}",
        ("k", "n", "pct"),
    ),
    "H3b": (
        "hero_lens_press_escape_100-139.md",
        rf"\| `pressure` lens selected {FRACTION}",
        ("k", "n", "pct"),
    ),
    "H4": (
        "hero_lens_press_escape.md",
        rf"\| … the ball is lost after the intervention \| {NUM}/{NUM}",
        ("k", "n"),
    ),
    "H5": (
        "hero_lens_press_escape.md",
        rf"\| Intervention changes the outcome {FRACTION}",
        ("k", "n", "pct"),
    ),
    "H6": (
        "hero_lens_press_escape_100-139.md",
        rf"\| Intervention changes the outcome {FRACTION}",
        ("k", "n", "pct"),
    ),
    "H7": (
        "hero_marking_corner_blind_side.md",
        rf"\| Without the look `A9` receives unmarked[^|]*{FRACTION}",
        ("k", "n", "pct"),
    ),
    "H8": (
        "hero_shot_far_post_finish.md",
        rf"\| Placement changed without the key scan {FRACTION}",
        ("k", "n", "pct"),
    ),
    "A1": ("scan_detector.md", rf"\| Held-out F1, nuisance on \| \*\*{NUM}\*\*", ("f1",)),
    "A2": (
        "keypoint_ingest.md",
        rf"\| keypoints, 20 mm \(stress\) \|.*\| \*\*{NUM}\*\* \|",
        ("f1",),
    ),
    "V1": (
        "crew_evidence.md",
        rf"Of {NUM} perturbed lines \([^)]*\), {NUM} were kept off the air with the Verifier "
        rf"\({NUM} by tidy, {NUM} by the Verifier\); without it {NUM} aired, every one breaking "
        rf"a Verifier rule: {NUM} false",
        ("total", "kept", "tidy", "verifier", "aired", "false"),
    ),
    "A5": (
        "corruption.md",
        rf"\| … refuted by the verifier \| \*\*{NUM}/{NUM} \({NUM}%\)\*\*",
        ("k", "n", "pct"),
    ),
    "A5b": (
        "corruption.md",
        rf"\| Generated claims verified `supported` \| {NUM}/{NUM} \({NUM}%\)",
        ("supported", "n", "pct"),
    ),
    "R3": (
        "realism.md",
        rf"\*\*{NUM} inside, {NUM} outside, {NUM} inconclusive, {NUM} with no published reference",
        ("inside", "outside", "inconclusive", "none"),
    ),
    "R4": (
        "realism.md",
        rf"closest opponent 10\+ m vs 0–1 m at the reception † "
        rf"\| d = {NUM} \([^)]*\) \| {NUM} to {NUM}",
        ("d", "lo", "hi"),
    ),
}

MARKER = re.compile(r"<!--num:([A-Za-z0-9]+)(?:\.([a-z]+))?-->(.*?)<!--/num-->")
STRAY = re.compile(r"<!--/?num")


def numbers(text: str) -> list[float]:
    """The numbers in a quoted span, in order: "33 of 40" → [33, 40]; "−0.02" → [-0.02]."""
    return [
        float(n.replace("−", "-").replace(",", ""))
        for n in re.findall(r"−?-?\d[\d,]*(?:\.\d+)?", text)
    ]


# Fields worked out from a reader's own fields: "0 of 468 true claims wrongly rejected".
DERIVED = {"A5b": lambda v: {"rejected": v["n"] - v["supported"]}}


def report_values(key: str) -> dict[str, float]:
    report, pattern, fields = READERS[key]
    text = (REPORTS / report).read_text(encoding="utf-8")
    found = re.search(pattern, text)
    assert found, (
        f"{report}: no line matches the reader for {key} (did the report's wording change?)"
    )
    values = {f: float(v.replace("−", "-")) for f, v in zip(fields, found.groups(), strict=True)}
    return values | DERIVED.get(key, lambda _: {})(values)


def markers() -> list[tuple[str, int, str, str | None, str]]:
    out = []
    for doc in DOCS:
        if not doc.exists():
            continue
        for lineno, line in enumerate(doc.read_text(encoding="utf-8").splitlines(), 1):
            for m in MARKER.finditer(line):
                out.append(
                    (doc.relative_to(ROOT).as_posix(), lineno, m.group(1), m.group(2), m.group(3))
                )
            assert len(STRAY.findall(MARKER.sub("", line))) == 0, (
                f"{doc.name}:{lineno}: a num marker that does not close on its line"
            )
    return out


ALL = markers()


@pytest.mark.parametrize("key", sorted(READERS))
def test_every_reader_finds_its_number_in_its_report(key):
    assert report_values(key)


@pytest.mark.parametrize("key", sorted(READERS))
def test_every_reader_is_quoted_somewhere(key):
    assert any(k == key for _, _, k, _, _ in ALL), f"no doc marks {key}; drop its reader or mark it"


@pytest.mark.parametrize(
    ("doc", "line", "key", "field", "quoted"), ALL, ids=[f"{d}:{n}:{k}" for d, n, k, _, _ in ALL]
)
def test_a_quoted_number_matches_its_report(doc, line, key, field, quoted):
    assert key in READERS, f"{doc}:{line}: unknown number id {key!r} (READERS in this file)"
    values = report_values(key)
    got = numbers(quoted)
    assert got, f"{doc}:{line}: the {key} marker holds no number: {quoted!r}"
    if field is not None:
        assert field in values, f"{doc}:{line}: {key} has no field {field!r}, only {sorted(values)}"
        want = [values[field]]
    else:
        want = list(values.values())[: len(got)]
    report = READERS[key][0]
    assert got == pytest.approx(want), (
        f"{doc}:{line} quotes {quoted!r} for {key}{'.' + field if field else ''}; "
        f"eval/reports/{report} says {want}. Update the doc (docs/NUMBERS.md lists every place)."
    )


def test_the_markers_cover_the_headline_numbers():
    """The numbers judges see first are all marked, so none of them can drift unnoticed."""
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for key in ("H1", "H2", "A5", "R3", "V1"):
        assert f"<!--num:{key}" in readme, f"README.md quotes {key} without a marker"
