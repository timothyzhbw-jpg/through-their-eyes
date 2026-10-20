// Perception telemetry (SPEC 4.7, 7): per-frame curves for the player whose eyes the first-person
// view uses, with a cursor at the playhead. Head angle to the ball with the sim's scans, head
// angular speed with the scan detector's threshold, onsets and accepted scans, players in sight,
// and (for the hero only) belief error. Every value is a computed metric from the sim export or
// the detector's own output (sim.export runs analytics/scan_detector.py), not a verified claim.

import {
  clampFrame,
  headOffBall,
  sampleInto,
  type DetectedScan,
  type Hero,
  type Run,
  type Sample,
  type Scan,
} from "../data/hero";

export const DEG = 180 / Math.PI;
export const VIEW_W = 1000; // sparkline viewBox width
export const ROW_H = 40; // sparkline viewBox height (px on screen)
const PAD = 3; // keeps curves off the top and bottom edges

export interface Onset {
  frame: number;
  accepted: boolean; // inside a scan the detector accepted; otherwise the gate rejected it
}

export interface Belief {
  target: string | null; // the runner; null: mean over every other player
  error: Float32Array; // m per frame: belief ghost to true position
}

export interface Telemetry {
  player: number;
  playerId: string;
  frames: number;
  axis: number; // frames on the time axis: the longer run, so both runs share one axis
  known: number; // last frame on screen; live: the last frame the stream sent
  headToBall: Float32Array; // deg in [0, 180] per frame, as the HUD shows it
  headSpeed: Float32Array; // deg/s per frame interval t -> t + 1 (frames - 1), the detector's |omega|
  inSight: Uint8Array; // players in his sight per frame, himself not counted (as the HUD)
  belief: Belief | null; // beliefs are recorded for the hero only
  scans: Scan[]; // the sim's scans of this player (ground truth)
  droppedKey: Scan | null; // without the look: where the hero's key scan was
  onsets: Onset[]; // the detector's candidate onsets
  detected: DetectedScan[]; // the detector's accepted scans
  thresholdDeg: number; // deg/s
  max: { speed: number; inSight: number; belief: number }; // y-axis tops
}

const niceCeil = (x: number, step: number) => Math.ceil(x / step) * step;

/**
 * Everything the panel draws for `playerId` in `run`, up to frame `known` (later frames are not
 * shown: live, the stream has not sent them). A scan is shown once it has ended, as the sim and
 * the detector can only know it then; an onset once the turn that triggered it is in.
 */
export function telemetry(hero: Hero, run: Run, playerId: string, known = run.frames - 1) {
  const n = hero.n;
  const j = hero.ids.indexOf(playerId);
  if (j < 0) throw new Error(`no player ${playerId}`);
  const frames = run.frames;
  const last = Math.min(frames - 1, Math.floor(known));

  const headToBall = new Float32Array(frames);
  const inSight = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) {
    const dx = run.ball[2 * f] - run.pos[(f * n + j) * 2];
    const dy = run.ball[2 * f + 1] - run.pos[(f * n + j) * 2 + 1];
    const off = run.head[f * n + j] - Math.atan2(dy, dx);
    headToBall[f] = Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) * DEG;
    const mask = run.seenBy[f * n + j];
    let count = 0;
    for (let k = 0; k < n; k++) if (k !== j && ((mask >>> k) & 1) === 1) count++;
    inSight[f] = count;
  }
  const headSpeed = new Float32Array(frames - 1);
  for (let t = 0; t < frames - 1; t++) headSpeed[t] = Math.abs(run.detector.omega[t * n + j]) * DEG;

  let belief: Belief | null = null;
  if (j === hero.hero) {
    const target = hero.runner >= 0 && hero.runner !== j ? hero.runner : -1;
    const error = new Float32Array(frames);
    for (let f = 0; f < frames; f++) error[f] = beliefError(hero, run.pos, run.ghost, f, j, target);
    belief = { target: target >= 0 ? hero.ids[target] : null, error };
  }

  const detected = run.detector.scans[j].filter((s) => s.end <= last);
  const onsets = run.detector.onsets[j]
    .filter((f) => f + 1 <= last)
    .map((frame) => ({
      frame,
      accepted: detected.some((s) => frame >= s.start && frame <= s.end),
    }));
  const key = hero.keyScan;
  const droppedKey =
    run.name === "counterfactual" && j === hero.hero && key.end <= last ? key : null;

  const thresholdDeg = hero.detector.omegaThreshold * DEG;
  const peak = (a: ArrayLike<number>, to: number) => {
    let m = 0;
    for (let k = 0; k <= Math.min(to, a.length - 1); k++) m = Math.max(m, a[k]);
    return m;
  };
  return {
    player: j,
    playerId,
    frames,
    axis: timeAxis(hero),
    known: last,
    headToBall,
    headSpeed,
    inSight,
    belief,
    scans: run.scans.filter((s) => s.player === playerId && s.end <= last),
    droppedKey,
    onsets,
    detected,
    thresholdDeg,
    max: {
      speed: Math.max(1.5 * thresholdDeg, niceCeil(peak(headSpeed, frames - 2), 100)),
      inSight: Math.max(6, peak(inSight, frames - 1)),
      belief: belief ? Math.max(2, Math.ceil(peak(belief.error, frames - 1))) : 1,
    },
  } satisfies Telemetry;
}

