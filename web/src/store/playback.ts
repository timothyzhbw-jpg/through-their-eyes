// Playback state: everything the views need to know about "what is on screen now".
// Views only read it. User controls and the TelestrationPlan executor are the only writers.

import { easedHeadAt, wrapAngle, type Hero } from "../data/hero";
import type { RunName } from "../data/types";
import { createStore, type Store } from "./store";

export type Focus = "split" | "pov" | "tactical";

export interface PlaybackState {
  mode: RunName; // factual = with the look, counterfactual = without it
  frame: number; // fractional frame, so slow motion is smooth
  playing: boolean;
  speed: number; // playback rate chosen by the user (or a plan step)
  autoSlow: boolean; // free play slows down around scans; plans set their own speed
  playUntil: number | null; // stop at this frame (plan segments)
  povPlayer: string; // whose eyes the first-person view uses; also owns the vision cone
  comfort: boolean; // eased POV yaw + slower playback while the head whips round (SPEC 7)
  cone: boolean;
  beliefGhosts: boolean;
  cfGhost: boolean; // ghost path of the other run
  options: boolean; // pass options at the decision (shown around the decision frame only)
  focus: Focus; // which view gets the space
  scanMarker: string | null; // scan id highlighted by a plan
  captionLine: string | null; // id of the narration line on screen (a plan voice step)
  evidenceLine: string | null; // narration line whose claims and evidence are open
}

export type PlaybackStore = Store<PlaybackState>;

export const KEY_SCAN_SLOW = 0.4; // free-play slow motion around the key scan, as in demo/
export const COMFORT_MAX_YAW = (120 * Math.PI) / 180; // rad per wall-clock second, on screen

export function createPlayback(hero: Hero): PlaybackStore {
  return createStore<PlaybackState>({
    mode: "factual",
    frame: hero.keyScan.start + 6,
    playing: false,
    speed: 1,
    autoSlow: true,
    playUntil: null,
    povPlayer: hero.heroId,
    comfort: false,
    cone: true,
    beliefGhosts: true,
    cfGhost: false,
    options: true,
    focus: "split",
    scanMarker: null,
    captionLine: null,
    evidenceLine: null,
  });
}

/**
 * Frames to advance in one wall-clock step of `dtWall` seconds. Free play slows down around the
 * key scan. Comfort mode also shortens the step so the POV head turns at most COMFORT_MAX_YAW
 * on screen: playback slows while the head whips round, and every frame is still shown.
 */
export function frameStep(hero: Hero, s: PlaybackState, dtWall: number): number {
  const key = hero.keyScan;
  const nearKey = s.frame >= key.start - 4 && s.frame <= key.end + 4;
  const free = s.autoSlow && nearKey ? KEY_SCAN_SLOW : 1;
  const step = (dtWall / hero.dt) * s.speed * free;
  if (!s.comfort || step <= 0) return step;
  const run = hero.runs[s.mode];
  const j = hero.ids.indexOf(s.povPlayer);
  const limit = COMFORT_MAX_YAW * dtWall;
  const from = easedHeadAt(hero, run, j, s.frame);
  const turn = (x: number) => Math.abs(wrapAngle(easedHeadAt(hero, run, j, s.frame + x) - from));
  if (turn(step) <= limit) return step;
  // Bisection: the largest step whose head turn stays within the limit (turn(0) = 0).
  let ok = 0;
  let tooFar = step;
  for (let k = 0; k < 16; k++) {
    const mid = (ok + tooFar) / 2;
    if (turn(mid) <= limit) ok = mid;
    else tooFar = mid;
  }
  return ok;
}

/** Move the playhead by one wall-clock step. Called once per animation frame. */
export function advance(store: PlaybackStore, hero: Hero, dtWall: number): void {
  const s = store.get();
  if (!s.playing) return;
  const run = hero.runs[s.mode];
  const stop = Math.min(run.frames - 1, s.playUntil ?? Infinity);
  const next = s.frame + frameStep(hero, s, dtWall);
  if (next >= stop) store.set({ frame: stop, playing: false, playUntil: null });
  else store.set({ frame: next });
}
