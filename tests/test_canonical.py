"""Every linux/amd64 run that makes or checks an artifact takes the same numpy SIMD tier
(SPEC 3.7, `tests/canonical.py`)."""

import re
from pathlib import Path

from tests import canonical

ROOT = Path(__file__).resolve().parents[1]


@canonical.linux_only()
def test_numpy_runs_on_the_tier_the_artifacts_are_made_on():
    """On main's CI run of 2026-10-23 an AVX-512 runner rebuilt whatif_far_post_finish_seed11.json
    with positions up to 8 mm off the committed file, which an AVX2 runner had matched byte for
    byte."""
    tiers = canonical.numpy_float64_tiers()
    other = sorted(t for t in tiers if not t.startswith(("baseline", canonical.CANONICAL_TIER)))
    assert canonical.CANONICAL_TIER in tiers and not other, (
        f"numpy runs float64 loops on {sorted(tiers)}; the committed artifacts are made on "
        f"{canonical.CANONICAL_TIER}: set NPY_DISABLE_CPU_FEATURES='{canonical.NUMPY_PIN}'"
    )


def test_ci_the_regen_script_and_the_api_image_pin_the_same_tier():
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    assert re.search(rf"^  NPY_DISABLE_CPU_FEATURES: {canonical.NUMPY_PIN}$", ci, re.MULTILINE)
    regen = (ROOT / "scripts" / "regen_linux.sh").read_text()
    assert f'-e NPY_DISABLE_CPU_FEATURES="{canonical.NUMPY_PIN}"' in regen
    image = (ROOT / "Dockerfile").read_text()
    assert f'NPY_DISABLE_CPU_FEATURES="{canonical.NUMPY_PIN}"' in image
