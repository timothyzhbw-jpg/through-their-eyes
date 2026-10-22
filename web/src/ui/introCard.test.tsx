// @vitest-environment happy-dom
// The first screen: a one-line hook and one button, Start, which opens the quick tour where the
// page has it; the line-ups, whose eyes to watch, Just watch and the full tour behind "Teams and
// more". It waits for the viewer (no countdown, nothing closes it by itself), closes on Start,
// Just watch, Escape or a click on the page around it, and keeps the keyboard inside.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type ViewSession } from "../session";
import { SOURCES } from "../provenance/source";
import { matchExport } from "../testing";
import { closeTour, tour } from "../tour/tourState";
import { intro } from "./intro";
import { hookOf, IntroCard } from "./IntroCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson);
const mounted: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => intro.set({ open: true }));
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  intro.set({ open: false });
  closeTour();
  vi.useRealTimers();
});

function mount(session: ViewSession): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <IntroCard />
      </SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return container;
}

function button(page: Element, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.replace(/\s+/g, " ").trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

const click = (el: HTMLElement) => act(() => el.click());
const dialogOf = (page: Element) => page.querySelector<HTMLElement>('[role="dialog"]');
const textOf = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

/** SPEC §0, verbatim. */
const PITCH =
  "See what they saw. An AI studio that explains key moments through the player's own " +
  "perception — the scans before the ball arrived, what was visible, what he believed — and " +
  "checks every number the crew says or captions before it airs.";

/** Two heroes, so the card offers two pairs of eyes. */
function twoHeroes() {
  const exported = matchExport();
  exported.match.possessions[2].hero = "A5";
  return createMatchSession(parseHero(exported), { api: null, dataUrl: "/data/" });
}

describe("the first screen", () => {
  it("is one line and one button: the hook names the dialog and Start has the focus", () => {
    const page = mount(offline());
    const dialog = dialogOf(page)!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(textOf(title)).toBe("One look over his shoulder changed his pass. See why.");
    expect(title?.querySelector("em")?.textContent).toBe("See why.");
    expect(dialog.textContent).toContain("A synthetic match · every player fictional");
    expect(document.activeElement).toBe(button(page, "Start"));
    // The line-ups and the other ways in are behind the toggle, not on the first screen.
    const toggle = button(page, "Teams and more");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const more = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(more.hidden).toBe(true);
    expect(dialog.contains(more)).toBe(true);
  });

  it("has a hook with no numbers for every kind of page", () => {
    expect(hookOf(offline())).toEqual({
      line: "One look over his shoulder changed his pass.",
      call: "See why.",
    });
    const match = createMatchSession(parseHero(matchExport()), { api: null, dataUrl: "/data/" });
    expect(hookOf(match)).toEqual({
      line: "A whole match, through the players' eyes.",
      call: "Watch it live.",
    });
    for (const { line } of [hookOf(offline()), hookOf(match)]) expect(line).not.toMatch(/\d/);
  });

  it("waits for the viewer: nothing closes it by itself and nothing counts down", () => {
    vi.useFakeTimers();
    const page = mount(offline());
    act(() => void vi.advanceTimersByTime(60_000));
    expect(intro.get().open).toBe(true);
    expect(dialogOf(page)).not.toBeNull();
    expect(dialogOf(page)!.hasAttribute("aria-describedby")).toBe(false);
    expect(page.querySelector(".lineup-countdown")).toBeNull();
  });

  it("Start opens the quick tour on a hero moment that has it", () => {
    const page = mount(offline());
    click(button(page, "Start"));
    expect(intro.get().open).toBe(false);
    expect(dialogOf(page)).toBeNull();
    expect(tour.get()).toMatchObject({ open: true, kind: "quick", at: null });
  });

  it("Start starts watching where there is no quick tour (a stitched match), with the chosen eyes", () => {
    const session = twoHeroes();
    const page = mount(session);
    click(button(page, "Teams and more"));
    expect(page.textContent).not.toContain("Just watch"); // Start does that here
    click(button(page, "T. Mardelius · CB Hero of possession 3"));
    act(() => session.playback.set({ povPlayer: "H8" }));
    click(button(page, "Start"));
    expect(session.playback.get().povPlayer).toBe("A5");
    expect(intro.get().open).toBe(false);
    expect(tour.get().open).toBe(false);
  });

  it("closes with Escape, and with a click on the page around it", () => {
    const page = mount(offline());
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(intro.get().open).toBe(false);
    expect(dialogOf(page)).toBeNull();

    act(() => intro.set({ open: true }));
    click(page.querySelector<HTMLElement>(".intro-scrim")!);
    expect(intro.get().open).toBe(false);
  });

  it("stays open on a click inside it that is not a button, and on other keys", () => {
    const page = mount(offline());
    click(page.querySelector<HTMLElement>("h2")!);
    for (const key of ["a", "Enter", " ", "ArrowDown"]) {
      act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    }
    expect(intro.get().open).toBe(true);
    expect(dialogOf(page)).not.toBeNull();
  });

  it("keeps Tab among what is shown, and restores page scrolling when it closes", () => {
    const overflow = document.body.style.overflow;
    const page = mount(offline());
    const start = button(page, "Start");
    const toggle = button(page, "Teams and more");
    const tab = (from: HTMLElement, shiftKey = false) =>
      act(() => {
        from.focus();
        from.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }),
        );
      });
    // Folded: the last control is the toggle, not a hidden button behind it.
    tab(toggle);
    expect(document.activeElement).toBe(start);
    tab(start, true);
    expect(document.activeElement).toBe(toggle);
    click(toggle);
    const full = button(page, "Full tour · 90 s");
    tab(full);
    expect(document.activeElement).toBe(start);
    expect(document.body.style.overflow).toBe("hidden");
    click(button(page, "Just watch"));
    expect(document.body.style.overflow).toBe(overflow);
  });
});

