"""Signal processing for the score: filters, dynamics, reverb, loudness, WAV I/O.

Everything is numpy/scipy at 48 kHz, float64, stereo arrays shaped (n, 2). No randomness here
except where a caller passes its own generator.
"""

from __future__ import annotations

import math
import wave

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d

SR = 48_000


def db(x: float) -> float:
    """Decibels to a linear gain."""
    return 10.0 ** (x / 20.0)


def to_db(x: float) -> float:
    return 20.0 * math.log10(max(x, 1e-12))


def stereo(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 2 else np.stack([x, x], axis=1)


def pan(x: np.ndarray, position: float) -> np.ndarray:
    """Equal-power pan of a mono signal; position -1 (left) .. 1 (right)."""
    angle = (position + 1.0) * math.pi / 4.0
    return np.stack([x * math.cos(angle), x * math.sin(angle)], axis=1) * math.sqrt(2.0)


# --- filters -------------------------------------------------------------------------------


def _sos(kind: str, freq, order: int) -> np.ndarray:
    return signal.butter(order, freq, btype=kind, fs=SR, output="sos")


def lowpass(x: np.ndarray, freq: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("lowpass", min(freq, SR * 0.45), order), x, axis=0)


def highpass(x: np.ndarray, freq: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("highpass", freq, order), x, axis=0)


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("bandpass", [lo, min(hi, SR * 0.45)], order), x, axis=0)


def rbj(kind: str, freq: float, q: float = 0.707, gain_db: float = 0.0):
    """RBJ cookbook biquad coefficients (b, a), normalised."""
    a_gain = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * freq / SR
    cos_w, sin_w = math.cos(w0), math.sin(w0)
    alpha = sin_w / (2.0 * q)
    if kind == "lowpass":
        b = [(1 - cos_w) / 2, 1 - cos_w, (1 - cos_w) / 2]
        a = [1 + alpha, -2 * cos_w, 1 - alpha]
    elif kind == "highpass":
        b = [(1 + cos_w) / 2, -(1 + cos_w), (1 + cos_w) / 2]
        a = [1 + alpha, -2 * cos_w, 1 - alpha]
    elif kind == "bandpass":
        b = [alpha, 0.0, -alpha]
        a = [1 + alpha, -2 * cos_w, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * a_gain, -2 * cos_w, 1 - alpha * a_gain]
        a = [1 + alpha / a_gain, -2 * cos_w, 1 - alpha / a_gain]
    elif kind in ("lowshelf", "highshelf"):
        sq = 2.0 * math.sqrt(a_gain) * alpha
        sign = 1.0 if kind == "lowshelf" else -1.0
        ap, am = a_gain + 1, a_gain - 1
        b = [
            a_gain * (ap - sign * am * cos_w + sq),
            sign * 2 * a_gain * (am - sign * ap * cos_w),
            a_gain * (ap - sign * am * cos_w - sq),
        ]
        a = [
            ap + sign * am * cos_w + sq,
            -sign * 2 * (am + sign * ap * cos_w),
            ap + sign * am * cos_w - sq,
        ]
    else:
        raise ValueError(kind)
    b, a = np.asarray(b), np.asarray(a)
    return b / a[0], a / a[0]


def eq(x: np.ndarray, kind: str, freq: float, gain_db: float = 0.0, q: float = 0.707) -> np.ndarray:
    b, a = rbj(kind, freq, q, gain_db)
    return signal.lfilter(b, a, x, axis=0)


