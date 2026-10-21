"""The cut and the cue sheet: where things happen in the film, in seconds.

The score is composed to picture. Beat starts come from the trailer's own spec
(`video/trailer.json`: a beat starts where the previous one's `dur` ends), and the cue sheet
(`video/score/cues/<cut>.json`) names musical events by beat id plus an offset, so a re-timed cut
only needs a re-render. A reference is a number (seconds), `"<beat>"` (its start),
`"<beat>:+0.3"` / `"<beat>:-0.43"` (an offset from its start) or `"<beat>:end"`.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

STEPS_PER_BAR = 16
SNAP_S = 0.025  # a cue within 25 ms of a 16th note lands on the 16th


@dataclass(frozen=True)
class Beat:
    id: str
    start: float
    dur: float


class Cut:
    """The film's beats and length, read from a trailer spec."""

    def __init__(self, spec: dict):
        self.beats: list[Beat] = []
        start = 0.0
        for beat in spec["beats"]:
            self.beats.append(Beat(beat["id"], round(start, 3), float(beat["dur"])))
            start += float(beat["dur"])
        out = spec["beats"][-1].get("out", {}) if spec["beats"] else {}
        tail = float(out.get("dur", 0.0)) if out.get("type", "cut") != "cut" else 0.0
        self.duration = round(start + tail, 3)
        self.by_id = {b.id: b for b in self.beats}
        self.spec = spec

    @classmethod
    def load(cls, path: Path) -> Cut:
        return cls(json.loads(Path(path).read_text()))

    def time(self, ref) -> float:
        if isinstance(ref, int | float):
            return float(ref)
        beat_id, _, offset = str(ref).partition(":")
        if beat_id not in self.by_id:
            raise KeyError(f"cue refers to unknown beat {beat_id!r}")
        beat = self.by_id[beat_id]
        if offset == "end":
            return round(beat.start + beat.dur, 4)
        return round(beat.start + (float(offset) if offset else 0.0), 4)

    def vo_spans(self, vo_dir: Path | None = None) -> list[tuple[float, float, str]]:
        """Voice-over lines as (start, end, text); lengths from rendered WAVs when present."""
        spans = []
        for beat in self.spec["beats"]:
            start = self.by_id[beat["id"]].start
            for line in beat.get("vo", []):
                t0 = start + float(line.get("at", 0.0))
                length = None
                if vo_dir is not None:
                    wav = Path(vo_dir) / f"{line['id']}.wav"
                    if wav.exists():
                        length = _wav_seconds(wav)
                if length is None:
                    words = len(str(line.get("text", "")).split()) or 8
                    length = 0.36 * words + 0.3
                spans.append((t0, t0 + length, str(line.get("text", line["id"]))))
        return spans


def _wav_seconds(path: Path) -> float:
    import wave

    with wave.open(str(path), "rb") as f:
        return f.getnframes() / f.getframerate()


@dataclass
class Grid:
    """A 4/4 grid of 16th notes starting on a downbeat at `start`."""

    start: float
    end: float
    bpm: float

    @property
    def step(self) -> float:
        return 60.0 / self.bpm / 4.0

    @property
    def steps(self) -> int:
        return max(0, int(math.floor((self.end - self.start) / self.step + 1e-6)))

    def at(self, step: float) -> float:
        return self.start + step * self.step

    def snap(self, t: float, tolerance: float = SNAP_S) -> float:
        k = round((t - self.start) / self.step)
        snapped = self.at(k)
        return snapped if abs(snapped - t) <= tolerance else t

    def step_of(self, t: float) -> float:
        return (t - self.start) / self.step


@dataclass
class Section:
    id: str
    kind: str
    start: float
    end: float
    grid: Grid
    key: int = 0  # semitones above F minor
    opts: dict = field(default_factory=dict)


@dataclass
class Event:
    type: str
    t0: float
    t1: float
    data: dict


class Plan:
    """The resolved cue sheet."""

    def __init__(self, cut: Cut, cues: dict):
        self.cut = cut
        self.cues = cues
        self.bpm = float(cues.get("bpm", 140))
        self.length = float(cut.time(cues["end"])) if "end" in cues else cut.duration
        self.sections: list[Section] = []
        rows = cues["sections"]
        for i, row in enumerate(rows):
            start = cut.time(row["from"])
            end = cut.time(rows[i + 1]["from"]) if i + 1 < len(rows) else self.length
            grid = Grid(start, end, float(row.get("bpm", self.bpm)))
            self.sections.append(
                Section(row["id"], row["kind"], start, end, grid, int(row.get("key", 0)), row)
            )
        self.events: list[Event] = []
        for row in cues.get("events", []):
            if "at" in row:
                t0 = t1 = cut.time(row["at"])
                if row.get("snap", True):
                    t0 = t1 = self.snap(t0)
            else:
                t0, t1 = cut.time(row["from"]), cut.time(row["to"])
                if row.get("snap", True):
                    t1 = self.snap(t1)
            self.events.append(Event(row["type"], t0, t1, row))
        self.events.sort(key=lambda e: e.t0)
        self.check()

    def check(self) -> None:
        last = -1.0
        for s in self.sections:
            if s.start < last:
                raise ValueError(f"section {s.id} starts before the previous one")
            last = s.start
        for e in self.events:
            if e.t1 < e.t0:
                raise ValueError(f"{e.type} event ends before it starts ({e.t0:.3f} > {e.t1:.3f})")
            if e.t0 > self.length + 1e-6:
                raise ValueError(
                    f"{e.type} event at {e.t0:.3f} is after the end ({self.length:.3f})"
                )

    def section_at(self, t: float) -> Section:
        for s in reversed(self.sections):
            if t >= s.start - 1e-9:
                return s
        return self.sections[0]

    def snap(self, t: float) -> float:
        return self.section_at(t).grid.snap(t)

    def of(self, kind: str) -> list[Event]:
        return [e for e in self.events if e.type == kind]

    def mood(self, t: float) -> set[str]:
        """Window moods active at time t (without, decide, strip, stop, gap, scan)."""
        active = set()
        for e in self.events:
            if e.t0 <= t < e.t1:
                active.add(e.data.get("mood", e.type))
        return active

    def describe(self) -> list[str]:
        lines = [f"length {self.length:.3f} s, {self.bpm:g} BPM (16th = {60 / self.bpm / 4:.4f} s)"]
        for s in self.sections:
            bars, rest = divmod(s.grid.steps, STEPS_PER_BAR)
            lines.append(
                f"  {s.id:<8} {s.kind:<9} {s.start:7.3f}–{s.end:7.3f}  {bars} bars + {rest}/16"
                + (f", key +{s.key}" if s.key else "")
            )
        for e in self.events:
            span = f"{e.t0:7.3f}" + (f"–{e.t1:7.3f}" if e.t1 > e.t0 else "")
            lines.append(f"  {e.type:<7} {span}  {e.data.get('note', '')}")
        return lines
