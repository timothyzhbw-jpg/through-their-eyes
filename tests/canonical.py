"""The canonical platform for committed generated artifacts (SPEC 3.7).

Exports, fixtures, demo/hero.html, the xT grid and the eval reports are generated on Linux
(python:3.11-slim), where CI and the live API run. The sim is byte-identical only within one OS:
macOS and glibc differ in libm's last bits, which open play and the hero counterfactuals amplify
to millimetres. So a test that compares a committed artifact with a fresh run checks it byte for
byte on Linux and skips elsewhere, rather than loosening the check.
"""

import platform

import pytest

ON_LINUX = platform.system() == "Linux"


def message(group: str = "exports") -> str:
    return (
        "canonical artifacts are generated on Linux (python:3.11-slim, where CI and the API run); "
        f"regenerate them with `scripts/regen_linux.sh {group}`"
    )


def linux_only(group: str = "exports"):
    """Skip a byte-for-byte freshness check off Linux."""
    return pytest.mark.skipif(not ON_LINUX, reason=message(group))
