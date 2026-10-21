// A stitched match (SPEC 3.1, sim/match.py): scenario possessions back to back on one clock. The
// export carries the possessions (where each starts, how play restarted, the score before it)
// and every possession's moments lifted to match time; a hero moment keeps the id it has inside
// its possession (`local_id`), because breakdowns and counterfactuals run on the possession's own
// run, in local frames: local frame + the possession's `start` = match frame.

import type { Hero } from "../data/hero";
import type { ExportMatchMoment, ExportPossession, ExportScore, MatchExport } from "../data/types";

export type Possession = ExportPossession;
export type MatchMoment = ExportMatchMoment;

export interface MatchInfo {
  durationS: number;
  score: ExportScore; // at the final whistle
  possessions: Possession[]; // in match order
  moments: MatchMoment[]; // every possession's moments, in match time and anchor order
}

export function parseMatch(raw: MatchExport): MatchInfo {
  const possessions = [...raw.match.possessions].sort((a, b) => a.start - b.start);
  if (!possessions.length) throw new Error("a match export without possessions");
  return {
    durationS: raw.match.duration_s,
    score: raw.match.score,
    possessions,
    moments: [...raw.moments].sort((a, b) => a.anchor_frame - b.anchor_frame),
  };
}

/** The possession on screen at (fractional) match frame `f`. */
export function possessionAt(match: MatchInfo, f: number): Possession {
  let at = match.possessions[0];
  for (const p of match.possessions) if (p.start <= f) at = p;
  return at;
}

/** The score at match frame `f`: before the possession, plus its goals up to `f` (sim `goal`
 * events, credited to the scorer's team). */
export function scoreAt(hero: Hero, f: number): ExportScore {
  if (!hero.match) return { home: 0, away: 0 };
  const p = possessionAt(hero.match, f);
  const score = { ...p.score_before };
  for (const e of hero.runs.factual.events) {
    if (e.type !== "goal" || e.possession !== p.index || e.frame > f) continue;
    const team = hero.players[hero.ids.indexOf(e.player)]?.team;
    if (team === 0) score.home += 1;
    else if (team === 1) score.away += 1;
  }
  return score;
}

/** The API's id of a possession's scenario run, which serves its hero export (api/settings.py). */
export const scenarioMatchId = (p: Pick<Possession, "scenario" | "seed">) =>
  `${p.scenario}-${p.seed}`;

export const SCENARIO_LABEL: Record<string, string> = {
  possession_play: "Open play",
  blind_side_run: "The blind-side run",
  press_escape: "Escaping the press",
  corner_blind_side: "The short corner",
};

export const RESTART_LABEL: Record<string, string> = {
  kick_off: "Kick-off",
  throw_in: "Throw-in",
  goal_kick: "Goal kick",
  corner: "Corner",
  cut: "In play", // the possession ended in play: the broadcast cuts to the next passage
};

export const scenarioLabel = (s: string) => SCENARIO_LABEL[s] ?? s.replaceAll("_", " ");
export const restartLabel = (r: string) => RESTART_LABEL[r] ?? r.replaceAll("_", " ");
