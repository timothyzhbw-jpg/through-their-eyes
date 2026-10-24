// @vitest-environment happy-dom
// A cold visit to ?step=content or ?step=value (SPEC 7): the moment's cached breakdown is asked for
// on entering the step, through the app's own request, and never one the service would have to
// generate: those, a failure, or a cap show a "Generate the breakdown" button instead.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import type { BreakdownState } from "../breakdown/breakdown";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import {
  API,
  breakdownResponse,
  fakeFetch,
  fakeSockets,
  json,
  settle,
  type Route,
} from "../testing";
import { DEMO_DATA } from "./DemoBadge";
import { gateOf, PREWARMED } from "./gate";
import { Journey } from "./Journey";
import { journey } from "./state";
import type { JourneyStep } from "./steps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = join(process.cwd(), "public", "data"); // vitest runs in web/
const mounted: { root: Root; container: HTMLElement }[] = [];

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    const name = String(url).split("/data/")[1];
    if (!name) return new Response("not found", { status: 404 });
    return new Response(readFileSync(join(DATA, name)), { status: 200 });
  });
});
beforeEach(() => {
  journey.set({ step: "event", seq: 0 });
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

const echo: Route = (body) => {
  const { personas, languages } = body as { personas: string[]; languages: string[] };
  return json(breakdownResponse({}, { persona: personas[0], language: languages[0] }));
};

/** A cold visit: the page opened on `step`, online, with no breakdown on screen yet. */
async function coldVisit(step: JourneyStep, { scenario = "", reply = echo } = {}) {
  const base = parseHero(raw);
  const fetch = fakeFetch({ "POST /api/breakdowns": reply });
  const session: Session = createSession(
    scenario ? { ...base, scenario } : base,
    EXAMPLE_PLAN,
    payloadJson,
    null,
    { api: createApi(API, "blind_side_run-3", fetch), socket: fakeSockets() },
  );
  journey.set({ step, seq: 0 });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(<SessionContext.Provider value={session}>{<Journey />}</SessionContext.Provider>),
  );
  mounted.push({ root, container });
  for (let k = 0; k < 20; k++) await act(settle);
  const asked = () => fetch.calls.filter((c) => c.path === "/api/breakdowns");
  const text = () => container.querySelector("[role='tabpanel']")!.textContent!;
  const button = () =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Generate the breakdown",
    );
  return { session, container, asked, text, button };
}

const state = (patch: Partial<BreakdownState>): BreakdownState =>
  ({
    narration: null,
    status: "waiting",
    error: null,
    origin: null,
    persona: "casual",
    language: "en",
    ...patch,
  }) as BreakdownState;

describe("gateOf", () => {
  it("loads a prewarmed moment's breakdown, and nothing else by itself", () => {
    expect(PREWARMED).toContain("blind_side_run");
    expect(gateOf(state({}), true, "blind_side_run").kind).toBe("load");
    expect(gateOf(state({}), true, "open_play").kind).toBe("offer");
  });

  it("has nothing to do with one on screen, a request out, or no service", () => {
    const narration = {} as BreakdownState["narration"];
    expect(gateOf(state({ narration }), true, "open_play").kind).toBe("have");
    expect(gateOf(state({ status: "loading" }), true, "blind_side_run").kind).toBe("wait");
    expect(gateOf(state({}), false, "blind_side_run").kind).toBe("offline");
  });

  it("offers the button after a failure, an uncached answer, a cap or a rate limit", () => {
    const api = (o: object) =>
      state({
        origin: { kind: "api", cached: true, capped: false, rateLimited: false, ...o } as never,
      });
    expect(
      gateOf(state({ status: "failed", error: "HTTP 500" }), true, "blind_side_run"),
    ).toMatchObject({
      kind: "offer",
      why: expect.stringContaining("HTTP 500"),
    });
    for (const o of [{ cached: false }, { capped: true }, { rateLimited: true }]) {
      expect(gateOf(api(o), true, "blind_side_run").kind, JSON.stringify(o)).toBe("offer");
    }
    // A fresh run says asking again is a second run, not a cache read.
    expect(gateOf(api({ cached: false }), true, "blind_side_run")).toMatchObject({
      why: expect.stringContaining("runs the agent crew again"),
    });
    expect(gateOf(api({}), true, "blind_side_run").kind).toBe("load");
  });
});

