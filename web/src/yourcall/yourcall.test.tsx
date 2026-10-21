// @vitest-environment happy-dom
// "Your call" (SPEC 7) on the page: the deep link, the option markers (focusable, named, no
// numbers before the choice), keyboard and swipe, every beat of the reveal with its verified
// lines, reduced motion, the live breakdown arriving, and a hero moment of the stitched match.
// The 3D view is left out (no WebGL here); markers, path and card are DOM.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { HERO_FILE, PAYLOAD_FILE, WHAT_IF_FILE } from "../data/load";
import { applyDeepLink, parseDeepLink } from "../deeplink";
import { createMatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
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
import { frameCall, markerAt, project, toWorld } from "./camera";
import { yourCallOf } from "./controller";
import { YourCallButton, YourCallStage } from "./YourCall";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
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

  it("the header button opens it; without re-simulated options it is disabled with the reason", () => {
    const session = offline();
    const el = mount(session, <YourCallButton />);
    const b = el.querySelector("button")!;
    expect(b.getAttribute("aria-pressed")).toBe("false");
    click(b);
    expect(yourCallOf(session).state.get().step).toBe("deciding");
    const bare = createSession(hero, EXAMPLE_PLAN, payloadJson, null);
    const off = mount(bare, <YourCallButton />).querySelector("button")!;
    expect(off.disabled).toBe(true);
    expect(off.title).toMatch(/No re-simulated runs/);
  });
});

describe("Your call: deciding", () => {
  it("marks every option with a focusable, named button, and shows no number", () => {
    const { session, yc } = open();
    const el = mount(session);
    const group = el.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Options of H8");
    const names = markers(el).map((m) => m.getAttribute("aria-label"));
    expect(names.sort()).toEqual(
      yc.options
        .map((o) =>
          ["H7", "H10"].includes(o.receiver ?? "") ? `${o.label}, not seen lately` : o.label,
        )
        .sort(),
    );
    for (const m of markers(el)) {
      expect(m.tagName).toBe("BUTTON");
      expect(m.type).toBe("button");
    }
    // Only shirt numbers and player ids: no probabilities, values or distances.
    expect(textOf(el)).not.toMatch(/\d+\.\d|%|\bm\b/);
    const card = textOf(el.querySelector(".yc-card"))!;
    expect(card.replace(/\b[HA]\d{1,2}\b/g, "")).not.toMatch(/\d/);
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

  it("swipe: a drag from the carrier toward a teammate passes to him", () => {
    const { session, yc } = open();
    const el = mount(session);
    const target = yc.options.find((o) => o.action === "pass:H7")!;
    const carrier = yc.picture!.players[yc.picture!.carrier].truth;
    const cam = frameCall(carrier, yc.options, 0, 640, 400);
    const [cx, cy] = project(cam, toWorld(carrier), 640, 400);
    const [tx, ty] = markerAt(cam, target.anchor, 640, 400);
    const layer = el.querySelector(".yc-swipe")!;
    const pointer = (type: string, x: number, y: number) =>
      act(() => {
        layer.dispatchEvent(
          new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }),
        );
      });
    pointer("pointerdown", cx, cy);
    pointer("pointermove", cx + (tx - cx) * 0.5, cy + (ty - cy) * 0.5);
    expect(yc.state.get().aim).toBe("pass:H7");
    pointer("pointerup", tx, ty);
    expect(yc.state.get()).toMatchObject({ step: "outcome", pick: "pass:H7" });
  });
});

describe("Your call: the reveal", () => {
  it("plays every beat with verified lines, then one tap tries another option or goes back", () => {
    const { session, yc } = open();
    const el = mount(session);
    click(markers(el).find((m) => m.getAttribute("aria-label") === "Pass to H4")!);

    // Outcome: the re-simulated run of the call plays, with its verified counterfactual line.
    expect(yc.state.get().clip).toMatchObject({ of: "pass:H4", playing: true });
    expect(textOf(el.querySelector(".yc-card h2"))).toBe("Your call: Pass to H4");
    expect(textOf(el)).toContain("If H8 had passed to H4, H4 would have received it.");
    expect(textOf(el.querySelector(".yc-lines .kind"))).toMatch(/^Counterfactual/);
    act(() => {
      for (let k = 0; k < 60; k++) yc.tick(0.1);
    });
    expect(yc.state.get().clip?.playing).toBe(false);
    expect(document.activeElement).toBe(button(el, "See the truth"));

    click(button(el, "See the truth"));
    expect(textOf(el.querySelector(".yc-card h2"))).toBe("The true picture");
    expect(textOf(el)).toContain("Not where he pictured them: A3, A4, H10, H7.");
    expect(textOf(el)).toContain("H8 thought the pass to H9 had a 0.80 chance of arriving");

    click(button(el, "What he did"));
    expect(textOf(el.querySelector(".yc-card h2"))).toBe("What he did: Pass to H9");
    expect(textOf(el)).toContain("H9 took the pass from H8.");
    expect(yc.state.get().clip).toMatchObject({ of: "pass:H9", playing: true });

    click(button(el, "Compare"));
    const versus = [...el.querySelectorAll(".yc-versus div")].map((d) => [
      textOf(d.querySelector("dt")),
      textOf(d.querySelector("dd")),
    ]);
    expect(versus).toEqual([
      ["Your call", "Pass to H4"],
      ["His call", "Pass to H9"],
    ]);
    expect(textOf(el)).toContain(
      "That option would have been worth 0.10 less in expected threat than what he did.",
    );

    click(button(el, "Try another option"));
    expect(yc.state.get().step).toBe("deciding");
    expect(markers(el).some((m) => m.getAttribute("aria-label") === "Pass to H4, tried")).toBe(
      true,
    );
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

  it("his own call: you made his call, and what he did is not played twice", () => {
    const { session, yc } = open();
    const el = mount(session);
    act(() => yc.choose("pass:H9"));
    expect(textOf(el.querySelector(".yc-card h2"))).toBe("You made his call: Pass to H9");
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

describe("Your call: online and in the match", () => {
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
    expect(textOf(el)).toContain("Without that look, H8 would have passed to H4.");
    expect(el.querySelector(".yc-lines .source")).toBeNull(); // verified: no fixture tag
  });

  it("opens a hero moment of the stitched match in Your call, from the Moments panel too", async () => {
    const m = matchExport();
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
    expect(panel).toContain('aria-label="Your call: ');
    expect(panel.match(/>Your call</g)).toHaveLength(2);

    session.controls.openBreakdown(
      m.moments.find((x) => x.id === MATCH_PRESS)!,
      "yourcall",
    );
    await settle();
    const press = session.screen.get().hero!;
    const yc = yourCallOf(press);
    expect(yc.state.get().step).toBe("deciding");
    expect(press.runner.status.get().status).not.toBe("running");
    // The stand-in has no bundled what-ifs: his pass and the export's forced carry.
    expect(yc.options.map((o) => o.action).sort()).toEqual(["carry", "pass:H9"]);

    session.controls.backToMatch();
    expect(yc.state.get().step).toBe("closed");
    session.controls.openBreakdown(
      m.moments.find((x) => x.id === MATCH_HERO)!,
      "yourcall",
    );
    await settle();
    const scan = yourCallOf(session.screen.get().hero!);
    expect(scan.state.get().step).toBe("deciding");
    expect(scan.options).toHaveLength(hero.runs.factual.decision!.options.length);
  });
});
