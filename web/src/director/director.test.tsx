// @vitest-environment happy-dom
// The camera director on a session, on the live screen of a hero moment and of a stitched match:
// live from the stream's own events, offline from the bundled run. Its pending suggestion is a dot
// on the camera switch's camera, named in that camera's description; picking that camera takes it.
// The auto director cuts by itself but never starts a breakdown, and keeps out of a running one.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { App, MatchApp } from "../App";
import { parseHero } from "../data/hero";
import { renameIds } from "../data/roster";
import type { ExportEvent } from "../data/types";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import {
  createSession,
  SessionContext,
  tickSession,
  useView,
  type Session,
  type ViewSession,
} from "../session";
import { setPitchData } from "../ui/pitchData";
import { CameraSwitch, StageHud, ViewOptions } from "../ui/Stage";
import { Transport } from "../ui/Transport";
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
import { DirectorAttach, directorOf } from "./DirectorBar";

vi.mock("../views/PovView", () => ({ PovView: () => <div /> }));
vi.mock("../views/TacticalView", () => ({ TacticalView: () => <div /> }));

// Vitest stubs CSS imports, including ?raw and ?inline, so read the stylesheet for CSSOM checks.
type Fs = { readFileSync(path: string, encoding: "utf8"): string };
const nodeProcess = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): Fs; cwd(): string } }
).process;
const floodlitStyles = nodeProcess
  .getBuiltinModule("node:fs")
  .readFileSync(`${nodeProcess.cwd()}/src/styles.css`, "utf8");

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
const styles: HTMLStyleElement[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  for (const style of styles.splice(0)) style.remove();
  window.innerWidth = 1024;
  directorPrefs.set({ auto: false });
  setPitchData(false);
});

/** What the live screen mounts of the director: it follows the session; the switch shows it. */
function Bar() {
  const session = useView();
  return (
    <>
      <DirectorAttach session={session} />
      <CameraSwitch />
    </>
  );
}

function mount(session: ViewSession, node: ReactNode = <Bar />): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

