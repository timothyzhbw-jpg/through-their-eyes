"""Our own instruments, synthesised in numpy: drums, basses, synths and effects.

No recorded samples. Every function returns a mono float64 array at 48 kHz unless it says
otherwise. Randomness comes only from the generator the caller passes (keyed per event).
"""

from __future__ import annotations

import math

import numpy as np
from dsp import SR, bandpass, highpass, lowpass, saturate, sweep_lowpass


def midi_hz(note: float) -> float:
    return 440.0 * 2.0 ** ((note - 69.0) / 12.0)


def _t(seconds: float) -> np.ndarray:
    return np.arange(int(SR * seconds)) / SR


def _fade(x: np.ndarray, ms_in: float = 1.0, ms_out: float = 4.0) -> np.ndarray:
    n_in, n_out = int(SR * ms_in / 1000), int(SR * ms_out / 1000)
    if n_in:
        x[:n_in] *= np.linspace(0, 1, n_in)
    if n_out:
        x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


# --- oscillators ---------------------------------------------------------------------------


def _phase(freq) -> np.ndarray:
    return np.cumsum(np.asarray(freq, dtype=np.float64) / SR) % 1.0


def _blep(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    out = np.zeros_like(t)
    lo = t < dt
    x = t[lo] / dt[lo]
    out[lo] = x + x - x * x - 1.0
    hi = t > 1.0 - dt
    x = (t[hi] - 1.0) / dt[hi]
    out[hi] = x * x + x + x + 1.0
    return out


def saw(freq, phase0: float = 0.0) -> np.ndarray:
    """Band-limited sawtooth (polyBLEP); `freq` is a scalar-per-sample array."""
    freq = np.asarray(freq, dtype=np.float64)
    t = (_phase(freq) + phase0) % 1.0
    dt = np.maximum(freq / SR, 1e-9)
    return 2.0 * t - 1.0 - _blep(t, dt)


def square(freq, width: float = 0.5, phase0: float = 0.0) -> np.ndarray:
    freq = np.asarray(freq, dtype=np.float64)
    t = (_phase(freq) + phase0) % 1.0
    dt = np.maximum(freq / SR, 1e-9)
    t2 = (t + 1.0 - width) % 1.0
    return (2.0 * t - 1.0 - _blep(t, dt)) - (2.0 * t2 - 1.0 - _blep(t2, dt))


def sine(freq, phase0: float = 0.0) -> np.ndarray:
    return np.sin(2.0 * math.pi * ((_phase(freq) + phase0) % 1.0))


def glide(n: int, start_hz: float, end_hz: float, tau: float) -> np.ndarray:
    t = np.arange(n) / SR
    return end_hz + (start_hz - end_hz) * np.exp(-t / tau)


def exp_env(n: int, tau: float, attack_ms: float = 0.5) -> np.ndarray:
    env = np.exp(-np.arange(n) / (SR * tau))
    a = max(1, int(SR * attack_ms / 1000))
    env[:a] *= np.linspace(0, 1, a)
    return env


def ahr(n: int, attack: float, hold: float, release: float) -> np.ndarray:
    """Attack, hold, linear-in-dB release envelope over n samples."""
    t = np.arange(n) / SR
    env = np.ones(n)
    env = np.where(t < attack, t / max(attack, 1e-6), env)
    rel = t > attack + hold
    env[rel] = 10 ** (-60 * (t[rel] - attack - hold) / max(release, 1e-6) / 20)
    return env


# --- drums ---------------------------------------------------------------------------------


def kick(
    rng: np.random.Generator,
    tone: float = 50.0,
    punch: float = 1.0,
    decay: float = 0.32,
    drive: float = 2.2,
) -> np.ndarray:
    """A UK/grime kick: pitched-down sine body, a click, a little drive."""
    n = int(SR * (decay * 2.2 + 0.05))
    f = glide(n, tone * 3.4, tone, 0.028)
    body = sine(f) * exp_env(n, decay, 0.3)
    click_n = int(SR * 0.006)
    click = highpass(rng.standard_normal(click_n), 2500.0) * np.linspace(1, 0, click_n) * 0.5
    blip = sine(np.full(int(SR * 0.012), 1100.0)) * exp_env(int(SR * 0.012), 0.003) * 0.35
    body[:click_n] += click * punch
    body[: len(blip)] += blip * punch
    return _fade(saturate(body, drive) * 0.95, 0.2, 8)


def snare(
    rng: np.random.Generator, tone: float = 195.0, snap: float = 1.0, decay: float = 0.16
) -> np.ndarray:
    """Tight, dry grime snare: two body modes plus band-passed noise."""
    n = int(SR * (decay * 3 + 0.05))
    body = sine(glide(n, tone * 1.25, tone, 0.012)) * exp_env(n, 0.055)
    body += 0.45 * sine(glide(n, tone * 1.9, tone * 1.7, 0.01)) * exp_env(n, 0.035)
    noise = bandpass(rng.standard_normal(n), 1600.0, 9000.0) * exp_env(n, decay)
    crack = highpass(rng.standard_normal(n), 4000.0) * exp_env(n, 0.012) * 0.8
    out = 0.55 * body + 0.9 * snap * noise + crack * snap
    return _fade(saturate(out, 1.6), 0.2, 10)


def clap(rng: np.random.Generator, decay: float = 0.14, spread_ms: float = 9.0) -> np.ndarray:
    n = int(SR * (decay * 3 + 0.06))
    env = np.zeros(n)
    for k in range(4):
        start = int(SR * spread_ms * k / 1000)
        seg = np.exp(-np.arange(n - start) / (SR * (0.006 if k < 3 else decay)))
        env[start:] = np.maximum(env[start:], seg * (0.85 if k < 3 else 1.0))
    noise = bandpass(rng.standard_normal(n), 900.0, 2600.0, 2)
    noise += 0.35 * bandpass(rng.standard_normal(n), 2600.0, 7000.0)
    return _fade(noise * env * 1.6, 0.1, 8)


_METAL = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)


