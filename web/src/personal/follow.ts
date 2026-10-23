// What a viewer follows (SPEC 7, personalized viewing): one of the two fictional clubs, one player
// from the roster, and which audience and language the commentary is for. Pure helpers: parsing
// of the values the address and localStorage carry, the choices' labels, and the two modes.

import type { Persona } from "../api/client";
import { PERSONAS } from "../api/client";
import { CLUBS, ROSTER } from "../data/roster";
import type { ExportPlayer } from "../data/types";
import { LANGUAGES, type Language } from "../whatif/whatif";

export type Team = 0 | 1;

/** Everything personal: the audience (null: not chosen yet), the language, who is followed. */
export interface Choices {
  persona: Persona | null;
  language: Language | null;
  team: Team | null;
  player: string | null; // a roster id such as "H8"
}

export const NO_CHOICES: Choices = { persona: null, language: null, team: null, player: null };

/** The two modes of the switch, each on the persona it maps to; the other three sit under More. */
export const MODES = [
  { persona: "casual", label: "Casual fan", note: "The story in three lines, through his eyes." },
  {
    persona: "analyst",
    label: "Tactical analyst",
    note: "The board, pitch control and every number.",
  },
] as const satisfies readonly { persona: Persona; label: string; note: string }[];

export const MORE_PERSONAS: readonly Persona[] = PERSONAS.filter(
  (p) => !MODES.some((m) => m.persona === p),
);

export const isMode = (persona: Persona): boolean => MODES.some((m) => m.persona === persona);

/** A club's three-letter code in the address: `team=KES`. */
export const teamCode = (team: Team): string => CLUBS[team].code;

/** The club a `team=` value names (its code, any case); null for anything else. */
export function parseTeam(value: string | null | undefined): Team | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  return v === CLUBS[0].code ? 0 : v === CLUBS[1].code ? 1 : null;
}

/** The player a `player=` value names: a roster id (any case); null for anything else. */
export function parsePlayer(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  return Object.hasOwn(ROSTER, v) ? v : null;
}

export const parsePersona = (v: unknown): Persona | null =>
  typeof v === "string" ? (PERSONAS.find((p) => p === v) ?? null) : null;

export const parseLanguage = (v: unknown): Language | null =>
  typeof v === "string" ? (LANGUAGES.find((l) => l === v) ?? null) : null;

/** The side a roster id plays for ("H" home, "A" away); null for an id that is not on the roster. */
export function teamOfId(id: string): Team | null {
  if (!Object.hasOwn(ROSTER, id)) return null;
  return id.startsWith("H") ? 0 : 1;
}

/** A line-up row of the player picker: both clubs' players by shirt number. */
export interface PlayerOption {
  id: string;
  team: Team;
  number: number;
  role: string;
}

/** The players a match has, home first, by shirt number; those not on the roster are left out. */
export function playerOptions(players: readonly ExportPlayer[]): PlayerOption[] {
  return players
    .filter((p) => teamOfId(p.id) !== null)
    .map((p) => ({ id: p.id, team: p.team, number: p.number, role: p.role }))
    .sort((a, b) => a.team - b.team || a.number - b.number);
}

/** Following a player and a club at once is allowed; the player's own club is not forced. */
export function normalise(choices: Choices): Choices {
  return {
    persona: parsePersona(choices.persona),
    language: parseLanguage(choices.language),
    team: choices.team === 0 || choices.team === 1 ? choices.team : null,
    player: parsePlayer(choices.player),
  };
}
