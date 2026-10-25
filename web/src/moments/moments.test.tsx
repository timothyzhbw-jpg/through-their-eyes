// @vitest-environment happy-dom
// The moment links (SPEC 7): the moment picker in the header's Settings names every moment the
// site plays and the full match, marks the one on screen, waits under the intro card, and stays off
// Your call; `moment=` opens a match's hero moment; the hero page's Live pill opens the match. The
// hero page's shell: the brand, the three doors and Settings; door 1's one action.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { App, MatchApp } from "../App";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { DeepLinkContext, parseDeepLink } from "../deeplink";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type ViewSession } from "../session";
import { API, fakeFetch, fakeSockets, MATCH, matchExport, pressureExport } from "../testing";
import { intro } from "../ui/intro";
import { LiveBar } from "../ui/Live";
import { settingsMenu } from "../ui/Stage";
import { yourCallOf } from "../yourcall/controller";
import {
  currentMoment,
  DRILL_LINK,
  FULL_MATCH_LIVE,
  IN_MATCH_MOMENTS,
  MOMENT_LINKS,
} from "./moments";

vi.mock("../views/PovView", () => ({ PovView: () => <canvas /> }));
vi.mock("../views/TacticalView", () => ({ TacticalView: () => <canvas /> }));
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
const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  intro.set({ open: false });
});

function mount(session: ViewSession, node: ReactNode = <App autoplay={false} />): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);
const settings = (el: ParentNode) => el.querySelector<HTMLElement>(".stage-head .settings");
const picker = (el: ParentNode) =>
  settings(el)?.querySelector<HTMLElement>('[role=group][aria-label="Moment"] nav') ?? null;
const labels = (el: ParentNode) =>
  [...(picker(el)?.querySelectorAll("a") ?? [])].map((a) => a.textContent);

