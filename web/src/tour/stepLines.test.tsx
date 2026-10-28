// @vitest-environment happy-dom
// The quick tour's card speaks its step's verified line when the Sound switch is on (SPEC 7), as
// the caption's lines are spoken: the tour stands the caption down, so without this a tour
// started with sound would stay silent.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import raw from "../../public/data/hero_seed3.json";
import { createApi } from "../api/client";
import { comparisonLines } from "../autoplay/comparison";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { API, breakdownResponse, fakeFetch, json } from "../testing";
import { StepLines } from "./StepLines";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function online() {
  const tts = vi.fn(() => new Response(new Blob(["RIFF"], { type: "audio/wav" })));
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(
      API,
      "blind_side_run-3",
      fakeFetch({
        "POST /api/breakdowns": () => json(breakdownResponse()),
        "POST /api/tts": tts,
      }),
    ),
    makeAudio: () => ({ play: async () => {}, pause() {}, onended: null }),
  });
  // Online, the breakdown waits for the stream; give it the bundled narration, as once it arrives.
  const { narration, script, status } = createSession(
    hero,
    EXAMPLE_PLAN,
    payloadJson,
    null,
  ).breakdown.get();
  const line = comparisonLines(narration).withLook!;
  session.breakdown.set({
    narration,
    script,
    status,
    voice: [
      {
        line,
        speaker: "pbp",
        t: 0,
        voice: "en-US-GuyNeural",
        ssml: "<speak/>",
        cache_key: "k-look",
      },
    ],
  });
  return { session, tts };
}

async function mount(session: Session) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SessionContext.Provider value={session}>
        <StepLines say="look" />
      </SessionContext.Provider>,
    );
    for (let k = 0; k < 3; k++) await new Promise((r) => setTimeout(r, 0));
  });
  mounted.push({ root, container });
  return container;
}

describe("the tour card's line, with sound", () => {
  it("is spoken as the step shows when the Sound switch is on", async () => {
    const { session, tts } = online();
    session.controls.setSound(true);
    const card = await mount(session);
    expect(card.querySelector(".tour-line")).not.toBeNull();
    expect(tts).toHaveBeenCalledTimes(1);
  });

  it("stays silent while the Sound switch is off", async () => {
    const { session, tts } = online();
    await mount(session);
    expect(tts).not.toHaveBeenCalled();
  });
});
