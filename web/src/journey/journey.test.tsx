// @vitest-environment happy-dom
// For studios (SPEC 7, door 3): four solutions for the league in order (tactical broadcast,
// personalised commentary, automated highlights, the stadium), then Value; each with its value
// line, its feature, a "Business value" line and one primary action, the next section under it;
// moved by arrow keys and opened by ?step= (the old step ids mapped); the demo-data badge is one
// string wherever audience or sponsor figures appear, and Value puts the league's revenue levers
// before the demo KPIs, with one measured number, marked; the studios' walk opens the five
// sections in about a minute. Door 1's compare (the old Event step) tells both runs from their
// verified lines.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import goalRaw from "../../public/data/without_look_far_post_finish_seed11.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { doorOf, parseDeepLink } from "../deeplink";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext } from "../session";
import { DEMO_DATA as STADIUM_DEMO, STUDIO_FILES } from "../stadium/StudioApp";
import { DEMO_LABEL } from "../studio/audience";
import { settle } from "../testing";
import { STORY_IDS, STORY_STEPS, STEP_IDS, QUICK_IDS, kindOf, secondsOf } from "../tour/steps";
import { closeTour, startTour } from "../tour/tourState";
import { Tour } from "../tour/Tour";
import { settingsMenu } from "../ui/Stage";
import { withoutLookOf } from "../without/without";
import { optionLabel, personLookup, personOf, tagOf } from "../steps/story";
import { DEMO_DATA, FACTS_VS_FIGURES } from "./DemoBadge";
import { ASK_RUN_ID, ComparePanel, Journey } from "./Journey";
import { COST_PER_VERIFIED_BREAKDOWN } from "./measured";
import { journey } from "./state";
import { eventIndex, STADIUM_MOMENTS, stadiumEventFor } from "./stadium";
import {
  JOURNEY_STEPS,
  moveStep,
  parseStep,
  STEP_MARK,
  STEP_TITLE,
  stepForKey,
  withStep,
  type JourneyStep,
} from "./steps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);

describe("the sections", () => {
  it("are the four solutions, A to D, then Value, in that order", () => {
    expect(JOURNEY_STEPS.map((s) => STEP_TITLE[s])).toEqual([
      "AI Tactical Broadcast",
      "AI Personalised Commentary",
      "AI Automated Highlights",
      "AI Stadium Experience",
      "Value",
    ]);
    expect(JOURNEY_STEPS.map((s) => STEP_MARK[s])).toEqual(["A", "B", "C", "D", null]);
  });

  it("move with the arrow keys, Home and End, held at the ends", () => {
    expect(stepForKey("broadcast", "ArrowRight")).toBe("commentary");
    expect(stepForKey("commentary", "ArrowLeft")).toBe("broadcast");
    expect(stepForKey("broadcast", "ArrowLeft")).toBe("broadcast");
    expect(stepForKey("value", "ArrowRight")).toBe("value");
    expect(stepForKey("value", "Home")).toBe("broadcast");
    expect(stepForKey("broadcast", "End")).toBe("value");
    expect(stepForKey("broadcast", "Enter")).toBeNull();
    expect(moveStep("broadcast", 2)).toBe("highlights");
  });

  it("parse only their own ids", () => {
    for (const s of JOURNEY_STEPS) expect(parseStep(s)).toBe(s);
    expect(parseStep("Value")).toBeNull();
    expect(parseStep("event")).toBeNull();
    expect(parseStep("tactics")).toBeNull();
    expect(parseStep(null)).toBeNull();
  });

  it("write ?door=studios&step= and keep every other parameter", () => {
    expect(withStep("?match=match-1&moment=far_post_finish", "value")).toBe(
      "?match=match-1&moment=far_post_finish&door=studios&step=value",
    );
    expect(withStep("?step=broadcast&intro=0", "highlights")).toBe(
      "?step=highlights&intro=0&door=studios",
    );
  });
});

