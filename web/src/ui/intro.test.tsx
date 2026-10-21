// @vitest-environment happy-dom
// The pre-match card owns only the first page opening. Autoplay waits for its dismissal, and
// switching between a stitched match and a hero breakdown never opens it again.

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
import { createSession, SessionContext } from "../session";
import { API, fakeFetch, fakeSockets, MATCH, matchExport } from "../testing";
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

describe("the pre-match autoplay gate", () => {
  it("holds the offline hero breakdown until the card closes", () => {
    const session = heroSession();
    const play = vi.spyOn(session.controls, "playBreakdown").mockImplementation(() => {});
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

  it("holds the online hero stream and keeps its existing unmount cleanup", () => {
    const session = heroSession(true);
    const start = vi.spyOn(session.controls, "startLive").mockImplementation(() => {});
    const stop = vi.spyOn(session.feed!, "stop");
    intro.set({ open: true });
    const { root } = mount(
      <SessionContext.Provider value={session}>
        <App autoplay />
      </SessionContext.Provider>,
    );
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();

    act(() => intro.set({ open: false }));
    expect(start).toHaveBeenCalledOnce();
    act(() => root.unmount());
    expect(stop).toHaveBeenCalledOnce();
  });

  it("holds a stitched match's stream until the card closes", () => {
    const session = matchSession();
    const start = vi.spyOn(session.controls, "startLive").mockImplementation(() => {});
    intro.set({ open: true });
    mount(<MatchApp session={session} autoplay />);
    expect(start).not.toHaveBeenCalled();
    expect(session.playback.get().playing).toBe(false);

    act(() => intro.set({ open: false }));
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
});
