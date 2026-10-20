// The API base URL and the fallback to the bundled data (SPEC 2, 8): unset, unreachable, too slow
// or broken, the app plays public/data and says "Offline data"; answering, the match export comes
// from the service.

import { describe, expect, it } from "vitest";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { HERO_FILE, loadData, PAYLOAD_FILE, WHAT_IF_FILE } from "../data/load";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { API, exportJson, fakeFetch, health, json, render, type Route } from "../testing";
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
    expect(data.offline).toMatch(/VITE_API_URL is not set/);
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
    expect(apiCalls(fetch.calls)).toEqual(["/health", "/api/matches/blind_side_run-3/export"]);
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
