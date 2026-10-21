"""Shared musical material and the arranger loop both variants build on.

The score is in F minor at 140 BPM, half-time (the snare on beat 3). Each section of the cue
sheet starts a fresh bar on its first frame, so chapter cards always land on a downbeat; cuts
inside a section snap to its 16th-note grid. The bars a section does not fill before the next
one starts become a pickup fill.
"""

from __future__ import annotations

import bisect
import hashlib
from dataclasses import dataclass

import numpy as np
from sf import Note
from timeline import STEPS_PER_BAR, Event, Plan, Section

# --- harmony -------------------------------------------------------------------------------
# Chords as (bass note, voicing) in F minor; the bass sits between 43 and 78 Hz.
CHORDS = {
    "Fm": (29, (65, 68, 72)),
    "Gb": (30, (61, 66, 70)),
    "Ab": (32, (63, 68, 72)),
    "Bbm": (34, (65, 70, 73)),
    "C": (36, (60, 64, 67)),
    "Db": (37, (61, 65, 68)),
    "Eb": (39, (63, 67, 70)),
}

PROGRESSIONS = {
    "look": ("Fm", "Fm", "Db", "Eb"),
    "pressure": ("Fm", "Gb", "Fm", "C"),
    "corner": ("Db", "Eb", "Fm", "Fm"),
    "close": ("Fm", "Db", "Eb", "C"),
    "drop": ("Fm",),
    "cold": ("Fm",),
}

# Chord root offsets from F, to move a riff with the harmony.
ROOT_SHIFT = {"Fm": 0, "Gb": 1, "Ab": 3, "Bbm": 5, "C": -5, "Db": -4, "Eb": -2}

# The look motif (2 bars): (step, semitones above F4, length in 16ths). It rises, leans on the
# Phrygian Gb, and falls back: the shape of a glance over the shoulder.
LOOK_RIFF = (
    (0, 12, 2),
    (3, 7, 1),
    (4, 10, 2),
    (7, 12, 2),
    (10, 13, 1),
    (11, 12, 3),
    (14, 10, 2),
    (16, 8, 2),
    (19, 7, 1),
    (20, 3, 2),
    (23, 7, 2),
    (26, 5, 1),
    (27, 7, 4),
)
# Pressure (1 bar, follows the chord root): repeated low notes with octave jumps.
PRESSURE_RIFF = (
    (0, 0, 1),
    (2, 0, 1),
    (3, 12, 1),
    (6, 0, 1),
    (8, 1, 2),
    (11, 0, 1),
    (12, 10, 1),
    (14, 7, 2),
)

# Bass rhythms per bar: (step, length in 16ths, octave up?)
BASS = {
    "look": ((0, 5, 0), (6, 3, 0), (10, 4, 0), (14, 2, 12)),
    "pressure": ((0, 2, 0), (3, 2, 0), (6, 3, 0), (10, 1, 0), (11, 4, 0), (15, 1, 12)),
    "corner": ((0, 6, 0), (7, 2, 0), (10, 4, 0), (14, 2, 0)),
    "close": ((0, 8, 0), (10, 6, 0)),
}


@dataclass
class Ctx:
    """Where a 16th step sits: its section, bar, position and the moods around it."""

    section: Section
    step: int
    bar: int
    pos: int
    t: float
    moods: set
    last_bar: bool
    fill: bool


class Arranger:
    """Walks the plan step by step and calls the variant's instruments."""

    name = "base"

    def __init__(self, score, plan: Plan):
        self.score = score
        self.plan = plan
        self.kicks: list[float] = []
        self._cache: dict = {}
        self.riff_clock = 0  # 16ths of riff played; frozen while the lead is stripped
        accents = [
            e.t0 for e in plan.events if e.type in ("hit", "card", "stamp", "drop", "button")
        ]
        self.accents = sorted(accents + [e.t1 for e in plan.of("scan")])

    # --- keyed randomness and cached one-shots ----------------------------------------------
    def rng(self, *key) -> np.random.Generator:
        digest = hashlib.sha256(("|".join(map(str, (self.name, *key)))).encode()).digest()
        return np.random.Generator(np.random.PCG64(int.from_bytes(digest[:8], "little")))

    def one_shot(self, name: str, variant: int, make):
        key = (name, variant)
        if key not in self._cache:
            self._cache[key] = make(self.rng(name, variant))
        return self._cache[key]

    # --- helpers -----------------------------------------------------------------------------
    def chord(self, section: Section, bar: int) -> str:
        prog = PROGRESSIONS.get(section.kind, ("Fm",))
        return prog[bar % len(prog)]

    def chord_at(self, t: float) -> tuple[str, int]:
        s = self.plan.section_at(t)
        bar = int(max(0.0, s.grid.step_of(t)) // STEPS_PER_BAR)
        return self.chord(s, bar), s.key

    def quiet(self, moods: set) -> bool:
        return bool(moods & {"gap", "stop"})

    # --- the loop ----------------------------------------------------------------------------
    def run(self) -> None:
        for s in self.plan.sections:
            getattr(self, f"section_{s.kind}")(s)
        for e in self.plan.events:
            handler = getattr(self, f"event_{e.type}", None)
            if handler is not None:
                handler(e)

    def steps(self, s: Section):
        g = s.grid
        full_bars = g.steps // STEPS_PER_BAR
        for step in range(g.steps):
            bar, pos = divmod(step, STEPS_PER_BAR)
            t = g.at(step)
            if t >= s.end - 1e-6:
                break
            yield Ctx(
                s, step, bar, pos, t, self.plan.mood(t), bar == full_bars - 1, bar >= full_bars
            )

    def note_len(self, s: Section, steps: float) -> float:
        return steps * s.grid.step

    def kick_at(self, t: float) -> None:
        bisect.insort(self.kicks, t)

    def crowds_accent(self, t: float, within: float = 0.07) -> bool:
        """A groove ornament this close to an off-grid cue would blur its attack."""
        i = bisect.bisect_left(self.accents, t - within)
        while i < len(self.accents) and self.accents[i] <= t + within:
            if abs(self.accents[i] - t) > 0.004:
                return True
            i += 1
        return False

    def has_kick(self, t: float, within: float = 0.02) -> bool:
        i = bisect.bisect_left(self.kicks, t - within)
        return i < len(self.kicks) and self.kicks[i] <= t + within

    # Variants implement section_<kind> and event_<type>.


def notes_for(chord: str, key: int, octave: int = 0) -> tuple[int, ...]:
    return tuple(p + key + 12 * octave for p in CHORDS[chord][1])


def bass_for(chord: str, key: int) -> int:
    return CHORDS[chord][0] + key


def fluid_note(pitch: int, t: float, dur: float, vel: int) -> Note:
    return Note(int(pitch), float(t), float(dur), int(vel))


__all__ = [
    "Arranger",
    "Ctx",
    "Event",
    "LOOK_RIFF",
    "PRESSURE_RIFF",
    "BASS",
    "ROOT_SHIFT",
    "notes_for",
    "bass_for",
    "fluid_note",
    "PROGRESSIONS",
    "CHORDS",
]
