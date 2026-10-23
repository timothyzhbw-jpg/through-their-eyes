// The Business value panel's numbers (SPEC 7, docs/SUBMISSION.md "Business model"): a seeded
// synthetic audience, not a measurement. Nobody has watched this app, so impressions, engagement,
// click-through and the sponsor figures are drawn from a deterministic model written here. Each is
// a draw inside a documented range, nudged by the persona and the language, and keyed by the
// moment, the persona and the language: the same three always give the same figures, a different
// one gives different figures. Everything it returns is labelled DEMO_LABEL on screen.
//
// Assumptions (the panel prints them from RANGES and the two tables below):
// - The ranges are plausible orders of magnitude for one short clip on one fan-app channel, not
//   benchmarks: no source backs them.
// - A persona scales reach (how many see it) and engagement (how many do something with it): the
//   casual fan reaches most people, the analyst and the coach reach fewer and engage more.
// - A language scales reach only: `en` is the larger audience, `zh` the smaller.
// - Click-through is clicks to the "Official watch" entry over impressions.
// - Sponsor impressions are the impressions on which the (invented) sponsor's board was in frame.
// - The recall proxy is the share of those sponsor impressions that would name the sponsor
//   afterwards. It is a proxy: no survey stands behind it.

import type { Persona } from "../api/client";

export const DEMO_LABEL = "Demo data: simulated audience, not real results";

/** The invented sponsor whose board is in frame (no real brand). */
export const SPONSOR = "Brindlewick Water";

export interface Range {
  min: number;
  max: number;
}

export const RANGES = {
  impressions: { min: 20_000, max: 500_000 },
  engagementRate: { min: 0.02, max: 0.09 }, // engagements / impressions
  clickThrough: { min: 0.005, max: 0.03 }, // "Official watch" clicks / impressions
  sponsorShare: { min: 0.35, max: 0.8 }, // sponsor impressions / impressions
  recall: { min: 0.08, max: 0.32 }, // sponsor recall proxy
} as const satisfies Record<string, Range>;

/** Reach multiplier and engagement multiplier per persona; 1 is the middle of the range. */
export const PERSONA_FACTORS: Record<Persona, { reach: number; engagement: number }> = {
  casual: { reach: 1, engagement: 0.9 },
  player_fan: { reach: 0.8, engagement: 1.2 },
  analyst: { reach: 0.5, engagement: 1.4 },
  coach: { reach: 0.4, engagement: 1.3 },
  audio_description: { reach: 0.25, engagement: 1.1 },
};

/** Reach multiplier per language. */
export const LANGUAGE_REACH: Record<string, number> = { en: 1, zh: 0.8 };

export interface AudienceInput {
  moment: string;
  persona: Persona;
  language: string;
}

export interface Audience {
  impressions: number;
  engagementRate: number; // 0..1
  engagements: number;
  clickThrough: number; // 0..1
  clicks: number; // to the "Official watch" entry
  sponsorImpressions: number;
  recall: number; // 0..1
  label: typeof DEMO_LABEL;
}

/** FNV-1a, 32 bit: a string to a seed. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One uniform draw in [0, 1), keyed by the seed string and the metric it is for (mulberry32's
 * mix of the hash), so each metric has its own stream and adding one never moves the others. */
export function draw(seed: string, metric: string): number {
  let a = (hash32(`${seed}|${metric}`) + 0x6d2b79f5) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

const clamp = (x: number, r: Range) => Math.min(r.max, Math.max(r.min, x));
const lerp = (u: number, r: Range) => r.min + u * (r.max - r.min);

export function audienceOf(input: AudienceInput): Audience {
  const seed = `${input.moment}|${input.persona}|${input.language}`;
  const persona = PERSONA_FACTORS[input.persona] ?? { reach: 1, engagement: 1 };
  const reach = persona.reach * (LANGUAGE_REACH[input.language] ?? 1);

  // Reach is log-uniform over the range, so small audiences are as likely as large ones.
  const { min, max } = RANGES.impressions;
  const raw = min * Math.pow(max / min, draw(seed, "impressions"));
  const impressions = Math.round(clamp(raw * reach, RANGES.impressions) / 100) * 100;

  const engagementRate = clamp(
    lerp(draw(seed, "engagement"), RANGES.engagementRate) * persona.engagement,
    RANGES.engagementRate,
  );
  const clickThrough = clamp(lerp(draw(seed, "ctr"), RANGES.clickThrough), RANGES.clickThrough);
  const sponsorShare = lerp(draw(seed, "sponsor"), RANGES.sponsorShare);
  const recall = lerp(draw(seed, "recall"), RANGES.recall);

  return {
    impressions,
    engagementRate,
    engagements: Math.round(impressions * engagementRate),
    clickThrough,
    clicks: Math.round(impressions * clickThrough),
    sponsorImpressions: Math.round(impressions * sponsorShare),
    recall,
    label: DEMO_LABEL,
  };
}

/** 123456 -> "123,456" (fixed, so the page and the tests read the same on any locale). */
export const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const percent = (x: number): string => `${(x * 100).toFixed(1)}%`;
