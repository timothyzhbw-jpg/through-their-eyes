"""Azure AI Speech text-to-speech (SPEC 6 Voice): a voice cue's key in, WAV out.

The API is public, so it speaks only SSML its own crew wrote. Every breakdown it computes or reads
from its cache records the script's voice cues (`VoiceCue.cache_key` -> SSML) in a store next to
that cache, and POST /api/tts takes a key, never SSML. Audio is cached by key under
`TTE_CACHE_DIR/tts/`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import tempfile
import urllib.error
import urllib.request
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)
KEY = re.compile(r"[0-9a-f]{16}")  # agents.delivery.cache_key


class SpeechUnavailable(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.environ.get("AZURE_SPEECH_KEY") and os.environ.get("AZURE_SPEECH_REGION"))


class Cues:
    """Voice cue key -> SSML, for every breakdown the service has computed or served.

    `store` is a result cache (api/store.py), so the cues outlive a restart like the breakdowns.
    """

    def __init__(self, store: Any) -> None:
        self.store = store
        self._stored: set[str] = set()  # known to be in the store; a key fixes its SSML

    def add(self, breakdown: dict[str, Any]) -> None:
        """Record the cues of `breakdown`. A key already in the store keeps its SSML (its audio
        may be cached already), even when written by an earlier process."""
        for script in (breakdown.get("result") or {}).get("scripts") or ():
            for cue in script.get("voice") or ():
                if (key := cue["cache_key"]) in self._stored:
                    continue
                if self.store.get(key) is None:
                    self.store.put(key, {"ssml": cue["ssml"]})
                self._stored.add(key)

    def ssml(self, key: str) -> str | None:
        hit = self.store.get(key)
        return hit["ssml"] if hit else None

    def recording(self, cache: Any) -> Recording:
        return Recording(cache, self)


class Recording:
    """A breakdown cache that records the voice cues of every value read from or written to it.

    Recording is a side effect: if it fails, the breakdown is still served (its cues then answer
    404 until a later read records them).
    """

    def __init__(self, cache: Any, cues: Cues) -> None:
        self.cache, self.cues = cache, cues

    def get(self, key: str) -> dict[str, Any] | None:
        value = self.cache.get(key)
        if value is not None:
            self._record(key, value)
        return value

    def put(self, key: str, value: dict[str, Any]) -> None:
        self.cache.put(key, value)
        self._record(key, value)

    def _record(self, key: str, value: dict[str, Any]) -> None:
        try:
            self.cues.add(value)
        except Exception:
            log.exception("recording the voice cues of breakdown %s failed", key)


class KeyLocks:
    """One asyncio lock per key, dropped once nobody holds or waits for it."""

    def __init__(self) -> None:
        self._locks: dict[str, tuple[asyncio.Lock, int]] = {}

    @contextlib.asynccontextmanager
    async def hold(self, key: str) -> AsyncIterator[None]:
        lock, users = self._locks.get(key) or (asyncio.Lock(), 0)
        self._locks[key] = (lock, users + 1)
        try:
            async with lock:
                yield
        finally:
            lock, users = self._locks[key]
            if users <= 1:
                del self._locks[key]
            else:
                self._locks[key] = (lock, users - 1)


def _path(key: str, cache_dir: Path) -> Path:
    if not KEY.fullmatch(key):  # the key names a file
        raise ValueError(f"not a voice cue key: {key!r}")
    return Path(cache_dir) / "tts" / f"{key}.wav"


def cached(key: str, cache_dir: Path) -> bytes | None:
    path = _path(key, cache_dir)
    return path.read_bytes() if path.exists() else None


def synthesize(ssml: str, key: str, cache_dir: Path) -> bytes:
    """Azure Speech for `ssml`, cached under `key`. Blocking: run it in a worker thread.

    The audio goes to a temp file of its own, then replaces the cached file in one step, so a
    reader sees the whole of one synthesis or nothing, even with several writers.
    """
    path = _path(key, cache_dir)
    audio = request(ssml)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{key}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(audio)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    return audio


def request(ssml: str) -> bytes:
    """One synthesis by Azure Speech (tests replace it)."""
    if not configured():
        raise SpeechUnavailable("Azure Speech is not configured")
    region = os.environ["AZURE_SPEECH_REGION"]
    req = urllib.request.Request(
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
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.read()
    except urllib.error.URLError as e:
        log.warning("Azure Speech request failed: %s", e)
        raise SpeechUnavailable("Azure Speech request failed") from e
