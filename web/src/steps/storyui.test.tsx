// @vitest-environment happy-dom
// The coaching story on the page (SPEC 7): the look's direction, who came into view, his picture and
// his thinking on the card; the timeline ticks that jump to a freeze; the decision's story with the
// honest scan count and no word of turning when the data shows none; no motion or blur in its styles.

import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import stepsJson from "../../public/data/steps_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { settle } from "../testing";
import type { Fetch } from "../takeeyes/controller";
import { stepThroughOf } from "./controller";
import { ScanStepsScreen } from "./ScanSteps";

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

async function opened() {
  const session = offline();
  const st = stepThroughOf(session, served, "/data/");
  const el = mount(session);
  act(() => st.open());
  await act(settle);
  return { st, el };
}

describe("His looks: the coaching story", () => {
  it("tells the look: its direction, who came into view, his picture and his thinking", async () => {
    const { el } = await opened();
    const story = textOf(el.querySelector(".ss-story"))!;
    expect(story).toMatch(/behind him, 124° from his body's facing/);
    expect(story).toMatch(/#9 N\. Varnhall: 4\.8 m off before, 0\.1 m after/);
    expect(textOf(el.querySelector(".ss-think"))).toMatch(
      /^Checking behind me\. #9 N\. Varnhall was 4\.8 m/,
    );
  });

  it("has a timeline tick per scan, labelled by direction, that jumps to its freeze", async () => {
    const { st, el } = await opened();
    const ticks = [...el.querySelectorAll<HTMLButtonElement>(".ss-tick")];
    expect(ticks.map((t) => textOf(t))).toEqual(["B", "D"]);
    expect(ticks[0].getAttribute("aria-label")).toBe("Look 1, behind him");
    click(ticks[1]);
    expect(st.state.get().index).toBe(1);
    click(el.querySelector<HTMLButtonElement>(".ss-tick")!);
    expect(st.state.get().index).toBe(0);
    expect(st.playback.get().frame).toBe(60);
  });

  it("explains the decision from the looks and says nothing of turning when the data shows none", async () => {
    const { el } = await opened();
    click(button(el, "Next"));
    const story = textOf(el.querySelector(".ss-story"))!;
    expect(story).toMatch(/He chose: Pass to #9 N\. Varnhall\./);
    expect(story).toMatch(/Look 1 brought #9 N\. Varnhall into view/);
    expect(story).toMatch(
      /Players average about three scans in the 10 s before receiving; he made 1\./,
    );
    expect(story).not.toMatch(/half-turn|side-on/i);
    expect(el.querySelector(".ss-turn-arc")).toBeNull();
  });

  it("marks the dropped look with a dash in the run without it", async () => {
    const { el } = await opened();
    click(button(el, "Without the look"));
    const tick = el.querySelector(".ss-tick")!;
    expect(textOf(tick)).toBe("–");
    expect(tick.classList.contains("missing")).toBe(true);
    expect(el.querySelector(".ss-think")).toBeNull();
    click(button(el, "Next"));
    expect(textOf(el.querySelector(".ss-story"))).toMatch(/he made 0\./);
  });

  it("holds every story still: no animation, transition or blur in the new styles", () => {
    const css = readFileSync("src/steps/steps.css", "utf8");
    const added = css.slice(css.indexOf("the coaching story"));
    expect(added.length).toBeGreaterThan(200);
    expect(added).not.toMatch(/animation|transition|blur\(|@keyframes/);
  });
});
