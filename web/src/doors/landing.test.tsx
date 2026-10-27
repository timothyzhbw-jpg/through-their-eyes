// @vitest-environment happy-dom
// The landing page (SPEC 7, Landing.tsx): its address, the promise and its one primary button
// (door 1's story), the three doors with every feature a link that opens it as its deep link does,
// the loop of the live app beside the promise (a still under reduced motion), the evidence strip
// read from hero_gates.json, the brand that comes back to it, and the picture that waits behind it.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import extraJson from "../../public/data/extra_looks_seed3.json";
import gatesJson from "../../public/data/hero_gates.json";
import { App } from "../App";
import { parseHero } from "../data/hero";
import { loadData, matchFromUrl } from "../data/load";
import { applyDeepLink, doorOf, parseDeepLink } from "../deeplink";
import { journey } from "../journey/state";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { API, fakeFetch, health, json, PRESS_MOMENT, pressureExport, settle } from "../testing";
import { stepThroughOf } from "../steps/controller";
import { closeTour, tour } from "../tour/tourState";
import { extraLooksOf, parseExtraLooks } from "../without/extra";
import { heroGatesOf } from "../without/gates";
import { yourCallOf } from "../yourcall/controller";
import { parseDoor } from "./doors";
import { HOME_LINKS, HOME_SHOT } from "./Landing";
import { doors } from "./state";
import { readFileSync, statSync } from "node:fs";

const doorsCss = readFileSync("src/doors/doors.css", "utf8"); // vitest runs in web/

vi.mock("../views/PovView", () => ({ PovView: () => <div className="pov-stub" /> }));
vi.mock("../views/TacticalView", () => ({ TacticalView: () => <div className="tac-stub" /> }));
vi.mock("@react-three/fiber", async (original) => ({
  ...(await original<typeof import("@react-three/fiber")>()),
  Canvas: () => <div className="canvas-stub" />,
}));
vi.mock("../session", async (original) => ({
  ...(await original<typeof import("../session")>()),
  startClock: () => () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);
const mounted: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  window.history.replaceState(null, "", "/");
  doors.set({ door: "home", seq: 0 });
});
afterEach(() => {
  closeTour({ restore: false });
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  doors.set({ door: "look", seq: 0 });
  window.history.replaceState(null, "", "/");
});

function mount(session: Session, node: ReactNode = <App autoplay={false} />): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const textOf = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
const linksIn = (page: Element, door: string) =>
  [...page.querySelectorAll<HTMLAnchorElement>(`.home-door-${door} a.home-link`)].map((a) => [
    textOf(a),
    a.getAttribute("href"),
  ]);
const link = (page: Element, name: string) =>
  [...page.querySelectorAll<HTMLAnchorElement>("a.home-link")].find((a) => textOf(a) === name)!;
const click = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

/** A session with the run with two more looks loaded, as main.tsx loads it. */
function withExtra(): Session {
  const session = offline();
  extraLooksOf(session).state.set({
    status: "ready",
    data: parseExtraLooks(extraJson, session.hero, session.moment.id),
    error: null,
  });
  return session;
}

describe("its address", () => {
  it("?door=home opens it, as a spot; ?compare=extra opens the look's compare on two more looks", () => {
    expect(parseDoor("home")).toBe("home");
    const home = parseDeepLink("?door=home");
    expect(home).toMatchObject({ door: "home", intro: false, autoplay: false, warnings: [] });
    expect(doorOf(home).door).toBe("home");
    const extra = parseDeepLink("?compare=extra");
    expect(extra).toMatchObject({ compare: "extra", intro: false, autoplay: false });
    expect(doorOf(extra).door).toBe("look");
    expect(parseDeepLink("?compare=more").warnings).toEqual(["compare=more"]);
  });
});

