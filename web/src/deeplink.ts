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
//   ?door=look|turn|studios                    open that door (doors/): the look (the default),
//                                              Your turn's hub, For studios' steps
//   ?tour=1|<step id>                          the full judge tour (tour/), the three doors in
//                                              order, from its first step or from that one
//   ?tour=quick|<step id>                      the quick tour (door 1's story, ending on the
//                                              doors), from its first step or from that one
//   ?tour=story|<step id>                      the studios' walk (door 3's steps), from its first
//                                              step or that one. Step ids from before the doors
//                                              land where tour/steps.ts LEGACY_STEP_IDS says
//   ?step=tactics|content|value|crew           open For studios on that step (journey/): the
//                                              Tactics lab, the content package and stadium
//                                              screens, the business value, the AI crew. From
//                                              before the doors: event opens The look on its
//                                              compare, your-view opens Settings on Your view
//   ?play=eyes                                 open "Take his eyes" (takeeyes/) on the hero's own look;
//                                              with ?match=, on its first hero moment that has
//                                              a bundled look grid
//   ?play=steps                                open the scan step-through (steps/) on his first
//                                              look (a hero moment's only)
//   ?play=drill                                open the academy drill (drill/), ready to start;
//                                              with ?match=, on that moment (press_escape-0), or
//                                              in a stitched match on its first hero moment that
//                                              has a bundled look grid
//   ?match=match-1&moment=<scenario>           open that hero moment's breakdown inside the
//                                              match (corner_blind_side, far_post_finish:
//                                              the moment links, moments/)
//   ?team=KES|COR                              follow a club (personal/): its moments first, the
//                                              board and the summary say so
//   ?player=<roster id, e.g. H8>               follow a player: ringed in the 3D view and on the
//                                              board, their moments first
// (?persona and ?lang above also fill "Your view"; the four are kept in localStorage too.)
// and the testing parameters ?autoplay=0, ?intro=0 (skip the intro card), ?rail=0 (no door tabs
// in the header: the framing of the demo video's captures), ?offline=1,
// ?plan=invalid (and ?rigged=0, read by players/trial.ts). A link that points at a spot
// (at, run, ask, tamper, play, tour, step or door) skips the intro card and opens paused: no live
// stream, and no breakdown on load unless tamper needs one. Unknown values are ignored and logged.
// The door a link opens: ?door= if given; else the one its step, play or tamper belongs to
// (doorOf); else the look.
// ?cine=1 is for filming the demo video only (cine/, SPEC 10), never linked from the app; main.tsx
// reads it, this parser does not.

import { createContext, useContext } from "react";
import { PERSONAS, type Persona } from "./api/client";
import type { Hero } from "./data/hero";
import type { RunName } from "./data/types";
import type { MomentContext } from "./plan/moment";
import type { Session } from "./session";
import { keyScanFrame, openingFrame, type Focus } from "./store/playback";
import { IN_MATCH_MOMENTS } from "./moments/moments";
import { LEGACY_STEP_IDS, QUICK_IDS, STEP_IDS, STORY_IDS } from "./tour/steps";
import { parseStep, type JourneyStep } from "./journey/steps";
import { doorOfPlay, doorOfStep, parseDoor, type Door } from "./doors/doors";
import { MAX_QUESTION } from "./whatif/ask";
import { LANGUAGES, type Language } from "./whatif/whatif";
import { parsePlayer, parseTeam, type Team } from "./personal/follow";
import { stepThroughOf } from "./steps/controller";
import { takeEyesOf } from "./takeeyes/controller";
import { yourCallOf } from "./yourcall/controller";
import { drillOf } from "./drill/controller";

const RUNS = ["factual", "counterfactual"] as const satisfies readonly RunName[];
const VIEWS = ["pov", "tactical", "split"] as const satisfies readonly Focus[];
const NAMED_FRAMES = ["key-scan", "decision"] as const;
const PLAYS = ["yourcall", "recap", "eyes", "steps", "drill"] as const;
const CLAIM_ID = /^[a-z][a-z0-9_]{0,63}$/; // explain/builders.py ids, e.g. cf_value

/** The old journey's steps that are no studio step now: door 1's compare, and Your view. */
type LegacyStepLink = "event" | "your-view";

