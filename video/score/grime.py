"""Variant A, "grime": 140 BPM half-time, synthesised drums, square and sine sub basses, an
eskibeat square lead playing the look motif, supersaw stabs layered with the SoundFont's
orchestra hit and brass.

Chapters: THE LOOK is the motif over a bouncing sub; UNDER PRESSURE goes Phrygian (F-Gb) with
a reese bass, 16th hats and 3-3-2 brass stabs; THE CORNER is a breakbeat (full-time backbeat),
a tone higher, with the motif doubled by brass.
"""

from __future__ import annotations

import numpy as np
import synth as sy
from arrange import (
    BASS,
    LOOK_RIFF,
    PRESSURE_RIFF,
    ROOT_SHIFT,
    Arranger,
    Ctx,
    bass_for,
    notes_for,
)
from dsp import SR, eq, haas, highpass
from timeline import STEPS_PER_BAR, Event, Section

F4 = 65


class Grime(Arranger):
    name = "grime"

    # --- buses ----------------------------------------------------------------------------
    def bus_settings(self) -> dict:
        return {
            "drums_thresh": -16.0,
            "drums_room": 0.10,
            "bass_duck": 5.0,
            "music_hp": 150.0,
            "music_hall": 0.16,
            "music_duck": 3.0,
            "fx_hall": 0.22,
            "drums_gain": 4.5,
            "bass_gain": -3.5,
            "music_gain": 0.5,
            "fx_gain": 0.0,
        }

    def layer_fx(self, layer: str, audio: np.ndarray) -> np.ndarray:
        if layer in ("orch_hit", "brass", "synth_brass", "trumpet", "trombone"):
            audio = highpass(audio, 170.0, 2)
            return eq(audio, "peak", 1800.0, 2.0, 0.9)
        if layer in ("strings", "strings_slow", "tremolo", "choir"):
            return highpass(audio, 220.0, 2)
        return audio

    # --- one-shots ------------------------------------------------------------------------
    def _drum(self, name: str, t: float, gain_db: float, pan: float = 0.0, stem: str = "drums"):
        makers = {
            "kick": (3, lambda r: sy.kick(r, tone=47.0, decay=0.30)),
            "kick_big": (1, lambda r: sy.kick(r, tone=44.0, decay=0.55, drive=3.0)),
            "snare": (3, lambda r: sy.snare(r, tone=205.0)),
            "clap": (3, lambda r: sy.clap(r)),
            "hat": (6, lambda r: sy.hat(r, 0.032)),
            "ohat": (2, lambda r: sy.open_hat(r, 0.22)),
            "rim": (3, lambda r: sy.rim(r, 1650.0)),
            "crash": (2, lambda r: sy.crash(r, 1.5)),
            "tick": (3, lambda r: sy.tick(r)),
            "tom": (2, lambda r: sy.tom(r, 110.0)),
        }
        count, make = makers[name]
        variant = int(round(t * 1000)) % count
        self.score.add(stem, t, self.one_shot(name, variant, make), gain_db, pan)
        if name.startswith("kick"):
            self.kick_at(t)

    def kick(self, t: float, gain_db: float = 0.0, big: bool = False):
        if self.has_kick(t):
            return
        self._drum("kick_big" if big else "kick", t, gain_db)

    def sub_note(
        self,
        t: float,
        pitch: int,
        dur: float,
        gain_db: float = -2.0,
        slide_from: int | None = None,
        kind: str = "sub",
    ):
        n = int(SR * (dur + 0.03))
        target = sy.midi_hz(pitch)
        if slide_from is not None:
            freqs = sy.glide(n, sy.midi_hz(slide_from), target, 0.03)
        else:
            freqs = np.full(n, target)
        env = sy.ahr(n, 0.004, max(0.0, dur - 0.02), 0.05)
        if kind == "square":
            x = sy.square_bass(freqs, env, 750.0, 1.1)
        elif kind == "reese":
            x = sy.reese(freqs, env, self.rng("reese", round(t, 3)), 600.0)
        else:
            x = sy.sub(freqs, env)
        fade = int(SR * 0.006)
        x[-fade:] *= np.linspace(1, 0, fade)
        self.score.add("bass", t, x, gain_db)

    def stab(
        self,
        t: float,
        chord: str,
        key: int,
        gain_db: float = -9.0,
        length: float = 0.22,
        orch: bool = True,
        brass: bool = False,
        dark: bool = False,
        octave: int = 0,
    ):
        notes = notes_for(chord, key, octave)
        rng = self.rng("stab", round(t, 3))
        if dark:
            x = sy.stab(
                [n - 12 for n in notes], length * 1.6, rng, bright=1400.0, body=500.0, decay=0.25
            )
            self.score.add("music", t, x, gain_db - 1)
            return
        x = sy.stab(list(notes) + [notes[0] + 12], length, rng, bright=6500.0, body=1100.0)
        self.score.add("music", t, haas(x, 13.0, 0.45), gain_db)
        if orch:
            for p in notes:
                self.score.note("music", "orch_hit", p, t, length, 112, gain_db=gain_db + 7)
        if brass:
            for p in (*notes, notes[0] - 12):
                self.score.note("music", "brass", p, t, length * 0.9, 118, gain_db=gain_db + 9)

    def lead_note(
        self, t: float, pitch: int, dur: float, gain_db: float = -15.0, pan: float = 0.35
    ):
        rng = self.rng("lead", round(t, 3))
        x = sy.lead(pitch, dur + 0.04, rng, "square", bend=-0.7, cutoff=3400.0)
        self.score.add("music", t, x, gain_db, pan)
        # a quiet octave-down copy to the other side widens it
        x2 = sy.lead(pitch - 12, dur + 0.04, rng, "square", bend=-0.4, cutoff=1800.0)
        self.score.add("music", t, x2, gain_db - 7, -pan)

    # --- sections -------------------------------------------------------------------------
    def section_cold(self, s: Section) -> None:
        """Tense and minimal: a clock-tick hat, a low drone, a pulse under it."""
        hit = next((e.t0 for e in self.plan.of("hit") if s.start <= e.t0 < s.end), s.end)
        rng = self.rng("drone", s.start)
        length = s.end - s.start + 0.5
        drone = sy.drone([41, 48, 56], length, rng, cutoff=380.0, motion=0.2)
        n = len(drone)
        t = np.arange(n) / SR
        swell = np.clip(t / 2.0, 0, 1) * (0.55 + 0.45 * np.clip((t - (hit - s.start)) / 2.5, 0, 1))
        self.score.add("music", s.start, drone * swell[:, None], -9.0)
        for c in self.steps(s):
            if self.quiet(c.moods):
                continue
            after = c.t >= hit
            if c.pos % 2 == 0 or (after and c.t > hit + 0.8):
                accent = -1.5 if c.pos % 4 == 0 else 0.0
                lift = min(6.0, max(0.0, (c.t - s.start) * 0.8))
                self._drum("tick", c.t, -24.0 + lift + accent, 0.25 if c.pos % 4 else -0.15)
            if c.pos == 0 and c.t > s.start + 1.0 and "scan" not in c.moods:
                self.kick(c.t, -9.0 if not after else -5.0)
                self.sub_note(c.t, 29, 0.35, -8.0)

    def section_drop(self, s: Section) -> None:
        """SEE WHAT THEY SAW: one bar of the beat with a held 808, then a pickup roll."""
        full = s.grid.steps // STEPS_PER_BAR * STEPS_PER_BAR
        for c in self.steps(s):
            if self.quiet(c.moods):
                continue
            if c.step < STEPS_PER_BAR:
                if c.pos in (0, 10):
                    self.kick(c.t, 0.0, big=c.pos == 0)
                if c.pos == 8:
                    self._drum("snare", c.t, -3.0)
                    self._drum("clap", c.t, -8.0)
                if c.pos % 2 == 0 and c.pos >= 4:
                    self._drum("hat", c.t, -17.0 + (1.5 if c.pos % 4 == 2 else 0), 0.2)
            else:
                k = c.step - STEPS_PER_BAR
                remaining = s.grid.steps - STEPS_PER_BAR
                level = -16.0 + 13.0 * (k / max(1, remaining - 1))
                if c.step >= full - 8 or k >= remaining - 8:
                    self._drum("snare", c.t, level, 0.1 if k % 2 else -0.1)
                if k == 0:
                    self.kick(c.t, -2.0)
                if k % 4 == 0:
                    self.sub_note(c.t, 29 + (0, 3, 5, 7)[(k // 4) % 4], 0.38, -4.0, kind="square")
        self.score.add("bass", s.start, sy.boom808(29, 1.9), -1.0)

    def section_look(self, s: Section) -> None:
        self.groove(s, "look")

    def section_pressure(self, s: Section) -> None:
        self.groove(s, "pressure")

    def section_corner(self, s: Section) -> None:
        self.groove(s, "corner")

    def section_close(self, s: Section) -> None:
        self.groove(s, "close")

    # --- the groove -----------------------------------------------------------------------
    def groove(self, s: Section, style: str) -> None:
        prev_bass = None
        for c in self.steps(s):
            m = c.moods
            if self.quiet(m):
                prev_bass = None
                continue
            chord = self.chord(s, c.bar)
            if c.fill:
                self.fill(c, s)
                continue
            if "decide" in m:
                self.decide_step(c, s, chord)
                continue
            if "hold" in m:
                self.hold_step(c, s)
                continue
            self.drums(c, style, m)
            prev_bass = self.bass_step(c, s, style, chord, m, prev_bass)
            lead_on = not (m & {"strip", "without", "scan", "build"})
            if style in ("look", "corner"):
                self.motif_step(c, s, lead_on, brass=style == "corner")
            elif style == "pressure":
                self.pressure_step(c, s, chord, lead_on)
            if c.pos == 0 and style in ("corner", "close") and not (m & {"strip"}):
                self.pad(c, s, chord, style)

    def drums(self, c: Ctx, style: str, m: set) -> None:
        pos, bar = c.pos, c.bar
        if self.crowds_accent(c.t):
            m = m | {"scan"}  # keep kick and snare, drop the hats and clicks around the cue
        if "without" in m:
            if pos in (0, 10):
                self.kick(c.t, -5.0)
            if pos == 8:
                self._drum("rim", c.t, -12.0)
            if pos % 4 == 2:
                self._drum("tick", c.t, -22.0, 0.3)
            return
        if "build" in m:
            if pos % 4 == 0:
                self.kick(c.t, -3.0)
            self._drum("hat", c.t, -22.0 + (pos / 16.0) * 6.0, 0.2)
            if c.last_bar and pos >= 8:
                self._drum("snare", c.t, -14.0 + (pos - 8) * 1.4)
            return
        if style == "look":
            kicks = (0, 6, 10, 13) if bar % 4 == 3 else (0, 6, 10)
            snares = (8,)
            hats = range(0, 16, 2)
            rims = (3, 11) if bar % 2 == 0 else (3, 11, 13)
            open_hats = (14,) if bar % 2 == 1 else ()
        elif style == "pressure":
            kicks = (0, 3, 6, 9, 10, 12, 14) if bar % 4 == 3 else (0, 3, 6, 10, 11)
            snares = (8,)
            hats = range(16)
            rims = (2, 7, 13)
            open_hats = (6,) if bar % 2 else ()
        elif style == "corner":
            kicks = (0, 3, 10) if bar % 2 else (0, 7, 10)
            snares = (4, 12)
            hats = range(0, 16, 2)
            rims = ()
            open_hats = (14,)
        else:  # close
            kicks = (0, 10)
            snares = (8,)
            hats = range(0, 16, 2)
            rims = (3,)
            open_hats = ()
        if pos in kicks:
            self.kick(c.t, 0.0 if pos == 0 else -2.0)
        if pos in snares:
            self._drum("snare", c.t, -3.0 if style != "close" else -6.0)
            self._drum("clap", c.t, -9.0, 0.05)
        if style == "corner" and pos in (7, 9, 15):
            self._drum("snare", c.t, -17.0, -0.1)
        if pos in hats and "scan" not in m:
            accent = 0.0 if pos % 4 == 2 else -3.0
            if style == "pressure":
                accent = (0.0, -6.0, -3.0, -6.0)[pos % 4]
            self._drum("hat", c.t, -14.0 + accent, 0.35 if pos % 4 == 2 else 0.15)
        if pos in rims and "scan" not in m:
            self._drum("rim", c.t, -15.0, -0.45)
        if pos in open_hats:
            self._drum("ohat", c.t, -19.0, -0.3)
        # triplet hat roll at the end of each 4-bar phrase (look, pressure)
        if style in ("look", "pressure") and bar % 4 == 3 and pos == 12 and "scan" not in m:
            for k in range(6):
                self._drum("hat", c.t + k * 4 * c.section.grid.step / 6.0, -20.0 + k, 0.3)
        if style == "corner" and bar % 4 == 0 and pos == 0:
            self._drum("crash", c.t, -15.0, 0.1)

    def bass_step(self, c: Ctx, s: Section, style: str, chord: str, m: set, prev):
        root = bass_for(chord, s.key)
        pattern = BASS.get(style, BASS["look"])
        if "without" in m:
            if c.pos == 0:
                self.sub_note(c.t, root, self.note_len(s, 14), -4.0)
                return root
            return prev
        for step, length, octave in pattern:
            if c.pos == step:
                kind = {"pressure": "reese", "look": "sub", "corner": "square", "close": "sub"}[
                    style
                ]
                pitch = root + octave
                slide = (
                    prev if (style == "pressure" and prev is not None and prev != pitch) else None
                )
                self.sub_note(c.t, pitch, self.note_len(s, length), -2.0, slide, kind)
                return pitch
        return prev

    def motif_step(self, c: Ctx, s: Section, on: bool, brass: bool) -> None:
        if not on:
            return
        phase = self.riff_clock % 32
        self.riff_clock += 1
        for step, semis, length in LOOK_RIFF:
            if step == phase:
                pitch = F4 + semis + s.key
                dur = self.note_len(s, length)
                self.lead_note(c.t, pitch, dur, -14.0 if brass else -13.0)
                if brass:
                    self.score.note("music", "brass", pitch, c.t, dur * 0.9, 100, gain_db=-4.0)
                    self.score.note("music", "brass", pitch - 12, c.t, dur * 0.9, 92, gain_db=-4.0)

    def pressure_step(self, c: Ctx, s: Section, chord: str, on: bool) -> None:
        shift = ROOT_SHIFT[chord] + s.key
        if on:
            for step, semis, length in PRESSURE_RIFF:
                if step == c.pos:
                    self.lead_note(c.t, F4 + semis + shift, self.note_len(s, length), -15.0, -0.2)
        if c.pos in (0, 3, 6) and on and c.bar % 2 == 0:
            self.stab(
                c.t, chord, s.key, -15.0 if c.pos else -12.0, 0.12, orch=c.pos == 0, brass=True
            )

    def pad(self, c: Ctx, s: Section, chord: str, style: str) -> None:
        dur = self.note_len(s, STEPS_PER_BAR)
        for p in notes_for(chord, s.key, -1 if style == "close" else 0):
            self.score.note("music", "strings_slow", p, c.t, dur, 70, gain_db=-6.0)

    def decide_step(self, c: Ctx, s: Section, chord: str) -> None:
        """Your call: the clock and a heartbeat sub; nothing else moves."""
        if c.pos % 4 == 0:
            self._drum("tick", c.t, -15.0 if c.pos == 0 else -18.0, 0.2)
        if c.pos in (0, 3):
            self.kick(c.t, -10.0 if c.pos else -6.0)
            self.sub_note(c.t, bass_for(chord, s.key), 0.25, -6.0)
        if c.pos == 0:
            rng = self.rng("decide-pad", round(c.t, 3))
            x = sy.drone(
                [bass_for(chord, s.key) + 24, bass_for(chord, s.key) + 31],
                self.note_len(s, 16),
                rng,
                cutoff=700.0,
                motion=0.1,
            )
            self.score.add("music", c.t, x, -16.0)

    def hold_step(self, c: Ctx, s: Section) -> None:
        if c.pos % 2 == 0:
            self._drum("hat", c.t, -22.0 + (2 if c.pos % 4 == 2 else 0), 0.2)

    def fill(self, c: Ctx, s: Section) -> None:
        """The part-bar before the next section: a snare roll that builds."""
        left = s.grid.steps - c.step
        if left == 1:
            return  # one 16th of air before the next section's downbeat
        level = -13.0 + 9.0 * (1.0 - left / max(1.0, (s.grid.steps % STEPS_PER_BAR)))
        self._drum("snare", c.t, level, 0.12 if c.step % 2 else -0.12)
        if left <= 2:
            self._drum("tom", c.t, -10.0)

    # --- events ---------------------------------------------------------------------------
    def event_hit(self, e: Event) -> None:
        big = e.data.get("size") == "big"
        chord, key = self.chord_at(e.t0 + 0.01)
        self.kick(e.t0, 0.0, big=big)
        self._drum("crash", e.t0, -9.0 if big else -14.0, 0.15)
        self.stab(
            e.t0, chord, key, -7.0 if big else -11.0, 0.3 if big else 0.18, orch=True, brass=big
        )
        if big:
            self.score.add("fx", e.t0, sy.impact(self.rng("impact", e.t0), 2.0), -6.0)
            self.score.add("bass", e.t0, sy.boom808(bass_for(chord, key), 1.1), -3.0)
        hold = self.hold_after(e.t0)
        if hold:  # the end card: the chord holds under the last line, into the button
            for p in notes_for(chord, key, 0):
                self.score.note("music", "strings_slow", p, e.t0, hold, 92, gain_db=0.0)
            n = int(SR * hold)
            env = np.clip(np.arange(n) / (SR * 0.4), 0, 1) * 0.8
            self.score.add(
                "bass", e.t0 + 0.3, sy.sub(np.full(n, sy.midi_hz(bass_for(chord, key))), env), -9.0
            )

    def hold_after(self, t: float) -> float:
        """Length of a hold window starting at t, or 0."""
        for h in self.plan.of("window"):
            if h.data.get("mood") == "hold" and abs(h.t0 - t) < 0.03:
                return h.t1 - h.t0
        return 0.0

    def event_drop(self, e: Event) -> None:
        chord, key = "Fm", 0
        self.kick(e.t0, 1.0, big=True)
        self._drum("crash", e.t0, -6.0, -0.2)
        self._drum("crash", e.t0 + 0.004, -8.0, 0.3)
        self.stab(e.t0, chord, key, -5.0, 0.45, orch=True, brass=True)
        self.stab(e.t0, chord, key, -9.0, 0.45, orch=False, octave=1)
        self.score.add("fx", e.t0, sy.impact(self.rng("drop", e.t0), 3.0, 38.0), -2.0)

    def event_card(self, e: Event) -> None:
        chord, key = self.chord_at(e.t0 + 0.01)
        if e.data.get("dusk"):
            self.stab(e.t0, chord, key, -8.0, 0.4, dark=True)
            self._drum("rim", e.t0, -12.0)
            return
        self.stab(e.t0, chord, key, -10.0, 0.16, orch=True, octave=1 if key else 0)
        self._drum("hat", e.t0, -14.0, 0.3)

    def event_stamp(self, e: Event) -> None:
        chord, key = self.chord_at(e.t0)
        top = notes_for(chord, key, 1)
        x = sy.pluck(top[-1], 0.18, self.rng("stamp", e.t0), 5000.0)
        self.score.add("music", e.t0, x, -14.0, 0.2)
        self._drum("rim", e.t0, -13.0, -0.2)

    def event_riser(self, e: Event) -> None:
        length = e.t1 - e.t0
        self.score.add("fx", e.t0, sy.riser(length, self.rng("riser", e.t0)), -9.0)

    def event_scan(self, e: Event) -> None:
        self.score.add(
            "fx", e.t0, sy.breath(self.rng("breath", e.t0), min(1.2, e.t1 - e.t0)), -13.0
        )
        self._drum("tick", e.t0, -16.0, 0.0, stem="fx")
        swell = min(0.43, max(0.1, e.t1 - e.t0 - 0.1))
        self.score.add("fx", e.t1 - swell, sy.reverse_swell(swell, self.rng("swell", e.t0)), -14.0)
        chord, key = self.chord_at(e.t1 + 0.01)
        self.kick(e.t1, 0.0)
        self._drum("crash", e.t1, -15.0, -0.1)
        self.stab(e.t1, chord, key, -11.0, 0.16, orch=True)

    def event_button(self, e: Event) -> None:
        notes = notes_for("Fm", 0)
        rng = self.rng("button", e.t0)
        x = sy.stab(
            list(notes) + [notes[0] + 12, notes[0] - 12],
            1.2,
            rng,
            bright=7000.0,
            body=700.0,
            decay=0.35,
        )
        self.score.add_after_masks("music", e.t0, x, -6.0)
        for p in (*notes, notes[0] - 12, notes[0] + 12):
            self.score.note("music", "orch_hit", p, e.t0, 0.5, 120, gain_db=0.0, post=True)
            self.score.note("music", "brass", p, e.t0, 0.35, 124, gain_db=1.0, post=True)
        k = self.one_shot("kick_big", 0, lambda r: sy.kick(r, tone=44.0, decay=0.55, drive=3.0))
        self.score.add_after_masks("drums", e.t0, k, 0.0)
        self.score.add_after_masks("drums", e.t0, sy.crash(rng, 1.2), -10.0)
        self.score.add_after_masks("bass", e.t0, sy.boom808(29, 1.0), -2.0)
        self.score.add_after_masks("fx", e.t0, sy.impact(rng, 1.6), -6.0)
