"""The canonical platform for committed generated artifacts (SPEC 3.7).

Exports, fixtures, demo/hero.html, the xT grid and the eval reports are generated on linux/amd64
(python:3.11-slim), where CI and the live API run. The sim is byte-identical only within one
platform: macOS and glibc differ in libm's last bits, which open play and the hero
counterfactuals amplify to millimetres, and arm64 Linux differs from amd64 in the last bit of a
few exports. So a test that compares a committed artifact with a fresh run checks it byte for byte
on linux/amd64 and skips elsewhere, rather than loosening the check.

Within linux/amd64, numpy picks a SIMD tier per machine: AVX-512 code (X86_V4) for float64 sin,
cos, exp, log, tanh, arctan2, power and others where the CPU has it, AVX2 code (X86_V3) elsewhere,
and the two differ in the last bit too. GitHub's runners come with and without AVX-512, so the
artifacts are made on the AVX2 tier and every check runs on it: CI and `scripts/regen_linux.sh`
set NUMPY_PIN (below) as NPY_DISABLE_CPU_FEATURES, as does the API image, and
`tests/test_canonical.py` fails when a linux/amd64 run takes another tier.
"""

import platform

import pytest

ON_LINUX = platform.system() == "Linux" and platform.machine() in ("x86_64", "AMD64")
# NPY_DISABLE_CPU_FEATURES for every linux/amd64 run that makes or checks an artifact.
NUMPY_PIN = "X86_V4 AVX512_ICL AVX512_SPR"
CANONICAL_TIER = "X86_V3"


def message(group: str = "exports") -> str:
    return (
        "canonical artifacts are generated on linux/amd64 (python:3.11-slim, where CI and the API "
        "run); "
        f"regenerate them with `scripts/regen_linux.sh {group}`"
    )


def linux_only(group: str = "exports"):
    """Skip a byte-for-byte freshness check off Linux."""
    return pytest.mark.skipif(not ON_LINUX, reason=message(group))


def numpy_float64_tiers() -> set[str]:
    """The SIMD tiers numpy's float64 ufunc loops run on in this process."""
    from numpy.lib import introspect

    info = introspect.opt_func_info(signature="float64")
    return {t["current"] for sigs in info.values() for t in sigs.values()}
