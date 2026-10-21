// @vitest-environment happy-dom
// The Crew trace (SPEC 6): one real run of the crew as a timeline. The fixture is a run the backend
// recorded (`uv run python -m agents.crewtrace`): the Analyst calls two MCP tools, the Verifier
// sends a line back once, the Telestrator is down, and then it is brought back from the
// checkpoint. tests/test_crew_trace.py checks the same fixture against the Python schema.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type ViewSession } from "../session";
import {
  API,
  breakdownResponse,
  fakeFetch,
  json,
  render,
  settle,
  telestratorDownTrace,
  type Route,
} from "../testing";
import { BreakdownPanel } from "../ui/BreakdownPanel";
import { CrewTraceView } from "./CrewTrace";
import { CREW_VS_SINGLE } from "./eval";
import fixtureJson from "./fixture.json";
import {
  CrewTrace,
  firstStep,
  LANES,
  loadTrace,
  ms,
  NOT_RECORDED,
  stepTitle,
  timeline,
  type TraceState,
} from "./trace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const fixture = CrewTrace.parse(fixtureJson);
const KEY = "7e1c0b9d2f6a4e8b9c3d5f7a1b2c4d6e";
const ready: TraceState = { status: "ready", trace: fixture };

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(node: ReactNode, session?: ViewSession): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      session ? <SessionContext.Provider value={session}>{node}</SessionContext.Provider> : node,
    ),
  );
  mounted.push({ root, container });
  return container;
}

const html = (state: TraceState) => {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
  return render(session, <CrewTraceView state={state} />);
};

describe("the trace the backend recorded", () => {
  it("parses with the web's schema", () => {
    expect(fixture.version).toBe(1);
    expect(fixture.story).toBe("breakdown");
    expect(fixture.runs.map((r) => [r.kind, r.step ?? null])).toEqual([
      ["run", null],
      ["bring_back", "telestrator"],
    ]);
  });

  it("lays each run out on its own axis, a lane per step in the graph's order", () => {
    const [first, back] = timeline(fixture);
    expect(first.lanes.map((l) => l.lane)).toEqual([...LANES]);
    for (const { bars } of [...first.lanes, ...back.lanes])
      for (const bar of bars) {
        expect(bar.left).toBeGreaterThanOrEqual(0);
        expect(bar.left + bar.width).toBeLessThanOrEqual(100.0001);
        expect(bar.width).toBeGreaterThan(0);
      }
    const lane = (run: typeof first, name: string) => run.lanes.find((l) => l.lane === name)!;
    expect(lane(first, "telestrator").bars.map((b) => b.step.source)).toEqual(["template"]);
    expect(lane(first, "narration").bars.map((b) => stepTitle(b.step))).toEqual([
      "Narration · draft",
      "Narration · rewrite 1",
    ]);
    expect(lane(first, "verifier").bars).toHaveLength(2);
    // Only the Telestrator and Voice ran again; the other lanes stay empty in the bring-back.
    expect(back.lanes.filter((l) => l.bars.length).map((l) => l.lane)).toEqual([
      "mcp",
      "telestrator",
      "voice",
    ]);
    expect(lane(back, "telestrator").bars[0].step).toMatchObject({ source: "llm", resumed: true });
  });

  it("the Telestrator and narration lanes overlap: they run in parallel", () => {
    const [first] = timeline(fixture);
    const bar = (name: string) => first.lanes.find((l) => l.lane === name)!.bars[0].step;
    const tele = bar("telestrator");
    const narr = bar("narration");
    expect(tele.start_ms).toBeLessThan(narr.end_ms);
    expect(narr.start_ms).toBeLessThan(tele.end_ms);
  });

  it("formats telemetry times", () => {
    expect(ms(6.54)).toBe("6.5 ms");
    expect(ms(84.4)).toBe("84 ms");
    expect(ms(1240)).toBe("1.24 s");
  });

  it("opens on the step that fell back", () => {
    expect(firstStep(fixture)).toMatchObject({ step: "telestrator", run: 0, source: "template" });
  });
});

