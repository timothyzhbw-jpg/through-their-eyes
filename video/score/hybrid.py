"""Variant B, "hybrid": the same cue sheet and form as the grime variant, scored for a caper
orchestra over hybrid percussion. Pizzicato ostinato and horns carry the look motif in
THE LOOK; trombones stab 3-3-2 over taiko in UNDER PRESSURE; trumpets take the motif a tone up
over a breakbeat in THE CORNER. Taiko, toms and the kit are synthesised; strings, brass, choir
and timpani come from the SoundFont.
"""

from __future__ import annotations

import numpy as np
import synth as sy
from arrange import LOOK_RIFF, PRESSURE_RIFF, ROOT_SHIFT, Ctx, bass_for, notes_for
from dsp import SR, eq, highpass
from grime import F4, Grime
from timeline import STEPS_PER_BAR, Event, Section

# Ostinato over a chord, one 16th each: indices into (root, third, fifth, octave).
OSTINATO = (0, 0, 2, 0, 1, 0, 2, 3, 0, 0, 2, 0, 1, 2, 3, 2)


class Hybrid(Grime):
    name = "hybrid"

    def bus_settings(self) -> dict:
        return {
            "drums_thresh": -15.0,
            "drums_room": 0.20,
            "bass_duck": 3.0,
            "music_hp": 70.0,
            "music_hall": 0.30,
            "music_duck": 1.5,
            "fx_hall": 0.30,
            "drums_gain": 3.0,
            "bass_gain": -4.0,
            "music_gain": 3.0,
            "fx_gain": 0.0,
        }

    def layer_fx(self, layer: str, audio: np.ndarray) -> np.ndarray:
        if layer in ("brass", "trumpet", "horn", "orch_hit"):
            return eq(highpass(audio, 90.0, 2), "peak", 2200.0, 1.5, 0.8)
        if layer in ("trombone", "contrabass", "cello", "timpani"):
            return highpass(audio, 35.0, 2)
        if layer in ("strings", "strings_slow", "tremolo", "pizz", "choir"):
            return eq(highpass(audio, 70.0, 2), "highshelf", 6000.0, 2.0)
        return audio

    def _drum(self, name: str, t: float, gain_db: float, pan: float = 0.0, stem: str = "drums"):
        if name == "hat":
            name, gain_db = "shaker", gain_db - 1.0
        if name in ("taiko", "taiko_hi", "shaker"):
            makers = {
                "taiko": (3, lambda r: sy.taiko(r, 60.0, 0.6)),
                "taiko_hi": (3, lambda r: sy.taiko(r, 95.0, 0.35)),
                "shaker": (4, lambda r: sy.hat(r, 0.022, 5500.0)),
            }
            count, make = makers[name]
            variant = int(round(t * 1000)) % count
            self.score.add(stem, t, self.one_shot(name, variant, make), gain_db, pan)
            return
        super()._drum(name, t, gain_db, pan, stem)

    # --- voices ---------------------------------------------------------------------------
    def sub_note(self, t, pitch, dur, gain_db=-2.0, slide_from=None, kind="sub"):
        super().sub_note(t, pitch, dur, gain_db - 1.5, slide_from, "sub")
        self.score.note("bass", "contrabass", pitch + 12, t, min(dur, 0.35), 105, gain_db=4.0)
        self.score.note("bass", "cello", pitch + 24, t, min(dur, 0.3), 92, gain_db=-1.0)

    def stab(
        self, t, chord, key, gain_db=-9.0, length=0.22, orch=True, brass=False, dark=False, octave=0
    ):
        notes = notes_for(chord, key, octave)
        g = gain_db + 10.0
        if dark:
            for p in (notes[0] - 12, notes[1] - 12, notes[2] - 12):
                self.score.note("music", "trombone", p, t, length * 1.5, 70, gain_db=g - 2)
            self.score.note("music", "timpani", bass_for(chord, key) + 12, t, 0.5, 80, gain_db=g)
            self._drum("taiko_hi", t, gain_db - 2.0)
            return
        for p in (*notes, notes[0] + 12):
            self.score.note("music", "brass", p, t, length, 118, gain_db=g)
        for p in (notes[0] - 12, notes[0] - 24):
            self.score.note("music", "trombone", p, t, length, 112, gain_db=g - 3)
        for p in (*notes, notes[0] + 12):
            self.score.note("music", "strings", p, t, min(0.12, length), 120, gain_db=g - 4)
        if orch:
            for p in notes:
                self.score.note("music", "orch_hit", p, t, length, 100, gain_db=g - 6)

    def lead_note(self, t, pitch, dur, gain_db=-15.0, pan=0.15):
        """The motif in horns, with a soft pluck for the attack."""
        self.score.note("music", "horn", pitch - 12, t, dur * 0.95, 112, gain_db=gain_db + 16)
        self.score.note("music", "horn", pitch, t, dur * 0.95, 96, gain_db=gain_db + 12)
        x = sy.pluck(pitch, min(0.25, dur + 0.05), self.rng("pl", round(t, 3)), 2600.0)
        self.score.add("music", t, x, gain_db - 4, pan)

    # --- sections -------------------------------------------------------------------------
    def section_cold(self, s: Section) -> None:
        hit = next((e.t0 for e in self.plan.of("hit") if s.start <= e.t0 < s.end), s.end)
        length = s.end - s.start
        for p, vel in ((29 + 12, 70), (36 + 12, 58), (41 + 12, 50)):
            self.score.note(
                "music", "strings_slow", p, s.start + 0.3, length - 0.3, vel, gain_db=4.0
            )
        self.score.note("music", "choir", 53, s.start + 2.5, length - 2.5, 45, gain_db=-3.0)
        self.score.note("music", "tremolo", 60, hit, s.end - hit - 0.45, 70, gain_db=-1.0)
        self.score.note("music", "tremolo", 65, hit, s.end - hit - 0.45, 66, gain_db=-1.0)
        rng = self.rng("drone", s.start)
        drone = sy.drone([29, 41], length + 0.4, rng, cutoff=220.0, motion=0.15)
        n = len(drone)
        swell = np.clip(np.arange(n) / SR / 2.0, 0, 1)
        self.score.add("music", s.start, drone * swell[:, None], -14.0)
        for c in self.steps(s):
            if self.quiet(c.moods):
                continue
            after = c.t >= hit
            if c.pos % 2 == 0 or (after and c.t > hit + 0.8):
                lift = min(6.0, max(0.0, (c.t - s.start) * 0.8))
                self._drum(
                    "tick",
                    c.t,
                    -24.0 + lift - (1.5 if c.pos % 4 == 0 else 0),
                    0.25 if c.pos % 4 else -0.15,
                )
            if c.pos == 0 and c.t > s.start + 1.0 and "scan" not in c.moods:
                self._drum("taiko", c.t, -10.0 if not after else -5.0)
            if after and c.pos == 8 and "scan" not in c.moods:
                self._drum("taiko_hi", c.t, -12.0)

    def section_drop(self, s: Section) -> None:
        full = s.grid.steps // STEPS_PER_BAR * STEPS_PER_BAR
        for c in self.steps(s):
            if self.quiet(c.moods):
                continue
            if c.step < STEPS_PER_BAR:
                if c.pos in (0, 6, 10):
                    self._drum("taiko", c.t, 0.0 if c.pos == 0 else -4.0)
                if c.pos == 8:
                    self._drum("snare", c.t, -4.0)
                    self._drum("clap", c.t, -9.0)
                if c.pos % 4 == 0:
                    self.score.note(
                        "music", "pizz", 65 + (0, 7, 3, 12)[c.pos // 4], c.t, 0.2, 110, gain_db=2.0
                    )
            else:
                k = c.step - STEPS_PER_BAR
                remaining = s.grid.steps - STEPS_PER_BAR
                if c.step >= full - 8 or k >= remaining - 8:
                    self._drum("snare", c.t, -16.0 + 12.0 * (k / max(1, remaining - 1)))
                if k % 2 == 0:
                    self.score.note("music", "timpani", 41, c.t, 0.2, 60 + 6 * k, gain_db=0.0)
        self.score.add("bass", s.start, sy.boom808(29, 1.6), -4.0)

    def groove(self, s: Section, style: str) -> None:
        super().groove(s, style)
        # The string ostinato, under everything but the dark and quiet windows.
        layer = {"look": "pizz", "pressure": "strings", "corner": "strings", "close": "pizz"}[style]
        for c in self.steps(s):
            m = c.moods
            if c.fill or self.quiet(m) or m & {"without", "decide", "hold", "strip"}:
                continue
            if style == "close" and c.pos % 2:
                continue
            if style == "look" and c.pos % 2 and c.pos not in (3, 7, 11):
                continue
            chord = self.chord(s, c.bar)
            tones = (*notes_for(chord, s.key, -1), notes_for(chord, s.key, -1)[0] + 12)
            pitch = tones[OSTINATO[c.pos]]
            vel = 112 if c.pos % 4 == 0 else (84 if c.pos % 2 else 98)
            dur = 0.09 if layer == "strings" else 0.2
            self.score.note(
                "music", layer, pitch, c.t, dur, vel, gain_db=-2.0 if layer == "pizz" else -6.0
            )

    def drums(self, c: Ctx, style: str, m: set) -> None:
        super().drums(c, style, m)
        if m & {"without", "build", "scan"}:
            if "build" in m and c.pos % 4 == 0:
                self._drum("taiko", c.t, -6.0)
            return
        accents = {
            "look": (0, 10),
            "pressure": (0, 3, 6, 10, 12),
            "corner": (0, 7, 10),
            "close": (0,),
        }[style]
        if c.pos in accents:
            self._drum("taiko", c.t, -3.0 if c.pos == 0 else -7.0, -0.1)
        if style == "pressure" and c.pos % 2 == 1:
            self._drum("taiko_hi", c.t, -18.0, 0.3)
        if c.pos == 0 and c.bar % 2 == 0 and style in ("pressure", "corner"):
            chord = self.chord(c.section, c.bar)
            self.score.note(
                "drums", "timpani", bass_for(chord, c.section.key) + 12, c.t, 0.6, 105, gain_db=2.0
            )

    def motif_step(self, c: Ctx, s: Section, on: bool, brass: bool) -> None:
        if not on:
            return
        phase = self.riff_clock % 32
        self.riff_clock += 1
        for step, semis, length in LOOK_RIFF:
            if step == phase:
                pitch = F4 + semis + s.key
                dur = self.note_len(s, length)
                if brass:  # THE CORNER: trumpets over horns
                    self.score.note("music", "trumpet", pitch, c.t, dur * 0.9, 110, gain_db=0.0)
                    self.score.note("music", "horn", pitch - 12, c.t, dur * 0.9, 104, gain_db=2.0)
                else:
                    self.lead_note(c.t, pitch, dur, -16.0)

    def pressure_step(self, c: Ctx, s: Section, chord: str, on: bool) -> None:
        shift = ROOT_SHIFT[chord] + s.key
        if on:
            for step, semis, length in PRESSURE_RIFF:
                if step == c.pos:
                    p = F4 + semis + shift - 12
                    self.score.note(
                        "music",
                        "trombone",
                        p,
                        c.t,
                        self.note_len(s, length) * 0.8,
                        108,
                        gain_db=4.0,
                    )
                    self.score.note(
                        "music", "cello", p, c.t, self.note_len(s, length) * 0.8, 100, gain_db=-2.0
                    )
        if c.pos in (0, 3, 6) and on and c.bar % 2 == 0:
            self.stab(c.t, chord, s.key, -16.0 if c.pos else -13.0, 0.14, orch=c.pos == 0)

    def pad(self, c: Ctx, s: Section, chord: str, style: str) -> None:
        dur = self.note_len(s, STEPS_PER_BAR)
        for p in notes_for(chord, s.key, -1 if style == "close" else 0):
            self.score.note("music", "strings_slow", p, c.t, dur, 82, gain_db=-1.0)
        if style == "corner":
            for p in notes_for(chord, s.key, 0)[:2]:
                self.score.note("music", "choir", p, c.t, dur, 60, gain_db=-4.0)

    def decide_step(self, c: Ctx, s: Section, chord: str) -> None:
        if c.pos % 4 == 0:
            self._drum("tick", c.t, -15.0 if c.pos == 0 else -18.0, 0.2)
        if c.pos in (0, 3):
            self._drum("taiko", c.t, -12.0 if c.pos else -8.0)
        if c.pos == 0:
            root = bass_for(chord, s.key)
            self.score.note(
                "music", "tremolo", root + 36, c.t, self.note_len(s, 16), 52, gain_db=-2.0
            )
            self.score.note(
                "music", "tremolo", root + 43, c.t, self.note_len(s, 16), 48, gain_db=-2.0
            )
        if c.pos in (0, 6, 10):
            p = notes_for(chord, s.key, 1)[c.pos % 3]
            self.score.note("music", "pizz", p, c.t, 0.2, 70, gain_db=-4.0)

    def hold_step(self, c: Ctx, s: Section) -> None:
        if c.pos % 4 == 0:
            self._drum("tick", c.t, -20.0, 0.2)

    # --- events ---------------------------------------------------------------------------
    def event_hit(self, e: Event) -> None:
        super().event_hit(e)
        big = e.data.get("size") == "big"
        chord, key = self.chord_at(e.t0 + 0.01)
        self._drum("taiko", e.t0, 0.0 if big else -5.0)
        if big:
            self._drum("taiko", e.t0 + 0.012, -3.0, 0.3)
            self.score.note(
                "music", "timpani", bass_for(chord, key) + 12, e.t0, 1.0, 120, gain_db=6.0
            )
        hold = self.hold_after(e.t0)
        if hold:
            self.score.note(
                "music", "choir", notes_for(chord, key)[0], e.t0, hold, 70, gain_db=-2.0
            )

    def event_drop(self, e: Event) -> None:
        super().event_drop(e)
        self._drum("taiko", e.t0, 2.0)
        self._drum("taiko", e.t0 + 0.015, -1.0, 0.3)
        self.score.note("music", "timpani", 41, e.t0, 1.4, 127, gain_db=6.0)
        for p in (53, 56, 60, 65):
            self.score.note("music", "choir", p, e.t0, 2.6, 96, gain_db=-1.0)

    def event_button(self, e: Event) -> None:
        super().event_button(e)
        rng = self.rng("button-taiko", e.t0)
        self.score.add_after_masks("drums", e.t0, sy.taiko(rng, 58.0, 0.7), 1.0)
        self.score.note("music", "timpani", 41, e.t0, 0.9, 127, gain_db=6.0, post=True)
        for p in (41, 53, 60, 65, 68, 72, 77):
            self.score.note("music", "strings", p, e.t0, 0.3, 127, gain_db=2.0, post=True)
            self.score.note("music", "trombone", p - 12, e.t0, 0.3, 120, gain_db=-2.0, post=True)
