// @vitest-environment happy-dom
// The journey (SPEC 7): five steps in order, moved by arrow keys and opened by ?step=; each step
// opens its panel for the moment on screen; the demo-data badge is one string wherever audience or
// sponsor figures appear, and the Value step separates them from match facts; the Full story walks
// the five steps in about ninety seconds.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import goalRaw from "../../public/data/without_look_far_post_finish_seed11.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { parseDeepLink } from "../deeplink";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext } from "../session";
import { DEMO_DATA as STADIUM_DEMO, STUDIO_FILES } from "../stadium/StudioApp";
import { DEMO_LABEL } from "../studio/audience";
import { settle } from "../testing";
import { STORY_IDS, STORY_STEPS, STEP_IDS, QUICK_IDS, kindOf, secondsOf } from "../tour/steps";
import { closeTour, startTour } from "../tour/tourState";
import { Tour } from "../tour/Tour";
import { withoutLookOf } from "../without/without";
import { DEMO_DATA, FACTS_VS_FIGURES } from "./DemoBadge";
import { Journey } from "./Journey";
import { journey } from "./state";
import { eventIndex, STADIUM_MOMENTS, stadiumEventFor } from "./stadium";
import {
  JOURNEY_STEPS,
  moveStep,
  parseStep,
  STEP_LABEL,
  stepForKey,
  withStep,
  type JourneyStep,
} from "./steps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);

describe("the steps", () => {
  it("are Event, Tactics, Your view, Content, Value, in that order", () => {
    expect(JOURNEY_STEPS.map((s) => STEP_LABEL[s])).toEqual([
      "Event",
      "Tactics",
      "Your view",
      "Content",
      "Value",
    ]);
  });

  it("move with the arrow keys, Home and End, held at the ends", () => {
    expect(stepForKey("event", "ArrowRight")).toBe("tactics");
    expect(stepForKey("tactics", "ArrowLeft")).toBe("event");
    expect(stepForKey("event", "ArrowLeft")).toBe("event");
    expect(stepForKey("value", "ArrowRight")).toBe("value");
    expect(stepForKey("content", "Home")).toBe("event");
    expect(stepForKey("event", "End")).toBe("value");
    expect(stepForKey("event", "Enter")).toBeNull();
    expect(moveStep("tactics", 2)).toBe("content");
  });

  it("parse only their own ids", () => {
    for (const s of JOURNEY_STEPS) expect(parseStep(s)).toBe(s);
    expect(parseStep("Value")).toBeNull();
    expect(parseStep(null)).toBeNull();
  });

  it("write ?step= and keep every other parameter", () => {
    expect(withStep("?match=match-1&moment=far_post_finish", "value")).toBe(
      "?match=match-1&moment=far_post_finish&step=value",
    );
    expect(withStep("?step=event&intro=0", "content")).toBe("?step=content&intro=0");
  });
});

describe("deep links", () => {
  it("?step=<id> opens that step, with no intro card and no autoplay", () => {
    const link = parseDeepLink("?step=tactics");
    expect(link.step).toBe("tactics");
    expect(link.intro).toBe(false);
    expect(link.autoplay).toBe(false);
    expect(link.warnings).toEqual([]);
  });

  it("ignores and logs an unknown step", () => {
    const link = parseDeepLink("?step=money");
    expect(link.step).toBeNull();
    expect(link.warnings).toEqual(["step=money"]);
    expect(link.intro).toBe(true);
  });

  it("?tour=story starts the Full story at its first step, or at the step named", () => {
    expect(parseDeepLink("?tour=story").tour).toBe(STORY_IDS[0]);
    expect(parseDeepLink("?tour=story-value").tour).toBe("story-value");
  });
});

describe("the Full story", () => {
  it("walks the five steps in order and lasts about ninety seconds", () => {
    const opened = STORY_STEPS.map((s) => s.journey);
    expect([...new Set(opened)]).toEqual([...JOURNEY_STEPS]);
    const total = secondsOf("story");
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(100);
  });

  it("is a tour of its own, its ids apart from the other two", () => {
    const all = [...STEP_IDS, ...QUICK_IDS, ...STORY_IDS];
    expect(new Set(all).size).toBe(all.length);
    expect(STORY_IDS.map(kindOf)).toEqual(STORY_IDS.map(() => "story"));
  });

  it("says one plain line per step: no digits, no markup", () => {
    for (const s of STORY_STEPS) {
      for (const text of [s.title, s.caption, ...(s.variants ?? []).map((v) => v.caption)]) {
        expect(text).not.toMatch(/\d|<|>/);
      }
    }
  });
});

