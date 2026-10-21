// When the sound design plays what (SPEC 7): pure rules over two playback snapshots, so they are
// tested without an AudioContext (engine.ts makes the sounds, bind.ts wires them to a session).
// - a soft whoosh as each scan of the player whose eyes these are begins, panned to where he turns;
// - a sting at the "without the look" reveal: the viewer switches to the run without it, or a
//   caption with a counterfactual claim comes up after one without;
// - the crowd bed muffles with the key-moment beat (as if time slowed), and everything ducks under
//   the narration voice.
// Reduced motion keeps the bed and the whooshes but drops the sting (SPEC 7: no stings).

import type { Hero } from "../data/hero";
import type { PlaybackState } from "../store/playback";

export const DUCK = 0.28; // gain of the effects and the bed while the voice speaks (about -11 dB)
export const STING_GAP_S = 4; // at most one sting in this long
const SEEK_FRAMES = 8; // a playhead move larger than this is a seek: no whoosh for what it skips

export type Cue = { kind: "whoosh"; pan: number } | { kind: "sting" };

type Snapshot = Pick<
  PlaybackState,
  "frame" | "playing" | "mode" | "povPlayer" | "captionLine" | "live"
>;

export interface CueContext {
  hero: Hero;
  /** Whether a caption line carries a counterfactual claim (the "without that look" lines). */
  isReveal: (lineId: string) => boolean;
  reduced: boolean;
}

/** The cues due between two snapshots of the playback store. */
export function cuesBetween(prev: Snapshot, next: Snapshot, ctx: CueContext): Cue[] {
  const cues: Cue[] = [];
  const { hero } = ctx;
  const sameRun = prev.mode === next.mode;
  const step = next.frame - prev.frame;
  if (next.playing && sameRun && step > 0 && step <= SEEK_FRAMES) {
    const run = hero.runs[next.mode];
    const j = hero.ids.indexOf(next.povPlayer);
    for (const scan of run.scans) {
      if (scan.player !== next.povPlayer || scan.start <= prev.frame || scan.start > next.frame)
        continue;
      cues.push({ kind: "whoosh", pan: j < 0 ? 0 : turnPan(hero, next.mode, j, scan) });
    }
  }
  if (!ctx.reduced) {
    const switched = prev.mode === "factual" && next.mode === "counterfactual";
    const line = next.captionLine;
    const revealed =
      !!line &&
      line !== prev.captionLine &&
      ctx.isReveal(line) &&
      !(prev.captionLine && ctx.isReveal(prev.captionLine));
    if (switched || revealed) cues.push({ kind: "sting" });
  }
  return cues;
}

/** -1 (left) .. 1 (right): which way the head turns over the scan, as the listener hears it. */
function turnPan(
  hero: Hero,
  mode: PlaybackState["mode"],
  j: number,
  scan: { start: number; end: number },
) {
  const run = hero.runs[mode];
  const n = hero.n;
  const a = run.head[scan.start * n + j];
  const mid = Math.min(run.frames - 1, Math.round((scan.start + scan.end) / 2));
  const b = run.head[mid * n + j];
  const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a)); // anticlockwise > 0: to his left
  return Math.max(-0.7, Math.min(0.7, -turn));
}

/** Gain of everything under the voice: ducked while a clip loads or plays. */
export function duckFor(voice: { on: boolean; status: string }): number {
  return voice.on && voice.status === "playing" ? DUCK : 1;
}

/** Crowd bed low-pass cutoff (Hz) for the beat's push (0..1): muffled as time slows. */
export function bedCutoff(push: number): number {
  const open = 3200;
  const shut = 520;
  return open * Math.pow(shut / open, Math.max(0, Math.min(1, push)));
}
