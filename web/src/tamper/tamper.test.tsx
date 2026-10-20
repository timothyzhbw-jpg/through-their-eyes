// "Try a wrong number" (SPEC 7 producer console, SPEC 5.3): change one value of a claim in the
// evidence card and the live service's verifier checks it again, POST /api/verify. A wrong number
// is refuted and its line would not air; the verified one is supported. Online only.

import { describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { applyDeepLink, parseDeepLink } from "../deeplink";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import {
  API,
  breakdownResponse,
  fakeFetch,
  json,
  render,
  settle,
  verifyResponse,
  type Route,
} from "../testing";
import { EvidenceCard } from "../ui/Narration";
import { IDLE_TAMPER, numericValues, tamperError, wrongNumber } from "./tamper";

const hero = parseHero(raw);

function online(verify: Route = (body) => json(verifyResponse((body as { value: number }).value))) {
  const fetch = fakeFetch({
    "POST /api/breakdowns": () => json(breakdownResponse()),
    "POST /api/verify": verify,
  });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
  });
  return { session, fetch };
}

/** Online, with the service's breakdown on screen and the cf_value line's evidence open. */
async function onCfValue(verify?: Route) {
  const o = online(verify);
  o.session.controls.requestBreakdown();
  await settle();
  o.session.controls.openLine("L2");
  return o;
}

const verifyCalls = (calls: { path: string; body: unknown }[]) =>
  calls.filter((c) => c.path === "/api/verify").map((c) => c.body);

describe("a wrong number in the evidence card", () => {
  it("offers the control for each numeric value of a claim, prefilled with a wrong one", async () => {
    const { session } = await onCfValue();
    let html = render(session, <EvidenceCard />);
    expect(html).toContain("Try a wrong number");
    expect(html).not.toContain('name="dxt"'); // closed until asked
    session.controls.openTamper("cf_value");
    html = render(session, <EvidenceCard />);
    expect(html).toMatch(/<input[^>]*name="dxt"[^>]*value="0.17"/);
    expect(html).toContain("Nothing you try is saved or aired");
    // Claims without numbers (scan_before_reception, cf_pass) get no control.
    session.controls.openLine("L1");
    expect(render(session, <EvidenceCard />)).not.toContain("Try a wrong number");
  });

  it("sends the changed number and shows the verifier refusing the line", async () => {
    const { session, fetch } = await onCfValue();
    session.controls.openTamper("cf_value");
    await session.controls.tryValue("cf_value", "dxt", 0.5);
    expect(verifyCalls(fetch.calls)).toEqual([
      { match: "blind_side_run-3", claim: "cf_value", slot: "dxt", value: 0.5, language: "en" },
    ]);
    expect(session.tamper.get()).toMatchObject({ status: "done", claim: "cf_value", slot: "dxt" });
    const html = render(session, <EvidenceCard />);
    expect(html).toContain("Refuted — this line would not air");
    expect(html).toContain("<s>That look was worth 0.50 in expected threat.</s>");
    expect(html).toContain("approx(0.11074015198311513, 0.5) is false");
    expect(html).toContain("the match data says 0.11");
  });

  it("supports the verified value: that line would air", async () => {
    const { session } = await onCfValue();
    session.controls.openTamper("cf_value");
    await session.controls.tryValue("cf_value", "dxt", 0.11);
    const html = render(session, <EvidenceCard />);
    expect(html).toContain("Supported — this line would air");
    expect(html).not.toContain("<s>");
    expect(html).toContain("That look was worth 0.11 in expected threat.");
  });

  it("says when a changed number is still true, and when the verifier cannot decide", async () => {
    const still = await onCfValue((body) =>
      json({
        ...verifyResponse((body as { value: number }).value),
        status: "supported",
        airs: true,
        violations: [],
      }),
    );
    still.session.controls.openTamper("cf_value");
    await still.session.controls.tryValue("cf_value", "dxt", 0.12);
    expect(render(still.session, <EvidenceCard />)).toContain("This number is true as well");

    const unsure = await onCfValue((body) =>
      json({
        ...verifyResponse((body as { value: number }).value),
        status: "inconclusive",
        reason: "m:decision_after_scan:H8:0075.reception-3 s is before the recorded run",
      }),
    );
    unsure.session.controls.openTamper("cf_value");
    await unsure.session.controls.tryValue("cf_value", "dxt", 3);
    const html = render(unsure.session, <EvidenceCard />);
    expect(html).toContain("Inconclusive — this line would not air");
    expect(html).toContain("before the recorded run");
  });

  it("explains the service's limits instead of an HTTP status", async () => {
    const limited = await onCfValue(() =>
      json({ detail: "too many checks from this address: try again in a minute" }, 429),
    );
    limited.session.controls.openTamper("cf_value");
    await limited.session.controls.tryValue("cf_value", "dxt", 0.5);
    expect(limited.session.tamper.get().status).toBe("failed");
    expect(render(limited.session, <EvidenceCard />)).toContain(
      "No check: too many checks from this address: try again in a minute",
    );

    const down = await onCfValue(() => "fail");
    down.session.controls.openTamper("cf_value");
    await down.session.controls.tryValue("cf_value", "dxt", 0.5);
    expect(render(down.session, <EvidenceCard />)).toContain("No check: /api/verify:");
  });

  it("shows only the latest answer, and forgets it on another line or breakdown", async () => {
    let release: (r: Response) => void = () => {};
    const { session } = await onCfValue((body) => {
      const { value } = body as { value: number };
      if (value === 0.5) return new Promise<Response>((r) => (release = r)); // slow
      return json(verifyResponse(value));
    });
    session.controls.openTamper("cf_value");
    const slow = session.controls.tryValue("cf_value", "dxt", 0.5);
    await session.controls.tryValue("cf_value", "dxt", 0.11);
    release(json(verifyResponse(0.5)));
    await slow;
    expect(session.tamper.get().result?.value).toBe(0.11);

    session.controls.openLine("L2", "cf_value"); // "Show at …" in the same card keeps it
    expect(session.tamper.get().open).toBe("cf_value");
    session.controls.openLine("L3");
    expect(session.tamper.get()).toEqual(IDLE_TAMPER);

    session.controls.openLine("L2");
    session.controls.openTamper("cf_value");
    session.controls.setLanguage("zh"); // a new breakdown replaces this one
    await settle();
    expect(session.tamper.get()).toEqual(IDLE_TAMPER);
  });

  it("checks the line in the breakdown's language", async () => {
    const { session, fetch } = await onCfValue();
    session.breakdown.set({ language: "zh" });
    await session.controls.tryValue("cf_value", "dxt", 0.5);
    expect(verifyCalls(fetch.calls)[0]).toMatchObject({ language: "zh" });
  });
});

