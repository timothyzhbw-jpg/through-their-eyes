// The tours' step lists (SPEC 7): they parse, they read in plain words with no number of their
// own, the full tour lasts about ninety seconds and the quick one under a minute, and each page
// gets the steps it can show.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { parseDeepLink } from "../deeplink";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { API, fakeFetch, MATCH, matchExport, pressureExport } from "../testing";
import { placeCard } from "./layout";
import stepsJson from "./steps.json";
import {
  envOf,
  indexOf,
  kindOf,
  LEGACY_STEP_IDS,
  QUICK_IDS,
  QUICK_STEPS,
  quickTourFits,
  resolveSteps,
  STEP_IDS,
  StepList,
  STEPS,
  STORY_IDS,
  STORY_STEPS,
  wordsOf,
  type TourEnv,
} from "./steps";

const hero = parseHero(raw);
const api = () => createApi(API, "blind_side_run-3", fakeFetch({}));
const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);
const online = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, { api: api() });
const ids = (env: TourEnv) => resolveSteps(env).map((s) => s.id);

describe("the step list", () => {
  it("parses, with unique ids across the tours, none an old id that now lands elsewhere", () => {
    expect(() => StepList.parse(stepsJson)).not.toThrow();
    const all = [...STEP_IDS, ...QUICK_IDS, ...STORY_IDS];
    expect(new Set(all).size).toBe(all.length);
    expect(QUICK_IDS.map(kindOf)).toEqual(["quick", "quick", "quick", "quick", "quick"]);
    expect(STEP_IDS.map(kindOf).every((k) => k === "full")).toBe(true);
    expect(STORY_IDS.map(kindOf).every((k) => k === "story")).toBe(true);
    for (const [old, now] of Object.entries(LEGACY_STEP_IDS)) {
      expect(all, old).not.toContain(old);
      expect(all, old).toContain(now);
    }
  });

  it("walks the three doors in order, then the match, and ends on a closing card", () => {
    expect(STEP_IDS).toEqual([
      "pov",
      "without",
      "evidence",
      "tamper",
      "language",
      "yourcall",
      "eyes",
      "studios",
      "producer",
      "match",
      "recap",
      "end",
    ]);
    const doors = STEPS.map((s) => s.door).filter(Boolean);
    expect([...new Set(doors)]).toEqual(["look", "turn", "studios"]);
    expect(STEPS.find((s) => s.id === "producer")!.journey).toBe("commentary");
    expect(STEPS.at(-1)!.target).toBeNull();
  });

  it("lasts about ninety seconds", () => {
    const total = STEPS.reduce((t, s) => t + s.hold, 0);
    expect(total).toBeGreaterThanOrEqual(75);
    expect(total).toBeLessThanOrEqual(105);
  });

  it("says one plain line per step: no digits, no player ids, no markup", () => {
    for (const s of [...STEPS, ...QUICK_STEPS, ...STORY_STEPS]) {
      for (const text of [s.title, s.caption, ...(s.variants ?? []).map((v) => v.caption)]) {
        expect(text, s.id).not.toMatch(/\d/);
        expect(text, s.id).not.toMatch(/[<>\n]/);
        expect(text.length, s.id).toBeLessThanOrEqual(150);
      }
    }
  });

  it("fills its slots from the moment, and still has no number once filled", () => {
    for (const session of [offline(), createSession(parseHero(pressureExport()), null, null)]) {
      const env = envOf(session);
      for (const s of [...resolveSteps(env), ...resolveSteps(env, QUICK_STEPS)]) {
        const { title, caption } = wordsOf(s, env);
        expect(`${title} ${caption}`, s.id).not.toMatch(/[{}\d]/);
      }
    }
    const env = envOf(offline());
    expect(wordsOf(STEPS[1], env).title).toBe("Without the scan");
    expect(wordsOf(STEPS[1], env).caption).toContain("one change, without the scan.");
  });
});

