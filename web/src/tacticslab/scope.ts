// Which moment a Tactics card measures (SPEC 4.8, 7). A card is told on the hero moment that shows
// its tactic, whichever moment the page opened on: High press and Decisions under pressure on
// press_escape, Corners on corner_blind_side, Shot quality on far_post_finish, Progression on
// blind_side_run. Those moments' exports come from the service the page already talks to (the
// possessions of the stitched match, the way the match page opens them): no model, no new data.
// Offline only the bundled moment exists, and a card for another moment says so instead of
// printing zeros.

import type { Api } from "../api/client";
import { loadScenarioHero } from "../data/load";
import { parseHero, type Hero } from "../data/hero";
import { FULL_MATCH } from "../moments/moments";
import type { CardId } from "./cards";

/** The hero moment that shows each card's tactic. */
export const CARD_SCENARIO: Record<CardId, string> = {
  high_press: "press_escape",
  decisions: "press_escape",
  corners: "corner_blind_side",
  shot_quality: "far_post_finish",
  progression: "blind_side_run",
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

/** The scenarios a page on `current` still has to load for the five cards. */
export function missingScenarios(current: Hero): string[] {
  if (current.kind === "match") return [];
  return [...new Set(Object.values(CARD_SCENARIO))].filter((s) => s !== current.scenario);
}

const loads = new WeakMap<Api, Promise<Scope>>();

/**
 * The stitched match and, from its possessions, the hero of every scenario in `scenarios`.
 * A scenario with no possession in the match, or one the service cannot export, is left out.
 * Asked once per service.
 */
export function loadScope(
  api: Api,
  scenarios: readonly string[],
  dataUrl: string,
  fetchImpl?: Parameters<typeof loadScenarioHero>[3],
): Promise<Scope> {
  let load = loads.get(api);
  if (!load) {
    load = (async () => {
      const match = parseHero(await api.withMatch(FULL_MATCH).exportJson());
      const heroes: Record<string, Hero> = {};
      await Promise.all(
        scenarios.map(async (scenario) => {
          const p = match.match?.possessions.find((q) => q.scenario === scenario);
          if (!p) return;
          try {
            heroes[scenario] = await loadScenarioHero(api, p, dataUrl, fetchImpl);
          } catch {
            // that card says its moment could not be loaded
          }
        }),
      );
      return { heroes, match, loading: false, online: true };
    })();
    loads.set(api, load);
    load.catch(() => loads.delete(api)); // a later visit may try again
  }
  return load;
}
