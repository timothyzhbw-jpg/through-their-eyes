"""M0 smoke test: a Foundry model through Agent Framework, then Azure AI Speech (SPEC §8, §9).

Checks that, on this subscription,
  1. the Foundry deployment answers through Agent Framework with a schema-validated structured
     output, authenticated keylessly with your `az login`;
  2. Azure AI Speech synthesises one `en` and one `zh` line with neural voices.

Run after infra/m0_provision.sh:
    uv run --env-file .env python -m infra.smoke
Audio is written to out/smoke/. The exit code is 0 only if every check passes.
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from xml.sax.saxutils import escape, quoteattr

from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from azure.identity.aio import AzureCliCredential
from pydantic import BaseModel, Field

OUT_DIR = Path("out/smoke")
# Fictional player that fills the {player} slot.
PLAYER = {"en": "Rhys Calder", "zh": "考尔德"}
VOICES = {
    "en": ("en-US", "en-US-AvaMultilingualNeural"),
    "zh": ("zh-CN", "zh-CN-XiaoxiaoNeural"),
}
# Used for TTS when the model check fails, so Speech is still tested.
FALLBACK_LINES = {
    "en": "{player} checks his shoulder, spots the runner and slides him through.",
    "zh": "{player}接球前回头观察，看到了插上的队友，直塞找到了他。",
}

INSTRUCTIONS = (
    "You write single lines of football commentary. Refer to the player only with the literal "
    "placeholder {player}. Never write digits or number words."
)
PROMPT = (
    "A midfielder checked over his shoulder just before receiving, saw a free runner and played "
    "him in. Write one line in English (language 'en') and one in Simplified Chinese "
    "(language 'zh')."
)


class Line(BaseModel):
    language: Literal["en", "zh"]
    text: str = Field(description="One short commentary line that uses the {player} placeholder.")


class Lines(BaseModel):
    lines: list[Line]


@dataclass(frozen=True)
class Result:
    name: str
    ok: bool
    seconds: float
    detail: str


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(
            f"{name} is not set. Run infra/m0_provision.sh, then pass --env-file .env."
        )
    return value


def check_lines(lines: Lines) -> list[str]:
    """Problems with the model's structured output; empty when it is usable."""
    problems = [
        f"no '{lang}' line"
        for lang in ("en", "zh")
        if lang not in {x.language for x in lines.lines}
    ]
    problems += [
        f"'{x.language}' line lacks the {{player}} slot"
        for x in lines.lines
        if "{player}" not in x.text
    ]
    return problems


def build_ssml(text: str, lang: str) -> str:
    locale, voice = VOICES[lang]
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
        f"xml:lang={quoteattr(locale)}>"
        f"<voice name={quoteattr(voice)}>{escape(text)}</voice></speak>"
    )


async def check_foundry() -> tuple[Result, Lines | None]:
    endpoint = require_env("FOUNDRY_PROJECT_ENDPOINT")
    model = require_env("FOUNDRY_MODEL")
    start = time.perf_counter()
    try:
        async with AzureCliCredential() as credential:
            client = FoundryChatClient(
                project_endpoint=endpoint, model=model, credential=credential
            )
            async with Agent(client, instructions=INSTRUCTIONS, name="smoke_narrator") as agent:
                response = await agent.run(PROMPT, options={"response_format": Lines})
                lines = response.value
    except Exception as exc:  # any failure is a failed check, reported with its cause
        detail = f"{type(exc).__name__}: {exc}"
        if re.search(r"\b(401|403)\b|PermissionDenied", detail):
            detail += " | right after provisioning, wait a few minutes for the role and retry"
        return Result("foundry", False, time.perf_counter() - start, detail), None
    elapsed = time.perf_counter() - start
    if not isinstance(lines, Lines):
        return Result("foundry", False, elapsed, "no structured output"), None
    problems = check_lines(lines)
    detail = f"model={model}; " + ("; ".join(problems) or "en + zh lines with the {player} slot")
    if any(re.search(r"[0-9]", x.text) for x in lines.lines):
        detail += "; digits present (the renderer would reject them)"
    return Result("foundry", not problems, elapsed, detail), lines


def check_speech(lang: str, text: str) -> Result:
    region = require_env("AZURE_SPEECH_REGION")
    key = require_env("AZURE_SPEECH_KEY")
    request = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=build_ssml(text, lang).encode(),
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
            "User-Agent": "through-their-eyes-smoke",
        },
    )
    name = f"speech-{lang}"
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            audio = response.read()
    except urllib.error.HTTPError as exc:
        body = exc.read()[:200].decode(errors="replace")
        return Result(name, False, time.perf_counter() - start, f"HTTP {exc.code}: {body}")
    except urllib.error.URLError as exc:
        return Result(name, False, time.perf_counter() - start, f"network: {exc.reason}")
    elapsed = time.perf_counter() - start
    if audio[:4] != b"RIFF" or len(audio) < 1000:
        return Result(name, False, elapsed, f"unexpected payload ({len(audio)} bytes)")
    path = OUT_DIR / f"{lang}.wav"
    path.write_bytes(audio)
    audio_s = (len(audio) - 44) / (24_000 * 2)
    return Result(name, True, elapsed, f"{VOICES[lang][1]}, {audio_s:.1f} s audio -> {path}")


async def main() -> int:
    foundry, lines = await check_foundry()
    texts = dict(FALLBACK_LINES)
    if lines is not None:
        texts.update({x.language: x.text for x in lines.lines})
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = [foundry]
    for lang in ("en", "zh"):
        text = texts[lang].replace("{player}", PLAYER[lang])
        print(f"  [{lang}] {text}")
        results.append(check_speech(lang, text))
    print()
    for r in results:
        print(f"{'PASS' if r.ok else 'FAIL'}  {r.name:<10} {r.seconds:6.2f} s  {r.detail}")
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