describe("a cold visit", () => {
  it("?step=content asks once for the cached breakdown and shows the package", async () => {
    const { session, asked, text, button } = await coldVisit("content");
    expect(asked()).toHaveLength(1);
    expect(asked()[0].body).toMatchObject({ personas: ["casual"], languages: ["en"] });
    expect(session.breakdown.get().status).toBe("ready");
    expect(text()).toContain("Play highlight");
    expect(text()).toContain("Social posts");
    expect(text()).not.toContain("appears when one is on screen");
    expect(button()).toBeUndefined();
  });

  it("?step=value shows the demo KPIs, each with the demo-data badge", async () => {
    const { container, asked, text } = await coldVisit("value");
    expect(asked()).toHaveLength(1);
    expect(text()).toContain("Impressions");
    expect(text()).toContain("Click-through");
    const panel = container.querySelector("[role='tabpanel']")!;
    const metrics = [...panel.querySelectorAll(".studio-metric")];
    expect(metrics.length).toBe(5);
    for (const m of metrics) expect(m.querySelector(".demo-badge")?.textContent).toBe(DEMO_DATA);
  });

  it("says it is loading while the request is out", async () => {
    const { text, button } = await coldVisit("content", {
      reply: () => new Promise(() => {}) as never,
    });
    expect(text()).toContain("Loading the verified breakdown");
    expect(button()).toBeUndefined();
  });

  it("a moment that is not prewarmed shows the button and calls nothing", async () => {
    const { asked, text, button } = await coldVisit("content", { scenario: "open_play" });
    expect(asked()).toHaveLength(0);
    expect(button()).toBeDefined();
    expect(text()).toContain("not prewarmed");
    expect(text()).not.toContain("Play highlight");
  });

  it("the button asks for the breakdown, once, and the package follows", async () => {
    const { asked, text, button } = await coldVisit("value", { scenario: "open_play" });
    act(() => button()!.click());
    for (let k = 0; k < 20; k++) await act(settle);
    expect(asked()).toHaveLength(1);
    expect(text()).toContain("Impressions");
    expect(button()).toBeUndefined();
  });

  it("a failed request is asked once, not in a loop, and the bundled breakdown stands in", async () => {
    const { session, asked, text, button } = await coldVisit("content", {
      reply: () => json({ detail: "down" }, 500),
    });
    expect(asked()).toHaveLength(1);
    expect(session.breakdown.get().status).toBe("failed");
    expect(text()).toContain("Play highlight"); // the app's own fallback: the bundled fixture
    expect(button()).toBeUndefined();
  });

  it("a persona or language change asks once for its own breakdown, and re-entering the step asks for nothing", async () => {
    const { session, asked } = await coldVisit("content");
    expect(asked()).toHaveLength(1);
    act(() => session.controls.setPersona("analyst"));
    for (let k = 0; k < 20; k++) await act(settle);
    expect(asked()).toHaveLength(2); // the app's own switch; the gate adds none
    expect(asked()[1].body).toMatchObject({ personas: ["analyst"], languages: ["en"] });
    act(() => session.controls.setLanguage("zh"));
    for (let k = 0; k < 20; k++) await act(settle);
    expect(asked()).toHaveLength(3);
    expect(asked()[2].body).toMatchObject({ personas: ["analyst"], languages: ["zh"] });
    // Leave the step and come back: the breakdown is on screen, so nothing is asked.
    for (const step of ["event", "content"] as const) {
      journey.set({ step, seq: 0 });
      for (let k = 0; k < 20; k++) await act(settle);
    }
    const again = document.createElement("div");
    document.body.append(again);
    const root = createRoot(again);
    act(() =>
      root.render(<SessionContext.Provider value={session}>{<Journey />}</SessionContext.Provider>),
    );
    mounted.push({ root, container: again });
    for (let k = 0; k < 20; k++) await act(settle);
    expect(asked()).toHaveLength(3);
  });

  it("the Event step asks for nothing", async () => {
    const { asked } = await coldVisit("event");
    expect(asked()).toHaveLength(0);
  });
});
