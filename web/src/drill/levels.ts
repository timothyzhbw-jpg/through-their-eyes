// Academy drill (SPEC 7): its levels are the hero moments with a bundled look grid, nothing new to
// simulate. Easier first. A grid bundled later (LOOK_FILES) joins the list under its key until it
// is named here.

import { LOOK_FILES } from "../takeeyes/looks";

export interface Level {
  key: string; // `<scenario>-<seed>`, as LOOK_FILES
  label: string;
  difficulty: string; // in words, no number
  query: string; // the deep link, from the site's root
}

const NAMED: Record<string, Omit<Level, "key">> = {
  "blind_side_run-3": {
    label: "Blind side",
    difficulty: "easier",
    query: "?play=drill",
  },
  "press_escape-0": {
    label: "Under pressure",
    difficulty: "harder",
    query: "?match=press_escape-0&play=drill",
  },
};

export const LEVELS: readonly Level[] = Object.keys(LOOK_FILES).map((key) => ({
  key,
  ...(NAMED[key] ?? { label: key, difficulty: "", query: `?match=${key}&play=drill` }),
}));

export const levelOf = (scenario: string, seed: number): Level | null =>
  LEVELS.find((l) => l.key === `${scenario}-${seed}`) ?? null;

/** The level after this one, round to the first. */
export function nextLevel(level: Level | null): Level | null {
  if (!level || LEVELS.length < 2) return null;
  return LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];
}

/** The level's address on this site. */
export const levelHref = (level: Level): string => `${import.meta.env.BASE_URL}${level.query}`;
