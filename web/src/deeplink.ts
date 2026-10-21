// Deep links: URL parameters that open the app on a given audience, language, run, view and
// frame, so each step of the README's three-minute tour for judges is one link.
//
//   ?persona=casual|analyst|player_fan|coach|audio_description
//                                              the breakdown's audience (live service only)
//   ?lang=en|zh                                its language, and the What if box's
//   ?run=factual|counterfactual                with the look / without it
//   ?view=pov|tactical|split                   which view gets the space
//   ?at=<frame>|key-scan|decision              open paused at that frame (25 Hz, from 0)
//   ?ask=<question>                            prefill the What if box's free question
//   ?tamper=<claim id>                         open the evidence card on that claim with "Try a
//                                              wrong number" open (online: the breakdown is
//                                              asked for at once)
//   ?play=yourcall                             open "Your call" at the decision (yourcall/); with
//                                              ?match=, on its first hero moment that has bundled
//                                              what-ifs
//   ?play=recap                                with ?match= (a stitched match): its end-of-match
//                                              recap, asked for at once for ?persona and ?lang,
//                                              with the full-time card on the live screen
// and the testing parameters ?autoplay=0, ?intro=0 (skip the lineup card), ?offline=1,
// ?plan=invalid (and ?rigged=0, read by players/trial.ts). A link that points at a spot
// (at, run, ask, tamper or play) skips the lineup card and opens paused: no live stream, and no
// breakdown on load unless tamper needs one. Unknown values are ignored and logged.
// ?cine=1 is for filming the demo video only (cine/, SPEC 10), never linked from the app; main.tsx
// reads it, this parser does not.

import { createContext, useContext } from "react";
import { PERSONAS, type Persona } from "./api/client";
import type { Hero } from "./data/hero";
import type { RunName } from "./data/types";
import type { MomentContext } from "./plan/moment";
import type { Session } from "./session";
import { keyScanFrame, openingFrame, type Focus } from "./store/playback";
import { MAX_QUESTION } from "./whatif/ask";
import { LANGUAGES, type Language } from "./whatif/whatif";
import { yourCallOf } from "./yourcall/controller";

const RUNS = ["factual", "counterfactual"] as const satisfies readonly RunName[];
const VIEWS = ["pov", "tactical", "split"] as const satisfies readonly Focus[];
const NAMED_FRAMES = ["key-scan", "decision"] as const;
const PLAYS = ["yourcall", "recap"] as const;
const CLAIM_ID = /^[a-z][a-z0-9_]{0,63}$/; // explain/builders.py ids, e.g. cf_value

export type View = (typeof VIEWS)[number];
export type At = number | (typeof NAMED_FRAMES)[number];
export type Play = (typeof PLAYS)[number];

export interface DeepLink {
  autoplay: boolean; // watch live, then the breakdown; false with autoplay=0 or at / run / ask
  intro: boolean; // show the lineup card; false with intro=0 or a link to a spot
  offline: boolean; // offline=1: ignore the live service
  invalidPlan: boolean; // plan=invalid: load the broken plan to show the template fallback
  persona: Persona | null;
  language: Language | null;
  run: RunName | null;
  view: View | null;
  at: At | null;
  ask: string | null;
  tamper: string | null; // a claim id
  play: Play | null; // yourcall: open "Your call" at the decision; recap: a match's recap
  warnings: string[]; // "name=value" of parameters whose value was not understood
}

export const NO_LINK: DeepLink = {
  autoplay: true,
  intro: true,
  offline: false,
  invalidPlan: false,
  persona: null,
  language: null,
  run: null,
  view: null,
  at: null,
  ask: null,
  tamper: null,
  play: null,
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
  const tamper = read("tamper", (v) => (CLAIM_ID.test(v) ? v : null));
  const play = read("play", (v) => oneOf(PLAYS, v));
  const spot = at !== null || run !== null || ask !== null || tamper !== null || play !== null;
  return {
    autoplay: params.get("autoplay") !== "0" && !spot,
    intro: params.get("intro") !== "0" && !spot,
    offline: params.get("offline") === "1",
    invalidPlan: params.get("plan") === "invalid",
    persona,
    language,
    run,
    view,
    at,
    ask,
    tamper,
    play,
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
 * only `tamper` and `play` request anything here: the breakdown whose evidence card it opens,
 * or whose lines Your call's reveal tells.
 */
export function applyDeepLink(session: Session, link: DeepLink): void {
  const { controls } = session;
  if (link.persona) controls.setPersona(link.persona);
  if (link.language) controls.setLanguage(link.language);
  if (link.run) controls.setMode(link.run);
  if (link.view) controls.setFocus(link.view);
  if (link.at !== null) controls.seek(atFrame(session.hero, session.moment, link.at));
  if (link.tamper) controls.openTamperLink(link.tamper);
  if (link.play === "yourcall") yourCallOf(session).open();
}

/** The link the page was opened with; components read prefills from it. */
export const DeepLinkContext = createContext<DeepLink>(NO_LINK);

export const useDeepLink = (): DeepLink => useContext(DeepLinkContext);