describe("the stadium's screens", () => {
  it("know the moments the programme is built on, from the bundled files", () => {
    expect(STADIUM_MOMENTS).toContainEqual({
      scenario: hero.scenario,
      seed: hero.seed,
      event: "key-look",
    });
    expect(STUDIO_FILES.hero).toBe(`hero_seed${hero.seed}.json`);
    expect(stadiumEventFor(hero.scenario, hero.seed)).toBe("key-look");
    const goal = goalRaw as { scenario: string; seed: number };
    expect(STUDIO_FILES.goalWithout).toBe(`without_look_${goal.scenario}_seed${goal.seed}.json`);
    expect(stadiumEventFor(goal.scenario, goal.seed)).toBe("goal");
    expect(stadiumEventFor("press_escape", 0)).toBeNull();
  });

  it("fall back to the key look's event, then the first", () => {
    const events = [{ type: "walk-out" as const }, { type: "key-look" as const }];
    expect(eventIndex(events, "key-look")).toBe(1);
    expect(eventIndex(events, null)).toBe(1);
    expect(eventIndex(events, "goal")).toBe(1);
    expect(eventIndex([{ type: "walk-out" as const }], null)).toBe(0);
  });
});

describe("the demo-data legend", () => {
  it("is one string in the studio, the stadium and the journey", () => {
    expect(DEMO_DATA).toBe("Demo data: simulated audience, not real results");
    expect(DEMO_LABEL).toBe(DEMO_DATA);
    expect(STADIUM_DEMO).toBe(DEMO_DATA);
  });

  it("the Value step's sentence names both kinds of number", () => {
    expect(FACTS_VS_FIGURES).toMatch(/Match facts/);
    expect(FACTS_VS_FIGURES).toMatch(/Verifier/);
    expect(FACTS_VS_FIGURES).toMatch(/simulated/);
    expect(FACTS_VS_FIGURES).not.toMatch(/\d/);
  });
});

// ---------- on screen ----------

const DATA = join(process.cwd(), "public", "data"); // vitest runs in web/
const mounted: { root: Root; container: HTMLElement }[] = [];

