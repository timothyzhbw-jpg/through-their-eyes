// @vitest-environment happy-dom
// The judge tour on the page (SPEC 7): every step finds what it points at on the hero moment and
// does what it says with the app's own controls; Next, Back, Skip and Escape; it starts from its
// buttons; closing it at any step leaves the app usable; keyboard and reduced motion.
// The 3D views are left out (no WebGL here); Take his eyes gets its look grid from the bundle.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import lookJson from "../../public/data/look_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import withoutJson from "../../public/data/without_look_seed3.json";
import { App, MatchApp } from "../App";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { BACK_NOTE } from "../producer/producer";
import { createMatchSession } from "../match/matchSession";
import { createSession, SessionContext, type Session, type ViewSession } from "../session";
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
import { takeEyesOf, type Fetch } from "../takeeyes/controller";
import { intro } from "../ui/intro";
import { IntroCard } from "../ui/IntroCard";
import { withoutLookOf } from "../without/without";
import { yourCallOf } from "../yourcall/controller";
import { wrongNumber } from "../tamper/tamper";
import { tourClaim } from "./actions";
import { resolveSteps, envOf, targetOf, QUICK_STEPS, STEPS } from "./steps";
import { recapFixture } from "../recap/fixture";
import { closeTour, startTour, tour } from "./tourState";
import { doors } from "../doors/state";
import { stepThroughOf } from "../steps/controller";

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
  doors.set({ door: "look", seq: 0 });
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

// Take his eyes fetches its look grid (a static file) on first open: here, the bundled one.
const looksServed: Fetch = async (url) => ({
  ok: url.endsWith("look_seed3.json"),
  json: async () => lookJson,
});
const withLooks = (session: Session) => {
  takeEyesOf(session, looksServed, "/data/");
  return session;
};
const eyesOf = (session: Session) => takeEyesOf(session).state.get().step;

const offline = () => withLooks(createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson));

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
  const session = withLooks(
    createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
      api: createApi(API, "blind_side_run-3", fetch),
    }),
  );
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

