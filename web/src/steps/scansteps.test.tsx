// @vitest-environment happy-dom
// Scan step-through (SPEC 7) on the page: loaded on first open, frozen at each look with its
// verified lines and who came into his sight, Next / Back / Exit by button, arrow keys, Escape and
// swipe, the run without the look showing that look as missing, the potential passes drawn from
// the decision record, and the decision dimming everything but two players (never blurring).
// The 3D view and the board are left out (no WebGL here); the marks, steps and card are DOM.

import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import stepsJson from "../../public/data/steps_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { App } from "../App";
import { applyDeepLink, parseDeepLink } from "../deeplink";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { pressureExport, settle } from "../testing";
import type { Fetch } from "../takeeyes/controller";
import { stepThroughOf } from "./controller";
import { ScanStepsButton, ScanStepsScreen } from "./ScanSteps";
import { NO_STEPS } from "./steps";
import { COACH_LABEL, TEACHING_NOTE, TOUCH_NOTE } from "./coach";
import { teachingFile } from "./teaching.fixture";

// (a `?raw` import of a stylesheet comes back empty under vitest, and import.meta.url is not a
// file URL in jsdom; `npm test` runs in web/, as steps/storyui.test.tsx also relies on)
const stepsCss = readFileSync("src/steps/steps.css", "utf8");

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
  ok: url.endsWith("steps_seed3.json"),
  json: async () => stepsJson,
});

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(session: Session, node: ReactNode = <ScanStepsScreen start={null} scene={false} />) {
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
// an SVG element has no click(): send the event
const tap = (g: Element) =>
  act(() => void g.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const key = (target: Element, k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
const lines = (el: HTMLElement) => [...el.querySelectorAll(".ss-line")].map((l) => textOf(l));

async function opened(session = offline()) {
  const st = stepThroughOf(session, served, "/data/");
  const el = mount(session);
  act(() => st.open());
  await act(settle);
  return { session, st, el };
}

describe("His looks: opening", () => {
  it("loads the steps and freezes his eyes in the middle of his first look", async () => {
    const { st, el } = await opened();
    expect(st.state.get()).toMatchObject({ status: "ready", index: 0, mode: "factual" });
    expect(textOf(el.querySelector(".ss-card h2"))).toBe("Over his right shoulder");
    expect(textOf(el.querySelector(".ss-kicker"))).toBe("Look 1");
    expect(st.playback.get()).toMatchObject({ mode: "factual", frame: 60, playing: false });
    expect(document.activeElement).toBe(el.querySelector(".ss-card h2"));
    expect(lines(el)).toEqual([
      "Before the ball reaches J. Ferriday, he takes 1 look away from it.",
      "J. Ferriday looks over his right shoulder 0.8 s before the ball reaches him.",
      "That look brings S. Brannagh, N. Varnhall, S. Okondru, H. Talvisto, Y. Pellard, T. Mardelius, B. Coulvard, I. Fenmore, C. Brunvald and J. Kestrell into his sight.",
    ]);
    const sight = el.querySelector<HTMLDetailsElement>("details.ss-sight")!;
    expect(sight.open).toBe(false);
    expect(textOf(sight.querySelector("summary"))).toBe("Came into his sight on this look");
    const chips = [...sight.querySelectorAll("li")].map((c) => textOf(c));
    expect(chips).toContain("N. Varnhall");
    expect(textOf(el.querySelector(".ss-pass-group .ss-label"))).toBe("View overlays");
    expect(textOf(el.querySelector(".ss-hint"))).toBe("← / → step · Esc leaves · swipe on phone");
  });

  it("takes over the replay: parked at the decision, not playing", async () => {
    const session = offline();
    session.controls.playBreakdown();
    await opened(session);
    expect(session.playback.get()).toMatchObject({
      playing: false,
      frame: session.moment.decisionFrame,
    });
  });

  it("says why it cannot open on a moment with no bundled steps", () => {
    const other = { ...pressureExport(), seed: 7 };
    const pressure = createSession(parseHero(other), EXAMPLE_PLAN, payloadJson, null);
    const b = mount(pressure, <ScanStepsButton />).querySelector("button")!;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe(NO_STEPS);
  });

  it("shows a reason when the steps cannot be fetched, and a way back", async () => {
    const session = offline();
    const st = stepThroughOf(session, async () => ({ ok: false, json: async () => null }), "/d/");
    const el = mount(session);
    act(() => st.open());
    await act(settle);
    expect(textOf(el.querySelector(".ss-card [role=status]"))).toMatch(/could not be loaded/);
    click(button(el, "Back to the replay"));
    expect(st.state.get().open).toBe(false);
  });
});

describe("His looks: stepping", () => {
  it("Next and Back by button, then Done at his decision", async () => {
    const { st, el } = await opened();
    expect(button(el, "Back").getAttribute("aria-disabled")).toBe("true");
    const next = button(el, "Next");
    next.focus();
    click(next);
    expect(document.activeElement).toBe(button(el, "Done")); // the same button: focus stays
    expect(st.state.get().index).toBe(1);
    expect(textOf(el.querySelector(".ss-card h2"))).toBe("His decision");
    expect(st.playback.get()).toMatchObject({ frame: 75, focus: "tactical" });
    expect(lines(el)).toEqual([
      "It is his look over his right shoulder that brings N. Varnhall into his sight.",
      "When he decides, he pictures N. Varnhall 0.3 m from where he really is: he last saw him 0.4 s earlier.",
      "So he passes to N. Varnhall.",
      "T. Mardelius is the opponent nearest to N. Varnhall, 11.6 m from him.",
    ]);
    click(button(el, "Back"));
    expect(st.state.get().index).toBe(0);
    click(button(el, "Next"));
    click(button(el, "Done"));
    expect(st.state.get().open).toBe(false);
  });

  it("steps with the arrow keys and leaves with Escape", async () => {
    const { st, el } = await opened();
    const card = el.querySelector(".ss-card h2")!;
    key(card, "ArrowRight");
    expect(st.state.get().index).toBe(1);
    key(card, "ArrowRight"); // the last step stays
    expect(st.state.get().index).toBe(1);
    key(card, "ArrowLeft");
    expect(st.state.get().index).toBe(0);
    key(card, "Escape");
    expect(st.state.get().open).toBe(false);
  });

  it("steps with a swipe on the picture", async () => {
    const { st, el } = await opened();
    const stage = el.querySelector(".ss-stage")!;
    const swipe = (dx: number, dy = 0) =>
      act(() => {
        stage.dispatchEvent(
          new PointerEvent("pointerdown", { clientX: 300, clientY: 200, bubbles: true }),
        );
        stage.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 300 + dx, clientY: 200 + dy, bubbles: true }),
        );
      });
    swipe(-120);
    expect(st.state.get().index).toBe(1);
    swipe(120);
    expect(st.state.get().index).toBe(0);
    swipe(-20); // too short: a tap
    swipe(-60, 140); // mostly down: a scroll
    expect(st.state.get().index).toBe(0);
  });

  it("jumps to a step from the strip", async () => {
    const { st, el } = await opened();
    const dots = [...el.querySelectorAll<HTMLButtonElement>(".ss-dot")];
    expect(dots.map((d) => textOf(d))).toEqual(["Look 1", "Decision"]);
    expect(dots[0].getAttribute("aria-current")).toBe("step");
    click(dots[1]);
    expect(st.state.get().index).toBe(1);
  });
});

