// @vitest-environment happy-dom
// The judge tour on the page (SPEC 7): every step finds what it points at on the hero moment and
// does what it says with the app's own controls; Next, Back, Skip and Escape; it starts from its
// buttons; closing it at any step leaves the app usable; keyboard and reduced motion.
// The 3D views are left out (no WebGL here).

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { App, MatchApp } from "../App";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { BACK_NOTE } from "../producer/producer";
import { createMatchSession } from "../match/matchSession";
import { createSession, SessionContext, type ViewSession } from "../session";
import {
  API,
  breakdownResponse,
  crewTrace,
  fakeFetch,
  fakeSockets,
  MATCH,
  matchExport,
  json,
  settle,
  telestratorDownTrace,
  verifyResponse,
} from "../testing";
import { intro } from "../ui/intro";
import { LineupCard } from "../ui/LineupCard";
import { yourCallOf } from "../yourcall/controller";
import { resolveSteps, envOf, targetOf, STEPS } from "./steps";
import { recapFixture } from "../recap/fixture";
import { closeTour, startTour, tour } from "./tourState";

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
const DRILL_KEY = "7e1c0b9d2f6a4e8b9c3d5f7a1b2c4d6e";

const mounted: { root: Root; container: HTMLElement }[] = [];
beforeEach(() => {
  // happy-dom has no layout: scrolling is a no-op that the tests can watch.
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as typeof window.scrollTo;
});
afterEach(() => {
  act(() => closeTour());
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  intro.set({ open: false });
  vi.restoreAllMocks();
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

function online() {
  const fetch = fakeFetch({
    "POST /api/breakdowns": (body) => {
      const b = body as { fail?: string[]; personas: string[]; languages: string[] };
      const voice = { persona: b.personas[0], language: b.languages[0] };
      if (!b.fail) return json(breakdownResponse({}, voice));
      return json(
        breakdownResponse(
          { cached: false },
          {
            key: DRILL_KEY,
            ...voice,
            trace: telestratorDownTrace(),
            plan_source: "template",
            drill: { down: b.fail, pending: b.fail },
          },
        ),
      );
    },
    [`POST /api/breakdowns/${DRILL_KEY}/bring-back`]: () =>
      json(
        breakdownResponse(
          { cached: false },
          {
            key: DRILL_KEY,
            persona: "casual",
            language: "zh",
            trace: crewTrace({}, { telestrator: { notes: [BACK_NOTE] } }),
            drill: { down: [], pending: [] },
          },
        ),
      ),
    "POST /api/verify": (body) => json(verifyResponse((body as { value: number }).value)),
  });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
    api: createApi(API, "blind_side_run-3", fetch),
  });
  return { session, fetch };
}

const textOf = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
const card = () => document.querySelector<HTMLElement>(".tour-card");
const buttonIn = (root: ParentNode | null, name: string) =>
  [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => textOf(b) === name || b.getAttribute("aria-label") === name,
  );
const click = async (b: HTMLButtonElement | undefined) => {
  expect(b, "button").toBeDefined();
  await act(async () => {
    b!.click();
    await settle();
  });
};
const next = () => click(buttonIn(card(), "Next"));
const stepId = () => document.querySelector<HTMLElement>(".tour")?.dataset.step;
const press = (key: string, el: Element = document.activeElement ?? document.body) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

async function start(at: string | null = null) {
  await act(async () => {
    startTour(at);
    await settle();
  });
}

