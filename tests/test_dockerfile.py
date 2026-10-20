"""The API container image (SPEC 8): only the service's code and main dependencies, never root.

Static checks on the Dockerfile and .dockerignore, so they run without docker.
"""

import fnmatch
import re
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = {"agents", "analytics", "api", "explain", "sim", "pyproject.toml", "uv.lock"}
NEVER = [".env", ".env.local", "out/cache/x.json", "demo/realfeed/check.py", "web/src/main.tsx",
         "tests/test_api.py", "eval/reports/blind_side.md", ".git/config"]  # fmt: skip


def _instructions() -> list[tuple[str, str]]:
    """(INSTRUCTION, arguments), with comments dropped and continuation lines joined."""
    text = re.sub(r"\\\n", " ", (ROOT / "Dockerfile").read_text())
    out = []
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            word, _, rest = line.partition(" ")
            out.append((word.upper(), rest.strip()))
    return out


def _stages() -> list[list[tuple[str, str]]]:
    stages: list[list[tuple[str, str]]] = []
    for ins in _instructions():
        if ins[0] == "FROM":
            stages.append([])
        if stages:
            stages[-1].append(ins)
    return stages


def _context_copies() -> list[str]:
    """Every source path a COPY or ADD takes from the build context (not from another stage)."""
    sources = []
    for word, args in _instructions():
        if word not in ("COPY", "ADD") or "--from=" in args:
            continue
        parts = [p for p in shlex.split(args) if not p.startswith("--")]
        sources += [p.rstrip("/") or "." for p in parts[:-1]]
    return sources


def _in_context(path: str) -> bool:
    """Whether .dockerignore lets `path` into the build context (last matching pattern wins)."""
    included = True
    for raw in (ROOT / ".dockerignore").read_text().splitlines():
        pattern = raw.strip()
        if not pattern or pattern.startswith("#"):
            continue
        negate = pattern.startswith("!")
        pattern = pattern.lstrip("!").strip("/")
        parts = path.split("/")
        prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
        if any(fnmatch.fnmatchcase(p, pattern) for p in prefixes):
            included = negate
    return included


def test_image_is_python_311_slim():
    froms = [args.split()[0] for word, args in _instructions() if word == "FROM"]
    assert froms and all(f == "python:3.11-slim" for f in froms)


def test_image_copies_only_the_service():
    sources = _context_copies()
    assert set(sources) <= SERVICE, f"unexpected COPY sources: {set(sources) - SERVICE}"
    assert {"agents", "analytics", "api", "explain", "sim", "uv.lock"} <= set(sources)


def test_build_context_leaves_out_secrets_output_and_the_demo():
    for path in NEVER:
        assert not _in_context(path), f"{path} is in the build context"
    for path in ("agents/workflow.py", "api/main.py", "sim/scenarios/base.py", "uv.lock"):
        assert _in_context(path), f"{path} is missing from the build context"


def test_dependencies_are_the_locked_main_group_only():
    syncs = [args for word, args in _instructions() if word == "RUN" and "uv sync" in args]
    assert syncs, "the image must install with uv sync"
    for args in syncs:
        flags = shlex.split(args)
        assert {"--locked", "--no-default-groups", "--no-dev"} <= set(flags)
        assert not {"--group", "--all-groups", "--only-group"} & set(flags)
        assert "realfeed" not in args


def test_service_runs_as_a_non_root_user():
    final = _stages()[-1]
    users = [args for word, args in final if word == "USER"]
    assert users, "the final stage must switch to a non-root user"
    assert users[-1].split(":")[0] not in ("root", "0")


def test_service_command_is_uvicorn_on_port_8000():
    cmds = [args for word, args in _stages()[-1] if word == "CMD"]
    assert cmds
    assert re.sub(r"[\[\]\",]", " ", cmds[-1]).split() == [
        "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000",
        "--ws-max-size", "4096",  # the longest live control message is 256 chars (api/live.py)
    ]  # fmt: skip
