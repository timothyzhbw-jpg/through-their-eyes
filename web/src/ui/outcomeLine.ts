// The causal comparison in one line, beside the run switch: what the hero did with the look and
// what he did without it, named from the two runs' decisions. Words come from here, every digit
// is a shirt number from the export. A moment with no decision in both runs (a keeper's step, a
// marker's look), a forced action instead of a dropped look, or the same choice in both runs has
// nothing to compare, so no line.

import { shotPost, type Hero } from "../data/hero";
import { shortName } from "../data/roster";

export interface OutcomeLine {
  withLook: string; // "passes to #9 N. Varnhall"
  without: string;
}

/** "#9 N. Varnhall": the shirt number from the export, then his short name. */
function player(hero: Hero, id: string): string {
  const found = hero.players.find((p) => p.id === id);
  return found ? `#${found.number} ${shortName(id)}` : shortName(id);
}

/** One decision as a phrase: "passes to #9 N. Varnhall", "carries it", "shoots at the far post". */
export function actionPhrase(hero: Hero, action: string): string {
  if (action.startsWith("pass:")) return `passes to ${player(hero, action.slice(5))}`;
  if (action === "carry") return "carries it";
  if (action === "shot") return "shoots";
  const post = shotPost(action);
  if (post) return `shoots at the ${post} post`;
  return action;
}

export function outcomeLine(hero: Hero): OutcomeLine | null {
  if (hero.kind !== "hero" || hero.counterfactual?.intervention !== "drop_scan") return null;
  const factual = hero.runs.factual.decision?.chosen;
  const counterfactual = hero.runs.counterfactual.decision?.chosen;
  if (!factual || !counterfactual || factual === counterfactual) return null;
  return {
    withLook: actionPhrase(hero, factual),
    without: actionPhrase(hero, counterfactual),
  };
}
