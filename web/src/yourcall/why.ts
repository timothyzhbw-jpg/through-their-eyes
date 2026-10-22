// "Your call" (SPEC 7): why the call went as it did, told right after the viewer picks. Two parts
// read straight from the sim export, so they carry no number (a count or a time would need a
// verified claim behind it, and these have none): what he could see, his teammates fresh in his
// picture at the decision and those he had not seen lately (the scan data: how long since he last
// saw each one, `belief_age`), and how his picture rated the viewer's call against his own (the
// decision record: each option's chance on his belief, sorted highest first). What the call led
// to comes from the verified lines, as before (reveal.ts).

import type { Hero } from "../data/hero";
import { isShot, shotPost } from "../data/hero";
import { shortName } from "../data/roster";
import type { CallOption } from "./options";
import { STALE_S } from "./picture";

export interface Why {
  seen: string[]; // teammates fresh in his picture at the decision (ids), as the markers sit
  unseen: string[]; // teammates he had not seen lately (grey on the pitch)
  receiver: { id: string; seen: boolean } | null; // the call's receiver, for a pass
  picture: string; // how his picture rated the call: one sentence, no digits
}

/** An action as a phrase inside a sentence: "the pass to N. Varnhall", "carrying it". */
export function actionPhrase(action: string): string {
  if (action.startsWith("pass:")) return `the pass to ${shortName(action.slice(5))}`;
  if (action === "carry") return "carrying it";
  const post = shotPost(action);
  if (post) return `the shot at the ${post} post`;
  if (isShot(action)) return "the shot";
  return action;
}

const CHANCE = "The sim's players choose with some chance, as people do.";

/** Why the call `pick` went as it did, from his picture; null without a decision. */
export function whyOf(hero: Hero, options: CallOption[], pick: string): Why | null {
  const d = hero.runs.factual.decision;
  if (!d || hero.hero < 0) return null;
  const team = hero.players[hero.hero].team;
  const fresh = (id: string) => (d.belief_age[id] ?? Infinity) < STALE_S;
  // Teammates in the order the markers sit, then any without a marker (none, usually).
  const order = options.map((o) => o.receiver).filter((r): r is string => r !== null);
  const mates = hero.players
    .filter((p, j) => p.team === team && j !== hero.hero)
    .map((p) => p.id)
    .sort((a, b) => rank(order, a) - rank(order, b));
  const chance = new Map(d.options.map((o) => [o.action, o.prob]));
  const top = d.options[0]?.action ?? d.chosen;
  const p = chance.get(pick) ?? 0;
  const h = chance.get(d.chosen) ?? 0;
  const his = actionPhrase(d.chosen);
  let picture: string;
  if (pick === d.chosen) {
    picture =
      pick === top
        ? "On his picture this was the most promising option, so it was his call."
        : `On his picture ${actionPhrase(top)} looked more promising, yet he went for this one. ${CHANCE}`;
  } else if (h >= p) {
    picture = `On his picture ${his} looked more promising than your call, so that was his choice.`;
  } else {
    picture = `On his picture your call looked more promising than ${his}, yet he went for ${his}. ${CHANCE}`;
  }
  const receiver = pick.startsWith("pass:") ? pick.slice(5) : null;
  return {
    seen: mates.filter(fresh),
    unseen: mates.filter((id) => !fresh(id)),
    receiver: receiver ? { id: receiver, seen: fresh(receiver) } : null,
    picture,
  };
}

const rank = (order: string[], id: string) => {
  const k = order.indexOf(id);
  return k < 0 ? order.length : k;
};
