// The sound design's sounds (SPEC 7), all synthesized here with the Web Audio API: no recordings,
// so nothing to license or download (docs/CREDITS.md). Kept low and short:
// - crowd bed: looped pink noise through two band-passes (the murmur of a stand) with slow,
//   uneven swells, low-passed (muffled) by the key-moment beat;
// - whoosh: a noise burst through a band-pass that sweeps up and back down, panned;
// - sting: a soft low thud under a short minor chord with a breath of high noise.
// Everything goes through one duck gain (down while the voice speaks) and a master gain that
// fades in and out with the Sound switch. The AudioContext is made and woken by `unlock`, inside
// the tap that turns the sound on (Safari and iOS start audio only from a tap), and suspended
// while the sound is off. The narration voice plays through the same context (voice/voice.ts).

import type { SoundOut } from "./bind";

const LEVEL = { master: 0.9, bed: 0.085, whoosh: 0.16, thud: 0.34, chord: 0.05, air: 0.025 };
const FADE_S = 0.35;
const DUCK_ATTACK_S = 0.06; // time constants of setTargetAtTime
const DUCK_RELEASE_S = 0.3;

type Ctx = AudioContext;

function pinkNoise(ctx: Ctx, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    // Paul Kellet's economy pink filter over white noise.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
    }
    // Cross-fade the loop's ends so it repeats without a click.
    const fade = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[length - fade + i] * (1 - t);
    }
  }
  return buffer;
}

export class SoundEngine implements SoundOut {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private on = false;
  private duckGain = 1;
  private cutoff = 3200;

  constructor(private readonly make: () => Ctx | null = defaultContext) {}

  /** The page's AudioContext, once `unlock` has made it. */
  get context(): Ctx | null {
    return this.ctx;
  }

  /**
   * Make and wake the AudioContext. Call it inside the tap that turns the sound on: a context
   * woken there may play at any time after, which an <audio> element on Safari or iOS may not.
   * On an iPhone the page plays as media, so the silent switch does not mute it.
   */
  unlock(): void {
    const ctx = this.context ?? this.makeContext();
    if (!ctx) return;
    const session = (globalThis.navigator as { audioSession?: { type: string } } | undefined)
      ?.audioSession;
    if (session && session.type !== "playback") session.type = "playback";
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  }

  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on && !this.master) this.build();
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? LEVEL.master : 0, t, FADE_S / 3);
    if (on) void ctx.resume();
    else setTimeout(() => !this.on && void ctx.suspend(), FADE_S * 1000 + 100);
  }

  setDuck(gain: number): void {
    if (gain === this.duckGain) return;
    const ctx = this.ctx;
    const down = gain < this.duckGain;
    this.duckGain = gain;
    if (!ctx || !this.duck) return;
    this.duck.gain.setTargetAtTime(gain, ctx.currentTime, down ? DUCK_ATTACK_S : DUCK_RELEASE_S);
  }

  setMuffle(cutoffHz: number): void {
    const rounded = Math.round(cutoffHz / 10) * 10;
    if (rounded === this.cutoff) return;
    this.cutoff = rounded;
    if (this.ctx && this.muffle)
      this.muffle.frequency.setTargetAtTime(rounded, this.ctx.currentTime, 0.08);
  }

  whoosh(pan: number): void {
    const ctx = this.live();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(320, t);
    band.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
    band.frequency.exponentialRampToValueAtTime(600, t + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(LEVEL.whoosh, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(-pan, t);
    panner.pan.linearRampToValueAtTime(pan, t + 0.45);
    src.connect(band).connect(gain).connect(panner).connect(this.duck!);
    src.start(t, Math.random() * 4, 0.6);
  }

  sting(): void {
    const ctx = this.live();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + 0.01;
    const out = this.duck!;
    // A soft low thud: a sine falling in pitch.
    const thud = ctx.createOscillator();
    thud.frequency.setValueAtTime(96, t);
    thud.frequency.exponentialRampToValueAtTime(44, t + 0.35);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.0001, t);
    thudGain.gain.exponentialRampToValueAtTime(LEVEL.thud, t + 0.02);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    thud.connect(thudGain).connect(out);
    thud.start(t);
    thud.stop(t + 1.2);
    // A short A-minor chord, low-passed, that swells and dies.
    const chordGain = ctx.createGain();
    chordGain.gain.setValueAtTime(0.0001, t);
    chordGain.gain.exponentialRampToValueAtTime(LEVEL.chord, t + 0.08);
    chordGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(1400, t);
    lowpass.frequency.exponentialRampToValueAtTime(500, t + 1.6);
    chordGain.connect(lowpass).connect(out);
    for (const [hz, detune] of [
      [110, -4],
      [130.81, 3],
      [164.81, -2],
      [220, 5],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = hz;
      osc.detune.value = detune;
      osc.connect(chordGain);
      osc.start(t);
      osc.stop(t + 1.9);
    }
    // A breath of air on top.
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 3500;
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.0001, t);
    airGain.gain.exponentialRampToValueAtTime(LEVEL.air, t + 0.03);
    airGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    air.connect(high).connect(airGain).connect(out);
    air.start(t, Math.random() * 4, 0.8);
  }

  /** The context while the sound is on and running; null otherwise (cues are dropped). */
  private live(): Ctx | null {
    return this.on && this.ctx && this.ctx.state !== "closed" ? this.ctx : null;
  }

  private makeContext(): Ctx | null {
    this.ctx ??= this.make();
    return this.ctx;
  }

  private build(): void {
    const ctx = this.makeContext();
    if (!ctx) return;
    this.noise = pinkNoise(ctx, 6);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.duck = ctx.createGain();
    this.duck.gain.value = this.duckGain;
    this.duck.connect(this.master);
    // The crowd bed.
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = this.cutoff;
    this.muffle.Q.value = 0.5;
    const bed = ctx.createGain();
    bed.gain.value = LEVEL.bed;
    this.muffle.connect(bed).connect(this.duck);
    for (const [hz, q, phase] of [
      [420, 0.7, 0],
      [1150, 0.9, 2.1],
    ]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = hz;
      band.Q.value = q;
      // Slow, uneven swells: two LFOs at unrelated rates on the stand's level.
      const level = ctx.createGain();
      level.gain.value = 0.75;
      for (const [rate, depth] of [
        [0.071, 0.18],
        [0.193, 0.1],
      ]) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rate;
        const amount = ctx.createGain();
        amount.gain.value = depth;
        lfo.connect(amount).connect(level.gain);
        lfo.start(ctx.currentTime + phase);
      }
      src.connect(band).connect(level).connect(this.muffle);
      src.start(0, phase);
    }
  }
}

function defaultContext(): Ctx | null {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  return Ctor ? new Ctor({ latencyHint: "interactive" }) : null;
}

/** The page's one sound engine (one AudioContext for every moment shown). */
export const soundEngine = new SoundEngine();