describe("His looks: without the look", () => {
  it("shows the removed look as missing, at the same moment, and his other decision", async () => {
    const { st, el } = await opened();
    click(button(el, "Without the look"));
    expect(st.state.get()).toMatchObject({ mode: "counterfactual", index: 0 });
    expect(st.playback.get()).toMatchObject({ mode: "counterfactual", frame: 60 });
    expect(textOf(el.querySelector(".ss-card h2"))).toBe("No look here");
    expect(textOf(el.querySelector(".ss-kicker"))).toBe("Look 1 · not taken in this run");
    expect(el.querySelector(".ss-dot.missing")).not.toBeNull();
    expect(lines(el)).toEqual([
      "J. Ferriday does not look away from the ball before it reaches him.",
      "Without that look, J. Ferriday takes no look from then until the ball reaches him.",
    ]);
    expect(el.querySelector(".ss-sight")).toBeNull();
    click(button(el, "Next"));
    expect(lines(el)).toContain("So he passes to K. Annersley.");
    // Back to the run with the look: the same step, the decision.
    click(button(el, "With the look"));
    expect(st.state.get()).toMatchObject({ mode: "factual", index: 1 });
  });
});

describe("His looks: the marks", () => {
  it("draws movement arrows on both views and rings who came into sight", async () => {
    const { el } = await opened();
    expect(el.querySelectorAll(".ss-pov .ss-arrow").length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".ss-board .ss-arrow").length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".ss-board .ss-seen-dot")).toHaveLength(10);
    expect(textOf(el.querySelector(".ss-legend"))).toMatch(/projected a second ahead/);
  });

  it("draws the decision record's options with Potential passes, his pick in gold", async () => {
    const { st, el } = await opened();
    const toggle = button(el, "Potential passes");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(el.querySelectorAll(".ss-board .ss-lane")).toHaveLength(0);
    click(toggle);
    expect(st.state.get().passes).toBe(true);
    const options = hero.runs.factual.decision!.options;
    expect(el.querySelectorAll(".ss-board .ss-lane")).toHaveLength(options.length);
    expect(el.querySelectorAll(".ss-board .ss-lane.chosen")).toHaveLength(1);
    expect(textOf(el.querySelector(".ss-board .ss-lane.chosen text"))).toBe("N. Varnhall");
    expect(textOf(el.querySelector(".ss-legend"))).toMatch(/along the ground/);
  });

  it("keeps essential names visible; other pass labels show on focus, hover or a tap", async () => {
    const { el } = await opened();
    // every ringed player is named (the receiver may be named on top of them)
    const ringed = el.querySelectorAll(".ss-board .ss-seen-dot").length;
    expect(el.querySelectorAll(".ss-pov .ss-seen text").length).toBeGreaterThanOrEqual(ringed);
    expect(textOf(el.querySelector(".ss-pov .ss-decision-maker"))).toBe(
      "J. Ferriday · decision-maker",
    );
    click(button(el, "Potential passes"));
    const other = el.querySelector<SVGGElement>(".ss-board .ss-lane:not(.chosen):not(.seen)")!;
    expect(other.getAttribute("tabindex")).toBe("0");
    expect(other.querySelector("text")).not.toBeNull();
    // the labels are hidden by default and shown by hover, focus or the .active a tap sets
    expect(stepsCss).toMatch(/\.ss-lane text \{\s+opacity: 0;/);
    expect(stepsCss).toMatch(
      /\.ss-lane\.active text,\s+\.ss-lane:hover text,\s+\.ss-lane:focus text \{\s+opacity: 1;/,
    );
    act(() => other.focus());
    expect(document.activeElement).toBe(other);
    expect(other.getAttribute("aria-pressed")).toBe("false");
    tap(other);
    expect(other.classList.contains("active")).toBe(true);
    expect(other.getAttribute("aria-pressed")).toBe("true");
    tap(other);
    expect(other.classList.contains("active")).toBe(false);
  });

  it("scrolls the evidence inside its card behind a bottom fade", async () => {
    const { el } = await opened();
    expect(el.querySelector(".ss-card > .ss-card-body > .ss-lines")).not.toBeNull();
    expect(el.querySelector(".ss-card > .ss-card-fade")).not.toBeNull();
    expect(stepsCss).toMatch(/\.ss-card-body \{[\s\S]*?overflow-y: auto;/);
    expect(stepsCss).toMatch(/\.ss-card-fade \{[\s\S]*?linear-gradient/);
  });

  it("dims the board at his decision but round exactly two players, with no blur", async () => {
    const { el } = await opened();
    expect(el.querySelector(".ss-focus")).toBeNull();
    click(button(el, "Next"));
    const dim = el.querySelectorAll<HTMLElement>(".ss-focus");
    expect(dim).toHaveLength(1);
    expect(dim[0].dataset.focus!.split(" ")).toEqual(["H9", "A5"]);
    const mask = dim[0].style.maskImage || dim[0].style.getPropertyValue("-webkit-mask-image");
    expect(mask.match(/radial-gradient/g)).toHaveLength(2);
    expect(el.querySelectorAll(".ss-board .ss-focus-ring")).toHaveLength(2);
    // The focus only dims, and neither it nor the card blurs or flashes.
    expect(stepsCss).not.toMatch(/blur\(|animation:\s*ss-dim/);
    // Only his pick is drawn until Potential passes adds the rest.
    expect(el.querySelectorAll(".ss-board .ss-lane")).toHaveLength(1);
  });
});

describe("His looks in the app", () => {
  it("opens from the moment and from the header, and gives the live screen back", async () => {
    const session = offline();
    const st = stepThroughOf(session, served, "/data/");
    const el = mount(session, <App autoplay={false} />);
    click(el.querySelector<HTMLButtonElement>("#scan-steps-story")!);
    await act(settle);
    expect(el.querySelector(".ss-screen")).not.toBeNull();
    expect(el.querySelector("#moment")).toBeNull(); // the story below makes way, as for Your call
    expect(st.state.get().status).toBe("ready");
    click(button(el, "Back to the replay"));
    expect(el.querySelector(".ss-screen")).toBeNull();
    expect(el.querySelector("#scan-steps-open")!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("His looks: the coach's example", () => {
  it("says its look times are scripted and steps through the coach's sequence", async () => {
    const session = offline();
    const file = teachingFile(stepsJson);
    const st = stepThroughOf(session, async () => ({ ok: true, json: async () => file }), "/d/");
    const el = mount(session);
    act(() => st.open());
    await act(settle);
    expect(textOf(el.querySelector(".ss-teaching"))).toBe(TEACHING_NOTE);
    const strip = [...el.querySelectorAll(".ss-strip button")].map((b) => textOf(b));
    expect(strip).toEqual(["Start", "Look 1", "Drop-back", "Half-turn", "Decision"]);
    // The start view: facing the ball, his options before any look, no "new in his picture".
    expect(textOf(el.querySelector(".ss-card h2"))).toBe("Facing the ball");
    expect(textOf(el.querySelector(".ss-picture"))).toContain("His options before any look");
    expect(el.querySelector(".ss-news, .ss-nothing")).toBeNull();
    expect(textOf(el.querySelector(".ss-think"))).toMatch(/^I face the ball\./);
    click(button(el, "Next"));
    expect(textOf(el.querySelector(".ss-kicker"))).toBe("Look 1");
    expect(el.querySelectorAll(".ss-news li").length).toBeGreaterThan(0);
    expect(textOf(el.querySelector(".ss-think"))).toMatch(/^Checking my left\./);
    click(button(el, "Next"));
    expect(textOf(el.querySelector(".ss-card h2"))).toBe("He drops back");
    expect(textOf(el.querySelector(".ss-kicker"))).toBe("After his look left");
    expect(textOf(el.querySelector(".ss-think"))).toMatch(/too tight to take it on my spot/);
    expect(st.playback.get().focus).toBe("tactical"); // on the board, with his path
    expect(el.querySelector(".ss-board .ss-path")).not.toBeNull();
    click(button(el, "Next"));
    expect(textOf(el.querySelector(".ss-card h2"))).toBe("On the half-turn");
    expect(textOf(el.querySelector(".ss-note"))).toBe(TOUCH_NOTE);
    expect(st.playback.get().focus).toBe("split"); // through his eyes
  });

  it("is linked from the scan story when the live service is there, not offline", async () => {
    const { el } = await opened();
    expect(el.querySelector(".ss-coach")).toBeNull(); // offline only the bundled moment plays
    const live = { ...offline(), offline: null };
    const shown = (await opened(live)).el.querySelector<HTMLAnchorElement>(".ss-coach a")!;
    expect(textOf(shown)).toBe(COACH_LABEL);
    expect(shown.getAttribute("href")).toBe("/?play=steps&match=pro_scan-116");
  });
});

describe("His looks by link", () => {
  it("?play=steps opens it on his first look, with no lineup card and no autoplay", async () => {
    const link = parseDeepLink("?play=steps");
    expect(link).toMatchObject({ play: "steps", intro: false, autoplay: false });
    const session = offline();
    const st = stepThroughOf(session, served, "/data/");
    applyDeepLink(session, link);
    await act(settle);
    expect(st.state.get()).toMatchObject({ open: true, status: "ready", index: 0 });
  });
});