describe("offline", () => {
  it("shows the control disabled: checking needs the live service", async () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null);
    session.controls.openLine("L5"); // cf_pass + cf_value in the bundled fixture
    session.controls.openTamper("cf_value");
    const html = render(session, <EvidenceCard />);
    expect(html).toContain("needs the live service");
    expect(html).toMatch(/<input[^>]*disabled/);
    await session.controls.tryValue("cf_value", "dxt", 0.5); // no service: nothing happens
    expect(session.tamper.get().status).toBe("idle");
  });
});

describe("the deep link ?tamper=<claim id>", () => {
  it("reads a claim id, opens paused, and ignores anything else", () => {
    expect(parseDeepLink("?tamper=cf_value")).toMatchObject({
      tamper: "cf_value",
      autoplay: false,
    });
    expect(parseDeepLink("").tamper).toBeNull();
    const bad = parseDeepLink("?tamper=%3Cscript%3E");
    expect(bad.tamper).toBeNull();
    expect(bad.warnings).toEqual(["tamper=<script>"]);
  });

  it("asks for the breakdown at once and opens the card on that claim when it arrives", async () => {
    const { session, fetch } = online();
    applyDeepLink(session, parseDeepLink("?tamper=cf_value"));
    expect(fetch.calls.map((c) => c.path)).toEqual(["/api/breakdowns"]);
    await settle();
    expect(session.playback.get()).toMatchObject({
      evidenceLine: "L2",
      mode: "counterfactual",
      playing: false,
    });
    expect(session.tamper.get().open).toBe("cf_value");
    expect(render(session, <EvidenceCard />)).toMatch(/<input[^>]*name="dxt"/);
  });

  it("falls back to the first claim with a number when no line carries the linked one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { session } = online();
    applyDeepLink(session, parseDeepLink("?tamper=pass_speed"));
    await settle();
    expect(session.playback.get().evidenceLine).toBe("L2");
    expect(session.tamper.get().open).toBe("cf_value");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pass_speed"));
    warn.mockRestore();
  });

  it("opens the bundled breakdown's card offline", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null);
    applyDeepLink(session, parseDeepLink("?tamper=cf_value"));
    expect(session.playback.get().evidenceLine).toBe("L5");
    expect(session.tamper.get().open).toBe("cf_value");
  });
});

describe("helpers", () => {
  it("suggests a wrong number at the shown precision, never the true one", () => {
    expect(wrongNumber(0.11)).toBe(0.17);
    expect(wrongNumber(0.1)).toBe(0.2);
    expect(wrongNumber(83)).toBe(125);
    expect(wrongNumber(1)).toBe(2);
    expect(wrongNumber(0)).toBe(1);
    expect(wrongNumber(0.05)).toBe(0.08);
    expect(wrongNumber(-2)).toBe(-3);
  });

  it("lists the numeric values of a claim only", () => {
    expect(numericValues({ values: { dxt: 0.11, who: "H4", ok: true, n: 2 } })).toEqual([
      ["dxt", 0.11],
      ["n", 2],
    ]);
  });

  it("turns the service's refusals into a sentence", () => {
    expect(tamperError(new Error("boom"))).toBe("boom");
  });
});
