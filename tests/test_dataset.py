"""The downloadable dataset (SPEC 3.1, docs/DATASET.md): schema, determinism, faithfulness.

Built on a short plan (about 25 s of play, a scan hero and the shot hero that scores), so the
whole file runs in seconds; the release plan itself is only checked for its seeds and shape.
"""

import csv
import importlib.util
import json
import math
import platform
import re
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from sim import dataset
from sim.config import DT
from sim.match import SEED_BASE, PossessionSpec, build_match
from tests import canonical

ROOT = Path(__file__).resolve().parents[1]
SHORT_PLAN = (
    PossessionSpec("possession_play", max_s=8.0),
    PossessionSpec("blind_side_run", 3),
    PossessionSpec("far_post_finish", 11),  # the shot hero's demo seed: a goal
    PossessionSpec("possession_play", max_s=4.0),
)
SEEDS = [dataset.FIRST_SEED, dataset.FIRST_SEED + 1]


def short_plan(seed: int) -> tuple[PossessionSpec, ...]:
    return SHORT_PLAN


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("dataset") / "data"
    archive = out.parent / "data.tar.gz"
    manifest = dataset.build_dataset(SEEDS, out, plan=short_plan, archive=archive, workers=1)
    return out, archive, manifest


@pytest.fixture(scope="module")
def matches():
    return {seed: build_match(seed, SHORT_PLAN) for seed in SEEDS}


def read(out: Path, table: str):
    return pq.read_table(out / f"{table}.parquet")


# --- seeds and plan ----------------------------------------------------------------------------


def test_the_release_plan_is_a_spec_match_with_fresh_hero_seeds():
    plans = [dataset.dataset_plan(s) for s in dataset.match_seeds(10)]
    assert dataset.match_seeds(10) == list(range(dataset.FIRST_SEED, dataset.FIRST_SEED + 10))
    for plan in plans:
        assert 15 <= len(plan) <= 25  # SPEC 3.1
        heroes = [s for s in plan if s.scenario != dataset.OPEN_PLAY]
        assert {s.scenario for s in heroes} == {
            "blind_side_run", "press_escape", "far_post_finish", "corner_blind_side"
        }  # fmt: skip
        # Fresh: never a design, eval or demo seed (all below 1,000,000).
        assert all(s.seed >= SEED_BASE for s in heroes)
        assert all(s.seed is None and s.max_s for s in plan if s.scenario == dataset.OPEN_PLAY)
        assert sum(s.max_s for s in plan if s.max_s) <= 13 * 60  # open-play caps
    hero_seeds = [s.seed for p in plans for s in p if s.seed is not None]
    assert len(set(hero_seeds)) == len(hero_seeds)  # no hero possession repeats across matches
    with pytest.raises(ValueError):
        dataset.match_seeds(dataset.MAX_MATCHES + 1)


# --- determinism -------------------------------------------------------------------------------


def test_same_seeds_give_byte_identical_files_and_archive(built, tmp_path):
    out, archive, manifest = built
    again = tmp_path / "data"
    dataset.build_dataset(SEEDS, again, plan=short_plan, archive=tmp_path / "a.tar.gz", workers=2)
    names = sorted(p.name for p in out.iterdir())
    assert names == sorted(p.name for p in again.iterdir())
    for name in names:
        assert (out / name).read_bytes() == (again / name).read_bytes(), name
    assert archive.read_bytes() == (tmp_path / "a.tar.gz").read_bytes()


def test_the_manifest_lists_every_file_with_its_hash_and_rows(built):
    out, _, manifest = built
    import hashlib

    on_disk = {p.name for p in out.iterdir()} - {"manifest.json"}
    assert set(manifest["files"]) == on_disk
    for name, entry in manifest["files"].items():
        data = (out / name).read_bytes()
        assert entry["bytes"] == len(data)
        assert entry["sha256"] == hashlib.sha256(data).hexdigest()
    for table in dataset.TABLES:
        assert manifest["files"][f"{table}.parquet"]["rows"] == read(out, table).num_rows
    assert json.loads((out / "manifest.json").read_text()) == manifest


