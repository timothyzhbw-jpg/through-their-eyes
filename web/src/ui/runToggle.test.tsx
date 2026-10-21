// @vitest-environment happy-dom
// "Without the look" stays locked while a live stream has not detected the hero moment. Offline,
// and once that moment has arrived, it switches the run as usual. A stitched match has no switch.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { App, MatchApp } from "../App";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext } from "../session";
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
  momentMsg,
  settle,
} from "../testing";
import { intro } from "./intro";
import { RunToggle } from "./RunToggle";

vi.mock("../views/PovView", () => ({ PovView: () => <canvas /> }));
vi.mock("../views/TacticalView", () => ({ TacticalView: () => <canvas /> }));
vi.mock("../session", async (original) => ({
  ...(await original<typeof import("../session")>()),
  startClock: () => () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const mounted: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => intro.set({ open: false }));
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  intro.set({ open: false });
  vi.restoreAllMocks();
});

function mount(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

function button(page: Element, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.replace(/\s+/g, " ").trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

const click = (el: HTMLElement) => act(() => el.click());

const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson);

function online() {
  const sockets = fakeSockets();
  const fetch = fakeFetch({ "POST /api/breakdowns": () => json(breakdownResponse()) });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    socket: sockets,
  });
  return { session, sockets };
}

function described(control: HTMLElement): string | undefined {
  const id = control.getAttribute("aria-describedby");
  return document
    .getElementById(id ?? "")
    ?.textContent?.replace(/\s+/g, " ")
    .trim();
}

describe("the run without the look", () => {
  it("locks Without the look until the moment, and the breakdown still autoplays", async () => {
    const { session, sockets } = online();
    const page = mount(
      <SessionContext.Provider value={session}>
        <App autoplay />
      </SessionContext.Provider>,
    );
    const ws = sockets.sockets[0];
    act(() => {
      ws.open();
      ws.push(hello());
      for (let f = 0; f <= 15; f++) ws.push(frameMsg(f));
    });
    expect(session.playback.get()).toMatchObject({ live: true, mode: "factual" });
    expect(session.feed!.state.get().status).toBe("streaming");
    expect(session.feed!.state.get().moments.some((m) => m.id === session.moment.id)).toBe(false);

    const without = button(page, "Without the look");
    expect(without.getAttribute("aria-disabled")).toBe("true");
    expect(described(without)).toBe("Available once the moment arrives");
    click(without);
    expect(session.playback.get()).toMatchObject({ live: true, mode: "factual" });
    expect(ws.sent).not.toContainEqual({ type: "stop" });

    act(() => ws.push(frameMsg(16), momentMsg(HERO_MOMENT, 16)));
    await act(settle);
    expect(session.runner.status.get().status).toBe("running");
  });

  it("ignores setMode(counterfactual) while live before the hero moment", () => {
    const { session, sockets } = online();
    session.controls.goLive();
    const ws = sockets.sockets[0];
    ws.open();
    ws.push(hello(), frameMsg(0), frameMsg(1));
    session.controls.setMode("counterfactual");
    expect(ws.sent).not.toContainEqual({ type: "stop" });
    expect(session.playback.get()).toMatchObject({ live: true, mode: "factual" });
  });

  it("toggles to the run without the look once the hero moment has arrived", async () => {
    const { session, sockets } = online();
    const page = mount(
      <SessionContext.Provider value={session}>
        <App autoplay={false} />
      </SessionContext.Provider>,
    );
    act(() => session.controls.goLive());
    const ws = sockets.sockets[0];
    act(() => {
      ws.open();
      ws.push(hello(), frameMsg(0), momentMsg(HERO_MOMENT, 0));
    });
    const without = button(page, "Without the look");
    expect(without.getAttribute("aria-disabled")).not.toBe("true");
    click(without);
    expect(session.playback.get()).toMatchObject({ mode: "counterfactual", live: false });
    expect(ws.sent.at(-1)).toEqual({ type: "stop" });
    await act(settle);
  });

  it("toggles the run when the session is not live", () => {
    const session = offline();
    const page = mount(
      <SessionContext.Provider value={session}>
        <RunToggle />
      </SessionContext.Provider>,
    );
    const without = button(page, "Without the look");
    expect(without.getAttribute("aria-disabled")).not.toBe("true");
    click(without);
    expect(session.playback.get().mode).toBe("counterfactual");
  });

  it("draws no run switch on a stitched match, and an unlocked one on its breakdown", () => {
    const session = createMatchSession(parseHero(matchExport()), {
      api: createApi(API, MATCH, fakeFetch({})),
      dataUrl: "/data/",
      socket: fakeSockets(),
    });
    const page = mount(<MatchApp session={session} autoplay={false} />);
    expect(page.querySelector(".seg.run")).toBeNull();

    const breakdown = offline();
    act(() => session.screen.set({ hero: breakdown }));
    const toggle = page.querySelector(".seg.run");
    expect(toggle).not.toBeNull();
    const without = button(toggle!, "Without the look");
    expect(without.getAttribute("aria-disabled")).not.toBe("true");
    click(without);
    expect(without.getAttribute("aria-pressed")).toBe("true");
    expect(breakdown.playback.get().mode).toBe("counterfactual");
    expect(session.playback.get().mode).toBe("factual");
  });
});