def sweep_lowpass(x: np.ndarray, cutoff: np.ndarray, q: float = 0.9, block: int = 32) -> np.ndarray:
    """A resonant low-pass whose cutoff follows `cutoff` (Hz per sample), in short blocks."""
    mono = x.ndim == 1
    data = x[:, None] if mono else x
    out = np.zeros_like(data)
    zi = np.zeros((2, data.shape[1]))
    for start in range(0, len(data), block):
        stop = min(start + block, len(data))
        fc = float(np.clip(cutoff[min(start + block // 2, len(cutoff) - 1)], 20.0, SR * 0.45))
        b, a = rbj("lowpass", fc, q)
        out[start:stop], zi = signal.lfilter(b, a, data[start:stop], axis=0, zi=zi)
    return out[:, 0] if mono else out


def widen(x: np.ndarray, amount: float, above: float = 250.0) -> np.ndarray:
    """Mid/side width: scale the side signal above `above` Hz by `amount`; lows stay mono."""
    mid = (x[:, 0] + x[:, 1]) / 2
    side = (x[:, 0] - x[:, 1]) / 2
    side = signal.sosfilt(_sos("highpass", above, 2), side) * amount
    return np.stack([mid + side, mid - side], axis=1)


def haas(x: np.ndarray, ms: float = 11.0, mix: float = 0.5) -> np.ndarray:
    """A delayed copy on one side, for width on mono parts."""
    d = int(SR * ms / 1000.0)
    y = x.copy()
    y[d:, 1] = x[d:, 1] * (1 - mix) + x[:-d, 1] * mix
    return y


# --- dynamics and colour -------------------------------------------------------------------


def saturate(x: np.ndarray, drive: float = 2.0, oversample: int = 4) -> np.ndarray:
    """tanh drive, oversampled so it does not alias; unity gain for small signals."""
    up = signal.resample_poly(x, oversample, 1, axis=0)
    up = np.tanh(drive * up) / drive
    return signal.resample_poly(up, 1, oversample, axis=0)[: len(x)]


def follower(x: np.ndarray, attack_ms: float, release_ms: float) -> np.ndarray:
    """Peak envelope (mono, linear) with a held attack and a one-pole release."""
    level = _max_filter(np.max(np.abs(stereo(x)), axis=1), max(1, int(SR * attack_ms / 1000.0)))
    coeff = math.exp(-1.0 / (SR * release_ms / 1000.0))
    return signal.lfilter([1 - coeff], [1, -coeff], level)


def _max_filter(x: np.ndarray, width: int) -> np.ndarray:
    return -minimum_filter1d(-x, size=width, mode="nearest")


def compress(
    x: np.ndarray,
    threshold_db: float,
    ratio: float,
    attack_ms: float = 10.0,
    release_ms: float = 120.0,
    makeup_db: float = 0.0,
    knee_db: float = 6.0,
) -> np.ndarray:
    """Feed-forward compressor with a soft knee; returns the processed signal."""
    env = follower(x, attack_ms, release_ms)
    level = 20.0 * np.log10(np.maximum(env, 1e-9))
    over = level - threshold_db
    gr = np.where(
        over <= -knee_db / 2,
        0.0,
        np.where(
            over >= knee_db / 2,
            over * (1 - 1 / ratio),
            (1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db),
        ),
    )
    gain = 10.0 ** ((makeup_db - gr) / 20.0)
    return x * (gain[:, None] if x.ndim == 2 else gain)


def limit(
    x: np.ndarray, ceiling_db: float = -1.2, lookahead_ms: float = 3.0, release_ms: float = 80.0
):
    """Look-ahead brickwall limiter on 4x-oversampled peaks: true peaks stay under the ceiling."""
    ceiling = db(ceiling_db)
    up = signal.resample_poly(x, 4, 1, axis=0)
    peak = np.max(np.abs(stereo(up)), axis=1).reshape(-1, 4).max(axis=1)[: len(x)]
    if len(peak) < len(x):
        peak = np.pad(peak, (0, len(x) - len(peak)))
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    look = max(1, int(SR * lookahead_ms / 1000.0))
    gain = minimum_filter1d(need, size=2 * look + 1, mode="nearest")
    coeff = math.exp(-1.0 / (SR * release_ms / 1000.0))
    # Release smoothing that never rises faster than the one-pole, never above the hold.
    smoothed = signal.lfilter([1 - coeff], [1, -coeff], gain - 1.0) + 1.0
    gain = np.minimum(gain, smoothed)
    box = np.ones(look) / look
    gain = np.convolve(gain, box, mode="same")
    gain = np.minimum(gain, minimum_filter1d(need, size=look, mode="nearest"))
    return x * gain[:, None]


# --- space ---------------------------------------------------------------------------------


def reverb_ir(
    seconds: float, rng: np.random.Generator, predelay_ms: float = 12.0, bright: float = 6000.0
):
    """Decorrelated stereo impulse response: exponentially decaying noise, darker with time."""
    n = int(SR * seconds)
    t = np.arange(n) / SR
    noise = rng.standard_normal((n, 2))
    early = lowpass(noise, bright, 2)
    late = lowpass(noise, bright / 4.0, 2)
    mix = np.clip(t / seconds * 1.6, 0, 1)[:, None]
    tail = (early * (1 - mix) + late * mix) * np.exp(-6.9 * t / seconds)[:, None]
    tail[: int(SR * 0.004)] *= np.linspace(0, 1, int(SR * 0.004))[:, None]
    ir = np.concatenate([np.zeros((int(SR * predelay_ms / 1000.0), 2)), tail])
    return ir / np.sqrt(np.sum(ir**2) / 2.0)


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    x = stereo(x)
    out = np.stack([signal.oaconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)
    return out


# --- loudness (ITU-R BS.1770-4 / EBU R 128) -----------------------------------------------

_K1 = (
    np.array([1.53512485958697, -2.69169618940638, 1.19839281085285]),
    np.array([1.0, -1.69065929318241, 0.73248077421585]),
)
_K2 = (np.array([1.0, -2.0, 1.0]), np.array([1.0, -1.99004745483398, 0.99007225036621]))


def loudness(x: np.ndarray) -> float:
    """Integrated loudness in LUFS (48 kHz)."""
    k = signal.lfilter(*_K1, stereo(x), axis=0)
    k = signal.lfilter(*_K2, k, axis=0)
    block, hop = int(0.4 * SR), int(0.1 * SR)
    if len(k) < block:
        return -70.0
    power = np.cumsum(np.concatenate([np.zeros((1, 2)), k**2]), axis=0)
    starts = np.arange(0, len(k) - block + 1, hop)
    ms = (power[starts + block] - power[starts]) / block
    z = ms.sum(axis=1)
    lk = -0.691 + 10 * np.log10(np.maximum(z, 1e-12))
    gated = z[lk > -70.0]
    if gated.size == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(gated.mean()) - 10.0
    final = z[(lk > -70.0) & (lk > rel)]
    return float(-0.691 + 10 * np.log10(final.mean()))


def true_peak_db(x: np.ndarray) -> float:
    up = signal.resample_poly(stereo(x), 4, 1, axis=0)
    return to_db(float(np.max(np.abs(up))))


def short_term(x: np.ndarray, hop_s: float = 0.1) -> np.ndarray:
    """Short-term loudness (3 s windows) every `hop_s`, in LUFS."""
    k = signal.lfilter(*_K1, stereo(x), axis=0)
    k = signal.lfilter(*_K2, k, axis=0)
    block, hop = int(3.0 * SR), int(hop_s * SR)
    power = np.cumsum(np.concatenate([np.zeros((1, 2)), k**2]), axis=0)
    starts = np.arange(0, max(1, len(k) - block + 1), hop)
    ms = (power[np.minimum(starts + block, len(k))] - power[starts]) / block
    return -0.691 + 10 * np.log10(np.maximum(ms.sum(axis=1), 1e-12))


# --- WAV I/O -------------------------------------------------------------------------------


def write_wav(path, x: np.ndarray, bits: int = 24) -> None:
    """PCM WAV, 48 kHz stereo; deterministic bytes for the same samples (no dither)."""
    x = np.clip(stereo(x), -1.0, 1.0)
    if bits == 24:
        ints = np.round(x * 8_388_607.0).astype("<i4")
        raw = ints.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
        width = 3
    elif bits == 16:
        raw = np.round(x * 32_767.0).astype("<i2").tobytes()
        width = 2
    else:
        raise ValueError(bits)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(width)
        f.setframerate(SR)
        f.writeframes(raw)


def read_wav(path) -> np.ndarray:
    """Any PCM/float WAV as float64 stereo at its own rate (callers resample if needed)."""
    import warnings

    from scipy.io import wavfile

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", wavfile.WavFileWarning)  # FluidSynth's PEAK chunk
        rate, data = wavfile.read(str(path))
    if data.dtype == np.int16:
        data = data / 32_768.0
    elif data.dtype == np.int32:
        data = data / 2_147_483_648.0
    data = np.asarray(data, dtype=np.float64)
    if rate != SR:
        data = signal.resample_poly(data, SR, rate, axis=0)
    return stereo(data)
