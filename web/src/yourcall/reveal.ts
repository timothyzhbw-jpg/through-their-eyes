// "Your call" (SPEC 7): what each beat of the reveal says. Every number on screen comes from a
// verified line: the precomputed what-if answer of the viewer's call (counterfactual claims,
// checked by the verifier, SPEC 6), or a line of the breakdown's narration (SPEC 5.3). The rest
// is labels without numbers. Lines are sorted into the beats by their claims:
// - outcome: what the call led to (the what-if's outcome; for his own call, the narration line
//   about how his action ended; for the export's forced action, its counterfactual line);
// - truth: claims measured at or before his decision, whatever he chose (his picture's error,
//   "he thought / it was", pressure, space);
// - actual: the rest of the narration: what he did and why;
// - compare: the value of the call against what he did.

import type { Hero } from "../data/hero";
import { lineKinds, type ClaimKind, type Narration, type PayloadLine } from "../narration/payload";
import { optionOf, type Language, type WhatIfs } from "../whatif/whatif";
import type { CallOption } from "./options";
import { pictureOf } from "./picture";

/** Claims (explain/builders.py ids) measured at or before his decision: the truth beat.
 * `blind_side` is measured before it and stays; `receiver_pressure` is measured when his pass
 * reaches the receiver (anchor = the completion), so it is about what he did, not the decision. */
export const TRUTH_CLAIMS: ReadonlySet<string> = new Set([
  "belief_error",
  "pass_success",
  "unmarked",
  "gap_to_nearest_opponent",
  "gap_to_marker",
  "blind_side",
  "pressure_at_pass",
  "heavy_pressure",
  "presser_distance",
]);
const WHATIF_VALUE = "whatif_value"; // agents/whatif.py: the call's value against his
const CF_OUTCOME: ReadonlySet<string> = new Set(["cf_carry_lost", "cf_pass"]);
const CF_VALUE = "cf_value";

export interface RevealLine {
  id: string;
  text: string;
  kinds: ClaimKind[];
  claims: string[];
  source: "verified" | "fixture"; // fixture: the bundled offline payload, no verifier ran
}

export interface Reveal {
  pick: CallOption;
  his: CallOption;
  same: boolean; // the viewer made his call
  outcome: { title: string; lines: RevealLine[] };
  truth: { title: string; lines: RevealLine[]; moved: string[] }; // moved: not where he pictured
  actual: { title: string; lines: RevealLine[] };
  compare: { yours: string; his: string; lines: RevealLine[] };
}

export interface RevealInput {
  hero: Hero;
  options: CallOption[];
  whatIfs: WhatIfs | null;
  narration: Narration | null; // the breakdown on screen; null until it arrives
  language: Language;
  pick: string;
}

function linesOf(narration: Narration, lines: PayloadLine[], verified: boolean): RevealLine[] {
  return lines
    .filter((l) => l.claims.length > 0) // connective phrases say nothing here
    .map((l) => ({
      id: l.id,
      text: l.text,
      kinds: lineKinds(narration, l),
      claims: l.claims,
      source: verified && !narration.fixture ? "verified" : "fixture",
    }));
}

const has = (claims: ReadonlySet<string>) => (l: RevealLine) => l.claims.some((c) => claims.has(c));

/** Events that resolve his action: the reception or interception the pass ended in. */
function resolvingEvents(hero: Hero): Set<string> {
  const run = hero.runs.factual;
  const end = run.action?.end;
  return new Set(run.events.filter((e) => e.frame === end).map((e) => e.id));
}

export function revealOf(input: RevealInput): Reveal | null {
  const { hero, options, whatIfs, narration, language } = input;
  const pick = options.find((o) => o.action === input.pick);
  const his = options.find((o) => o.factual);
  if (!pick || !his) return null;

  const told = narration ? linesOf(narration, narration.lines, true) : [];
  const used = new Set<string>();
  const take = (keep: (l: RevealLine) => boolean): RevealLine[] => {
    const out = told.filter((l) => !used.has(l.id) && keep(l));
    out.forEach((l) => used.add(l.id));
    return out;
  };

  let outcome: RevealLine[] = [];
  let compare: RevealLine[] = [];
  if (pick.run.source === "whatif") {
    const option = optionOf(whatIfs, pick.action);
    const answer = option?.answers[language] ?? option?.answers.en;
    const lines = answer ? linesOf(answer, answer.lines, true) : [];
    outcome = lines.filter((l) => !l.claims.includes(WHATIF_VALUE));
    compare = lines.filter((l) => l.claims.includes(WHATIF_VALUE));
  } else if (pick.run.source === "factual") {
    const resolving = resolvingEvents(hero);
    const ends = (id: string) => narration?.claims.get(id)?.evidence.some((e) => resolving.has(e));
    outcome = take((l) => l.claims.some((c) => ends(c)));
  } else {
    outcome = take(has(CF_OUTCOME));
    compare = take(has(new Set([CF_VALUE])));
  }
  const truth = take(has(TRUTH_CLAIMS));
  const actual = take(() => true);
  const moved = (pictureOf(hero)?.players ?? [])
    .filter((p) => p.off)
    .map((p) => p.id)
    .sort();

  const same = pick.factual;
  return {
    pick,
    his,
    same,
    outcome: {
      title: same ? `You made his call: ${pick.label}` : `Your call: ${pick.label}`,
      lines: outcome,
    },
    truth: { title: "The true picture", lines: truth, moved },
    actual: { title: `What he did: ${his.label}`, lines: actual },
    compare: { yours: pick.label, his: his.label, lines: same ? [] : compare },
  };
}