beforeAll(() => {
  // The stadium's show reads the bundled files; serve them from public/data, nothing else.
  vi.stubGlobal("fetch", async (url: string) => {
    const name = String(url).split("/data/")[1];
    if (!name) return new Response("not found", { status: 404 });
    return new Response(readFileSync(join(DATA, name)), { status: 200 });
  });
});
beforeEach(() => {
  journey.set({ step: "event", seq: 0 });
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  act(() => closeTour());
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(node = <Journey />) {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return { container, session };
}

const tabs = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>("[role='tab']")];
const selected = (c: HTMLElement) =>
  c.querySelector("[role='tab'][aria-selected='true']")?.textContent ?? "";
const panel = (c: HTMLElement) => c.querySelector<HTMLElement>("[role='tabpanel']")!;
const openAt = (c: HTMLElement, step: JourneyStep) =>
  act(() => tabs(c)[JOURNEY_STEPS.indexOf(step)].click());
/** Wait for the stadium's show (its bundled files read) to put `selector` in the panel. */
async function shown(c: HTMLElement, selector: string) {
  for (let k = 0; k < 50 && !panel(c).querySelector(selector); k++) await act(settle);
  if (!panel(c).querySelector(selector)) throw new Error(`no ${selector}: ${panel(c).textContent}`);
}

describe("the bar and its panels", () => {
  it("shows the five steps as tabs, Event open, and its with / without comparison", () => {
    const { container } = mount();
    expect(tabs(container).map((t) => t.textContent)).toEqual([
      "1Event",
      "2Tactics",
      "3Your view",
      "4Content",
      "5Value",
    ]);
    expect(selected(container)).toBe("1Event");
    expect(panel(container).dataset.step).toBe("event");
    expect(panel(container).getAttribute("aria-labelledby")).toBe("journey-tab-event");
    const text = panel(container).textContent!;
    expect(text).toContain("With the look");
    expect(text).toContain("Without the look");
    expect(text).toContain("Compare from above");
    // Only the open tab is in the Tab order.
    expect(tabs(container).map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    // The bar's name says where it goes; no kicker repeats it on screen.
    const bar = container.querySelector("nav.journey-bar")!;
    expect(bar.getAttribute("aria-label")).toBe("This moment, from event to value");
    expect(bar.textContent).not.toMatch(/from event to value/i);
  });

  it("Event tells both sides from the bundled verified lines, with no breakdown asked for", async () => {
    const { container, session } = mount();
    await act(() => withoutLookOf(session, undefined, "/data/").load());
    const [withLook, without] = [...panel(container).querySelectorAll(".journey-compare .tile")];
    expect(withLook.textContent).toContain("Removed: J. Ferriday's look over his right shoulder");
    expect(without.textContent).toContain("Without that look, J. Ferriday would have played it");
    expect(session.breakdown.get().status).not.toBe("loading");
  });

  it("moves with the arrow keys and writes the step into the address", () => {
    const { container } = mount();
    const key = (k: string) =>
      act(() => {
        tabs(container)
          .find((t) => t.getAttribute("aria-selected") === "true")!
          .dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      });
    key("ArrowRight");
    expect(selected(container)).toBe("2Tactics");
    expect(panel(container).querySelector("#tactics-lab")).not.toBeNull();
    expect(document.activeElement?.id).toBe("journey-tab-tactics");
    expect(window.location.search).toBe("?step=tactics");
    key("End");
    expect(panel(container).dataset.step).toBe("value");
    key("Home");
    expect(panel(container).dataset.step).toBe("event");
  });

  it("Your view has the audience, language and follow choices inline", () => {
    const { container } = mount();
    openAt(container, "your-view");
    const p = panel(container);
    expect(p.querySelector(".your-view-inline")).not.toBeNull();
    expect(p.textContent).toContain("Follow");
    expect(p.textContent).toContain("Language");
  });

  it("Content has the package and the stadium's screens for this moment", async () => {
    const { container } = mount();
    openAt(container, "content");
    await shown(container, ".screen-wall");
    const p = panel(container);
    expect(p.textContent).toContain("Play highlight");
    expect(p.textContent).toContain("Social posts");
    expect(p.textContent).toContain("In the stadium");
    // Its note is one sentence.
    const note = p.querySelector(".journey-stadium > .note")!.textContent!;
    expect(note).toBe("What the stadium's screens show for this moment (key look).");
    expect(p.querySelector(".screen-wall")).not.toBeNull();
    const pressed = p.querySelector("[aria-label='Matchday event'] [aria-pressed='true']");
    expect(pressed?.textContent).toBe("Key look");
    // The business figures wait for the Value step.
    expect(p.textContent).not.toContain("Impressions");
  });

  it("Value has the business panel and the sponsor slots, each with the badge, and the sentence", async () => {
    const { container } = mount();
    openAt(container, "value");
    await shown(container, ".studio-sponsors");
    const p = panel(container);
    expect(p.textContent).toContain(FACTS_VS_FIGURES);
    expect(p.textContent).toContain("Impressions");
    expect(p.textContent).toContain("Sponsor slots in this programme");
    const badges = [...p.querySelectorAll(".demo-badge")].map((b) => b.textContent);
    // the sentence's, the business panel's, one under each of its five figures, the sponsor slots'
    expect(badges.length).toBeGreaterThanOrEqual(8);
    expect(new Set(badges)).toEqual(new Set([DEMO_DATA]));
  });

  it("no simulated figure renders without the badge beside it", async () => {
    const { container } = mount();
    openAt(container, "value");
    await shown(container, ".studio-sponsors");
    const p = panel(container);
    const metrics = [...p.querySelectorAll(".studio-metric")];
    expect(metrics.length).toBeGreaterThan(0);
    for (const m of metrics) expect(m.querySelector(".demo-badge")?.textContent).toBe(DEMO_DATA);
    for (const block of p.querySelectorAll(".studio-business, .studio-sponsors")) {
      expect(block.querySelector(".demo-badge")?.textContent).toBe(DEMO_DATA);
    }
  });

  it("a phone's stepper has no arrow-key handling, so focus never lands on a hidden tab", () => {
    const { container } = mount();
    const stepper = container.querySelector<HTMLElement>(".journey-stepper")!;
    const next = [...stepper.querySelectorAll("button")].find((b) => b.textContent === "Next")!;
    act(() => {
      next.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(panel(container).dataset.step).toBe("event");
    expect(window.location.search).toBe("");
  });

  it("a phone's stepper says where it is and moves on", () => {
    const { container } = mount();
    const stepper = container.querySelector<HTMLElement>(".journey-stepper")!;
    expect(stepper.textContent).toContain("Step 1 of 5");
    const next = [...stepper.querySelectorAll("button")].find((b) => b.textContent === "Next")!;
    expect(next.getAttribute("aria-label")).toBe("Next: Tactics");
    act(() => next.click());
    expect(stepper.textContent).toContain("Step 2 of 5");
    expect(panel(container).dataset.step).toBe("tactics");
  });

  it("offers the Full story beside the steps", () => {
    const { container } = mount();
    const story = container.querySelector(".journey-story");
    expect(story?.textContent).toBe(`Full story · ${secondsOf("story")} s`);
  });

  it("the Full story opens each step's panel as it arrives", () => {
    const { container } = mount(
      <>
        <Journey />
        <Tour />
      </>,
    );
    act(() => startTour("story-content", "story"));
    expect(journey.get().step).toBe("content");
    expect(panel(container).dataset.step).toBe("content");
    expect(document.querySelector(".tour-card")?.textContent).toContain("Full story");
  });
});
