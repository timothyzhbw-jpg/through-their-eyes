// @vitest-environment happy-dom
// Where a breakdown or a recap came from, shown exactly as the API says it (`provenance`): live,
// cached with the original run's time, or the offline template with its reason. Nothing is worked
// out from `cached` or `source`, and no cached or template answer reads as a fresh crew run.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { BreakdownResponse, createApi } from "../api/client";
import { CrewTraceView } from "../crewtrace/CrewTrace";
import fixtureJson from "../crewtrace/fixture.json";
import { CrewTrace } from "../crewtrace/trace";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { API, breakdownResponse, fakeFetch, json, RAN_AT, settle } from "../testing";
import { BreakdownSource } from "../ui/Narration";
import { MomentCard } from "../ui/Stage";
import { Provenance, provenanceText, utcTime } from "./provenance";
import { ProvenanceChip } from "./ProvenanceChip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const LIVE: Provenance = { kind: "live", ran_at: RAN_AT, reason: null };
const CACHED: Provenance = { kind: "cached", ran_at: RAN_AT, reason: null };
const template = (reason: Provenance["reason"]): Provenance => ({
  kind: "template",
  ran_at: RAN_AT,
  reason,
});

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(node: ReactNode, session?: Session): HTMLElement {
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

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

describe("the sentence for each state", () => {
  it("live: written by the crew just now", () => {
    expect(provenanceText(LIVE)).toBe("Live: written by the crew just now");
  });

  it("cached: a crew run from its original time, in UTC", () => {
    expect(utcTime(RAN_AT)).toBe("21 Oct 2026, 19:31 UTC");
    expect(provenanceText(CACHED)).toBe("Cached: a crew run from 21 Oct 2026, 19:31 UTC");
    expect(provenanceText({ ...CACHED, ran_at: null })).toBe(
      "Cached: a crew run from before run times were recorded",
    );
  });

  it("template: no model call, and why", () => {
    expect(provenanceText(template("rate_limited"))).toBe(
      "Offline template: no model call (rate-limited: too many new requests from this address)",
    );
    expect(provenanceText(template("capped"))).toBe(
      "Offline template: no model call (today's model budget is used up)",
    );
    expect(provenanceText(template("model_unavailable"))).toBe(
      "Offline template: no model call (the model is unavailable on this service)",
    );
  });

  it("a cached or template answer never reads as fresh", () => {
    for (const p of [CACHED, template("capped"), template("rate_limited")]) {
      expect(provenanceText(p)).not.toMatch(/just now|Live/);
    }
  });

  it("shows nothing when the service did not say", () => {
    expect(text(mount(<ProvenanceChip provenance={null} />))).toBe("");
  });
});

function online(response: object): Session {
  const fetch = fakeFetch({ "POST /api/breakdowns": () => json(response) });
  return createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    makeAudio: () => ({ play: async () => {}, pause: () => {}, onended: null }),
  });
}

async function shown(response: object) {
  const session = online(response);
  const card = mount(<MomentCard />, session);
  const source = mount(<BreakdownSource />, session);
  act(() => session.controls.requestBreakdown());
  await act(settle);
  return { card: text(card)!, source: text(source)! };
}

describe("on the breakdown card and the narration, from the API's answer", () => {
  it("a fresh crew run is live", async () => {
    const { card, source } = await shown(breakdownResponse({ cached: false }));
    expect(card).toContain("Live: written by the crew just now");
    expect(source).toContain("Live: written by the crew just now");
  });

  it("a cached crew run shows when it ran", async () => {
    const { card, source } = await shown(breakdownResponse({ cached: true }));
    expect(card).toContain("Cached: a crew run from 21 Oct 2026, 19:31 UTC");
    expect(source).toContain("Cached: a crew run from 21 Oct 2026, 19:31 UTC");
    expect(card).not.toContain("just now");
  });

  it("an offline template says so and why, never 'written by the crew'", async () => {
    for (const reason of ["rate_limited", "capped", "model_unavailable"] as const) {
      const res = breakdownResponse(
        { cached: false, rate_limited: reason === "rate_limited", capped: reason === "capped" },
        { source: "offline", provenance: template(reason) },
      );
      const { card, source } = await shown(res);
      expect(card).toContain(provenanceText(template(reason)));
      expect(source).toContain(provenanceText(template(reason)));
      expect(card).not.toMatch(/Written by the crew|Live:/);
    }
  });

  it("the chip is what the API said, not worked out from `cached` or `source`", async () => {
    // A contradictory answer: the flags say cached model run, provenance says template.
    const res = breakdownResponse({ cached: true }, { provenance: template("capped") });
    const { card } = await shown(res);
    expect(card).toContain("Offline template: no model call (today's model budget is used up)");
    expect(card).not.toContain("Cached:");
  });

  it("an older service that did not say gets no claim about who wrote it", async () => {
    const { card } = await shown(breakdownResponse({ cached: false }, { provenance: null }));
    expect(card).not.toMatch(/Written by the crew|Live:|Cached:|Offline template/);
    expect(card).toContain("Every number checked in code");
  });

  it("parses with the client's schema", () => {
    const parsed = BreakdownResponse.parse(breakdownResponse({ cached: true }));
    expect(parsed.provenance).toEqual(CACHED);
  });
});

describe("in the crew trace", () => {
  it("shows the same chip, and each run's start time", () => {
    const trace = CrewTrace.parse(fixtureJson);
    const page = mount(<CrewTraceView state={{ status: "ready", trace }} provenance={CACHED} />);
    expect(text(page.querySelector(".provenance-chip"))).toBe(
      "Cached: a crew run from 21 Oct 2026, 19:31 UTC",
    );
    const heads = [...page.querySelectorAll(".trace-run-head")].map(text);
    expect(heads[0]).toContain(`started ${utcTime(trace.runs[0].started)}`);
    expect(heads[1]).toContain(`started ${utcTime(trace.runs[1].started)}`);
  });
});