describe("the moment picker, in Settings", () => {
  afterEach(() => act(() => settingsMenu.set({ open: false })));

  it("names every moment and the full match, this one marked", () => {
    const page = mount(offline());
    const toggle = settings(page)!.querySelector<HTMLButtonElement>("#settings")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panel = settings(page)!.querySelector<HTMLElement>(".more-panel")!;
    expect(panel.hidden).toBe(true);
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(labels(page)).toEqual([
      "The look",
      "Under pressure",
      "The corner",
      "The goal",
      "Full match · live",
    ]);
    // The drill is a Your turn mode, not a moment.
    expect(page.querySelector('a[href="/?play=drill"]')).toBeNull();
    const current = picker(page)!.querySelector('a[aria-current="page"]');
    expect(current?.textContent).toBe("The look");
    // No rail above the stage: the live screen is the first thing on the page.
    expect(page.querySelector(".app")!.firstElementChild!.classList.contains("stage")).toBe(true);
  });

  it("closes on Escape, focus back on Settings", () => {
    const page = mount(offline());
    const toggle = settings(page)!.querySelector<HTMLButtonElement>("#settings")!;
    act(() => toggle.click());
    const link = picker(page)!.querySelector<HTMLAnchorElement>("a")!;
    link.focus();
    act(() => {
      link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("waits behind the intro card", () => {
    intro.set({ open: true });
    const page = mount(offline());
    expect(settings(page)!.closest("[inert]")).not.toBeNull();
    act(() => intro.set({ open: false }));
    expect(settings(page)!.closest("[inert]")).toBeNull();
  });

  it("rail=0 (the demo video's framing) leaves the door tabs out, Settings stays", () => {
    const link = parseDeepLink("?intro=0&rail=0");
    expect(link.rail).toBe(false);
    expect(parseDeepLink("").rail).toBe(true);
    const page = mount(
      offline(),
      <DeepLinkContext.Provider value={link}>
        <App autoplay={false} />
      </DeepLinkContext.Provider>,
    );
    expect(page.querySelector(".door-tabs")).toBeNull();
    expect(settings(page)).not.toBeNull();
  });

  it("stays off Your call, which has its own way back", () => {
    const session = offline();
    const page = mount(session);
    act(() => yourCallOf(session).open());
    expect(settings(page)).toBeNull();
    act(() => yourCallOf(session).close());
  });

  it("marks the match on the match page, and the moment inside it", () => {
    const match = createMatchSession(parseHero(matchExport()), {
      api: createApi(API, MATCH, fakeFetch({})),
      dataUrl: "/data/",
      socket: fakeSockets(),
    });
    const page = mount(match, <MatchApp session={match} autoplay={false} />);
    expect(picker(page)!.querySelector('a[aria-current="page"]')?.textContent).toBe(
      "Full match · live",
    );
    // The match is no door: its door tabs open the hero moment's doors.
    expect(
      [...page.querySelectorAll<HTMLAnchorElement>(".door-tabs a")].map((a) => a.href),
    ).toEqual(
      ["/?door=look", "/?door=turn", "/?door=studios"].map((p) => new URL(p, location.href).href),
    );
    expect(currentMoment(createSession(parseHero(pressureExport()), null, null))).toBe("pressure");
  });
});

describe("the hero page's shell (SPEC 7)", () => {
  const names = (el: ParentNode | null, selector = "button, a") =>
    [...(el?.querySelectorAll<HTMLElement>(selector) ?? [])].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent?.replace(/\s+/g, " ").trim(),
    );

  it("keeps the header to the brand, the three doors and Settings; no Live pill on a moment", () => {
    const page = mount(offline());
    const head = page.querySelector(".stage-head")!;
    // The controls on the row itself (a menu's own items are inside its panel).
    const row =
      ":scope > div > button, :scope > div > .popover-wrap > button, :scope > div > a, :scope > nav button, :scope > nav a";
    expect(names(head, row)).toEqual(["The look", "Your turn", "For studios", "Settings"]);
    const current = head.querySelector('.door-tabs [aria-current="page"]');
    expect(current?.textContent).toBe("The look");
    expect(head.querySelector(".live-chip, .live")).toBeNull();
    expect(head.querySelector("#your-call-open, .moments-menu")).toBeNull();
    // The moment, who is watching, who to follow, sound, View options and the full tour wait in
    // Settings, mounted and hidden; no mode opens from it.
    const more = head.querySelector<HTMLElement>(".more-panel")!;
    expect(more.hidden).toBe(true);
    const sections = [...more.querySelectorAll(":scope > [role=group]")].map((g) =>
      g.getAttribute("aria-label"),
    );
    expect(sections).toEqual(["Moment", "Commentary", "Follow", "Sound", "Tour"]);
    const sound = more.querySelector<HTMLButtonElement>("button.sound")!;
    expect(sound.getAttribute("aria-label")).toBe("Sound");
    expect(sound.getAttribute("aria-pressed")).toBe("false");
    expect(names(more)).toContain("Watching as Casual fan · English");
    expect(names(more)).toContain("Your view");
    expect(names(more)).toContain("Full tour · 90 s");
    expect(names(more)).toContain("View options");
    expect(more.querySelector("#scan-steps-open, #take-eyes-open, #drill-open")).toBeNull();
  });

  it("keeps the first screen to a few controls: one switch over the picture, one action", () => {
    const page = mount(offline());
    const stage = page.querySelector(".stage")!;
    // Over the picture: only the run switch (no director's banner, no data chips by default).
    expect(stage.querySelector(".stage-director, .director-chip, .stat-chip")).toBeNull();
    expect(names(stage.querySelector(".stage-top"), "button, a, select")).toEqual([]);
    expect(stage.querySelectorAll(".stage-run [role=group]")).toHaveLength(1);
    // The bar: play, the timeline with its two marks, the camera switch; no View options.
    const bar = stage.querySelector(".transport")!;
    expect(names(bar, ":scope > button")).toEqual(["Play"]);
    expect(bar.querySelector('input[aria-label="Timeline"]')).not.toBeNull();
    expect(names(bar.querySelector(".marks"))).toEqual(["Key scan", "Decision"]);
    expect(bar.querySelector('[role=group][aria-label="Camera"]')).not.toBeNull();
    expect(names(bar)).not.toContain("View options");
    // The card: its title, one line and one button.
    const card = stage.querySelector(".moment-card")!;
    expect(names(card)).toHaveLength(1);
    expect(names(card)[0]).toMatch(/breakdown$/i);
    expect(card.querySelectorAll("p.card-body")).toHaveLength(1);
  });

  it("keeps the floodlight background below the live picture", () => {
    const page = mount(offline());
    expect(page.querySelector(".moment > .floodlight-background")).not.toBeNull();
    expect(page.querySelector(".stage .floodlight-background")).toBeNull();
    expect(page.querySelector(".stage canvas")?.closest(".floodlight-background")).toBeNull();
    expect(page.querySelectorAll("#moment-title .scroll-word").length).toBeGreaterThan(1);
    expect(page.querySelector(".stage .scroll-word")).toBeNull();
  });

  it("keeps the compare and the evidence under the picture, not the introduction", () => {
    const page = mount(offline());
    // The story's button and the chapters that introduced the moment are the landing page's.
    expect(page.querySelector(".moment-cta")).toBeNull();
    expect(page.querySelector("details.ways-in")).toBeNull();
    expect(page.querySelectorAll("main.moment .btn-primary")).toHaveLength(0);
    expect(page.querySelector(".story, .decision, .verdict")).toBeNull();
    // The compare, with the scan story one link away.
    const compare = page.querySelector(".moment > .journey-event")!;
    expect(compare.querySelector("#scan-steps-story")?.textContent).toBe("Step through his looks");
    // Narration → What if, then the data, folded. The crew's breakdown (and its failure drill) is
    // For studios' commentary.
    const below = page.querySelector(".below")!;
    const last = below.lastElementChild as HTMLDetailsElement;
    expect(last.matches("details.match-data")).toBe(true);
    expect(last.open).toBe(false);
    expect(last.querySelector("summary")!.textContent).toBe("Match data for this moment");
    expect(below.firstElementChild!.matches(".narration")).toBe(true);
    expect(page.querySelector(".breakdown")).toBeNull();
  });
});

describe("the links", () => {
  it("open the in-match moments by their scenario, as spots", () => {
    expect(IN_MATCH_MOMENTS).toEqual(["corner_blind_side", "far_post_finish"]);
    const link = parseDeepLink("?match=match-1&moment=far_post_finish");
    expect(link.moment).toBe("far_post_finish");
    expect(link).toMatchObject({ intro: false, autoplay: false });
    const bad = parseDeepLink("?match=match-1&moment=nope");
    expect(bad.moment).toBeNull();
    expect(bad.warnings).toEqual(["moment=nope"]);
  });

  it("every one says what it opens with no number", () => {
    for (const m of [...MOMENT_LINKS, DRILL_LINK])
      expect(`${m.label} ${m.title}`).not.toMatch(/\d/);
  });

  it("the Live control on a hero session opens the full match's stream", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fakeFetch({})),
      socket: fakeSockets(),
    });
    const page = mount(session, <LiveBar />);
    const pill = page.querySelector<HTMLAnchorElement>("a.live-chip")!;
    expect(pill.getAttribute("href")).toBe(FULL_MATCH_LIVE);
    expect(FULL_MATCH_LIVE).toBe("/?match=match-1&intro=0");
    expect(pill.textContent).toBe("Live");
  });
});