describe("every step resolves on the hero moment", () => {
  it("offline: the replay, the run switch, the evidence and Your call, then the end", async () => {
    const session = offline();
    mount(session);
    await start();
    const seen: string[] = [];
    for (;;) {
      const id = stepId()!;
      seen.push(id);
      const step = STEPS.find((s) => s.id === id)!;
      expect(textOf(card()), id).toContain(`of ${resolveSteps(envOf(session)).length}`);
      if (step.target !== null) expect(targetOf(step), id).not.toBeNull();
      if (id === "end") break;
      await next();
    }
    expect(seen).toEqual(["pov", "without", "evidence", "yourcall", "end"]);
  });

  it("each step does what it says with the app's own controls", async () => {
    const session = offline();
    const play = vi.spyOn(session.controls, "playBreakdown");
    mount(session);
    await start();
    expect(play).toHaveBeenCalledOnce();

    await next(); // without the look
    expect(session.playback.get().mode).toBe("counterfactual");
    expect(session.playback.get().playing).toBe(true);
    expect(session.playback.get().cfGhost).toBe(true);
    expect(textOf(card())).toContain("Without the look");

    await next(); // the evidence: a line with a number, opened at its evidence frame
    expect(session.playback.get().evidenceLine).toBe("L2");
    expect(document.querySelector("section.evidence")).not.toBeNull();

    await next(); // Your call
    expect(yourCallOf(session).state.get().step).not.toBe("closed");
    expect(document.querySelector(".yc-view")).not.toBeNull();

    await next(); // the end: Your call is closed again, the live screen is back
    expect(yourCallOf(session).state.get().step).toBe("closed");
    expect(document.querySelector(".stage-run")).not.toBeNull();
  });

  it("online: the wrong number, the language and the failure drill go to the service", async () => {
    const { session, fetch } = online();
    mount(session);
    await start("tamper");
    expect(stepId()).toBe("tamper");
    // The Analyst's breakdown (the one with numbers) was asked for, and its first line with a
    // number opened.
    const first = fetch.calls.find((c) => c.path === "/api/breakdowns")!;
    expect(first.body).toMatchObject({ personas: ["analyst"], languages: ["en"] });
    expect(session.playback.get().evidenceLine).toBe("L2");
    expect(session.tamper.get().open).toBe("cf_value");
    expect(targetOf(STEPS.find((s) => s.id === "tamper")!)).not.toBeNull();
    // The check is the viewer's: nothing is sent until the card's button is pressed.
    expect(fetch.calls.some((c) => c.path === "/api/verify")).toBe(false);
    await click(buttonIn(card(), "Check a wrong number"));
    const verify = fetch.calls.find((c) => c.path === "/api/verify")!;
    // The number the evidence card's own field holds: wrong on purpose (tamper.ts wrongNumber).
    expect(verify.body).toMatchObject({ claim: "cf_value", slot: "dxt", value: 0.17 });
    expect(textOf(document.querySelector(".tamper-result"))).toContain("Refuted");

    await next(); // Your call
    await next(); // another audience in another language: a casual fan, in Chinese, at once
    expect(stepId()).toBe("language");
    expect(session.breakdown.get()).toMatchObject({ persona: "casual", language: "zh" });
    const asked = fetch.calls.filter((c) => c.path === "/api/breakdowns").at(-1)!;
    expect(asked.body).toMatchObject({ personas: ["casual"], languages: ["zh"] });
    expect(textOf(document.querySelector(".viewer-toggle"))).toContain("Casual fan · 中文");
    await click(buttonIn(card(), "Turn the sound on"));
    expect(session.voice.state.get().on).toBe(true);
    expect(buttonIn(card(), "Turn the sound off")).toBeDefined();

    await next(); // the Producer: the Telestrator is picked, nothing runs until asked
    expect(stepId()).toBe("producer");
    expect(session.producer.get().down).toEqual(["telestrator"]);
    expect(fetch.calls.some((c) => (c.body as { fail?: unknown })?.fail)).toBe(false);
    await click(buttonIn(card(), "Run the drill"));
    expect(fetch.calls.at(-1)!.body).toMatchObject({ fail: ["telestrator"] });
    await click(buttonIn(card(), "Bring it back"));
    expect(fetch.calls.at(-1)!.path).toBe(`/api/breakdowns/${DRILL_KEY}/bring-back`);
    expect(textOf(document.querySelector("section.producer"))).toContain("From checkpoint");
  });

  it("online, the replay plays the Analyst's commentary: the one whose numbers are verified", async () => {
    const { session, fetch } = online();
    mount(session);
    await start();
    const asked = fetch.calls.filter((c) => c.path === "/api/breakdowns");
    expect(asked.map((c) => c.body)).toEqual([
      expect.objectContaining({ personas: ["analyst"], languages: ["en"] }),
    ]);
    expect(session.breakdown.get()).toMatchObject({ persona: "analyst", status: "ready" });
    expect(session.runner.status.get().status).toBe("running");
  });

  it("started from the moment card while the stream is live, before the moment, it can still switch runs", async () => {
    const fetch = fakeFetch({
      "POST /api/breakdowns": (body) => {
        const b = body as { personas: string[]; languages: string[] };
        return json(breakdownResponse({}, { persona: b.personas[0], language: b.languages[0] }));
      },
    });
    const sockets = fakeSockets();
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
      api: createApi(API, "blind_side_run-3", fetch),
      socket: sockets,
    });
    const container = mount(session);
    act(() => session.controls.startLive());
    expect(session.playback.get().live).toBe(true);
    // The run switch is locked until the stream detects the moment (it has not).
    session.controls.setMode("counterfactual");
    expect(session.playback.get().mode).toBe("factual");
    await click(buttonIn(container.querySelector(".moment-card"), "Take the 90-second tour"));
    expect(session.playback.get().live).toBe(false); // the tour's replay leaves the stream
    await next();
    expect(stepId()).toBe("without");
    expect(session.playback.get().mode).toBe("counterfactual");
  });

  it("shows the service's refusal of a drill in the card", async () => {
    const { session, fetch } = online();
    fetch.calls.length = 0;
    mount(session);
    await start("producer");
    vi.spyOn(session.api!, "breakdown").mockRejectedValue(
      new Error("rate_limited: try again in a few minutes"),
    );
    await click(buttonIn(card(), "Run the drill"));
    expect(textOf(card()!.querySelector(".tour-note.error"))).toBe(
      "rate_limited: try again in a few minutes",
    );
    expect(buttonIn(card(), "Run the drill")).toBeDefined(); // the pick stays: try again later
  });

  it("entering a step twice does not undo it (the Producer's pick stays picked)", async () => {
    const { session } = online();
    mount(session);
    await start("producer");
    expect(session.producer.get().down).toEqual(["telestrator"]);
    await click(buttonIn(card(), "Back"));
    await next();
    expect(session.producer.get().down).toEqual(["telestrator"]);
  });
});