describe("the landing page", () => {
  it("states the promise with one primary button, and no door is marked current", () => {
    const page = mount(offline());
    expect(page.querySelector('section.stage[aria-label="Live screen"]')).toBeNull();
    const home = page.querySelector("section.door-home")!;
    expect(textOf(home.querySelector("h2#home-title"))).toBe(
      "One scan over his shoulder changed his pass.",
    );
    const primary = home.querySelectorAll(".btn-primary");
    expect(primary).toHaveLength(1);
    expect(textOf(primary[0])).toBe("Watch the look (60 s)");
    expect(page.querySelectorAll(".btn-primary")).toHaveLength(1);
    expect(page.querySelector(".door-tabs [aria-current=page]")).toBeNull();
    expect(page.querySelector(".brand-link")?.getAttribute("aria-current")).toBe("page");
  });

  it("lists the three doors, each with its features as links to their addresses", () => {
    const page = mount(withExtra());
    expect([...page.querySelectorAll(".home-door h3")].map(textOf)).toEqual([
      "The look",
      "Your turn",
      "For studios",
    ]);
    expect(linksIn(page, "look")).toEqual([
      ["The story", "/?tour=quick"],
      ["Step through his looks", "/?play=steps"],
      ["With two more scans", "/?compare=extra"],
    ]);
    expect(linksIn(page, "turn")).toEqual([
      ["Make his call", "/?play=yourcall"],
      ["See through his eyes", "/?play=eyes"],
      ["Train your scanning", "/?play=drill"],
    ]);
    expect(linksIn(page, "studios")).toEqual([
      ["A · Tactical Broadcast", "/?door=studios&step=broadcast"],
      ["B · Personalised Commentary", "/?door=studios&step=commentary"],
      ["C · Automated Highlights", "/?door=studios&step=highlights"],
      ["D · Stadium Experience", "/?door=studios&step=stadium"],
      ["Value", "/?door=studios&step=value"],
    ]);
    // Each door's copy is two or three lines, not a chapter.
    for (const p of page.querySelectorAll(".home-door-line")) {
      expect(textOf(p)!.split(/(?<=[.;:]) /).length).toBeLessThanOrEqual(4);
    }
    // Every address the page links is one the deep links understand.
    for (const search of Object.values(HOME_LINKS).filter((v) => typeof v === "string")) {
      expect(parseDeepLink(search as string).warnings).toEqual([]);
    }
  });

  it("leaves out the run with two more looks until its lines are loaded", () => {
    const page = mount(offline());
    expect(linksIn(page, "look").map(([name]) => name)).toEqual([
      "The story",
      "Step through his looks",
    ]);
  });

  it("puts the held-out count from hero_gates.json and the Verifier in one strip", async () => {
    const session = offline();
    const fetch = fakeFetch({ "GET /data/hero_gates.json": () => json(gatesJson) });
    await heroGatesOf(session, fetch, "/data/").load();
    const page = mount(session);
    const gate = gatesJson.heroes.blind_side_run;
    const strip = page.querySelector(".home-evidence")!;
    expect(textOf(strip.querySelector("b"))).toBe(`${gate.changed}/${gate.n}`);
    expect(strip.querySelector(".source")?.getAttribute("title")).toBe(
      `Eval result from ${gate.report}`,
    );
    expect(textOf(strip)).toContain("checked in code by the Verifier");
    expect(textOf(page.querySelector(".home-demo .demo-badge"))).toMatch(/^Demo data/);
  });

  it("starts door 1's story from its primary button", () => {
    const page = mount(offline());
    const primary = page.querySelector<HTMLButtonElement>(".door-home .btn-primary")!;
    primary.focus();
    act(() => primary.click());
    expect(doors.get().door).toBe("look");
    expect(tour.get()).toMatchObject({ open: true, kind: "quick" });
    expect(page.querySelector('section.stage[aria-label="Live screen"]')).not.toBeNull();
    // Its button is gone with the page: closing the story gives the keyboard to the header.
    expect(primary.isConnected).toBe(false);
    act(() => closeTour());
    expect(document.activeElement).toBe(page.querySelector(".stage-head h1"));
  });
});

