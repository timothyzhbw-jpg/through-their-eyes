// @vitest-environment happy-dom
// Academy drill (SPEC 7) on the page: the grid loaded on open, his head as a named slider (the
// arrow keys turn it, letting go ends the look), the look said in the grid's values, Your call's
// markers for the pass, the result in verified lines with the comparison, and the drill in App's
// live screen place with Escape back to the opener. The 3D views and the board are left out (no
// WebGL here); the countdown, the dial, the markers and the card are DOM.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import lookJson from "../../public/data/look_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { App } from "../App";
import { parseHero } from "../data/hero";
import { parseDeepLink } from "../deeplink";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import type { Fetch } from "../takeeyes/controller";
import { settle } from "../testing";
import { drillOf, type Drill } from "./controller";
import { DrillStage } from "./Drill";

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

function mount(session: Session, node: ReactNode = <DrillStage scene={false} />) {
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
const key = (target: Element, type: "keydown" | "keyup", k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
  });
/** Run the drill's clock by hand, `seconds` of wall time. */
const run = (d: Drill, seconds: number) =>
  act(() => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) d.tick(Math.min(1 / 60, seconds - t));
  });

async function opened(session = offline()) {
  const d = drillOf(session, served, "/data/");
  const el = mount(session);
  act(() => d.open());
  await act(settle);
  return { session, d, el };
}

describe("Academy drill: ready", () => {
  it("briefs the viewer, shows the moment's time to the reception and his head as a slider", async () => {
    const { d, el } = await opened();
    expect(d.state.get().step).toBe("ready");
    expect(textOf(el.querySelector(".dr-card h2"))).toBe(
      "Check your shoulder before the ball arrives",
    );
    expect(textOf(el.querySelector(".dr-kicker"))).toBe("Academy drill · Blind side");
    expect(textOf(el.querySelector(".dr-countdown"))).toBe("Ball arrives in 2.2 s");
    const slider = el.querySelector('[role="slider"]')!;
    expect(slider.getAttribute("aria-label")).toBe("J. Ferriday's head");
    expect(slider.getAttribute("aria-valuetext")).toBe("Facing the ball");
    expect(slider.getAttribute("aria-disabled")).toBe("true");
    const levels = el.querySelectorAll(".dr-level");
    expect([...levels].map(textOf)).toEqual(["Blind side · easier", "Under pressure · harder"]);
    expect(levels[0].getAttribute("aria-current")).toBe("page");
    // Offline only the bundled moment plays: the other level says it needs the live service.
    expect(levels[1].tagName).toBe("BUTTON");
    click(levels[1] as HTMLElement);
    expect(textOf(el.querySelector(".dr-levels .dr-hint"))).toBe(
      "That moment needs the live service.",
    );
  });

  it("chooses the pace before the start", async () => {
    const { d, el } = await opened();
    expect(d.state.get().pace).toBe(0.5);
    click(button(el, "Match speed"));
    expect(d.state.get().pace).toBe(1);
  });
});

