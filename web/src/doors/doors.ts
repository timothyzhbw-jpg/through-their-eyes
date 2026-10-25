// The three doors (SPEC 7): the site's whole map, so a first-time visitor knows where to start and
// when they are done. The look (the default): the hero moment's story, about a minute. Your turn:
// the modes where the viewer is the player (Your call, Take his eyes, the academy drill). For
// studios: the business side, Tactics → Content → Value, then the AI crew behind it. Pure: the ids,
// their names, and how the addresses that predate the doors (?step=, ?play=) map onto them.

import type { JourneyStep } from "../journey/steps";

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
  studios: "What a studio does with one moment: tactics, content, value, and the AI crew",
};

export const parseDoor = (v: string | null | undefined): Door | null =>
  v != null && (DOORS as readonly string[]).includes(v) ? (v as Door) : null;

/** The `?step=` values from before the doors: the old journey's five steps. */
export const LEGACY_STEPS = ["event", "tactics", "your-view", "content", "value"] as const;
export type LegacyStep = (typeof LEGACY_STEPS)[number];

/** Where an old `?step=` lands: the Event step is door 1's compare; Your view is in Settings, over
 * door 1; Tactics, Content and Value are the studios' steps. */
export function doorOfStep(step: string): { door: Door; studio: JourneyStep | null } {
  if (step === "tactics" || step === "content" || step === "value") {
    return { door: "studios", studio: step };
  }
  if (step === "crew") return { door: "studios", studio: "crew" };
  return { door: "look", studio: null };
}

/** The door a `?play=` mode belongs to: the scan story is the look's; the rest are Your turn. */
export function doorOfPlay(play: string): Door | null {
  if (play === "yourcall" || play === "eyes" || play === "drill") return "turn";
  if (play === "steps") return "look";
  return null;
}

/** `search` with `?door=` set to `door`; a studio step stays only on the studios' door. */
export function withDoor(search: string, door: Door): string {
  const params = new URLSearchParams(search);
  params.set("door", door);
  if (door !== "studios") params.delete("step");
  return `?${params.toString()}`;
}
