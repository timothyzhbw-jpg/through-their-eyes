// @vitest-environment happy-dom
// "Take his eyes" (SPEC 3.7, 7) on the page: the grid loaded on first open, the time and the
// direction as named radio groups (arrow keys, Enter to look), a drag or tap round him snapping
// the cone, the stage playing the look through a derived session, the result with verified lines
// only, the views' ghost path of the look's run, and a moment with no grid.
// The 3D view and the board are left out (no WebGL here); the dial, timeline and card are DOM.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import lookJson from "../../public/data/look_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { App } from "../App";
import { createSession, SessionContext, type Session } from "../session";
import { createApi } from "../api/client";
import { createMatchSession } from "../match/matchSession";
import {
  API,
  exportJson,
  fakeFetch,
  fakeSockets,
  health,
  json,
  MATCH,
  MATCH_HERO,
  MATCH_PRESS,
  matchExport,
  matchInfo,
  pressureExport,
  settle,
} from "../testing";
import { takeEyesOf, type Fetch } from "./controller";
import { NO_GRID } from "./looks";
import { TakeEyesButton, TakeEyesStage } from "./TakeEyes";

vi.mock("../views/PovView", () => ({ PovView: () => <div className="pov-stub" /> }));
vi.mock("../views/TacticalView", () => ({ TacticalView: () => <div className="tac-stub" /> }));
vi.mock("@react-three/fiber", async (original) => ({
  ...(await original<typeof import("@react-three/fiber")>()),
  Canvas: () => <div className="canvas-stub" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);
const served: Fetch = async (url) => ({
  ok: url.endsWith("look_seed3.json"),
  json: async () => lookJson,
});

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(session: Session, node: ReactNode = <TakeEyesStage scene={false} />) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const textOf = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
const button = (el: HTMLElement, name: string) => {
  const b = [...el.querySelectorAll("button")].find((x) => textOf(x) === name);
  if (!b) throw new Error(`no button ${name}: ${textOf(el)}`);
  return b;
};
const click = (b: HTMLElement) => act(() => b.click());
const key = (target: Element, k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
const radios = (el: HTMLElement, group: string) => [
  ...el.querySelectorAll<HTMLButtonElement>(
    `[role="radiogroup"][aria-label="${group}"] [role="radio"]`,
  ),
];
const checked = (el: HTMLElement, group: string) =>
  radios(el, group).find((b) => b.getAttribute("aria-checked") === "true");

async function opened(session = offline()) {
  const te = takeEyesOf(session, served, "/data/");
  const el = mount(session);
  act(() => te.open());
  await act(settle);
  return { session, te, el };
}

describe("Take his eyes: opening", () => {
  it("loads the grid on first open and starts from his own look", async () => {
    const { te, el } = await opened();
    expect(te.state.get()).toMatchObject({ step: "choosing", frame: 50, offset: -150 });
    expect(textOf(el.querySelector(".te-card h2"))).toBe("Take his eyes");
    expect(textOf(el.querySelector(".te-choice"))).toBe(
      "Over his right shoulder, 0.8 s before it arrives",
    );
    expect(textOf(checked(el, "When he looks"))).toBe("−0.8");
    expect(checked(el, "Where J. Ferriday looks")!.getAttribute("aria-label")).toBe(
      "Over his right shoulder",
    );
    expect(textOf(el.querySelector(".te-own"))).toBe("his look");
  });

  it("takes over the replay: parked at the decision, not playing", async () => {
    const session = offline();
    session.controls.playBreakdown();
    const { te } = await opened(session);
    expect(session.playback.get()).toMatchObject({
      playing: false,
      frame: session.moment.decisionFrame,
    });
    // The stage shows his picture at the chosen time, with no look yet.
    expect(te.playback.get()).toMatchObject({ mode: "counterfactual", frame: 50, playing: false });
    expect(te.stage()!.hero.runs.counterfactual.decision?.chosen).toBe("pass:H4");
  });

  it("says why it cannot open on a moment with no bundled grid", () => {
    const other = { ...pressureExport(), seed: 7 }; // press_escape has a grid on seed 0 only
    const pressure = createSession(parseHero(other), EXAMPLE_PLAN, payloadJson, null);
    const b = mount(pressure, <TakeEyesButton />).querySelector("button")!;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe(NO_GRID);
  });

  it("shows a reason when the grid cannot be fetched, and a way back", async () => {
    const session = offline();
    const te = takeEyesOf(session, async () => ({ ok: false, json: async () => null }), "/d/");
    const el = mount(session);
    act(() => te.open());
    await act(settle);
    expect(te.state.get().step).toBe("error");
    expect(textOf(el.querySelector(".te-card [role=status]"))).toMatch(/could not be loaded/);
    click(button(el, "Back to the replay"));
    expect(te.state.get().step).toBe("closed");
  });
});

describe("Take his eyes: choosing", () => {
  it("names the four directions round him and every time of the grid", async () => {
    const { el } = await opened();
    expect(radios(el, "Where J. Ferriday looks").map((b) => b.getAttribute("aria-label"))).toEqual([
      "To his left",
      "Over his left shoulder",
      "Over his right shoulder",
      "To his right",
    ]);
    expect(radios(el, "When he looks").map((b) => b.getAttribute("aria-label"))).toEqual([
      "2.0 s before the ball arrives",
      "1.6 s before the ball arrives",
      "1.2 s before the ball arrives",
      "0.8 s before the ball arrives",
      "0.4 s before the ball arrives",
      "As the ball arrives",
    ]);
  });

  it("moves with the arrow keys in each group, one focus stop per group", async () => {
    const { te, el } = await opened();
    const where = checked(el, "Where J. Ferriday looks")!;
    expect(radios(el, "Where J. Ferriday looks").filter((b) => b.tabIndex === 0)).toEqual([where]);
    key(where, "ArrowRight");
    expect(te.state.get().offset).toBe(-90);
    expect(document.activeElement).toBe(checked(el, "Where J. Ferriday looks"));
    key(checked(el, "Where J. Ferriday looks")!, "ArrowLeft");
    key(checked(el, "Where J. Ferriday looks")!, "ArrowLeft");
    expect(te.state.get().offset).toBe(150);
    key(checked(el, "When he looks")!, "ArrowLeft");
    expect(te.state.get().frame).toBe(40);
    expect(textOf(el.querySelector(".te-choice"))).toBe(
      "Over his left shoulder, 1.2 s before it arrives",
    );
  });

  it("snaps a drag or a tap round him to the nearest direction", async () => {
    const { te, el } = await opened();
    const dial = el.querySelector<SVGSVGElement>(".te-dial")!;
    const me = el.querySelector<SVGCircleElement>(".te-me")!;
    const [cx, cy] = [Number(me.getAttribute("cx")), Number(me.getAttribute("cy"))];
    // The ball comes from his left on the board (-x): a point straight up the screen (+y on the
    // pitch) is 90 degrees clockwise of the ball for him: "to his right".
    const at = (dx: number, dy: number) =>
      act(() => {
        dial.dispatchEvent(
          new PointerEvent("pointerdown", { clientX: cx + dx, clientY: cy + dy, bubbles: true }),
        );
        dial.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
    at(0, -80);
    expect(te.state.get().offset).toBe(-90);
    at(0, 80);
    expect(te.state.get().offset).toBe(90);
    at(80, -20); // behind him, a little to his right
    expect(te.state.get().offset).toBe(-150);
    at(3, 3); // on him: no direction
    expect(te.state.get().offset).toBe(-150);
  });
});

describe("Take his eyes: looking and the result", () => {
  it("Enter looks: the stage plays the look's run through his eyes up to his decision", async () => {
    const { te, el } = await opened();
    key(checked(el, "Where J. Ferriday looks")!, "Enter");
    expect(te.state.get().step).toBe("looking");
    const stage = te.stage()!;
    expect(stage.hero.runs.counterfactual.decision?.chosen).toBe("pass:H9");
    expect(stage.hero.keyScan?.id).toBe("scan:H8:0050");
    expect(te.playback.get()).toMatchObject({
      mode: "counterfactual",
      frame: 42,
      playing: true,
      playUntil: 75,
    });
    // Playing to the decision ends the clip and shows the result.
    act(() => te.tick(5));
    expect(te.state.get().step).toBe("result");
  });

  it("shows both runs: the look's run as the board's gold ghost over what he really did", async () => {
    const { te, el } = await opened();
    act(() => te.pick({ offset: 90 }));
    click(button(el, "Look"));
    click(button(el, "See what he does"));
    expect(te.state.get()).toMatchObject({ step: "result", view: "both" });
    const stage = te.stage()!;
    expect(te.playback.get()).toMatchObject({ mode: "factual", whatIf: "look:H8:0050:+090" });
    const ghost = stage.kind === "hero" ? stage.whatIfs!.options[0] : null;
    expect(ghost?.run?.start).toBe(75);
    expect(ghost?.tag).toBe("your look: pass to K. Annersley");
    expect(textOf(el.querySelector(".te-card h2"))).toBe("Your look changes his call");
    const versus = [...el.querySelectorAll(".te-versus div")].map((d) => [
      textOf(d.querySelector("dt")),
      textOf(d.querySelector("dd")),
    ]);
    expect(versus).toEqual([
      ["With your look", "Pass to K. Annersley"],
      ["What he did", "Pass to N. Varnhall"],
      ["With no look", "Pass to K. Annersley"],
    ]);
  });

  it("speaks only in verified lines, in the breakdown's language", async () => {
    const { te, el } = await opened();
    click(button(el, "Look"));
    click(button(el, "See what he does"));
    const lines = [...el.querySelectorAll(".te-lines li .te-line")].map(textOf);
    expect(lines[0]).toBe(
      "You make J. Ferriday look over his right shoulder 0.8 s before the ball reaches him.",
    );
    expect(lines).toContain("He still passes to N. Varnhall, as he really did.");
    expect(el.querySelectorAll(".te-lines .kind").length).toBeGreaterThan(0);
    // Every number on the card is in a verified line, the chosen time or a player id.
    const card = el.querySelector(".te-card")!.cloneNode(true) as HTMLElement;
    card.querySelectorAll(".te-lines").forEach((n) => n.remove());
    expect(textOf(card)!.replace(/[HA]\d{1,2}/g, "")).not.toMatch(/\d/);

    act(() => te.session.breakdown.set({ language: "zh" }));
    expect(textOf(el.querySelector(".te-lines .te-line"))).toBe(
      "你让J. Ferriday在球到达前0.8秒越过右肩向后看。",
    );
  });

  it("switches the board between both runs, his picture with the look, and with none", async () => {
    const { te, el } = await opened();
    click(button(el, "Look"));
    click(button(el, "See what he does"));
    click(button(el, "His picture"));
    expect(te.playback.get()).toMatchObject({ mode: "counterfactual", frame: 75, whatIf: null });
    expect(te.stage()!.hero.runs.counterfactual.decision?.chosen).toBe("pass:H9");
    click(button(el, "No look"));
    expect(te.stage()!.hero.runs.counterfactual.decision?.chosen).toBe("pass:H4");
    click(button(el, "Try another look"));
    expect(te.state.get()).toMatchObject({ step: "choosing", frame: 50, offset: -150 });
  });

  it("with reduced motion, cuts to the end of each clip", async () => {
    const session = offline();
    const te = takeEyesOf(session, served, "/data/");
    mount(session);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    act(() => te.open());
    await act(settle);
    vi.unstubAllGlobals();
    act(() => te.look());
    expect(te.playback.get()).toMatchObject({ frame: 75, playing: false });
  });

  it("in App it takes the live screen's place; Escape closes it and returns focus", async () => {
    const session = offline();
    const te = takeEyesOf(session, served, "/data/");
    const page = mount(session, <App autoplay={false} />);
    const live = () => page.querySelector('section.stage[aria-label="Live screen"]');
    const screen = () => page.querySelector('section.te-screen[aria-label="Take his eyes"]');
    const pill = () => page.querySelector<HTMLButtonElement>("#take-eyes-open");
    expect(pill()!.getAttribute("aria-pressed")).toBe("false");
    // The moment head's third action opens it, as does the header button.
    click(button(page, "Take his eyes"));
    await act(settle);
    expect(te.state.get().step).toBe("choosing");
    expect(live()).toBeNull();
    expect(page.querySelector("main.moment")).toBeNull();
    expect(pill()!.getAttribute("aria-pressed")).toBe("true");
    key(screen()!.querySelector(".te-card")!, "Escape");
    expect(te.state.get().step).toBe("closed");
    expect(live()).not.toBeNull();
    expect(document.activeElement).toBe(pill());
  });
});

describe("Take his eyes: in a stitched match", () => {
  it("opens the match's scan hero in Take his eyes; one without a grid says why", async () => {
    const m = matchExport();
    const fetch = fakeFetch({
      "GET /health": health,
      [`GET /api/matches/${MATCH}`]: () => json(matchInfo(m)),
      "GET /api/matches/blind_side_run-3/export": () => json(exportJson),
      "GET /api/matches/press_escape-0/export": () => json({ ...pressureExport(), seed: 7 }), // a pressure hero with no look grid
    });
    const session = createMatchSession(parseHero(structuredClone(m)), {
      api: createApi(API, MATCH, fetch),
      dataUrl: "/data/",
      fetch,
      socket: fakeSockets(),
      whatIfs: whatIfJson,
    });
    vi.stubGlobal("fetch", served); // the controller fetches the bundled grid itself
    try {
      session.controls.openBreakdown(
        m.moments.find((x) => x.id === MATCH_PRESS)!,
        "eyes",
      );
      await settle();
      expect(session.screen.get().hero).toBeNull();
      expect(session.screen.get().error).toBe(`${MATCH_PRESS}: ${NO_GRID}`);

      session.controls.openBreakdown(
        m.moments.find((x) => x.id === MATCH_HERO)!,
        "eyes",
      );
      await settle();
      const open = session.screen.get().hero!;
      expect(open).not.toBeNull();
      const te = takeEyesOf(open);
      expect(te.state.get()).toMatchObject({ step: "choosing", frame: 50, offset: -150 });
      expect(open.runner.status.get().status).not.toBe("running");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