describe("the timeline", () => {
  it("draws every step as a bar filled by who answered it", () => {
    const page = html(ready);
    expect(page).toContain("Crew trace");
    expect(page.match(/class="trace-bar /g)).toHaveLength(fixture.steps.length);
    expect(page.match(/class="trace-bar llm/g)?.length).toBe(
      fixture.steps.filter((s) => s.source === "llm").length,
    );
    expect(page).toContain("The run");
    expect(page).toContain("Bring-back: the Telestrator");
    expect(page).toContain("not a claim"); // times are telemetry, and say so
  });

  it("tells the failure drill: down, fallback, waiting, then brought back from a checkpoint", () => {
    const page = mount(<CrewTraceView state={ready} />);
    const kinds = (run: number) =>
      Array.from(page.querySelectorAll(`[data-run="${run}"] .trace-event`))
        .map((li) => li.querySelector(".trace-kind")!.textContent)
        .filter((k) => k !== "Checkpoint");
    expect(kinds(0)).toEqual(["Taken down", "Fallback", "Waiting"]);
    expect(kinds(1)).toEqual(["Brought back"]);
    const back = page.querySelector('[data-run="1"] .trace-event.back')!.textContent!;
    expect(back).toMatch(/resumes from checkpoint [0-9a-f]{8} \(superstep \d+\)/);
    const checkpoints = page.querySelectorAll('[data-run="0"] .trace-event.checkpoint');
    expect(checkpoints.length).toBeGreaterThanOrEqual(4);
    expect(checkpoints[checkpoints.length - 1].textContent).toContain("waiting: down:telestrator");
    expect(checkpoints[checkpoints.length - 1].textContent).toMatch(/holds .*findings.*plan/);
  });

  it("shows the step that fell back: its outage, typed input and output, and shared state", () => {
    const page = mount(<CrewTraceView state={ready} />);
    const card = page.querySelector(".trace-step")!;
    expect(card.querySelector("h4")!.textContent).toBe("Telestrator");
    expect(card.textContent).toContain("Template");
    expect(card.textContent).toContain("AgentDown · 2 attempts");
    expect(card.textContent).toContain("Findings");
    expect(card.textContent).toContain("TelestrationPlan");
    expect(card.textContent).toContain("(telemetry)");
    const keys = (label: string) => {
      const dt = Array.from(card.querySelectorAll("dt")).find((d) => d.textContent === label)!;
      return Array.from(dt.nextElementSibling!.querySelectorAll("code")).map((c) => c.textContent);
    };
    expect(keys("Wrote")).toEqual(["plan"]);
    expect(keys("Read")).toContain("evidence.card");
  });

  it("picking the Analyst shows its MCP tool calls with arguments and results", () => {
    const page = mount(<CrewTraceView state={ready} />);
    const analyst = page.querySelector<HTMLButtonElement>(
      '[data-run="0"] [data-lane="analyst"] .trace-bar',
    )!;
    act(() => analyst.click());
    expect(analyst.getAttribute("aria-pressed")).toBe("true");
    const card = page.querySelector(".trace-step")!;
    const calls = Array.from(card.querySelectorAll(".trace-tools .call")).map((c) => c.textContent);
    expect(calls).toEqual(["get_moment()", "run_counterfactual()"]);
    expect(card.querySelector(".trace-tools pre")!.textContent).toContain(
      "m:decision_after_scan:H8:0075",
    );
    expect(card.textContent).toContain("arguments written by the model");
    expect(card.textContent).toContain("not a claim");
  });

  it("picking the Verifier's first round shows the line it sent back; the rewrite shows both", () => {
    const page = mount(<CrewTraceView state={ready} />);
    const [first] = page.querySelectorAll<HTMLButtonElement>(
      '[data-run="0"] [data-lane="verifier"] .trace-bar',
    );
    act(() => first.click());
    let card = page.querySelector(".trace-step")!;
    expect(card.querySelector("h4")!.textContent).toBe("Verifier · round 1");
    expect(card.textContent).toContain("Sent back by the Verifier");
    expect(card.textContent).toContain("stale_claim");
    expect(card.textContent).toContain("Rewrite"); // its output: the rewrite request

    const [, rewrite] = page.querySelectorAll<HTMLButtonElement>(
      '[data-run="0"] [data-lane="narration"] .trace-bar',
    );
    act(() => rewrite.click());
    card = page.querySelector(".trace-step")!;
    expect(card.querySelector("h4")!.textContent).toBe("Narration · rewrite 1");
    expect(card.textContent).toContain("Rewritten by the voice that wrote it");
    expect(card.textContent).toContain("blind_side → cf_pass");
  });

  it("a breakdown cached before traces were recorded says so, and invents nothing", () => {
    const page = html({ status: "missing" });
    expect(page.toLowerCase()).toContain(NOT_RECORDED);
    expect(page).not.toContain("trace-bar");
  });
});

describe("why a crew, from the crew-vs-single eval", () => {
  it("cites the eval's findings with the report, the cost and the no-quality-win included", () => {
    const page = mount(<CrewTraceView state={ready} />);
    const aside = page.querySelector(".trace-why")!;
    const items = [...aside.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(CREW_VS_SINGLE.findings.map((f) => f.text));
    expect(aside.textContent).toContain("3 of 4 roles from the model");
    expect(aside.textContent).toContain("Not a quality win");
    expect(aside.querySelector("a")!.getAttribute("href")).toBe(CREW_VS_SINGLE.report);
  });

  it("is about breakdowns: a recap's trace does not cite it", () => {
    const recap = { ...fixture, story: "recap" };
    const page = mount(<CrewTraceView state={{ status: "ready", trace: recap }} />);
    expect(page.querySelector(".trace-why")).toBeNull();
  });
});

describe("loading a trace", () => {
  const api = (route: Route) =>
    createApi(API, "blind_side_run-3", fakeFetch({ [`GET /api/breakdowns/${KEY}/trace`]: route }));

  it("reads a recorded trace", async () => {
    const state = await loadTrace(
      api(() => json({ key: KEY, recorded: true, trace: fixtureJson })),
      "breakdowns",
      KEY,
    );
    expect(state.status).toBe("ready");
  });

  it("a cached run without one is missing, not failed", async () => {
    const state = await loadTrace(
      api(() => json({ key: KEY, recorded: false, trace: null, detail: NOT_RECORDED })),
      "breakdowns",
      KEY,
    );
    expect(state).toEqual({ status: "missing" });
  });

  it("an unknown key or a malformed trace fails with a reason", async () => {
    const missing = await loadTrace(
      api(() => json({ detail: "no" }, 404)),
      "breakdowns",
      KEY,
    );
    expect(missing).toMatchObject({ status: "failed" });
    expect((missing as { error: string }).error).toContain("HTTP 404");
    const bad = await loadTrace(
      api(() => json({ key: KEY, recorded: true, trace: { version: 2 } })),
      "breakdowns",
      KEY,
    );
    expect(bad).toMatchObject({ status: "failed" });
  });
});

describe("from the Producer desk and the breakdown", () => {
  function online() {
    const fetch = fakeFetch({
      "POST /api/breakdowns": (body) =>
        (body as { fail?: string[] }).fail
          ? json(
              breakdownResponse(
                { cached: false },
                {
                  key: KEY,
                  trace: telestratorDownTrace(),
                  plan_source: "template",
                  drill: { down: ["telestrator"], pending: ["telestrator"] },
                },
              ),
            )
          : json(breakdownResponse()),
      [`GET /api/breakdowns/${KEY}/trace`]: () =>
        json({ key: KEY, recorded: true, trace: fixtureJson }),
    });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fetch),
    });
    return { session, fetch };
  }

  it("opens the crew trace of the drill on screen", async () => {
    const { session, fetch } = online();
    session.controls.requestBreakdown();
    await settle();
    session.controls.toggleDown("telestrator");
    session.controls.runDrill();
    await settle();
    const page = mount(<BreakdownPanel />, session);
    const open = Array.from(page.querySelectorAll<HTMLButtonElement>("button.trace-open"));
    expect(open.length).toBe(2); // in the breakdown's head and on the Producer desk
    expect(open.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
    await act(async () => {
      open[1].click();
      await settle();
    });
    expect(fetch.calls.at(-1)).toMatchObject({
      method: "GET",
      path: `/api/breakdowns/${KEY}/trace`,
    });
    expect(page.querySelector(".crew-trace")).not.toBeNull();
    expect(page.querySelectorAll(".trace-bar")).toHaveLength(fixture.steps.length);
    expect(open[0].getAttribute("aria-expanded")).toBe("true");
  });
});
