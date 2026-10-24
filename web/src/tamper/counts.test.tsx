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

/** The verified count and window, read from the payload's scans claim. */
const { n: TRUE_N, window_s: WINDOW_S } = (
  payloadJson as { claims: { id: string; values: { n: number; window_s: number } }[] }
).claims.find((c) => c.id === "scans_before_reception")!.values;

/** What the service's verifier says of "scanned n times": true for the verified count. */
function verifyCount(body: unknown) {
  const { value } = body as { value: number };
  const supported = value === TRUE_N;
  return json({
    match: "blind_side_run-3",
    claim: "scans_before_reception",
    slot: "n",
    language: "en",
    value,
    verified_value: TRUE_N,
    status: supported ? "supported" : "refuted",
    reason: supported ? `eq(${TRUE_N}, ${TRUE_N}) holds` : `eq(${TRUE_N}, ${value}) is false`,
    trace: [],
    line: `H8 scanned ${value} times in the ${WINDOW_S} seconds before receiving.`,
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

  it.each([...new Set([0, TRUE_N, 3, 7])])(
    "takes %i, sends it and shows the Verifier's answer",
    async (n) => {
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
        n === TRUE_N ? "Supported — this line would air" : "Refuted — this line would not air",
      );
      expect(text).toContain(`scanned ${n} times`);
    },
  );
});