describe("the product beside the promise", () => {
  const motion = (reduce: boolean) =>
    vi
      .spyOn(window, "matchMedia")
      .mockImplementation(
        (query: string) =>
          ({ matches: reduce && query.includes("reduce"), media: query }) as MediaQueryList,
      );
  afterEach(() => vi.restoreAllMocks());

  it("loops the live app muted, from files the build ships", () => {
    motion(false);
    const page = mount(offline());
    const video = page.querySelector<HTMLVideoElement>(".door-home .home-hero video")!;
    expect(video.getAttribute("src")).toBe(HOME_SHOT.video);
    expect(video.getAttribute("poster")).toBe(HOME_SHOT.poster);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("muted")).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.getAttribute("aria-hidden")).toBe("true");
    for (const path of [HOME_SHOT.video, HOME_SHOT.poster]) {
      expect(statSync(`public${path}`).size, path).toBeGreaterThan(10_000); // vitest runs in web/
    }
    expect(textOf(page.querySelector(".home-shot-link"))).toBe(
      "Live app · his eyes at the key scan",
    );
  });

  it("stays a still under reduced motion", () => {
    motion(true);
    const page = mount(offline());
    const video = page.querySelector<HTMLVideoElement>(".home-shot video")!;
    expect(video.autoplay).toBe(false);
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.getAttribute("poster")).toBe(HOME_SHOT.poster);
  });

  it("opens the same story as the primary button, and leaves a modified click to the browser", () => {
    motion(false);
    const page = mount(offline());
    const shot = page.querySelector<HTMLAnchorElement>("a.home-shot-link")!;
    expect(shot.getAttribute("href")).toBe("/?tour=quick");
    expect(shot.getAttribute("aria-label")).toBe(
      "Watch the look (60 s): the live app through his eyes",
    );
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    act(() => {
      shot.dispatchEvent(modified);
    });
    expect(modified.defaultPrevented).toBe(false);
    expect(doors.get().door).toBe("home");
    click(shot);
    expect(doors.get().door).toBe("look");
    expect(tour.get()).toMatchObject({ open: true, kind: "quick" });
  });
});

describe("its links", () => {
  it("open a mode over Your turn, as ?play= does", () => {
    const session = offline();
    const page = mount(session);
    click(link(page, "Make his call"));
    expect(doors.get().door).toBe("turn");
    expect(window.location.search).toBe("?door=turn");
    expect(yourCallOf(session).state.get().step).not.toBe("closed");
  });

  it("keep the current scenario and settings for every feature, by click and copied address", async () => {
    window.history.replaceState(
      null,
      "",
      "/?match=press_escape-0&persona=coach&lang=zh&view=tactical&tour=quick&door=home&step=value",
    );
    const session = createSession(parseHero(pressureExport()), null, null, null, {
      momentId: PRESS_MOMENT,
    });
    const stepsFetch = fakeFetch({});
    const currentSteps = stepThroughOf(session, stepsFetch, "/data/");
    const page = mount(session);
    for (const a of page.querySelectorAll<HTMLAnchorElement>("a.home-link")) {
      const params = new URL(a.href).searchParams;
      expect(params.get("match"), textOf(a)).toBe("press_escape-0");
      expect(params.get("persona"), textOf(a)).toBe("coach");
      expect(params.get("lang"), textOf(a)).toBe("zh");
      expect(params.get("view"), textOf(a)).toBe("tactical");
      expect(params.get("tour"), textOf(a)).toBeNull();
      expect(params.get("door"), textOf(a)).not.toBe("home");
      if (params.get("door") !== "studios") expect(params.get("step"), textOf(a)).toBeNull();
    }
    const steps = link(page, "Step through his looks");
    const copied = new URL(steps.href).search;
    click(steps);
    expect(doors.get().door).toBe("look");
    expect(currentSteps.state.get().open).toBe(true);
    expect(currentSteps.session.hero.scenario).toBe("press_escape");
    expect(page.querySelector(".ss-screen")).not.toBeNull();
    await act(settle);

    // A new tab loads the copied address through the same match selector as main.tsx.
    const fetch = fakeFetch({
      "GET /health": health,
      "GET /api/matches/press_escape-0/export": () => json(pressureExport()),
      "GET /api/matches/press_escape-0": () =>
        json({ id: "press_escape-0", hero_moment: PRESS_MOMENT, hero_moments: [PRESS_MOMENT] }),
      "GET /data/hero_seed3.json": () => json(raw),
    });
    const loaded = await loadData({
      apiBase: API,
      match: matchFromUrl(copied),
      dataUrl: "/data/",
      fetch,
    });
    const newTab = createSession(loaded.hero, null, null, null, {
      api: loaded.api,
      momentId: loaded.momentId,
    });
    const copiedSteps = stepThroughOf(newTab, stepsFetch, "/data/");
    applyDeepLink(newTab, parseDeepLink(copied));
    expect(copiedSteps.state.get().open).toBe(true);
    expect(copiedSteps.session.hero.scenario).toBe(session.hero.scenario);
    expect(copiedSteps.session.hero.seed).toBe(session.hero.seed);
    expect(copiedSteps.session.moment.id).toBe(session.moment.id);
    expect(newTab.breakdown.get()).toMatchObject({ persona: "coach", language: "zh" });
  });

  it("open a studios' section, the address saying so", () => {
    const page = mount(offline());
    click(link(page, "B · Personalised Commentary"));
    expect(doors.get().door).toBe("studios");
    expect(journey.get().step).toBe("commentary");
    expect(window.location.search).toBe("?door=studios&step=commentary");
  });

  it("open the look's compare on the run with two more looks", () => {
    const session = withExtra();
    const page = mount(session);
    click(link(page, "With two more scans"));
    expect(doors.get().door).toBe("look");
    expect(extraLooksOf(session).compare.get().value).toBe("extra");
  });

  it("leave a modified click to the browser: a new tab on the address", () => {
    const page = mount(offline());
    const a = link(page, "Value");
    // After the app's handler: note whether it kept the browser's default, then stop the test's
    // DOM from loading the address.
    let kept = false;
    page.addEventListener("click", (e) => {
      kept = !e.defaultPrevented;
      e.preventDefault();
    });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    act(() => {
      a.dispatchEvent(event);
    });
    expect(kept).toBe(true);
    expect(doors.get().door).toBe("home");
  });
});

