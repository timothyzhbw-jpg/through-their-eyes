// Pass lanes at a decision (SPEC 7), from the pass options the options module already has: each
// option's chance of arriving on the true state (`pTrue`, "it was") says whether the lane was open
// when he chose. Nothing here is new data: it sorts `passOptions` into open and blocked lanes, and
// reads the pressure on the receiver off the tracking at the decision frame.

import type { Hero, Run } from "../data/hero";
import type { Vec2 } from "../data/types";
import { passOptions, type PassOption } from "../options/passOptions";

/** A lane is open when the pass would have arrived at least this often on the true state. */
export const OPEN_P = 0.6;

export type LaneState = "open" | "blocked";

export interface Lane {
  action: string;
  label: string;
  receiver: string;
  from: Vec2; // the carrier at the decision
  to: Vec2; // where it would have gone on the true state (his believed target if unplayable)
  state: LaneState;
  playable: boolean; // false: the sim found no pass to that player on the true state
  pBelief: number; // P(arrives) as he saw it
  pTrue: number | null; // P(arrives) as it was
  misread: boolean; // he saw it open and it was blocked, or the reverse
  chosen: boolean;
  pressure: number | null; // m, the nearest opponent to the receiver at the decision frame
}

/** Nearest opponent of `playerId` at `frame`, m; null when the player is not in the run. */
export function nearestOpponent(
  hero: Hero,
  run: Run,
  playerId: string,
  frame: number,
): number | null {
  const j = hero.ids.indexOf(playerId);
  if (j < 0) return null;
  const team = hero.players[j].team;
  const f = Math.max(0, Math.min(run.frames - 1, Math.round(frame)));
  let best = Infinity;
  for (let k = 0; k < hero.n; k++) {
    if (hero.players[k].team === team) continue;
    const d = Math.hypot(
      run.pos[(f * hero.n + k) * 2] - run.pos[(f * hero.n + j) * 2],
      run.pos[(f * hero.n + k) * 2 + 1] - run.pos[(f * hero.n + j) * 2 + 1],
    );
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

export function laneOf(hero: Hero, run: Run, o: PassOption, frame: number): Lane | null {
  if (o.kind !== "pass" || !o.receiver) return null;
  const playable = o.pTrue !== null;
  const open = playable && (o.pTrue as number) >= OPEN_P;
  return {
    action: o.action,
    label: o.label,
    receiver: o.receiver,
    from: o.from,
    to: o.targetTrue ?? o.target,
    state: open ? "open" : "blocked",
    playable,
    pBelief: o.pBelief,
    pTrue: o.pTrue,
    misread: o.pBelief >= OPEN_P !== open,
    chosen: o.chosen,
    pressure: nearestOpponent(hero, run, o.receiver, frame),
  };
}

/** The pass lanes of the run's decision, best chance of being picked first; empty without one. */
export function lanesAt(hero: Hero, run: Run): Lane[] {
  const d = run.decision;
  if (!d) return [];
  return passOptions(hero, run)
    .map((o) => laneOf(hero, run, o, d.frame))
    .filter((l): l is Lane => l !== null);
}

export function laneCounts(lanes: readonly Lane[]): { open: number; blocked: number } {
  const open = lanes.filter((l) => l.state === "open").length;
  return { open, blocked: lanes.length - open };
}
