"""infra/upload_web.sh uploads the web build as the site should serve it (SPEC 8).

Azure Storage sends each blob as stored, with the Content-Type, Content-Encoding and Cache-Control
set at upload, and never compresses on the fly. So the build is staged first
(web/scripts/stage.mjs): text gzipped, every known type named explicitly, and index.html uploaded
last, only after every other file has been read back from the site with the right headers and
bytes (web/scripts/check-site.mjs). If the new index.html then reads back wrong, the previous one
goes back up.

On 2026-10-21 (#115) every gzipped file went up as application/octet-stream: `az storage blob
upload-batch` guesses a type from the extension only when no Content-Encoding is given
(`guess_content_type` in azure-cli's storage module), browsers refused the scripts, and the page
stayed on "Loading the match…". The fake `az` here stores blobs the way the real one does, and a
local HTTP server serves them the way the static website does.
"""

import gzip
import http.server
import json
import os
import shutil
import stat
import subprocess
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "infra" / "upload_web.sh"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")

# Stores each uploaded file under $AZ_STORE with its properties, as `az storage blob upload-batch`
# does: an explicit --content-type wins; without one, the type is guessed from the extension only
# when no --content-encoding is set, else the blob gets none (served as application/octet-stream).
# FAKE_AZ_DROP_TYPE=1 ignores --content-type (the #115 upload); FAKE_AZ_BAD_INDEX=1 stores
# index.html as text/plain.
FAKE_AZ = r"""#!/usr/bin/env python3
import json, mimetypes, os, shutil, sys
from pathlib import Path

args = sys.argv[1:]
log = Path(os.environ["AZ_LOG"])
calls = json.loads(log.read_text()) if log.exists() else []
calls.append(args)
log.write_text(json.dumps(calls))
if args[:3] != ["storage", "blob", "upload-batch"]:
    sys.exit(f"unexpected az call: {args}")
opt = {a: args[i + 1] for i, a in enumerate(args[:-1]) if a.startswith("-")}
encoding = opt.get("--content-encoding", "")
explicit = "" if os.environ.get("FAKE_AZ_DROP_TYPE") else opt.get("--content-type", "")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("application/javascript", ".js")
store = Path(os.environ["AZ_STORE"])
src = Path(opt["-s"])
for path in sorted(p for p in src.rglob("*") if p.is_file()):
    rel = path.relative_to(src).as_posix()
    if explicit:
        ctype = explicit
    elif encoding:
        ctype = ""
    else:
        ctype = mimetypes.guess_type(rel)[0] or ""
    if rel == "index.html" and os.environ.get("FAKE_AZ_BAD_INDEX"):
        ctype = "text/plain"
    target = store / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
    meta = {"type": ctype or "application/octet-stream", "encoding": encoding,
            "cache": opt.get("--content-cache-control", "")}
    Path(str(target) + ".meta").write_text(json.dumps(meta))
"""


class _Site(http.server.BaseHTTPRequestHandler):
    """The static website: each blob with its stored headers; a missing one gets index.html."""

    store: Path

    def do_GET(self):  # noqa: N802 (http.server's name)
        rel = self.path.split("?")[0].lstrip("/") or "index.html"
        path = self.store / rel
        status = 200
        if not path.is_file():
            path, status = self.store / "index.html", 404
        if not path.is_file():
            self.send_error(404)
            return
        meta = json.loads(Path(str(path) + ".meta").read_text())
        body = path.read_bytes()
        self.send_response(status)
        self.send_header("Content-Type", meta["type"])
        if meta["encoding"]:
            self.send_header("Content-Encoding", meta["encoding"])
        if meta["cache"]:
            self.send_header("Cache-Control", meta["cache"])
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def _build(dist: Path) -> dict[str, bytes]:
    """A small build: hashed assets, bundled data, the model, the page."""
    files = {
        "index.html": b"<!doctype html><script type=module src=/assets/index.AbC123.js></script>",
        "favicon.svg": b"<svg xmlns='http://www.w3.org/2000/svg'/>",
        "assets/index.AbC123.js": b"export const a = 1;\n" * 2000,
        "assets/vendor.XyZ789.js": b"function three() { return 42; }\n" * 4000,
        "assets/rolldown-runtime.Qq1.js": b"export {};\n",
        "assets/index.Def456.css": b".app { color: red; }\n" * 1000,
        "assets/random.Qq9.png": os.urandom(4096),
        "data/hero_seed3.json": b'{"frames": [1, 2, 3]}' * 3000,
        "models/grf_player.glb": b"glTF" + bytes(range(256)) * 64,
        "models/LICENSE-grf_player.txt": b"This is free and unencumbered software.\n",
    }
    for rel, data in files.items():
        (dist / rel).parent.mkdir(parents=True, exist_ok=True)
        (dist / rel).write_bytes(data)
    return files


# What a browser needs for each file.
TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".glb": "model/gltf-binary",
    ".png": "image/png",
    ".txt": "text/plain",
}

PREVIOUS = b"<!doctype html><p>the previous deploy</p>"


