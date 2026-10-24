// @vitest-environment happy-dom
// "Your call" (SPEC 7) on the page: the deep link, the option markers (focusable, named, no
// numbers before the choice), keyboard (with its way in from the card) and swipe, every beat of
// the reveal with its verified lines and sim tag, reduced motion, the live breakdown arriving, and
// a hero moment of the stitched match.
// The 3D view is left out (no WebGL here); markers, path and card are DOM.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { HERO_FILE, PAYLOAD_FILE, WHAT_IF_FILE, WHAT_IF_FILES } from "../data/load";
import { App } from "../App";
import { applyDeepLink, parseDeepLink } from "../deeplink";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { doors } from "../doors/state";
import {
  API,
  breakdownResponse,
  exportJson,
  fakeFetch,
  fakeSockets,
  health,
  json,
  MATCH,
  MATCH_HERO,
  MATCH_PRESS,
  matchBreakdown,
  matchExport,
  matchInfo,
  pressureExport,
  render,
  settle,
} from "../testing";
import { MomentsPanel } from "../ui/Live";
import { frameCall, project, swipePick, toWorld } from "./camera";
import { yourCallOf } from "./controller";
import { YourCallButton, YourCallStage } from "./YourCall";
import { SOURCES } from "../provenance/source";
import yourCallCss from "./yourcall.css?raw";

