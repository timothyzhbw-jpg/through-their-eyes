// @vitest-environment happy-dom
// The end-of-match recap in the page: the card below the match, the caption and reel overlays over
// the live screen, and the button that asks for it from the Moments panel.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { createApi, type Persona } from "../api/client";
import { parseHero } from "../data/hero";
import { HERO_FILE, PAYLOAD_FILE, WHAT_IF_FILE } from "../data/load";
import { createMatchSession, type MatchSession } from "../match/matchSession";
import { SessionContext } from "../session";
import {
  API,
  exportJson,
  fakeFetch,
  fakeSockets,
  health,
  json,
  MATCH,
  matchExport,
  matchInfo,
  settle,
  type Route,
} from "../testing";
import { MomentsPanel } from "../ui/Live";
import type { Language } from "../whatif/whatif";
import { recapFixture } from "./fixture";
import { RecapCaption, RecapPanel, RecapStage } from "./RecapPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const raw = matchExport();
const fixture = recapFixture(raw);
const cardLines = fixture.result.scripts[0].card.lines;

const bundled: Record<string, Route> = {
  [`GET /data/${HERO_FILE}`]: () => json(exportJson),
  [`GET /data/${PAYLOAD_FILE}`]: () => json(payloadJson),
  [`GET /data/${WHAT_IF_FILE}`]: () => json(whatIfJson),
};

