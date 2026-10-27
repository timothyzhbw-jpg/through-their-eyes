// The moves a hero moment tells, read from its two runs' actions (no new export field).

import type { Hero } from "../data/hero";
import type { ExportAction, Vec2 } from "../data/types";
import type { Team, XtGrid } from "../tacticslab/metrics";
import { moveOf, type Move } from "./zones";

export const heroTeam = (hero: Hero): Team =>
  hero.players.find((p) => p.id === hero.heroId)?.team === 1 ? 1 : 0;

/** A completed pass or carry's two ends: where it was kicked and where it was received. */
function ends(a: ExportAction | null | undefined): { from: Vec2; to: Vec2 } | null {
  return a && a.end_at && a.outcome === "complete" ? { from: a.start, to: a.end_at } : null;
}

/**
 * His pass and, in the run without the look, the pass he would have made, each from where it was
 * kicked to where it was received. `xt` and `cfXt`: the verified pass_zones claim's values at the
 * two ends, used where the line on screen shows them.
 */
export function passMoves(
  hero: Hero,
  grid: XtGrid,
  claim: { xt?: number | null; cfXt?: number | null } = {},
): Move[] {
  const team = heroTeam(hero);
  const mine = ends(hero.runs.factual.action);
  const other = ends(hero.runs.counterfactual.action);
  const out: Move[] = [];
  if (mine) {
    out.push(moveOf({ mode: "pass", team, ...mine, grid, toXt: claim.xt, label: "His pass" }));
  }
  if (other) {
    out.push(
      moveOf({
        mode: "pass",
        team,
        ...other,
        grid,
        toXt: claim.cfXt,
        label: "Without the scan",
      }),
    );
  }
  return out;
}

/**
 * What cf_value says, zone by zone: where the ball ended without the look and with it, and the
 * claim's difference (signed: a look's worth). Nothing when either run's pass was not received.
 */
export function lookWorthMove(hero: Hero, dxt: number): Move[] {
  const mine = ends(hero.runs.factual.action);
  const other = ends(hero.runs.counterfactual.action);
  if (!mine || !other) return [];
  return [
    moveOf({
      mode: "runs",
      team: heroTeam(hero),
      from: other.to,
      to: mine.to,
      delta: dxt,
      deltaDigits: 2,
    }),
  ];
}
