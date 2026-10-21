// @vitest-environment happy-dom
// The camera director on a session: the chip above the views of a hero moment and of a stitched
// match, live from the stream's own events, offline from the bundled run; one tap switches;
// the auto director cuts by itself but never starts a breakdown, and keeps out of a running one.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import type { ExportEvent } from "../data/types";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session, type ViewSession } from "../session";
import {
  API,
  breakdownResponse,
  exportJson,
  fakeFetch,
  fakeSockets,
  frameMsg,
  hello,
  json,
  MATCH,
  MATCH_HERO,
  matchBreakdown,
  matchExport,
  matchInfo,
  momentMsg,
  HERO_MOMENT,
  pressureExport,
  settle,
} from "../testing";
import { autoFromSearch, Director, directorPrefs } from "./director";
import { DirectorBar } from "./DirectorBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = () => parseHero(raw);
const offline = () => createSession(hero(), EXAMPLE_PLAN, payloadJson, null);

function online() {
  const sockets = fakeSockets();
  const fetch = fakeFetch({
    "POST /api/breakdowns": () => json(breakdownResponse()),
  });
  const session = createSession(hero(), EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    socket: sockets,
  });
  return { session, sockets };
}

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  directorPrefs.set({ auto: false });
});

function mount(session: ViewSession): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <DirectorBar />
      </SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return container;
}

/** Unmount a bar, as MatchApp does when a breakdown opens over the match. */
function unmount(page: HTMLElement): void {
  const i = mounted.findIndex((m) => m.container === page);
  const [{ root, container }] = mounted.splice(i, 1);
  act(() => root.unmount());
  container.remove();
}

const chip = (page: HTMLElement) => page.querySelector<HTMLButtonElement>(".director-chip");
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const at = (session: ViewSession, frame: number) =>
  act(() => session.playback.set({ frame, playing: false }));
const onBroadcast = (session: ViewSession) => act(() => session.controls.setCamera("broadcast"));

describe("the chip", () => {
  it("suggests the receiver's eyes as the pass is played; one tap switches", () => {
    const session = offline();
    const page = mount(session);
    onBroadcast(session);
    at(session, 14);
    expect(chip(page)).toBeNull();
    at(session, 15);
    expect(text(chip(page))).toBe("Switch to H8's eyes: the ball is coming to him.");
    at(session, 52);
    expect(text(chip(page))).toBe(
      "Switch to H8's eyes: he checks over his shoulder before the ball arrives.",
    );
    act(() => chip(page)!.click());
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8" });
    expect(chip(page)).toBeNull(); // he is on screen now: the director holds the shot
    expect(text(page.querySelector(".director-idle"))).toMatch(/^Pick any camera/);
  });

  it("offline, suggests the breakdown once the moment is over; the breakdown then directs", () => {
    const session = offline();
    const page = mount(session);
    at(session, session.moment.endFrame);
    expect(text(chip(page))).toBe(
      "Watch the breakdown: a moment was detected, H8's decision after a scan.",
    );
    act(() => chip(page)!.click());
    expect(session.runner.status.get().status).toBe("running");
    expect(chip(page)).toBeNull();
    expect(text(page.querySelector(".director-idle"))).toBe(
      "The breakdown is choosing the cameras.",
    );
  });

  it("does not suggest a breakdown that has already played", () => {
    const session = offline();
    const page = mount(session);
    act(() => session.controls.playBreakdown()); // offline autoplay
    act(() => session.controls.stopBreakdown());
    at(session, session.moment.endFrame + 5);
    expect(text(chip(page)) ?? "").not.toMatch(/breakdown/);
  });

  it("can be dismissed, and that suggestion stays away", () => {
    const session = offline();
    const page = mount(session);
    onBroadcast(session);
    at(session, 20);
    act(() => page.querySelector<HTMLButtonElement>(".director-dismiss")!.click());
    expect(chip(page)).toBeNull();
    at(session, 30);
    expect(chip(page)).toBeNull();
  });

  it("keeps what was dismissed when the bar mounts again", () => {
    const session = offline();
    const page = mount(session);
    onBroadcast(session);
    at(session, 20);
    act(() => page.querySelector<HTMLButtonElement>(".director-dismiss")!.click());
    unmount(page);
    const again = mount(session);
    at(session, 21);
    expect(chip(again)).toBeNull();
  });

  it("suggests no moment in the run without the look", () => {
    const session = offline();
    const page = mount(session);
    act(() => session.controls.setMode("counterfactual"));
    const end = session.moment.endFrame;
    for (let f = end; f <= end + 5; f++) {
      at(session, f);
      expect(text(chip(page)) ?? "", `frame ${f}`).not.toMatch(/breakdown|moment was detected/);
    }
  });
});