// Mounting App: the live screen's views and Your call's 3D view need WebGL; stub them.
vi.mock("../views/PovView", () => ({ PovView: () => <div className="pov-stub" /> }));
vi.mock("../views/TacticalView", () => ({ TacticalView: () => <div className="tac-stub" /> }));
vi.mock("@react-three/fiber", async (original) => ({
  ...(await original<typeof import("@react-three/fiber")>()),
  Canvas: () => <div className="canvas-stub" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  doors.set({ door: "look", seq: 0 });
  vi.restoreAllMocks();
});

function mount(session: Session, node: ReactNode = <YourCallStage scene={false} />): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const textOf = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
const markers = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>(".yc-marker")];
const button = (el: HTMLElement, name: string) => {
  const b = [...el.querySelectorAll("button")].find((x) => textOf(x) === name);
  if (!b) throw new Error(`no button ${name}: ${textOf(el)}`);
  return b;
};
const click = (b: HTMLElement) => act(() => b.click());
const key = (target: Element, k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

function open(session = offline()) {
  const yc = yourCallOf(session);
  act(() => yc.open());
  return { session, yc };
}

describe("Your call: opening", () => {
  it("the deep link opens it at the decision, paused, with no autoplay", () => {
    const link = parseDeepLink("?play=yourcall");
    expect(link).toMatchObject({ play: "yourcall", autoplay: false, warnings: [] });
    expect(parseDeepLink("?play=karaoke").warnings).toEqual(["play=karaoke"]);
    const session = offline();
    applyDeepLink(session, link);
    expect(yourCallOf(session).state.get().step).toBe("deciding");
    expect(session.playback.get()).toMatchObject({
      frame: session.moment.decisionFrame,
      playing: false,
      mode: "factual",
    });
  });

  it("takes over from a running breakdown and the replay", () => {
    const session = offline();
    session.controls.playBreakdown();
    expect(session.runner.status.get().status).toBe("running");
    open(session);
    expect(session.runner.status.get().status).not.toBe("running");
    expect(session.playback.get().playing).toBe(false);
  });

  it("the header button opens it; without what-ifs it still opens, every other option unsimulated", () => {
    const session = offline();
    const el = mount(session, <YourCallButton />);
    const b = el.querySelector("button")!;
    expect(b.getAttribute("aria-pressed")).toBe("false");
    click(b);
    expect(yourCallOf(session).state.get().step).toBe("deciding");
    const bare = createSession(hero, EXAMPLE_PLAN, payloadJson, null);
    const bareButton = mount(bare, <YourCallButton />).querySelector("button")!;
    expect(bareButton.disabled).toBe(false);
    const { options } = yourCallOf(bare);
    expect(options).toHaveLength(hero.runs.factual.decision!.options.length);
    expect(options.filter((o) => o.run.source !== "none").map((o) => o.action)).toEqual([
      "pass:H9",
    ]);
  });

  it("opens from Your turn's card and gives the focus back to it on close, however it closes", () => {
    act(() => doors.set({ door: "turn", seq: 0 }));
    const session = offline();
    const page = mount(session, <App autoplay={false} />);
    const card = () => page.querySelector<HTMLButtonElement>("#turn-call");
    const pill = () => page.querySelector<HTMLButtonElement>("#your-call-open");
    click(card()!);
    key(page.querySelector(".yc-card")!, "Escape");
    expect(yourCallOf(session).state.get().step).toBe("closed");
    expect(document.activeElement).toBe(card());

    click(card()!);
    click(button(page, "Back to the replay"));
    expect(document.activeElement).toBe(card());

    click(card()!);
    click(pill()!); // the pressed pill in the Your call header
    expect(yourCallOf(session).state.get().step).toBe("closed");
    expect(document.activeElement).toBe(card());

    click(card()!);
    const openPill = pill()!;
    act(() => openPill.focus());
    expect(document.activeElement).toBe(openPill);
    key(openPill, "Escape");
    expect(yourCallOf(session).state.get().step).toBe("closed");
    expect(document.activeElement).toBe(card());
  });

  it("in App it takes the page's place and hides the moment until closed, back on Your turn", () => {
    act(() => doors.set({ door: "turn", seq: 0 }));
    const session = offline();
    const page = mount(session, <App autoplay={false} />);
    const hub = () => page.querySelector("section.door-turn");
    const screen = () => page.querySelector('section.yc-screen[aria-label="Your call"]');
    expect(hub()).not.toBeNull();
    expect(screen()).toBeNull();
    click(page.querySelector<HTMLButtonElement>("#turn-call")!);
    expect(yourCallOf(session).state.get().step).toBe("deciding");
    expect(hub()).toBeNull();
    expect(page.querySelector("main.moment")).toBeNull();
    expect(page.querySelector(".stage-director, .stage-caption, .transport")).toBeNull();
    // The brand, with the pressed Your call button on the right.
    const head = screen()!.querySelector("header.stage-head")!;
    expect(textOf(head.querySelector(".brand h1"))).toBe("Through Their Eyes");
    // No live pill: the stream would play unseen under Your call (in a match: the way back).
    expect(head.querySelector(".header-start")!.childElementCount).toBe(0);
    const pressed = head.querySelector<HTMLButtonElement>(".header-end button")!;
    expect([textOf(pressed), pressed.getAttribute("aria-pressed")]).toEqual(["Your call", "true"]);
    expect(screen()!.querySelector(".yc-card")).not.toBeNull();
    click(button(page, "Back to the replay"));
    expect(hub()).not.toBeNull();
    expect(page.querySelector("#your-call-open")).toBeNull(); // no Your call in the header
  });
});

describe("Your call: deciding", () => {
  it("marks every option with a focusable, named button, and shows no number", () => {
    const { session, yc } = open();
    const el = mount(session);
    const group = el.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Options of J. Ferriday");
    expect(textOf(el.querySelector(".yc-you"))).toBe("J. Ferriday · you");
    const names = markers(el).map((m) => m.getAttribute("aria-label"));
    // The shirt number the marker shows is in its name too, so a speech user can say it.
    const named = (o: (typeof yc.options)[number]) =>
      o.receiver ? `${o.label}, number ${o.short}` : o.label;
    expect(names.sort()).toEqual(
      yc.options
        .map((o) =>
          ["H7", "H10"].includes(o.receiver ?? "") ? `${named(o)}, not seen lately` : named(o),
        )
        .sort(),
    );
    for (const m of markers(el)) {
      expect(m.tagName).toBe("BUTTON");
      expect(m.type).toBe("button");
      expect(m.getAttribute("aria-label")!.split(/\W+/)).toContain(textOf(m));
    }
    // Only shirt numbers and player ids: no probabilities, values or distances.
    expect(textOf(el)).not.toMatch(/\d+\.\d|%|\bm\b/);
    const card = textOf(el.querySelector(".yc-card"))!;
    expect(card.replace(/\b[HA]\d{1,2}\b/g, "")).not.toMatch(/\d/);
  });

  it("keeps the choice help concise and the card free of blur and entry flashes", () => {
    const { session } = open();
    const el = mount(session);
    expect(el.querySelectorAll(".yc-card > .yc-hint")).toHaveLength(1);
    expect(textOf(el.querySelector(".yc-card > .yc-hint"))).toBe(
      "Tap a teammate or swipe from J. Ferriday. Keyboard: press Pick with the keyboard, then arrows and Enter.",
    );
    expect(yourCallCss).not.toMatch(/blur\(|animation:\s*tt-rise/);
  });

  it("lists the markers left to right, so Tab and the arrow keys sweep across the pitch", () => {
    const { session } = open();
    const el = mount(session);
    const lefts = markers(el).map((m) => parseFloat(m.style.left));
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
  });

  it("keyboard: focus aims and draws the dotted path, arrows move, Enter picks, Escape leaves", () => {
    const { session, yc } = open();
    const el = mount(session);
    const [first, second] = markers(el);
    act(() => first.focus());
    const firstAction = yc.state.get().aim;
    expect(firstAction).not.toBeNull();
    expect(el.querySelector(".yc-path polyline")).not.toBeNull();
    key(first, "ArrowRight");
    expect(document.activeElement).toBe(second);
    const aimed = yc.state.get().aim;
    expect(aimed).not.toBe(firstAction);
    click(second);
    expect(yc.state.get()).toMatchObject({ step: "outcome", pick: aimed });
    key(el.querySelector(".yc-card")!, "Escape");
    expect(yc.state.get().step).toBe("closed");
  });

  it("keyboard: Pick with the keyboard focuses the left-most marker, and so aims it", () => {
    const { session, yc } = open();
    const el = mount(session);
    expect(document.activeElement).toBe(el.querySelector(".yc-card h2"));
    click(button(el, "Pick with the keyboard"));
    const [first] = markers(el);
    expect(document.activeElement).toBe(first);
    const aimed = yc.options.find((o) => o.action === yc.state.get().aim);
    expect(first.getAttribute("aria-label")?.split(", ")[0]).toBe(aimed?.label);
  });

  it("swipe: a drag from the carrier toward a teammate passes to him", () => {
    const { session, yc } = open();
    const el = mount(session);
    // A marker's name is the option's label, its number, then ", not seen lately" or ", tried".
    const optionOf = (m: HTMLElement) =>
      yc.options.find((o) => m.getAttribute("aria-label")?.split(", ")[0] === o.label)!;
    const target = markers(el).find((m) => optionOf(m).action === "pass:H7")!;
    const screenMarkers = markers(el).map((m) => ({
      action: optionOf(m).action,
      at: [parseFloat(m.style.left), parseFloat(m.style.top)] as [number, number],
    }));
    const carrier = yc.picture!.players[yc.picture!.carrier].truth;
    const cam = frameCall(carrier, yc.options, 0, 640, 400);
    const [cx, cy] = project(cam, toWorld(carrier), 640, 400);
    const [tx, ty] = [parseFloat(target.style.left), parseFloat(target.style.top)];
    const layer = el.querySelector(".yc-swipe")!;
    const pointer = (type: string, x: number, y: number) =>
      act(() => {
        layer.dispatchEvent(
          new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }),
        );
      });
    pointer("pointerdown", cx, cy);
    pointer("pointermove", cx + (tx - cx) * 0.5, cy + (ty - cy) * 0.5);
    // At halfway, the nearest marker in the swipe cone can be another teammate.
    expect(yc.state.get().aim).toBe(
      swipePick([cx, cy], [(tx - cx) * 0.5, (ty - cy) * 0.5], screenMarkers),
    );
    pointer("pointermove", cx + (tx - cx) * 0.9, cy + (ty - cy) * 0.9);
    pointer("pointermove", tx, ty);
    expect(yc.state.get().aim).toBe("pass:H7");
    pointer("pointerup", tx, ty);
    expect(yc.state.get()).toMatchObject({ step: "outcome", pick: "pass:H7" });
  });

  it("swipe: the layer is a circle of radius 72 around the carrier, not the whole view", () => {
    const { session, yc } = open();
    const el = mount(session);
    const carrier = yc.picture!.players[yc.picture!.carrier].truth;
    const [cx, cy] = project(
      frameCall(carrier, yc.options, 0, 640, 400),
      toWorld(carrier),
      640,
      400,
    );
    const layer = el.querySelector<HTMLElement>(".yc-swipe")!;
    const [left, top, width, height] = [
      parseFloat(layer.style.left),
      parseFloat(layer.style.top),
      parseFloat(layer.style.width),
      parseFloat(layer.style.height),
    ];
    expect(left).toBeCloseTo(cx - 72, 5);
    expect(top).toBeCloseTo(cy - 72, 5);
    expect([width, height]).toEqual([144, 144]);
    expect(layer.style.borderRadius).toBe("50%");
    // A drag that starts far from the carrier is outside the layer, so it scrolls the page.
    expect(left + width / 2).toBeCloseTo(cx, 4);
    expect(top + height / 2).toBeCloseTo(cy, 4);
    expect(Math.hypot(left + width / 2, top + height / 2)).toBeGreaterThan(width / 2);
  });
});