describe("deep links", () => {
  it("?step=<id> opens that section on For studios, with no intro card and no autoplay", () => {
    const link = parseDeepLink("?step=broadcast");
    expect(link.step).toBe("broadcast");
    expect(doorOf(link)).toEqual({ door: "studios", studio: "broadcast", yourView: false });
    expect(link.intro).toBe(false);
    expect(link.autoplay).toBe(false);
    expect(link.warnings).toEqual([]);
    for (const s of JOURNEY_STEPS) expect(doorOf(parseDeepLink(`?step=${s}`)).studio).toBe(s);
  });

  it("maps the old studio steps onto the section that holds their panel now", () => {
    const want = {
      tactics: "broadcast",
      content: "highlights",
      crew: "commentary",
      value: "value",
    };
    for (const [old, now] of Object.entries(want)) {
      const link = parseDeepLink(`?step=${old}`);
      expect(link.warnings, old).toEqual([]);
      expect(doorOf(link), old).toEqual({ door: "studios", studio: now, yourView: false });
    }
  });

  it("maps the old steps onto the doors: Event is the look, Your view is in Settings", () => {
    expect(doorOf(parseDeepLink("?step=event"))).toEqual({
      door: "look",
      studio: null,
      yourView: false,
    });
    expect(doorOf(parseDeepLink("?step=your-view"))).toEqual({
      door: "look",
      studio: null,
      yourView: true,
    });
    for (const s of ["content", "value"]) {
      expect(doorOf(parseDeepLink(`?step=${s}`)).door).toBe("studios");
    }
    expect(parseDeepLink("?step=event").warnings).toEqual([]);
  });

  it("ignores and logs an unknown step", () => {
    const link = parseDeepLink("?step=money");
    expect(link.step).toBeNull();
    expect(link.warnings).toEqual(["step=money"]);
    expect(link.intro).toBe(true);
  });

  it("?tour=story starts the studios' walk at its first step, or at the step named", () => {
    expect(parseDeepLink("?tour=story").tour).toBe(STORY_IDS[0]);
    expect(parseDeepLink("?tour=story-value").tour).toBe("story-value");
    // the walk's old step ids land on the section that holds their panel now
    expect(parseDeepLink("?tour=story-tactics").tour).toBe("story-broadcast");
    expect(parseDeepLink("?tour=story-content").tour).toBe("story-highlights");
    expect(parseDeepLink("?tour=story-crew").tour).toBe("story-commentary");
  });
});