function online(routes: Record<string, Route> = {}) {
  const fetch = fakeFetch({
    ...bundled,
    "GET /health": health,
    [`GET /api/matches/${MATCH}`]: () => json(matchInfo(raw)),
    [`GET /api/matches/${MATCH}/export`]: () => json(raw),
    "POST /api/recaps": (body) => {
      const { personas, languages } = body as { personas: string[]; languages: string[] };
      return json(recapFixture(raw, personas[0] as Persona, languages[0] as Language));
    },
    ...routes,
  });
  const sockets = fakeSockets();
  const hero = parseHero(structuredClone(raw));
  const session = createMatchSession(hero, {
    api: createApi(API, MATCH, fetch),
    dataUrl: "/data/",
    fetch,
    socket: sockets,
  });
  return { session, hero, fetch, sockets };
}

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(session: MatchSession, node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const button = (page: HTMLElement | Element, text: string) =>
  Array.from(page.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) ?? null;

const buttons = (page: HTMLElement, text: string) =>
  Array.from(page.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);

const posts = (fetch: ReturnType<typeof fakeFetch>) =>
  fetch.calls.filter((call) => call.method === "POST" && call.path === "/api/recaps");

async function ready(session: MatchSession) {
  await act(async () => {
    await session.recap.request();
    await settle();
  });
}

describe("the recap card", () => {
  it("writes the recap on request, then shows the checked card", async () => {
    const { session, fetch } = online();
    const page = mount(session, <RecapPanel />);
    expect(page.textContent).toContain("Write the match recap");
    const write = button(page, "Write the match recap")!;
    await act(async () => {
      write.click();
      await settle();
    });
    expect(posts(fetch)).toHaveLength(1);
    expect(posts(fetch)[0].body).toMatchObject({ personas: ["casual"], languages: ["en"] });
    expect(page.querySelector(".recap-score")?.textContent).toContain("1");
    expect(page.querySelector(".recap-score")?.textContent).toContain("0");
    for (const line of cardLines.filter((candidate) => /^K/.test(candidate.id))) {
      expect(page.textContent).toContain(line.text);
    }
    expect(page.textContent).toContain(cardLines.find((line) => line.id === "T1")!.text);
    expect(buttons(page, "Watch")).toHaveLength(3);
    expect(buttons(page, "Breakdown")).toHaveLength(2);
  });

  it("watches a moment's clip on the match's own playback", async () => {
    const { session } = online();
    await ready(session);
    const page = mount(session, <RecapPanel />);
    const lineBreak = raw.moments.find((m) => m.kind === "line_breaking_pass")!;
    const text = cardLines.find((line) => line.id === "K2")!.text;
    const row = Array.from(page.querySelectorAll(".recap-moments li")).find((li) =>
      li.textContent?.includes(text),
    )!;
    const clip = fixture.result.reel.clips.find((c) => c.moment === lineBreak.id)!;
    act(() => row.querySelector("button")!.click());
    expect(session.playback.get()).toMatchObject({
      frame: clip.frame_in,
      playUntil: clip.frame_out,
      playing: true,
    });
  });

  it("asks for another language and shows its score line", async () => {
    const { session, fetch } = online();
    await ready(session);
    const page = mount(session, <RecapPanel />);
    await act(async () => {
      button(page, "中文")!.click();
      await settle();
    });
    expect(posts(fetch).at(-1)?.body).toMatchObject({ languages: ["zh"] });
    const score = recapFixture(raw, "casual", "zh").result.scripts[0].card.lines.find(
      (line) => line.id === "S",
    )!;
    expect(page.querySelector(".recap-score")?.textContent).toContain(score.text);
  });

  it("shows no number outside a verified line, the score or a clock time", async () => {
    const { session } = online();
    await ready(session);
    const page = mount(session, <RecapPanel />);
    const verified = [...cardLines, ...fixture.result.scripts[0].payload.lines].map(
      (line) => line.text,
    );
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const found: string[] = [];
    let digits = 0;
    while (walker.nextNode()) {
      // JSX splits "{clock} s" into two text nodes: read the element that holds them.
      const parent = walker.currentNode.parentElement;
      const text = parent?.textContent?.trim() ?? "";
      // Player ids (H8) are names, as in the Verifier's render check, not numbers.
      if (!/\d/.test(text.replace(/\b[HA]\d{1,2}\b/g, ""))) continue;
      digits += 1;
      const inScore = parent?.closest(".recap-score") != null;
      if (inScore && (text === "1" || text === "0")) continue;
      if (/^\d+\.\d\d s$/.test(text)) continue;
      if (verified.some((line) => line.includes(text))) continue;
      found.push(text);
    }
    expect(digits).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});

describe("the recap over the live screen", () => {
  it("offers the reel at full time, then its intro, title and caption", async () => {
    const { session } = online();
    const page = mount(
      session,
      <>
        <RecapStage />
        <RecapCaption />
      </>,
    );
    await act(async () => {
      session.recap.fullTime();
      await settle();
    });
    expect(page.textContent).toContain("Full time");
    const play = button(page, "Play the recap reel")!;
    expect(play).not.toBeNull();
    act(() => play.click());
    expect(session.recap.state.get().reel).not.toBeNull();
    act(() => session.recap.tick(0.5));
    expect(page.querySelector(".recap-card.intro")?.textContent).toContain("Full time");
    act(() => session.recap.tick(2));
    // The title says which moment (as the Moments panel does), the caption what it showed.
    expect(page.querySelector(".recap-title")?.textContent).toBe("Decision after a scan · H8");
    expect(page.querySelector(".recap-caption")?.textContent).toBe(
      cardLines.find((line) => line.id === "K1")!.text,
    );
  });
});

describe("the reel's sound", () => {
  it("is off until the viewer turns it on, beside the reel's play button", async () => {
    const { session } = online();
    await ready(session);
    const page = mount(session, <RecapPanel />);
    const sound = page.querySelector<HTMLButtonElement>("button.recap-sound")!;
    expect(sound.getAttribute("aria-pressed")).toBe("false");
    act(() => sound.click());
    expect(session.recap.voice.state.get().on).toBe(true);
    expect(page.querySelector("button.recap-sound")!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the recap button", () => {
  it("asks for the recap from the Moments panel", async () => {
    const { session, fetch } = online();
    const page = mount(session, <MomentsPanel />);
    const trigger = button(page, "Match recap");
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.click();
      await settle();
    });
    expect(posts(fetch)).toHaveLength(1);
    expect(session.recap.state.get().status).toBe("ready");
  });
});

describe("the recap's crew trace", () => {
  it("opens the trace of the crew run that wrote the recap, or says it was not recorded", async () => {
    const key = fixture.key;
    const { session, fetch } = online({
      [`GET /api/recaps/${key}/trace`]: () =>
        json({
          key,
          recorded: false,
          trace: null,
          detail: "trace not recorded for this cached run",
        }),
    });
    await ready(session);
    const page = mount(session, <RecapPanel />);
    const open = button(page, "Crew trace")!;
    expect(open.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      open.click();
      await settle();
    });
    expect(fetch.calls.at(-1)).toMatchObject({ method: "GET", path: `/api/recaps/${key}/trace` });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(page.querySelector(".crew-trace")!.textContent).toContain(
      "Trace not recorded for this cached run",
    );
    expect(page.querySelector(".trace-bar")).toBeNull(); // nothing made up
  });
});

describe("where the recap came from", () => {
  const recapWith = (patch: Parameters<typeof recapFixture>[3]) =>
    online({ "POST /api/recaps": () => json(recapFixture(raw, "casual", "en", patch)) });

  async function page(patch: Parameters<typeof recapFixture>[3]) {
    const { session } = recapWith(patch);
    await ready(session);
    return mount(session, <RecapPanel />).textContent!.replace(/\s+/g, " ");
  }

  it("a template recap says no model call and the API's reason, not who wrote it", async () => {
    const text = await page({
      source: "offline",
      rate_limited: true,
      provenance: { kind: "template", ran_at: null, reason: "rate_limited" },
    });
    expect(text).toContain(
      "Offline template: no model call (rate-limited: too many new requests from this address)",
    );
    expect(text).not.toContain("budget");
    expect(text).not.toMatch(/Written by the (agent )?crew/);
  });

  it("past the daily cap it says the budget is used up", async () => {
    const text = await page({
      source: "offline",
      capped: true,
      provenance: { kind: "template", ran_at: null, reason: "capped" },
    });
    expect(text).toContain("Offline template: no model call (today's model budget is used up)");
  });

  it("a crew run made now is live; a cached one shows its time", async () => {
    const live = await page({
      source: "model",
      provenance: { kind: "live", ran_at: "2026-10-21T19:31:12+00:00", reason: null },
    });
    expect(live).toContain("Live: written by the crew just now");
    const cached = await page({
      source: "model",
      cached: true,
      provenance: { kind: "cached", ran_at: "2026-10-21T19:31:12+00:00", reason: null },
    });
    expect(cached).toContain("Cached: a crew run from 21 Oct 2026, 19:31 UTC");
    expect(cached).not.toContain("just now");
  });
});
