// What the screens can show, built once from files the site already ships (public/data): the
// hero moment's export (players, kits, the decision frame), its verified step-by-step lines and
// "without the look" lines, and the scoring hero's "without the look" lines. Nothing is fetched
// from the live service and nothing here costs a model call.
//
// Every number a screen shows comes from one of those files: a figure or a sentence is a
// verified line's text (its numbers slot-filled by the Verifier), or a template filled from a
// supported claim's values; shirt numbers come from the export. `allowedNumbers` lists them all,
// and the tests check every digit drawn on every screen against it.

import { z } from "zod";
import { actionTarget, type Hero } from "../data/hero";
import { CLUBS, fullName, shortName } from "../data/roster";
import { kitOf } from "../players/kit";
import { numberParts } from "../ui/numbers";

// ---------- the bundled files' verified answers (the parts the studio reads) ----------

const Claim = z.object({
  id: z.string(),
  kind: z.string(),
  verdict: z.string(),
  values: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
});
const Answer = z.object({
  moment: z.string(),
  lines: z.array(z.object({ id: z.string(), text: z.string(), claims: z.array(z.string()) })),
  claims: z.array(Claim),
});
type Answer = z.infer<typeof Answer>;
export type Claim = z.infer<typeof Claim>;

/** steps_<...>.json (sim.export --steps): the factual run's verified answer in English. */
const StepsFile = z.object({
  scenario: z.string(),
  seed: z.number(),
  hero: z.string(),
  runs: z.object({ factual: z.object({ answers: z.object({ en: Answer }) }) }),
});
/** without_look_<...>.json (sim.export --without-look): its verified answer in English. */
const WithoutFile = z.object({
  scenario: z.string(),
  seed: z.number(),
  hero: z.string(),
  answers: z.object({ en: Answer }),
});

/** A verified line: its text, and its claims, every one of them supported. */
export interface VerifiedLine {
  id: string;
  text: string;
  claims: Claim[];
}

/** The lines of `answer` whose claims are all supported, by id; the rest are withheld. */
function verifiedLines(answer: Answer): Map<string, VerifiedLine> {
  const claims = new Map(answer.claims.map((c) => [c.id, c]));
  const out = new Map<string, VerifiedLine>();
  for (const line of answer.lines) {
    const own = line.claims.map((id) => claims.get(id));
    if (own.every((c) => c?.verdict === "supported")) {
      out.set(line.id, { id: line.id, text: line.text, claims: own as Claim[] });
    }
  }
  return out;
}

// ---------- what a screen can show ----------

export interface WalkoutPlayer {
  id: string;
  name: string; // "Joss Ferriday"
  short: string; // "J. Ferriday"
  number: number; // from the export
  role: string;
  club: string;
  code: string; // the club's three letters
  kit: { shirt: string; shorts: string; socks: string; trim: string };
}

export interface StatCard {
  id: string;
  kicker: string; // "THE LOOK"
  title: string; // whose moment
  figure: string | null; // a number with its unit, cut from `lines[0]`
  caption: string; // what the figure is, in words with no number
  lines: string[]; // verified sentences
  source: string; // which file the lines come from
  claims: Claim[];
}

export interface StillPlayer {
  id: string;
  team: 0 | 1;
  number: number;
  keeper: boolean;
  x: number; // pitch m
  y: number;
}

export interface TacticalStill {
  id: string;
  kicker: string;
  title: string; // "J. Ferriday → N. Varnhall"
  players: StillPlayer[];
  ball: [number, number];
  hero: string;
  pass: { from: [number, number]; to: [number, number]; receiver: string | null } | null;
}

export interface MomentFacts {
  scenario: string;
  seed: number;
  hero: string;
  still: TacticalStill | null;
  cards: StatCard[];
}

export interface StudioFacts {
  players: Record<string, WalkoutPlayer>;
  look: MomentFacts | null; // the key look: blind_side_run seed 3
  goal: MomentFacts | null; // the goal: far_post_finish seed 11, which scores (SPEC 3.6)
}

export interface StudioFiles {
  hero: Hero; // hero_seed3.json, parsed
  steps: unknown; // steps_seed3.json
  without: unknown; // without_look_seed3.json
  goalWithout: unknown; // without_look_far_post_finish_seed11.json
}

/** Every player of the export as he walks out: name, number, club and kit. */
export function walkoutPlayers(hero: Hero): Record<string, WalkoutPlayer> {
  const out: Record<string, WalkoutPlayer> = {};
  for (const p of hero.players) {
    const kit = kitOf(p);
    out[p.id] = {
      id: p.id,
      name: fullName(p.id),
      short: shortName(p.id),
      number: p.number,
      role: p.role,
      club: CLUBS[p.team].name,
      code: CLUBS[p.team].code,
      kit: { shirt: kit.shirt, shorts: kit.shorts, socks: kit.socks, trim: kit.trim },
    };
  }
  return out;
}