describe("the quick tour: door 1's story", () => {
  it("is one path: the look, without it, the outcomes compared, every number checked, the doors", () => {
    expect(QUICK_IDS).toEqual(["look", "remove", "compare", "verify", "next"]);
    const env = envOf(offline());
    expect(QUICK_STEPS.map((s) => wordsOf(s, env).title)).toEqual([
      "Watch the look",
      "Now remove it",
      "Compare the outcomes",
      "Every number is checked",
      "That's the look",
    ]);
    expect(wordsOf(QUICK_STEPS[0], env).caption).toContain("J. Ferriday's view");
    expect(wordsOf(QUICK_STEPS[1], env).caption).toContain("re-simulated without the scan.");
    expect(QUICK_STEPS.every((s) => s.door === "look")).toBe(true);
    // The compare step links to the scan story; the last step is the end card with the doors.
    expect(QUICK_STEPS.find((s) => s.id === "compare")!.act).toBe("scanSteps");
    expect(QUICK_STEPS.at(-1)!.act).toBe("doors");
  });

  it("takes about a minute", () => {
    expect(QUICK_STEPS.reduce((t, s) => t + s.hold, 0)).toBeLessThanOrEqual(60);
  });

  it("fits a hero moment with a key scan and the run without it, and nothing else", () => {
    // The check needs the live service, so offline the path is the other four.
    expect(resolveSteps(envOf(offline()), QUICK_STEPS).map((s) => s.id)).toEqual([
      "look",
      "remove",
      "compare",
      "next",
    ]);
    expect(resolveSteps(envOf(online()), QUICK_STEPS).map((s) => s.id)).toEqual(QUICK_IDS);
    expect(quickTourFits(envOf(offline()))).toBe(true);
    const plain = envOf(createSession(hero, EXAMPLE_PLAN, payloadJson));
    expect(resolveSteps(plain, QUICK_STEPS).map((s) => s.id)).toEqual([
      "look",
      "remove",
      "compare",
      "next",
    ]);
    expect(quickTourFits(plain)).toBe(true);
    const press = envOf(
      createSession(parseHero(pressureExport()), null, null, null, { api: api() }),
    );
    expect(quickTourFits(press)).toBe(false);
    const match = createMatchSession(parseHero(matchExport()), {
      api: createApi(API, MATCH, fakeFetch({})),
      dataUrl: "/data/",
    });
    expect(resolveSteps(envOf(match), QUICK_STEPS)).toEqual([]);
    expect(quickTourFits(envOf(match))).toBe(false);
  });

  it("lands on the asked step of its own list", () => {
    const steps = resolveSteps(envOf(createSession(hero, EXAMPLE_PLAN, payloadJson)), QUICK_STEPS);
    expect(steps[indexOf(steps, "compare")].id).toBe("compare");
    expect(steps[indexOf(steps, "next")].id).toBe("next");
    // No service: verify is left out, and the next step this page shows is the end card.
    const shown = resolveSteps(envOf(offline()), QUICK_STEPS);
    expect(shown[indexOf(shown, "verify")].id).toBe("next");
  });
});

describe("the studios' walk", () => {
  it("opens door 3's four solutions, then Value, in order", () => {
    expect(STORY_IDS).toEqual([
      "story-broadcast",
      "story-commentary",
      "story-highlights",
      "story-stadium",
      "story-value",
    ]);
    expect(STORY_STEPS.map((s) => s.journey)).toEqual([
      "broadcast",
      "commentary",
      "highlights",
      "stadium",
      "value",
    ]);
    expect(STORY_STEPS.every((s) => s.door === "studios")).toBe(true);
  });
});

describe("the steps a page can show", () => {
  it("on the hero moment, offline: everything but what needs the live service", () => {
    expect(ids(envOf(offline()))).toEqual([
      "pov",
      "without",
      "evidence",
      "yourcall",
      "eyes",
      "studios",
      "end",
    ]);
  });

  it("on the hero moment with the live service: every step but the match's own", () => {
    expect(ids(envOf(online()))).toEqual(STEP_IDS.filter((id) => id !== "recap"));
  });

  it("on the pressure hero: no key scan, so the replay step says so; its own run name", () => {
    const press = createSession(parseHero(pressureExport()), null, null, null, { api: api() });
    const env = envOf(press);
    expect(env.has.keyScan).toBe(false);
    expect(wordsOf(STEPS[0], env).caption).toContain("every look he made");
    expect(wordsOf(STEPS[1], env).title).toBe("If he carried it");
    // No bundled what-ifs for this stand-in: Your call lists its options, most not re-simulated.
    expect(ids(env)).toEqual([
      "pov",
      "without",
      "evidence",
      "tamper",
      "language",
      "yourcall",
      "eyes",
      "studios",
      "producer",
      "match",
      "end",
    ]);
  });

  it("on a moment with no bundled look grid: no Take his eyes", () => {
    const other = { ...pressureExport(), seed: 7 }; // press_escape has a grid on seed 0 only
    const env = envOf(createSession(parseHero(other), null, null, null, { api: api() }));
    expect(env.has.takeEyes).toBe(false);
    expect(ids(env)).not.toContain("eyes");
    expect(envOf(offline()).has.takeEyes).toBe(true);
  });

  it("on a stitched match: its recap, then the end", () => {
    const match = createMatchSession(parseHero(matchExport()), {
      api: createApi(API, MATCH, fakeFetch({})),
      dataUrl: "/data/",
    });
    expect(ids(envOf(match))).toEqual(["recap", "end"]);
    // ?match=…&tour=1 lands on the match's first step.
    const steps = resolveSteps(envOf(match));
    expect(steps[indexOf(steps, "pov")].id).toBe("recap");
  });

  it("lands on the asked step, or the next one this page shows", () => {
    const steps = resolveSteps(envOf(offline())); // no tamper, language or producer
    expect(steps[indexOf(steps, "evidence")].id).toBe("evidence");
    expect(steps[indexOf(steps, "tamper")].id).toBe("yourcall");
    expect(steps[indexOf(steps, "language")].id).toBe("yourcall");
    expect(steps[indexOf(steps, "producer")].id).toBe("end");
    expect(steps[indexOf(steps, "eyes")].id).toBe("eyes");
    expect(indexOf(steps, null)).toBe(0);
    expect(indexOf(steps, "nope")).toBe(0);
  });
});