def _metal(n: int, rng: np.random.Generator, scale: float = 1.0) -> np.ndarray:
    """The 808 cymbal recipe: six inharmonic squares, plus some noise."""
    x = sum(square(np.full(n, f * scale), phase0=rng.random()) for f in _METAL)
    return x / 6.0 + 0.5 * rng.standard_normal(n)


def hat(rng: np.random.Generator, decay: float = 0.04, bright: float = 8000.0) -> np.ndarray:
    n = int(SR * (decay * 5 + 0.02))
    x = highpass(bandpass(_metal(n, rng, 1.6), bright * 0.9, 16000.0), bright, 2)
    return _fade(x * exp_env(n, decay, 0.2) * 1.4, 0.1, 3)


def open_hat(rng: np.random.Generator, decay: float = 0.24) -> np.ndarray:
    return hat(rng, decay, 7000.0) * 0.8


def tick(rng: np.random.Generator) -> np.ndarray:
    """A dry clock tick: a short high click with a woody knock under it."""
    n = int(SR * 0.05)
    x = highpass(rng.standard_normal(n), 5000.0) * exp_env(n, 0.004) * 0.9
    x += sine(np.full(n, 2350.0)) * exp_env(n, 0.006) * 0.5
    x += sine(np.full(n, 1250.0)) * exp_env(n, 0.009) * 0.25
    return _fade(x, 0.05, 3)


def rim(rng: np.random.Generator, pitch: float = 1700.0) -> np.ndarray:
    """The eski click: a short knock, half woodblock, half rimshot."""
    n = int(SR * 0.08)
    x = sine(np.full(n, pitch)) * exp_env(n, 0.012) + 0.6 * sine(
        np.full(n, pitch * 0.47)
    ) * exp_env(n, 0.02)
    x += bandpass(rng.standard_normal(n), 2000.0, 6000.0) * exp_env(n, 0.006) * 0.5
    return _fade(x * 0.8, 0.05, 4)


def crash(rng: np.random.Generator, decay: float = 1.4) -> np.ndarray:
    n = int(SR * decay * 3.2)
    x = (
        highpass(_metal(n, rng, 2.3), 3500.0, 2) * 0.6
        + highpass(rng.standard_normal(n), 6000.0) * 0.5
    )
    x = lowpass(x, 13000.0)
    env = exp_env(n, decay * 0.55, 1.0) * 0.7 + exp_env(n, 0.04, 0.5) * 0.5
    return _fade(x * env, 0.5, 40)


def tom(rng: np.random.Generator, tone: float = 90.0, decay: float = 0.35) -> np.ndarray:
    n = int(SR * decay * 3)
    x = sine(glide(n, tone * 1.6, tone, 0.04)) * exp_env(n, decay)
    x += 0.3 * sine(glide(n, tone * 2.6, tone * 2.3, 0.03)) * exp_env(n, decay * 0.4)
    x += bandpass(rng.standard_normal(n), 300.0, 2500.0) * exp_env(n, 0.02) * 0.4
    return _fade(saturate(x, 1.5), 0.3, 20)


