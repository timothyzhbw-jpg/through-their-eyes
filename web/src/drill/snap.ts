// Academy drill (SPEC 7): the viewer turns the hero's head live, and the look it makes becomes one
// cell of the look grid that was re-simulated ahead of time (takeeyes/looks.ts, sim.export
// export_looks). The live turn is bound by the sim's scan physics; the grid holds the results.
//
// A turn has a start (the frame the head began to leave the ball) and a peak (the widest angle
// from the ball it reached, + to his left). It is a look once the peak passes half the shortest
// scan; the peak is then clamped into the scan range and snapped to the nearest grid direction on
// its side, and the start to the nearest grid time. Nothing is re-simulated here.

/** The sim's scan amplitude (sim/config.py `scan_amplitude`): a scan turns 70–150° from the ball. */
export const SCAN_MIN_DEG = 70;
export const SCAN_MAX_DEG = 150;
/** A turn that never got halfway to the shortest scan is no look at all (a slip of the finger). */
export const NO_LOOK_DEG = SCAN_MIN_DEG / 2;
/** The live head turns no faster than the sim's mean peak scan speed, 404 ± 51°/s (SPEC 3.4), in
 * match time: a flick of the finger is a scan, not a cut. */
export const HEAD_SPEED_DEG_S = 404;

/** The grid's shape, as the look file has it (raw or parsed). */
export interface Grid {
  frames: number[]; // look start frames, ascending
  offsets: number[]; // directions, degrees from the ball, + to his left
  cells: { frame: number; offset: number; unavailable: string | null }[];
}

/** A look in progress or done: its first frame and its widest angle from the ball (signed). */
export interface Turn {
  start: number;
  peak: number;
}

export const clampHead = (deg: number): number =>
  Math.max(-SCAN_MAX_DEG, Math.min(SCAN_MAX_DEG, deg));

/** The look a turn's peak makes, clamped into the scan range; null when it is too small. */
export function lookAngle(peak: number): number | null {
  const size = Math.abs(peak);
  if (size < NO_LOOK_DEG) return null;
  return Math.sign(peak) * Math.min(SCAN_MAX_DEG, Math.max(SCAN_MIN_DEG, size));
}

/** One step of the head toward where the viewer turns it, at most `maxStep` degrees. */
export function chase(head: number, target: number, maxStep: number): number {
  const gap = target - head;
  return Math.abs(gap) <= maxStep ? target : head + Math.sign(gap) * maxStep;
}

/** The grid direction nearest to `deg` on its side; a tie goes to the wider look. */
export function snapDirection(grid: Pick<Grid, "offsets">, deg: number): number {
  const side = grid.offsets.filter((o) => Math.sign(o) === Math.sign(deg));
  return side.reduce((best, o) => {
    const d = Math.abs(o - deg) - Math.abs(best - deg);
    return d < -1e-9 || (Math.abs(d) <= 1e-9 && Math.abs(o) > Math.abs(best)) ? o : best;
  });
}

/** The grid time nearest to `frame`; a tie goes to the earlier time. */
function nearestFrames(grid: Pick<Grid, "frames">, frame: number): number[] {
  return [...grid.frames].sort((a, b) => Math.abs(a - frame) - Math.abs(b - frame) || a - b);
}

/**
 * The grid cell a turn becomes: the nearest time to its start and the nearest direction to its
 * clamped peak. A cell where no look can start (a scan under way) gives way to the nearest time
 * that can, in the same direction. Null: no look (too small, or nowhere to start).
 */
export function snapTurn(grid: Grid, turn: Turn): { frame: number; offset: number } | null {
  const angle = lookAngle(turn.peak);
  if (angle === null) return null;
  const offset = snapDirection(grid, angle);
  for (const frame of nearestFrames(grid, turn.start)) {
    const cell = grid.cells.find((c) => c.frame === frame && c.offset === offset);
    if (cell && cell.unavailable === null) return { frame, offset };
  }
  return null;
}

/** Seconds until the ball reaches him, in tenths (the tenth not yet reached), 0 from then on. */
export function countdown(reception: number, frame: number, dt: number): number {
  const left = (reception - frame) * dt;
  return left <= 0 ? 0 : Math.ceil(left * 10 - 1e-6) / 10;
}
