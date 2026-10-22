// The ball as the rigged players kick it (SPEC 7): the sim's ball, moved onto the kicking foot
// from the kicker's turn until just after the contact (gait.ts, rig.ts kickBall). The rigged
// players register the offset while they are drawn; the 3D views' ball adds it. The tactical
// board, the tokens and every number keep the sim's ball.

import type { RunName } from "../data/types";

export type KickBallOffset = (
  mode: RunName,
  frame: number,
  out: [number, number],
) => [number, number];

let current: KickBallOffset | null = null;

export function setKickBall(offset: KickBallOffset): void {
  current = offset;
}

/** Unregister `offset`, unless another set of rigged players has registered since. */
export function clearKickBall(offset: KickBallOffset): void {
  if (current === offset) current = null;
}

const none: [number, number] = [0, 0];
const scratch: [number, number] = [0, 0];

/** The ball's offset (m, pitch) at a playback frame: zero without rigged players. */
export function kickBallOffset(mode: RunName, frame: number): [number, number] {
  return current ? current(mode, frame, scratch) : none;
}
