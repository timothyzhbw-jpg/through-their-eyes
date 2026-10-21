"""Check the narration voices against the Azure Speech voices list.

    uv run --env-file .env python -m infra.voices

Every voice in `agents.delivery.VOICES` must exist in the region's list, and `VOICE_STYLES` for
that voice must equal its `StyleList`. Prints one line per voice. Exit 1 on any mismatch.
The subscription key is read from the environment and never printed.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

from agents.delivery import VOICE_STYLES, VOICES


def mismatches(listed: list[dict[str, Any]]) -> list[str]:
    """Problems with `listed` (a voices-list payload). Empty when the booth matches."""
    by_name = {row.get("ShortName"): row for row in listed}
    problems = []
    for voice in dict.fromkeys(VOICES.values()):
        row = by_name.get(voice)
        if row is None:
            problems.append(f"{voice}: missing")
            continue
        got = frozenset(row.get("StyleList") or ())
        expected = VOICE_STYLES.get(voice, frozenset())
        if got != expected:
            problems.append(f"{voice}: StyleList {sorted(got)} != {sorted(expected)}")
    return problems


def _fetch(region: str, key: str) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list",
        headers={"Ocp-Apim-Subscription-Key": key},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.loads(response.read().decode())
    if not isinstance(data, list):
        raise SystemExit("voices list was not a list")
    return data


def main() -> int:
    region = os.environ.get("AZURE_SPEECH_REGION", "").strip()
    key = os.environ.get("AZURE_SPEECH_KEY", "").strip()
    if not region or not key:
        print("AZURE_SPEECH_REGION and AZURE_SPEECH_KEY must be set", file=sys.stderr)
        return 1
    try:
        listed = _fetch(region, key)
    except urllib.error.URLError:
        print("voices list request failed", file=sys.stderr)
        return 1
    problems = {line.split(":", 1)[0]: line for line in mismatches(listed)}
    for voice in dict.fromkeys(VOICES.values()):
        print(problems.get(voice, f"{voice}: ok"))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
