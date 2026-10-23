// What the views read: the choices, the rail's order and the moments in reach.

import { useMemo } from "react";
import { useView } from "../session";
import { useStore } from "../store/store";
import { type Choices } from "./follow";
import {
  followedIndex,
  involvementByScenario,
  linkTier,
  momentWho,
  rankBy,
  tierOf,
  type Involvement,
  type Tier,
} from "./rank";
import { personal } from "./state";

export const useChoices = (): Choices => useStore(personal, (s) => s);

/** The index in `hero.ids` of the followed player, or -1 (none, or not in this export). */
export function useFollowedIndex(ids: readonly string[]): number {
  const player = useStore(personal, (s) => s.player);
  return followedIndex(player, ids);
}

/** The moment links (or anything with a `scenario`), the followed ones first. The full match
 * (scenario null) holds everyone's moments, so it ranks with the followed club's, but only on a
 * page that has loaded a match. */
export function useRankedLinks<T extends { scenario: string | null }>(links: readonly T[]): T[] {
  const { hero } = useView();
  const team = useStore(personal, (s) => s.team);
  const player = useStore(personal, (s) => s.player);
  const byScenario = useMemo(() => involvementByScenario(hero), [hero]);
  return useMemo(
    () =>
      rankBy(links, (l) => linkTier({ team, player }, l.scenario, byScenario, Boolean(hero.match))),
    [links, byScenario, team, player, hero],
  );
}

/** A tier function for match moments, for the moment lists. */
export function useMomentTier(): (m: { actor: string | null; receiver: string | null }) => Tier {
  const team = useStore(personal, (s) => s.team);
  const player = useStore(personal, (s) => s.player);
  return (m) => tierOf({ team, player }, momentWho(m));
}

/** What the page can show of the viewer's follow: the moments in reach, each as who is in it. */
export function useMomentsInReach(): Involvement[] {
  const { hero } = useView();
  return useMemo(() => {
    if (hero.match) return hero.match.moments.map(momentWho);
    const own = involvementByScenario(hero).get(hero.scenario);
    return own ? [own] : [];
  }, [hero]);
}
