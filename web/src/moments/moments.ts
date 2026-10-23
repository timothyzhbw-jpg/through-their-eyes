// The moments a visitor can jump to (SPEC 7): the two hero moments the service plays on their own,
// the two told inside the full match, and the full match itself, live. Named as the trailer's
// chapters name them (THE LOOK, UNDER PRESSURE, THE CORNER). Each is a plain link: a page load,
// so every moment opens as its own deep link does. The corner and the goal open as hero
// breakdowns inside match-1 (`moment=`), where their breakdowns are cached, not as pages of their
// own, which would ask the crew for new ones.

import type { ViewSession } from "../session";

export type MomentLinkId = "look" | "pressure" | "corner" | "goal" | "match";

export interface MomentLink {
  id: MomentLinkId;
  label: string;
  query: string; // the deep link, from the site's root
  title: string; // what the link opens, in words with no number
  scenario: string | null; // the hero moment's scenario; null for the full match
}

/** The stitched match the full-match link and the in-match moments open. */
export const FULL_MATCH = "match-1";

export const MOMENT_LINKS: readonly MomentLink[] = [
  {
    id: "look",
    label: "The look",
    query: "?intro=0",
    title: "One look over his shoulder changes his pass",
    scenario: "blind_side_run",
  },
  {
    id: "pressure",
    label: "Under pressure",
    query: "?match=press_escape-0&intro=0",
    title: "A centre-back with an opponent closing in",
    scenario: "press_escape",
  },
  {
    id: "corner",
    label: "The corner",
    query: `?match=${FULL_MATCH}&moment=corner_blind_side`,
    title: "A marker's look at a short corner, in the full match",
    scenario: "corner_blind_side",
  },
  {
    id: "goal",
    label: "The goal",
    query: `?match=${FULL_MATCH}&moment=far_post_finish`,
    title: "A striker's look at the keeper before he shoots, in the full match",
    scenario: "far_post_finish",
  },
  {
    id: "match",
    label: "Full match · live",
    query: `?match=${FULL_MATCH}&intro=0`,
    title: "The whole synthetic match, streamed live, every moment on one clock",
    scenario: null,
  },
];

/** The academy drill (drill/, SPEC 7): not a moment of its own but a way to play the look one,
 * so it rides at the end of the row. */
export const DRILL_LINK = {
  label: "Academy drill",
  query: "?play=drill",
  title: "Check your shoulder before the ball arrives, then make the pass with what you saw",
} as const;

/** The link's address on this site. */
export const hrefOf = (link: Pick<MomentLink, "query">): string =>
  `${import.meta.env.BASE_URL}${link.query}`;

/** The full match, live: where the hero page's Live pill goes. */
export const FULL_MATCH_LIVE = hrefOf(MOMENT_LINKS.find((m) => m.id === "match")!);

/** The scenarios a `moment=` link may name: the in-match moments. */
export const IN_MATCH_MOMENTS: readonly string[] = MOMENT_LINKS.filter((m) =>
  m.query.includes("moment="),
).map((m) => m.scenario!);

/** Which link the page on screen is: a hero moment by its scenario, the match view as the match;
 * null for anything else (another match, a hero with no link). */
export function currentMoment(view: ViewSession): MomentLinkId | null {
  if (view.kind === "match") return view.match && matchIdOf(view) === FULL_MATCH ? "match" : null;
  return MOMENT_LINKS.find((m) => m.scenario === view.hero.scenario)?.id ?? null;
}

function matchIdOf(view: Extract<ViewSession, { kind: "match" }>): string {
  return `${view.hero.scenario}-${view.hero.seed}`;
}