describe("moving and leaving", () => {
  it("Back returns to the previous step and sets it up again", async () => {
    const session = offline();
    mount(session);
    await start("yourcall");
    expect(yourCallOf(session).state.get().step).not.toBe("closed");
    await click(buttonIn(card(), "Back"));
    expect(stepId()).toBe("evidence");
    expect(yourCallOf(session).state.get().step).toBe("closed");
    expect(session.playback.get().evidenceLine).toBe("L2");
  });

  it("Skip and Escape close it at any step, and the app stays usable", async () => {
    for (const how of ["skip", "escape"] as const) {
      for (const id of ["pov", "without", "evidence", "yourcall", "end"]) {
        const session = offline();
        const container = mount(session);
        await start(id);
        expect(stepId()).toBe(id);
        if (how === "skip") await click(buttonIn(card(), id === "end" ? "Done" : "Skip tour"));
        else press("Escape", card()!);
        expect(tour.get().open, `${how} at ${id}`).toBe(false);
        expect(document.querySelector(".tour")).toBeNull();
        expect(container.querySelectorAll("[inert]")).toHaveLength(0);
        // Whatever the step left on screen still works: Your call's own way back, the run switch.
        if (id === "yourcall") {
          await click(buttonIn(container, "Back to the replay"));
          expect(yourCallOf(session).state.get().step).toBe("closed");
        }
        await click(buttonIn(container.querySelector(".stage-run"), "With the look"));
        expect(session.playback.get().mode).toBe("factual");
        act(() => mounted.pop()!.root.unmount());
        container.remove();
      }
    }
  });

  it("the end offers to start again", async () => {
    mount(offline());
    await start("end");
    await click(buttonIn(card(), "Start again"));
    expect(stepId()).toBe("pov");
  });
});

describe("on a phone", () => {
  const phone = () =>
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 375,
      height: 812,
    });
  afterEach(() =>
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 1024,
      height: 768,
    }),
  );

  it("folds into a bar when the viewer touches the app, and opens again on the next step", async () => {
    phone();
    const container = mount(offline());
    await start("yourcall");
    expect(card()!.classList.contains("folded")).toBe(false);
    await act(async () => {
      container
        .querySelector(".yc-view")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await settle();
    });
    expect(card()!.classList.contains("folded")).toBe(true);
    expect(document.getElementById("tour-caption")!.hidden).toBe(true);
    expect(buttonIn(card(), "Back")).toBeUndefined();
    // Touching the card itself keeps it as it is; Show opens it.
    await click(buttonIn(card(), "Show"));
    expect(card()!.classList.contains("folded")).toBe(false);
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await settle();
    });
    await next();
    expect(stepId()).toBe("end");
    expect(card()!.classList.contains("folded")).toBe(false);
  });

  it("stays whole on a desktop", async () => {
    const container = mount(offline());
    await start("yourcall");
    await act(async () => {
      container
        .querySelector(".yc-view")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await settle();
    });
    expect(card()!.classList.contains("folded")).toBe(false);
  });
});