/** Frames on the shared time axis: both runs on one axis, so overlaid curves line up. */
export function timeAxis(hero: Hero): number {
  return Math.max(hero.runs.factual.frames, hero.runs.counterfactual.frames);
}

export interface KeyPoint {
  frame: number;
  label: string;
  align: "start" | "end"; // the label starts at its line, or ends there (a later point is close)
}

export interface KeyPoints {
  scan: { start: number; end: number; dropped: boolean } | null; // the hero's key scan
  points: KeyPoint[]; // the ball reaching the hero, his decision, his pass; same frames merged
}

const CLOSE = 0.12; // labels closer than this share of the axis would overlap

/**
 * The moment's key points on the time axis, shared by every sparkline: the hero's key scan
 * (dropped in the run without the look), the ball reaching him, his decision and his pass.
 * Up to frame `known`, like the curves.
 */
export function keyPoints(hero: Hero, run: Run, known = run.frames - 1): KeyPoints {
  const key = hero.keyScan;
  const scan =
    key.end <= known
      ? { start: key.start, end: key.end, dropped: run.name === "counterfactual" }
      : null;
  const arrival = run.events.find((e) => e.type === "reception" && e.player === hero.heroId);
  const pass = run.events.find(
    (e) => e.type === "pass" && e.player === hero.heroId && e.frame >= (arrival?.frame ?? 0),
  );
  const marks: [number | undefined, string][] = [
    [arrival?.frame, `Ball at ${hero.heroId}`],
    [run.decision?.frame, "Decision"],
    [pass?.frame, "Pass"],
  ];
  const byFrame = new Map<number, string[]>();
  for (const [frame, label] of marks) {
    if (frame === undefined || frame > known) continue;
    byFrame.set(frame, [...(byFrame.get(frame) ?? []), label]);
  }
  const frames = [...byFrame.keys()].sort((a, b) => a - b);
  const close = CLOSE * timeAxis(hero);
  const lower = (l: string) => l.charAt(0).toLowerCase() + l.slice(1);
  const labels = frames.map((f) =>
    byFrame
      .get(f)!
      .map((l, i) => (i ? lower(l) : l))
      .join(" · "),
  );
  return {
    scan,
    points: frames.map((frame, k) => ({
      frame,
      label: labels[k],
      align: k + 1 < frames.length && frames[k + 1] - frame < close ? "end" : "start",
    })),
  };
}

/** Distance from the belief ghost to the true position, m; target -1: mean over the others. */
function beliefError(
  hero: Hero,
  pos: Float32Array,
  ghost: Float32Array,
  f: number,
  observer: number,
  target: number,
): number {
  const n = hero.n;
  const gap = (k: number) => {
    const i = (f * n + k) * 2;
    return Math.hypot(ghost[i] - pos[i], ghost[i + 1] - pos[i + 1]);
  };
  if (target >= 0) return gap(target);
  let sum = 0;
  for (let k = 0; k < n; k++) if (k !== observer) sum += gap(k);
  return sum / (n - 1);
}

export interface Readout {
  headToBall: number; // deg
  headSpeed: number; // deg/s
  inSight: number;
  belief: number | null; // m; null for anyone but the hero
}

/**
 * The values at the playhead (fractional frame `f`). Head angle and belief error come from the
 * same interpolated sample the views draw (the HUD's "head N° from the ball", eased in comfort
 * mode); speed and sight from the frame at or before `f`.
 */
export function readout(
  hero: Hero,
  run: Run,
  t: Telemetry,
  f: number,
  comfort: boolean,
  sample: Sample,
): Readout {
  sampleInto(sample, hero, run, f, comfort);
  const frame = Math.floor(clampFrame(run, f));
  let belief: number | null = null;
  if (t.belief) {
    const target = t.belief.target ? hero.ids.indexOf(t.belief.target) : -1;
    belief = beliefError(hero, sample.pos, sample.ghost, 0, t.player, target);
  }
  return {
    headToBall: headOffBall(sample, t.player) * DEG,
    headSpeed: t.headSpeed[Math.min(t.frames - 2, frame)] ?? 0,
    inSight: t.inSight[frame],
    belief,
  };
}

// ---------- drawing (viewBox units: x in [0, VIEW_W], y in [0, ROW_H]) ----------

/** x of a (fractional) frame on an axis of `axis` frames: the cursor and every mark use it. */
export function frameX(axis: number, f: number): number {
  const last = Math.max(1, axis - 1);
  return (Math.max(0, Math.min(last, f)) / last) * VIEW_W;
}

export function valueY(v: number, max: number): number {
  const k = Math.max(0, Math.min(1, v / max));
  return ROW_H - PAD - k * (ROW_H - 2 * PAD);
}

/** SVG path of `values[k]` at frame k on an axis of `axis` frames, for k up to `upTo`. */
export function linePath(values: ArrayLike<number>, axis: number, max: number, upTo: number) {
  const parts: string[] = [];
  const last = Math.min(values.length - 1, upTo);
  for (let k = 0; k <= last; k++) {
    const x = frameX(axis, k).toFixed(1);
    const y = valueY(values[k], max).toFixed(1);
    parts.push(`${k === 0 ? "M" : "L"}${x} ${y}`);
  }
  return parts.join(" ");
}
