// @vitest-environment happy-dom
// "Try a wrong number" on a count (SPEC 7, 5.3): the scans claim's `n` takes any whole number the
// claim type allows (0, 1, 3, 7 …), the input lets it be typed and the Verifier answers.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext } from "../session";
import { API, breakdownResponse, fakeFetch, json, settle } from "../testing";
import { EvidenceCard } from "../ui/Narration";
import { wrongNumber } from "./tamper";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

/** What the service's verifier says of "scanned n times": true for the verified count, 1. */
function verifyCount(body: unknown) {
  const { value } = body as { value: number };
  const supported = value === 1;
  return json({
    match: "blind_side_run-3",
    claim: "scans_before_reception",
    slot: "n",
    language: "en",
    value,
    verified_value: 1,
    status: supported ? "supported" : "refuted",
    reason: supported ? "eq(1, 1) holds" : `eq(1, ${value}) is false`,
    trace: [],
    line: `H8 scanned ${value} times in the 2 seconds before receiving.`,
    airs: supported,
    violations: [],
  });
}

async function mountCard() {
  const fetch = fakeFetch({
    "POST /api/breakdowns": () => json(breakdownResponse({}, { payload: payloadJson })),
    "POST /api/verify": verifyCount,
  });
  const session = createSession(parseHero(raw), EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
  });
  session.controls.requestBreakdown();
  await act(settle);
  act(() => session.controls.openLine("L2"));
  act(() => session.controls.openTamper("scans_before_reception"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <EvidenceCard />
      </SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return { session, fetch, container };
}

function type(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("a wrong count in the evidence card", () => {
  it("prefills a count other than the verified one", () => {
    expect(wrongNumber(1)).toBe(2);
    expect(wrongNumber(0)).toBe(1);
  });

  it.each([0, 1, 3, 7])("takes %i, sends it and shows the Verifier's answer", async (n) => {
    const { fetch, container } = await mountCard();
    const input = container.querySelector<HTMLInputElement>('input[name="n"]')!;
    expect(input).not.toBeNull();
    expect(input.min).toBe("");
    expect(input.max).toBe("");
    type(input, String(n));
    expect(input.value).toBe(String(n));
    const form = input.closest("form")!;
    const check = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(check.disabled).toBe(false);
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await settle();
    });
    const sent = fetch.calls.filter((c) => c.path === "/api/verify").map((c) => c.body);
    expect(sent).toEqual([
      {
        match: "blind_side_run-3",
        claim: "scans_before_reception",
        slot: "n",
        value: n,
        language: "en",
      },
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain(
      n === 1 ? "Supported — this line would air" : "Refuted — this line would not air",
    );
    expect(text).toContain(`scanned ${n} times`);
  });
});
