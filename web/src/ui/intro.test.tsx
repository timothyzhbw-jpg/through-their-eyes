// @vitest-environment happy-dom
// The pre-match card owns only the first page opening. A hero moment waits for its dismissal,
// online and offline: its key scan comes in the stream's first seconds and must not play under
// the card. A stitched match's stream plays behind it. Switching between a stitched match and a
// hero breakdown never opens the card again.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { App, MatchApp } from "../App";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, tickSession } from "../session";
import {
  API,
  breakdownResponse,
  fakeFetch,
  fakeSockets,
  frameMsg,
  hello,
  HERO_MOMENT,
  json,
  MATCH,
  matchExport,
  matchFrameMsg,
  matchHello,
  momentMsg,
  settle,
} from "../testing";
import { intro } from "./intro";

vi.mock("../views/PovView", () => ({ PovView: () => <canvas /> }));
vi.mock("../views/TacticalView", () => ({ TacticalView: () => <canvas /> }));
vi.mock("../session", async (original) => ({
  ...(await original<typeof import("../session")>()),
  startClock: () => () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  intro.set({ open: false });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return { root, container };
}

function heroSession(online = false) {
  return createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: online ? createApi(API, "blind_side_run-3", fakeFetch({})) : null,
    socket: fakeSockets(),
  });
}

function matchSession() {
  return createMatchSession(parseHero(matchExport()), {
    api: createApi(API, MATCH, fakeFetch({})),
    dataUrl: "/data/",
    socket: fakeSockets(),
  });
}

/** An online hero whose breakdown route answers, and the socket the test plays. */
function onlineHero() {
  const sockets = fakeSockets();
  const fetch = fakeFetch({ "POST /api/breakdowns": () => json(breakdownResponse()) });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    socket: sockets,
  });
  return { session, sockets };
}

