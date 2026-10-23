// Who is in a moment, and the order the rail and the moment lists take for a viewer who follows
// someone: moments involving the followed player first, then those involving the followed club,
// then the rest, each group in its own order. Everything is computed from the export in memory
// (the hero's ids, a match's possessions and moments); nothing is typed in per scenario, so a
// scenario the loaded export does not show has no involvement and keeps its place.

import type { Hero } from "../data/hero";
import type { Team } from "./follow";
import { teamOfId } from "./follow";

export interface Following {
  team: Team | null;
  player: string | null;
}

/** The players in a moment and the clubs they play for. */
export interface Involvement {
  players: ReadonlySet<string>;
  teams: ReadonlySet<Team>;
}

export const NOBODY: Involvement = { players: new Set(), teams: new Set() };

export const involvementOf = (ids: Iterable<string | null | undefined>): Involvement => {
  const players = new Set<string>();
  const teams = new Set<Team>();
  for (const id of ids) {
    if (!id) continue;
    players.add(id);
    const team = teamOfId(id);
    if (team !== null) teams.add(team);
  }
  return { players, teams };
};

/** 0 involves the followed player, 1 the followed club (or: a whole match, with anyone followed
 * at all), 2 neither. */
export type Tier = 0 | 1 | 2;

export function tierOf(follow: Following, who: Involvement, wholeMatch = false): Tier {
  if (follow.player !== null && who.players.has(follow.player)) return 0;
  if (follow.team !== null && who.teams.has(follow.team)) return 1;
  if (wholeMatch && (follow.team !== null || follow.player !== null)) return 1;
  return 2;
}

/** The same items, tier by tier, each tier in its given order. */
export function rankBy<T>(items: readonly T[], tier: (item: T) => Tier): T[] {
  return items
    .map((item, i) => ({ item, i, t: tier(item) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.item);
}

/**
 * The involvement of each scenario the loaded export shows. A stitched match shows every
 * possession: its hero, and everyone its moments name as actor or receiver. A hero moment shows
 * its own scenario: the hero, the runner and the pass's receiver.
 */
export function involvementByScenario(hero: Hero): Map<string, Involvement> {
  const out = new Map<string, Involvement>();
  const merge = (scenario: string, ids: (string | null | undefined)[]) => {
    const before = out.get(scenario);
    const now = involvementOf([...(before?.players ?? []), ...ids]);
    out.set(scenario, now);
  };
  if (hero.match) {
    for (const p of hero.match.possessions) {
      const named = hero.match.moments
        .filter((m) => m.possession === p.index)
        .flatMap((m) => [m.actor, m.receiver]);
      merge(p.scenario, [p.hero, ...named]);
    }
  } else {
    const action = hero.runs.factual.action;
    merge(hero.scenario, [hero.heroId, hero.runnerId, action?.to, action?.receiver]);
  }
  return out;
}

/** What a match moment involves: its actor and its receiver. */
export const momentWho = (m: { actor: string | null; receiver: string | null }): Involvement =>
  involvementOf([m.actor, m.receiver]);

/** How many of `who` involve the followed player or club. */
export const involvedCount = (follow: Following, who: readonly Involvement[]): number =>
  who.filter((w) => tierOf(follow, w) < 2).length;