describe("between suggestions", () => {
  /** The bundled hero with its events replaced: two passes with a gap between them. */
  function withEvents(events: ExportEvent[]): Session {
    const data = structuredClone(raw) as typeof raw;
    data.runs.factual.events = events as typeof data.runs.factual.events;
    data.runs.factual.blind_side.frames = data.runs.factual.blind_side.frames.map(() => []);
    (data as { key_scan: unknown }).key_scan = null;
    return createSession(parseHero(data), null, null);
  }
  const pass = (frame: number, to: string, end: number): ExportEvent => ({
    id: `pass:H4:${String(frame).padStart(4, "0")}`,
    type: "pass",
    frame,
    player: "H4",
    attrs: { to, end },
  });

  it("the chip stays a moment after it ends, then the strip goes idle", () => {
    const session = withEvents([pass(10, "H8", 30), pass(60, "H9", 100)]);
    const page = mount(session);
    onBroadcast(session);
    for (let f = 10; f <= 45; f++) at(session, f);
    expect(chip(page)).toBeNull();
    at(session, 10);
    for (let f = 11; f <= 34; f++) at(session, f);
    expect(text(chip(page))).toBe("Switch to H8's eyes: the ball is coming to him."); // 0.16 s on
    for (let f = 35; f <= 45; f++) at(session, f);
    expect(text(page.querySelector(".director-idle"))).toMatch(/^Pick any camera/);
  });

  it("a suggestion held on the viewer's camera does not show late when he leaves it", () => {
    const session = withEvents([pass(10, "H8", 60)]);
    const page = mount(session);
    act(() => session.playback.set({ camera: "pov", povPlayer: "H8", focus: "split" }));
    for (let f = 10; f <= 50; f++) at(session, f);
    onBroadcast(session);
    for (let f = 51; f <= 59; f++) {
      at(session, f);
      expect(chip(page), `frame ${f}`).toBeNull(); // (60 - 51) x 0.04 s is under LEAD_S
    }
  });

  it("a dismissed chip does not linger", () => {
    const session = withEvents([pass(10, "H8", 30)]);
    const page = mount(session);
    onBroadcast(session);
    for (let f = 10; f <= 12; f++) at(session, f);
    act(() => page.querySelector<HTMLButtonElement>(".director-dismiss")!.click());
    expect(chip(page)).toBeNull();
  });
});

describe("live", () => {
  it("knows a pass only once the stream has sent its event", () => {
    const { session, sockets } = online();
    const page = mount(session);
    act(() => session.controls.goLive());
    onBroadcast(session);
    const ws = sockets.sockets[0];
    act(() => {
      ws.open();
      ws.push(hello());
      for (let f = 0; f <= 15; f++) ws.push(frameMsg(f));
    });
    at(session, 15);
    expect(session.playback.get().live).toBe(true);
    expect(chip(page)).toBeNull(); // frame 15 is here, its pass event not yet
    const pass = exportJson.runs.factual.events.find((e) => e.id === "pass:H4:0015")!;
    act(() => ws.push({ type: "event", event: pass }));
    at(session, 15.2);
    expect(text(chip(page))).toBe("Switch to H8's eyes: the ball is coming to him.");
  });

  it("taking a camera keeps the autoplay: the breakdown still plays once detected", async () => {
    const { session, sockets } = online();
    const page = mount(session);
    act(() => session.controls.startLive()); // live, then the breakdown by itself (SPEC 2)
    onBroadcast(session);
    const ws = sockets.sockets[0];
    const pass = exportJson.runs.factual.events.find((e) => e.id === "pass:H4:0015")!;
    act(() => {
      ws.open();
      ws.push(hello());
      for (let f = 0; f <= 15; f++) ws.push(frameMsg(f));
      ws.push({ type: "event", event: pass });
    });
    at(session, 15);
    act(() => chip(page)!.click());
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8", live: true });
    act(() => ws.push(frameMsg(16), momentMsg(HERO_MOMENT, 16)));
    await act(settle);
    expect(session.runner.status.get().status).toBe("running");
  });

  it("suggests the breakdown when the stream detects the hero moment", () => {
    const { session, sockets } = online();
    const page = mount(session);
    act(() => session.controls.goLive());
    const ws = sockets.sockets[0];
    act(() => {
      ws.open();
      ws.push(hello());
      ws.push(frameMsg(100));
    });
    at(session, 100);
    expect(chip(page)).toBeNull();
    act(() => ws.push(momentMsg(HERO_MOMENT, 100))); // no autoplay: the viewer went live
    at(session, 101);
    expect(text(chip(page))).toMatch(/^Watch the breakdown: a moment was detected/);
  });
});

