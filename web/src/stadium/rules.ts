// The screen crew's rules: the event on the pitch decides what each screen shows. A pure function
// of the event (and its place in the programme, for the sponsors' rotation), so the same event
// always lights the bowl the same way.
//
// Each screen has, per event type, a list of content kinds in order of preference; the first one
// the event can fill wins. An event with no match moment behind it (a rehearsal cue) has no still
// and no stat card, so its screens fall through to the walk-out visual or the sponsor slot: a
// screen never shows a match fact the files do not hold.

import type { MomentFacts, StatCard, StudioFacts, TacticalStill, WalkoutPlayer } from "./content";
import { SCREEN_IDS, type ScreenId } from "./formats";
import { SPONSORS, type Sponsor } from "./sponsors";

export const EVENT_TYPES = [
  "walk-out",
  "key-look",
  "press-win",
  "corner",
  "goal",
  "half-time",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABEL: Record<EventType, string> = {
  "walk-out": "Walk-out",
  "key-look": "Key look",
  "press-win": "Press win",
  corner: "Corner",
  goal: "Goal",
  "half-time": "Half-time",
};

export type ContentKind = "tactical" | "stat" | "walkout" | "sponsor";

export interface StudioEvent {
  id: string;
  type: EventType;
  label: string;
  note: string; // where its facts come from, or that it is a rehearsal cue
  rehearsal: boolean; // no match moment behind it in the bundled files
  players: WalkoutPlayer[]; // featured: the first on the big screens, the next on the concourse
  cards: StatCard[];
  still: TacticalStill | null;
}

export type Content =
  | { kind: "tactical"; key: string; still: TacticalStill }
  | { kind: "stat"; key: string; card: StatCard }
  | { kind: "walkout"; key: string; player: WalkoutPlayer; kicker: string }
  | { kind: "sponsor"; key: string; sponsor: Sponsor };

export type Assignment = Record<ScreenId, Content>;

/** Per event type and screen: the content kinds in order of preference. The sponsor slot ends
 * every list but the goal's main board and tunnel, which always have the scorer. */
export const RULES: Record<EventType, Record<ScreenId, readonly ContentKind[]>> = {
  "walk-out": {
    main: ["walkout", "sponsor"],
    tunnel: ["walkout", "sponsor"],
    ribbon: ["sponsor"],
    "concourse-a": ["walkout", "sponsor"],
    "concourse-b": ["sponsor"],
  },
  "key-look": {
    main: ["tactical", "stat", "sponsor"],
    tunnel: ["walkout", "sponsor"],
    ribbon: ["stat", "sponsor"],
    "concourse-a": ["stat", "sponsor"],
    "concourse-b": ["tactical", "sponsor"],
  },
  "press-win": {
    main: ["tactical", "stat", "sponsor"],
    tunnel: ["sponsor"],
    ribbon: ["stat", "sponsor"],
    "concourse-a": ["stat", "sponsor"],
    "concourse-b": ["sponsor"],
  },
  corner: {
    main: ["tactical", "sponsor"],
    tunnel: ["sponsor"],
    ribbon: ["sponsor"],
    "concourse-a": ["sponsor"],
    "concourse-b": ["sponsor"],
  },
  goal: {
    main: ["stat", "walkout"],
    tunnel: ["walkout"],
    ribbon: ["stat", "sponsor"],
    "concourse-a": ["walkout", "stat", "sponsor"],
    "concourse-b": ["stat", "sponsor"],
  },
  "half-time": {
    main: ["stat", "sponsor"],
    tunnel: ["sponsor"],
    ribbon: ["sponsor"],
    "concourse-a": ["stat", "sponsor"],
    "concourse-b": ["tactical", "sponsor"],
  },
};

/** Which of the event's players or cards a screen takes: the big screens the first, the
 * concourse screens the next (wrapping round), so two screens rarely repeat each other. */
const SLOT: Record<ScreenId, number> = {
  main: 0,
  tunnel: 0,
  ribbon: 0,
  "concourse-a": 1,
  "concourse-b": 1,
};

/** The line over a featured player: why he is on the screen. */
export const PLAYER_KICKER: Record<EventType, string> = {
  "walk-out": "WALKING OUT",
  "key-look": "THE LOOK",
  "press-win": "PRESS WON",
  corner: "CORNER",
  goal: "GOAL",
  "half-time": "FIRST HALF",
};

/** A different sponsor on each screen, moving on one place with every event. */
export function sponsorFor(screen: ScreenId, eventIndex: number): Sponsor {
  const k = SCREEN_IDS.indexOf(screen);
  return SPONSORS[(eventIndex + k) % SPONSORS.length];
}

function fill(
  kind: ContentKind,
  screen: ScreenId,
  event: StudioEvent,
  eventIndex: number,
): Content | null {
  const at = <T>(list: T[]): T | undefined =>
    list.length ? list[SLOT[screen] % list.length] : undefined;
  switch (kind) {
    case "tactical":
      return event.still ? { kind, key: `tactical:${event.still.id}`, still: event.still } : null;
    case "stat": {
      const card = at(event.cards);
      return card ? { kind, key: `stat:${card.id}`, card } : null;
    }
    case "walkout": {
      const player = at(event.players);
      const kicker = PLAYER_KICKER[event.type];
      return player ? { kind, key: `walkout:${kicker}:${player.id}`, player, kicker } : null;
    }
    case "sponsor": {
      const sponsor = sponsorFor(screen, eventIndex);
      return { kind, key: `sponsor:${sponsor.id}`, sponsor };
    }
  }
}

/** What every screen shows for `event`, the `eventIndex`-th of the programme. */
export function assignScreens(event: StudioEvent, eventIndex: number): Assignment {
  const out = {} as Assignment;
  for (const screen of SCREEN_IDS) {
    const options = RULES[event.type][screen];
    const chosen = options.map((k) => fill(k, screen, event, eventIndex)).find((c) => c);
    // The last resort, for a goal with neither a card nor a scorer: the sponsor slot.
    out[screen] = chosen ?? fill("sponsor", screen, event, eventIndex)!;
  }
  return out;
}

export const KIND_LABEL: Record<ContentKind, string> = {
  tactical: "Tactical replay still",
  stat: "Stat card",
  walkout: "Walk-out",
  sponsor: "Sponsor slot",
};

/** A screen's content in words, for its accessible name. */
export function describeContent(c: Content): string {
  switch (c.kind) {
    case "tactical":
      return `${KIND_LABEL.tactical}: ${c.still.title}, everyone where they were at his decision`;
    case "stat":
      return `${KIND_LABEL.stat}, ${c.card.kicker.toLowerCase()}, ${c.card.title}: ${c.card.lines.join(" ")}`;
    case "walkout":
      return `${KIND_LABEL.walkout} (${c.kicker.toLowerCase()}): ${c.player.name}, number ${c.player.number}, ${c.player.club}`;
    case "sponsor":
      return `${KIND_LABEL.sponsor}: ${c.sponsor.name}, a fictional sponsor. ${c.sponsor.line}`;
  }
}

/** How many screen slots each sponsor gets over the whole programme (the rules' own count: no
 * audience behind it). */
export function sponsorSlots(events: StudioEvent[]): { sponsor: Sponsor; slots: number }[] {
  const count = new Map<string, number>();
  events.forEach((e, i) => {
    for (const c of Object.values(assignScreens(e, i))) {
      if (c.kind === "sponsor") count.set(c.sponsor.id, (count.get(c.sponsor.id) ?? 0) + 1);
    }
  });
  return SPONSORS.map((sponsor) => ({ sponsor, slots: count.get(sponsor.id) ?? 0 }));
}

// ---------- the programme the timeline plays ----------

const facts = (m: MomentFacts | null) => ({ cards: m?.cards ?? [], still: m?.still ?? null });

/** The matchday running order: one event of each type. The key look and the goal are moments in
 * the bundled files; the others are rehearsal cues (the corner and the match's other moments
 * live on the live service only), shown with no match facts. */
export function programme(f: StudioFacts): StudioEvent[] {
  const player = (id: string | undefined) => (id ? f.players[id] : undefined);
  const lookHero = player(f.look?.hero);
  const scorer = player(f.goal?.hero);
  const featured = [lookHero, scorer].filter((p): p is WalkoutPlayer => !!p);
  const look = f.look ? `${f.look.scenario} seed ${f.look.seed}` : null;
  const goal = f.goal ? `${f.goal.scenario} seed ${f.goal.seed}` : null;
  const rehearsal = (type: EventType, why: string): StudioEvent => ({
    id: type,
    type,
    label: EVENT_LABEL[type],
    note: `Rehearsal cue: ${why}`,
    rehearsal: true,
    players: [],
    cards: [],
    still: null,
  });
  return [
    {
      id: "walk-out",
      type: "walk-out",
      label: EVENT_LABEL["walk-out"],
      note: "Names, numbers and kits from the hero export's line-up",
      rehearsal: false,
      players: featured,
      cards: [],
      still: null,
    },
    look
      ? {
          id: "key-look",
          type: "key-look",
          label: EVENT_LABEL["key-look"],
          note: `The look, ${look}: verified lines and the board at his decision`,
          rehearsal: false,
          players: lookHero ? [lookHero] : [],
          ...facts(f.look),
        }
      : rehearsal("key-look", "the hero moment's files did not load"),
    rehearsal("press-win", "no press win in the bundled files"),
    rehearsal("corner", "the match's corner is served by the live service only"),
    goal
      ? {
          id: "goal",
          type: "goal",
          label: EVENT_LABEL.goal,
          note: `The goal, ${goal}: the scorer's verified look`,
          rehearsal: false,
          players: scorer ? [scorer] : [],
          ...facts(f.goal),
        }
      : rehearsal("goal", "the scorer's files did not load"),
    {
      id: "half-time",
      type: "half-time",
      label: EVENT_LABEL["half-time"],
      note: "The moments so far, from their verified lines",
      rehearsal: false,
      players: featured,
      cards: [...(f.look?.cards.slice(0, 1) ?? []), ...(f.goal?.cards ?? [])],
      still: f.look?.still ?? null,
    },
  ];
}

// ---------- changes on screen: no strobe (WCAG 2.3.1) ----------

/** A screen whose content changes dips to this brightness and back: a slow fade, never a flash
 * to white. */
export const FADE = { ms: 1200, dip: 0.3 } as const;
/** At most one change on screen per this many ms, however fast the timeline is scrubbed: with
 * one dip per change that is under one luminance pair a second (the guideline allows three). */
export const MIN_GAP_MS = 1500;

export type Transition = "hold" | "cut" | "fade";

/** How each screen goes from `prev` to `next`: unchanged content holds (no redraw); with reduced
 * motion it cuts; otherwise a slow fade. */
export function transitions(
  prev: Assignment | null,
  next: Assignment,
  reducedMotion: boolean,
): Record<ScreenId, Transition> {
  const out = {} as Record<ScreenId, Transition>;
  for (const s of SCREEN_IDS) {
    out[s] = prev && prev[s].key === next[s].key ? "hold" : reducedMotion || !prev ? "cut" : "fade";
  }
  return out;
}

/** Brightness of a fading screen `t` ms into its fade: down to the dip, the new content swaps in
 * at the bottom, back up. 1 outside the fade. */
export function fadeLevel(t: number, fade: { ms: number; dip: number } = FADE): number {
  if (t <= 0 || t >= fade.ms) return 1;
  const half = fade.ms / 2;
  const u = t < half ? t / half : (fade.ms - t) / half; // 0 at the edges, 1 at the bottom
  return 1 - (1 - fade.dip) * u;
}

/** When a change asked for at `now` may go on screen: at once, or `gap` ms after the last one. */
export function commitAt(lastShown: number | null, now: number, gap = MIN_GAP_MS): number {
  return lastShown === null ? now : Math.max(now, lastShown + gap);
}
