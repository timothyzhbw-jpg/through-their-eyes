// Which of the director's suggestions is on screen, and when the auto director cuts.
//
// The chip shows the best suggestion, unless the viewer is already on its camera: then the
// director holds that shot and shows nothing below it. A suggestion on screen stays until it ends
// or a higher one comes; a new one that would come too late (the ball under LEAD_S away) is not
// shown. The auto director cuts to the best camera suggestion, at most once per MIN_SHOT_S of wall
// clock, never while the player whose eyes are on screen is in the middle of a scan, and never
// starts a breakdown or a replay.

import type { PlaybackState } from "../store/playback";
import { LEAD_S, MIN_SHOT_S, type Shot, type Suggestion } from "./rules";

/** The part of the playback state that says which camera is on screen. */
export type ViewShot = Pick<PlaybackState, "camera" | "povPlayer" | "focus">;

const EPS = 1e-9;

/** The viewer is already watching `shot`. A focused tactical board puts the 3D view aside. */
export function satisfied(shot: Shot, v: ViewShot): boolean {
  if (shot.camera === "tactical") return v.focus === "tactical";
  if (v.focus === "tactical" || v.camera !== shot.camera) return false;
  return shot.camera === "broadcast" || v.povPlayer === shot.player;
}

/** The playback change that cuts to `shot`: a focused 3D view stays focused, the board's focus
 * goes back to the two views side by side. */
export function shotPatch(shot: Shot, v: ViewShot): Partial<ViewShot> {
  if (shot.camera === "tactical") return { focus: "tactical" };
  const focus = v.focus === "tactical" || v.focus === "split" ? "split" : shot.camera;
  return shot.camera === "pov"
    ? { camera: "pov", povPlayer: shot.player, focus }
    : { camera: "broadcast", focus };
}

/** Too late to matter: the ball arrives in under LEAD_S (match time, so 1x speed). */
export function late(s: Suggestion, f: number, dt: number): boolean {
  return s.arrival !== null && (s.arrival - f) * dt < LEAD_S - EPS;
}

/** Highest priority first; among equals the one on screen, then the higher rank, then by id. */
function ranked(cands: Suggestion[], current: string | null, dismissed: ReadonlySet<string>) {
  return cands
    .filter((c) => !dismissed.has(c.id))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        Number(b.id === current) - Number(a.id === current) ||
        b.rank - a.rank ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

export const LINGER_S = 0.4; // a chip that just ended stays this long when nothing follows

/**
 * The chip, with a short linger: when the suggestion on screen ends and nothing takes its place
 * (none at all, not one held because the viewer is on its camera), it stays until `LINGER_S`
 * after it ended, so the strip does not blink between suggestions that follow each other.
 * `ended` is the frame the previous chip ended at (null while it holds).
 */
export function linger(
  p: Picked,
  previous: Suggestion | null,
  ended: number | null,
  f: number,
  dt: number,
): Suggestion | null {
  if (p.show || p.top || !previous || ended === null) return p.show;
  return f >= ended && f < ended + Math.round(LINGER_S / dt) ? previous : null;
}

export interface Picked {
  top: Suggestion | null; // the best suggestion, shown or held
  show: Suggestion | null; // the chip; null while the viewer is on the best camera already
}

/**
 * The chip at frame `f`. `current` is the top suggestion of the previous frame: it is kept
 * against equals, and it may stay on screen inside LEAD_S of the ball (it came in time).
 */
export function pick(
  cands: Suggestion[],
  f: number,
  view: ViewShot,
  current: string | null,
  dismissed: ReadonlySet<string>,
  dt: number,
): Picked {
  for (const c of ranked(cands, current, dismissed)) {
    if (c.shot && satisfied(c.shot, view)) return { top: c, show: null };
    if (c.id !== current && late(c, f, dt)) continue;
    return { top: c, show: c };
  }
  return { top: null, show: null };
}

/** The camera the auto director wants: the best camera suggestion; null to hold the shot. */
export function autoTarget(
  cands: Suggestion[],
  view: ViewShot,
  dismissed: ReadonlySet<string>,
): Suggestion | null {
  const best = ranked(
    cands.filter((c) => c.auto && c.shot),
    null,
    dismissed,
  )[0];
  return best && !satisfied(best.shot!, view) ? best : null;
}

/** The auto director's cuts: a minimum shot length on the wall clock, never mid-scan. */
export class AutoCutter {
  private shotStart = -Infinity; // wall-clock s of the last cut, the director's or the viewer's

  constructor(private readonly minShot = MIN_SHOT_S) {}

  /** The viewer cut (a camera control, or a suggestion taken): the shot starts now. */
  viewerCut(now: number): void {
    this.shotStart = now;
  }

  /** Let the next cut come at once (the auto director was just turned on). */
  reset(): void {
    this.shotStart = -Infinity;
  }

  /**
   * The shot to cut to now, or null. `scanning(player)`: that player is in the middle of a scan
   * at frame `f`; the shot on screen is not left while its player is.
   */
  decide(
    target: Suggestion | null,
    f: number,
    dt: number,
    now: number,
    view: ViewShot,
    scanning: (player: string) => boolean,
  ): Shot | null {
    if (!target?.shot || late(target, f, dt)) return null;
    if (now - this.shotStart < this.minShot - EPS) return null;
    const onEyes = view.camera === "pov" && view.focus !== "tactical";
    if (onEyes && scanning(view.povPlayer)) return null;
    this.shotStart = now;
    return target.shot;
  }
}
