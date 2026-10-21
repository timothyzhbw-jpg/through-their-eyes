// The API base URL and the fallback to the bundled data (SPEC 2, 8): unset, unreachable, too slow
// or broken, the app plays public/data and says "Offline data"; answering, the match export comes
// from the service.

import { describe, expect, it } from "vitest";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { HERO_FILE, loadData, PAYLOAD_FILE, WHAT_IF_FILE } from "../data/load";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import {
  API,
  exportJson,
  fakeFetch,
  health,
  json,
  MATCH,
  MATCH_HERO,
  matchBreakdown,
  matchInfo,
  pressureExport,
  PRESS_MOMENT,
  render,
  type Route,
} from "../testing";
import { LiveBar } from "../ui/Live";
import { apiBase, createApi } from "./client";

const bundled: Record<string, Route> = {
  [`GET /data/${HERO_FILE}`]: () => json(exportJson),
  [`GET /data/${PAYLOAD_FILE}`]: () => json(payloadJson),
  [`GET /data/${WHAT_IF_FILE}`]: () => json(whatIfJson),
};
const load = (routes: Record<string, Route>, base: string | null = API) => {
  const fetch = fakeFetch({ ...bundled, ...routes });
  return {
    fetch,
    loaded: loadData({ apiBase: base, dataUrl: "/data/", fetch, probeTimeoutMs: 50 }),
  };
};
const apiCalls = (calls: { path: string }[]) =>
  calls.filter((c) => !c.path.startsWith("/data/")).map((c) => c.path);