describe("Teams and more", () => {
  it("opens the line-ups, labels the run's scan counts as sim data, and folds again", () => {
    const page = mount(offline());
    const toggle = button(page, "Teams and more");
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const more = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(more.hidden).toBe(false);
    expect(textOf(more.querySelector(".lineup-clubs"))).toBe("Kestrel Bay v Corvane Vale");
    expect(textOf(more.querySelector(".lineup-pitch"))).toBe(PITCH);
    for (const team of ["Kestrel Bay", "Corvane Vale"]) {
      expect(more.querySelectorAll(`ol[aria-label="${team} line-up"] > li`)).toHaveLength(11);
    }
    const source = more.querySelector(".source")!;
    expect(source.textContent).toBe("sim");
    expect(source.getAttribute("title")).toBe(SOURCES.sim.title);
    const minutes = (hero.runs.factual.frames * hero.dt) / 60;
    expect(more.textContent).toContain("A scan is a quick look away from the ball");
    // A hero moment is seconds long: its scans are counted, not turned into a rate.
    expect(more.textContent).toContain(
      `Scans counted from the scan events of this run (${(minutes * 60).toFixed(1)} seconds of play).`,
    );
    const h8 = more.querySelector('[data-player="H8"]')!;
    const scans = hero.runs.factual.scans.filter((s) => s.player === "H8").length;
    expect(h8.querySelector(".lineup-rate")!.textContent).toBe(`${scans} scans`);
    expect(h8.classList.contains("lineup-hero")).toBe(true);
    click(toggle);
    expect(more.hidden).toBe(true);
    expect(intro.get().open).toBe(true);
  });

  it("chooses the first hero and applies another option to the POV player at once", () => {
    const session = twoHeroes();
    const page = mount(session);
    click(button(page, "Teams and more"));
    const first = button(page, "J. Ferriday · CM Hero of possession 2");
    const other = button(page, "T. Mardelius · CB Hero of possession 3");
    expect(first.getAttribute("aria-pressed")).toBe("true");
    click(other);
    expect(session.playback.get().povPlayer).toBe("A5");
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(other.getAttribute("aria-pressed")).toBe("true");
    expect(intro.get().open).toBe(true);
  });

  it("Just watch closes with the chosen eyes and no tour; the full tour is there too", () => {
    const session = offline();
    const page = mount(session);
    session.controls.setPovPlayer("A5");
    click(button(page, "Teams and more"));
    expect(button(page, "Full tour · 90 s")).not.toBeNull();
    click(button(page, "Just watch"));
    expect(session.playback.get().povPlayer).toBe("H8");
    expect(intro.get().open).toBe(false);
    expect(tour.get().open).toBe(false);
  });

  it("works on a stitched match, and stays closed across session remounts on the page", () => {
    const page = mount(offline());
    click(button(page, "Start"));
    const session = createMatchSession(parseHero(matchExport()), { api: null, dataUrl: "/data/" });
    expect(dialogOf(mount(session))).toBeNull();
    act(() => intro.set({ open: true }));
    const matchPage = mount(session);
    click(button(matchPage, "Teams and more"));
    expect(button(matchPage, "J. Ferriday · CM Hero of possession 2")).not.toBeNull();
  });
});
