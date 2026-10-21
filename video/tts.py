"""Voice-over for the trailer edit (SPEC 10): SSML in, WAV out, through Azure AI Speech.

Uses the API's own speech call (`api.tts.request`: the same endpoint, output format and
`AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` variables), so the video adds no speech setup of its
own. The edit (`video/trailer.mjs`, step `vo`) writes the jobs file and runs, from the repo root:

    uv run --env-file .env python video/tts.py <jobs.json>

jobs.json is `[{"id": "...", "ssml": "...", "out": "<absolute path>.wav"}, ...]`. Each WAV is
24 kHz mono 16-bit PCM. A failure names the job and exits non-zero; nothing from the environment
is printed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# The repo root, so that `api` imports when this file runs as a script from video/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import tts  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python video/tts.py <jobs.json>", file=sys.stderr)
        return 2
    if not tts.configured():
        print(
            "Azure Speech is not configured (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)",
            file=sys.stderr,
        )
        return 1
    jobs = json.loads(Path(argv[1]).read_text())
    for job in jobs:
        out = Path(job["out"])
        try:
            audio = tts.request(job["ssml"])
        except tts.SpeechUnavailable as e:
            print(f"{job['id']}: {e}", file=sys.stderr)
            return 1
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp")
        tmp.write_bytes(audio)
        tmp.replace(out)
        print(f"{job['id']}: {len(audio)} bytes -> {out.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
