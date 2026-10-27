// Academy drill (SPEC 7): the viewer's picture at the decision and what came of the drill, read
// from the look grid only. The picture is Your call's (yourcall/picture.ts, why.ts) on a hero
// whose run is the look's: everyone where he believed them with that look, those he had not seen
// lately grey. The result puts the viewer's look and call next to his real look and the look-free
// run: the calls, the outcomes and the lines are the grid's, re-simulated and verified ahead of
// time. Nothing here computes a new number.

import { actionLabel, isShot, shotPost, type Hero } from "../data/hero";
import { shortName } from "../data/roster";
import { optionLabel } from "../options/passOptions";
import type { Narration, PayloadLine as NarrationLine } from "../narration/payload";
import { believedAt, STALE_S } from "../yourcall/picture";
import { actionPhrase } from "../yourcall/why";
import type { CallOption } from "../yourcall/options";
import type { Language } from "../whatif/whatif";
import {
  callLabel,
  lookRun,
  secondsBefore,
  whereLabel,
  type LookEntry,
  type Looks,
} from "../takeeyes/looks";

/** The hero with the look's run as his factual run, up to his decision: his picture with it. */
export function callHeroOf(hero: Hero, looks: Looks, entry: LookEntry): Hero {
  const run = { ...lookRun(hero, looks, entry), name: "factual" as const };
  return { ...hero, keyScan: null, runs: { ...hero.runs, factual: run } };
}

/**
 * The options of the look's decision as Your call's markers, listed left to right as seen from
 * behind him (Your call's order: it says nothing about how likely he was to pick each one). The
 * drill plays none of them: what came of the look is the grid's run.
 */
export function drillOptions(callHero: Hero): CallOption[] {
  const d = callHero.runs.factual.decision;
  if (!d || callHero.hero < 0) return [];
  const team = callHero.players[callHero.hero].team;
  const out = d.options.map((o): CallOption => {
    const receiver = o.action.startsWith("pass:") ? o.action.slice(5) : null;
    const j = receiver === null ? -1 : callHero.ids.indexOf(receiver);
    const number = j >= 0 ? callHero.players[j].number : undefined;
    const shot = isShot(o.action);
    const post = shotPost(o.action);
    return {
      action: o.action,
      kind: receiver ? "pass" : shot ? "shot" : "carry",
      label: o.action === "carry" ? "Carry" : shot ? optionLabel(o.action) : actionLabel(o.action),
      short:
        number !== undefined
          ? String(number)
          : post
            ? `${post === "near" ? "Near" : "Far"} post`
            : shot
              ? "Shot"
              : "Carry",
      receiver,
      anchor: j >= 0 ? believedAt(callHero, j) : o.target,
      target: o.target,
      factual: false, // the viewer is not told which one the sim picked
      run: { source: "factual" },
    };
  });
  const side = team === 0 ? -1 : 1;
  return out.sort((a, b) => side * (a.anchor[1] - b.anchor[1]) || a.anchor[0] - b.anchor[0]);
}

/** When and where a grid look went, in words with the grid's own values. */
export function lookWords(looks: Looks, entry: LookEntry, dt: number): string {
  if (entry.frame === null || entry.offset === null) return "No scan";
  const before = secondsBefore(looks, entry.frame, dt);
  const when = before === 0 ? "as the ball arrived" : `${before.toFixed(1)} s before the ball`;
  const where = whereLabel(entry.offset).replace(/^\w/, (c) => c.toLowerCase());
  return `${when}, ${Math.abs(entry.offset)}° ${where}`;
}

export interface DrillResult {
  entry: LookEntry; // the grid's look the viewer's turn became (the no-look entry for none)
  look: string; // lookWords
  late: boolean; // the grid's last time: as the ball arrived, his head still turning
  saw: NarrationLine | null; // the verified line on whom the look brought into his sight
  lines: NarrationLine[]; // the look's other verified lines: his picture, the sim's call, what came of it
  narration: Narration | undefined; // the look's verified lines, in the viewer's language
  pick: string; // the viewer's call
  simCall: string; // the sim's call with the same look
  hisCall: string; // what he really did
  hisLooks: string[]; // where his own looks went, in words (no number)
  noLookCall: string;
  sameAsHis: boolean; // the viewer's call is his
  runner: { id: string; fresh: boolean } | null; // the runner in the viewer's picture
}

export function drillResult(args: {
  hero: Hero;
  looks: Looks;
  entry: LookEntry;
  pick: string;
  language: Language;
}): DrillResult {
  const { hero, looks, entry, pick, language } = args;
  const age = entry.decision.belief_age ?? {};
  const narration = entry.answers[language] ?? entry.answers.en;
  const has = (l: NarrationLine, claim: string) => l.claims.includes(claim);
  return {
    entry,
    look: lookWords(looks, entry, hero.dt),
    late: entry.frame !== null && entry.frame >= looks.reception,
    // "When and where" is `look`, in the grid's values; whom it brought into sight has its row.
    saw: narration?.lines.find((l) => has(l, "look_saw")) ?? null,
    lines: narration?.lines.filter((l) => !has(l, "look_when") && !has(l, "look_saw")) ?? [],
    narration,
    pick,
    simCall: entry.decision.chosen,
    hisCall: looks.factual.chosen,
    hisLooks: looks.ownLooks.map((l) => whereLabel(l.offset)),
    noLookCall: looks.noLook.decision.chosen,
    sameAsHis: pick === looks.factual.chosen,
    runner: hero.runnerId
      ? { id: hero.runnerId, fresh: (age[hero.runnerId] ?? Infinity) < STALE_S }
      : null,
  };
}

const CHANCE = "The sim's players choose with some chance, as people do.";

/**
 * The viewer's call against the sim's call with the same look, in words from the look's decision
 * record (each option's chance on that picture; no number), and, for a pass, whether its receiver
 * was fresh in the picture. Your call says the same of his picture (yourcall/why.ts).
 */
export function pictureWords(callHero: Hero, pick: string): string {
  const d = callHero.runs.factual.decision;
  if (!d) return "";
  const chance = new Map(d.options.map((o) => [o.action, o.prob]));
  const his = actionPhrase(d.chosen);
  const rated =
    pick === d.chosen
      ? "With your look he makes this call too."
      : (chance.get(d.chosen) ?? 0) >= (chance.get(pick) ?? 0)
        ? `On your picture ${his} looked more promising, and with your look he goes for it.`
        : `On your picture your call looked more promising, yet with your look he goes for ${his}. ${CHANCE}`;
  const receiver = pick.startsWith("pass:") ? pick.slice(5) : null;
  if (!receiver || receiver === callHero.runnerId) return rated; // the runner has his own line
  const fresh = (d.belief_age[receiver] ?? Infinity) < STALE_S;
  return fresh
    ? rated
    : `You had not seen ${shortName(receiver)} lately: your picture of him was old. ${rated}`;
}

export { callLabel };