# --- schema ------------------------------------------------------------------------------------


def test_every_parquet_file_has_the_documented_schema_with_units(built):
    out, _, _ = built
    for table, columns in dataset.TABLES.items():
        schema = pq.read_schema(out / f"{table}.parquet")
        assert schema.names == [c.name for c in columns], table
        for c, field in zip(columns, schema, strict=True):
            assert field.type == c.type, (table, c.name)
            meta = {k.decode(): v.decode() for k, v in (field.metadata or {}).items()}
            assert meta["unit"] == c.unit and meta["description"] == c.doc, (table, c.name)
            if not c.nullable:
                col = read(out, table).column(c.name)
                assert col.null_count == 0, (table, c.name)


def test_csv_files_hold_the_same_rows_as_parquet(built):
    out, _, _ = built
    for table in dataset.CSV_TABLES:
        with (out / f"{table}.csv").open(newline="") as fh:
            rows = list(csv.DictReader(fh))
        expected = read(out, table).to_pylist()
        assert len(rows) == len(expected), table
        for got, want in zip(rows, expected, strict=True):
            for name, value in want.items():
                text = got[name]
                if value is None:
                    assert text == "", (table, name)
                elif isinstance(value, bool):
                    assert text == str(value).lower(), (table, name)
                elif isinstance(value, float):
                    assert float(text) == value, (table, name)
                else:
                    assert text == str(value), (table, name)


def test_tracking_covers_every_frame_of_every_player_in_order(built, matches):
    out, _, _ = built
    tracking, ball = read(out, "tracking"), read(out, "ball")
    meta = json.loads((out / "metadata.json").read_text())
    ids = [p["id"] for p in meta["players"]]
    assert len(ids) == 22 and len(set(ids)) == 22
    for seed, m in matches.items():
        rows = tracking.filter(tracking.column("match_id").to_numpy() == seed)
        assert rows.num_rows == m.frames * 22
        frames = rows.column("frame").to_numpy().reshape(m.frames, 22)
        assert (frames == np.arange(m.frames)[:, None]).all()
        assert rows.column("player").to_pylist()[:22] == ids
        b = ball.filter(ball.column("match_id").to_numpy() == seed)
        assert b.column("frame").to_pylist() == list(range(m.frames))
        # has_ball agrees with the ball's owner.
        owner = b.column("owner").to_pylist()
        holders = rows.filter(rows.column("has_ball")).column("frame").to_pylist()
        assert holders == [f for f, o in enumerate(owner) if o is not None]


def test_metadata_describes_teams_players_and_possessions(built, matches):
    out, _, _ = built
    meta = json.loads((out / "metadata.json").read_text())
    assert meta["synthetic"] is True
    assert meta["frame_rate_hz"] == 25 and meta["pitch"]["length_m"] == 105
    assert [t["id"] for t in meta["teams"]] == [0, 1]
    # The invented clubs of sim/roster.py, as the app names them (SPEC 4.6).
    assert [(t["name"], t["side"]) for t in meta["teams"]] == [
        ("Kestrel Bay", "home"),
        ("Corvane Vale", "away"),
    ]
    for p in meta["players"]:
        assert set(p) >= {"id", "team", "role", "number", "name"}
    for entry in meta["matches"]:
        m = matches[entry["match_id"]]
        assert entry["frames"] == m.frames
        # The scenario that ran: the plan's, or its away variant when the restart before an
        # open-play passage went to the away team (SPEC 3.1).
        names = [p["scenario"] for p in entry["possessions"]]
        assert names == [p.scenario for p in m.possessions]
        assert [n.removesuffix("_away") for n in names] == [s.scenario for s in SHORT_PLAN]
        assert [p["start_frame"] for p in entry["possessions"]] == [p.start for p in m.possessions]
        assert entry["score"] == {"home": m.score[0], "away": m.score[1]}