describe("the tour link", () => {
  it("?tour=1 starts the full tour at its first step, with no intro card and no autoplay", () => {
    const link = parseDeepLink("?tour=1");
    expect(link.tour).toBe("pov");
    expect(link.intro).toBe(false);
    expect(link.autoplay).toBe(false);
    expect(link.warnings).toEqual([]);
  });

  it("?tour=quick starts the quick tour at its first step, with no intro card", () => {
    const link = parseDeepLink("?tour=quick");
    expect(link.tour).toBe("look");
    expect(kindOf(link.tour!)).toBe("quick");
    expect(link.intro).toBe(false);
    expect(link.autoplay).toBe(false);
    expect(parseDeepLink("?tour=compare").tour).toBe("compare");
  });

  it("?tour=story walks door 3; a step id from before lands where it went", () => {
    expect(parseDeepLink("?tour=story").tour).toBe("story-broadcast");
    expect(parseDeepLink("?tour=story-event").tour).toBe("look");
    expect(parseDeepLink("?tour=story-without").tour).toBe("remove");
    expect(parseDeepLink("?tour=story-view").tour).toBe("story-broadcast");
    expect(parseDeepLink("?tour=story-crew").tour).toBe("story-commentary");
    expect(parseDeepLink("?tour=call").tour).toBe("yourcall");
    expect(parseDeepLink("?tour=story-event").warnings).toEqual([]);
  });

  it("?tour=<step> starts there; anything else is ignored and logged", () => {
    expect(parseDeepLink("?tour=producer").tour).toBe("producer");
    const bad = parseDeepLink("?tour=nope");
    expect(bad.tour).toBeNull();
    expect(bad.warnings).toEqual(["tour=nope"]);
    expect(parseDeepLink("").tour).toBeNull();
  });
});

describe("where the tour card sits", () => {
  const card = { w: 400, h: 180 };
  const inside = (p: { top: number; left: number; width: number }, w: number, h: number) => {
    expect(p.left).toBeGreaterThanOrEqual(16);
    expect(p.left + p.width).toBeLessThanOrEqual(w - 16);
    expect(p.top).toBeGreaterThanOrEqual(16);
    expect(p.top + card.h).toBeLessThanOrEqual(h - 16);
  };

  it("on a phone: full width inside a 16 px gutter, on the half away from the target", () => {
    const phone = { w: 375, h: 812 };
    const low = placeCard({ top: 600, left: 20, width: 300, height: 60 }, phone, card);
    expect(low.width).toBe(375 - 32);
    expect(low.top + card.h).toBeLessThanOrEqual(600);
    inside(low, phone.w, phone.h);
    const high = placeCard({ top: 40, left: 200, width: 150, height: 40 }, phone, card);
    expect(high.top).toBeGreaterThanOrEqual(80);
    inside(high, phone.w, phone.h);
    inside(placeCard(null, phone, card), phone.w, phone.h);
  });

  it("keeps clear of what the step wants seen when there is room", () => {
    const desk = { w: 1440, h: 900 };
    const mark = { top: 850, left: 300, width: 70, height: 30 }; // the key scan on the timeline
    const caption = { top: 660, left: 280, width: 880, height: 110 }; // right above it
    const p = placeCard(mark, desk, card, [{ box: caption, weight: 3 }]);
    const box = { ...p, height: card.h };
    const hits = (a: typeof box, b: typeof caption) =>
      a.left < b.left + b.width &&
      b.left < a.left + a.width &&
      a.top < b.top + b.height &&
      b.top < a.top + a.height;
    expect(hits(box, caption)).toBe(false);
    expect(hits(box, mark)).toBe(false);
    inside(p, desk.w, desk.h);
  });

  it("on a desktop: a narrow card near the target, never off screen", () => {
    const desk = { w: 1440, h: 900 };
    const p = placeCard({ top: 820, left: 1300, width: 120, height: 40 }, desk, card);
    expect(p.width).toBeLessThanOrEqual(420);
    expect(p.top + card.h).toBeLessThanOrEqual(820);
    inside(p, desk.w, desk.h);
    inside(placeCard(null, desk, card), desk.w, desk.h);
  });
});
