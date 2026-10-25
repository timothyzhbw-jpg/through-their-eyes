// Which moment a tactic and all its parameter rows measure (SPEC 4.8, 7). High press and
// possession use press_escape, set pieces use corner_blind_side; counter-attack, possession and
// transition prefer the stitched match itself. Those exports come from the service the page
// already talks to: no model, no new data. Offline only the bundled moment exists, and a tactic
// for another moment says so instead of printing zeros.

import type { Api } from "../api/client";
import { loadScenarioHero } from "../data/load";
import { parseHero, type Hero } from "../data/hero";
import { FULL_MATCH } from "../moments/moments";
import type { TacticId } from "./cards";

/** The hero moment that shows each tactic. */
export const CARD_SCENARIO: Record<TacticId, string> = {
  high_press: "press_escape",
  counter_attack: "press_escape",
  build_up: "press_escape",
  transition: "press_escape",
  corners: "corner_blind_side",
};

/** What the page has of the cards' moments: the heroes loaded so far, by scenario, and the
 * stitched match (the fallback for a moment that holds none of a card's events). */
export interface Scope {
  heroes: Readonly<Record<string, Hero>>;
  match: Hero | null;
  /** The service is still being asked. */
  loading: boolean;
  /** A service to ask; false: only the bundled moment exists. */
  online: boolean;
}

export const NO_SCOPE: Scope = { heroes: {}, match: null, loading: false, online: false };

/** The scenarios a page on `current` still has to load for the cards and their match scope. */
export function missingScenarios(current: Hero): string[] {
  if (current.kind === "match") return [];
  return [...new Set(Object.values(CARD_SCENARIO))].filter((s) => s !== current.scenario);
}

const matches = new WeakMap<Api, Promise<Hero>>();
const heroLoads = new WeakMap<Api, Map<string, Promise<Hero | null>>>();

/**
 * The stitched match and, from its possessions, the hero of every scenario in `scenarios`.
 * A scenario with no possession in the match, or one the service cannot export, is left out.
 * The match is asked once per service and each hero once per (service, scenario), so a later
 * page that needs other scenarios loads only those.
 */
export async function loadScope(
  api: Api,
  scenarios: readonly string[],
  dataUrl: string,
  fetchImpl?: Parameters<typeof loadScenarioHero>[3],
): Promise<Scope> {
  let matchLoad = matches.get(api);
  if (!matchLoad) {
    matchLoad = (async () => parseHero(await api.withMatch(FULL_MATCH).exportJson()))();
    matches.set(api, matchLoad);
    matchLoad.catch(() => matches.delete(api)); // a later visit may try again
  }
  const match = await matchLoad;
  let cache = heroLoads.get(api);
  if (!cache) heroLoads.set(api, (cache = new Map()));
  const known = cache;
  const heroes: Record<string, Hero> = {};
  await Promise.all(
    scenarios.map(async (scenario) => {
      const p = match.match?.possessions.find((q) => q.scenario === scenario);
      if (!p) return;
      let load = known.get(scenario);
      if (!load) {
        load = loadScenarioHero(api, p, dataUrl, fetchImpl).catch(() => null); // that card says its moment could not be loaded
        known.set(scenario, load);
      }
      const hero = await load;
      if (hero) heroes[scenario] = hero;
    }),
  );
  return { heroes, match, loading: false, online: true };
}