# --- events ------------------------------------------------------------------------------------


def test_events_are_the_sims_events_in_match_time_plus_restarts(built, matches):
    out, _, _ = built
    events = read(out, "events").to_pylist()
    assert len({(e["match_id"], e["event_id"]) for e in events}) == len(events)
    for seed, m in matches.items():
        mine = [e for e in events if e["match_id"] == seed]
        sim = [e for e in mine if e["source"] == "sim"]
        expected = sorted(
            (e.frame + p.start, e.type, e.player) for p in m.possessions for e in p.run.events
        )
        assert sorted((e["frame"], e["type"], e["player"]) for e in sim) == expected
        restarts = [e for e in mine if e["type"] == "restart"]
        assert [(e["frame"], json.loads(e["attrs"])["kind"]) for e in restarts] == [
            (p.start, p.restart) for p in m.possessions
        ]
        assert all(e["t"] == pytest.approx(e["frame"] * DT) for e in mine)
        assert [(e["frame"], e["event_id"]) for e in mine] == sorted(
            (e["frame"], e["event_id"]) for e in mine
        )
    types = {e["type"] for e in events}
    # The short plan has passes, receptions, scans, the hero's shot and its goal.
    assert {"pass", "reception", "scan", "shot", "goal", "restart"} <= types


def test_pass_columns_flatten_the_sims_attributes(built):
    out, _, _ = built
    for e in read(out, "events").to_pylist():
        attrs = json.loads(e["attrs"])
        if e["type"] == "pass":
            assert (e["x"], e["y"]) == pytest.approx(tuple(attrs["start"]), abs=5e-4)
            assert e["recipient"] == attrs["to"] and e["outcome"] == attrs["outcome"]
            if attrs["end"] is not None:
                assert e["end_frame"] == attrs["end"] > e["frame"]
        if e["type"] in ("scan", "head_turn"):
            assert e["end_frame"] == attrs["end"] >= e["frame"]
            assert e["x"] is None
        if e["type"] == "goal":
            assert abs(e["x"]) > 52.5


def test_pressure_events_are_heavy_pressure_spells_on_one_carrier(built):
    out, _, _ = built
    events = read(out, "events").to_pylist()
    pressure = [e for e in events if e["type"] == "pressure"]
    assert pressure, "the short plan has heavy pressure"
    meta = json.loads((out / "metadata.json").read_text())
    team = {p["id"]: p["team"] for p in meta["players"]}
    for e in pressure:
        attrs = json.loads(e["attrs"])
        assert e["source"] == "derived"
        assert attrs["peak"] >= dataset.HEAVY_PRESSURE
        assert e["frame"] <= attrs["peak_frame"] <= e["end_frame"]
        assert team[e["player"]] != team[attrs["carrier"]] and team[e["player"]] == e["team"]


# --- perception --------------------------------------------------------------------------------


def test_replayed_beliefs_reproduce_every_decisions_belief_error_exactly(matches):
    decisions = 0
    for m in matches.values():
        for p in m.possessions:
            replay = dataset.BeliefReplay(p.run)
            for d in p.run.decisions:
                i = p.run.index(d.player)
                pos, age = replay.at(i, d.frame)
                pos[i] = p.run.pos[d.frame, i]
                error = np.linalg.norm(pos - p.run.pos[d.frame], axis=-1)
                assert dict(zip(p.run.ids, error.tolist(), strict=True)) == d.belief_error
                age[i] = 0.0
                assert dict(zip(p.run.ids, age.tolist(), strict=True)) == d.belief_age
                decisions += 1
    assert decisions >= 2