describe("Academy drill: the look, the call, the result", () => {
  it("turns his head with the arrow keys, locks the look on the grid and says it", async () => {
    const { d, el } = await opened();
    click(button(el, "Match speed"));
    click(button(el, "Start"));
    const slider = el.querySelector<HTMLElement>('[role="slider"]')!;
    expect(document.activeElement).toBe(slider);
    expect(slider.getAttribute("aria-disabled")).toBeNull();
    run(d, (50 - 15) * 0.04); // to frame 50: 0.8 s before the ball arrives
    expect(textOf(el.querySelector(".dr-countdown"))).toBe("Ball arrives in 0.8 s");
    key(slider, "keydown", "ArrowRight");
    run(d, 0.35);
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^1[34]\d° to his right of the ball$/);
    key(slider, "keyup", "ArrowRight");
    expect(textOf(el.querySelector(".dr-locked"))).toBe(
      "Your look: 0.8 s before the ball, 150° over his right shoulder",
    );
    expect(textOf(el.querySelector(".dr-card .dr-lead"))).toBe(
      "Your look: 0.8 s before the ball, 150° over his right shoulder.",
    );
    expect(el.querySelector(".dr-tick.on")).not.toBeNull();
  });

  it("calls from his picture with that look, then shows what came of it in verified lines", async () => {
    const { d, el } = await opened();
    click(button(el, "Match speed"));
    click(button(el, "Start"));
    const slider = el.querySelector<HTMLElement>('[role="slider"]')!;
    run(d, (50 - 15) * 0.04);
    key(slider, "keydown", "ArrowRight");
    run(d, 0.4);
    key(slider, "keyup", "ArrowRight");
    run(d, 1.2);
    expect(d.state.get().step).toBe("calling");
    expect(textOf(el.querySelector(".dr-card h2"))).toBe("Your call");
    const markers = el.querySelector('[role="group"][aria-label="Options of J. Ferriday"]')!;
    const runner = [...markers.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")!.startsWith("Pass to N. Varnhall"),
    )!;
    expect(runner.getAttribute("aria-label")).not.toMatch(/not seen lately/); // fresh: he looked
    click(button(el, "Pick with the keyboard"));
    expect(document.activeElement?.closest('[role="group"]')).toBe(markers);
    click(runner);
    expect(d.state.get().step).toBe("result");
    expect(textOf(el.querySelector(".dr-card h2"))).toBe("You made his call");
    const checks = [...el.querySelectorAll(".dr-checks li")].map(textOf);
    expect(checks).toEqual([
      "✓You looked before the ball arrived",
      "✓N. Varnhall was fresh in your picture",
      "✓Your pass is the one he played",
    ]);
    const lines = el.querySelector('[aria-label="Verified lines"]')!;
    expect(textOf(lines)).toMatch(/He still passes to N\. Varnhall, as he really did\./);
    const versus = [...el.querySelectorAll(".dr-versus dd:first-of-type")].map(textOf);
    expect(versus).toEqual(["Pass to N. Varnhall", "Pass to N. Varnhall", "Pass to K. Annersley"]);
    click(button(el, "Try again"));
    expect(d.state.get().step).toBe("ready");
    expect(textOf(button(el, "Go again"))).toBe("Go again");
  });

  it("with no look the runner is a grey ghost, and the sim's call goes elsewhere", async () => {
    const { d, el } = await opened();
    click(button(el, "Match speed"));
    click(button(el, "Start"));
    run(d, 2.5);
    expect(d.state.get().step).toBe("calling");
    expect(textOf(el.querySelector(".dr-card .dr-lead"))).toMatch(/^You took no look\./);
    const runner = [
      ...el.querySelectorAll('[role="group"][aria-label="Options of J. Ferriday"] button'),
    ].find((b) => b.getAttribute("aria-label")!.startsWith("Pass to N. Varnhall"))!;
    expect(runner.getAttribute("aria-label")).toMatch(/not seen lately/);
    click(runner as HTMLElement);
    const checks = [...el.querySelectorAll(".dr-checks li")].map((li) => li.className);
    expect(checks).toEqual(["no", "no", "ok"]);
    expect(textOf(el.querySelector(".dr-you"))).toMatch(
      /On your picture the pass to K\. Annersley looked more promising, and with your look he goes for it\./,
    );
    expect(textOf(el.querySelector(".dr-versus .yours dd"))).toBe("Pass to K. Annersley");
  });
});

describe("Academy drill: in the app", () => {
  it("takes the live screen's place from the moment's button; Escape returns focus to it", async () => {
    const session = offline();
    const d = drillOf(session, served, "/data/");
    const page = mount(session, <App autoplay={false} />);
    const live = () => page.querySelector('section.stage[aria-label="Live screen"]');
    const screen = () => page.querySelector('section.dr-screen[aria-label="Academy drill"]')!;
    // The moment's button, in its "More ways in" fold: the fold is opened and the button focused.
    click(page.querySelector<HTMLButtonElement>("#drill-story")!);
    await act(settle);
    expect(d.state.get().step).toBe("ready");
    expect(live()).toBeNull();
    expect(page.querySelector("main.moment")).toBeNull();
    expect(page.querySelector(".moment-rail")).toBeNull();
    key(screen().querySelector(".dr-card")!, "keydown", "Escape");
    expect(d.state.get().step).toBe("closed");
    expect(live()).not.toBeNull();
    const story = page.querySelector<HTMLButtonElement>("#drill-story")!;
    expect(document.activeElement).toBe(story);
    expect(story.closest("details")!.open).toBe(true);

    // The header's More item: More shut behind the drill, so focus goes to the More button.
    click(page.querySelector<HTMLButtonElement>("#header-more")!);
    click(page.querySelector<HTMLButtonElement>("#drill-open")!);
    await act(settle);
    expect(live()).toBeNull();
    key(screen().querySelector(".dr-card")!, "keydown", "Escape");
    expect(live()).not.toBeNull();
    expect(document.activeElement).toBe(page.querySelector("#header-more"));
  });

  it("opens from its deep link, which skips the intro card", () => {
    expect(parseDeepLink("?play=drill")).toMatchObject({ play: "drill", intro: false });
    expect(parseDeepLink("?match=press_escape-0&play=drill").play).toBe("drill");
  });
});
