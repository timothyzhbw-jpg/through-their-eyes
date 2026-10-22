"""The canonical platform for committed generated artifacts (SPEC 3.7).

Exports, fixtures, demo/hero.html, the xT grid and the eval reports are generated on linux/amd64
(python:3.11-slim), where CI and the live API run. The sim is byte-identical only within one
platform: macOS and glibc differ in libm's last bits, which open play and the hero
counterfactuals amplify to millimetres, and arm64 Linux differs from amd64 in the last bit of a
few exports. So a test that compares a committed artifact with a fresh run checks it byte for byte
on linux/amd64 and skips elsewhere, rather than loosening the check.
"""

import platform

import pytest

ON_LINUX = platform.system() == "Linux" and platform.machine() in ("x86_64", "AMD64")


def message(group: str = "exports") -> str:
    return (
        "canonical artifacts are generated on linux/amd64 (python:3.11-slim, where CI and the API "
        "run); "
        f"regenerate them with `scripts/regen_linux.sh {group}`"
    )


def linux_only(group: str = "exports"):
    """Skip a byte-for-byte freshness check off Linux."""
    return pytest.mark.skipif(not ON_LINUX, reason=message(group))
