"""infra/upload_web.sh uploads the web build as the site should serve it (SPEC 8).

Azure Storage sends each blob as it is stored, with the Content-Encoding and Cache-Control set at
upload, and never compresses on the fly. So the build is staged first (web/scripts/stage.mjs):
text files gzipped, hashed assets cached for a year, index.html revalidated on every visit and
uploaded last, so a visitor never gets an index.html whose assets are not there yet.
"""

import gzip
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "infra" / "upload_web.sh"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")

# Records each upload-batch call and the files it would send, with their bytes.
FAKE_AZ = """#!/usr/bin/env bash
set -euo pipefail
n=$(( $(ls "$AZ_LOG" 2>/dev/null | wc -l) ))
call="$AZ_LOG/$(printf %02d "$n")"
mkdir -p "$call"
printf '%s\\n' "$@" > "$call/args"
src=""
prev=""
for a in "$@"; do
  if [[ $prev == "-s" || $prev == "--source" ]]; then src=$a; fi
  prev=$a
done
cp -R "$src" "$call/files"
"""


def _build(dist: Path) -> dict[str, bytes]:
    """A small build: hashed assets, bundled data, the model, the page."""
    files = {
        "index.html": b"<!doctype html><script src=/assets/index-AbC123.js></script>",
        "favicon.svg": b"<svg xmlns='http://www.w3.org/2000/svg'/>",
        "assets/index-AbC123.js": b"export const a = 1;\n" * 2000,
        "assets/vendor-XyZ789.js": b"function three() { return 42; }\n" * 4000,
        "assets/index-Def456.css": b".app { color: red; }\n" * 1000,
        "assets/random-Qq9.png": os.urandom(4096),
        "data/hero_seed3.json": b'{"frames": [1, 2, 3]}' * 3000,
        "models/grf_player.glb": b"glTF" + bytes(range(256)) * 64,
        "models/LICENSE-grf_player.txt": b"This is free and unencumbered software.\n",
    }
    for rel, data in files.items():
        (dist / rel).parent.mkdir(parents=True, exist_ok=True)
        (dist / rel).write_bytes(data)
    return files


def _upload(tmp_path: Path) -> tuple[dict[str, bytes], list[dict]]:
    dist = tmp_path / "dist"
    files = _build(dist)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    az = bin_dir / "az"
    az.write_text(FAKE_AZ)
    az.chmod(az.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "az"
    log.mkdir()
    node = Path(shutil.which("node")).parent
    env = {"PATH": f"{bin_dir}:{node}:/usr/bin:/bin", "AZ_LOG": str(log), "HOME": str(tmp_path)}
    r = subprocess.run(
        ["bash", str(SCRIPT), "tteaccount", str(dist), str(tmp_path / "staged")],
        env=env, capture_output=True, text=True, timeout=60,
    )  # fmt: skip
    assert r.returncode == 0, r.stderr
    calls = []
    for call in sorted(log.iterdir()):
        args = (call / "args").read_text().splitlines()
        sent = {
            str(p.relative_to(call / "files")): p.read_bytes()
            for p in (call / "files").rglob("*")
            if p.is_file()
        }
        opts = {a: args[i + 1] for i, a in enumerate(args[:-1]) if a.startswith("-")}
        calls.append({"args": args, "opts": opts, "files": sent})
    return files, calls


def _decoded(call: dict, rel: str) -> bytes:
    data = call["files"][rel]
    return gzip.decompress(data) if call["opts"].get("--content-encoding") == "gzip" else data


def test_every_file_is_uploaded_once_and_decodes_to_the_build(tmp_path):
    files, calls = _upload(tmp_path)
    seen: dict[str, bytes] = {}
    for call in calls:
        assert call["args"][:3] == ["storage", "blob", "upload-batch"]
        assert call["opts"]["--account-name"] == "tteaccount"
        assert call["opts"]["--auth-mode"] == "login"  # keyless, as before
        assert call["opts"]["-d"] == "$web"
        assert "--overwrite" in call["args"]
        for rel in call["files"]:
            assert rel not in seen, f"{rel} uploaded twice"
            seen[rel] = _decoded(call, rel)
    assert seen == files


def test_text_is_gzipped_and_hashed_assets_are_immutable(tmp_path):
    _, calls = _upload(tmp_path)
    by_file = {rel: call for call in calls for rel in call["files"]}
    for rel in ["assets/index-AbC123.js", "assets/vendor-XyZ789.js", "assets/index-Def456.css"]:
        opts = by_file[rel]["opts"]
        assert opts["--content-encoding"] == "gzip", rel
        assert opts["--content-cache-control"] == "public, max-age=31536000, immutable", rel
        assert len(by_file[rel]["files"][rel]) < 0.5 * len(_decoded(by_file[rel], rel))
    # Random bytes do not shrink: sent as they are, still a hashed asset.
    png = by_file["assets/random-Qq9.png"]["opts"]
    assert "--content-encoding" not in png
    assert png["--content-cache-control"] == "public, max-age=31536000, immutable"
    # Not hashed: short cache, revalidated by ETag; the data and the model are gzipped.
    for rel in ["data/hero_seed3.json", "models/grf_player.glb"]:
        assert by_file[rel]["opts"]["--content-encoding"] == "gzip", rel
        assert by_file[rel]["opts"]["--content-cache-control"] == "public, max-age=300", rel
    for rel in ["favicon.svg", "models/LICENSE-grf_player.txt"]:  # too small to be worth it
        assert "--content-encoding" not in by_file[rel]["opts"], rel


def test_index_html_goes_last_plain_and_revalidated(tmp_path):
    _, calls = _upload(tmp_path)
    last = calls[-1]
    assert list(last["files"]) == ["index.html"]
    assert "--content-encoding" not in last["opts"]  # also the error document
    assert last["opts"]["--content-cache-control"] == "no-cache"
    assert all("index.html" not in c["files"] for c in calls[:-1])


def test_both_deploy_paths_use_the_staged_upload():
    for path in [ROOT / "infra" / "deploy.sh", ROOT / ".github" / "workflows" / "deploy.yml"]:
        text = path.read_text()
        assert "infra/upload_web.sh" in text, path
        assert "-s web/dist" not in text, path
    assert os.access(SCRIPT, os.X_OK)
