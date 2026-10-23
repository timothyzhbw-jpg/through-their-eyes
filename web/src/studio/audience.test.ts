// The Business value model (SPEC 7): deterministic, inside its documented ranges, keyed by the
// moment, the persona and the language, and labelled as demo data.

import { describe, expect, it } from "vitest";
import { PERSONAS } from "../api/client";
import {
  audienceOf,
  DEMO_LABEL,
  draw,
  hash32,
  percent,
  RANGES,
  withCommas,
  type AudienceInput,
} from "./audience";

const MOMENTS = Array.from({ length: 40 }, (_, i) => `m:decision_after_scan:H${i % 11}:${i}`);
const inputs = (): AudienceInput[] =>
  MOMENTS.flatMap((moment) =>
    PERSONAS.flatMap((persona) => ["en", "zh"].map((language) => ({ moment, persona, language }))),
  );

describe("audience model", () => {
  it("gives the same figures for the same moment, persona and language", () => {
    for (const input of inputs().slice(0, 50)) {
      expect(audienceOf(input)).toEqual(audienceOf({ ...input }));
    }
  });

  it("changes with any one of the three", () => {
    const base = audienceOf({ moment: "m:a", persona: "casual", language: "en" });
    expect(audienceOf({ moment: "m:b", persona: "casual", language: "en" })).not.toEqual(base);
    expect(audienceOf({ moment: "m:a", persona: "coach", language: "en" })).not.toEqual(base);
    expect(audienceOf({ moment: "m:a", persona: "casual", language: "zh" })).not.toEqual(base);
  });

  it("stays inside its ranges for every moment, persona and language", () => {
    const all = inputs();
    expect(all.length).toBe(400);
    for (const input of all) {
      const a = audienceOf(input);
      const where = JSON.stringify(input);
      expect(a.impressions, where).toBeGreaterThanOrEqual(RANGES.impressions.min);
      expect(a.impressions, where).toBeLessThanOrEqual(RANGES.impressions.max);
      expect(a.engagementRate, where).toBeGreaterThanOrEqual(RANGES.engagementRate.min);
      expect(a.engagementRate, where).toBeLessThanOrEqual(RANGES.engagementRate.max);
      expect(a.clickThrough, where).toBeGreaterThanOrEqual(RANGES.clickThrough.min);
      expect(a.clickThrough, where).toBeLessThanOrEqual(RANGES.clickThrough.max);
      expect(a.recall, where).toBeGreaterThanOrEqual(RANGES.recall.min);
      expect(a.recall, where).toBeLessThanOrEqual(RANGES.recall.max);
      expect(a.sponsorImpressions, where).toBeLessThanOrEqual(a.impressions);
      expect(a.sponsorImpressions, where).toBeGreaterThanOrEqual(
        Math.floor(a.impressions * RANGES.sponsorShare.min),
      );
      expect(a.clicks, where).toBeLessThanOrEqual(a.engagements + a.impressions);
      expect(Number.isInteger(a.impressions)).toBe(true);
      expect(a.label).toBe(DEMO_LABEL);
    }
  });

  it("is not constant: the draws spread over the range", () => {
    const rates = inputs().map((i) => audienceOf(i).engagementRate);
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.02);
  });

  it("draws uniformly in [0, 1) per metric", () => {
    const u = MOMENTS.map((m) => draw(m, "impressions"));
    expect(u.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(draw("s", "a")).not.toBe(draw("s", "b"));
    expect(hash32("a")).toBe(hash32("a"));
  });

  it("says what it is", () => {
    expect(DEMO_LABEL).toBe("Demo data: simulated audience, not real results");
  });

  it("formats figures the same on any locale", () => {
    expect(withCommas(1234567)).toBe("1,234,567");
    expect(withCommas(999)).toBe("999");
    expect(percent(0.0456)).toBe("4.6%");
  });
});
