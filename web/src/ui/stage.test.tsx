// @vitest-environment happy-dom
// The live screen of the Floodlit design: one camera switch for the three views, the views'
// overlay toggles behind one "View options" button, the moment card with its single primary
// action, who is watching in the header, the picture-in-picture swap, and verified numbers in the
// caption (dotted underline and a check that opens the evidence).

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { validatePayload, type RenderPayload } from "../narration/payload";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, tickSession, type Session } from "../session";
import { trial } from "../players/trial";
import { API, breakdownResponse, fakeFetch, json, settle } from "../testing";
import { Caption } from "./Narration";
import { DecisionPanel, StoryPanel, VerdictPanel } from "./Panels";
import { CameraSwitch, MomentCard, StageHud, SwapViews, ViewerMenu, ViewOptions } from "./Stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);

function offline(): Session {
  return createSession(hero, EXAMPLE_PLAN, payloadJson, null, {});
}

function online(hang = false): Session {
  const fetch = fakeFetch({
    "POST /api/breakdowns": (body) => {
      if (hang) return "hang";
      const { personas, languages } = body as { personas: string[]; languages: string[] };
      return json(breakdownResponse({}, { persona: personas[0], language: languages[0] }));
    },
  });
  return createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    makeAudio: () => ({ play: async () => {}, pause: () => {}, onended: null }),
  });
}

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(session: Session, node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

/** The button named `name` (aria-label, else its text) inside `root`. */
function button(root: Element, name: string): HTMLButtonElement {
  const all = [...root.querySelectorAll<HTMLButtonElement>("button")];
  const found = all.find((b) => (b.getAttribute("aria-label") ?? text(b)) === name);
  if (!found) throw new Error(`no button "${name}" in: ${all.map((b) => text(b)).join(" | ")}`);
  return found;
}
const pressed = (b: Element) => b.getAttribute("aria-pressed");
const click = (el: HTMLElement) => act(() => el.click());

describe("camera switch", () => {
  it("films his eyes, the broadcast camera or the tactical board, one at a time", () => {
    const session = offline();
    const page = mount(session, <CameraSwitch />);
    const group = page.querySelector("[role=group][aria-label=Camera]")!;
    expect(group).not.toBeNull();
    const [eyes, broadcast, tactical] = ["His eyes", "Broadcast", "Tactical"].map((n) =>
      button(group, n),
    );
    expect([eyes, broadcast, tactical].map(pressed)).toEqual(["true", "false", "false"]);

    click(tactical);
    expect(session.playback.get().focus).toBe("tactical");
    expect([eyes, broadcast, tactical].map(pressed)).toEqual(["false", "false", "true"]);

    click(broadcast); // back from the board: the board rides along as the picture in picture
    expect(session.playback.get()).toMatchObject({ focus: "split", camera: "broadcast" });
    expect([eyes, broadcast, tactical].map(pressed)).toEqual(["false", "true", "false"]);

    click(eyes);
    expect(session.playback.get()).toMatchObject({ focus: "split", camera: "pov" });
    expect([eyes, broadcast, tactical].map(pressed)).toEqual(["true", "false", "false"]);
  });

  it("keeps the 3D view alone when the picture in picture is off", () => {
    const session = offline();
    session.controls.setFocus("pov"); // ?view=pov
    const page = mount(session, <CameraSwitch />);
    click(button(page, "Broadcast"));
    expect(session.playback.get()).toMatchObject({ focus: "broadcast", camera: "broadcast" });
    click(button(page, "His eyes"));
    expect(session.playback.get()).toMatchObject({ focus: "pov", camera: "pov" });
  });
});

describe("view options", () => {
  it("keeps every overlay toggle one click away, behind a single button", () => {
    const session = offline();
    const page = mount(session, <ViewOptions />);
    const open = button(page, "View options");
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(page.querySelectorAll("button").length).toBe(1); // nothing else on screen

    click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const panel = page.querySelector("[role=group][aria-label='View options']")!;
    const names = [...panel.querySelectorAll("button")].map((b) => text(b));
    for (const n of [
      "Comfort",
      "Belief ghosts",
      "Animated players",
      "Vision cone",
      "Pass options",
      "Blind side",
      "Pitch control",
      "Ghost: no look",
    ])
      expect(names, n).toContain(n);
    expect(names.filter((n) => n === "Belief ghosts")).toHaveLength(1); // one toggle, one state
    expect(panel.querySelector("select[aria-label='Playback speed']")).not.toBeNull();
    expect(panel.querySelector("select[aria-label='Whose eyes']")).toBeNull(); // on the picture

    const pitch = button(panel, "Pitch control");
    expect(pressed(pitch)).toBe("false");
    click(pitch);
    expect(session.playback.get().pitchControl).toBe(true);
    expect(pressed(button(panel, "Pitch control"))).toBe("true");

    const rigged = trial.get().rigged;
    click(button(panel, "Animated players"));
    expect(trial.get().rigged).toBe(!rigged);
    act(() => trial.set({ rigged }));
  });

  it("closes with Escape and gives focus back to its button", () => {
    const page = mount(offline(), <ViewOptions />);
    const open = button(page, "View options");
    click(open);
    act(() => {
      page
        .querySelector("[role=group][aria-label='View options']")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(page.querySelector("[role=group][aria-label='View options']")).toBeNull();
    expect(document.activeElement).toBe(open);
  });
});

describe("whose eyes", () => {
  it("keeps the player picker on the picture, with his readouts while his eyes are on", () => {
    const session = offline();
    const page = mount(session, <StageHud />);
    const select = page.querySelector<HTMLSelectElement>("select[aria-label='Whose eyes']")!;
    expect(select.value).toBe("H8");
    expect(text(page.querySelector(".hud"))).toMatch(/H8 · head \d+° from the ball/);
    act(() => {
      select.value = "H9";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(session.playback.get().povPlayer).toBe("H9");
    act(() => session.controls.setFocus("tactical")); // his eyes in the corner: no readouts
    expect(page.querySelector(".hud")).toBeNull();
    expect(page.querySelector("select[aria-label='Whose eyes']")).not.toBeNull();
  });

  it("labels the head angle and players in sight together as sim readouts", () => {
    const page = mount(offline(), <StageHud />);
    const source = page.querySelector(".hud .source")!;
    expect(text(source)).toBe("sim");
    expect(source.getAttribute("title")).toContain("not a verified claim");
    expect(text(source.parentElement)).toMatch(/head \d+° from the ball.*\d+ players in sight/);
    expect(page.querySelectorAll(".hud .source")).toHaveLength(1);
    expect(page.querySelector(".hud .verified")).toBeNull();
  });
});

describe("sim numbers in the story and decision", () => {
  it("labels story timings, distances and probabilities as a group from the sim", () => {
    const page = mount(offline(), <StoryPanel />);
    const source = page.querySelector(".story .chapter-head .source")!;
    expect(text(source)).toBe("sim");
    expect(source.getAttribute("title")).toContain("not a verified claim");
    expect(text(source.parentElement)).toContain("Timings, distances and probabilities");
    expect(text(page.querySelector(".beats"))).toContain("probability");
    expect(page.querySelector(".verified")).toBeNull();
  });

  it("labels the options and belief facts together as sim values", () => {
    const page = mount(offline(), <DecisionPanel />);
    const figure = page.querySelector(".options-figure")!;
    expect(text(figure.querySelector(".kicker .source"))).toBe("sim");
    expect(figure.querySelector(".source")!.getAttribute("title")).toContain(
      "not a verified claim",
    );
    expect(figure.querySelectorAll(".opt").length).toBeGreaterThan(0);
    expect(text(figure.querySelector(".facts"))).toContain("Last saw");
    expect(figure.querySelector(".verified")).toBeNull();
  });
});

describe("moment card", () => {
  it("names the moment and offers one primary action: read it", () => {
    const page = mount(offline(), <MomentCard />);
    const card = page.querySelector("aside.moment-card")!;
    expect(text(card.querySelector(".kicker"))).toBe("Moment · 3.00 s · Perception");
    expect(text(card.querySelector("h2"))).toBe("One look changed his pass.");
    const primary = card.querySelectorAll(".btn-primary");
    expect(primary).toHaveLength(1);
    expect(text(primary[0])).toBe("Read the moment");
    expect(primary[0].getAttribute("href")).toBe("#moment");
  });

  it("never claims the bundled example was checked by the verifier", () => {
    const page = mount(offline(), <MomentCard />);
    expect(text(page)).toContain("Bundled example · not checked by the verifier");
    expect(text(page)).not.toContain("every number checked");
  });

  it("on a link that opens paused, names the moment instead of a stream that is not there", () => {
    // ?at=key-scan and the other spot links: online, never live, nothing streamed (latest -1)
    const session = online();
    const page = mount(session, <MomentCard />);
    const card = page.querySelector("aside.moment-card")!;
    expect(text(card.querySelector(".kicker"))).toBe("Moment · 3.00 s · Perception");
    expect(text(card.querySelector("h2"))).toBe("One look changed his pass.");
    expect(text(page)).not.toContain("Watching the stream");
    expect(text(page)).not.toContain("waiting for the moment");
    expect(text(page)).not.toContain("You left the stream");
    expect(text(page.querySelector(".btn-primary"))).toBe("Get breakdown");
  });

  it("stops saying it is watching once the viewer has left the stream before the moment", () => {
    const session = online();
    const page = mount(session, <MomentCard />);
    // live, frames came in, then the Live pill left the stream (the run switch is locked until
    // the moment, so it can no longer do that)
    act(() => session.playback.set({ live: true }));
    expect(text(page)).toContain("Live · waiting for the moment");
    act(() => session.feed!.state.set({ latest: 40 }));
    expect(text(page)).toContain("Live · waiting for the moment");
    act(() => session.controls.leaveLive());
    expect(text(page)).toContain("Off the stream · moment not reached");
    expect(text(page)).toContain("You left the stream.");
    expect(text(page)).not.toContain("Watching the stream");
    expect(text(page.querySelector(".btn-primary"))).toBe("Get breakdown");
  });

  it("waits for the stream, shows the crew at work, then each crew step's source", async () => {
    const session = online();
    const page = mount(session, <MomentCard />);
    act(() => session.playback.set({ live: true }));
    expect(text(page)).toContain("Watching the stream");

    const slow = online(true);
    const loading = mount(slow, <MomentCard />);
    act(() => slow.controls.requestBreakdown());
    await act(settle);
    expect(loading.querySelector("[aria-live=polite]")?.textContent).toContain(
      "The crew is writing the breakdown",
    );

    act(() => session.controls.requestBreakdown());
    await act(settle);
    // Who wrote it, as the service said it: the test service answers with a cached crew run.
    expect(text(page)).toContain("Cached: a crew run from 21 Oct 2026, 19:31 UTC");
    expect(text(page)).toContain("Every number checked in code");
    const steps = [...page.querySelectorAll(".crew-bar [data-step]")];
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual([
      "director",
      "analyst",
      "telestrator",
      "narration",
      "verifier",
      "voice",
    ]);
    expect(steps.map((s) => s.getAttribute("data-source"))).toEqual([
      "llm",
      "llm",
      "llm",
      "llm",
      "code",
      "code",
    ]);
  });

  it("pauses the breakdown instead of ending it; play resumes it, other controls take over", () => {
    const session = offline();
    const page = mount(session, <MomentCard />);
    click(button(page, "Play breakdown"));
    act(() => {
      for (let k = 0; k < 6 * 60; k++) tickSession(session, 1 / 60);
    });
    const caption = session.playback.get().captionLine;
    expect(caption).not.toBeNull();
    act(() => session.controls.togglePlay());
    expect(session.runner.status.get()).toMatchObject({ status: "running", paused: true });
    expect(session.playback.get().playing).toBe(false);
    expect(session.playback.get().captionLine).toBe(caption);
    expect(text(page)).not.toContain("Replay breakdown");
    const t = session.runner.time;
    act(() => {
      for (let k = 0; k < 60; k++) tickSession(session, 1 / 60);
    });
    expect(session.runner.time).toBe(t);
    act(() => session.controls.togglePlay());
    expect(session.runner.status.get()).toMatchObject({ status: "running", paused: false });
    act(() => session.controls.seek(10));
    expect(session.runner.status.get().status).toBe("stopped");
  });

  it("plays and stops the breakdown, and can be dismissed", async () => {
    const session = offline();
    const page = mount(session, <MomentCard />);
    click(button(page, "Play breakdown"));
    expect(session.runner.status.get().status).toBe("running");
    click(button(page, "Stop"));
    expect(session.runner.status.get().status).toBe("stopped");
    click(button(page, "Dismiss the moment"));
    expect(page.querySelector("aside.moment-card")).toBeNull();
  });
});

describe("who is watching", () => {
  it("picks the audience and the language from the header", async () => {
    const session = online();
    session.controls.requestBreakdown();
    await settle();
    const page = mount(session, <ViewerMenu />);
    const open = page.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")!;
    expect(text(open)).toContain("Watching as Casual fan · English");
    click(open);
    const dialog = page.querySelector("[role=dialog][aria-label='Who is watching']")!;
    const analyst = button(dialog, "Analyst The mechanism, with the numbers.");
    expect(pressed(analyst)).toBe("false");
    click(analyst);
    await act(settle);
    expect(session.breakdown.get().persona).toBe("analyst");

    // The menu stays open after a pick: the language is one more click, not two.
    const zh = page.querySelector<HTMLButtonElement>(
      "[role=dialog] [role=group][aria-label=Language] button[lang=zh]",
    )!;
    expect(zh).not.toBeNull();
    click(zh);
    await act(settle);
    expect(session.breakdown.get().language).toBe("zh");
    expect(page.querySelector("[role=dialog][aria-label='Who is watching']")).not.toBeNull();
    expect(text(page.querySelector("button[aria-haspopup=dialog]"))).toContain(
      "Watching as Analyst · 中文",
    );
  });

  it("stays open after each pick until Escape or a press outside closes it", async () => {
    const session = online();
    session.controls.requestBreakdown();
    await settle();
    const page = mount(session, <ViewerMenu />);
    const toggle = page.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")!;
    const dialog = () => page.querySelector("[role=dialog][aria-label='Who is watching']");
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const coach = button(dialog()!, "Coach Shapes, distances, decisions.");
    act(() => coach.focus()); // as a press or Enter on it would
    click(coach);
    await act(settle);
    expect(dialog()).not.toBeNull();
    // The keyboard stays where it was: on the audience just picked, now pressed.
    const picked = button(dialog()!, "Coach Shapes, distances, decisions.");
    expect(pressed(picked)).toBe("true");
    expect(document.activeElement).toBe(picked);
    // Escape closes it and hands the keyboard back to the toggle.
    act(() => {
      picked.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(toggle);
    // A press outside closes it too.
    click(toggle);
    expect(dialog()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it("says why only the bundled audience exists offline", () => {
    const page = mount(offline(), <ViewerMenu />);
    click(page.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")!);
    expect(text(page.querySelector("[role=dialog]"))).toContain(
      "Other audiences and languages need the live service",
    );
  });
});

describe("picture in picture", () => {
  it("swaps the small view with the main one", () => {
    const session = offline();
    const page = mount(session, <SwapViews />);
    click(button(page, "Make the tactical board the main view"));
    expect(session.playback.get().focus).toBe("tactical");
    click(button(page, "Make his eyes the main view"));
    expect(session.playback.get()).toMatchObject({ focus: "split", camera: "pov" });
  });
});

describe("verified numbers in the caption", () => {
  it("underlines each number of a verified line and ends it with the evidence check", async () => {
    const session = online();
    session.controls.requestBreakdown();
    await settle();
    const page = mount(session, <Caption />);
    act(() => session.controls.openLine("L2"));
    const caption = page.querySelector("button.caption")!;
    expect([...caption.querySelectorAll(".num")].map((n) => text(n))).toEqual(["0.11"]);
    expect(caption.querySelector(".caption-more svg")).not.toBeNull();
    expect(text(caption)).toContain("That look was worth 0.11 in expected threat.");
  });

  it("leaves the numbers of the unchecked bundled example plain", () => {
    const session = offline();
    const page = mount(session, <Caption />);
    act(() => session.controls.openLine("L3"));
    const caption = page.querySelector("button.caption")!;
    expect(text(caption)).toContain("0.3 metres");
    expect(caption.querySelectorAll(".num")).toHaveLength(0);
  });
});

describe("the counterfactual verdict", () => {
  function verdictPayload(patch: Partial<RenderPayload> = {}) {
    const session = offline();
    const payload: RenderPayload = {
      ...payloadJson,
      fixture: false,
      claims: payloadJson.claims.map((c) =>
        c.id === "cf_value" ? { ...c, values: { dxt: 9.87 } } : c,
      ),
      ...patch,
    } as RenderPayload;
    const checked = validatePayload(payload, session.moment, hero);
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    session.breakdown.set({ narration: checked.narration });
    return mount(session, <VerdictPanel />);
  }

  function expectSim(page: HTMLElement) {
    const worth = page.querySelector(".worth")!;
    expect(text(worth.querySelector(".numeral"))).toBe(`+${hero.deltaXt!.toFixed(3)}`);
    expect(text(worth)).not.toContain("9.87");
    expect(worth.classList.contains("verified")).toBe(false);
    expect(worth.querySelector(".checked")).toBeNull();
    expect(text(worth)).not.toContain("checked by the verifier");
    expect(text(worth.querySelector(".source"))).toBe("sim");
  }

  for (const verdict of ["refuted", "inconclusive"] as const) {
    it(`uses the sim value when the counterfactual claim is ${verdict}`, () => {
      expectSim(
        verdictPayload({
          claims: payloadJson.claims.map((c) =>
            c.id === "cf_value" ? { ...c, verdict, values: { dxt: 9.87 } } : c,
          ) as RenderPayload["claims"],
        }),
      );
    });
  }

  it("uses the sim value when no shown narration line carries the supported claim", () => {
    expectSim(
      verdictPayload({ lines: payloadJson.lines.filter((l) => !l.claims.includes("cf_value")) }),
    );
  });

  it("uses the sim value when another claim withholds the line carrying the supported value", () => {
    expectSim(
      verdictPayload({
        claims: payloadJson.claims.map((c) =>
          c.id === "cf_pass" ? { ...c, verdict: "inconclusive" } : c,
        ) as RenderPayload["claims"],
      }),
    );
  });

  it("uses a supported value carried by a shown narration line and displays its check", () => {
    const page = verdictPayload();
    const worth = page.querySelector(".worth.verified")!;
    expect(worth).not.toBeNull();
    expect(text(worth.querySelector(".numeral"))).toBe("+9.87");
    expect(text(worth.querySelector(".worth-line"))).toContain("Without that look");
    expect(text(worth.querySelector(".checked"))).toContain("checked by the verifier");
    expect(worth.querySelector(".source")).toBeNull();
  });

  it("keeps the bundled fixture in Chalk with its sim source", () => {
    expectSim(mount(offline(), <VerdictPanel />));
  });
});
