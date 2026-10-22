// Belief ghosts (SPEC 7: "where he thought they were"): which show, and how strongly. By default
// only the ghost of the moment, the runner's, from the hero's key scan (or the 2.4 s before his
// decision, without one) to his decision; View options can ask for everyone's. A ghost comes in
// with how wrong his picture is (nothing under 1 m, full from 3 m) and goes out over 0.15 s of
// match time when a look corrects it, and at the window's ends: nothing pops on or off. Pure
// functions of the frame, so a paused frame, slow motion and the trailer's frame-by-frame capture
// all draw the same ghost.

import type { Hero, Run } from "../data/hero";

export const GHOST_FROM_M = 1; // his picture this close to the truth: no ghost
export const GHOST_FULL_M = 3; // this far off: the ghost at full strength
export const GHOST_EASE_S = 0.15; // fades take this much match time
export const GHOST_LABEL_S = 2; // the runner's ghost says what it is, from the window's start
const LEAD_S = 2.4; // without a key scan the window is the 2.4 s up to the decision
const HOLD_STEP = 0.25; // frames between the samples the fade-out holds

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export interface GhostWindow {
  from: number; // frames
  to: number;
}

/** The default ghost's frames in this run: the hero's key scan to his decision. */
export function ghostWindow(hero: Hero, run: Run): GhostWindow | null {
  if (hero.hero < 0 || hero.runner < 0) return null;
  const to = run.decision?.frame ?? hero.reception;
  const from = hero.keyScan ? hero.keyScan.start : to - LEAD_S / hero.dt;
  return { from, to };
}

/** How far his picture of player j is from the truth at a whole frame, m. */
export function beliefError(hero: Hero, run: Run, frame: number, j: number): number {
  const f = Math.min(run.frames - 1, Math.max(0, Math.round(frame)));
  const k = (f * hero.n + j) * 2;
  return Math.hypot(run.ghost[k] - run.pos[k], run.ghost[k + 1] - run.pos[k + 1]);
}

/** The ghost's strength from what the frame shows alone, before the fades let it go. */
function raw(hero: Hero, run: Run, frame: number, j: number, all: boolean): number {
  let window = 1;
  if (!all) {
    const w = ghostWindow(hero, run);
    if (!w || frame < w.from || frame > w.to) return 0;
    window = smooth((frame - w.from) / (GHOST_EASE_S / hero.dt));
  }
  const f0 = Math.floor(frame);
  const t = frame - f0;
  const err =
    beliefError(hero, run, f0, j) * (1 - t) + (t > 0 ? beliefError(hero, run, f0 + 1, j) * t : 0);
  return window * smooth((err - GHOST_FROM_M) / (GHOST_FULL_M - GHOST_FROM_M));
}

/**
 * How strongly player j's ghost shows at `frame` (fractional), 0 to 1. `all`: everyone's ghost at
 * any time, not only the runner's in the window. Never the hero's own.
 */
export function ghostAlpha(hero: Hero, run: Run, frame: number, j: number, all: boolean): number {
  if (j === hero.hero || hero.hero < 0) return 0;
  if (!all && j !== hero.runner) return 0;
  const ease = GHOST_EASE_S / hero.dt; // frames
  // What the last 0.15 s showed, let go linearly: a look that corrects his picture fades it out.
  let alpha = 0;
  for (let k = 0; k <= ease; k += HOLD_STEP) {
    const held = raw(hero, run, frame - k, j, all) * (1 - k / ease);
    if (held > alpha) alpha = held;
  }
  return alpha;
}

/** The label on the runner's ghost: on for its first GHOST_LABEL_S of the window, faded in and out. */
export function ghostLabelAlpha(hero: Hero, run: Run, frame: number): number {
  const w = ghostWindow(hero, run);
  if (!w) return 0;
  const ease = GHOST_EASE_S / hero.dt;
  const end = Math.min(w.to, w.from + GHOST_LABEL_S / hero.dt);
  return Math.min(smooth((frame - w.from) / ease), smooth((end - frame) / ease));
}
