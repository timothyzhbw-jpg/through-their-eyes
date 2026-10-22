// The Producer's failure drill in the breakdown panel (SPEC 6): take agents down for one run, see
// which steps ran on their templates, bring a downed agent back from the workflow checkpoint, and
// the trace id to look the run up in Application Insights.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { BreakdownResponse, createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import {
  API,
  breakdownResponse,
  crewTrace,
  fakeFetch,
  json,
  render,
  settle,
  telestratorDownTrace,
  type Route,
} from "../testing";
import { BreakdownPanel } from "../ui/BreakdownPanel";
import { NarrationPanel, recordedTime } from "../ui/Narration";
import { BACK_NOTE, crewSteps, toggled } from "./producer";

const hero = parseHero(raw);
const DRILL_KEY = "7e1c0b9d2f6a4e8b9c3d5f7a1b2c4d6e";

const drill = () =>
  json(
    breakdownResponse(
      { cached: false },
      {
        key: DRILL_KEY,
        trace: telestratorDownTrace(),
        plan_source: "template",
        drill: { down: ["telestrator"], pending: ["telestrator"] },
        trace_id: "0af7651916cd43dd8448eb211c80319c",
      },
    ),
  );
const broughtBack = () =>
  json(
    breakdownResponse(
      { cached: false },
      {
        key: DRILL_KEY,
        trace: crewTrace({}, { telestrator: { notes: [BACK_NOTE] } }),
        drill: { down: [], pending: [] },
        trace_id: "b7ad6b7169203331b7ad6b7169203331",
      },
    ),
  );

function online(routes: Record<string, Route> = {}) {
  const fetch = fakeFetch({
    "POST /api/breakdowns": (body) =>
      (body as { fail?: string[] }).fail ? drill() : json(breakdownResponse()),
    [`POST /api/breakdowns/${DRILL_KEY}/bring-back`]: broughtBack,
    ...routes,
  });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
  });
  return { session, fetch };
}

const rows = (html: string) => html.match(/<li class="crew-step[^"]*"[\s\S]*?<\/li>/g) ?? [];
const row = (html: string, label: string) => rows(html).find((r) => r.includes(`>${label}<`))!;

describe("the Producer: the crew's steps and their sources", () => {
  it("shows every step and which one ran on the model, a template or code", async () => {
    const { session } = online();
    session.controls.requestBreakdown();
    await settle();
    const html = render(session, <BreakdownPanel />);
    expect(html).toContain("Producer");
    expect(rows(html)).toHaveLength(6);
    expect(row(html, "Telestrator")).toContain(">Model<");
    expect(row(html, "Verifier")).toContain(">Code<");
    expect(html).not.toContain(">Bring back<");
    expect(html.match(/>Take down</g)).toHaveLength(4); // the four agents; code cannot go down
    expect(html).toContain("4bf92f3577b34da6a3ce929d0e0e4736"); // the trace id
  });

  it("before a breakdown arrives, the steps have no source yet", () => {
    const steps = crewSteps(null);
    expect(steps.map((s) => s.step)).toEqual([
      "director",
      "analyst",
      "telestrator",
      "narration",
      "verifier",
      "voice",
    ]);
    expect(steps.every((s) => s.source === null && !s.pending)).toBe(true);
    expect(steps.filter((s) => s.agent).map((s) => s.agent)).toEqual([
      "director",
      "analyst",
      "telestrator",
      "narration",
    ]);
  });

  it("keeps the agents to take down in crew order", () => {
    expect(toggled([], "narration")).toEqual(["narration"]);
    expect(toggled(["narration"], "director")).toEqual(["director", "narration"]);
    expect(toggled(["director", "narration"], "director")).toEqual(["narration"]);
  });

  it("offline there is no Producer: there is no crew to take down", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    expect(render(session, <BreakdownPanel />)).not.toContain("Producer");
  });
});

