// @vitest-environment happy-dom
// The with/without outcome line beside the run switch: real actions and targets from the two
// runs' decisions, every digit a shirt number from the export, hidden where there is no contrast.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero, type Hero, type Run } from "../data/hero";
import { shortName } from "../data/roster";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext } from "../session";
import { actionPhrase, outcomeLine } from "./outcomeLine";
import { RunToggle } from "./RunToggle";

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
});

function mount(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

const withChoices = (h: Hero, factual: string | null, counterfactual: string | null): Hero => {
  const run = (r: Run, chosen: string | null): Run => ({
    ...r,
    decision: chosen && r.decision ? { ...r.decision, chosen } : chosen ? r.decision : null,
  });
  return {
    ...h,
    runs: {
      factual: run(h.runs.factual, factual),
      counterfactual: run(h.runs.counterfactual, counterfactual),
    },
  };
};

const number = (id: string) => hero.players.find((p) => p.id === id)!.number;

describe("outcomeLine", () => {
  it("names both decisions from the data, with shirt numbers and short names", () => {
    const f = hero.runs.factual.decision!.chosen;
    const c = hero.runs.counterfactual.decision!.chosen;
    expect(f).not.toBe(c);
    const line = outcomeLine(hero)!;
    expect(line).toEqual({ withLook: actionPhrase(hero, f), without: actionPhrase(hero, c) });
    const to = f.slice("pass:".length);
    expect(line.withLook).toBe(`passes to #${number(to)} ${shortName(to)}`);
  });

  it("phrases a pass, a carry and a shot", () => {
    const to = hero.runs.factual.decision!.chosen.slice("pass:".length);
    expect(actionPhrase(hero, `pass:${to}`)).toBe(`passes to #${number(to)} ${shortName(to)}`);
    expect(actionPhrase(hero, "carry")).toBe("carries it");
    expect(actionPhrase(hero, "shot")).toBe("shoots");
    expect(actionPhrase(hero, "shot:far")).toBe("shoots at the far post");
  });

  it("never puts an internal id on screen", () => {
    expect(actionPhrase(hero, "pass:")).toBeNull();
    expect(actionPhrase(hero, "mystery")).toBeNull();
    expect(outcomeLine(withChoices(hero, "pass:", "carry"))).toBeNull();
    expect(outcomeLine(withChoices(hero, "carry", "mystery"))).toBeNull();
  });

  it("has no line without a contrast", () => {
    const same = hero.runs.factual.decision!.chosen;
    expect(outcomeLine(withChoices(hero, same, same))).toBeNull();
    expect(outcomeLine(withChoices(hero, same, null))).toBeNull();
    expect(outcomeLine({ ...hero, counterfactual: null })).toBeNull();
    expect(
      outcomeLine({
        ...withChoices(hero, same, "carry"),
        counterfactual: { id: "cf", intervention: "force_action", action: "carry" },
      }),
    ).toBeNull();
    expect(outcomeLine({ ...hero, kind: "match" })).toBeNull();
  });
});

describe("the line beside the run switch", () => {
  const view = (h: Hero) =>
    mount(
      <SessionContext.Provider value={createSession(h, EXAMPLE_PLAN, payloadJson)}>
        <RunToggle />
      </SessionContext.Provider>,
    );

  it("shows both outcomes next to the switch", () => {
    const text = view(hero)
      .querySelector("[data-testid=run-outcome]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    const line = outcomeLine(hero)!;
    expect(text).toBe(`With the scan → ${line.withLook} · Without → ${line.without}`);
  });

  it("is left out where the moment has no without-look run", () => {
    const same = hero.runs.factual.decision!.chosen;
    const page = view(withChoices(hero, same, same));
    expect(page.querySelector(".seg.run")).not.toBeNull();
    expect(page.querySelector("[data-testid=run-outcome]")).toBeNull();
  });
});