describe("in a stitched match", () => {
  function match() {
    const raw = matchExport();
    const fetch = fakeFetch({
      [`GET /api/matches/${MATCH}`]: () => json(matchInfo(raw)),
      "GET /api/matches/blind_side_run-3/export": () => json(exportJson),
      "GET /api/matches/press_escape-0/export": () => json(pressureExport()),
      "POST /api/breakdowns": (body) => json(matchBreakdown(body)),
    });
    return createMatchSession(parseHero(raw), {
      api: createApi(API, MATCH, fetch),
      dataUrl: "/data/",
      fetch,
    });
  }

  it("draws over the match's views and suggests from its events", () => {
    const session = match();
    const page = mount(session);
    onBroadcast(session);
    at(session, 15);
    expect(text(chip(page))).toBe("Switch to H8's eyes: the ball is coming to him.");
  });

  it("opens a hero moment's breakdown from the chip", async () => {
    const session = match();
    const page = mount(session);
    const card = session.match.moments.find((m) => m.id === MATCH_HERO)!;
    at(session, card.frame_end);
    expect(text(chip(page))).toBe(
      "Watch the breakdown: a moment was detected, H8's decision after a scan.",
    );
    act(() => chip(page)!.click());
    expect(session.screen.get().opening).toBe(MATCH_HERO);
    await act(settle);
    expect(session.screen.get().hero?.possession?.moment).toBe(MATCH_HERO);
  });

  /** Back from the breakdown: a new bar over the match, past the moment's end. */
  function backPastTheMoment(session: ReturnType<typeof match>, page: HTMLElement) {
    const card = session.match.moments.find((m) => m.id === MATCH_HERO)!;
    unmount(page);
    act(() => session.controls.backToMatch());
    const again = mount(session);
    at(session, card.frame_end + 5);
    return again;
  }

  it("does not suggest a breakdown opened from the chip again, after back to the match", async () => {
    const session = match();
    const page = mount(session);
    const card = session.match.moments.find((m) => m.id === MATCH_HERO)!;
    at(session, card.frame_end);
    act(() => chip(page)!.click());
    await act(settle);
    expect(text(chip(backPastTheMoment(session, page))) ?? "").not.toMatch(/breakdown/);
  });

  it("does not suggest a breakdown opened from the Moments panel again", async () => {
    const session = match();
    const page = mount(session);
    const card = session.match.moments.find((m) => m.id === MATCH_HERO)!;
    act(() => session.controls.openBreakdown(card));
    await act(settle);
    expect(session.screen.get().hero?.possession?.moment).toBe(MATCH_HERO);
    expect(text(chip(backPastTheMoment(session, page))) ?? "").not.toMatch(/breakdown/);
  });
});

describe("the auto director", () => {
  it("is off until the viewer turns it on; then it cuts by itself", () => {
    const session = offline();
    const page = mount(session);
    onBroadcast(session);
    at(session, 15);
    expect(session.playback.get().camera).toBe("broadcast");
    const toggle = page.querySelector<HTMLButtonElement>(".director-auto")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8" });
    expect(session.runner.status.get().status).toBe("idle");
  });

  it("holds each shot for the minimum length, on the wall clock", () => {
    const session: Session = offline();
    let now = 100;
    const director = new Director(session, () => now);
    const stop = director.attach();
    directorPrefs.set({ auto: true });
    session.controls.setCamera("broadcast"); // the viewer cuts: the shot starts now
    session.playback.set({ frame: 15 });
    expect(session.playback.get().camera).toBe("broadcast");
    now += 2;
    session.playback.set({ frame: 16 });
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8" });
    // H9's ball at 75: H8 is not scanning then, but the shot is too young until 2 s after.
    session.playback.set({ frame: 75 });
    expect(session.playback.get().povPlayer).toBe("H8");
    now += 2;
    session.playback.set({ frame: 76 });
    expect(session.playback.get().povPlayer).toBe("H9");
    stop();
  });

  it("never cuts while the player on screen is in the middle of a scan", () => {
    const session: Session = offline();
    let now = 0;
    const director = new Director(session, () => now);
    const stop = director.attach();
    directorPrefs.set({ auto: true });
    // H8 plays the ball to H9 at 75; the viewer cuts to A5, who scans from 75 to 89.
    session.playback.set({ camera: "pov", povPlayer: "A5", frame: 76 });
    now = 10;
    for (const f of [77, 80, 89]) {
      session.playback.set({ frame: f });
      expect(session.playback.get().povPlayer, `frame ${f}`).toBe("A5");
    }
    session.playback.set({ frame: 90 });
    expect(session.playback.get().povPlayer).toBe("H9");
    stop();
  });

  it("does not start the breakdown, and keeps out of a running one", () => {
    const session = offline();
    const page = mount(session);
    act(() => directorPrefs.set({ auto: true }));
    at(session, session.moment.endFrame);
    expect(session.runner.status.get().status).toBe("idle");
    expect(text(chip(page))).toMatch(/^Watch the breakdown/);
    act(() => session.controls.playBreakdown());
    const before = session.playback.get().camera;
    at(session, 20);
    expect(session.playback.get().camera).toBe(before);
    expect(chip(page)).toBeNull();
  });

  it("starts on with ?director=auto", () => {
    expect(autoFromSearch("?director=auto")).toBe(true);
    expect(autoFromSearch("?match=match-1")).toBe(false);
  });
});