describe("API base URL", () => {
  it("is null when VITE_API_URL is unset or blank, and loses trailing slashes", () => {
    expect(apiBase(undefined)).toBeNull();
    expect(apiBase("  ")).toBeNull();
    expect(apiBase("https://tte-api.example.io/")).toBe("https://tte-api.example.io");
  });

  it("streams over wss from an https base", () => {
    const api = createApi("https://tte-api.example.io", "blind_side_run-3");
    expect(api.liveUrl(40)).toBe(
      "wss://tte-api.example.io/ws/matches/blind_side_run-3/live?start=40&speed=1",
    );
    expect(createApi("http://localhost:5173").liveUrl(0)).toMatch(/^ws:\/\/localhost:5173\//);
  });
});

describe("fallback to the bundled data", () => {
  it("does not call any service when VITE_API_URL is unset", async () => {
    const { fetch, loaded } = load({}, null);
    const data = await loaded;
    expect(data.api).toBeNull();
    expect(data.offline).toMatch(/no live service is configured/);
    expect(apiCalls(fetch.calls)).toEqual([]);
    expect(data.hero.heroId).toBe("H8");
    expect(data.payload).toEqual(payloadJson);
  });

  it("plays the bundled match when the service is down", async () => {
    const { fetch, loaded } = load({ "GET /health": () => "fail" });
    const data = await loaded;
    expect(data.api).toBeNull();
    expect(data.offline).toMatch(/did not answer.*Failed to fetch/);
    expect(apiCalls(fetch.calls)).toEqual(["/health"]);
    expect(fetch.calls.map((c) => c.path)).toContain(`/data/${HERO_FILE}`);
  });

  it("gives up on a service that does not answer within the probe timeout", async () => {
    const started = Date.now();
    const data = await load({ "GET /health": () => "hang" }).loaded;
    expect(data.api).toBeNull();
    expect(data.offline).toMatch(/no answer within/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("falls back when the health check passes but the export fails", async () => {
    const data = await load({
      "GET /health": health,
      "GET /api/matches/blind_side_run-3/export": () => json({ detail: "boom" }, 500),
    }).loaded;
    expect(data.api).toBeNull();
    expect(data.offline).toMatch(/HTTP 500/);
    expect(data.hero.runs.factual.frames).toBe(exportJson.runs.factual.frames);
  });

  it("loads the match export from the service when it answers", async () => {
    const { fetch, loaded } = load({
      "GET /health": health,
      "GET /api/matches/blind_side_run-3/export": () => json(exportJson),
    });
    const data = await loaded;
    expect(data.api?.base).toBe(API);
    expect(data.offline).toBeNull();
    expect(apiCalls(fetch.calls).sort()).toEqual([
      "/api/matches/blind_side_run-3", // its hero moment's id (404 here: the default id is kept)
      "/api/matches/blind_side_run-3/export",
      "/health",
    ]);
    expect(fetch.calls.map((c) => c.path)).not.toContain(`/data/${HERO_FILE}`);
    // The bundled fixture and what-ifs still come along: fallback narration, forced runs.
    expect(data.whatIfs).toEqual(whatIfJson);
  });

  it("shows the offline badge without a service, the Live control with one", async () => {
    const off = await load({ "GET /health": () => "fail" }).loaded;
    const offline = createSession(off.hero, EXAMPLE_PLAN, off.payload, off.whatIfs, {
      offline: off.offline,
    });
    const html = render(offline, <LiveBar />);
    expect(html).toContain("Offline data");
    expect(html).toContain("did not answer");
    expect(html).not.toContain("live-chip");

    const on = await load({
      "GET /health": health,
      "GET /api/matches/blind_side_run-3/export": () => json(exportJson),
    }).loaded;
    const online = createSession(on.hero, EXAMPLE_PLAN, on.payload, on.whatIfs, { api: on.api });
    const live = render(online, <LiveBar />);
    expect(live).toContain("live-chip");
    expect(live).not.toContain("Offline data");
  });
});

describe("matches and their hero moments", () => {
  it("lists the matches the service plays and reads a match's hero moments", async () => {
    const fetch = fakeFetch({
      "GET /api/matches": () =>
        json([
          { id: "blind_side_run-3", scenario: "blind_side_run", seed: 3 },
          { id: MATCH, scenario: "match", seed: 1 },
        ]),
      [`GET /api/matches/${MATCH}`]: () => json(matchInfo()),
    });
    const api = createApi(API, MATCH, fetch);
    expect((await api.matches()).map((m) => m.id)).toEqual(["blind_side_run-3", MATCH]);
    const info = await api.info();
    expect(info.kind).toBe("match");
    expect(info.hero_moments).toHaveLength(2);
    expect(api.withMatch("press_escape-0").match).toBe("press_escape-0");
  });

  it("asks for a breakdown and a what-if by the moment's id in match time", async () => {
    const fetch = fakeFetch({
      "POST /api/breakdowns": (body) => json(matchBreakdown(body)),
      "POST /api/whatif": () => json({ detail: "not here" }, 404),
    });
    const api = createApi(API, MATCH, fetch);
    const res = await api.breakdown({ moment: MATCH_HERO, persona: "casual", language: "en" });
    expect(fetch.calls[0].body).toMatchObject({ match: MATCH, moment: MATCH_HERO });
    expect(res.possession).toEqual({
      index: 1,
      start: 60,
      local_moment: "m:decision_after_scan:H8:0075",
    });
    await api
      .whatIf({
        question: "What if he carried it?",
        language: "en",
        persona: "casual",
        moment: MATCH_HERO,
      })
      .catch(() => null);
    expect(fetch.calls[1].body).toMatchObject({ match: MATCH, moment: MATCH_HERO });
  });

  it("takes a standalone hero's moment id from the service", async () => {
    const fetch = fakeFetch({
      ...bundled,
      "GET /health": health,
      "GET /api/matches/press_escape-0": () =>
        json({
          id: "press_escape-0",
          kind: "hero",
          hero_moment: PRESS_MOMENT,
          hero_moments: [PRESS_MOMENT],
        }),
      "GET /api/matches/press_escape-0/export": () => json(pressureExport()),
    });
    const data = await loadData({
      apiBase: API,
      dataUrl: "/data/",
      fetch,
      match: "press_escape-0",
    });
    expect(data.momentId).toBe(PRESS_MOMENT);
    expect(data.hero.keyScan).toBeNull();
  });
});
