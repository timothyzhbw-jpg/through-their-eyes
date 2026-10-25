// The social copy (SPEC 7): never a number a verified claim does not carry, both languages, three
// formats, the invented clubs' hashtags; plus the shot list and the card specs it shares data with.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { CLUBS } from "../data/roster";
import { validatePayload, type Narration, type RenderPayload } from "../narration/payload";
import { heroMoment } from "../plan/moment";
import { templatePlan } from "../plan/template";
import { audienceOf, percent, SPONSOR, withCommas } from "./audience";
import { CARD_DIMENSIONS, CARD_SIZES, cardSpec, wrap } from "./cards";
import {
  allowedNumbers,
  checked,
  clubOf,
  facts,
  FACTS,
  hashtags,
  numbersIn,
  POST_FORMATS,
  POST_LANGUAGES,
  postsOf,
  type PostContext,
} from "./posts";
import { shotList, shotListText } from "./shotlist";

const hero = parseHero(raw);
const moment = heroMoment(hero);
const fixture = payloadJson as RenderPayload;

function narrationOf(payload: RenderPayload): Narration {
  const v = validatePayload(payload, moment, hero);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return v.narration;
}
const context = (narration: Narration): PostContext => ({
  narration,
  hero: hero.heroId!,
  runner: hero.runnerId,
});

/** A payload in `language` whose claims carry every value the templates read. */
const rich = (language: string): RenderPayload => ({
  ...fixture,
  language,
  claims: [
    ...fixture.claims,
    {
      id: "gap_to_nearest_opponent",
      kind: "computed",
      verdict: "supported",
      values: { gap: 3.4 },
      evidence: [],
      seek_frame: 75,
    },
    {
      id: "gap_opened",
      kind: "computed",
      verdict: "supported",
      values: { gain: 2.1 },
      evidence: [],
      seek_frame: 75,
    },
    {
      id: "observed_share",
      kind: "computed",
      verdict: "supported",
      values: { window_s: 2, share: 41 },
      evidence: [],
      seek_frame: 50,
    },
    {
      id: "pass_speed",
      kind: "computed",
      verdict: "supported",
      values: { kmh: 61.2 },
      evidence: [],
      seek_frame: 75,
    },
    {
      id: "time_since_last_scan",
      kind: "computed",
      verdict: "supported",
      values: { secs: 1.4 },
      evidence: [],
      seek_frame: 50,
    },
  ],
});

