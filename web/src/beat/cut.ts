// Camera switches are clean cuts (SPEC 7; Bowen, 2026-10-21: no blur when the camera switches).
// Switching between his eyes and the broadcast camera, to the tactical board and back, and the
// director's cuts change the picture at once: no camera move between the cameras and no morph.
// For CUT_GUARD_S after a cut, and for at least its first CUT_GUARD_FRAMES frames, no blur pass
// runs (the first-person head-whip blur, depth of field); then blur eases back over CUT_RAMP_S,
// so a cut never lands on, or pops into, a blurred frame. The frames count where frames are slow
// (a software renderer, a struggling phone): there one frame can outlast the whole time guard.

export const CUT_GUARD_S = 0.3;
export const CUT_RAMP_S = 0.25;
export const CUT_GUARD_FRAMES = 4;

/** What the 3D view shows: its camera and which view is in front. */
export const viewKey = (s: { camera: string; focus: string }) => `${s.camera}|${s.focus}`;

/** Remembers the view drawn last; a change of view is a cut. */
export class CutWatch {
  private last: string | null = null;
  private at = -Infinity;
  private frames = Infinity; // frames drawn since the cut, the cut's own frame being 0

  /** Note the frame drawn at wall time `now` (s) and its view. */
  note(view: string, now: number): void {
    if (this.last !== null && view !== this.last) {
      this.at = now;
      this.frames = 0;
    } else this.frames += 1;
    this.last = view;
  }

  /** How much of a blur pass may show at `now`: 0 around a cut, easing back to 1 after it. */
  blurScale(now: number): number {
    if (this.frames < CUT_GUARD_FRAMES) return 0;
    const t = (now - this.at - CUT_GUARD_S) / CUT_RAMP_S;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  inCut(now: number): boolean {
    return this.blurScale(now) < 1;
  }
}

/** The page's 3D view (one canvas films both cameras). */
export const cuts = new CutWatch();
