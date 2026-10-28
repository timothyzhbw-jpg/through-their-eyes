// @vitest-environment happy-dom
// Beside the camera switch: Player cam (the broadcast camera locked on the hero, as a breakdown's
// player_lock step) and the Auto director (the same switch as in View options).

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { directorPrefs } from "../director/director";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session, type ViewSession } from "../session";
import { CameraExtras, PlayerCam } from "./CameraExtras";
import { CameraSwitch, ViewOptions } from "./Stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);

function offline(): Session {
  return createSession(hero, EXAMPLE_PLAN, payloadJson, null, {});
}

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  directorPrefs.set({ auto: false });
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(session: ViewSession, node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session as Session}>{node}</SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return container;
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

/** The button whose text is `name` inside `root`. */
function button(root: Element, name: string): HTMLButtonElement {
  const all = [...root.querySelectorAll<HTMLButtonElement>("button")];
  const found = all.find((b) => text(b) === name);
  if (!found) throw new Error(`no button "${name}" in: ${all.map((b) => text(b)).join(" | ")}`);
  return found;
}
const pressed = (b: Element) => b.getAttribute("aria-pressed");
const click = (el: HTMLElement) => act(() => el.click());

function bar(session: ViewSession): HTMLElement {
  return mount(
    session,
    <>
      <CameraSwitch />
      <CameraExtras />
    </>,
  );
}

describe("Player cam", () => {
  it("locks the broadcast camera on the hero, and lets go when pressed again", () => {
    const session = offline();
    const page = bar(session);
    const cam = button(page, "Player cam");
    expect(cam.title).toBe("The broadcast camera follows him instead of the ball");
    expect(pressed(cam)).toBe("false");
    const focus = session.playback.get().focus;

    click(cam);
    expect(session.playback.get()).toMatchObject({
      camera: "broadcast",
      lock: session.moment.hero,
      // The picture in picture stays as it was.
      focus: focus === "pov" || focus === "broadcast" ? "broadcast" : "split",
    });
    expect(pressed(cam)).toBe("true");
    expect(pressed(button(page, "Broadcast"))).toBe("true");

    click(cam);
    expect(session.playback.get()).toMatchObject({ camera: "broadcast", lock: null });
    expect(pressed(cam)).toBe("false");
  });

  it("films the 3D view alone when the picture in picture is off", () => {
    const session = offline();
    session.controls.setFocus("pov"); // ?view=pov
    const page = bar(session);
    click(button(page, "Player cam"));
    expect(session.playback.get()).toMatchObject({
      focus: "broadcast",
      camera: "broadcast",
      lock: session.moment.hero,
    });
  });

  it("keeps the board as the picture in picture when it was the main view", () => {
    const session = offline();
    session.controls.setFocus("tactical");
    const page = bar(session);
    click(button(page, "Player cam"));
    expect(session.playback.get()).toMatchObject({ focus: "split", camera: "broadcast" });
  });

  it("is let go by a pick in the camera switch, as before", () => {
    const session = offline();
    session.controls.setFocus("pov");
    const page = bar(session);
    const cam = button(page, "Player cam");
    click(cam);
    click(button(page, "Broadcast"));
    expect(session.playback.get()).toMatchObject({
      focus: "broadcast",
      camera: "broadcast",
      lock: null,
    });
    expect(pressed(cam)).toBe("false");

    click(cam);
    click(button(page, "His eyes"));
    expect(session.playback.get()).toMatchObject({ focus: "pov", camera: "pov", lock: null });

    click(cam);
    click(button(page, "Tactical"));
    expect(session.playback.get()).toMatchObject({ focus: "tactical", lock: null });
    expect(pressed(cam)).toBe("false");
  });

  it("is not on the bar without a hero (a stitched match)", () => {
    const session = offline();
    const match = { ...session, kind: "match", hero: { ...hero, heroId: null } };
    const page = mount(match as unknown as ViewSession, <CameraExtras />);
    expect(page.querySelector(".camera-extras")).toBeNull(); // its bar has the possession jumps
    // Nor in View options, which keeps the Auto director (Stage.tsx).
    expect(
      mount(match as unknown as ViewSession, <PlayerCam />).querySelector("button"),
    ).toBeNull();
  });

  it("is in View options too (a phone hides the bar's pair)", () => {
    const session = offline();
    const page = mount(session, <ViewOptions />);
    click(page.querySelector<HTMLButtonElement>('button[aria-label="View options"]')!);
    const cam = button(page.querySelector(".options-panel")!, "Player cam");
    click(cam);
    expect(session.playback.get()).toMatchObject({
      camera: "broadcast",
      lock: session.moment.hero,
    });
    expect(pressed(cam)).toBe("true");
  });
});

describe("Auto director on the bar", () => {
  it("toggles the same switch as View options, under a name of its own", () => {
    const session = offline();
    const page = bar(session);
    const auto = button(page, "Auto director");
    expect(auto.getAttribute("aria-label")).toBe("Auto director (cuts the cameras)");
    expect(pressed(auto)).toBe("false");
    click(auto);
    expect(directorPrefs.get().auto).toBe(true);
    expect(pressed(auto)).toBe("true");
    click(auto);
    expect(directorPrefs.get().auto).toBe(false);
    expect(pressed(auto)).toBe("false");
  });
});