def test_receptions_count_scans_in_the_window_and_summarise_beliefs(built, matches):
    out, _, _ = built
    receptions = read(out, "receptions").to_pylist()
    beliefs = read(out, "beliefs").to_pylist()
    events = read(out, "events").to_pylist()
    assert receptions
    n_recv = sum(1 for e in events if e["type"] == "reception")
    assert len(receptions) == n_recv
    meta = json.loads((out / "metadata.json").read_text())
    team = {p["id"]: p["team"] for p in meta["players"]}
    for r in receptions:
        assert 0 < r["window_s"] <= dataset.SCAN_WINDOW_S + 1e-9
        lo = r["frame"] - round(r["window_s"] / DT)
        scans = [
            e for e in events
            if e["match_id"] == r["match_id"] and e["type"] == "scan" and e["player"] == r["player"]
            and lo <= e["frame"] < r["frame"]
        ]  # fmt: skip
        assert r["scans"] == len(scans)
        key = (r["match_id"], r["event_id"])
        mine = [b for b in beliefs if (b["match_id"], b["event_id"]) == key]
        assert len(mine) == 21 and all(b["observer"] == r["player"] for b in mine)
        opp = [b["error_m"] for b in mine if team[b["target"]] != r["team"]]
        assert r["belief_error_opponents_m"] == pytest.approx(np.mean(opp), abs=1e-3)
        assert r["belief_error_max_m"] == pytest.approx(max(b["error_m"] for b in mine), abs=5e-4)
    for b in beliefs:
        err = math.hypot(b["believed_x"] - b["true_x"], b["believed_y"] - b["true_y"])
        assert b["error_m"] == pytest.approx(err, abs=2e-3)
        assert b["age_s"] >= 0


def test_decisions_list_every_option_the_sim_weighed(built, matches):
    out, _, _ = built
    rows = read(out, "decisions").to_pylist()
    expected = [
        (seed, d.frame + p.start, d.player, o.action, o.action == d.chosen)
        for seed, m in matches.items() for p in m.possessions for d in p.run.decisions
        for o in d.options
    ]  # fmt: skip
    got = [(r["match_id"], r["frame"], r["player"], r["action"], r["chosen"]) for r in rows]
    assert sorted(got) == sorted(expected)


# --- sample, archive, docs ---------------------------------------------------------------------


def test_the_archive_holds_exactly_the_manifest_files(built):
    import tarfile

    out, archive, manifest = built
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
    root = dataset.ARCHIVE_ROOT
    assert sorted(m.name for m in members) == sorted(
        f"{root}/{n}" for n in [*manifest["files"], "manifest.json"]
    )
    assert all(m.mtime == 0 and m.uid == 0 and m.gid == 0 for m in members)


def test_a_sample_is_one_possession_of_the_dataset(built, tmp_path):
    out, _, _ = built
    sample = tmp_path / "sample"
    dataset.write_sample(out, sample, match_id=SEEDS[0], possession=2)
    events = read(sample, "events").to_pylist()
    assert {(e["match_id"], e["possession"]) for e in events} == {(SEEDS[0], 2)}
    full = [
        e for e in read(out, "events").to_pylist()
        if (e["match_id"], e["possession"]) == (SEEDS[0], 2)
    ]  # fmt: skip
    assert events == full
    tracking = read(sample, "tracking")
    assert set(tracking.column("possession").to_pylist()) == {2}
    meta = json.loads((sample / "metadata.json").read_text())
    assert [p["index"] for p in meta["matches"][0]["possessions"]] == [2]


SAMPLE = ROOT / "data" / "sample"


def test_the_committed_sample_has_the_documented_schema_and_is_small():
    total = sum(p.stat().st_size for p in SAMPLE.iterdir())
    assert total < 500 * 1024
    for table, columns in dataset.TABLES.items():
        assert pq.read_schema(SAMPLE / f"{table}.parquet").names == [c.name for c in columns]
    manifest = json.loads((SAMPLE / "manifest.json").read_text())
    assert set(manifest["files"]) == {p.name for p in SAMPLE.iterdir()} - {"manifest.json"}
    meta = json.loads((SAMPLE / "metadata.json").read_text())
    [entry] = meta["matches"]
    assert entry["match_id"] == dataset.FIRST_SEED
    assert [p["index"] for p in entry["possessions"]] == [dataset.SAMPLE_POSSESSION]


