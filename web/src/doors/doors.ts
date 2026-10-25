// The three doors (SPEC 7): the site's whole map, so a first-time visitor knows where to start and
// when they are done. The look (the default): the hero moment's story, about a minute. Your turn:
// the modes where the viewer is the player (Your call, Take his eyes, the academy drill). For
// studios: what it does for the league, four solutions (tactical broadcast, personalised
// commentary, automated highlights, the stadium) and their value. Before them, the landing page
// (`home`, Landing.tsx): the promise, the doors in a few lines each, every feature one link away;
// it is no door, so it has no tab. Pure: the ids,
// their names, and how the addresses that predate the doors (?step=, ?play=) map onto them.

import { LEGACY_STUDIO_STEPS, parseStep, type JourneyStep } from "../journey/steps";

export const DOORS = ["look", "turn", "studios"] as const;
export type Door = (typeof DOORS)[number];

export const DOOR_LABEL: Record<Door, string> = {
  look: "The look",
  turn: "Your turn",
  studios: "For studios",
};

/** What each door holds, in a few words (the tabs' tooltips). */
export const DOOR_NOTE: Record<Door, string> = {
  look: "One moment through his eyes: his look, the run without it, the two compared",
  turn: "You are the player: make his call, take his eyes, train your scanning",
  studios:
    "What it does for the league: tactical broadcast, personalised commentary, automated highlights, the stadium",
};

/** A page of the site: the landing page or a door. */
export type Page = "home" | Door;

export const parseDoor = (v: string | null | undefined): Page | null =>
  v === "home" ? v : v != null && (DOORS as readonly string[]).includes(v) ? (v as Door) : null;

/** Where a `?step=` lands: a studios' section opens on For studios; an old studio step (Tactics,
 * Content, Behind the scenes) on the section that holds its panel now; the old Event step is
 * door 1's compare, and Your view is in Settings, over door 1. */
export function doorOfStep(step: string): { door: Door; studio: JourneyStep | null } {
  const studio = parseStep(step) ?? LEGACY_STUDIO_STEPS[step] ?? null;
  return studio ? { door: "studios", studio } : { door: "look", studio: null };
}

/** The door a `?play=` mode belongs to: the scan story is the look's; the rest are Your turn. */
export function doorOfPlay(play: string): Door | null {
  if (play === "yourcall" || play === "eyes" || play === "drill") return "turn";
  if (play === "steps") return "look";
  return null;
}

const ONE_SHOT_ACTIONS = ["at", "run", "ask", "tamper", "play", "tour", "compare"] as const;

/** `search` with `?door=` set to `door`; actions already consumed do not run again on reload. */
export function withDoor(search: string, door: Page): string {
  const params = new URLSearchParams(search);
  for (const name of ONE_SHOT_ACTIONS) params.delete(name);
  params.set("door", door);
  if (door !== "studios") params.delete("step");
  return `?${params.toString()}`;
}

/** A feature link on the current page: its action plus the current match, moment and settings. */
export function withPageAction(search: string, action: string): string {
  const params = new URLSearchParams(search);
  for (const name of ONE_SHOT_ACTIONS) params.delete(name);
  params.delete("step");
  params.delete("door");
  for (const [name, value] of new URLSearchParams(action)) params.set(name, value);
  return `?${params.toString()}`;
}
