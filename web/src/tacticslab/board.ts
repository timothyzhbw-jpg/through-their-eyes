// Geometry of the lab's lane board (SPEC 7): a pitch from above in SVG, 105 x 68 m with the origin
// at the centre spot as everywhere else, pitch +y drawn up (so SVG y is the pitch's y negated).

import type { Hero, Run } from "../data/hero";
import type { Lane } from "./lanes";

export const VIEW_BOX = "-57 -37.5 114 75";

export type PitchLine =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

/** Outline, penalty areas, six-yard boxes and the centre circle (Law 1). */
export const PITCH_LINES: readonly PitchLine[] = [
  { kind: "rect", x: -52.5, y: -34, w: 105, h: 68 },
  { kind: "circle", cx: 0, cy: 0, r: 9.15 },
  ...[-1, 1].flatMap((s): PitchLine[] => [
    { kind: "rect", x: s < 0 ? -52.5 : 52.5 - 16.5, y: -20.15, w: 16.5, h: 40.3 },
    { kind: "rect", x: s < 0 ? -52.5 : 52.5 - 5.5, y: -9.16, w: 5.5, h: 18.32 },
  ]),
];

export interface BoardPlayer {
  id: string;
  x: number;
  y: number; // SVG y
  team: number;
  number: number;
  carrier: boolean;
}

/** Every player where the run has him at its decision frame. */
export function boardPlayers(hero: Hero, run: Run): BoardPlayer[] {
  const d = run.decision;
  if (!d) return [];
  return hero.players.map((p, j) => ({
    id: p.id,
    x: run.pos[(d.frame * hero.n + j) * 2],
    y: -run.pos[(d.frame * hero.n + j) * 2 + 1],
    team: p.team,
    number: p.number,
    carrier: p.id === d.player,
  }));
}

/** A lane's end points and midpoint in SVG coordinates; the line stops short of the receiver. */
export function laneEnds(lane: Lane): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
} {
  const [x1, y1] = [lane.from[0], -lane.from[1]];
  const [tx, ty] = [lane.to[0], -lane.to[1]];
  const len = Math.hypot(tx - x1, ty - y1);
  const stop = len > 3 ? (len - 1.6) / len : 1; // keep the arrow off the receiver's token
  const [x2, y2] = [x1 + (tx - x1) * stop, y1 + (ty - y1) * stop];
  return { x1, y1, x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}
