"""Azure AI Speech text-to-speech (SPEC 6 Voice): SSML in, WAV out, cached by content hash."""

from __future__ import annotations

import hashlib
import os
import urllib.error
import urllib.request
from pathlib import Path


class SpeechUnavailable(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.environ.get("AZURE_SPEECH_KEY") and os.environ.get("AZURE_SPEECH_REGION"))


def synthesize(ssml: str, cache_dir: Path) -> bytes:
    if not configured():
        raise SpeechUnavailable("Azure Speech is not configured")
    key = hashlib.sha256(ssml.encode()).hexdigest()[:32]
    path = Path(cache_dir) / "tts" / f"{key}.wav"
    if path.exists():
        return path.read_bytes()
    region = os.environ["AZURE_SPEECH_REGION"]
    request = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml.encode(),
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": os.environ["AZURE_SPEECH_KEY"],
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
            "User-Agent": "through-their-eyes-api",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            audio = response.read()
    except urllib.error.URLError as e:
        raise SpeechUnavailable(f"Azure Speech request failed: {e}") from e
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    return audio