describe("Your call: the reveal", () => {
  it("plays every beat with verified lines, then one tap tries another option or goes back", () => {
    const { session, yc } = open();
    const el = mount(session);
    click(
      markers(el).find((m) => m.getAttribute("aria-label") === "Pass to K. Annersley, number 4")!,
    );

    // Outcome: the re-simulated run of the call plays, with its verified counterfactual line.
    expect(yc.state.get().clip).toMatchObject({ of: "pass:H4", playing: true });
    expect(textOf(el.querySelector(".yc-card h2"))).toBe("Your call: Pass to K. Annersley");
    expect(textOf(el)).toContain(
      "If J. Ferriday had passed to K. Annersley, K. Annersley would have received it.",
    );
    expect(textOf(el.querySelector(".yc-lines .kind"))).toMatch(/^Counterfactual/);
    // "Playing…" is shown, but outside the live region: it is not announced with every clip.
    expect(textOf(el.querySelector(".yc-card"))).toContain("Playing…");
    expect(textOf(el.querySelector(".yc-beat"))).not.toContain("Playing…");
    act(() => {
      for (let k = 0; k < 60; k++) yc.tick(0.1);
    });
    expect(yc.state.get().clip?.playing).toBe(false);
    expect(document.activeElement).toBe(button(el, "See the truth"));

    click(button(el, "See the truth"));
    expect(textOf(el.querySelector(".yc-card h2"))).toBe("The true picture");
    expect(textOf(el)).toContain(
      "Not where he pictured them: M. Undholm, O. Grevholt, L. Brackwell, R. Castellane.",
    );
    const sim = el.querySelector(".yc-lead .source")!;
    const words = `${SOURCES.sim.title.charAt(0).toLowerCase()}${SOURCES.sim.title.slice(1)}`;
    expect(textOf(sim)).toBe(`sim (${words})`);
    expect(textOf(sim.querySelector(".sr-only"))).toBe(`(${words})`);
    expect(textOf(el)).toContain(
      "J. Ferriday thought the pass to N. Varnhall had a 0.65 chance of arriving",
    );

    click(button(el, "What he did"));
    expect(textOf(el.querySelector(".yc-card h2"))).toBe("What he did: Pass to N. Varnhall");
    expect(textOf(el)).toContain("N. Varnhall took the pass from J. Ferriday.");
    expect(yc.state.get().clip).toMatchObject({ of: "pass:H9", playing: true });
    // The bundled narration was not verified: its lines say "sample", not "fixture".
    expect(textOf(el.querySelector(".yc-lines .source"))).toBe("sample");
    expect(textOf(el)).toContain(
      "Sample data: lines marked “sample” were not checked by the verifier.",
    );

    click(button(el, "Compare"));
    const versus = [...el.querySelectorAll(".yc-versus div")].map((d) => [
      textOf(d.querySelector("dt")),
      textOf(d.querySelector("dd")),
    ]);
    expect(versus).toEqual([
      ["Your call", "Pass to K. Annersley"],
      ["His call", "Pass to N. Varnhall"],
    ]);
    expect(textOf(el)).toContain(
      "That option would have been worth 0.16 less in expected threat than what he did.",
    );

    click(button(el, "Try another call"));
    expect(yc.state.get().step).toBe("deciding");
    expect(
      markers(el).some(
        (m) => m.getAttribute("aria-label") === "Pass to K. Annersley, number 4, tried",
      ),
    ).toBe(true);
    click(button(el, "Back to the replay"));
    expect(yc.state.get().step).toBe("closed");
    expect(session.playback.get()).toMatchObject({
      frame: session.moment.decisionFrame,
      playing: false,
    });
  });

  it("announces each beat and marks where the viewer is", () => {
    const { session, yc } = open();
    const el = mount(session);
    act(() => yc.choose("carry"));
    expect(el.querySelector(".yc-beat")!.getAttribute("aria-live")).toBe("polite");
    const steps = [...el.querySelectorAll(".yc-steps li")];
    expect(steps.map((s) => s.getAttribute("aria-current"))).toEqual(["step", null, null, null]);
    act(() => yc.skip());
    expect(
      [...el.querySelectorAll(".yc-steps li")].map((s) => s.getAttribute("aria-current")),
    ).toEqual([null, null, null, "step"]);
  });

  it("explains the call right after the pick: what he had seen, how his picture rated it, what it led to", () => {
    const { session } = open();
    const el = mount(session);
    click(
      markers(el).find((m) => m.getAttribute("aria-label") === "Pass to K. Annersley, number 4")!,
    );
    const why = el.querySelector<HTMLElement>('dl.yc-why[aria-label="Why it went this way"]')!;
    expect(why).not.toBeNull();
    const rows = [...why.querySelectorAll("dt")].map((dt) => textOf(dt));
    expect(rows).toEqual(["He had just seen", "Not seen lately", "On his picture"]);
    expect(textOf(why)).toContain("N. Varnhall");
    const unseen = textOf(why.querySelectorAll("dd")[1]);
    expect(unseen).toContain("R. Castellane"); // not seen lately
    expect(unseen).toContain("L. Brackwell");
    expect(textOf(why)).toContain("K. Annersley was fresh in his picture.");
    expect(textOf(why)).toContain(
      "the pass to N. Varnhall looked more promising than your call, so that was his choice.",
    );
    // Read from the sim export: marked so, and not a number in it.
    expect(why.querySelectorAll('[data-source="sim"]').length).toBe(2);
    expect(textOf(why)?.replace(/\(.*?\)/g, "")).not.toMatch(/\d/);
    // Then what it led to, in verified lines.
    expect(textOf(el.querySelector(".yc-sub"))).toBe("What it led to in the sim");
    expect(textOf(el.querySelector(".yc-lines"))).toContain("K. Annersley would have received it.");
    // The beats' buttons keep their names (the trailer's shot 12 clicks them).
    expect(button(el, "See the truth")).toBeDefined();
  });

  it("his own call: you made his call, and what he did is not played twice", () => {
    const { session, yc } = open();
    const el = mount(session);
    act(() => yc.choose("pass:H9"));
    expect(textOf(el.querySelector(".yc-card h2"))).toBe("You made his call: Pass to N. Varnhall");
    act(() => {
      yc.next();
      yc.next();
    });
    const clip = yc.state.get().clip!;
    expect(clip).toMatchObject({ of: "pass:H9", playing: false });
    expect(clip.frame).toBe(clip.end);
  });

  it("with reduced motion, cuts to where each clip and move ends", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList,
    );
    const { yc } = open();
    act(() => yc.choose("pass:H10"));
    const clip = yc.state.get().clip!;
    expect(clip.playing).toBe(false);
    expect(clip.frame).toBe(clip.end);
    act(() => yc.next());
    expect(yc.state.get().morph).toBe(1);
  });
});

