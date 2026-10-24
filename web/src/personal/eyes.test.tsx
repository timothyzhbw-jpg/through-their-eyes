// @vitest-environment happy-dom
// Following a player puts his eyes on screen (SPEC 7): the EYES selector and the first-person
// view follow when the moment has his look data; without it the viewer is told and gets a button.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext } from "../session";
import { PlayerPicker } from "../ui/Stage";
import { eyesPatch, eyesStatus, hasLookData, lookCount } from "./eyes";
import { NO_CHOICES } from "./follow";
import { personal } from "./state";
import { YourViewControls } from "./YourView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const withLooks = hero.ids.filter((id) => hasLookData(hero, id));
const without = hero.ids.filter((id) => !hasLookData(hero, id));

const mounted: { root: Root; container: HTMLElement }[] = [];
beforeEach(() => personal.set(NO_CHOICES));
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function setup() {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, { api: null });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <PlayerPicker />
        <YourViewControls />
      </SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return { session, container };
}

function choose(select: HTMLSelectElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    set.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const eyesSelect = (c: HTMLElement) =>
  c.querySelector<HTMLSelectElement>("select[aria-label='Whose eyes']")!;
const followSelect = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLSelectElement>(".your-view-row select")].find((s) =>
    [...s.options].some((o) => o.text === "No player"),
  )!;

describe("look data of a player", () => {
  it("the export has players with and without looks in this moment", () => {
    expect(withLooks.length).toBeGreaterThan(0);
    expect(
      without.length,
      "every player has looks in hero_seed3.json; this test needs one without",
    ).toBeGreaterThan(0);
    expect(lookCount(hero, withLooks[0])).toBeGreaterThan(0);
    expect(lookCount(hero, "nobody")).toBe(0);
  });

  it("says plainly which it is", () => {
    const yes = eyesStatus(hero, withLooks[0], hero.heroId!);
    expect(yes.text).toMatch(/has \d+ looks? in this moment/);
    const no = eyesStatus(hero, without[0], hero.heroId!);
    expect(no.text).toContain("has no recorded looks in this moment");
    expect(no.button).toMatch(/^Watch through #\d+'s eyes$/);
    expect(eyesStatus(hero, without[0], without[0]).current).toBe(true);
  });

  it("the broadcast camera locks on him, the first-person view does not need it", () => {
    expect(eyesPatch({ camera: "broadcast" }, "H4")).toEqual({ povPlayer: "H4", lock: "H4" });
    expect(eyesPatch({ camera: "pov" }, "H4")).toEqual({ povPlayer: "H4" });
  });
});

describe("following a player", () => {
  it("makes him the EYES when the moment has his look data", () => {
    const other = withLooks.find((id) => id !== hero.heroId);
    expect(other).toBeDefined();
    const { session, container } = setup();
    expect(eyesSelect(container).value).toBe(hero.heroId);
    choose(followSelect(container), other!);
    expect(personal.get().player).toBe(other);
    expect(session.playback.get().povPlayer).toBe(other);
    expect(eyesSelect(container).value).toBe(other);
    expect(container.querySelector("[data-testid='follow-eyes']")?.textContent).toMatch(
      /has \d+ looks? in this moment/,
    );
  });

  it("locks the broadcast camera on him in the broadcast view", () => {
    const other = withLooks.find((id) => id !== hero.heroId)!;
    const { session, container } = setup();
    act(() => session.controls.setCamera("broadcast"));
    choose(followSelect(container), other);
    expect(session.playback.get()).toMatchObject({ povPlayer: other, lock: other });
  });

  it("without look data it says so and offers 'Watch through #N's eyes'", () => {
    const { session, container } = setup();
    const id = without[0];
    choose(followSelect(container), id);
    expect(session.playback.get().povPlayer).toBe(hero.heroId); // not switched on its own
    const box = container.querySelector("[data-testid='follow-eyes']")!;
    expect(box.textContent).toContain("has no recorded looks in this moment");
    const button = box.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toMatch(/^Watch through #\d+'s eyes$/);
    act(() => button.click());
    expect(session.playback.get().povPlayer).toBe(id);
    expect(eyesSelect(container).value).toBe(id);
    expect(container.querySelector("[data-testid='follow-eyes'] button")).toBeNull();
  });

  it("the EYES selector itself switches players", () => {
    const { session, container } = setup();
    const id = hero.ids.find((p) => p !== hero.heroId)!;
    choose(eyesSelect(container), id);
    expect(session.playback.get().povPlayer).toBe(id);
    expect(eyesSelect(container).value).toBe(id);
  });
});
