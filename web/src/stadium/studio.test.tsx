// @vitest-environment happy-dom
// The studio page with the Screen wall alone (no WebGL): the five screens, the timeline, the demo
// data label; and its loader reads the bundled files only.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import hero from "../../public/data/hero_seed3.json";
import steps from "../../public/data/steps_seed3.json";
import without from "../../public/data/without_look_seed3.json";
import goalWithout from "../../public/data/without_look_far_post_finish_seed11.json";
import { SCREEN_IDS } from "./formats";
import { MIN_GAP_MS, programme } from "./rules";
import { createShow, createSurfaces, type ShowDeps } from "./show";
import { DEMO_DATA, loadStudio, STUDIO_FILES, StudioApp } from "./StudioApp";
import { facts } from "./testing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function clock() {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const deps: ShowDeps = {
    now: () => now,
    later: (fn, ms) => {
      const t = { at: now + ms, fn };
      timers.push(t);
      return t;
    },
    cancel: (t) => timers.splice(timers.indexOf(t as (typeof timers)[number]), 1),
    reducedMotion: () => true,
  };
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  return { deps, advance };
}

function mount() {
  const time = clock();
  const show = createShow(programme(facts()), createSurfaces(), time.deps);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<StudioApp show={show} wallOnly />));
  return { host, show, time };
}

const labelOf = (host: HTMLElement, id: string) =>
  host.querySelector(`[data-screen="${id}"] .wall-canvas`)!.getAttribute("aria-label");

describe("the studio page", () => {
  it("shows every screen on the wall, each with its own canvas, and no 3D canvas", () => {
    const { host, show } = mount();
    for (const id of SCREEN_IDS) {
      const cell = host.querySelector(`[data-screen="${id}"] .wall-canvas`)!;
      expect(cell.querySelector("canvas")).toBe(show.surfaces[id].canvas);
    }
    expect(host.querySelectorAll("canvas")).toHaveLength(SCREEN_IDS.length);
    expect(labelOf(host, "main")).toBe(
      "Walk-out (walking out): Joss Ferriday, number 8, Kestrel Bay",
    );
  });

  it("labels what is not a match fact as demo data", () => {
    const { host } = mount();
    expect(host.textContent).toContain(DEMO_DATA);
    expect(DEMO_DATA).toBe("Demo data: simulated audience, not real results");
  });

  it("changes the screens from the timeline, one change per gap", () => {
    const { host, time } = mount();
    const goal = [...host.querySelectorAll<HTMLButtonElement>(".studio-event")].find((b) =>
      b.textContent?.startsWith("Goal"),
    )!;
    act(() => goal.click());
    expect(goal.getAttribute("aria-current")).toBe("step");
    // The first event went up at mount: the goal waits for the gap.
    expect(labelOf(host, "main")).toMatch(/^Walk-out/);
    act(() => time.advance(MIN_GAP_MS));
    expect(labelOf(host, "main")).toBe(
      "Stat card, goal, N. Varnhall: N. Varnhall looked over his left shoulder 0.4 s before the ball reached him.",
    );
    expect(labelOf(host, "tunnel")).toBe("Walk-out (goal): Nico Varnhall, number 9, Kestrel Bay");
  });
});

describe("loadStudio", () => {
  it("reads only the bundled files", async () => {
    const files: Record<string, unknown> = {
      [STUDIO_FILES.hero]: hero,
      [STUDIO_FILES.steps]: steps,
      [STUDIO_FILES.without]: without,
      [STUDIO_FILES.goalWithout]: goalWithout,
    };
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      const name = url.replace("/data/", "");
      return new Response(JSON.stringify(files[name]), { status: name in files ? 200 : 404 });
    }) as typeof fetch;
    const show = await loadStudio("/data/", fetchImpl);
    expect(urls.sort()).toEqual(
      Object.keys(files)
        .map((f) => `/data/${f}`)
        .sort(),
    );
    expect(show.events.map((e) => e.type)).toEqual([
      "walk-out",
      "key-look",
      "press-win",
      "corner",
      "goal",
      "half-time",
    ]);
    show.dispose();
  });
});
