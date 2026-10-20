// Deep links (README "For judges"): URL parameters that open the app on a given audience,
// language, run, view and frame, so each step of the three-minute tour is one link.

import { describe, expect, it } from "vitest";
import raw from "../public/data/hero_seed3.json";
import payloadJson from "../public/data/fixture_payload_seed3.json";
import whatIfJson from "../public/data/whatif_seed3.json";
import { createApi } from "./api/client";
import { parseHero } from "./data/hero";
import { applyDeepLink, atFrame, DeepLinkContext, NO_LINK, parseDeepLink } from "./deeplink";
import { EXAMPLE_PLAN } from "./plan/example";
import { heroMoment } from "./plan/moment";
import { createSession } from "./session";
import { keyScanFrame } from "./store/playback";
import { API, breakdownResponse, fakeFetch, json, render } from "./testing";
import { WhatIfPanel } from "./ui/WhatIfPanel";
import { MAX_QUESTION } from "./whatif/ask";

const hero = parseHero(raw);
const moment = heroMoment(hero);

const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);

function online() {
  const fetch = fakeFetch({
    "POST /api/breakdowns": (body) => {
      const { personas, languages } = body as { personas: string[]; languages: string[] };
      return json(breakdownResponse({}, { persona: personas[0], language: languages[0] }));
    },
  });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
    api: createApi(API, "blind_side_run-3", fetch),
  });
  return { session, fetch };
}

describe("parsing the address", () => {
  it("opens as before with no parameters: autoplay, live service, the example plan", () => {
    expect(parseDeepLink("")).toEqual(NO_LINK);
    expect(NO_LINK).toMatchObject({ autoplay: true, offline: false, invalidPlan: false });
  });

  it("keeps the existing testing parameters", () => {
    expect(parseDeepLink("?autoplay=0")).toMatchObject({ autoplay: false });
    expect(parseDeepLink("?offline=1")).toMatchObject({ offline: true, autoplay: true });
    expect(parseDeepLink("?plan=invalid")).toMatchObject({ invalidPlan: true });
    expect(parseDeepLink("?rigged=0").warnings).toEqual([]); // read by players/trial.ts
  });

  it("reads audience, language, run, view and frame", () => {
    const link = parseDeepLink(
      "?persona=player_fan&lang=zh&run=counterfactual&view=tactical&at=42",
    );
    expect(link).toMatchObject({
      persona: "player_fan",
      language: "zh",
      run: "counterfactual",
      view: "tactical",
      at: 42,
      warnings: [],
    });
    for (const persona of ["casual", "analyst", "player_fan", "coach"])
      expect(parseDeepLink(`?persona=${persona}`).persona).toBe(persona);
    for (const view of ["pov", "tactical", "split"])
      expect(parseDeepLink(`?view=${view}`).view).toBe(view);
  });

  it("names the two frames a tour needs, so links survive a re-export", () => {
    expect(parseDeepLink("?at=key-scan").at).toBe("key-scan");
    expect(parseDeepLink("?at=decision").at).toBe("decision");
    expect(parseDeepLink("?at=0").at).toBe(0);
  });

  it("ignores values it does not know, and says which", () => {
    const link = parseDeepLink("?persona=pundit&lang=fr&run=both&view=drone&at=-3&utm_source=x");
    expect(link).toMatchObject({ persona: null, language: null, run: null, view: null, at: null });
    expect(link.warnings).toEqual(["persona=pundit", "lang=fr", "run=both", "view=drone", "at=-3"]);
    expect(parseDeepLink("?at=12.5").warnings).toEqual(["at=12.5"]);
    expect(parseDeepLink("?at=").warnings).toEqual(["at="]);
  });

  it("opens paused when the link points at a spot: a frame, a run or a question", () => {
    expect(parseDeepLink("?at=key-scan").autoplay).toBe(false);
    expect(parseDeepLink("?run=factual").autoplay).toBe(false);
    expect(parseDeepLink("?ask=What%20if%3F").autoplay).toBe(false);
    // An audience and a language alone still watch live, then play that breakdown.
    expect(parseDeepLink("?persona=analyst&lang=zh").autoplay).toBe(true);
    expect(parseDeepLink("?view=pov").autoplay).toBe(true);
  });

  it("takes a question to prefill, trimmed and cut to the service's limit", () => {
    expect(parseDeepLink("?ask=%20What+if+he+carried+it%3F%20").ask).toBe("What if he carried it?");
    expect(parseDeepLink(`?ask=${"x".repeat(MAX_QUESTION + 20)}`).ask).toHaveLength(MAX_QUESTION);
    expect(parseDeepLink("?ask=%20%20").ask).toBeNull();
  });
});

describe("frames by name", () => {
  it("puts the key scan where the app opens by default, and the decision on the moment", () => {
    expect(atFrame(hero, moment, "key-scan")).toBe(keyScanFrame(hero));
    expect(keyScanFrame(hero)).toBeGreaterThan(hero.keyScan!.start);
    expect(keyScanFrame(hero)).toBeLessThan(hero.keyScan!.end);
    expect(atFrame(hero, moment, "decision")).toBe(moment.decisionFrame);
    expect(atFrame(hero, moment, 17)).toBe(17);
  });
});

describe("applying a link to the session", () => {
  it("opens paused on the run, view and frame it names", () => {
    const session = offline();
    applyDeepLink(session, parseDeepLink("?run=counterfactual&view=pov&at=decision"));
    expect(session.playback.get()).toMatchObject({
      mode: "counterfactual",
      focus: "pov",
      frame: moment.decisionFrame,
      playing: false,
    });
  });

  it("keeps a frame past the end of the run inside it", () => {
    const session = offline();
    applyDeepLink(session, parseDeepLink("?at=99999"));
    expect(session.playback.get().frame).toBe(hero.runs.factual.frames - 1);
  });

  it("changes nothing without parameters", () => {
    const session = offline();
    const before = session.playback.get();
    applyDeepLink(session, NO_LINK);
    expect(session.playback.get()).toEqual(before);
  });

  it("asks the live service for the linked audience and language, and only when due", () => {
    const { session, fetch } = online();
    applyDeepLink(session, parseDeepLink("?persona=analyst&lang=zh"));
    expect(fetch.calls).toEqual([]); // still waiting for the stream to detect the moment
    expect(session.breakdown.get()).toMatchObject({ persona: "analyst", language: "zh" });
    session.controls.requestBreakdown();
    expect(fetch.calls[0]).toMatchObject({
      path: "/api/breakdowns",
      body: { personas: ["analyst"], languages: ["zh"] },
    });
  });

  it("keeps the bundled breakdown's audience offline (it is the only one there is)", () => {
    const session = offline();
    const { persona, language } = session.breakdown.get();
    applyDeepLink(session, parseDeepLink("?persona=coach&lang=zh"));
    expect(session.breakdown.get()).toMatchObject({ persona, language });
  });
});

describe("the What if box from a link", () => {
  it("prefills the question and answers in the linked language", () => {
    const { session } = online();
    const link = parseDeepLink("?lang=zh&ask=What+if+he+had+carried+it%3F");
    const html = render(
      session,
      <DeepLinkContext.Provider value={link}>
        <WhatIfPanel />
      </DeepLinkContext.Provider>,
    );
    expect(html).toContain('value="What if he had carried it?"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>中文</);
  });

  it("starts empty and in English without a link", () => {
    const { session } = online();
    const html = render(session, <WhatIfPanel />);
    expect(html).toContain('value=""');
    expect(html).toMatch(/aria-pressed="true"[^>]*>EN</);
  });
});
