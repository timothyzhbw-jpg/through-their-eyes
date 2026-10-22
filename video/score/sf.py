"""Orchestral colour from a General MIDI SoundFont, rendered offline by FluidSynth.

The parts are written as MIDI with pretty_midi (MIT), one file per layer, and rendered to
48 kHz float WAV with FluidSynth's own reverb and chorus off (our mix adds the space). Renders
are cached by the MIDI bytes and the SoundFont's checksum.
"""

from __future__ import annotations

import hashlib
import io
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pretty_midi
from dsp import read_wav

# General MIDI programs (0-based) we use.
PROGRAMS = {
    "strings": 48,
    "strings_slow": 49,
    "tremolo": 44,
    "pizz": 45,
    "cello": 42,
    "contrabass": 43,
    "timpani": 47,
    "brass": 61,
    "synth_brass": 62,
    "trumpet": 56,
    "trombone": 57,
    "horn": 60,
    "orch_hit": 55,
    "choir": 52,
    "bells": 14,
    "glock": 9,
}


# Seating (MIDI pan, 64 = centre): strings left, brass right, the low end in the middle.
PAN = {
    "strings": 38,
    "strings_slow": 46,
    "tremolo": 36,
    "pizz": 44,
    "cello": 54,
    "contrabass": 64,
    "timpani": 64,
    "brass": 86,
    "synth_brass": 80,
    "trumpet": 76,
    "trombone": 80,
    "horn": 54,
    "orch_hit": 64,
    "choir": 70,
    "bells": 74,
    "glock": 78,
}


@dataclass(frozen=True)
class Note:
    pitch: int
    start: float
    dur: float
    vel: int = 100


def midi_bytes(program: int, notes: list[Note], pan: int = 64) -> bytes:
    pm = pretty_midi.PrettyMIDI(resolution=960, initial_tempo=120.0)
    inst = pretty_midi.Instrument(program=program)
    inst.control_changes.append(pretty_midi.ControlChange(number=10, value=int(pan), time=0.0))
    for n in sorted(notes, key=lambda n: (n.start, n.pitch)):
        inst.notes.append(
            pretty_midi.Note(
                velocity=int(np.clip(n.vel, 1, 127)),
                pitch=int(n.pitch),
                start=max(0.0, n.start),
                end=max(0.0, n.start) + max(0.02, n.dur),
            )
        )
    pm.instruments.append(inst)
    buf = io.BytesIO()
    pm.write(buf)
    return buf.getvalue()


class FluidRenderer:
    def __init__(self, soundfont: Path, cache: Path, sf_sha256: str):
        exe = shutil.which("fluidsynth")
        if exe is None:
            raise SystemExit("fluidsynth not found: brew install fluid-synth")
        self.exe = exe
        self.soundfont = soundfont
        self.cache = cache
        self.sf_sha = sf_sha256
        cache.mkdir(parents=True, exist_ok=True)

    def render(self, layer: str, notes: list[Note], length: float) -> np.ndarray:
        """Render one layer and return (n, 2) at 48 kHz, padded or trimmed to `length` s."""
        n = int(round(length * 48_000))
        if not notes:
            return np.zeros((n, 2))
        data = midi_bytes(PROGRAMS[layer], notes, PAN.get(layer, 64))
        key = hashlib.sha256(b"fluid-v1" + self.sf_sha.encode() + data).hexdigest()[:20]
        wav = self.cache / f"{layer}-{key}.wav"
        if not wav.exists():
            mid = self.cache / f"{layer}-{key}.mid"
            mid.write_bytes(data)
            tmp = wav.with_suffix(".tmp.wav")
            subprocess.run(
                [
                    self.exe,
                    "-ni",
                    "-q",
                    "-R",
                    "0",
                    "-C",
                    "0",
                    "-g",
                    "0.5",
                    "-r",
                    "48000",
                    "-O",
                    "float",
                    "-T",
                    "wav",
                    "-o",
                    "synth.polyphony=512",
                    "-F",
                    str(tmp),
                    str(self.soundfont),
                    str(mid),
                ],
                check=True,
                capture_output=True,
            )
            tmp.rename(wav)
        x = read_wav(wav)
        return x[:n] if len(x) >= n else np.pad(x, ((0, n - len(x)), (0, 0)))
