// @vitest-environment happy-dom
// The verifier's answer to "Try a wrong number" comes into view when it arrives (SPEC 7): at
// 1440 x 900 it landed below the card's own scroll box, so the viewer saw no verdict at all.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext } from "../session";
import { API, breakdownResponse, fakeFetch, json, settle, verifyResponse } from "../testing";
import { EvidenceCard } from "../ui/Narration";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("the tamper verdict", () => {
  it("scrolls into view when it arrives, and again for the next check", async () => {
    const fetch = fakeFetch({
      "POST /api/breakdowns": () => json(breakdownResponse()),
      "POST /api/verify": (body) => json(verifyResponse((body as { value: number }).value)),
    });
    const session = createSession(parseHero(raw), EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fetch),
    });
    session.controls.requestBreakdown();
    await act(settle);
    act(() => session.controls.openLine("L2"));
    act(() => session.controls.openTamper("cf_value"));

    const seen: Element[] = [];
    const scroll = vi.fn(function (this: Element) {
      seen.push(this);
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scroll,
    });

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
    expect(scroll).not.toHaveBeenCalled();

    await act(() => session.controls.tryValue("cf_value", "dxt", 0.5));
    await act(settle);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(seen.at(-1)?.classList.contains("tamper-result")).toBe(true);

    const calls = scroll.mock.calls.length;
    await act(() => session.controls.tryValue("cf_value", "dxt", 0.11));
    await act(settle);
    expect(scroll.mock.calls.length).toBeGreaterThan(calls);
  });
});