describe("a failure drill", () => {
  it("takes the picked agents down for one run and shows the step on its template", async () => {
    const { session, fetch } = online();
    session.controls.requestBreakdown();
    await settle();
    session.controls.toggleDown("telestrator");
    const picked = render(session, <BreakdownPanel />);
    expect(row(picked, "Telestrator")).toContain('aria-pressed="true"');
    expect(picked).toContain("Run with Telestrator down");

    session.controls.runDrill();
    await settle();
    expect(fetch.calls.at(-1)).toEqual({
      method: "POST",
      path: "/api/breakdowns",
      body: {
        match: "blind_side_run-3",
        moment: "m:decision_after_scan:H8:0075",
        personas: ["casual"],
        languages: ["en"],
        fail: ["telestrator"],
      },
    });
    const origin = session.breakdown.get().origin;
    expect(origin).toMatchObject({ kind: "api", key: DRILL_KEY, planSource: "template" });
    expect(session.producer.get()).toMatchObject({ down: [], busy: null, error: null });
    const html = render(session, <BreakdownPanel />);
    const tele = row(html, "Telestrator");
    expect(tele).toContain(">Template<");
    expect(tele).toContain("AgentDown");
    expect(tele).toContain("2 attempts");
    expect(tele).toContain(">Bring back<");
    expect(row(html, "Analyst")).toContain(">Model<");
    expect(html).toContain("Server template"); // the plan badge: the Telestrator's template
    expect(html).toContain("0af7651916cd43dd8448eb211c80319c");
  });

  it("brings the agent back: its step re-runs from the checkpoint and replaces the template", async () => {
    const { session, fetch } = online();
    session.controls.requestBreakdown();
    await settle();
    session.controls.toggleDown("telestrator");
    session.controls.runDrill();
    await settle();
    session.controls.bringBack("telestrator");
    await settle();
    expect(fetch.calls.at(-1)).toEqual({
      method: "POST",
      path: `/api/breakdowns/${DRILL_KEY}/bring-back`,
      body: { step: "telestrator" },
    });
    const html = render(session, <BreakdownPanel />);
    const tele = row(html, "Telestrator");
    expect(tele).toContain(">Model<");
    expect(tele).toContain("From checkpoint");
    expect(html).not.toContain(">Bring back<");
    expect(html).toContain("Telestrator agent");
    expect(html).toContain("b7ad6b7169203331b7ad6b7169203331"); // the bring-back's own trace
  });

  it("does not bring back an agent that is not waiting", async () => {
    const { session, fetch } = online();
    session.controls.requestBreakdown();
    await settle();
    session.controls.bringBack("telestrator"); // a normal breakdown: nothing is down
    await settle();
    expect(fetch.calls.map((c) => c.path)).toEqual(["/api/breakdowns"]);
  });

  it("a refused drill keeps the breakdown on screen and says why", async () => {
    const { session } = online({
      "POST /api/breakdowns": (body) =>
        (body as { fail?: string[] }).fail
          ? json({ detail: "rate_limited: try again in a few minutes" }, 429)
          : json(breakdownResponse()),
    });
    session.controls.requestBreakdown();
    await settle();
    const before = session.breakdown.get().origin;
    session.controls.toggleDown("analyst");
    session.controls.runDrill();
    await settle();
    expect(session.breakdown.get().origin).toBe(before);
    expect(session.producer.get().error).toMatch(/HTTP 429.*rate_limited/);
    expect(session.producer.get().down).toEqual(["analyst"]); // still picked, to try again
    expect(render(session, <BreakdownPanel />)).toContain("HTTP 429");
  });

  it("a limited drill shows the recorded run and when it ran, not a dead end", async () => {
    const recorded = {
      ...breakdownResponse(
        { cached: true, rate_limited: true },
        {
          key: "5f0c1d2e3a4b5c6d7e8f90a1b2c3d4e5",
          trace: telestratorDownTrace(),
          plan_source: "template",
          drill: { down: ["telestrator"], pending: ["telestrator"] },
        },
      ),
      recorded: { at: "2026-10-21T15:04:05+00:00" },
    };
    const { session } = online({
      "POST /api/breakdowns": (body) =>
        (body as { fail?: string[] }).fail ? json(recorded) : json(breakdownResponse()),
    });
    session.controls.requestBreakdown();
    await settle();
    session.controls.toggleDown("telestrator");
    session.controls.runDrill();
    await settle();
    expect(session.producer.get().error).toBeNull();
    expect(session.breakdown.get().origin).toMatchObject({
      kind: "api",
      recordedAt: "2026-10-21T15:04:05+00:00",
    });
    const producer = render(session, <BreakdownPanel />);
    expect(producer).toContain("Recorded run from 10-21 15:04 UTC");
    expect(row(producer, "Telestrator")).toContain(">Bring back<"); // its bring-back is recorded
    const badges = render(session, <NarrationPanel />);
    expect(badges).toContain("Recorded run · 10-21 15:04 UTC");
    expect(badges).toContain("Rate-limited");
  });

  it("a limited drill without a recording ran without the model and says so", async () => {
    const offline = {
      ...breakdownResponse(
        { cached: false, capped: true },
        { key: DRILL_KEY, drill: { down: ["analyst"], pending: ["analyst"] } },
      ),
      source: "offline",
    };
    const { session } = online({
      "POST /api/breakdowns": (body) =>
        (body as { fail?: string[] }).fail ? json(offline) : json(breakdownResponse()),
    });
    session.controls.requestBreakdown();
    await settle();
    session.controls.toggleDown("analyst");
    session.controls.runDrill();
    await settle();
    expect(session.producer.get().error).toBeNull();
    const html = render(session, <BreakdownPanel />);
    expect(html).toContain("ran without the model");
    expect(html).not.toContain("Recorded run");
  });

  it("formats the recording's time in UTC", () => {
    expect(recordedTime("2026-11-02T23:59:00+00:00")).toBe("11-02 23:59 UTC");
    expect(recordedTime("2026-10-27T01:30:00-05:00")).toBe("10-27 06:30 UTC");
    expect(recordedTime("not a time")).toBe("not a time");
  });

  it("says when the breakdown has no trace id", async () => {
    const { session } = online({
      "POST /api/breakdowns": () => json(breakdownResponse({}, { trace_id: null })),
    });
    session.controls.requestBreakdown();
    await settle();
    expect(render(session, <BreakdownPanel />)).toContain("no trace id");
  });
});

describe("the service's response", () => {
  it("parses a breakdown cached before drills and trace ids existed", () => {
    const old = breakdownResponse() as Record<string, unknown> & { result: object };
    delete old.drill;
    delete (old.result as Record<string, unknown>).trace_id;
    const parsed = BreakdownResponse.parse(old);
    expect(parsed.drill).toBeUndefined();
    expect(parsed.result.trace_id).toBeUndefined();
  });

  it("sends `fail` only for a drill", async () => {
    const { session, fetch } = online();
    session.controls.requestBreakdown();
    await settle();
    expect(fetch.calls[0].body).not.toHaveProperty("fail");
  });
});
