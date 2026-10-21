// The key-moment beat (SPEC 7): the replay treats each key scan like a broadcast highlight. As the
// look begins, play eases into slow motion (BEAT.slow, about 0.4x) and the camera pushes in on
// the hero; when the runner first comes into his sight the picture holds for a beat (the freeze
// accent) and he is ringed; play eases back to 1x as the hero releases the pass. In the run
// without the look the same frames slow down, with no accent: he never looked.
//
// Everything here is a function of the frame, so the beat is the same on every replay, on the
// live stream and in a stitched match (one beat per key scan). Only how fast frames go by
// changes: no position, no event and no number. prefers-reduced-motion turns it off (`motion`).
//
// Timing: a time density tau(f) >= 1, the wall time one frame takes relative to the chosen
// speed. tau = 1 / k with k the slow-motion factor (1 outside the beat, eased to BEAT.slow / speed
// inside), plus a bump of fixed area at the sighting: BEAT.accentS of wall time whatever the
// speed. Its integral is tabulated per beat (TABLE_RES points per frame) and a step is found by
// inverting that table, so a step split in two lands exactly where the whole step does.

import { isSeen, type Hero, type Run, type Scan } from "../data/hero";
import { LIVE_MAX_LAG } from "../live/feed";
import { createStore } from "../store/store";

export const BEAT = {
  slow: 0.4, // playback speed through the key scan (x real time)
  leadS: 0.32, // match seconds of ease-in before the scan starts
  minTailS: 0.2, // ease-out after the scan when the pass comes sooner (or never)
  maxTailS: 1.0, // ... and at most this long when it comes later
  accentS: 0.35, // wall seconds the freeze accent adds as the runner comes into sight
  accentFrames: 1, // width of the accent, frames, starting at the sighting frame
  ringS: 1.2, // match seconds the runner's ring stays after the sighting
};

const TABLE_RES = 32; // table points per frame

/** prefers-reduced-motion, kept current: the beat, the push-in, count-ups and stings are off. */
export const motion = createStore({ reduced: queryReduced() });

function queryReduced(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener?.("change", () => motion.set({ reduced: query.matches }));
  return query.matches;
}

export interface Beat {
  scan: Scan; // the key scan; without the look, where it would have been
  observer: number; // whose look (player index)
  target: number; // the player the look is for (runner, marker's man, pass receiver); -1: none
  start: number; // frame: the ease into slow motion starts
  slowFrom: number; // full slow motion from here (the scan's first frame) ...
  slowTo: number; // ... to here (its last)
  end: number; // back to 1x: the release (his pass), within the tail limits
  sighted: number | null; // the frame the target first comes into his sight during the scan
  dropped: boolean; // the run without the look: the scan never happened
  dt: number;
}

const beatCache = new WeakMap<Run, Beat[]>();

/** The beats of a run, in frame order: one per key scan (or per dropped key scan). */
export function beatsOf(hero: Hero, run: Run): Beat[] {
  let beats = beatCache.get(run);
  if (!beats) {
    beats = buildBeats(hero, run);
    beatCache.set(run, beats);
  }
  return beats;
}

function buildBeats(hero: Hero, run: Run): Beat[] {
  const keys = run.scans.filter((s) => s.key);
  const dropped = !keys.length && run.name === "counterfactual" && !!hero.keyScan;
  const scans = dropped ? [hero.keyScan!] : keys;
  const frames = (s: number) => Math.round(s / hero.dt);
  return scans
    .map((scan) => {
      const observer = hero.ids.indexOf(scan.player);
      const release = releaseOf(run, scan);
      const minEnd = scan.end + frames(BEAT.minTailS);
      const maxEnd = scan.end + frames(BEAT.maxTailS);
      // In a stitched match the beat ends with its possession at the latest (the cut).
      const cut = hero.match?.possessions.find((p) => p.start > scan.start)?.start ?? run.frames;
      const last = Math.min(run.frames, cut) - 1;
      const end = Math.min(last, Math.max(minEnd, Math.min(maxEnd, release?.frame ?? 0)));
      const target = targetOf(hero, scan, release);
      const sighted =
        dropped || !run.sight || target < 0 ? null : sighting(hero, run, scan, observer, target);
      return {
        scan,
        observer,
        target,
        start: Math.max(0, scan.start - frames(BEAT.leadS)),
        slowFrom: scan.start,
        slowTo: scan.end,
        end: Math.max(end, scan.end + 1),
        sighted,
        dropped,
        dt: hero.dt,
      };
    })
    .sort((a, b) => a.start - b.start);
}