def taiko(rng: np.random.Generator, tone: float = 62.0, decay: float = 0.55) -> np.ndarray:
    """A big low drum: a membrane with inharmonic modes and a skin slap."""
    n = int(SR * decay * 3.2)
    x = sine(glide(n, tone * 1.45, tone, 0.05)) * exp_env(n, decay)
    for ratio, gain, d in ((1.59, 0.35, 0.45), (2.14, 0.22, 0.3), (2.65, 0.12, 0.2)):
        x += gain * sine(glide(n, tone * ratio * 1.3, tone * ratio, 0.04)) * exp_env(n, decay * d)
    x += bandpass(rng.standard_normal(n), 250.0, 1400.0) * exp_env(n, 0.025) * 0.7
    return _fade(saturate(x, 1.8) * 0.9, 0.3, 30)


# --- basses --------------------------------------------------------------------------------


def sub(freqs: np.ndarray, env: np.ndarray, drive: float = 1.6) -> np.ndarray:
    """Sine sub with a touch of second harmonic, gently driven so it reads on small speakers."""
    x = sine(freqs) + 0.18 * sine(freqs * 2.0, 0.25)
    return saturate(x * env, drive)


def square_bass(
    freqs: np.ndarray, env: np.ndarray, cutoff: float = 900.0, q: float = 1.2
) -> np.ndarray:
    """Eskibeat square bass: a hollow square through a resonant low-pass, plus a sine sub."""
    n = len(freqs)
    cut = cutoff * (0.45 + 0.55 * np.exp(-np.arange(n) / (SR * 0.09)))
    x = sweep_lowpass(square(freqs, 0.5) * 0.55, cut, q)
    x += 0.8 * sine(freqs)
    return saturate(x * env, 2.0)


def reese(
    freqs: np.ndarray, env: np.ndarray, rng: np.random.Generator, cutoff: float = 520.0
) -> np.ndarray:
    """Detuned saws, slowly beating, low-passed; a sine underneath keeps the fundamental."""
    detune = (0.993, 1.0, 1.0075)
    x = sum(saw(freqs * d, rng.random()) for d in detune) / 3.0
    n = len(freqs)
    lfo = 1.0 + 0.35 * np.sin(2 * math.pi * 0.7 * np.arange(n) / SR + rng.random() * 6)
    x = sweep_lowpass(x, cutoff * lfo, 1.1)
    x = 0.8 * x + 0.75 * sine(freqs)
    return saturate(x * env, 2.4)


def boom808(note: float, seconds: float, drive: float = 2.5) -> np.ndarray:
    n = int(SR * seconds)
    f = glide(n, midi_hz(note + 12), midi_hz(note), 0.035)
    x = sine(f) * ahr(n, 0.002, seconds * 0.35, seconds * 0.65)
    return _fade(saturate(x, drive), 0.2, 30)


# --- synths --------------------------------------------------------------------------------


