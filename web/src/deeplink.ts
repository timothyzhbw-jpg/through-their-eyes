// Deep links: URL parameters that open the app on a given audience, language, run, view and
// frame, so each step of the README's three-minute tour for judges is one link.
//
//   ?persona=casual|analyst|player_fan|coach   the breakdown's audience (live service only)
//   ?lang=en|zh                                its language, and the What if box's
//   ?run=factual|counterfactual                with the look / without it
//   ?view=pov|tactical|split                   which view gets the space
//   ?at=<frame>|key-scan|decision              open paused at that frame (25 Hz, from 0)
//   ?ask=<question>                            prefill the What if box's free question
// and the testing parameters ?autoplay=0, ?offline=1, ?plan=invalid (and ?rigged=0, read by
// players/trial.ts). A link that points at a spot (at, run or ask) opens paused: no live stream
// and no breakdown on load. Unknown values are ignored and logged.

import { createContext, useContext } from "react";
import { PERSONAS, type Persona } from "./api/client";
import type { Hero } from "./data/hero";
import type { RunName } from "./data/types";
import type { MomentContext } from "./plan/moment";
import type { Session } from "./session";
import { keyScanFrame, openingFrame, type Focus } from "./store/playback";
import { MAX_QUESTION } from "./whatif/ask";
import { LANGUAGES, type Language } from "./whatif/whatif";

const RUNS = ["factual", "counterfactual"] as const satisfies readonly RunName[];
const VIEWS = ["pov", "tactical", "split"] as const satisfies readonly Focus[];
const NAMED_FRAMES = ["key-scan", "decision"] as const;

export type View = (typeof VIEWS)[number];
export type At = number | (typeof NAMED_FRAMES)[number];

export interface DeepLink {
  autoplay: boolean; // watch live, then the breakdown; false with autoplay=0 or at / run / ask
  offline: boolean; // offline=1: ignore the live service
  invalidPlan: boolean; // plan=invalid: load the broken plan to show the template fallback
  persona: Persona | null;
  language: Language | null;
  run: RunName | null;
  view: View | null;
  at: At | null;
  ask: string | null;
  warnings: string[]; // "name=value" of parameters whose value was not understood
}

export const NO_LINK: DeepLink = {
  autoplay: true,
  offline: false,
  invalidPlan: false,
  persona: null,
  language: null,
  run: null,
  view: null,
  at: null,
  ask: null,
  warnings: [],
};

const oneOf = <T extends string>(values: readonly T[], v: string): T | null =>
  (values as readonly string[]).includes(v) ? (v as T) : null;

function parseAt(v: string): At | null {
  const named = oneOf(NAMED_FRAMES, v);
  if (named) return named;
  return /^\d+$/.test(v) ? Number(v) : null;
}

export function parseDeepLink(search: string): DeepLink {
  const params = new URLSearchParams(search);
  const warnings: string[] = [];
  /** The parameter's value if `parse` understands it; otherwise null, with a warning. */
  function read<T>(name: string, parse: (v: string) => T | null): T | null {
    const v = params.get(name);
    if (v === null) return null;
    const value = parse(v);
    if (value === null) warnings.push(`${name}=${v}`);
    return value;
  }
  const persona = read("persona", (v) => oneOf(PERSONAS, v));
  const language = read("lang", (v) => oneOf(LANGUAGES, v));
  const run = read("run", (v) => oneOf(RUNS, v));
  const view = read("view", (v) => oneOf(VIEWS, v));
  const at = read("at", parseAt);
  const ask = params.get("ask")?.trim().slice(0, MAX_QUESTION) || null;
  const spot = at !== null || run !== null || ask !== null;
  return {
    autoplay: params.get("autoplay") !== "0" && !spot,
    offline: params.get("offline") === "1",
    invalidPlan: params.get("plan") === "invalid",
    persona,
    language,
    run,
    view,
    at,
    ask,
    warnings,
  };
}

/** The frame `at` names: a frame number, the key scan (where the app opens; a hero without one
 * opens before his decision), or the decision. */
export function atFrame(hero: Hero, moment: MomentContext, at: At): number {
  if (at === "key-scan") return keyScanFrame(hero) ?? openingFrame(hero);
  if (at === "decision") return moment.decisionFrame;
  return at;
}

/**
 * Put the session where the link says, before the first render. Audience and language only
 * choose what the live service is asked for (offline the bundled breakdown is all there is);
 * nothing is requested here.
 */
export function applyDeepLink(session: Session, link: DeepLink): void {
  const { controls } = session;
  if (link.persona) controls.setPersona(link.persona);
  if (link.language) controls.setLanguage(link.language);
  if (link.run) controls.setMode(link.run);
  if (link.view) controls.setFocus(link.view);
  if (link.at !== null) controls.seek(atFrame(session.hero, session.moment, link.at));
}

/** The link the page was opened with; components read prefills from it. */
export const DeepLinkContext = createContext<DeepLink>(NO_LINK);

export const useDeepLink = (): DeepLink => useContext(DeepLinkContext);