/** The board at the hero's decision: everyone where they were, the ball, and his pass. */
export function stillAtDecision(hero: Hero, kicker: string): TacticalStill | null {
  const run = hero.runs.factual;
  const decision = run.decision;
  if (!decision || !hero.heroId) return null;
  const f = Math.min(decision.frame, run.frames - 1);
  const players = hero.players.map((p, j) => ({
    id: p.id,
    team: p.team,
    number: p.number,
    keeper: p.role === "GK",
    x: run.pos[(f * hero.n + j) * 2],
    y: run.pos[(f * hero.n + j) * 2 + 1],
  }));
  const action = run.action;
  const receiver = action?.to ?? null;
  return {
    id: `still:${hero.scenario}-${hero.seed}:${f}`,
    kicker,
    title: receiver ? `${shortName(hero.heroId)} → ${shortName(receiver)}` : shortName(hero.heroId),
    players,
    ball: [run.ball[f * 2], run.ball[f * 2 + 1]],
    hero: hero.heroId,
    pass: action ? { from: action.start, to: actionTarget(action), receiver } : null,
  };
}

/** A card from verified lines: the figure is the first number (with its unit) in the first line. */
function card(
  id: string,
  kicker: string,
  title: string,
  caption: string,
  lines: VerifiedLine[],
  source: string,
): StatCard | null {
  if (!lines.length) return null;
  const figure = numberParts(lines[0].text).find((p) => p.num)?.text ?? null;
  return {
    id,
    kicker,
    title,
    figure,
    caption,
    lines: lines.map((l) => l.text),
    source,
    claims: lines.flatMap((l) => l.claims),
  };
}

const pick = (lines: Map<string, VerifiedLine>, ids: string[]) =>
  ids.map((id) => lines.get(id)).filter((l): l is VerifiedLine => !!l);

/** The key look's cards: when he looked (steps), and what the look changed (without the look). */
function lookFacts(hero: Hero, rawSteps: unknown, rawWithout: unknown): MomentFacts | null {
  if (!hero.heroId) return null;
  const steps = StepsFile.safeParse(rawSteps);
  const without = WithoutFile.safeParse(rawWithout);
  const name = shortName(hero.heroId);
  const cards: StatCard[] = [];
  if (steps.success && steps.data.hero === hero.heroId) {
    const lines = verifiedLines(steps.data.runs.factual.answers.en);
    const c = card(
      `stat:look:${hero.heroId}`,
      "THE LOOK",
      name,
      "his look before the ball reached him",
      pick(lines, ["step1_when", "final_belief"]),
      "steps_seed3.json",
    );
    if (c) cards.push(c);
  }
  if (without.success && without.data.hero === hero.heroId) {
    const lines = verifiedLines(without.data.answers.en);
    const c = card(
      `stat:without:${hero.heroId}`,
      "WITHOUT THE LOOK",
      name,
      "the look the sim took away",
      pick(lines, ["removed_look", "look_cost"]),
      "without_look_seed3.json",
    );
    if (c) cards.push(c);
  }
  return {
    scenario: hero.scenario,
    seed: hero.seed,
    hero: hero.heroId,
    still: stillAtDecision(hero, "THE LOOK"),
    cards,
  };
}

/** The goal's card: the scorer's look before the shot, a template filled from its claim. */
function goalFacts(rawWithout: unknown): MomentFacts | null {
  const parsed = WithoutFile.safeParse(rawWithout);
  if (!parsed.success) return null;
  const { hero, scenario, seed, answers } = parsed.data;
  const look = verifiedLines(answers.en).get("removed_look")?.claims[0];
  const side = look?.values.side;
  const before = look?.values.before;
  const name = shortName(hero);
  const cards: StatCard[] = [];
  if (look && (side === "left" || side === "right") && typeof before === "number") {
    const figure = `${before} s`;
    cards.push({
      id: `stat:goal:${hero}`,
      kicker: "GOAL",
      title: name,
      figure,
      caption: "his look before the ball reached him",
      lines: [`${name} looked over his ${side} shoulder ${figure} before the ball reached him.`],
      source: "without_look_far_post_finish_seed11.json",
      claims: [look],
    });
  }
  return { scenario, seed, hero, still: null, cards };
}

export function studioFacts(files: StudioFiles): StudioFacts {
  return {
    players: walkoutPlayers(files.hero),
    look: lookFacts(files.hero, files.steps, files.without),
    goal: goalFacts(files.goalWithout),
  };
}

/** Every number a screen may show: the claims' numeric values and the shirt numbers. */
export function allowedNumbers(facts: StudioFacts): Set<string> {
  const out = new Set<string>();
  for (const p of Object.values(facts.players)) out.add(String(p.number));
  for (const m of [facts.look, facts.goal]) {
    for (const c of m?.cards ?? []) {
      for (const claim of c.claims) {
        for (const v of Object.values(claim.values)) if (typeof v === "number") out.add(String(v));
      }
    }
  }
  return out;
}