/** His pass or shot after the look began; for a marker (no ball), the next pass of anyone. */
function releaseOf(run: Run, scan: Scan) {
  const after = run.events.filter(
    (e) => (e.type === "pass" || e.type === "shot") && e.frame > scan.start,
  );
  return (
    after.find((e) => e.player === scan.player) ?? after.find((e) => e.type === "pass") ?? null
  );
}

function targetOf(hero: Hero, scan: Scan, release: ReturnType<typeof releaseOf>): number {
  if (scan.player === hero.heroId) {
    if (hero.marker) return hero.ids.indexOf(hero.marker.man);
    if (hero.runner >= 0) return hero.runner;
  }
  const to = release?.attrs.to ?? release?.attrs.receiver;
  return typeof to === "string" ? hero.ids.indexOf(to) : -1;
}

/** The first frame of the scan on which the target comes into the observer's sight. */
function sighting(hero: Hero, run: Run, scan: Scan, observer: number, target: number) {
  for (let f = Math.max(1, scan.start); f <= scan.end; f++) {
    if (isSeen(hero, run, f, observer, target) && !isSeen(hero, run, f - 1, observer, target))
      return f;
  }
  return null;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** How far into the beat frame `f` is: 0 outside, easing to 1 through the scan. */
export function beatWeight(b: Beat, f: number): number {
  if (f <= b.start || f >= b.end) return 0;
  if (f < b.slowFrom) return smooth((f - b.start) / (b.slowFrom - b.start));
  if (f <= b.slowTo) return 1;
  return 1 - smooth((f - b.slowTo) / (b.end - b.slowTo));
}

/** The beat whose window holds frame `f`. */
export function beatAt(beats: readonly Beat[], f: number): Beat | null {
  return beats.find((b) => f >= b.start && f <= b.end) ?? null;
}

/** Wall time per frame relative to the chosen speed (1 outside a beat). */
function density(b: Beat, f: number, speed: number): number {
  const slow = Math.min(1, BEAT.slow / speed);
  let tau = 1 / (1 - (1 - slow) * beatWeight(b, f));
  if (b.sighted !== null) {
    const x = f - b.sighted;
    const w = BEAT.accentFrames;
    if (x > 0 && x < w) {
      const bump = (1 - Math.cos((2 * Math.PI * x) / w)) / w; // unit area over [0, w]
      tau += (bump * BEAT.accentS * speed) / b.dt;
    }
  }
  return tau;
}

/** Cumulative wall time (in frames at the chosen speed) across a beat, on a fine grid. */
const tables = new WeakMap<Beat, Map<number, Float64Array>>();
function tableOf(b: Beat, speed: number): Float64Array {
  let bySpeed = tables.get(b);
  if (!bySpeed) tables.set(b, (bySpeed = new Map()));
  let c = bySpeed.get(speed);
  if (c) return c;
  const n = Math.max(1, Math.round((b.end - b.start) * TABLE_RES));
  const h = (b.end - b.start) / n;
  c = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const x = b.start + i * h;
    // Simpson's rule on each cell.
    const s = density(b, x, speed) + 4 * density(b, x + h / 2, speed) + density(b, x + h, speed);
    c[i + 1] = c[i] + (h * s) / 6;
  }
  bySpeed.set(speed, c);
  return c;
}

