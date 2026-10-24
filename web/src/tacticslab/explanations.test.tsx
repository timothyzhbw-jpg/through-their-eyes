// @vitest-environment happy-dom
// One tactic, two explanations: the default follows the audience, both tabs stay available, and
// every result digit comes from the metric object. Empty data says so instead of inventing a tactic.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import bundle from "../../public/data/without_look_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { PERSONAS, type Persona } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { json } from "../testing";
import { buildCards } from "./cards";
import matchFixture from "./fixture_match1_transitions.json";
import { buildUpMetrics, counterAttack, parseXtGrid, transitionAfterLoss } from "./metrics";
import type { Scope } from "./scope";
import { TacticsLabPanel } from "./TacticsLab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const xt = parseXtGrid(bundle.xt);
const match = parseHero(matchFixture);
const scope: Scope = { heroes: {}, match, loading: false, online: true };
const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
});

function mount(persona: Persona, node: ReactNode): { page: HTMLElement; session: Session } {
  const session = createSession(parseHero(raw), EXAMPLE_PLAN, payloadJson);
  session.breakdown.set({ persona });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return { page: container, session };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
const tab = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((b) => text(b) === name)!;
const pick = (page: HTMLElement, title: string) =>
  act(() =>
    [...page.querySelectorAll<HTMLButtonElement>(".pick-row button")]
      .find((b) => text(b) === title)!
      .click(),
  );

describe("Pro and Plain", () => {
  it("defaults to Plain for casual and Pro for analyst and coach", () => {
    vi.stubGlobal("fetch", async () => json(bundle));
    for (const [persona, expected] of [
      ["casual", "Plain"],
      ["analyst", "Pro"],
      ["coach", "Pro"],
    ] as const) {
      const { page } = mount(persona, <TacticsLabPanel xt={xt} scope={scope} />);
      expect(tab(page, expected).getAttribute("aria-selected")).toBe("true");
    }
    for (const persona of PERSONAS) {
      const { page } = mount(persona, <TacticsLabPanel xt={xt} scope={scope} />);
      const selected = persona === "analyst" || persona === "coach" ? "Pro" : "Plain";
      expect(tab(page, selected).getAttribute("aria-selected")).toBe("true");
    }
  });

  it("follows a persona change until the viewer chooses a tab", () => {
    const { page, session } = mount("casual", <TacticsLabPanel xt={xt} scope={scope} />);
    act(() => session.breakdown.set({ persona: "analyst" }));
    expect(tab(page, "Pro").getAttribute("aria-selected")).toBe("true");
    act(() => tab(page, "Plain").click());
    act(() => session.breakdown.set({ persona: "coach" }));
    expect(tab(page, "Pro").getAttribute("aria-selected")).toBe("true");
  });

  it("gives every tactic both tabs and a one-sentence Plain explanation", () => {
    const { page } = mount("casual", <TacticsLabPanel xt={xt} scope={scope} />);
    const cards = buildCards(parseHero(raw), xt, scope);
    for (const card of cards) {
      pick(page, card.title);
      const shown = page.querySelector<HTMLElement>(`[data-card="${card.id}"]`)!;
      expect([...shown.querySelectorAll("[role=tab]")].map(text)).toEqual(["Pro", "Plain"]);
      expect(card.plain).toMatch(/^[^.!?]+[.!?]$/);
    }
  });

  it("switches the counter between a fan sentence and the measured model", () => {
    vi.stubGlobal("fetch", async () => json(bundle));
    const { page } = mount("casual", <TacticsLabPanel xt={xt} scope={scope} />);
    pick(page, "Counter-attack");
    const card = () => page.querySelector<HTMLElement>('[data-card="counter_attack"]')!;
    expect(card().querySelector(".lab-table")).toBeNull();
    expect(text(card().querySelector("[role=tabpanel]"))).toMatch(/^Win it and go/);
    act(() => tab(card(), "Pro").click());
    expect(tab(card(), "Pro").getAttribute("aria-selected")).toBe("true");
    expect(card().querySelector(".lab-table")).not.toBeNull();
    expect(text(card())).toContain("the opponents' half");
    expect(text(card())).toContain("attacking third");
    expect(text(card())).toContain("does not split it into shot, goal and move parts");
    act(() => tab(card(), "Plain").click());
    expect(card().querySelector(".lab-table")).toBeNull();
  });

  it("uses metric results, not hand-written result digits", () => {
    const cards = buildCards(match, xt, scope);
    const card = cards.find((c) => c.id === "counter_attack")!;
    const best = counterAttack(match, xt).best!;
    expect(card.metrics.find((m) => m.label === "Win to final third or shot")!.values).toEqual([
      `${best.seconds.toFixed(1)} s`,
    ]);
    expect(card.metrics.find((m) => m.label === "Completed passes")!.values).toEqual([
      String(best.passes),
    ]);
    expect(card.metrics.find((m) => m.label === "xT gained")!.values).toEqual([
      `${best.xtAdded >= 0 ? "+" : "−"}${Math.abs(best.xtAdded).toFixed(3)}`,
    ]);

    const build = cards.find((c) => c.id === "build_up")!;
    const escape = buildUpMetrics(match).best!;
    expect(build.pro).toContain(String(escape.bypassed));
    expect(build.pro).toContain(escape.pressure.toFixed(2));
    expect(build.metrics[0].values).toEqual(
      buildUpMetrics(match).teams.map((m) => `${m.pressured} · ${m.completedPressured}`),
    );

    const transition = cards.find((c) => c.id === "transition")!;
    const after = transitionAfterLoss(match, xt).best!;
    expect(transition.pro).toContain(after.seconds.toFixed(1));
    expect(transition.metrics[0].values).toEqual([`${after.lineTowardGoal.toFixed(1)} m`]);
    expect(transition.metrics[1].values).toEqual([
      `${after.spaceAtLoss.toFixed(1)} m → ${after.spaceAtEnd.toFixed(1)} m`,
    ]);
    expect(transition.metrics[2].values).toEqual([
      `${after.xtStart.toFixed(3)} → ${after.xtPeak.toFixed(3)}`,
    ]);
  });
});

describe("not in this data", () => {
  it("keeps the counter card honest when no fast attack follows a win", () => {
    const empty = parseHero(raw);
    empty.runs.factual.events = [];
    const cards = buildCards(empty, xt, { heroes: {}, match: empty, loading: false, online: true });
    const card = cards.find((c) => c.id === "counter_attack")!;
    expect(card.empty).toMatch(/^Not in this match's data/);
    expect(card.metrics).toEqual([]);
    expect(card.watch).toBeNull();
  });
});
