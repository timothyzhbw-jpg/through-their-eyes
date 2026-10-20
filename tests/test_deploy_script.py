"""infra/deploy.sh refuses the wrong subscription before it touches anything (SPEC 8)."""

import os
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "infra" / "deploy.sh"

FAKE_AZ = """#!/usr/bin/env bash
# Answers only what the guard asks; any other call is a test failure.
echo "$@" >> "$AZ_LOG"
case "$*" in
  "account show -o none") exit 0 ;;
  "account show --subscription"*"--query name -o tsv") echo "Some subscription" ;;
  "account show --subscription"*"--query tenantId -o tsv") echo "tenant" ;;
  "rest --method get"*) echo "$FAKE_QUOTA_ID" ;;
  "account list"*) echo "(list)" ;;
  *) echo "unexpected az call: $*" >&2; exit 99 ;;
esac
"""


def _run(tmp_path: Path, **env: str) -> subprocess.CompletedProcess:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    az = bin_dir / "az"
    az.write_text(FAKE_AZ)
    az.chmod(az.stat().st_mode | stat.S_IEXEC)
    base = {"PATH": f"{bin_dir}:/usr/bin:/bin", "AZ_LOG": str(tmp_path / "az.log"),
            "TTE_ENV_FILE": str(tmp_path / "missing.env"), "HOME": str(tmp_path)}  # fmt: skip
    return subprocess.run(
        ["bash", str(SCRIPT), "provision"], env=base | env, capture_output=True, text=True,
        timeout=60,
    )  # fmt: skip


def test_without_an_explicit_subscription_it_stops(tmp_path):
    r = _run(tmp_path)
    assert r.returncode == 1
    assert "AZURE_SUBSCRIPTION_ID" in r.stderr


@pytest.mark.parametrize("quota", ["MS-AZR-0017P", "Internal_2014-09-01", "EnterpriseAgreement"])
def test_internal_and_enterprise_subscriptions_are_refused(tmp_path, quota):
    r = _run(tmp_path, AZURE_SUBSCRIPTION_ID="00000000-0000-0000-0000-000000000000",
             FAKE_QUOTA_ID=quota)  # fmt: skip
    assert r.returncode == 1, r.stderr
    assert "Refusing offer" in r.stderr
    calls = (tmp_path / "az.log").read_text()
    assert "create" not in calls and "account set" not in calls  # nothing was touched


def test_the_script_never_prints_keys():
    text = SCRIPT.read_text()
    for line in text.splitlines():
        if "keys list" in line or "connection-string" in line.lower():
            assert "echo" not in line, line
    assert os.access(SCRIPT, os.X_OK)