def _generated_here(manifest: dict) -> bool:
    return manifest["generated_with"] == {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pyarrow": pa.__version__,
        "platform": f"{platform.system()}-{platform.machine()}",
    }


# Some GitHub x86_64 runners rebuild the sample with other last bits even on numpy's pinned tier
# (main's CI on 2026-10-23, after #172 and #207: the same bytes as linux/arm64). Measured there:
# tracking positions up to 6 mm, tracking velocities up to 0.145 m/s, every other float by at
# most one stored quantum (sim.dataset rounds metres and m/s to 1e-3, radians to 1e-4, seconds
# to 1e-2). Every non-float column, row count and schema stays exact.
TRACKING_BOUND = {"x": 0.010, "y": 0.010, "vx": 0.25, "vy": 0.25}
QUANTUM = {"m": 1e-3, "m/s": 1e-3, "rad": 1e-4, "s": 1e-2}


def _float_bound(table: str, column: dataset.Column) -> float:
    if table == "tracking" and column.name in TRACKING_BOUND:
        return TRACKING_BOUND[column.name]
    return QUANTUM.get(column.unit, 1e-4)


def _assert_floats_near(fresh, committed, bound: float, where: str) -> None:
    x, y = (
        np.array([np.nan if v is None else v for v in c], dtype=float) for c in (fresh, committed)
    )
    assert np.array_equal(np.isnan(x), np.isnan(y)), f"{where}: nulls"
    worst = float(np.nanmax(np.abs(x - y), initial=0.0))
    assert worst <= bound + 1e-6, f"{where}: {worst} > {bound}"  # 1e-6: float32 storage


def _assert_table_near(fresh: pa.Table, committed: pa.Table, table: str) -> None:
    assert fresh.schema.equals(committed.schema) and fresh.num_rows == committed.num_rows, table
    for column in dataset.TABLES[table]:
        a, b = (t.column(column.name).to_pylist() for t in (fresh, committed))
        if pa.types.is_floating(column.type):
            _assert_floats_near(a, b, _float_bound(table, column), f"{table}.{column.name}")
        else:
            assert a == b, f"{table}.{column.name}"


def _assert_csv_near(fresh: Path, committed: Path, table: str) -> None:
    rows = [list(csv.reader(p.read_text().splitlines())) for p in (fresh, committed)]
    assert rows[0][0] == rows[1][0] and len(rows[0]) == len(rows[1]), table
    columns = {c.name: c for c in dataset.TABLES[table]}
    for i, name in enumerate(rows[1][0]):
        a, b = ([r[i] for r in rs[1:]] for rs in rows)
        column = columns[name]
        if pa.types.is_floating(column.type):
            a, b = ([float(v) if v else None for v in c] for c in (a, b))
            _assert_floats_near(a, b, _float_bound(table, column), f"{table}.csv {name}")
        else:
            assert a == b, f"{table}.csv {name}"


def _without_hashes(manifest: dict) -> dict:
    files = {k: {f: v for f, v in e.items() if f not in ("sha256", "bytes")}
             for k, e in manifest["files"].items()}  # fmt: skip
    return {**manifest, "files": files}


def test_the_committed_sample_regenerates_byte_for_byte(tmp_path):
    """Only where it was made: the sim is byte-identical per platform and versions (SPEC 3.7).
    It is made on Linux, the canonical platform (`tests/canonical.py`). Byte for byte, or failing
    that the structure exactly and the floats within the bounds measured above."""
    manifest = json.loads((SAMPLE / "manifest.json").read_text())
    if not _generated_here(manifest):
        pytest.skip(
            f"the sample was generated on {manifest['generated_with']}; "
            + canonical.message("dataset")
        )
    dataset.build_dataset([dataset.FIRST_SEED], tmp_path / "data")
    dataset.write_sample(
        tmp_path / "data", tmp_path / "sample", dataset.FIRST_SEED, dataset.SAMPLE_POSSESSION
    )
    _assert_sample_near(tmp_path / "sample", SAMPLE)


