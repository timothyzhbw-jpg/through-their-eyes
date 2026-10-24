// @vitest-environment happy-dom
// The moment links (SPEC 7): the rail above the live screen names every moment the site plays and
// the full match, marks the one on screen, keeps its place hidden under the intro card, and stays
// off Your call; `moment=` opens a match's hero moment; the hero page's Live pill opens the match.

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
const menu = (el: ParentNode) => el.querySelector<HTMLElement>(".stage-head .moments-menu");
const labels = (el: ParentNode) =>
  [...(menu(el)?.querySelectorAll("a") ?? [])].map((a) => a.textContent);

describe("the Moments menu", () => {
  it("names every moment and the full match in the header, this one marked", () => {
    const page = mount(offline());
    const toggle = menu(page)!.querySelector<HTMLButtonElement>(":scope > button")!;
    expect(toggle.textContent).toBe("Moments");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panel = menu(page)!.querySelector<HTMLElement>(".moments-panel")!;
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
      "Academy drill",
    ]);
    expect(menu(page)!.querySelector("a.drill-link")!.getAttribute("href")).toBe("/?play=drill");
    const current = menu(page)!.querySelector('a[aria-current="page"]');
    expect(current?.textContent).toBe("The look");
    // No rail above the stage: the live screen is the first thing on the page.
    expect(page.querySelector(".app")!.firstElementChild!.classList.contains("stage")).toBe(true);
  });

  it("closes on Escape, focus back on its button", () => {
    const page = mount(offline());
    const toggle = menu(page)!.querySelector<HTMLButtonElement>(":scope > button")!;
    act(() => toggle.click());
    const link = menu(page)!.querySelector<HTMLAnchorElement>("a")!;
    link.focus();
    act(() => {
      link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("waits behind the intro card, which carries the same links", () => {
    intro.set({ open: true });
    const page = mount(offline());
    expect(menu(page)!.closest("[inert]")).not.toBeNull();
    act(() => intro.set({ open: false }));
    expect(menu(page)!.closest("[inert]")).toBeNull();
  });

  it("is left out with rail=0 (the demo video's framing)", () => {
    const link = parseDeepLink("?intro=0&rail=0");
    expect(link.rail).toBe(false);
    expect(parseDeepLink("").rail).toBe(true);
    const page = mount(
      offline(),
      <DeepLinkContext.Provider value={link}>
        <App autoplay={false} />
      </DeepLinkContext.Provider>,
    );
    expect(menu(page)).toBeNull();
  });

  it("stays off Your call, which has its own way back", () => {
    const session = offline();
    const page = mount(session);
    act(() => yourCallOf(session).open());
    expect(page.querySelector(".moments-menu")).toBeNull();
  });

  it("marks the match on the match page, and the moment inside it", () => {
    const match = createMatchSession(parseHero(matchExport()), {
      api: createApi(API, MATCH, fakeFetch({})),
      dataUrl: "/data/",
      socket: fakeSockets(),
    });
    const page = mount(match, <MatchApp session={match} autoplay={false} />);
    expect(menu(page)!.querySelector('a[aria-current="page"]')?.textContent).toBe(
      "Full match · live",
    );
    expect(currentMoment(createSession(parseHero(pressureExport()), null, null))).toBe("pressure");
  });
});

describe("the hero page's shell (SPEC 7)", () => {
  const names = (el: ParentNode | null, selector = "button, a") =>
    [...(el?.querySelectorAll<HTMLElement>(selector) ?? [])].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent?.replace(/\s+/g, " ").trim(),
    );

  it("keeps the header to the brand, Moments, Your call and ⋯; no Live pill on a moment", () => {
    const page = mount(offline());
    const head = page.querySelector(".stage-head")!;
    // The buttons on the row itself (a menu's own items are inside its panel).
    const row = ":scope > div > button, :scope > div > .popover-wrap > button, :scope > div > a";
    expect(names(head, row)).toEqual(["Moments", "Your call", "More"]);
    expect(head.querySelector(".live-chip, .live")).toBeNull();
    expect(head.querySelector(".your-view")).toBeNull(); // one audience menu: the viewer's
    // Sound, who is watching, His looks, Take his eyes, the tour and View options wait in ⋯,
    // mounted and hidden.
    const more = head.querySelector<HTMLElement>(".more-panel")!;
    expect(more.hidden).toBe(true);
    const sound = more.querySelector<HTMLButtonElement>("button.sound")!;
    expect(sound.getAttribute("aria-label")).toBe("Sound");
    expect(sound.getAttribute("aria-pressed")).toBe("false");
    expect(names(more)).toContain("Watching as Casual fan · English");
    expect(more.querySelector("#scan-steps-open")).not.toBeNull();
    expect(more.querySelector("#take-eyes-open")).not.toBeNull();
    expect(names(more)).toContain("Quick tour");
    expect(names(more)).toContain("View options");
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

  it("tells the story with two actions, the other ways in folded, and the match data last", () => {
    const page = mount(offline());
    const cta = page.querySelector(".moment-cta")!;
    expect(names(cta, ":scope > button")).toEqual(["Watch it through his eyes", "Make his call"]);
    expect(cta.querySelectorAll(".btn-primary")).toHaveLength(1);
    const ways = cta.querySelector<HTMLDetailsElement>("details.ways-in")!;
    expect(ways.open).toBe(false);
    expect(ways.querySelector("#scan-steps-story")).not.toBeNull();
    expect(ways.querySelector("#take-eyes-story")).not.toBeNull();
    expect(names(ways, "button")).toContain("Full tour · 90 s");
    // Story → Decision → Verdict → Narration → What if → Breakdown, then the data, folded.
    const below = page.querySelector(".below")!;
    const last = below.lastElementChild as HTMLDetailsElement;
    expect(last.matches("details.match-data")).toBe(true);
    expect(last.open).toBe(false);
    expect(last.querySelector("summary")!.textContent).toBe("Match data for this moment");
    expect(below.firstElementChild!.matches(".story")).toBe(true);
    // The moment's own chapters stay open above it (the full tour's failure drill among them).
    expect(last.querySelector(".story, .decision, .verdict, .breakdown")).toBeNull();
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
