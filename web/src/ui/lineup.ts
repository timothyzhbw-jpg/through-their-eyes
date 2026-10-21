// The pre-match lineup card's data (the lineup card, ui/LineupCard.tsx): both line-ups from the
// export (shirt numbers and roles) and each player's scanning habit, measured from this run's scan
// events, and whose eyes to watch: the hero of the moment, or each possession's hero in a match.

import type { Hero } from "../data/hero";

export interface LineupRow {
  number: number;
  id: string;
  role: string;
  scans: number;
  scansPerMinute: number;
  hero: boolean;
}

export interface WatchOption {
  id: string;
  role: string;
  note: string;
}

/** The factual run's exported duration, in minutes of play. */
export function runMinutes(hero: Hero): number {
  return (hero.runs.factual.frames * hero.dt) / 60;
}

/**
 * How to measure a player's scanning: a run shorter than a minute has too few scans for a rate (a
 * hero moment's one scan would read as nine a minute), so the card counts them instead.
 */
export function measure(hero: Hero): "count" | "rate" {
  return runMinutes(hero) < 1 ? "count" : "rate";
}

/** Each hero once, keeping his first possession's place in the match. */
export function watchOptions(hero: Hero): WatchOption[] {
  const options: WatchOption[] = [];
  const seen = new Set<string>();
  const add = (id: string | null, note: string) => {
    if (!id || seen.has(id)) return;
    const player = hero.players.find((player) => player.id === id);
    if (!player) return;
    seen.add(id);
    options.push({ id, role: player.role, note });
  };
  if (hero.match) {
    hero.match.possessions.forEach((possession, index) => {
      add(possession.hero, `Hero of possession ${index + 1}`);
    });
  } else {
    add(hero.heroId, "The hero of this moment");
  }
  return options;
}

/** Shirt numbers and roles from the export, with scan habits measured only in this run. */
export function lineup(hero: Hero): { home: LineupRow[]; away: LineupRow[] } {
  const minutes = runMinutes(hero);
  const heroes = new Set(watchOptions(hero).map((option) => option.id));
  const scans = new Map<string, number>();
  for (const scan of hero.runs.factual.scans) {
    scans.set(scan.player, (scans.get(scan.player) ?? 0) + 1);
  }
  const team = (team: 0 | 1): LineupRow[] =>
    hero.players
      .filter((player) => player.team === team)
      .sort((a, b) => a.number - b.number)
      .map((player) => {
        const count = scans.get(player.id) ?? 0;
        return {
          number: player.number,
          id: player.id,
          role: player.role,
          scans: count,
          scansPerMinute: count / minutes,
          hero: heroes.has(player.id),
        };
      });
  return { home: team(0), away: team(1) };
}