def _assert_sample_near(sample: Path, committed_sample: Path) -> None:
    names = sorted(p.name for p in committed_sample.iterdir())
    assert names == sorted(p.name for p in sample.iterdir())
    manifest = json.loads((committed_sample / "manifest.json").read_text())
    for name in names:
        fresh, committed = sample / name, committed_sample / name
        if fresh.read_bytes() == committed.read_bytes():
            continue
        stem, suffix = name.rsplit(".", 1)
        if suffix == "parquet":
            _assert_table_near(pq.read_table(fresh), pq.read_table(committed), stem)
        elif suffix == "csv":
            _assert_csv_near(fresh, committed, stem)
        elif name == "manifest.json":
            assert _without_hashes(json.loads(fresh.read_text())) == _without_hashes(manifest)
        else:
            raise AssertionError(name)


def test_the_sample_check_allows_the_measured_drift_and_no_more():
    """`_assert_table_near` on the committed tracking table against itself, moved."""
    tracking = pq.read_table(SAMPLE / "tracking.parquet")

    def moved(column: str, by: float) -> pa.Table:
        values = np.asarray(tracking.column(column).to_numpy(), dtype=float)
        values[0] += by
        i = tracking.schema.get_field_index(column)
        return tracking.set_column(
            i, tracking.schema.field(i), pa.array(values, tracking.schema.field(i).type)
        )

    _assert_table_near(moved("x", 0.009), tracking, "tracking")
    _assert_table_near(moved("vx", 0.2), tracking, "tracking")
    _assert_table_near(moved("body_yaw", 1e-4), tracking, "tracking")
    for column, by in (("x", 0.012), ("vx", 0.3), ("body_yaw", 3e-4)):
        with pytest.raises(AssertionError):
            _assert_table_near(moved(column, by), tracking, "tracking")
    frames = tracking.column("frame").to_pylist()
    shifted = tracking.set_column(
        tracking.schema.get_field_index("frame"), "frame",
        pa.array([frames[0] + 1, *frames[1:]], tracking.schema.field("frame").type),
    )  # fmt: skip
    with pytest.raises(AssertionError):
        _assert_table_near(shifted, tracking, "tracking")


def test_the_datasheet_documents_every_column():
    doc = (ROOT / "docs" / "DATASET.md").read_text()
    sections = re.split(r"^### ", doc, flags=re.MULTILINE)
    for table, columns in dataset.TABLES.items():
        section = next((s for s in sections if s.startswith(f"`{table}`")), None)
        assert section is not None, f"no ### `{table}` section"
        for c in columns:
            assert f"| `{c.name}` |" in section, (table, c.name)
    assert "TODO(Bowen)" in doc  # the licence is his call


def test_the_quickstart_reads_the_files_and_matches_the_sim(built, matches):
    out, _, _ = built
    spec = importlib.util.spec_from_file_location(
        "quickstart", ROOT / "examples" / "dataset_quickstart.py"
    )
    quickstart = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(quickstart)
    completion = quickstart.pass_completion(out)
    for team in (0, 1):
        passes = [
            e for m in matches.values() for p in m.possessions for e in p.run.events
            if e.type == "pass" and e.team == team and e.attrs["outcome"] is not None
        ]  # fmt: skip
        done = sum(e.attrs["outcome"] == "complete" for e in passes)
        assert completion.get(team, (0, 0)) == (done, len(passes))  # the short plan: home only
    rates = quickstart.scans_per_minute(out)
    minutes = sum(m.duration_s for m in matches.values()) / 60
    for role, rate in rates.items():
        scans = sum(
            1 for m in matches.values() for p in m.possessions for e in p.run.events
            if e.type == "scan" and m.players[p.run.index(e.player)].role == role
        )  # fmt: skip
        players = sum(1 for pl in next(iter(matches.values())).players if pl.role == role)
        assert rate == pytest.approx(scans / players / minutes)