describe("posts", () => {
  const all: [string, Narration][] = [
    ["the fixture", narrationOf(fixture)],
    ["a zh breakdown", narrationOf({ ...fixture, language: "zh" })],
    ["every template's claim", narrationOf(rich("en"))],
    ["every template's claim, zh", narrationOf(rich("zh"))],
  ];

  it.each(all)("%s: every number is a supported claim's value", (_, narration) => {
    const allowed = allowedNumbers(narration);
    expect(allowed.size).toBeGreaterThan(0);
    for (const lang of POST_LANGUAGES) {
      const localized = new Set([
        ...allowed,
        ...(lang === "zh" ? [...allowed].map((value) => value * 100) : []),
      ]);
      const posts = postsOf(context(narration), lang);
      for (const format of POST_FORMATS) {
        for (const n of numbersIn(posts[format])) {
          expect(localized.has(Number(n)), `${lang} ${format}: ${n} in\n${posts[format]}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("prints no id, frame or moment-id digit", () => {
    const posts = postsOf(context(narrationOf(fixture)), "en");
    for (const format of POST_FORMATS) {
      expect(posts[format]).not.toMatch(/\bH\d|\bA\d|m:|frame/);
    }
  });

  it("drops a sentence whose number is not a claim's", () => {
    const allowed = new Set([0.3]);
    expect(checked("off by 0.30 metres", allowed)).toBe(true);
    expect(checked("off by 0.4 metres", allowed)).toBe(false);
    const wrong: RenderPayload = {
      ...fixture,
      lines: fixture.lines.map((l) =>
        l.id === "L3" ? { ...l, text: "He was off by 9 metres." } : l,
      ),
    };
    const sentences = facts(context(narrationOf(wrong)), "en");
    expect(sentences.some((s) => s.includes("9 metres"))).toBe(false);
  });

  it("uses a template for every claim a language has no narration of", () => {
    const sentences = facts(context(narrationOf(rich("en"))), "zh");
    expect(sentences.length).toBeLessThanOrEqual(FACTS.length);
    expect(sentences.length).toBeGreaterThanOrEqual(8);
    for (const s of sentences) expect(s).toMatch(/[一-鿿]/);
    expect(sentences.join("")).toContain("瓦恩霍尔");
    expect(sentences.join("")).not.toMatch(/[A-Za-z]/);
  });

  it("uses the narration's own lines in its language, without its opening question", () => {
    const sentences = facts(context(narrationOf(fixture)), "en");
    expect(sentences).toContain("J. Ferriday scanned once in the 2 seconds before receiving.");
    expect(sentences.some((s) => s.includes("What did he see"))).toBe(false);
  });

  it("states nothing for a claim that is not supported", () => {
    const refuted: RenderPayload = {
      ...rich("en"),
      claims: rich("en").claims.map((c) =>
        c.id === "pass_speed" ? { ...c, verdict: "refuted" as const } : c,
      ),
    };
    const s = facts(context(narrationOf(refuted)), "zh").join("");
    expect(s).not.toContain("61.2");
  });

  it("gives three formats in each language, with the clubs' hashtags", () => {
    const ctx = context(narrationOf(fixture));
    for (const lang of POST_LANGUAGES) {
      const posts = postsOf(ctx, lang);
      expect(Object.keys(posts).sort()).toEqual([...POST_FORMATS].sort());
      const tags = hashtags(lang);
      expect(tags.length).toBe(3);
      for (const format of POST_FORMATS) for (const t of tags) expect(posts[format]).toContain(t);
    }
    expect(hashtags("en")).toEqual(["#ThroughTheirEyes", "#KestrelBay", "#CorvaneVale"]);
    expect(hashtags("zh")).toContain(`#${CLUBS[0].zh}`);
    expect(postsOf(ctx, "zh").carousel).not.toMatch(/[A-Za-z]/);
    expect(postsOf(ctx, "en").short.length).toBeLessThan(280);
  });

  it("says the match is synthetic", () => {
    const ctx = context(narrationOf(fixture));
    expect(postsOf(ctx, "en").carousel).toContain("Synthetic match");
    expect(postsOf(ctx, "zh").carousel).toContain("模拟比赛");
  });

  it("is the same every time", () => {
    const ctx = context(narrationOf(fixture));
    expect(postsOf(ctx, "en")).toEqual(postsOf(ctx, "en"));
  });
});

describe("data card specs", () => {
  const narration = narrationOf(rich("en"));

  it("shows only supported claims' numbers, at most three", () => {
    const allowed = allowedNumbers(narration);
    for (const size of CARD_SIZES) {
      const spec = cardSpec(narration, hero.heroId!, hero.runnerId, size, "en");
      expect(spec.width).toBe(CARD_DIMENSIONS[size].width);
      expect(spec.height).toBe(CARD_DIMENSIONS[size].height);
      expect(spec.stats.length).toBe(3);
      for (const s of spec.stats) expect(checked(s.value, allowed)).toBe(true);
    }
    expect(CARD_DIMENSIONS.square).toMatchObject({ width: 1080, height: 1080 });
    expect(CARD_DIMENSIONS.story).toMatchObject({ width: 1080, height: 1920 });
    expect(CARD_DIMENSIONS.wide).toMatchObject({ width: 1920, height: 1080 });
  });

  it("says so when no number is verified, and writes zh with no Latin letters in the words", () => {
    const none = narrationOf({
      ...fixture,
      claims: fixture.claims.map((c) => ({ ...c, values: {} })),
    });
    const spec = cardSpec(none, hero.heroId!, hero.runnerId, "square", "en");
    expect(spec.stats).toEqual([]);
    expect(spec.empty).toBeTruthy();
    const zh = cardSpec(narration, hero.heroId!, hero.runnerId, "story", "zh");
    expect(zh.title + zh.kicker + zh.footer).not.toMatch(/[A-Za-z]/);
  });

  it("wraps text to a width", () => {
    const measure = { measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics };
    expect(wrap(measure, "one two three four", 85)).toEqual(["one two", "three", "four"]);
    expect(wrap(measure, "一二三四五六", 30)).toEqual(["一二三", "四五六"]);
  });
});

describe("shot list", () => {
  const script = { L1: "Look at H8.", L2: "He scanned." };

  it("cuts the template plan into shots inside the clip, with camera and frames", () => {
    const shots = shotList(templatePlan(moment), moment, {});
    expect(shots.length).toBeGreaterThanOrEqual(2);
    expect(shots[0].camera).toBe("pov");
    expect(shots[0].player).toBe(hero.heroId);
    for (const s of shots) {
      expect(s.inFrame).toBeGreaterThanOrEqual(0);
      expect(s.outFrame).toBeLessThan(moment.frames);
      expect(s.outFrame).toBeGreaterThan(s.inFrame);
      expect(s.seconds).toBeGreaterThan(0);
    }
    expect(shots.map((s) => s.n)).toEqual(shots.map((_, k) => k + 1));
  });

  it("is deterministic and puts each voice line under the shot it is spoken in", () => {
    const plan = templatePlan(moment);
    const povT = plan.steps.find((s) => s.do === "pov")!.t;
    const withVoice = {
      ...plan,
      steps: [...plan.steps, { t: povT + 0.1, do: "voice" as const, line: "L1" }].sort(
        (a, b) => a.t - b.t,
      ),
    };
    const a = shotList(withVoice, moment, script);
    expect(a).toEqual(shotList(withVoice, moment, script));
    expect(a[0].caption).toBe("Look at J. Ferriday.");
    expect(shotListText(a)).toContain("frames");
  });
});

describe("review points", () => {
  it("accepts a number printed rounded to the decimals the text gives it", () => {
    const allowed = new Set([3.456]);
    expect(checked("3.5 m", allowed)).toBe(true);
    expect(checked("3.46 m", allowed)).toBe(true);
    expect(checked("3.6 m", allowed)).toBe(false);
  });

  it("keeps a rounded claim value on the card", () => {
    const base = rich("en");
    const payload: RenderPayload = {
      ...base,
      claims: [
        ...base.claims.map((c) => (c.id === "belief_error" ? { ...c, values: { err: 0.346 } } : c)),
      ],
    };
    const spec = cardSpec(narrationOf(payload), hero.heroId!, hero.runnerId, CARD_SIZES[0], "en");
    expect(spec.stats.map((s) => s.value)).toContain("0.3 m");
  });

  it("never prints a demo audience figure in a post or a card", () => {
    const a = audienceOf({ moment: "m:x", persona: "casual", language: "en" });
    const figures = [percent(a.recall), withCommas(a.sponsorImpressions), SPONSOR];
    const narration = narrationOf(rich("en"));
    for (const lang of POST_LANGUAGES) {
      const text = JSON.stringify([
        postsOf(context(narration), lang),
        cardSpec(narration, hero.heroId!, hero.runnerId, CARD_SIZES[0], lang),
      ]);
      for (const f of figures) expect(text).not.toContain(f);
    }
  });

  it("names the hero's club by one function", () => {
    expect(clubOf("A5")).toBe(1);
    expect(clubOf("H5")).toBe(0);
  });
});
