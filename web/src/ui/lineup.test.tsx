// @vitest-environment happy-dom
// The opening card shares the hero and stitched-match view context, with keyboard access and
// scanning habits read directly from the factual export. It shows the pitch, counts itself down,
// and closes on its own, on a click that is not a button, or on most keys.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type ViewSession } from "../session";
import { matchExport } from "../testing";
import { intro } from "./intro";
import { LineupCard } from "./LineupCard";

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(session: ViewSession): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <LineupCard />
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

describe("the pre-match line-up", () => {
  it("names its modal, lists both teams and labels the run's scan counts as sim data", () => {
    const page = mount(offline());
    const dialog = page.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(title?.textContent).toBe("Home v Away");
    expect(title?.querySelector("em")?.textContent).toBe("v");
    expect(dialog.textContent).toContain("A synthetic match · every player fictional");
    for (const team of ["Home", "Away"]) {
      expect(dialog.querySelectorAll(`ol[aria-label="${team} line-up"] > li`)).toHaveLength(11);
    }
    const source = dialog.querySelector(".source")!;
    expect(source.textContent).toBe("sim");
    expect(source.getAttribute("title")).toBe("Read from the sim export, not a verified claim");
    const minutes = (hero.runs.factual.frames * hero.dt) / 60;
    // A judge who never heard the word reads what a scan is before the numbers.
    expect(dialog.textContent).toContain("A scan is a quick look away from the ball");
    // A hero moment is seconds long: its scans are counted, not turned into a rate.
    expect(dialog.textContent).toContain(
      `Scans counted from the scan events of this run (${(minutes * 60).toFixed(1)} seconds of play).`,
    );
    expect(
      [...dialog.querySelectorAll(".lineup-team-head > span")].map((s) => s.textContent),
    ).toEqual(["Scans", "Scans"]);
    const h8 = dialog.querySelector('[data-player="H8"]')!;
    const scans = hero.runs.factual.scans.filter((s) => s.player === "H8").length;
    const shown = h8.querySelector(".lineup-rate")!;
    expect(shown.textContent).toBe(`${scans} scans`);
    expect(shown.textContent).not.toContain((scans / minutes).toFixed(1));
    expect(h8.classList.contains("lineup-hero")).toBe(true);
    expect(document.activeElement).toBe(button(page, "Start watching"));
  });

  it("chooses the first hero and applies another option to the POV player immediately", () => {
    const exported = matchExport();
    exported.match.possessions[2].hero = "A5";
    const session = createMatchSession(parseHero(exported), { api: null, dataUrl: "/data/" });
    const page = mount(session);
    const first = button(page, "H8 · CM Hero of possession 2");
    const other = button(page, "A5 · CB Hero of possession 3");
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(other.getAttribute("aria-pressed")).toBe("false");
    click(other);
    expect(session.playback.get().povPlayer).toBe("A5");
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(other.getAttribute("aria-pressed")).toBe("true");
    expect(intro.get().open).toBe(true);
  });

  it("applies the chosen eyes again and dismisses with one Start watching click", () => {
    const session = offline();
    const page = mount(session);
    expect(button(page, "H8 · CM The hero of this moment").getAttribute("aria-pressed")).toBe(
      "true",
    );
    session.controls.setPovPlayer("A5");
    click(button(page, "Start watching"));
    expect(session.playback.get().povPlayer).toBe("H8");
    expect(intro.get().open).toBe(false);
    expect(page.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses with one Skip click without applying the default eyes", () => {
    const session = offline();
    session.controls.setPovPlayer("A5");
    const page = mount(session);
    click(button(page, "Skip"));
    expect(session.playback.get().povPlayer).toBe("A5");
    expect(intro.get().open).toBe(false);
    expect(page.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses with Escape", () => {
    const page = mount(offline());
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(intro.get().open).toBe(false);
    expect(page.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps Tab inside the card and restores page scrolling when dismissed", () => {
    const overflow = document.body.style.overflow;
    const page = mount(offline());
    const first = page.querySelector<HTMLButtonElement>("button")!;
    const skip = button(page, "Skip");
    act(() => {
      skip.focus();
      skip.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(first);
    act(() =>
      first.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(skip);
    expect(document.body.style.overflow).toBe("hidden");
    click(skip);
    expect(document.body.style.overflow).toBe(overflow);
  });

  it("renders in a stitched match session without needing a hero-only session", () => {
    const session = createMatchSession(parseHero(matchExport()), { api: null, dataUrl: "/data/" });
    const page = mount(session);
    expect(page.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button(page, "H8 · CM Hero of possession 2")).not.toBeNull();
  });

  it("stays dismissed across session remounts on the same page", () => {
    const page = mount(offline());
    click(button(page, "Skip"));
    const session = createMatchSession(parseHero(matchExport()), { api: null, dataUrl: "/data/" });
    const matchPage = mount(session);
    expect(matchPage.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the one-line pitch", () => {
    const page = mount(offline());
    expect(page.querySelector(".lineup-pitch")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      PITCH,
    );
  });

  it("closes by itself about 5 s after it opens", async () => {
    vi.useFakeTimers();
    const page = mount(offline());
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(intro.get().open).toBe(true);
    expect(page.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(intro.get().open).toBe(false);
    expect(page.querySelector('[role="dialog"]')).toBeNull();
    const { INTRO_MS } = (await import("./LineupCard")) as { INTRO_MS?: number };
    expect(INTRO_MS).toBe(5000);
  });

  it("tells a screen reader that it closes by itself and that Tab keeps it open", () => {
    const page = mount(offline());
    const dialog = page.querySelector<HTMLElement>('[role="dialog"]')!;
    const note = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(note?.textContent).toMatch(/closes by itself/);
    expect(note?.textContent).toMatch(/Tab/);
    expect(note?.classList.contains("sr-only")).toBe(true); // the countdown line shows it
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(intro.get().open).toBe(true);
    expect(dialog.hasAttribute("aria-describedby")).toBe(false); // it no longer closes by itself
  });

  it("closes on a click anywhere that is not a button", () => {
    const page = mount(offline());
    click(page.querySelector<HTMLElement>("h2")!);
    expect(intro.get().open).toBe(false);
    expect(page.querySelector('[role="dialog"]')).toBeNull();

    act(() => intro.set({ open: true }));
    click(page.querySelector<HTMLElement>(".lineup-card")!);
    expect(intro.get().open).toBe(false);
    expect(page.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes on any key except Tab, Enter, Space and the bare modifiers", () => {
    const page = mount(offline());
    const press = (key: string) =>
      act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    // Space is the " " key. Shift, Control, Alt and Meta are the bare modifier keys.
    for (const [name, key] of [
      ["Tab", "Tab"],
      ["Enter", "Enter"],
      ["Space", " "],
      ["Shift", "Shift"],
      ["Control", "Control"],
      ["Alt", "Alt"],
      ["Meta", "Meta"],
    ] as const) {
      press(key);
      expect(intro.get().open, name).toBe(true);
      expect(page.querySelector('[role="dialog"]'), name).not.toBeNull();
    }
    press("a");
    expect(intro.get().open).toBe(false);
    expect(page.querySelector('[role="dialog"]')).toBeNull();
  });

  it("stays open long after an option is picked", () => {
    vi.useFakeTimers();
    const page = mount(twoHeroes());
    click(button(page, "A5 · CB Hero of possession 3"));
    expect(intro.get().open).toBe(true);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(intro.get().open).toBe(true);
    expect(page.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("shows a countdown line while it runs and removes it after a pick", () => {
    const page = mount(twoHeroes());
    expect(page.querySelector(".lineup-countdown")).not.toBeNull();
    click(button(page, "A5 · CB Hero of possession 3"));
    expect(intro.get().open).toBe(true);
    expect(page.querySelector(".lineup-countdown")).toBeNull();
  });

  it("omits the countdown when motion is reduced", () => {
    const matchMedia = vi.fn((query: string) => {
      return {
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as MediaQueryList;
    });
    vi.stubGlobal("matchMedia", matchMedia);
    const page = mount(offline());
    expect(page.querySelector('[role="dialog"]')).not.toBeNull();
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(page.querySelector(".lineup-countdown")).toBeNull();
  });
});
