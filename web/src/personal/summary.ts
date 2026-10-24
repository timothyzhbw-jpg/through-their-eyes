// The one-line "Your view" summary: who the commentary is for, in which language, who is followed
// and how many of the moments in reach involve them. The count is taken from the export in memory.

import type { Persona } from "../api/client";
import { clubName, shortName } from "../data/roster";
import { PERSONA_LABEL } from "../ui/labels";
import type { Language } from "../whatif/whatif";
import { MODES, type Choices } from "./follow";

export const LANGUAGE_NAME: Record<Language, string> = { en: "English", zh: "中文" };

export const personaLabel = (persona: Persona): string =>
  MODES.find((m) => m.persona === persona)?.label ?? PERSONA_LABEL[persona];

export interface SummaryInput {
  persona: Persona;
  language: Language;
  follow: Pick<Choices, "team" | "player">;
  /** Moments in reach that involve the followed player or club, and how many are in reach. */
  involved: number;
  total: number;
}

export function followingText(follow: Pick<Choices, "team" | "player">): string | null {
  const parts: string[] = [];
  if (follow.team !== null) parts.push(clubName(follow.team));
  if (follow.player !== null) parts.push(shortName(follow.player));
  return parts.length ? parts.join(" and ") : null;
}

export function yourView(s: SummaryInput): string {
  const head = `Your view: ${personaLabel(s.persona)} · ${LANGUAGE_NAME[s.language]}`;
  const following = followingText(s.follow);
  if (!following) return `${head} · following nobody yet`;
  const count =
    s.total === 0
      ? ""
      : s.involved === 0
        ? " · none of the moments in reach involve them"
        : ` · ${s.involved} of ${s.total} moments in reach involve them`;
  return `${head} · following ${following}${count}`;
}