describe("the quick tour", () => {
  const quick = () =>
    act(async () => {
      startTour(null, "quick");
      await settle();
    });

  it("walks door 1's story on the app's own controls, every target found, to the end card", async () => {
    const session = offline();
    mount(session);
    await quick();
    expect(stepId()).toBe("look");
    expect(document.querySelector(".tour")?.getAttribute("data-kind")).toBe("quick");
    expect(textOf(card())).toMatch(/^The look · 1 of 4\s*Watch the look/);
    // The look in his eyes, slowed around the scan, pausing a little after his decision.
    const look = session.playback.get();
    expect(look).toMatchObject({
      mode: "factual",
      playing: true,
      autoSlow: true,
      camera: "pov",
      povPlayer: hero.heroId,
      live: false,
    });
    expect(look.frame).toBeLessThan(hero.keyScan!.start);
    expect(look.playUntil).toBeGreaterThan(session.moment.decisionFrame);
    expect(targetOf(QUICK_STEPS[0])).not.toBeNull();

    // "Watch it again" puts the look back at its start.
    act(() => session.playback.set({ frame: look.playUntil!, playing: false }));
    await click(buttonIn(card(), "Watch it again"));
    expect(session.playback.get()).toMatchObject({ frame: look.frame, playing: true });

    await next(); // remove it
    expect(stepId()).toBe("remove");
    expect(session.playback.get()).toMatchObject({ mode: "counterfactual", cfGhost: true });
    expect(session.playback.get().playing).toBe(true);
    expect(targetOf(QUICK_STEPS[1])).not.toBeNull();

    await next(); // compare: the board, both passes arrived, the other run as a ghost
    expect(stepId()).toBe("compare");
    const compare = session.playback.get();
    expect(compare).toMatchObject({ mode: "factual", focus: "tactical", cfGhost: true });
    const { factual, counterfactual } = hero.runs;
    expect(compare.frame).toBeGreaterThanOrEqual(
      Math.min(factual.action!.end!, counterfactual.action!.end!),
    );
    // The scan story, one secondary link away (not in the header).
    const link = buttonIn(card(), "Step through his looks")!;
    expect(link.classList.contains("btn-quiet")).toBe(true);

    await next(); // the end card (offline there is no check to run)
    expect(stepId()).toBe("next");
    expect(textOf(card())).toContain("The look · 4 of 4");
    expect(yourCallOf(session).state.get().step).toBe("closed");
    // Exactly three choices: the other two doors and the look again; nothing else to press.
    const shown = [...card()!.querySelectorAll<HTMLButtonElement>("button")].filter(
      (b) => !b.closest("[hidden]"),
    );
    expect(shown.map(textOf)).toEqual(["Your turn", "For studios", "Watch again"]);
    expect(card()!.querySelectorAll(".btn-primary")).toHaveLength(1);
    expect(document.activeElement).toBe(shown[0]);

    // Watch again: the story from its first step.
    await click(buttonIn(card(), "Watch again"));
    expect(tour.get()).toMatchObject({ open: true, kind: "quick" });
    expect(stepId()).toBe("look");
  });

  it("ends on the doors: Your turn and For studios open theirs, the keyboard on its heading", async () => {
    for (const [name, door, title] of [
      ["Your turn", "turn", "turn-title"],
      ["For studios", "studios", "studios-title"],
    ] as const) {
      const session = offline();
      const container = mount(session);
      await act(async () => {
        startTour("next", "quick");
        await settle();
      });
      await click(buttonIn(card(), name));
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      });
      expect(tour.get().open, name).toBe(false);
      expect(doors.get().door, name).toBe(door);
      expect(new URLSearchParams(window.location.search).get("door"), name).toBe(door);
      expect(container.querySelector(`#${title}`), name).not.toBeNull();
      expect(document.activeElement?.id, name).toBe(title);
      expect(container.querySelector(".door-tabs [aria-current=page]")?.textContent).toBe(name);
      act(() => mounted.pop()!.root.unmount());
      container.remove();
      act(() => doors.set({ door: "look", seq: 0 }));
    }
    window.history.replaceState(null, "", "/");
  });

  it("leaves for the scan story from the compare step and comes back to it, on the link", async () => {
    const session = offline();
    const container = mount(session);
    await act(async () => {
      startTour("compare", "quick");
      await settle();
    });
    await click(buttonIn(card(), "Step through his looks"));
    expect(tour.get().open).toBe(false);
    expect(stepThroughOf(session).state.get().open).toBe(true);
    expect(container.querySelector(".ss-screen")).not.toBeNull();
    await click(buttonIn(container, "Back to the replay"));
    await act(settle);
    expect(tour.get()).toMatchObject({ open: true, kind: "quick" });
    expect(stepId()).toBe("compare");
    expect(document.activeElement?.id).toBe("tour-scan-steps");
  });

  it("is the one panel: the moment card, the HUD row and the caption stand down", async () => {
    const session = offline();
    const container = mount(session);
    expect(container.querySelector(".moment-card")).not.toBeNull();
    await quick();
    const stage = container.querySelector(".stage")!;
    expect(stage.classList.contains("touring")).toBe(true);
    expect(stage.classList.contains("touring-quick")).toBe(true); // CSS hides .stage-top, .stage-caption
    expect(container.querySelector(".moment-card")).toBeNull();
    expect(container.querySelector(".stage-card > .tour-home")).not.toBeNull();
    act(() => closeTour());
    expect(container.querySelector(".moment-card")).not.toBeNull();
    expect(stage.classList.contains("touring")).toBe(false);
  });

  it("carries each step's verified line in its card, the sample marked as such", async () => {
    const session = offline(); // the bundled sample breakdown: not checked by the verifier
    mount(session);
    await quick();
    const lines = () => textOf(card()?.querySelector(".tour-lines"));
    expect(lines()).toContain("J. Ferriday scanned once in the 2 seconds before receiving.");
    expect(lines()).toContain("sample, not checked");
    expect(card()?.querySelector(".tour-lines .num")).toBeNull(); // unchecked: no verified mark
    await next();
    expect(lines()).toContain("Without that look, J. Ferriday would have passed to K. Annersley.");
    await next();
    expect(lines()).toContain("That look was worth");
    await next();
    expect(card()?.querySelector(".tour-lines")).toBeNull(); // Your call's own card tells it
  });

  it("tells the run without the look with its bundled verified lines where the moment has them", async () => {
    const session = offline();
    const served = fakeFetch({ "GET /data/without_look_seed3.json": () => json(withoutJson) });
    await act(() => withoutLookOf(session, served, "/data/").load());
    mount(session);
    await act(async () => {
      startTour("remove", "quick");
      await settle();
    });
    const lines = card()!.querySelector(".tour-lines")!;
    expect(textOf(lines)).toContain("Removed: J. Ferriday's look over his right shoulder");
    expect(textOf(lines)).toContain("would have played it back to K. Annersley");
    expect(lines.querySelector(".num")?.textContent).toBe("0.8 seconds"); // verified: marked
    await next();
    expect(textOf(card()!.querySelector(".tour-lines"))).toContain("xT 0.157");
    expect(buttonIn(card(), "How xT works")).toBeDefined(); // the jargon, on demand
  });

  it("hides the moment card in the full tour too, but keeps the evidence card it points at", async () => {
    const session = offline();
    const container = mount(session);
    await start("evidence");
    expect(container.querySelector(".moment-card")).toBeNull();
    expect(container.querySelector("section.evidence")).not.toBeNull();
    expect(container.querySelector(".stage")!.classList.contains("touring-quick")).toBe(false);
  });

  it("does not open on a stitched match: none of its steps are there", async () => {
    const m = createMatchSession(parseHero(matchExport()), {
      api: createApi(API, MATCH, fakeFetch({})),
      dataUrl: "/data/",
      socket: fakeSockets(),
    });
    mount(m, <MatchApp session={m} autoplay={false} />);
    await quick();
    expect(tour.get().open).toBe(false);
    expect(document.querySelector(".tour")).toBeNull();
  });

  it("types a wrong number and shows the Verifier refusing it, once per arrival", async () => {
    const { session, fetch } = online();
    const container = mount(session);
    await act(async () => {
      startTour("verify", "quick");
      await settle();
    });
    expect(stepId()).toBe("verify");
    expect(document.querySelector("section.evidence")).not.toBeNull();
    const pick = tourClaim(session.breakdown.get().narration);
    expect(pick?.slot).toBeTruthy();
    expect(pick?.value).not.toBeNull();
    const verifies = () => fetch.calls.filter((c) => c.path === "/api/verify");
    expect(verifies()).toHaveLength(1);
    expect(verifies()[0].body).toMatchObject({
      claim: pick!.claim,
      slot: pick!.slot,
      value: wrongNumber(pick!.value!),
    });
    expect(document.querySelector(".tamper-result.held")).not.toBeNull();
    expect(textOf(document.querySelector(".tamper-note.by-tour"))).toBe(
      "The tour typed this wrong value to show the check.",
    );
    expect(textOf(document.querySelector(".tamper-result.held"))).toContain("The tour set");
    expect(textOf(document.querySelector(".tamper-reason"))).toContain("Verifier");
    const stage = container.querySelector(".stage")!;
    expect(stage.querySelector("section.evidence")).not.toBeNull();
    expect(stage.querySelector(".tour-home")).toBeNull();

    // Back closes the evidence card; Next opens it and asks again, and the refusal is back.
    await click(buttonIn(card(), "Back"));
    expect(document.querySelector("section.evidence")).toBeNull();
    await next();
    expect(stepId()).toBe("verify");
    expect(verifies()).toHaveLength(2);
    expect(document.querySelector(".tamper-result.held")).not.toBeNull();
  });
});