function button(page: Element, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.replace(/\s+/g, " ").trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

const click = (el: HTMLElement) => act(() => el.click());

describe("the pre-match autoplay gate", () => {
  it("holds the offline hero's show and breakdown until the card closes", () => {
    const session = heroSession();
    const play = vi.spyOn(session.controls, "autoplay").mockImplementation(() => {});
    intro.set({ open: true });
    mount(
      <SessionContext.Provider value={session}>
        <App autoplay />
      </SessionContext.Provider>,
    );
    expect(play).not.toHaveBeenCalled();
    expect(session.playback.get().playing).toBe(false);

    act(() => intro.set({ open: false }));
    expect(play).toHaveBeenCalledOnce();
  });

  it("starts the online hero stream when the card closes, never under it, and keeps its unmount cleanup", () => {
    const session = heroSession(true);
    const start = vi.spyOn(session.controls, "startLive").mockImplementation(() => {});
    const stop = vi.spyOn(session.feed!, "stop");
    intro.set({ open: true });
    const { root, container } = mount(
      <SessionContext.Provider value={session}>
        <App autoplay />
      </SessionContext.Provider>,
    );
    expect(container.querySelector("[role=dialog]")).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
    // Behind the card the picture rests on the stream's first frame, not on the key scan.
    expect(session.playback.get().frame).toBe(0);

    act(() => intro.set({ open: false }));
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(stop).toHaveBeenCalledOnce();
  });

  it("plays a stitched match's stream behind the card", () => {
    const session = matchSession();
    const start = vi.spyOn(session.controls, "startLive").mockImplementation(() => {});
    intro.set({ open: true });
    const { container } = mount(<MatchApp session={session} autoplay />);
    expect(container.querySelector("[role=dialog]")).not.toBeNull();
    expect(start).toHaveBeenCalledOnce();
  });

  it("keeps an autoplay-disabled hero paused after dismissal", () => {
    const session = heroSession();
    const play = vi.spyOn(session.controls, "playBreakdown");
    intro.set({ open: true });
    mount(
      <SessionContext.Provider value={session}>
        <App autoplay={false} />
      </SessionContext.Provider>,
    );
    act(() => intro.set({ open: false }));
    expect(play).not.toHaveBeenCalled();
    expect(session.playback.get().playing).toBe(false);
  });

  it("keeps an autoplay-disabled stitched match paused after dismissal", () => {
    const session = matchSession();
    const start = vi.spyOn(session.controls, "startLive");
    intro.set({ open: true });
    mount(<MatchApp session={session} autoplay={false} />);
    act(() => intro.set({ open: false }));
    expect(start).not.toHaveBeenCalled();
    expect(session.playback.get().playing).toBe(false);
  });

  it("keeps the background controls inert only while the card is open", () => {
    const session = heroSession();
    intro.set({ open: true });
    const { container } = mount(
      <SessionContext.Provider value={session}>
        <App autoplay={false} />
      </SessionContext.Provider>,
    );
    for (const element of [".stage-content", "main", "footer.legend"]) {
      expect(container.querySelector(element)?.hasAttribute("inert")).toBe(true);
    }

    act(() => intro.set({ open: false }));
    expect(container.querySelectorAll("[inert]")).toHaveLength(0);
  });

  it("never reopens when a hero breakdown opens and the viewer returns to the match", () => {
    const session = matchSession();
    const start = vi.spyOn(session.controls, "startLive").mockImplementation(() => {});
    intro.set({ open: true });
    const { container } = mount(<MatchApp session={session} autoplay />);
    act(() => intro.set({ open: false }));

    act(() => session.screen.set({ hero: heroSession() }));
    expect(intro.get().open).toBe(false);
    expect(container.querySelector("[role=dialog]")).toBeNull();
    act(() => session.controls.backToMatch());
    expect(intro.get().open).toBe(false);
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(start).toHaveBeenCalledOnce();
  });

  it("hands the focus to the live screen's title when the card closes", () => {
    vi.useFakeTimers();
    const closers: [string, (page: HTMLElement) => void][] = [
      ["Skip", (page) => click(button(page, "Skip"))],
      ["Start watching", (page) => click(button(page, "Start watching"))],
      [
        "Escape",
        () =>
          act(() => {
            document.activeElement!.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
          }),
      ],
      ["the countdown", () => act(() => void vi.advanceTimersByTime(6000))],
    ];
    for (const [how, close] of closers) {
      intro.set({ open: true });
      const { container } = mount(
        <SessionContext.Provider value={heroSession()}>
          <App autoplay={false} />
        </SessionContext.Provider>,
      );
      expect(document.activeElement?.textContent, how).toContain("Start watching");
      close(container);
      expect(container.querySelector("[role=dialog]"), how).toBeNull();
      // Not <body>: the next Tab would skip the whole live screen.
      const title = container.querySelector(".stage-head h1");
      expect(document.activeElement, how).toBe(title);
      act(() => mounted.pop()!.root.unmount());
      container.remove();
    }
  });

  it("on a cold load with no input, the card is gone and the stream is playing by 6 s", () => {
    vi.useFakeTimers();
    const { session, sockets } = onlineHero();
    intro.set({ open: true });
    const { container } = mount(
      <SessionContext.Provider value={session}>
        <App autoplay />
      </SessionContext.Provider>,
    );
    expect(sockets.sockets, "no stream under the open card").toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(sockets.sockets, "the live stream starts as the card closes").toHaveLength(1);
    const ws = sockets.sockets[0];
    act(() => {
      ws.open();
      ws.push(hello(), frameMsg(0), frameMsg(1), frameMsg(2));
    });
    expect(intro.get().open).toBe(false);
    expect(session.playback.get()).toMatchObject({ live: true, playing: true });
    expect(session.feed!.state.get().status).toBe("streaming");
  });

  it("on a cold load with no input, the run without the look is on screen and said within 20 s", async () => {
    vi.useFakeTimers();
    const { session, sockets } = onlineHero();
    intro.set({ open: true });
    const { container } = mount(
      <SessionContext.Provider value={session}>
        <App autoplay />
      </SessionContext.Provider>,
    );
    let t = 0;
    const DT = 1 / 20;
    const tick = () =>
      act(() => {
        tickSession(session, DT);
        vi.advanceTimersByTime(DT * 1000);
        t += DT;
      });
    // The card counts down; nothing streams under it.
    while (intro.get().open && t < 10) tick();
    expect(t).toBeLessThan(5.5);
    const ws = sockets.sockets[0];
    const last = hero.runs.factual.frames - 1;
    act(() => {
      ws.open();
      ws.push(hello());
      for (let f = 0; f <= last; f++) ws.push(frameMsg(f));
    });
    // The stream plays at 1x; the moment is announced when its window closes, at the last frame.
    while (session.playback.get().frame < last - 0.5 && t < 30) tick();
    act(() => ws.push(momentMsg(HERO_MOMENT, last)));
    vi.useRealTimers();
    await act(settle);
    vi.useFakeTimers();
    while (session.playback.get().mode !== "counterfactual" && t < 30) tick();
    expect(t, "seconds from the page opening to the run without the look").toBeLessThan(20);
    expect(container.querySelector(".stage-caption")?.textContent).toContain(
      "Without that look, J. Ferriday would have passed to K. Annersley.",
    );
  }, 20_000); // a few hundred rendered ticks: slow on a loaded machine

  it("on a cold load of a stitched match, the card is gone and the stream plays by 6 s", () => {
    vi.useFakeTimers();
    const sockets = fakeSockets();
    const exported = matchExport();
    const fetch = fakeFetch({ "POST /api/breakdowns": () => json(breakdownResponse()) });
    const session = createMatchSession(parseHero(exported), {
      api: createApi(API, MATCH, fetch),
      dataUrl: "/data/",
      socket: sockets,
    });
    intro.set({ open: true });
    const { container } = mount(<MatchApp session={session} autoplay />);
    expect(sockets.sockets, "the live stream starts behind the open card").toHaveLength(1);
    const ws = sockets.sockets[0];
    act(() => {
      ws.open();
      ws.push(matchHello(exported), matchFrameMsg(exported, 0), matchFrameMsg(exported, 1));
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(intro.get().open).toBe(false);
    expect(session.playback.get()).toMatchObject({ live: true, playing: true });
    expect(session.feed!.state.get().status).toBe("streaming");
  });

  it("keeps the autoplay when eyes are picked and Start watching is pressed", async () => {
    const { session, sockets } = onlineHero();
    intro.set({ open: true });
    const { container } = mount(
      <SessionContext.Provider value={session}>
        <App autoplay />
      </SessionContext.Provider>,
    );
    expect(container.querySelector("[role=dialog]")).not.toBeNull();
    expect(session.playback.get()).toMatchObject({ live: false, playing: false });
    // Not the default eyes, so the pick has to land on H8 without taking over the autoplay.
    act(() => session.playback.set({ povPlayer: "A5" }));
    click(button(container, "J. Ferriday · CM The hero of this moment"));
    expect(session.playback.get().povPlayer).toBe("H8");
    expect(intro.get().open).toBe(true);
    click(button(container, "Start watching"));
    expect(intro.get().open).toBe(false);
    expect(sockets.sockets).toHaveLength(1);
    const ws = sockets.sockets[0];
    act(() => {
      ws.open();
      ws.push(hello());
      for (let f = 0; f <= 16; f++) ws.push(frameMsg(f));
      ws.push(momentMsg(HERO_MOMENT, 16));
    });
    await act(settle);
    // The show comes first (the look, then the run without it), then the breakdown.
    expect(session.comparison.status.get().phase).toBe("with");
    expect(session.playback.get().povPlayer).toBe("H8");
  });
});