/** Cumulative wall time from the beat's start to frame `f` inside it. */
function wallTo(b: Beat, c: Float64Array, f: number): number {
  const n = c.length - 1;
  const u = ((f - b.start) / (b.end - b.start)) * n;
  const i = Math.max(0, Math.min(n - 1, Math.floor(u)));
  return c[i] + (c[i + 1] - c[i]) * (u - i);
}

/** The frame inside the beat reached after `t` of wall time from its start. */
function frameAfter(b: Beat, c: Float64Array, t: number): number {
  let lo = 0;
  let hi = c.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = c[hi] - c[lo];
  const u = lo + (span > 0 ? (t - c[lo]) / span : 0);
  return b.start + (u / (c.length - 1)) * (b.end - b.start);
}

/**
 * Frames to advance from `frame` for `budget` frames' worth of wall time at the chosen speed (what
 * a step would be without the beat). Outside every beat, or under reduced motion, that is
 * `budget` itself.
 */
export function beatStep(
  hero: Hero,
  run: Run,
  frame: number,
  budget: number,
  speed: number,
  reduced: boolean,
): number {
  if (reduced || budget <= 0 || speed <= 0) return budget;
  const beats = beatsOf(hero, run);
  if (!beats.length) return budget;
  let x = frame;
  let left = budget;
  for (let guard = 0; guard < 2 * beats.length + 2; guard++) {
    const b = beats.find((bb) => x >= bb.start && x < bb.end);
    if (b) {
      const c = tableOf(b, speed);
      const target = wallTo(b, c, x) + left;
      const total = c[c.length - 1];
      if (target <= total) return Math.max(x, frameAfter(b, c, target)) - frame;
      left = target - total;
      x = b.end;
      continue;
    }
    const next = beats.find((bb) => bb.start > x)?.start ?? Infinity;
    if (x + left <= next) return x + left - frame;
    left -= next - x;
    x = next;
  }
  return x + left - frame;
}

/** The camera's push-in at frame `f`: 0..1, with the slow motion; 0 under reduced motion. */
export function pushAt(hero: Hero, run: Run, f: number): number {
  if (motion.get().reduced) return 0;
  const b = beatAt(beatsOf(hero, run), f);
  return b ? beatWeight(b, f) : 0;
}

/**
 * The live stream plays on at 1x while a beat slows the playhead down, so the playhead may fall
 * behind it by the wall time the beats have added since the last cut, on top of LIVE_MAX_LAG.
 * The cut is the start of the possession on screen in a stitched match (it already jumps there,
 * so catching up at it is not seen); a single hero moment has none.
 */
export function liveLag(hero: Hero, run: Run, frame: number, speed: number, reduced: boolean) {
  if (reduced || speed <= 0) return LIVE_MAX_LAG;
  let cut = 0;
  for (const p of hero.match?.possessions ?? []) if (p.start <= frame) cut = p.start;
  let debt = 0;
  for (const b of beatsOf(hero, run)) {
    if (b.start < cut || b.start > frame) continue;
    const to = Math.min(frame, b.end);
    debt += wallTo(b, tableOf(b, speed), to) - (to - b.start);
  }
  return LIVE_MAX_LAG + Math.ceil(debt);
}

/** The runner's ring: 0..1 from the sighting, fading out BEAT.ringS later; 0 without one. */
export function ringAt(b: Beat, f: number): number {
  if (b.sighted === null || f < b.sighted) return 0;
  const age = (f - b.sighted) * b.dt;
  return age >= BEAT.ringS ? 0 : 1 - smooth(age / BEAT.ringS);
}

/** The ring's pop: 0..1, peaking just after the sighting (a scale accent, not a hold). */
export function popAt(b: Beat, f: number): number {
  if (b.sighted === null) return 0;
  const x = (f - b.sighted) / 4; // frames
  return x < 0 || x > 1 ? 0 : Math.sin(Math.PI * x);
}
