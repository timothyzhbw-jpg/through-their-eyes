// Blind-side alerts (SPEC 4.4, 7): an observer has lost sight of a player on the move. Computed
// per frame from tracking only (observed head yaw and positions) by analytics/blind_side.py and
// exported with how long each target has gone unseen. A live, deterministic overlay: its numbers
// are marked `sim` (from the export), not claims.

import type { Hero, Run } from "../data/hero";

export const ALERT_COLOR = "#ff6b9a";

export interface ActiveAlert {
  observer: number;
  target: number;
  unseen: number; // seconds since the observer last saw the target
}

/**
 * Alerts to show at a (fractional) frame. The module may hold an alert on for its minimum
 * duration after the target is back in sight; on screen it clears the moment he is seen (SPEC 7).
 */
export function alertsAt(hero: Hero, run: Run, frame: number): ActiveAlert[] {
  const f = Math.max(0, Math.min(run.frames - 1, Math.floor(frame)));
  return run.blindSide.frames[f]
    .filter(([, , unseen]) => unseen > 0)
    .map(([observer, target, unseen]) => ({ observer, target, unseen: unseen * hero.dt }));
}

export function alertOn(hero: Hero, run: Run, frame: number, observer: string, target: string) {
  const o = hero.ids.indexOf(observer);
  const t = hero.ids.indexOf(target);
  return alertsAt(hero, run, frame).some((a) => a.observer === o && a.target === t);
}

export function unseenLabel(seconds: number): string {
  return `unseen ${seconds.toFixed(1)} s`;
}

/** Pulse scale for a target ring, 1 to 1.45, two beats a second. */
export function pulse(timeS: number): number {
  return 1 + 0.45 * (0.5 + 0.5 * Math.sin(timeS * 4 * Math.PI));
}
