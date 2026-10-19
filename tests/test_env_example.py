"""Every environment variable the code reads is documented in .env.example (CLAUDE.md)."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".venv", "node_modules", ".git", "out"}

PY_PATTERNS = [
    re.compile(r"os\.environ\[\s*['\"]([A-Z][A-Z0-9_]*)['\"]"),
    re.compile(r"os\.environ\.get\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]"),
    re.compile(r"os\.getenv\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]"),
    re.compile(r"require_env\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]"),
]
# Shell inputs are the variables read with a default: ${NAME:-default}.
SH_PATTERN = re.compile(r"\$\{([A-Z][A-Z0-9_]*):-")


def _files(suffix: str) -> list[Path]:
    return [
        p for p in ROOT.rglob(f"*{suffix}") if not SKIP_DIRS.intersection(p.relative_to(ROOT).parts)
    ]


def _documented() -> set[str]:
    text = (ROOT / ".env.example").read_text()
    return set(re.findall(r"^([A-Z][A-Z0-9_]*)=", text, flags=re.MULTILINE))


def _used() -> set[str]:
    names: set[str] = set()
    for path in _files(".py"):
        if path.name == Path(__file__).name:
            continue
        text = path.read_text()
        for pattern in PY_PATTERNS:
            names.update(pattern.findall(text))
    for path in _files(".sh"):
        names.update(SH_PATTERN.findall(path.read_text()))
    return names


def test_every_env_var_is_documented() -> None:
    missing = _used() - _documented()
    assert not missing, f"document these in .env.example: {sorted(missing)}"


def test_env_example_has_no_secret_values() -> None:
    text = (ROOT / ".env.example").read_text()
    for name in ("AZURE_SPEECH_KEY",):
        assert re.search(rf"^{name}=$", text, flags=re.MULTILINE), f"{name} must be empty"
