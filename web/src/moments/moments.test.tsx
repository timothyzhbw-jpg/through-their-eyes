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
const rail = (el: ParentNode) => el.querySelector<HTMLElement>(".moment-rail");
const labels = (el: ParentNode) =>
  [...(rail(el)?.querySelectorAll("a") ?? [])].map((a) => a.textContent);

describe("the moment rail", () => {
  it("names every moment and the full match above the live screen, this one marked", () => {
    const page = mount(offline());
    expect(labels(page)).toEqual([
      "The look",
      "Under pressure",
      "The corner",
      "The goal",
      "Full match · live",
      "Academy drill",
    ]);
    expect(rail(page)!.querySelector("a.drill-link")!.getAttribute("href")).toBe("/?play=drill");
    const current = rail(page)!.querySelector('a[aria-current="page"]');
    expect(current?.textContent).toBe("The look");
    // Before the stage, outside it: trailer shots cropped to the stage do not change.
    expect(rail(page)!.nextElementSibling?.classList.contains("stage")).toBe(true);
  });

  it("keeps its place hidden while the intro card is up", () => {
    intro.set({ open: true });
    const page = mount(offline());
    expect(rail(page)!.classList.contains("hidden")).toBe(true);
    expect(rail(page)!.getAttribute("aria-hidden")).toBe("true");
    act(() => intro.set({ open: false }));
    expect(rail(page)!.classList.contains("hidden")).toBe(false);
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
    expect(rail(page)).toBeNull();
  });

  it("stays off Your call, which has its own way back", () => {
    const session = offline();
    const page = mount(session);
    act(() => yourCallOf(session).open());
    expect(rail(page)).toBeNull();
  });

  it("marks the match on the match page, and the moment inside it", () => {
    const match = createMatchSession(parseHero(matchExport()), {
      api: createApi(API, MATCH, fakeFetch({})),
      dataUrl: "/data/",
      socket: fakeSockets(),
    });
    const page = mount(match, <MatchApp session={match} autoplay={false} />);
    expect(rail(page)!.querySelector('a[aria-current="page"]')?.textContent).toBe(
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

  it("keeps the header to Your call, More, sound and who is watching", () => {
    const page = mount(offline());
    const end = page.querySelector(".stage-head .header-end")!;
    // The buttons on the row itself (a menu's own items are inside its panel).
    expect(names(end, ":scope > button, :scope > .popover-wrap > button")).toEqual([
      "Your call",
      "More",
      "Sound",
      "Watching as Casual fan · English",
    ]);
    expect(end.querySelector(".your-view")).toBeNull(); // one audience menu: the viewer's
    // His looks, Take his eyes and the tour wait in More, mounted and hidden.
    const more = end.querySelector<HTMLElement>(".more-panel")!;
    expect(more.hidden).toBe(true);
    expect(more.querySelector("#scan-steps-open")).not.toBeNull();
    expect(more.querySelector("#take-eyes-open")).not.toBeNull();
    expect(names(more)).toContain("Quick tour");
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

  it("the hero page's Live pill opens the full match's stream", () => {
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
