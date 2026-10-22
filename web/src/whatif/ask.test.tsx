// Free "What if…?" questions (SPEC 6, 7) go to POST /api/whatif; the answer is checked like a
// precomputed one and replays with the forced run as the ghost. Suggested questions keep working
// without the service.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import {
  API,
  fakeFetch,
  json,
  refusalResponse,
  render,
  settle,
  whatIfResponse,
  type Route,
} from "../testing";
import { WhatIfPanel } from "../ui/WhatIfPanel";

const hero = parseHero(raw);
const QUESTION = "What if he had played it back to H4 instead?";

function online(route: Route) {
  const fetch = fakeFetch({ "POST /api/whatif": route });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
    api: createApi(API, "blind_side_run-3", fetch),
  });
  return { session, fetch };
}

describe("free what-if questions", () => {
  it("sends the question and replays the verified answer with its ghost", async () => {
    const { session, fetch } = online(() => json(whatIfResponse(QUESTION)));
    session.controls.setPersona("analyst");
    await session.controls.askFree(`  ${QUESTION} `, "en");
    expect(fetch.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/whatif",
      body: { match: "blind_side_run-3", question: QUESTION, language: "en", persona: "analyst" },
    });
    const ask = session.ask.get();
    expect(ask).toMatchObject({ status: "answered", action: "pass:H4", cached: true });
    expect(ask.narration?.lines.map((l) => l.id)).toEqual(["Q1", "Q2"]);
    expect(session.playback.get()).toMatchObject({
      whatIf: "pass:H4",
      mode: "factual",
      frame: session.whatIfs!.start,
      playing: true,
    });
    const html = render(session, <WhatIfPanel />);
    expect(html).toContain(QUESTION);
    expect(html).toContain(
      "If J. Ferriday had passed to K. Annersley, K. Annersley would have received it.",
    );
    expect(html).toContain("Counterfactual · inside the sim");
  });

  it("shows the refusal when the question matches no option", async () => {
    const { session } = online(() => json(refusalResponse("What if he scored a bicycle kick?")));
    await session.controls.askFree("What if he scored a bicycle kick?", "en");
    expect(session.ask.get()).toMatchObject({ status: "refused", capped: true });
    expect(session.playback.get().whatIf).toBeNull();
    const html = render(session, <WhatIfPanel />);
    expect(html).toContain("That is not something he could do from there.");
    expect(html).toContain("Daily cap reached");
  });

  it("says so when the service fails", async () => {
    const { session } = online(() => "fail");
    await session.controls.askFree(QUESTION, "en");
    expect(session.ask.get()).toMatchObject({ status: "failed" });
    expect(render(session, <WhatIfPanel />)).toContain("No answer:");
  });

  it("a suggested question replaces a free answer", async () => {
    const { session } = online(() => json(whatIfResponse(QUESTION)));
    await session.controls.askFree(QUESTION, "en");
    session.controls.askWhatIf("carry");
    expect(session.ask.get().status).toBe("idle");
    expect(session.playback.get().whatIf).toBe("carry");
  });
});

describe("offline", () => {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);

  it("disables the free question, and the suggested ones still answer", async () => {
    const html = render(session, <WhatIfPanel />);
    expect(html).toMatch(/<input[^>]*disabled/);
    expect(html).toContain("needs the live service");
    await session.controls.askFree(QUESTION, "en"); // no service: nothing happens
    expect(session.ask.get().status).toBe("idle");
    session.controls.askWhatIf("pass:H4");
    expect(session.playback.get().whatIf).toBe("pass:H4");
    expect(render(session, <WhatIfPanel />)).toContain("What if he passed to K. Annersley?");
    await settle();
  });
});