describe("a stitched match", () => {
  const match = () =>
    createMatchSession(parseHero(matchExport()), {
      api: createApi(
        API,
        MATCH,
        fakeFetch({ "POST /api/recaps": () => json(recapFixture(matchExport())) }),
      ),
      dataUrl: "/data/",
      socket: fakeSockets(),
    });

  it("the hero page's last feature step opens the match at its recap, and the tour goes on there", async () => {
    const { session } = online();
    mount(session);
    await start("match");
    expect(stepId()).toBe("match");
    const link = [...card()!.querySelectorAll("a")].find(
      (a) => textOf(a) === "Open the match recap",
    )!;
    const url = new URL(link.getAttribute("href")!, "https://site.test/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      match: "match-1",
      play: "recap",
      tour: "recap",
    });
  });

  it("on the match page, rings the full-time recap card, then ends", async () => {
    const m = match();
    const container = mount(m, <MatchApp session={m} autoplay={false} />);
    await start("recap");
    expect(stepId()).toBe("recap");
    expect(m.recap.state.get()).toMatchObject({ fullTime: true, status: "ready" });
    expect(targetOf(STEPS.find((s) => s.id === "recap")!)).toBe(
      container.querySelector(".recap-card.full-time"),
    );
    expect(textOf(card())).toContain("of 2");
    await next();
    expect(stepId()).toBe("end");
    expect(textOf(card())).toContain("Every moment of the match is listed below the picture.");
  });

  it("offers no tour on its lineup card: the tour's steps are a hero moment's", () => {
    intro.set({ open: true });
    const m = match();
    const container = mount(m, <MatchApp session={m} autoplay={false} />);
    expect(buttonIn(container, "Start watching")).toBeDefined();
    expect(buttonIn(container, "Take the 90-second tour")).toBeUndefined();
  });

  it("runs inside one of its breakdowns, and closes back on the match", async () => {
    const m = match();
    mount(m, <MatchApp session={m} autoplay={false} />);
    act(() => m.screen.set({ hero: offline() }));
    await start();
    expect(stepId()).toBe("pov");
    await act(async () => {
      m.controls.backToMatch();
      await settle();
    });
    expect(tour.get().open).toBe(false);
    expect(document.querySelector(".tour")).toBeNull();
    // A tour started again in a breakdown opens there: the closed one does not shut it.
    act(() => m.screen.set({ hero: offline() }));
    await start();
    expect(stepId()).toBe("pov");
  });
});

describe("keyboard and motion", () => {
  it("moves focus to the card; arrow keys step through it", async () => {
    mount(offline());
    await start();
    expect(card()!.contains(document.activeElement)).toBe(true);
    expect(textOf(document.activeElement)).toBe("Next");
    press("ArrowRight");
    await act(settle);
    expect(stepId()).toBe("without");
    press("ArrowLeft");
    await act(settle);
    expect(stepId()).toBe("pov");
  });

  it("leaves the keyboard with Your call on its step, and takes it back after", async () => {
    const container = mount(offline());
    await start("yourcall");
    expect(card()!.contains(document.activeElement)).toBe(false);
    expect(container.querySelector(".yc-view")).not.toBeNull();
    await next();
    // Closing Your call hands its pill the focus; the tour's card takes it after that.
    expect(textOf(document.activeElement)).toBe("Done");
  });

  it("is a labelled, non-modal dialog whose caption is announced", async () => {
    mount(offline());
    await start();
    const c = card()!;
    expect(c.getAttribute("role")).toBe("dialog");
    expect(c.getAttribute("aria-modal")).toBe("false");
    expect(document.getElementById(c.getAttribute("aria-labelledby")!)?.textContent).toBe(
      "Through his eyes",
    );
    expect(c.querySelector("[aria-live=polite]")).not.toBeNull();
  });

  it("respects reduced motion: no animated ring, no smooth scrolling", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q }) as MediaQueryList,
    );
    // Everything sits below the fold, so the step scrolls its target into view.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 2000, width: 300, height: 100 }),
    );
    mount(offline());
    await start("evidence");
    expect(document.querySelector(".tour")!.classList.contains("reduced")).toBe(true);
    const scroll = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    expect(scroll).toHaveBeenCalled();
    for (const [arg] of scroll.mock.calls) expect(arg).toMatchObject({ behavior: "auto" });
  });
});

describe("starting it", () => {
  it("from the story's button", async () => {
    const container = mount(offline());
    await click(buttonIn(container.querySelector(".moment-cta"), "Take the 90-second tour"));
    expect(stepId()).toBe("pov");
  });

  it("from the moment card on the live screen", async () => {
    const container = mount(offline());
    await click(buttonIn(container.querySelector(".moment-card"), "Take the 90-second tour"));
    expect(stepId()).toBe("pov");
  });

  it("from the lineup card, which closes", async () => {
    intro.set({ open: true });
    const container = mount(offline(), <LineupCard />);
    await click(buttonIn(container, "Take the 90-second tour"));
    expect(intro.get().open).toBe(false);
    expect(tour.get()).toMatchObject({ open: true });
  });

  it("not at all while closed: nothing of it is on the page", () => {
    const container = mount(offline());
    expect(container.querySelector(".tour")).toBeNull();
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