/** A breakdown request that finishes only when the test says so. */
function heldBreakdown() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const route = (body: unknown) => {
    const { personas, languages } = body as { personas: string[]; languages: string[] };
    return pending.then(() =>
      json(breakdownResponse({}, { persona: personas[0], language: languages[0] })),
    );
  };
  return { route, release };
}

describe("Your call: online and in the match", () => {
  it("a breakdown asked for while loading does not play behind Your call", async () => {
    const held = heldBreakdown();
    const played = vi.fn(async () => {});
    const fetch = fakeFetch({
      "POST /api/breakdowns": held.route,
      "POST /api/tts": () => new Response(new Blob(["RIFF"], { type: "audio/wav" })),
    });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
      api: createApi(API, "blind_side_run-3", fetch),
      makeAudio: () => ({ play: played, pause: () => {}, onended: null }),
    });
    const decision = session.moment.decisionFrame;
    session.controls.setSound(true);
    session.controls.playBreakdown();
    expect(session.breakdown.get().status).toBe("loading");
    yourCallOf(session).open();
    held.release();
    await settle();
    expect(session.breakdown.get().status).toBe("ready");
    expect(session.runner.status.get().status).not.toBe("running");
    expect(session.playback.get()).toMatchObject({
      frame: decision,
      playing: false,
      captionLine: null,
    });
    expect(fetch.calls.filter((c) => c.path === "/api/tts")).toEqual([]);
    expect(played).not.toHaveBeenCalled();
  });

  it("a seek while the breakdown is loading ends the pending play", async () => {
    const held = heldBreakdown();
    const fetch = fakeFetch({ "POST /api/breakdowns": held.route });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
      api: createApi(API, "blind_side_run-3", fetch),
    });
    session.controls.playBreakdown();
    expect(session.breakdown.get().status).toBe("loading");
    session.controls.seek(12);
    held.release();
    await settle();
    expect(session.breakdown.get().status).toBe("ready");
    expect(session.runner.status.get().status).not.toBe("running");
    expect(session.playback.get()).toMatchObject({ frame: 12, playing: false, captionLine: null });
  });

  it("asks for the breakdown on opening, and its lines join the reveal when it arrives", async () => {
    const fetch = fakeFetch({
      "POST /api/breakdowns": (body) => {
        const { personas, languages } = body as { personas: string[]; languages: string[] };
        return json(breakdownResponse({}, { persona: personas[0], language: languages[0] }));
      },
    });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
      api: createApi(API, "blind_side_run-3", fetch),
    });
    const { yc } = open(session);
    expect(fetch.calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /api/breakdowns");
    const el = mount(session);
    act(() => {
      yc.choose("pass:H4");
      yc.next();
    });
    expect(textOf(el)).toContain("The breakdown's verified lines are on their way");
    await act(settle);
    expect(session.breakdown.get().status).toBe("ready");
    expect(yc.state.get().step).toBe("truth"); // the breakdown arriving does not end the mode
    act(() => yc.next());
    expect(textOf(el)).toContain(
      "Without that look, J. Ferriday would have passed to K. Annersley.",
    );
    expect(el.querySelector(".yc-lines .source")).toBeNull(); // verified: no fixture tag
  });

  it("his own call's outcome waits for the breakdown's lines too", async () => {
    const fetch = fakeFetch({
      "POST /api/breakdowns": (body) => {
        const { personas, languages } = body as { personas: string[]; languages: string[] };
        return json(breakdownResponse({}, { persona: personas[0], language: languages[0] }));
      },
    });
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
      api: createApi(API, "blind_side_run-3", fetch),
    });
    const { yc } = open(session);
    const el = mount(session);
    act(() => yc.choose("pass:H9"));
    expect(textOf(el)).toContain("The breakdown's verified lines are on their way");
    await act(settle);
    expect(textOf(el)).not.toContain("on their way");
  });

  it("opens a hero moment of the stitched match in Your call, from the Moments panel too", async () => {
    const m = matchExport();
    // The scan hero's pass has a receiver: its row must not give his answer away next to the button.
    m.moments.find((x) => x.id === MATCH_HERO)!.receiver = "H4";
    m.moments.find((x) => x.local_id === "m:line_breaking_pass:H8:0090")!.receiver = "H4";
    const fetch = fakeFetch({
      [`GET /data/${HERO_FILE}`]: () => json(exportJson),
      [`GET /data/${PAYLOAD_FILE}`]: () => json(payloadJson),
      [`GET /data/${WHAT_IF_FILE}`]: () => json(whatIfJson),
      "GET /health": health,
      [`GET /api/matches/${MATCH}`]: () => json(matchInfo(m)),
      "GET /api/matches/blind_side_run-3/export": () => json(exportJson),
      "GET /api/matches/press_escape-0/export": () => json(pressureExport()),
      "POST /api/breakdowns": (body) => json(matchBreakdown(body)),
    });
    const session = createMatchSession(parseHero(structuredClone(m)), {
      api: createApi(API, MATCH, fetch),
      dataUrl: "/data/",
      fetch,
      socket: fakeSockets(),
      whatIfs: whatIfJson,
    });
    const panel = render(session, <MomentsPanel />);
    const host = document.createElement("div");
    host.innerHTML = panel;
    // The hero row of blind_side_run 3 (possession 2) leaves his receiver out; the other row keeps
    // it, and the Your call button names the same shortened label.
    const scanRows = [...host.querySelectorAll('li[data-possession="2"]')];
    const heroRow = scanRows.find((li) => li.classList.contains("hero"))!;
    const passRow = scanRows.find((li) => !li.classList.contains("hero"))!;
    expect(textOf(heroRow)).not.toContain("→");
    expect(textOf(passRow)).toContain("→");
    const yourCallRow = [...heroRow.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Your call"),
    )!;
    expect(yourCallRow.getAttribute("aria-label")).toBe(
      "Your call: Decision after a scan · J. Ferriday",
    );
    const yourCallIn = (possession: number) => {
      const rows = host.querySelectorAll(`li[data-possession="${possession}"]`);
      return [...rows]
        .flatMap((row) => [...row.querySelectorAll("button")])
        .find((b) => b.getAttribute("aria-label")?.startsWith("Your call"));
    };
    // A button is on for every hero possession: an option without a bundled run says so.
    for (const p of session.match.possessions) {
      const button = yourCallIn(p.index + 1);
      if (!p.hero) {
        expect(button).toBeUndefined();
        continue;
      }
      expect(button).toBeDefined();
      expect(button!.disabled).toBe(false);
    }
    expect(yourCallIn(2)!.disabled).toBe(false);
    expect(WHAT_IF_FILES["press_escape-0"]).toBeTruthy();
    expect(yourCallIn(3)!.disabled).toBe(false);

    const calls = () => fetch.calls.map((c) => `${c.method} ${c.path}`);
    session.controls.openBreakdown(
      m.moments.find((x) => x.id === MATCH_PRESS)!,
      "yourcall",
    );
    await settle();
    // The stand-in has a run for his pass and the export's forced carry only: Your call opens,
    // the other options unsimulated, and nothing posts for a breakdown or starts the runner.
    const standIn = session.screen.get().hero!;
    expect(yourCallOf(standIn).state.get().step).toBe("deciding");
    expect(yourCallOf(standIn).options.some((o) => o.run.source === "none")).toBe(true);
    expect(calls()).toContain("GET /api/matches/press_escape-0/export");

    session.controls.openBreakdown(
      m.moments.find((x) => x.id === MATCH_HERO)!,
      "yourcall",
    );
    await settle();
    const scan = yourCallOf(session.screen.get().hero!);
    expect(scan.state.get().step).toBe("deciding");
    expect(session.screen.get().hero!.runner.status.get().status).not.toBe("running");
    expect(scan.options).toHaveLength(hero.runs.factual.decision!.options.length);
  });
});

