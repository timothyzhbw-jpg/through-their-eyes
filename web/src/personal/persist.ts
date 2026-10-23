// Where the choices live between visits (SPEC 7): the address (`?persona=&lang=&team=&player=`,
// parsed by deeplink.ts with the helpers of follow.ts) and localStorage. The address wins, so a
// shared link shows what its sender chose; storage fills what the link leaves open. Storage can be
// off (private mode, blocked cookies, a full quota): every read and write is in try/catch and the
// page simply forgets, never fails.

import {
  NO_CHOICES,
  normalise,
  parseLanguage,
  parsePersona,
  parsePlayer,
  parseTeam,
  teamCode,
  type Choices,
} from "./follow";

export const STORAGE_KEY = "tte.personal.v1";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem" | "removeItem">;

/** The browser's localStorage, or null where touching it throws. */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** What an earlier visit saved; nothing chosen when it is missing, unreadable or malformed. */
export function readSaved(storage: Reader | null = browserStorage()): Choices {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return NO_CHOICES;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return NO_CHOICES;
    const d = data as Record<string, unknown>;
    return normalise({
      persona: parsePersona(d.persona),
      language: parseLanguage(d.language),
      team: parseTeam(typeof d.team === "string" ? d.team : null),
      player: parsePlayer(typeof d.player === "string" ? d.player : null),
    });
  } catch {
    return NO_CHOICES;
  }
}

/** Save the choices; false when the browser refused (the choices still work for this visit). */
export function writeSaved(choices: Choices, storage: Writer | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        persona: choices.persona,
        language: choices.language,
        team: choices.team === null ? null : teamCode(choices.team),
        player: choices.player,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** The address's choices over the saved ones: each field from the link when it has one. */
export function mergeChoices(link: Choices, saved: Choices): Choices {
  return {
    persona: link.persona ?? saved.persona,
    language: link.language ?? saved.language,
    team: link.team ?? saved.team,
    player: link.player ?? saved.player,
  };
}

/**
 * The persona and language a page asks for. Online they are the merged choices (the address over
 * storage); offline only the bundled breakdowns exist, so only the address's own values count.
 */
export function audienceFor(
  link: Choices,
  merged: Choices,
  offline: boolean,
): Pick<Choices, "persona" | "language"> {
  const from = offline ? link : merged;
  return { persona: from.persona, language: from.language };
}

/** The query string with the four choice parameters set (or dropped when null), the rest kept. */
export function searchWith(search: string, choices: Choices): string {
  const params = new URLSearchParams(search);
  const set = (name: string, value: string | null) => {
    if (value === null) params.delete(name);
    else params.set(name, value);
  };
  set("persona", choices.persona);
  set("lang", choices.language);
  set("team", choices.team === null ? null : teamCode(choices.team));
  set("player", choices.player);
  const out = params.toString();
  return out ? `?${out}` : "";
}

/** Put the choices in the address without a page load or a history entry; false if refused. */
export function writeAddress(
  choices: Choices,
  win: Pick<Window, "location" | "history"> = window,
): boolean {
  try {
    const { pathname, search, hash } = win.location;
    const next = searchWith(search, choices);
    if (next === search) return true;
    win.history.replaceState(win.history.state, "", `${pathname}${next}${hash}`);
    return true;
  } catch {
    return false;
  }
}
