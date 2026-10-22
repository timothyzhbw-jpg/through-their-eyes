// Breakdowns from the live service (SPEC 2, 6, 7): asked for per persona and language, checked like
// the bundled one, rendered by the same narration UI, with where they came from (cached or
// generated, model or template, rate limit, daily cap). The bundled fixture is the fallback.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { BreakdownResponse, createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { heroMoment } from "../plan/moment";
import { createSession } from "../session";
import { API, breakdownResponse, fakeFetch, HERO_MOMENT, json, render, settle } from "../testing";
import { BreakdownPanel } from "../ui/BreakdownPanel";
import { NarrationPanel } from "../ui/Narration";
import { apiBreakdown, webPlan } from "./breakdown";

const hero = parseHero(raw);
const moment = heroMoment(hero);

const echo = (body: unknown) => {
  const { personas, languages } = body as { personas: string[]; languages: string[] };
  return json(breakdownResponse({}, { persona: personas[0], language: languages[0] }));
};

function online(reply: (body: unknown) => Response = echo) {
  const fetch = fakeFetch({ "POST /api/breakdowns": reply });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
  });
  return { session, fetch };
}

describe("the service's breakdown, checked like the bundled one", () => {
  const res = BreakdownResponse.parse(breakdownResponse());

  it("keeps the verified lines and turns voice cues into voice steps of the plan", () => {
    const view = apiBreakdown(res, "casual", "en", moment, hero);
    expect(view.payloadErrors).toEqual([]);
    expect(view.narration?.fixture).toBe(false);
    expect(view.narration?.lines.map((l) => l.id)).toEqual(["L1", "L2", "L3"]);
    expect(view.resolved).toMatchObject({ source: "given", errors: [] });
    const voiced = view.resolved.plan.steps.filter((s) => s.do === "voice");
    expect(voiced).toEqual([
      { t: 0.2, do: "voice", line: "L1" },
      { t: 3.13, do: "voice", line: "L2" },
      { t: 6.07, do: "voice", line: "L3" },
    ]);
    expect(view.voice.map((c) => c.cache_key)).toEqual(["cue0", "cue1", "cue2"]);
  });

  it("drops the nulls the API sends for optional plan fields, in time order", () => {
    const plan = webPlan(res.result.plan, []) as { steps: Record<string, unknown>[] };
    expect(plan.steps.find((s) => s.kind === "belief")).toEqual({
      t: 1.5,
      do: "ghost",
      kind: "belief",
    });
    const times = (webPlan(res.result.plan, res.result.scripts[0].voice) as typeof plan).steps.map(
      (s) => s.t as number,
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("rejects a payload whose evidence is not in the replay", () => {
    const bad = BreakdownResponse.parse(
      breakdownResponse(
        {},
        {
          payload: {
            moment: HERO_MOMENT,
            persona: "casual",
            language: "en",
            lines: [{ id: "L1", text: "x", claims: ["c"] }],
            claims: [
              {
                id: "c",
                kind: "observed",
                verdict: "supported",
                values: {},
                evidence: ["scan:H8:9999"],
                seek_frame: 50,
              },
            ],
          },
        },
      ),
    );
    const view = apiBreakdown(bad, "casual", "en", moment, hero);
    expect(view.narration).toBeNull();
    expect(view.payloadErrors).toEqual([
      expect.stringMatching(/scan:H8:9999 is not in the replay/),
    ]);
  });
});

describe("asking the service for a breakdown", () => {
  it("describes a pending breakdown without promising a fixed wait", () => {
    const { session } = online();
    session.controls.requestBreakdown();
    expect(session.breakdown.get().status).toBe("loading");
    const html = render(session, <NarrationPanel />);
    expect(html).toContain("a new one takes longer to generate");
    expect(html).not.toMatch(/takes about \d+ s/);
  });

  it("asks for the chosen persona and language and renders the verified payload", async () => {
    const { session, fetch } = online();
    expect(session.breakdown.get().status).toBe("waiting");
    expect(render(session, <NarrationPanel />)).toContain("asked for when the live stream");
    session.controls.requestBreakdown();
    await settle();
    expect(fetch.calls[0].body).toEqual({
      match: "blind_side_run-3",
      moment: HERO_MOMENT,
      personas: ["casual"],
      languages: ["en"],
    });
    const html = render(session, <NarrationPanel />);
    expect(html).toContain("What did he see? H8 checked his shoulder before the ball reached him.");
    expect(html).toContain("Without that look, H8 would have passed to H4.");
    expect(html).toContain("Counterfactual · inside the sim");
    // Where it came from, as the service said it (`provenance`).
    expect(html).toContain("Cached: a crew run from 21 Oct 2026, 19:31 UTC");
    expect(html).not.toContain("Sample");
    expect(html).not.toContain("Rate-limited");
    expect(render(session, <BreakdownPanel />)).toContain("Telestrator agent");
  });

  it("says when the breakdown was made just now, rate-limited or capped", async () => {
    const generated = online(() => json(breakdownResponse({ cached: false })));
    generated.session.controls.requestBreakdown();
    await settle();
    const html = render(generated.session, <NarrationPanel />);
    expect(html).toContain("Live: written by the crew just now");

    const limited = online(() =>
      json(breakdownResponse({ cached: true, rate_limited: true, capped: true })),
    );
    limited.session.controls.requestBreakdown();
    await settle();
    const flagged = render(limited.session, <NarrationPanel />);
    expect(flagged).toContain(">Rate-limited<");
    expect(flagged).toContain(">Daily cap reached<");
  });

  it("asks again when the persona or the language changes, one request at a time", async () => {
    const { session, fetch } = online();
    session.controls.requestBreakdown();
    await settle();
    session.controls.setPersona("analyst"); // asked for at once
    session.controls.setPersona("coach"); // while that is in flight: queued...
    session.controls.setLanguage("zh"); // ...and replaced by the latest choice
    await settle();
    expect(fetch.calls.map((c) => c.body)).toEqual([
      expect.objectContaining({ personas: ["casual"], languages: ["en"] }),
      expect.objectContaining({ personas: ["analyst"], languages: ["en"] }),
      expect.objectContaining({ personas: ["coach"], languages: ["zh"] }),
    ]);
    // The stale analyst / en answer was never shown; the latest choice is.
    expect(session.breakdown.get()).toMatchObject({ status: "ready", persona: "coach" });
    expect(session.breakdown.get().narration?.payload).toMatchObject({
      persona: "coach",
      language: "zh",
    });
  });

  it("plays it when the viewer pressed play before it arrived", async () => {
    const { session } = online();
    session.controls.playBreakdown();
    expect(session.breakdown.get().status).toBe("loading");
    await settle();
    expect(session.runner.status.get().status).toBe("running");
  });

  it("falls back to the bundled breakdown when the service fails", async () => {
    const { session } = online(() => json({ detail: "boom" }, 502));
    session.controls.requestBreakdown();
    await settle();
    const b = session.breakdown.get();
    expect(b.status).toBe("failed");
    expect(b.error).toMatch(/HTTP 502/);
    expect(b.narration?.fixture).toBe(true);
    const html = render(session, <NarrationPanel />);
    expect(html).toContain("Showing the bundled one instead");
    expect(html).toContain("Sample");
  });

  it("offline, shows the bundled breakdown with its badge and no switches", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    expect(session.breakdown.get()).toMatchObject({ status: "ready", persona: "casual" });
    const html = render(session, <NarrationPanel />);
    expect(html).toContain("Offline data");
    expect(html).toMatch(/<select[^>]*disabled/);
    session.controls.setPersona("analyst"); // no service: nothing to ask
    expect(session.breakdown.get().persona).toBe("casual");
  });
});