describe("Your call: the model's rating of the pick", () => {
  const pickOther = (session: Session) => {
    const el = mount(session);
    const yc = yourCallOf(session);
    act(() => yc.open());
    const other = yc.options.find((o) => !o.factual && o.kind === "pass")!;
    click(markers(el).find((m) => m.getAttribute("aria-label")!.startsWith(other.label))!);
    return { el, other };
  };

  it("a re-simulated option shows his belief, the truth and the 're-simulated' label", () => {
    const { el, other } = pickOther(offline());
    expect(other.run.source).toBe("whatif");
    const block = el.querySelector(".yc-assess")!;
    expect(textOf(block)).toContain("What he believed");
    expect(textOf(block)).toContain("What was true");
    expect(block.querySelector("[data-outcome]")!.getAttribute("data-outcome")).toBe("resimulated");
    expect(textOf(block)).toContain("Re-simulated");
    expect(textOf(block)).not.toContain("Not re-simulated");
    expect(textOf(el)).toContain("Weight his picture gave it");
  });

  it("an option with no run says so, shows only the assessment and plays no outcome", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null);
    const { el, other } = pickOther(session);
    expect(other.run.source).toBe("none");
    const block = el.querySelector(".yc-assess")!;
    expect(block.querySelector("[data-outcome]")!.getAttribute("data-outcome")).toBe("none");
    expect(textOf(block)).toContain("Not re-simulated in this demo");
    expect(textOf(el)).not.toContain("The sim plays on from the decision");
    expect(el.querySelector(".yc-lines")).toBeNull();
    // The reveal and its framing carry on to the end.
    click(button(el, "See the truth"));
    click(button(el, "What he did"));
    expect(textOf(el)).toContain("What he did");
  });
});