/** Unmount the live screen, as MatchApp does when a breakdown opens over the match. */
function unmount(page: HTMLElement): void {
  const i = mounted.findIndex((m) => m.container === page);
  const [{ root, container }] = mounted.splice(i, 1);
  act(() => root.unmount());
  container.remove();
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null;
/** The camera the suggestion is on: the switch's button with the dot. */
const dotted = (page: HTMLElement) =>
  page.querySelector(".seg.camera .cam-dot")?.closest<HTMLButtonElement>("button") ?? null;
/** What the dotted camera's description says. */
const hint = (page: HTMLElement) => {
  const id = dotted(page)?.getAttribute("aria-describedby");
  return id ? text(document.getElementById(id))!.replace(/^Suggested: /, "") : null;
};
/** The director's pending suggestion, dot or not (a breakdown has no camera). */
const pending = (session: ViewSession) => {
  const s = directorOf(session).state.get().show;
  return s ? `${renameIds(s.title)}: ${renameIds(s.reason)}` : null;
};
const at = (session: ViewSession, frame: number) =>
  act(() => session.playback.set({ frame, playing: false }));
const onBroadcast = (session: ViewSession) => act(() => session.controls.setCamera("broadcast"));

function withFloodlitStyles(width: number): void {
  window.innerWidth = width;
  const style = document.createElement("style");
  style.textContent = floodlitStyles;
  document.head.append(style);
  styles.push(style);
}

describe("on the live screen", () => {
  it("keeps the sim label beside visible phone HUD numbers", () => {
    withFloodlitStyles(390);
    setPitchData(true); // his readouts are data on the pitch
    const session = offline();
    at(session, session.hero.keyScan!.start - 1);
    const page = mount(session, <StageHud />);
    const alert = page.querySelector<HTMLElement>(".blind-hud")!;
    expect(text(alert)).toContain("unseen");
    expect(getComputedStyle(alert.querySelector(".source")!).display).not.toBe("none");
    expect(getComputedStyle(page.querySelector(".hud > span")!).display).toBe("none");
  });

  it("keeps the phone's key-scan and decision shortcuts visible, focusable and working", () => {
    withFloodlitStyles(390);
    const session = offline();
    const page = mount(session, <Transport />);
    const marks = page.querySelector<HTMLElement>(".marks")!;
    const [scan, decision] = [...marks.querySelectorAll<HTMLButtonElement>("button")];
    expect(text(scan)).toBe("Key scan");
    expect(text(decision)).toBe("Decision");
    expect(getComputedStyle(marks).display).not.toBe("none");
    expect(getComputedStyle(marks).position).toBe("static");
    const timeline = page.querySelector<HTMLElement>(".timeline")!;
    const timelineStyle = getComputedStyle(timeline);
    const marksStyle = getComputedStyle(marks);
    expect(parseFloat(marksStyle.marginTop)).toBeGreaterThanOrEqual(
      parseFloat(timelineStyle.height),
    );
    expect(parseFloat(timelineStyle.marginBottom)).toBeGreaterThanOrEqual(
      parseFloat(marksStyle.height),
    );
    for (const shortcut of [scan, decision]) {
      expect(getComputedStyle(shortcut).position).toBe("static");
      expect(parseFloat(getComputedStyle(shortcut).minHeight)).toBeGreaterThanOrEqual(44);
      shortcut.focus();
      expect(document.activeElement).toBe(shortcut);
    }
    act(() => scan.click());
    expect(session.playback.get().frame).toBe(Math.max(0, session.hero.keyScan!.start - 8));
    act(() => decision.click());
    expect(session.playback.get().frame).toBe(session.hero.runs.factual.decision!.frame);
  });

  it("puts no suggestion over the hero screen's picture: a dot on the camera that takes it", () => {
    withFloodlitStyles(1280);
    const session = offline();
    const page = mount(session, <App autoplay={false} />);
    onBroadcast(session);
    at(session, 15);
    expect(page.querySelector(".stage-director, section.director, .director-chip")).toBeNull();
    const eyes = dotted(page)!;
    expect(text(eyes)).toBe("His eyes");
    expect(eyes.closest(".transport")).not.toBeNull();
    expect(hint(page)).toBe("Switch to J. Ferriday's eyes: the ball is coming to him.");
    expect(eyes.title).toBe("Switch to J. Ferriday's eyes: the ball is coming to him.");
    act(() => eyes.click());
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8" });
    expect(dotted(page)).toBeNull(); // he is on screen now: the director holds the shot
  });
});

describe("the suggestion", () => {
  it("suggests the receiver's eyes as the pass is played; picking the camera takes it", () => {
    const session = offline();
    const page = mount(session);
    onBroadcast(session);
    at(session, 14);
    expect(dotted(page)).toBeNull();
    at(session, 15);
    expect(hint(page)).toBe("Switch to J. Ferriday's eyes: the ball is coming to him.");
    at(session, 52);
    expect(hint(page)).toBe(
      "Switch to J. Ferriday's eyes: he checks over his shoulder before the ball arrives.",
    );
    act(() => dotted(page)!.click());
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8" });
    expect(dotted(page)).toBeNull();
  });

  it("takes another player's eyes from the camera already on screen", () => {
    const session = offline();
    const page = mount(session);
    act(() => session.playback.set({ camera: "pov", povPlayer: "A5", focus: "split" }));
    at(session, 15);
    const eyes = dotted(page)!;
    expect(eyes.getAttribute("aria-pressed")).toBe("true"); // his eyes already: another player's
    act(() => eyes.click());
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8" });
  });

  it("offline, suggests the breakdown once the moment is over, with no dot: the card has it", () => {
    const session = offline();
    const page = mount(session);
    at(session, session.moment.endFrame);
    expect(pending(session)).toBe(
      "Watch the breakdown: a moment was detected, J. Ferriday's decision after a scan.",
    );
    expect(dotted(page)).toBeNull();
    act(() => directorOf(session).take());
    expect(session.runner.status.get().status).toBe("running");
    expect(pending(session)).toBeNull(); // the breakdown directs
  });

  it("does not suggest a breakdown that has already played", () => {
    const session = offline();
    mount(session);
    act(() => session.controls.playBreakdown()); // offline autoplay
    act(() => session.controls.stopBreakdown());
    at(session, session.moment.endFrame + 5);
    expect(pending(session) ?? "").not.toMatch(/breakdown/);
  });

  it("suggests no moment in the run without the look", () => {
    const session = offline();
    mount(session);
    act(() => session.controls.setMode("counterfactual"));
    const end = session.moment.endFrame;
    for (let f = end; f <= end + 5; f++) {
      at(session, f);
      expect(pending(session) ?? "", `frame ${f}`).not.toMatch(/breakdown|moment was detected/);
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

  it("the dot stays a moment after its suggestion ends, then goes", () => {
    const session = withEvents([pass(10, "H8", 30), pass(60, "H9", 100)]);
    const page = mount(session);
    onBroadcast(session);
    for (let f = 10; f <= 45; f++) at(session, f);
    expect(dotted(page)).toBeNull();
    at(session, 10);
    for (let f = 11; f <= 34; f++) at(session, f);
    expect(hint(page)).toBe("Switch to J. Ferriday's eyes: the ball is coming to him."); // 0.16 s on
    for (let f = 35; f <= 45; f++) at(session, f);
    expect(dotted(page)).toBeNull();
  });

  it("a suggestion held on the viewer's camera does not show late when he leaves it", () => {
    const session = withEvents([pass(10, "H8", 60)]);
    const page = mount(session);
    act(() => session.playback.set({ camera: "pov", povPlayer: "H8", focus: "split" }));
    for (let f = 10; f <= 50; f++) at(session, f);
    onBroadcast(session);
    for (let f = 51; f <= 59; f++) {
      at(session, f);
      expect(dotted(page), `frame ${f}`).toBeNull(); // (60 - 51) x 0.04 s is under LEAD_S
    }
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
    expect(dotted(page)).toBeNull(); // frame 15 is here, its pass event not yet
    const pass = exportJson.runs.factual.events.find((e) => e.id === "pass:H4:0015")!;
    act(() => ws.push({ type: "event", event: pass }));
    at(session, 15.2);
    expect(hint(page)).toBe("Switch to J. Ferriday's eyes: the ball is coming to him.");
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
    act(() => dotted(page)!.click());
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8", live: true });
    act(() => ws.push(frameMsg(16), momentMsg(HERO_MOMENT, 16)));
    await act(settle);
    // The show first (the look, then the run without it: autoplay/), then the breakdown.
    expect(session.comparison.status.get().phase).toBe("with");
    for (let k = 0; k < 150 && session.runner.status.get().status !== "running"; k++) {
      act(() => tickSession(session, 0.1));
    }
    expect(session.runner.status.get().status).toBe("running");
  });

  it("suggests the breakdown when the stream detects the hero moment", () => {
    const { session, sockets } = online();
    mount(session);
    act(() => session.controls.goLive());
    const ws = sockets.sockets[0];
    act(() => {
      ws.open();
      ws.push(hello());
      ws.push(frameMsg(100));
    });
    at(session, 100);
    expect(pending(session)).toBeNull();
    act(() => ws.push(momentMsg(HERO_MOMENT, 100))); // no autoplay: the viewer went live
    at(session, 101);
    expect(pending(session)).toMatch(/^Watch the breakdown: a moment was detected/);
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

  it("suggests from the match's events", () => {
    const session = match();
    const page = mount(session);
    onBroadcast(session);
    at(session, 15);
    expect(hint(page)).toBe("Switch to J. Ferriday's eyes: the ball is coming to him.");
  });

  it("puts the dot on the stitched live screen's camera switch, on a phone too", () => {
    withFloodlitStyles(390);
    const session = match();
    const page = mount(session, <MatchApp session={session} autoplay={false} />);
    onBroadcast(session);
    at(session, 15);
    const eyes = dotted(page)!;
    expect(getComputedStyle(eyes.closest(".seg.camera")!).display).not.toBe("none");
    eyes.focus();
    expect(document.activeElement).toBe(eyes);
    act(() => eyes.click());
    expect(session.playback.get()).toMatchObject({ camera: "pov", povPlayer: "H8" });
    expect(dotted(page)).toBeNull();
  });

  it("opens a hero moment's breakdown when its suggestion is taken", async () => {
    const session = match();
    mount(session);
    const card = session.match.moments.find((m) => m.id === MATCH_HERO)!;
    at(session, card.frame_end);
    expect(pending(session)).toBe(
      "Watch the breakdown: a moment was detected, J. Ferriday's decision after a scan.",
    );
    act(() => directorOf(session).take());
    expect(session.screen.get().opening).toBe(MATCH_HERO);
    await act(settle);
    expect(session.screen.get().hero?.possession?.moment).toBe(MATCH_HERO);
  });

  /** Back from the breakdown: the match's live screen again, past the moment's end. */
  function backPastTheMoment(session: ReturnType<typeof match>, page: HTMLElement) {
    const card = session.match.moments.find((m) => m.id === MATCH_HERO)!;
    unmount(page);
    act(() => session.controls.backToMatch());
    mount(session);
    at(session, card.frame_end + 5);
  }

  it("does not suggest a breakdown taken again, after back to the match", async () => {
    const session = match();
    const page = mount(session);
    const card = session.match.moments.find((m) => m.id === MATCH_HERO)!;
    at(session, card.frame_end);
    act(() => directorOf(session).take());
    await act(settle);
    backPastTheMoment(session, page);
    expect(pending(session) ?? "").not.toMatch(/breakdown/);
  });

  it("does not suggest a breakdown opened from the Moments panel again", async () => {
    const session = match();
    const page = mount(session);
    const card = session.match.moments.find((m) => m.id === MATCH_HERO)!;
    act(() => session.controls.openBreakdown(card));
    await act(settle);
    expect(session.screen.get().hero?.possession?.moment).toBe(MATCH_HERO);
    backPastTheMoment(session, page);
    expect(pending(session) ?? "").not.toMatch(/breakdown/);
  });
});

describe("the auto director", () => {
  it("is off until the viewer turns it on in View options; then it cuts by itself", () => {
    const session = offline();
    const page = mount(
      session,
      <>
        <Bar />
        <ViewOptions />
      </>,
    );
    onBroadcast(session);
    at(session, 15);
    expect(session.playback.get().camera).toBe("broadcast");
    act(() => page.querySelector<HTMLButtonElement>('button[aria-label="View options"]')!.click());
    const toggle = [...page.querySelectorAll<HTMLButtonElement>(".options-panel button.chip")].find(
      (b) => text(b) === "Auto director",
    )!;
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
    mount(session);
    act(() => directorPrefs.set({ auto: true }));
    at(session, session.moment.endFrame);
    expect(session.runner.status.get().status).toBe("idle");
    expect(pending(session)).toMatch(/^Watch the breakdown/);
    act(() => session.controls.playBreakdown());
    const before = session.playback.get().camera;
    at(session, 20);
    expect(session.playback.get().camera).toBe(before);
    expect(pending(session)).toBeNull();
  });

  it("starts on with ?director=auto", () => {
    expect(autoFromSearch("?director=auto")).toBe(true);
    expect(autoFromSearch("?match=match-1")).toBe(false);
  });
});

describe("the camera switch on the bar, whose eyes and the Auto director in View options", () => {
  const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== "none";

  for (const width of [390, 1440]) {
    it(`keeps the camera switch on the bar at ${width} px`, () => {
      withFloodlitStyles(width);
      const session = offline();
      const page = mount(session, <Transport />);
      const camera = page.querySelector(".transport > .seg.camera");
      expect(shown(camera)).toBe(true);
      const tactical = [...camera!.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => text(b) === "Tactical",
      )!;
      act(() => tactical.click());
      expect(session.playback.get().focus).toBe("tactical");
      expect(page.querySelector('button[aria-label="View options"]')).toBeNull(); // in the ⋯
    });
  }

  it("has whose eyes and the Auto director in View options", () => {
    withFloodlitStyles(1440);
    const page = mount(offline(), <ViewOptions />);
    act(() => page.querySelector<HTMLButtonElement>('button[aria-label="View options"]')!.click());
    const auto = [...page.querySelectorAll<HTMLButtonElement>(".options-panel button.chip")].find(
      (b) => text(b) === "Auto director",
    )!;
    expect(shown(auto)).toBe(true);
    act(() => auto.click());
    expect(directorPrefs.get().auto).toBe(true);
    expect(auto.getAttribute("aria-pressed")).toBe("true");
    expect(shown(page.querySelector('.options-panel select[aria-label="Whose eyes"]'))).toBe(true);
  });

  it("shows no dot while it has nothing to suggest", () => {
    const session = offline();
    const page = mount(session);
    onBroadcast(session);
    at(session, 0);
    expect(dotted(page)).toBeNull();
    expect(page.querySelector(".sr-only")).toBeNull();
    at(session, 15);
    expect(dotted(page)).not.toBeNull();
  });
});