describe("the studios' walk", () => {
  it("opens the five sections in order and lasts about a minute", () => {
    const opened = STORY_STEPS.map((s) => s.journey);
    expect([...new Set(opened)]).toEqual([...JOURNEY_STEPS]);
    const total = secondsOf("story");
    expect(total).toBeGreaterThanOrEqual(50);
    expect(total).toBeLessThanOrEqual(75);
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

describe("the one measured number", () => {
  it("is docs/NUMBERS.md MA6, shown as its marker quotes it", () => {
    // tests/test_doc_numbers.py checks the marker against eval/reports/crew_vs_single.md.
    const source = readFileSync(join(process.cwd(), "src", "journey", "measured.ts"), "utf8");
    const marked = source.match(/<!--num:MA6-->(.*?)<!--\/num-->/)?.[1];
    expect(marked).toBe(COST_PER_VERIFIED_BREAKDOWN);
    expect(COST_PER_VERIFIED_BREAKDOWN).toMatch(/^\$\d+\.\d+$/);
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
  journey.set({ step: "broadcast", seq: 0 });
  window.history.replaceState(null, "", "/");
  settingsMenu.set({ open: false });
});
afterEach(() => {
  act(() => closeTour());
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(node = <Journey />, moment = hero) {
  const session = createSession(moment, EXAMPLE_PLAN, payloadJson);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return { container, session };
}

const tabs = (c: HTMLElement) => [
  ...c.querySelectorAll<HTMLButtonElement>("nav.journey-bar > [role='tablist'] > [role='tab']"),
];
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
  it("shows the five sections as tabs, the tactical broadcast open, each with the next under it", () => {
    const { container } = mount();
    expect(tabs(container).map((t) => t.textContent)).toEqual([
      "ATactical broadcast",
      "BCommentary",
      "CHighlights",
      "DStadium",
      "Value",
    ]);
    expect(selected(container)).toBe("ATactical broadcast");
    expect(panel(container).dataset.step).toBe("broadcast");
    expect(panel(container).getAttribute("aria-labelledby")).toBe("journey-tab-broadcast");
    expect(panel(container).querySelector("#tactics-lab")).not.toBeNull();
    // Only the open tab is in the Tab order.
    expect(tabs(container).map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    // The bar's name says where it goes; no kicker repeats it on screen.
    const bar = container.querySelector("nav.journey-bar")!;
    expect(bar.getAttribute("aria-label")).toBe(
      "For studios: four solutions for the league, then the value",
    );
    expect(bar.textContent).not.toMatch(/four solutions/i);
    // Under the panel, the next section, which takes the keyboard to its tab; it is not the
    // section's primary action.
    const next = panel(container).querySelector<HTMLButtonElement>(".journey-next .btn")!;
    expect(next.textContent).toBe("Next: Commentary");
    expect(next.classList.contains("btn-primary")).toBe(false);
    act(() => next.click());
    expect(panel(container).dataset.step).toBe("commentary");
    expect(document.activeElement?.id).toBe("journey-tab-commentary");
    expect(window.location.search).toBe("?door=studios&step=commentary");
  });

  it("each solution has its value line, a Business value line and one primary action", async () => {
    const { container } = mount();
    const primary: Record<string, string> = {
      broadcast: "Watch the broadcast",
      commentary: "Choose in Settings",
      highlights: "Play highlight",
      stadium: "Open the Stadium Screen Studio",
    };
    for (const [step, action] of Object.entries(primary)) {
      openAt(container, step as JourneyStep);
      if (step === "stadium") await shown(container, ".screen-wall");
      const p = panel(container);
      expect(p.querySelector(".chapter-title .kicker")?.textContent, step).toBe(
        `${STEP_MARK[step as JourneyStep]} · ${STEP_TITLE[step as JourneyStep]}`,
      );
      expect(p.querySelector(".chapter-lede .lede")?.textContent, step).toBeTruthy();
      const worth = p.querySelector(".journey-worth")!;
      expect(worth.textContent, step).toMatch(/^Business value \S/);
      const primaries = [...p.querySelectorAll(".btn-primary")].map((b) => b.textContent);
      expect(primaries, step).toEqual([action]);
    }
    // Value sums them up: no letter, no business-value line of its own, no primary action.
    openAt(container, "value");
    await shown(container, ".studio-sponsors");
    expect(panel(container).querySelector(".chapter-title .kicker")?.textContent).toBe("Value");
    expect(panel(container).querySelector(".btn-primary")).toBeNull();
  });

  it("A asks a broadcast's questions, each opening the view that answers it", () => {
    const { container } = mount();
    const p = panel(container);
    const asks = p.querySelector("[role='group'][aria-label='Ask the broadcast']")!;
    const buttons = [...asks.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Why did this high press work?",
      "Why did xT jump on this attack?",
      "What did the back line expose after losing the ball?",
      "Whose off-ball run made the shooting space?",
    ]);
    expect(p.querySelector(".lab-card")?.getAttribute("data-card")).toBe("high_press");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    act(() => buttons[1].click());
    expect(p.querySelector(".lab-card")?.getAttribute("data-card")).toBe("counter_attack");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    // The lab's own picker follows the question, and the question follows the picker.
    const lab = [...p.querySelectorAll<HTMLButtonElement>("nav[aria-label='Tactics'] button")];
    expect(lab.find((b) => b.getAttribute("aria-pressed") === "true")?.textContent).toBe(
      "Counter-attack",
    );
    act(() => lab.find((b) => b.textContent === "Transition after losing the ball")!.click());
    expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
    act(() => lab.find((b) => b.textContent === "High press")!.click());
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    // The run opens a mode: its button has an id, so closing the mode gives the keyboard back.
    expect(buttons[3].id).toBe(ASK_RUN_ID);
    expect(buttons[3].hasAttribute("aria-pressed")).toBe(false);
    expect(p.querySelector(".journey-worth")?.textContent).toMatch(/sponsors/);
  });

  it("door 1's compare tells both sides from the bundled verified lines, with no breakdown asked for", async () => {
    const { container, session } = mount(<ComparePanel />);
    await act(() => withoutLookOf(session, undefined, "/data/").load());
    const text = container.textContent!;
    expect(text).toContain("With the scan");
    expect(text).toContain("Without the scan");
    expect(text).toContain("Compare from above");
    expect(text).toContain("Step through his looks");
    const [withLook, without] = [...container.querySelectorAll(".journey-compare .tile")];
    expect(withLook.textContent).toContain("Removed: J. Ferriday's look over his right shoulder");
    expect(without.textContent).toContain("Without that look, J. Ferriday would have played it");
    expect(session.breakdown.get().status).not.toBe("loading");
    // One primary action per screen: door 1's is "Watch the look" above it, not here.
    expect(container.querySelector(".btn-primary")).toBeNull();
  });

  it("sums up the key look's runner and the factual decision from the app's data", async () => {
    const { container, session } = mount(<ComparePanel />);
    await act(() => withoutLookOf(session, undefined, "/data/").load());
    const lines = [...container.querySelectorAll(".journey-compare-summary p")];
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain("The look: Removed:");
    expect(lines[0].textContent).toContain(
      `where he saw ${tagOf(personOf(hero, hero.runnerId!))}'s run behind him`,
    );
    const action = optionLabel(hero.runs.factual.decision!.chosen, personLookup(hero)).replace(
      /^./,
      (c) => c.toLowerCase(),
    );
    expect(lines[1].textContent).toContain(`The result: With it, ${action}. Without that look,`);
    expect(lines[1].textContent).not.toContain("without it, Without");
  });

  it("shows no look summary for a hero without a key scan", () => {
    const { container } = mount(<ComparePanel />, { ...hero, keyScan: null });
    expect(container.querySelector(".journey-compare-summary")).toBeNull();
    expect(container.textContent).not.toContain("The look:");
    expect(container.textContent).not.toContain("The result:");
  });

  it("introduces the simulation only when the counterfactual removes the hero's key look", () => {
    const withLook = mount(<ComparePanel />).container.querySelector(".lede")!.textContent!;
    expect(withLook).toContain(
      `Try the simulation: ${tagOf(personOf(hero, hero.heroId!))} with his deliberate scan`,
    );
    expect(withLook).toContain("Each side is told by its checked lines.");
    expect(withLook).not.toContain("Watch it, then the same seconds");

    const withoutKeyLook = mount(<ComparePanel />, {
      ...hero,
      keyScan: null,
    }).container.querySelector(".lede")!.textContent!;
    expect(withoutKeyLook).not.toContain("Try the simulation:");
    expect(withoutKeyLook).toContain("Watch it, then the same seconds");
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
    expect(selected(container)).toBe("BCommentary");
    expect(document.activeElement?.id).toBe("journey-tab-commentary");
    expect(window.location.search).toBe("?door=studios&step=commentary");
    key("End");
    expect(panel(container).dataset.step).toBe("value");
    key("Home");
    expect(panel(container).dataset.step).toBe("broadcast");
  });

  it("B lists the audiences, opens Settings, and keeps the crew's breakdown and the evidence", () => {
    const { container } = mount();
    openAt(container, "commentary");
    const p = panel(container);
    const audiences = [...p.querySelectorAll(".journey-audiences dt")].map((d) => d.textContent);
    expect(audiences).toEqual([
      "Casual fan",
      "Tactical analyst",
      "Player focus",
      "Coach",
      "Audio description",
      "Multilingual",
    ]);
    expect(p.textContent).toContain("We ship English and Chinese");
    expect(p.textContent).toContain("Now: Casual fan · English");
    act(() => p.querySelector<HTMLButtonElement>(".btn-primary")!.click());
    expect(settingsMenu.get().open).toBe(true);
    expect(p.querySelector("section.breakdown")).not.toBeNull();
    expect(p.textContent).toContain("Behind the commentary: the AI crew");
    expect([...p.querySelectorAll("button")].map((b) => b.textContent)).toContain(
      "Open the evidence",
    );
  });

  it("C is the package for the league's channels, with the rights line", () => {
    const { container } = mount();
    openAt(container, "highlights");
    const p = panel(container);
    expect(p.textContent).toContain("Play highlight");
    expect(p.textContent).toContain("Shot list");
    expect(p.textContent).toContain("Social posts");
    expect(p.textContent).toContain("to grow its reach: one format per platform");
    expect(p.textContent).toContain("9:16 story");
    expect(p.textContent).toContain("16:9");
    expect(p.querySelector(".journey-rights")?.textContent).toBe(
      "Publishing and distribution stay within the rights the league grants.",
    );
    // The business figures wait for Value.
    expect(p.textContent).not.toContain("Impressions");
  });

  it("D is the stadium's screens for this moment, the studio one click away", async () => {
    const { container } = mount();
    openAt(container, "stadium");
    await shown(container, ".screen-wall");
    const p = panel(container);
    expect(p.textContent).toMatch(/Big-league stadiums already run/);
    // Its note is one sentence.
    const note = p.querySelector(".journey-stadium > .note")!.textContent!;
    expect(note).toBe("What the stadium's screens show for this moment (key look).");
    const pressed = p.querySelector("[aria-label='Matchday event'] [aria-pressed='true']");
    expect(pressed?.textContent).toBe("Key look");
    const studio = p.querySelector<HTMLAnchorElement>("a.btn-primary")!;
    expect(studio.textContent).toBe("Open the Stadium Screen Studio");
    expect(studio.getAttribute("href")).toMatch(/\?studio=1$/);
    expect(p.textContent).not.toContain("Impressions");
  });

  it("Value puts the revenue levers first, then the demo KPIs, each figure badged, and ends the door", async () => {
    const { container } = mount();
    openAt(container, "value");
    await shown(container, ".studio-sponsors");
    const p = panel(container);
    const levers = [...p.querySelectorAll(".journey-lever-list strong")].map((s) => s.textContent);
    expect(levers).toEqual([
      "Broadcast differentiation:",
      "Sponsor inventory:",
      "International and app engagement:",
      "Social reach:",
      "Lower production cost:",
    ]);
    // No revenue figure: the levers are words only.
    expect(p.querySelector(".journey-lever-list")!.textContent).not.toMatch(/\d/);
    const leversAt = p.querySelector(".journey-levers")!;
    const kpis = p.querySelector(".studio-business")!;
    expect(leversAt.compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kpis.querySelector("h3")?.textContent).toBe("Demo KPIs");
    // The one measured number, the marked one, outside the demo data.
    const measured = p.querySelector(".journey-measured")!;
    expect(measured.textContent).toContain(
      `Measured ${COST_PER_VERIFIED_BREAKDOWN} average model cost per eval breakdown with four scripts`,
    );
    expect(measured.querySelector(".demo-badge")).toBeNull();
    expect(p.textContent).toContain(FACTS_VS_FIGURES);
    expect(p.textContent).toContain("Impressions");
    expect(p.textContent).toContain("Click-through");
    expect(p.textContent).toContain("Sponsor slots in this programme");
    const badges = [...p.querySelectorAll(".demo-badge")].map((b) => b.textContent);
    // the sentence's, the business panel's, one under each of its five figures, the sponsor slots'
    expect(badges.length).toBeGreaterThanOrEqual(8);
    expect(new Set(badges)).toEqual(new Set([DEMO_DATA]));
    // The last section ends the door: no next one.
    expect(p.querySelector(".journey-next")).toBeNull();
    expect(p.querySelector(".journey-end")?.textContent).toContain("That's the studio side");
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
    expect(panel(container).dataset.step).toBe("broadcast");
    expect(window.location.search).toBe("");
  });

  it("a phone's stepper says where it is and moves on", () => {
    const { container } = mount();
    const stepper = container.querySelector<HTMLElement>(".journey-stepper")!;
    expect(stepper.textContent).toContain("Step 1 of 5");
    const next = [...stepper.querySelectorAll("button")].find((b) => b.textContent === "Next")!;
    expect(next.getAttribute("aria-label")).toBe("Next: Commentary");
    act(() => next.click());
    expect(stepper.textContent).toContain("Step 2 of 5");
    expect(panel(container).dataset.step).toBe("commentary");
  });

  it("the studios' walk opens each section's panel as it arrives", () => {
    const { container } = mount(
      <>
        <Journey />
        <Tour />
      </>,
    );
    act(() => startTour("story-highlights", "story"));
    expect(journey.get().step).toBe("highlights");
    expect(panel(container).dataset.step).toBe("highlights");
    expect(document.querySelector(".tour-card")?.textContent).toContain("For studios");
  });
});
