// The other run's path tag on the tactical board (SPEC 7): it sits beside the end of the path,
// clear of the player tokens, and is dropped when the board is too small to carry it. Pitch
// metres: x along the pitch, y across it, y up on screen.

export const PATH_TAG_MIN_PITCH_PX = 320; // below this the tag would cover the board: no tag
export const PATH_TAG_GAP = 1.5; // m between the path end and the tag
const HALF_LENGTH = 52.5;
const HALF_WIDTH = 34;
const TAG_MIN_PX = 14; // at PATH_TAG_MIN_PITCH_PX
const TAG_MAX_PX = 24; // reached at 640 px of pitch
const TAG_GROWTH_PX = 32; // px of pitch per extra px of tag height

/** The tag's height, CSS px, on a board whose pitch is `pitchPx` long; null: no tag. */
export function pathTagPx(pitchPx: number): number | null {
  if (pitchPx < PATH_TAG_MIN_PITCH_PX) return null;
  return Math.min(TAG_MAX_PX, TAG_MIN_PX + (pitchPx - PATH_TAG_MIN_PITCH_PX) / TAG_GROWTH_PX);
}

/** Centre of a w x h tag near the path end, clear of every token if any candidate is. */
export function placePathTag(o: {
  end: readonly [number, number] | [number, number];
  w: number;
  h: number;
  tokens: ArrayLike<number>; // token centres, flat x, y pairs
  clearance: number; // m the tag keeps from each token centre
  prefer?: number; // the candidate chosen last time: kept while it is clear
}): { x: number; y: number; index: number } {
  const [ex, ey] = o.end;
  const halfW = o.w / 2;
  const halfH = o.h / 2;
  const clearSq = o.clearance * o.clearance;
  const tokens = o.tokens;
  const prefer = o.prefer ?? -1;
  let firstClear = -1;
  let fx = 0;
  let fy = 0;
  let bestHits = Infinity;
  let bx = 0;
  let by = 0;
  let bi = 0;
  let px = 0;
  let py = 0;
  let preferClear = false;
  for (let i = 0; i < 6; i++) {
    // Above, below, above-right, above-left, below-right, below-left.
    const sx = i < 2 ? 0 : i & 1 ? -1 : 1;
    const sy = i < 2 ? (i === 0 ? 1 : -1) : i < 4 ? 1 : -1;
    const rawX = ex + sx * (PATH_TAG_GAP + halfW);
    const rawY = ey + sy * (PATH_TAG_GAP + halfH);
    // Clamp so the whole tag stays on the pitch.
    const x = Math.min(Math.max(rawX, -HALF_LENGTH + halfW), HALF_LENGTH - halfW);
    const y = Math.min(Math.max(rawY, -HALF_WIDTH + halfH), HALF_WIDTH - halfH);
    let hits = 0;
    for (let k = 0; k + 1 < tokens.length; k += 2) {
      const dx = Math.max(Math.abs(tokens[k] - x) - halfW, 0);
      const dy = Math.max(Math.abs(tokens[k + 1] - y) - halfH, 0);
      if (dx * dx + dy * dy < clearSq) hits++;
    }
    if (hits === 0) {
      if (firstClear < 0) {
        firstClear = i;
        fx = x;
        fy = y;
      }
      if (i === prefer) {
        preferClear = true;
        px = x;
        py = y;
      }
    }
    if (hits < bestHits) {
      bestHits = hits;
      bi = i;
      bx = x;
      by = y;
    }
  }
  if (preferClear) return { x: px, y: py, index: prefer };
  if (firstClear >= 0) return { x: fx, y: fy, index: firstClear };
  return { x: bx, y: by, index: bi };
}