describe("every step resolves on the hero moment", () => {
  it("offline: the replay, the run switch, the evidence, Your call and Take his eyes, then the end", async () => {
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
    expect(seen).toEqual(["pov", "without", "evidence", "yourcall", "eyes", "studios", "end"]);
  });

  it("walks the three doors in order: each step opens its own", async () => {
    const session = offline();
    mount(session);
    await start();
    const seen: string[] = [];
    while (stepId() !== "end") {
      const door = doors.get().door;
      if (seen.at(-1) !== door) seen.push(door);
      await next();
    }
    expect(seen).toEqual(["look", "turn", "studios"]);
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

    await next(); // Take his eyes: Your call closed, his own look picked; the look is the viewer's
    expect(yourCallOf(session).state.get().step).toBe("closed");
    expect(eyesOf(session)).toBe("choosing");
    const eyes = STEPS.find((s) => s.id === "eyes")!;
    expect(targetOf(eyes)).toBe(document.querySelector(".te-view"));
    expect(document.querySelector(".te-dial")).not.toBeNull();
    await click(buttonIn(document.querySelector(".te-card"), "Look"));
    expect(eyesOf(session)).toBe("looking");
    expect(stepId()).toBe("eyes");

    await next(); // For studios: Take his eyes is closed again, the studios' first step open
    expect(stepId()).toBe("studios");
    expect(eyesOf(session)).toBe("closed");
    expect(yourCallOf(session).state.get().step).toBe("closed");
    expect(doors.get().door).toBe("studios");
    expect(document.querySelector<HTMLElement>("#journey-panel")?.dataset.step).toBe("broadcast");
    expect(targetOf(STEPS.find((s) => s.id === "studios")!)).not.toBeNull();

    await next(); // the end
    expect(stepId()).toBe("end");
    expect(document.querySelector(".door-tabs")).not.toBeNull(); // the way back to any door
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

    await next(); // another audience in another language: a casual fan, in Chinese, at once
    expect(stepId()).toBe("language");
    expect(session.breakdown.get()).toMatchObject({ persona: "casual", language: "zh" });
    const asked = fetch.calls.filter((c) => c.path === "/api/breakdowns").at(-1)!;
    expect(asked.body).toMatchObject({ personas: ["casual"], languages: ["zh"] });
    // In Settings, which the step opens to point at it.
    const viewer = document.querySelector(".viewer-toggle")!;
    expect(viewer.closest(".more-panel")).not.toBeNull();
    expect(textOf(viewer)).toContain("Casual fan · 中文");
    await click(buttonIn(card(), "Turn the sound on"));
    expect(session.voice.state.get().on).toBe(true);
    expect(buttonIn(card(), "Turn the sound off")).toBeDefined();

    await next(); // Your call
    expect(doors.get().door).toBe("turn");
    const sent = fetch.calls.length;
    await next(); // Take his eyes: its looks are a static file, nothing goes to the service
    expect(stepId()).toBe("eyes");
    expect(eyesOf(session)).toBe("choosing");
    expect(fetch.calls).toHaveLength(sent);

    await next(); // For studios
    expect(stepId()).toBe("studios");
    expect(eyesOf(session)).toBe("closed");
    await next(); // Behind the commentary: the Telestrator is picked, nothing runs until asked
    expect(stepId()).toBe("producer");
    expect(document.querySelector<HTMLElement>("#journey-panel")?.dataset.step).toBe("commentary");
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
    await click(buttonIn(container.querySelector(".moment-cta"), "Watch the look"));
    expect(session.playback.get().live).toBe(false); // the tour's look leaves the stream
    await next();
    expect(stepId()).toBe("remove");
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

  it("Back to Take his eyes opens it again; Back from it closes it for Your call", async () => {
    const session = offline();
    mount(session);
    await start("studios");
    expect(eyesOf(session)).toBe("closed");
    await click(buttonIn(card(), "Back"));
    expect(stepId()).toBe("eyes");
    expect(eyesOf(session)).toBe("choosing");
    expect(targetOf(STEPS.find((s) => s.id === "eyes")!)).not.toBeNull();
    // The viewer's pick stays through a step back and forth.
    act(() => takeEyesOf(session).pick({ frame: 40 }));
    await click(buttonIn(card(), "Back"));
    expect(stepId()).toBe("yourcall");
    expect(eyesOf(session)).toBe("closed");
    expect(yourCallOf(session).state.get().step).not.toBe("closed");
    expect(document.querySelector(".yc-view")).not.toBeNull();
    await next();
    expect(stepId()).toBe("eyes");
    expect(yourCallOf(session).state.get().step).toBe("closed");
    expect(takeEyesOf(session).state.get()).toMatchObject({ step: "choosing", frame: 40 });
  });

  it("Skip and Escape close it at any step, and the app stays usable", async () => {
    for (const how of ["skip", "escape"] as const) {
      for (const id of ["pov", "without", "evidence", "yourcall", "eyes", "studios", "end"]) {
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
        if (id === "eyes") {
          expect(eyesOf(session), `${how} at ${id}`).toBe("choosing");
          await click(buttonIn(container.querySelector(".te-card"), "Back to the replay"));
          expect(eyesOf(session)).toBe("closed");
        }
        // The door the step left is on screen; its tab takes the viewer back to the picture.
        await click(buttonIn(container.querySelector(".door-tabs"), "The look"));
        await click(buttonIn(container.querySelector(".stage-run"), "With the look"));
        expect(session.playback.get().mode).toBe("factual");
        act(() => mounted.pop()!.root.unmount());
        container.remove();
      }
    }
    window.history.replaceState(null, "", "/");
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
    expect(stepId()).toBe("eyes");
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

  it("offers no tour on its intro card: the tour's steps are a hero moment's", () => {
    intro.set({ open: true });
    const m = match();
    const container = mount(m, <MatchApp session={m} autoplay={false} />);
    expect(buttonIn(container, "Watch the match")).toBeDefined();
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

  it("leaves the keyboard with Your call and Take his eyes on their steps, and takes it back after", async () => {
    const container = mount(offline());
    await start("yourcall");
    expect(card()!.contains(document.activeElement)).toBe(false);
    expect(container.querySelector(".yc-view")).not.toBeNull();
    await next();
    // Take his eyes has its own heading focused, not the tour's card.
    expect(stepId()).toBe("eyes");
    expect(card()!.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(container.querySelector("#te-title"));
    await next();
    // Closing Take his eyes hands its card the focus; the tour's card takes it after that.
    expect(stepId()).toBe("studios");
    expect(textOf(document.activeElement)).toBe("Next");
    expect(card()!.contains(document.activeElement)).toBe(true);
  });

  it("leaves the keyboard with Take his eyes on its step: its arrow keys pick, the tour stays", async () => {
    const session = offline();
    const container = mount(session);
    await start("eyes");
    expect(card()!.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(container.querySelector("#te-title"));
    const times = container.querySelector('[role="radiogroup"][aria-label="When he looks"]')!;
    const on = times.querySelector<HTMLElement>('[aria-checked="true"]')!;
    const before = takeEyesOf(session).state.get().frame;
    press("ArrowLeft", on);
    await act(settle);
    expect(takeEyesOf(session).state.get().frame).not.toBe(before);
    expect(stepId()).toBe("eyes");
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

  it("jumps to a target more than a screen and a half away instead of scrolling through the page", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 3 * window.innerHeight, width: 300, height: 100 }),
    );
    mount(offline());
    await start("evidence");
    const scroll = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    expect(scroll).toHaveBeenCalled();
    for (const [arg] of scroll.mock.calls) expect(arg).toMatchObject({ behavior: "instant" });
  });
});

describe("starting it", () => {
  it("door 1's story from its button under the picture", async () => {
    const container = mount(offline());
    await click(buttonIn(container.querySelector(".moment-cta"), "Watch the look"));
    expect(stepId()).toBe("look");
    expect(tour.get().kind).toBe("quick");
  });

  it("the full tour from Settings: the menu closes, and the keyboard goes back to Settings after", async () => {
    const container = mount(offline());
    expect(buttonIn(container.querySelector(".moment-card"), "Full tour · 90 s")).toBeUndefined();
    const settings = container.querySelector<HTMLButtonElement>("#settings")!;
    await click(settings);
    expect(settings.getAttribute("aria-expanded")).toBe("true");
    const full = buttonIn(container.querySelector(".more-panel"), "Full tour · 90 s")!;
    act(() => full.focus());
    await click(full);
    expect(stepId()).toBe("pov");
    expect(tour.get().kind).toBe("full");
    expect(settings.getAttribute("aria-expanded")).toBe("false"); // its card is the one panel
    press("Escape", card()!);
    expect(tour.get().open).toBe(false);
    expect(document.activeElement).toBe(settings);
  });

  it("from the intro card, which closes", async () => {
    intro.set({ open: true });
    const container = mount(offline(), <IntroCard />);
    await click(buttonIn(container, "Watch the look"));
    expect(intro.get().open).toBe(false);
    expect(tour.get()).toMatchObject({ open: true, kind: "quick" });
  });

  it("not at all while closed: nothing of it is on the page", () => {
    const container = mount(offline());
    expect(container.querySelector(".tour")).toBeNull();
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
