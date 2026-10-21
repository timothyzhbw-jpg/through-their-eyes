// The tactics cards (SPEC 4.8): "Why build from the back?" and "Why focus on set pieces?",
// GET /api/matches/<id>/tactics (explain/tactics.py). The cards' numbers are measured from the
// tracking and the event feed (analytics/tactics.py), like the live stats; each card's one
// sentence is a verified claim, rendered by the service with every number in a checked slot.
// Nothing here computes a number: it parses, picks the sentence for a language and formats.

import { z } from "zod";
import { RenderPayload, type PayloadClaim, type PayloadLine } from "../narration/payload";

const Group = z.object({
  passes: z.number().int(),
  completed: z.number().int(),
  completion: z.number().nullable(),
  xt: z.number().nullable(),
});
export type Group = z.infer<typeof Group>;

const TeamBuildUp = z.object({
  team: z.number().int(),
  all: Group,
  pressed: Group,
  unpressed: Group,
  short: Group,
  long: Group,
  pressed_short: Group,
  unpressed_short: Group,
  line_breaking: z.number().int(),
  line_breaking_pressed: z.number().int(),
  lost: z.number().int(),
  lost_xt: z.number().nullable(),
  lost_pressed_short: z.number().int(),
  lost_pressed_short_xt: z.number().nullable(),
  pressed_short_ids: z.array(z.string()),
});
export type TeamBuildUp = z.infer<typeof TeamBuildUp>;

const Option = z.object({
  action: z.string(),
  kind: z.string(),
  to: z.string().nullable(),
  length_m: z.number().nullable(),
  long: z.boolean(),
  p_success: z.number(),
  value: z.number(),
});
export type Option = z.infer<typeof Option>;

const Alternative = z.object({
  id: z.string(),
  frame: z.number().int(),
  t: z.number(),
  possession: z.number().int(),
  scenario: z.string(),
  player: z.string(),
  team: z.number().int(),
  pressure: z.number().nullable(),
  options: z.number().int(),
  chosen: Option,
  best_short: Option.nullable(),
  best_long: Option.nullable(),
  safest: Option.nullable(),
});
export type Alternative = z.infer<typeof Alternative>;

const Corner = z.object({
  possession: z.number().int(),
  scenario: z.string(),
  frame: z.number().int(),
  t: z.number(),
  team: z.number().int(),
  played: z.boolean(),
  shots: z.number().int(),
  xg: z.number(),
  peak_xt: z.number().nullable(),
  peak_frame: z.number().int().nullable(),
  peak_s: z.number().nullable(),
  peak_player: z.string().nullable(),
  peak_pass: z.string().nullable(),
});
export type Corner = z.infer<typeof Corner>;

const Shot = z.object({
  id: z.string(),
  frame: z.number().int(),
  t: z.number(),
  player: z.string(),
  team: z.number().int(),
  possession: z.number().int(),
  set_piece: z.boolean(),
  xg: z.number(),
});

const SetPieces = z.object({
  awarded: z.number().int(),
  corners: z.number().int(),
  shots_from_corners: z.number().int(),
  xg_from_corners: z.number(),
  xg_per_corner: z.number().nullable(),
  shots: z.number().int(),
  xg: z.number(),
  shot_share: z.number().nullable(),
  xg_share: z.number().nullable(),
  open_play: z.number().int(),
  open_play_peak_median: z.number().nullable(),
  best: Corner.nullable(),
  below_best: z.number().int(),
  corner_list: z.array(Corner),
  shot_list: z.array(Shot),
});
export type SetPieces = z.infer<typeof SetPieces>;

const Definitions = z.object({
  pressed: z.number(),
  long_pass_m: z.number(),
  min_bypassed: z.number().int(),
  set_pieces: z.array(z.string()),
  sources: z.array(z.string()),
});

export const TacticsCards = z.object({
  version: z.literal(1),
  match: z.string(),
  kind: z.enum(["hero", "match"]),
  dt: z.number(),
  source: z.literal("tracking"),
  definitions: Definitions,
  build_up: z.object({
    team: z.number().int(),
    teams: z.array(TeamBuildUp).length(2),
    alternatives: z.array(Alternative),
  }),
  set_pieces: SetPieces,
});
export type TacticsCards = z.infer<typeof TacticsCards>;

export const TacticsView = z.object({
  cards: TacticsCards,
  lines: z.record(z.string(), RenderPayload),
});
export type TacticsView = z.infer<typeof TacticsView>;

export type CardId = "build_up" | "set_pieces";

/** A card's verified sentence: its line and the claims behind it, every one supported. */
export interface Sentence {
  line: PayloadLine;
  claims: PayloadClaim[];
  language: string; // the payload's: English when there is none in the language asked for
}

export function parseTactics(raw: unknown): TacticsView {
  return TacticsView.parse(raw);
}

/**
 * The card's sentence in `language` (English when there is none in it), or null. A line airs
 * only when every claim it cites is in the payload and supported, as the narration checks it.
 */
export function sentence(view: TacticsView, card: CardId, language: string): Sentence | null {
  for (const lang of [language, "en"]) {
    const payload = view.lines[lang];
    const line = payload?.lines.find((l) => l.id === card);
    if (!payload || !line) continue;
    const claims = line.claims.map((id) => payload.claims.find((c) => c.id === id));
    if (claims.every((c) => c?.verdict === "supported")) {
      return { line, claims: claims as PayloadClaim[], language: lang };
    }
  }
  return null;
}

/** The earliest frame a sentence's evidence seeks to, or null. */
export function seekFrame(s: Sentence): number | null {
  const frames = s.claims.flatMap((c) => (c.seek_frame == null ? [] : [c.seek_frame]));
  return frames.length ? Math.min(...frames) : null;
}

const DASH = "–";
const MINUS = "−";

export const TEAM = ["Home", "Away"] as const;

/** 0.684 → "68%" (half up, as the service rounds the sentence's percentages). */
export function pct(ratio: number | null): string {
  return ratio === null ? DASH : `${Math.round(ratio * 100)}%`;
}

/** "13/19 · 68%". */
export function share(g: Group): string {
  return g.passes ? `${g.completed}/${g.passes} · ${pct(g.completion)}` : DASH;
}

/** A signed xT value: "+0.013", "−0.003". */
export function signed(value: number | null, digits = 3): string {
  if (value === null) return DASH;
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${value < 0 ? MINUS : "+"}${text}`;
}

export function fixed(value: number | null, digits = 2): string {
  return value === null ? DASH : value.toFixed(digits);
}

/** Seconds on the clock as m:ss. */
export function clock(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "H7, 35 m": who an option goes to and how far. */
export function optionLabel(o: Option): string {
  if (o.kind !== "pass") return o.kind;
  const m = o.length_m === null ? "" : `, ${Math.round(o.length_m)} m`;
  return `${o.to ?? DASH}${m}`;
}