describe("the brand", () => {
  it("comes back to the landing page from any door, the keyboard on its heading", () => {
    doors.set({ door: "look", seq: 0 });
    const page = mount(offline());
    expect(page.querySelector(".door-home")).toBeNull();
    click(page.querySelector<HTMLAnchorElement>(".stage-head .brand-link")!);
    expect(doors.get().door).toBe("home");
    expect(window.location.search).toBe("?door=home");
    expect(page.querySelector("section.door-home")).not.toBeNull();
  });
});

describe("the picture behind it", () => {
  it("waits on the landing page, and plays when the viewer opens The look", () => {
    const session = offline();
    const autoplay = vi.spyOn(session.controls, "autoplay").mockImplementation(() => {});
    const page = mount(session, <App autoplay />);
    expect(autoplay).not.toHaveBeenCalled();
    const look = [...page.querySelectorAll<HTMLButtonElement>(".door-tabs button")].find(
      (b) => textOf(b) === "The look",
    )!;
    act(() => look.click());
    expect(autoplay).toHaveBeenCalledTimes(1);
  });

  it("stays still when a link opens a mode instead", async () => {
    const session = offline();
    stepThroughOf(session, fakeFetch({}), "/data/");
    const autoplay = vi.spyOn(session.controls, "autoplay").mockImplementation(() => {});
    const page = mount(session, <App autoplay />);
    click(link(page, "Step through his looks"));
    expect(doors.get().door).toBe("look");
    expect(autoplay).not.toHaveBeenCalled();
    await act(settle);
  });
});

describe("its targets", () => {
  it("are 24 px or larger, by their CSS", () => {
    for (const sel of [".home-link", ".brand-link"]) {
      const rule = doorsCss.match(new RegExp(`\\${sel} \\{([^}]*)\\}`))![1];
      expect(Number(rule.match(/min-height:\s*(\d+)px/)![1]), sel).toBeGreaterThanOrEqual(24);
    }
  });
});
