// @vitest-environment happy-dom
// The three doors (SPEC 7): their addresses (?door=, and the old ?step= and ?play= mapped onto
// them), the header's tabs with the door on screen marked, Your turn's hub of three cards, For
// studios' steps, and the picture coming back for what plays on it.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { App } from "../App";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { doorOf, parseDeepLink } from "../deeplink";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { API, fakeFetch, pressureExport, settle } from "../testing";
import {
  DOOR_LABEL,
  DOORS,
  doorOfPlay,
  doorOfStep,
  parseDoor,
  withDoor,
  withPageAction,
} from "./doors";
import { doors } from "./state";
import { readFileSync } from "node:fs";

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
});
afterEach(() => {
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
const tab = (page: Element, name: string) =>
  [...page.querySelectorAll<HTMLButtonElement>(".door-tabs button")].find(
    (b) => textOf(b) === name,
  )!;

describe("the doors' addresses", () => {
  it("are three, in order, named as the header names them", () => {
    expect(DOORS).toEqual(["look", "turn", "studios"]);
    expect(DOORS.map((d) => DOOR_LABEL[d])).toEqual(["The look", "Your turn", "For studios"]);
    expect(parseDoor("turn")).toBe("turn");
    expect(parseDoor("Turn")).toBeNull();
  });

  it("?door= opens that door, as a spot: no intro card, no autoplay", () => {
    const link = parseDeepLink("?door=turn");
    expect(link).toMatchObject({ door: "turn", intro: false, autoplay: false, warnings: [] });
    expect(doorOf(link).door).toBe("turn");
    expect(doorOf(parseDeepLink("")).door).toBe("look");
    const bad = parseDeepLink("?door=lobby");
    expect(bad.door).toBeNull();
    expect(bad.warnings).toEqual(["door=lobby"]);
  });

  it("map the old ?step= and ?play= onto the doors; ?door= wins", () => {
    expect(doorOfStep("event")).toEqual({ door: "look", studio: null });
    expect(doorOfStep("your-view")).toEqual({ door: "look", studio: null });
    for (const s of ["broadcast", "commentary", "highlights", "stadium", "value"] as const) {
      expect(doorOfStep(s)).toEqual({ door: "studios", studio: s });
    }
    // the studio steps before the four solutions: the section that holds their panel now
    expect(doorOfStep("tactics")).toEqual({ door: "studios", studio: "broadcast" });
    expect(doorOfStep("content")).toEqual({ door: "studios", studio: "highlights" });
    expect(doorOfStep("crew")).toEqual({ door: "studios", studio: "commentary" });
    expect(["yourcall", "eyes", "drill", "steps", "recap"].map(doorOfPlay)).toEqual([
      "turn",
      "turn",
      "turn",
      "look",
      null,
    ]);
    expect(doorOf(parseDeepLink("?tamper=cf_value")).door).toBe("look");
    expect(doorOf(parseDeepLink("?door=look&step=value"))).toEqual({
      door: "look",
      studio: null,
      yourView: false,
    });
  });

  it("write ?door=, keep match, moment and settings, and consume one-shot actions", () => {
    expect(withDoor("?persona=coach&lang=zh", "turn")).toBe("?persona=coach&lang=zh&door=turn");
    expect(withDoor("?door=studios&step=value", "look")).toBe("?door=look");
    expect(withDoor("?step=value", "studios")).toBe("?step=value&door=studios");
    expect(
      withDoor(
        "?match=press_escape-0&moment=far_post_finish&persona=coach&lang=zh&autoplay=0&at=decision&run=counterfactual&ask=why&tamper=cf_value&play=eyes&tour=quick&compare=extra",
        "turn",
      ),
    ).toBe(
      "?match=press_escape-0&moment=far_post_finish&persona=coach&lang=zh&autoplay=0&door=turn",
    );
  });

  it.each(["tour=quick", "play=eyes"])(
    "does not restart %s after switching pages and reloading the address",
    (action) => {
      window.history.replaceState(null, "", `/?match=blind_side_run-3&${action}`);
      const page = mount(offline());
      act(() => tab(page, "Your turn").click());
      const reloaded = parseDeepLink(window.location.search);
      expect(doorOf(reloaded).door).toBe("turn");
      expect(reloaded).toMatchObject({ play: null, tour: null, warnings: [] });
      expect(new URLSearchParams(window.location.search).get("match")).toBe("blind_side_run-3");
    },
  );

  it("keeps a stitched match's moment and settings while replacing a feature action", () => {
    const search = withPageAction(
      "?match=match-1&moment=far_post_finish&persona=coach&lang=zh&team=KES&player=H8&view=tactical&play=eyes&tour=quick&door=home&step=value&at=decision&run=counterfactual&ask=why&tamper=cf_value&compare=extra",
      "?door=studios&step=commentary",
    );
    expect(search).toBe(
      "?match=match-1&moment=far_post_finish&persona=coach&lang=zh&team=KES&player=H8&view=tactical&door=studios&step=commentary",
    );
    expect(doorOf(parseDeepLink(search))).toEqual({
      door: "studios",
      studio: "commentary",
      yourView: false,
    });
  });
});

describe("the header's tabs", () => {
  it("mark the door on screen and switch it in place, keeping focus and updating the address", () => {
    const page = mount(offline());
    expect(textOf(page.querySelector(".door-tabs [aria-current=page]"))).toBe("The look");
    expect(page.querySelector('section.stage[aria-label="Live screen"]')).not.toBeNull();

    tab(page, "Your turn").focus();
    act(() => tab(page, "Your turn").click());
    expect(doors.get().door).toBe("turn");
    expect(window.location.search).toBe("?door=turn");
    expect(page.querySelector('section.stage[aria-label="Live screen"]')).toBeNull();
    expect(textOf(page.querySelector(".door-tabs [aria-current=page]"))).toBe("Your turn");
    // The same header on every door: the brand, the doors, Settings.
    expect(page.querySelector(".stage-head #settings")).not.toBeNull();
    // The keyboard stays on the current tab after the old header unmounts.
    expect(document.activeElement).toBe(tab(page, "Your turn"));

    tab(page, "For studios").focus();
    act(() => tab(page, "For studios").click());
    expect(page.querySelector("#journey-panel")).not.toBeNull();
    expect(textOf(page.querySelector("#studios-title"))).toBe("For studios.");
    expect(document.activeElement).toBe(tab(page, "For studios"));

    tab(page, "The look").focus();
    act(() => tab(page, "The look").click());
    expect(page.querySelector('section.stage[aria-label="Live screen"]')).not.toBeNull();
    expect(window.location.search).toBe("?door=look");
    expect(document.activeElement).toBe(tab(page, "The look"));
  });

  it("are 24 px targets or larger, by their CSS", () => {
    const rule = doorsCss.match(/\.door-tab \{([^}]*)\}/)![1];
    expect(Number(rule.match(/height:\s*(\d+)px/)![1])).toBeGreaterThanOrEqual(24);
  });
});

describe("Your turn", () => {
  it("is one hub: its title, one line, and three cards that open the modes", () => {
    act(() => doors.set({ door: "turn", seq: 0 }));
    const page = mount(offline());
    const hub = page.querySelector("section.door-turn")!;
    expect(textOf(hub.querySelector("h2"))).toBe("Your turn.");
    expect(textOf(hub.querySelector(".lede"))).toBe("You are the player; see what he could see.");
    const cards = [...hub.querySelectorAll<HTMLButtonElement>(".turn-card")];
    expect(cards.map((c) => textOf(c.querySelector(".turn-card-title")))).toEqual([
      "Make his call",
      "See through his eyes",
      "Train your scanning",
    ]);
    expect(cards.every((c) => !c.disabled)).toBe(true);
    // Each card is named by its title and described by its line.
    for (const c of cards) {
      expect(document.getElementById(c.getAttribute("aria-describedby")!)).not.toBeNull();
    }
    // No primary action on the hub: each card is a way in of its own.
    expect(hub.querySelector(".btn-primary")).toBeNull();
  });

  it("gives each card a meaningful, lazy picture above its title at a fixed aspect ratio", () => {
    act(() => doors.set({ door: "turn", seq: 0 }));
    const page = mount(offline());
    const images = [...page.querySelectorAll<HTMLImageElement>(".turn-card-image")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "/img/turn/yourcall.webp",
      "/img/turn/eyes.webp",
      "/img/turn/drill.webp",
    ]);
    for (const image of images) {
      expect(image.alt.length).toBeGreaterThan(20);
      expect(image.loading).toBe("lazy");
      expect([image.width, image.height]).toEqual([960, 540]);
      expect(image.nextElementSibling?.classList.contains("turn-card-title")).toBe(true);
    }
    expect(doorsCss).toMatch(/\.turn-card-image\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
    expect(doorsCss).toMatch(/\.turn-card\s*\{[^}]*flex-direction:\s*column/);
  });

  it("says why a card cannot open on a moment without its data", () => {
    act(() => doors.set({ door: "turn", seq: 0 }));
    const other = { ...pressureExport(), seed: 7 }; // no bundled look grid on this seed
    const page = mount(createSession(parseHero(other), null, null, null));
    const eyes = page.querySelector<HTMLButtonElement>("#turn-eyes")!;
    expect(eyes.disabled).toBe(true);
    expect(textOf(eyes.querySelector(".turn-card-line"))).not.toBe(
      "Choose when and where he looks; the sim re-runs the moment.",
    );
  });
});

describe("the picture", () => {
  it("comes back when something starts playing on it, and leaving it stops what played", () => {
    const session = offline();
    const stopVoice = vi.spyOn(session.voice, "stop");
    mount(session);
    act(() => session.controls.playBreakdown());
    expect(session.runner.status.get().status).toBe("running");
    act(() => doors.set({ door: "studios", seq: 1 }));
    // Leaving door 1 stops the breakdown and its narration: nothing plays unseen.
    expect(session.runner.status.get().status).not.toBe("running");
    expect(session.playback.get().playing).toBe(false);
    expect(stopVoice).toHaveBeenCalled();
    // Opening a line's evidence (the studios' "Open the evidence", a caption) brings it back.
    const line = session.breakdown.get().narration!.lines[0];
    act(() => session.controls.openLine(line.id));
    expect(doors.get().door).toBe("look");
  });

  it.each(["playing", "loading"] as const)(
    "stops %s narration on leaving The look, including a late TTS response",
    async (status) => {
      let finishTts!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => (finishTts = resolve));
      const fetch = fakeFetch({ "POST /api/tts": () => pending });
      const play = vi.fn(async () => {});
      const pause = vi.fn();
      const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson, {
        api: createApi(API, "blind_side_run-3", fetch),
        makeAudio: () => ({ play, pause, onended: null }),
      });
      session.breakdown.set({
        voice: [{ line: "L1", speaker: "pbp", t: 0, voice: "v", ssml: "<speak/>", cache_key: "k" }],
      });
      const page = mount(session);
      const respond = () => finishTts(new Response(new Blob(["RIFF"], { type: "audio/wav" })));
      await act(async () => {
        session.controls.setSound(true);
        session.playback.set({ captionLine: "L1" });
        if (status === "playing") respond();
        await settle();
      });
      expect(session.voice.state.get().status).toBe(status);
      expect(fetch.calls.filter((c) => c.path === "/api/tts")).toHaveLength(1);

      act(() => tab(page, "Your turn").click());
      expect(session.voice.state.get()).toMatchObject({ status: "idle", line: null });
      if (status === "loading") {
        await act(async () => {
          respond();
          await settle();
        });
        expect(play).not.toHaveBeenCalled();
      } else {
        expect(play).toHaveBeenCalledTimes(1);
        expect(pause).toHaveBeenCalledTimes(1);
      }
      expect(session.voice.state.get()).toMatchObject({ status: "idle", line: null });
    },
  );
});