def supersaw(freq: float, n: int, rng: np.random.Generator, voices: int = 5, spread: float = 0.012):
    """Stereo detuned saw stack for one note; returns (n, 2)."""
    out = np.zeros((n, 2))
    for k in range(voices):
        d = 1.0 + spread * (k - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        x = saw(np.full(n, freq * d), rng.random())
        p = (k / max(1, voices - 1)) * 2 - 1
        out[:, 0] += x * math.cos((p + 1) * math.pi / 4)
        out[:, 1] += x * math.sin((p + 1) * math.pi / 4)
    return out / voices * 1.4


def stab(
    notes,
    seconds: float,
    rng: np.random.Generator,
    bright: float = 5200.0,
    body: float = 900.0,
    decay: float = 0.16,
) -> np.ndarray:
    """A chord stab: supersaws through a snapping filter envelope; returns (n, 2)."""
    n = int(SR * seconds)
    x = sum(supersaw(midi_hz(m), n, rng) for m in notes) / max(1, len(notes)) ** 0.6
    cut = body + (bright - body) * np.exp(-np.arange(n) / (SR * decay * 0.6))
    x = sweep_lowpass(x, cut, 1.0)
    env = ahr(n, 0.002, seconds * 0.25, seconds * 0.75)
    return x * env[:, None]


def lead(
    note: float,
    seconds: float,
    rng: np.random.Generator,
    kind: str = "square",
    bend: float = -0.6,
    cutoff: float = 3200.0,
) -> np.ndarray:
    """A grime lead note: square or saw with a little pitch scoop and a quick filter close."""
    n = int(SR * seconds)
    semis = bend * np.exp(-np.arange(n) / (SR * 0.018))
    f = midi_hz(note) * 2.0 ** (semis / 12.0)
    x = square(f, 0.5) if kind == "square" else saw(f, rng.random())
    x = 0.65 * x + 0.35 * (
        square(f * 2.0, 0.25) if kind == "square" else saw(f * 1.005, rng.random())
    )
    cut = cutoff * (0.35 + 0.65 * np.exp(-np.arange(n) / (SR * 0.08)))
    x = sweep_lowpass(x, cut, 1.3)
    return _fade(x * ahr(n, 0.002, seconds * 0.55, seconds * 0.45), 0.5, 6)


def pluck(
    note: float, seconds: float, rng: np.random.Generator, bright: float = 4000.0
) -> np.ndarray:
    n = int(SR * seconds)
    f = np.full(n, midi_hz(note))
    x = 0.6 * saw(f, rng.random()) + 0.4 * square(f * 1.002, 0.3)
    cut = 250 + bright * np.exp(-np.arange(n) / (SR * 0.05))
    x = sweep_lowpass(x, cut, 1.6)
    return _fade(x * exp_env(n, seconds * 0.35, 1.0), 0.5, 10)


def drone(
    notes, seconds: float, rng: np.random.Generator, cutoff: float = 420.0, motion: float = 0.25
):
    """A dark detuned pad for the cold open; returns (n, 2)."""
    n = int(SR * seconds)
    out = np.zeros((n, 2))
    for m in notes:
        out += supersaw(midi_hz(m), n, rng, voices=4, spread=0.006) * 0.5
    t = np.arange(n) / SR
    lfo = 1.0 + motion * np.sin(2 * math.pi * 0.11 * t + rng.random() * 6)
    out = np.stack([sweep_lowpass(out[:, c], cutoff * lfo, 0.8, 256) for c in range(2)], axis=1)
    sub_part = sine(np.full(n, midi_hz(min(notes)))) * 0.6
    return out + sub_part[:, None]


# --- effects -------------------------------------------------------------------------------


def riser(
    seconds: float, rng: np.random.Generator, lo: float = 300.0, hi: float = 9000.0
) -> np.ndarray:
    """Noise sweep plus a rising tone, crescendo into its last sample; returns (n, 2)."""
    n = int(SR * seconds)
    t = np.arange(n) / n
    cut = lo * (hi / lo) ** (t**1.6)
    noise = rng.standard_normal((n, 2))
    x = np.stack([sweep_lowpass(noise[:, c], cut, 2.5, 128) for c in range(2)], axis=1) * 0.45
    tone = saw(lo * 0.5 * (hi / lo) ** (0.5 * t**1.8), rng.random())
    tone = sweep_lowpass(tone, cut * 0.7, 1.0, 128) * 0.25
    x += tone[:, None]
    return x * (t**2.2)[:, None]


def reverse_swell(seconds: float, rng: np.random.Generator) -> np.ndarray:
    """A reversed cymbal: grows into the hit that follows it; returns (n, 2)."""
    c = crash(rng, max(0.6, seconds))
    n = int(SR * seconds)
    c = c[:n] if len(c) >= n else np.pad(c, (0, n - len(c)))
    x = c[::-1] * np.linspace(0.2, 1.0, n) ** 1.5
    return np.stack([x, np.roll(x, 37)], axis=1)


def impact(rng: np.random.Generator, seconds: float = 2.2, tone: float = 42.0) -> np.ndarray:
    """A low cinematic hit: sub drop, body thump and a dark noise burst; returns (n, 2)."""
    n = int(SR * seconds)
    x = sine(glide(n, tone * 2.2, tone * 0.8, 0.22)) * exp_env(n, seconds * 0.32, 0.5)
    x += 0.6 * sine(glide(n, 160.0, 70.0, 0.03)) * exp_env(n, 0.09)
    x += lowpass(rng.standard_normal(n), 1800.0) * exp_env(n, 0.07) * 0.6
    x = saturate(x, 2.0)
    return np.stack([x, x], axis=1)


def downlifter(seconds: float, rng: np.random.Generator) -> np.ndarray:
    n = int(SR * seconds)
    t = np.arange(n) / n
    cut = 8000.0 * (150.0 / 8000.0) ** t
    noise = rng.standard_normal((n, 2))
    x = np.stack([sweep_lowpass(noise[:, c], cut, 1.5, 128) for c in range(2)], axis=1)
    return x * ((1 - t) ** 1.5)[:, None] * 0.5


def breath(rng: np.random.Generator, seconds: float = 0.9) -> np.ndarray:
    """An airy inhale for the scan: band-passed noise that swells and falls."""
    n = int(SR * seconds)
    t = np.arange(n) / n
    x = bandpass(rng.standard_normal(n), 900.0, 3800.0) * np.sin(math.pi * t) ** 2
    return np.stack([x, np.roll(x, 113)], axis=1) * 0.25
