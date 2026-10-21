// "Your call" (SPEC 7): the hero's picture at his decision, the only information the viewer gets
// before choosing. Everyone stands where he believed they were (the export's belief ghosts,
// SPEC 3.4); players he had not seen for a while are greyed. Their true positions are kept for
// the reveal's truth beat.

import type { Hero } from "../data/hero";
import type { Vec2 } from "../data/types";

/** A belief at least this old (s) at the decision is drawn greyed: "not seen lately". The sim's
 * belief spread is 0.3 m + 1 m per second of age (SPEC 3.5), so about 2 m from here on. */
export const STALE_S = 1.5;
/** A believed spot this far (m) from the truth moves in the truth beat, as the belief ghosts on
 * the board are drawn from this distance (TacticalView). */
export const OFF_M = 1.2;

export interface Pictured {
  j: number; // player index
  id: string;
  team: 0 | 1;
  number: number;
  believed: Vec2; // where he believed this player was (himself: where he is)
  truth: Vec2;
  stale: boolean;
  off: boolean; // the believed spot is at least OFF_M from the truth
}

export interface Picture {
  frame: number; // the decision
  carrier: number; // index of the hero in `players` (= his player index)
  players: Pictured[];
  ball: Vec2;
}

export function pictureOf(hero: Hero): Picture | null {
  const run = hero.runs.factual;
  const d = run.decision;
  if (!d || hero.hero < 0) return null;
  const f = d.frame;
  const n = hero.n;
  const players = hero.players.map((p, j): Pictured => {
    const k = (f * n + j) * 2;
    const truth: Vec2 = [run.pos[k], run.pos[k + 1]];
    const me = j === hero.hero;
    const believed: Vec2 = me ? truth : [run.ghost[k], run.ghost[k + 1]];
    return {
      j,
      id: p.id,
      team: p.team,
      number: p.number,
      believed,
      truth,
      stale: !me && (d.belief_age[p.id] ?? 0) >= STALE_S,
      off: !me && Math.hypot(believed[0] - truth[0], believed[1] - truth[1]) >= OFF_M,
    };
  });
  return { frame: f, carrier: hero.hero, players, ball: [run.ball[2 * f], run.ball[2 * f + 1]] };
}