def _upload(tmp_path: Path, **env: str) -> tuple[subprocess.CompletedProcess, dict, list, Path]:
    dist = tmp_path / "dist"
    files = _build(dist)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    az = bin_dir / "az"
    az.write_text(FAKE_AZ)
    az.chmod(az.stat().st_mode | stat.S_IEXEC)
    store = tmp_path / "store"
    store.mkdir()
    (store / "index.html").write_bytes(PREVIOUS)  # the site as the last deploy left it
    (store / "index.html.meta").write_text(
        json.dumps({"type": "text/html", "encoding": "", "cache": "no-cache"})
    )
    handler = type("Site", (_Site,), {"store": store})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    site = f"http://127.0.0.1:{server.server_address[1]}"
    node = Path(shutil.which("node")).parent
    python = Path(shutil.which("python3")).parent
    base = {"PATH": f"{bin_dir}:{node}:{python}:/usr/bin:/bin", "HOME": str(tmp_path),
            "AZ_LOG": str(tmp_path / "az.json"), "AZ_STORE": str(store),
            "TTE_UPLOAD_NO_BROWSER": "1"}  # fmt: skip
    try:
        r = subprocess.run(
            ["bash", str(SCRIPT), "tteaccount", site, str(dist), str(tmp_path / "staged")],
            env=base | env, capture_output=True, text=True, timeout=120,
        )  # fmt: skip
    finally:
        server.shutdown()
    log = tmp_path / "az.json"
    calls = json.loads(log.read_text()) if log.exists() else []
    return r, files, calls, store


def _served(store: Path, rel: str) -> tuple[bytes, dict]:
    meta = json.loads(Path(str(store / rel) + ".meta").read_text())
    data = (store / rel).read_bytes()
    return (gzip.decompress(data) if meta["encoding"] == "gzip" else data), meta


def _opts(call: list[str]) -> dict[str, str]:
    return {a: call[i + 1] for i, a in enumerate(call[:-1]) if a.startswith("-")}


def test_every_file_is_served_with_its_type_and_its_bytes(tmp_path):
    r, files, calls, store = _upload(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    for rel, data in files.items():
        body, meta = _served(store, rel)
        assert body == data, rel
        assert meta["type"] == TYPES[Path(rel).suffix], rel
    for call in calls:
        opts = _opts(call)
        assert opts["--account-name"] == "tteaccount"
        assert opts["--auth-mode"] == "login"  # keyless, as before
        assert opts["-d"] == "$web"
        assert "--overwrite" in call
        if "--content-encoding" in opts:  # az would not guess: the type must be named
            assert "--content-type" in opts, call


def test_text_is_gzipped_and_nothing_is_cached_long_yet(tmp_path):
    r, _, _, store = _upload(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    for rel in ["assets/index.AbC123.js", "assets/vendor.XyZ789.js", "assets/index.Def456.css",
                "data/hero_seed3.json", "models/grf_player.glb"]:  # fmt: skip
        _, meta = _served(store, rel)
        assert meta["encoding"] == "gzip", rel
        assert len((store / rel).read_bytes()) < 0.5 * len(_served(store, rel)[0]), rel
    for rel in ["assets/random.Qq9.png", "favicon.svg", "assets/rolldown-runtime.Qq1.js"]:
        assert _served(store, rel)[1]["encoding"] == "", rel  # incompressible or too small
    # A short cache everywhere: a file served wrongly under its final name must not stay in
    # visitors' caches for a year (PR desk, 2026-10-21).
    for rel in ["assets/index.AbC123.js", "data/hero_seed3.json", "favicon.svg"]:
        assert _served(store, rel)[1]["cache"] == "public, max-age=300", rel
    assert _served(store, "index.html")[1]["cache"] == "no-cache"


def test_index_html_goes_up_last(tmp_path):
    r, files, calls, store = _upload(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    last = calls[-1]
    staged = Path(_opts(last)["-s"])
    assert sorted(p.name for p in staged.rglob("*") if p.is_file()) == ["index.html"]
    assert _opts(last)["--content-type"] == "text/html"
    assert "--content-encoding" not in _opts(last)  # also the error document
    assert _served(store, "index.html")[0] == files["index.html"]


def test_a_wrong_type_stops_the_deploy_before_index_html(tmp_path):
    # The #115 upload: gzipped files stored with no type. The check reads them back from the
    # site, refuses, and the visitors keep the previous page, whose files are all still there.
    r, _, calls, store = _upload(tmp_path, FAKE_AZ_DROP_TYPE="1")
    assert r.returncode != 0
    assert "application/octet-stream" in r.stdout + r.stderr
    assert "assets/index.AbC123.js" in r.stdout + r.stderr
    assert (store / "index.html").read_bytes() == PREVIOUS
    assert all("index.html" not in [p.name for p in Path(_opts(c)["-s"]).rglob("*")] for c in calls)


def test_a_bad_index_html_is_rolled_back(tmp_path):
    r, _, calls, store = _upload(tmp_path, FAKE_AZ_BAD_INDEX="1")
    assert r.returncode != 0
    assert "text/plain" in r.stdout + r.stderr
    body, meta = _served(store, "index.html")
    assert body == PREVIOUS  # the previous page is back
    assert meta["cache"] == "no-cache"


def test_both_deploy_paths_use_the_checked_upload():
    for path in [ROOT / "infra" / "deploy.sh", ROOT / ".github" / "workflows" / "deploy.yml"]:
        text = path.read_text()
        assert "infra/upload_web.sh" in text, path
        assert "-s web/dist" not in text, path
    assert os.access(SCRIPT, os.X_OK)