const parseStepLink = (v: string): JourneyStep | LegacyStepLink | null =>
  parseStep(v) ?? (v === "event" || v === "your-view" ? v : null);

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
  team: Team | null; // the club followed (personal/); null: none in the address
  player: string | null; // the player followed, a roster id
  run: RunName | null;
  view: View | null;
  at: At | null;
  ask: string | null;
  tamper: string | null; // a claim id
  play: Play | null; // yourcall: open "Your call" at the decision; recap: a match's recap; eyes: "Take his eyes"; steps: his looks, step by step; drill: the academy drill
  tour: string | null; // the judge tour's step to start at (tour=1: its first)
  moment: string | null; // with a stitched match: the hero moment of this scenario, its breakdown
  step: JourneyStep | LegacyStepLink | null; // the studios' step whose panel opens (journey/),
  // or a step from before the doors (event, your-view)
  door: Door | null; // ?door=: the door to open (doors/); null: the one the link points into
  rail: boolean; // the moment links above the live screen; rail=0 hides them (filming)
  warnings: string[]; // "name=value" of parameters whose value was not understood
}

export const NO_LINK: DeepLink = {
  autoplay: true,
  intro: true,
  offline: false,
  invalidPlan: false,
  persona: null,
  language: null,
  team: null,
  player: null,
  run: null,
  view: null,
  at: null,
  ask: null,
  tamper: null,
  play: null,
  tour: null,
  moment: null,
  step: null,
  door: null,
  rail: true,
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
  const team = read("team", parseTeam);
  const player = read("player", parsePlayer);
  const run = read("run", (v) => oneOf(RUNS, v));
  const view = read("view", (v) => oneOf(VIEWS, v));
  const at = read("at", parseAt);
  const ask = params.get("ask")?.trim().slice(0, MAX_QUESTION) || null;
  const tamper = read("tamper", (v) => (CLAIM_ID.test(v) ? v : null));
  const play = read("play", (v) => oneOf(PLAYS, v));
  const tour = read("tour", (v) =>
    v === "1"
      ? STEP_IDS[0]
      : v === "quick"
        ? QUICK_IDS[0]
        : v === "story"
          ? STORY_IDS[0]
          : (LEGACY_STEP_IDS[v] ?? oneOf([...STEP_IDS, ...QUICK_IDS, ...STORY_IDS] as const, v)),
  );
  const moment = read("moment", (v) => oneOf(IN_MATCH_MOMENTS, v));
  const step = read("step", parseStepLink);
  const door = read("door", parseDoor);
  const spot =
    at !== null ||
    run !== null ||
    ask !== null ||
    tamper !== null ||
    play !== null ||
    tour !== null ||
    moment !== null ||
    step !== null ||
    door !== null;
  return {
    autoplay: params.get("autoplay") !== "0" && !spot,
    intro: params.get("intro") !== "0" && !spot,
    offline: params.get("offline") === "1",
    invalidPlan: params.get("plan") === "invalid",
    persona,
    language,
    team,
    player,
    run,
    view,
    at,
    ask,
    tamper,
    play,
    tour,
    moment,
    step,
    door,
    rail: params.get("rail") !== "0",
    warnings,
  };
}

/** Where a link opens among the doors: the door, the studios' step to open (null: as it is), and
 * whether Settings opens on Your view (the old ?step=your-view). */
export function doorOf(link: DeepLink): {
  door: Door;
  studio: JourneyStep | null;
  yourView: boolean;
} {
  const fromStep = link.step ? doorOfStep(link.step) : null;
  const door = link.door ?? fromStep?.door ?? (link.play ? doorOfPlay(link.play) : null) ?? "look"; // tamper, at, run, ask: the picture
  return {
    door,
    studio: door === "studios" ? (fromStep?.studio ?? null) : null,
    yourView: link.step === "your-view",
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
  if (link.play === "eyes") takeEyesOf(session).open();
  if (link.play === "steps") stepThroughOf(session).open();
  if (link.play === "drill") drillOf(session).open();
}

/** The link the page was opened with; components read prefills from it. */
export const DeepLinkContext = createContext<DeepLink>(NO_LINK);

export const useDeepLink = (): DeepLink => useContext(DeepLinkContext);
