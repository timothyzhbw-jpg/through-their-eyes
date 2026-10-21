// @vitest-environment happy-dom
// Panels below the live screen follow the playhead only while they can be seen (SPEC 7: smooth on
// a phone). Off screen or in a hidden tab they hold still; back on screen they catch up at once.
// The telemetry's curves are built once per run and player, not on every frame.

import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext } from "../session";
import { createStore } from "../store/store";
import { linePath } from "../telemetry/telemetry";
import { useOnScreen, useStoreWhile } from "./onScreen";
import { TelemetryPanel } from "./TelemetryPanel";

vi.mock("../telemetry/telemetry", async (original) => {
  const m = await original<typeof import("../telemetry/telemetry")>();
  return { ...m, linePath: vi.fn(m.linePath) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** An IntersectionObserver the test moves elements in and out of view with. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets: Element[] = [];
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.targets.length = 0;
  }
  takeRecords() {
    return [];
  }
  static show(on: boolean) {
    for (const o of FakeObserver.all) {
      const entries = o.targets.map((target) => ({ target, isIntersecting: on }));
      act(() => o.callback(entries as IntersectionObserverEntry[], o as never));
    }
  }
}

let hidden = false;
const mounted: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  hidden = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
});
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

function setHidden(on: boolean) {
  hidden = on;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}

describe("useOnScreen and useStoreWhile", () => {
  const store = createStore({ frame: 0 });
  let renders = 0;
  function Probe() {
    const ref = useRef<HTMLParagraphElement>(null);
    const shown = useOnScreen(ref);
    const frame = useStoreWhile(shown, store, (s) => s.frame);
    renders++;
    return (
      <p ref={ref} data-shown={String(shown)}>
        {frame}
      </p>
    );
  }

  it("follows the store on screen, holds off screen, and catches up when back", () => {
    store.set({ frame: 0 });
    renders = 0;
    const el = mount(<Probe />);
    expect(el.textContent).toBe("0");
    expect(FakeObserver.all[0].options?.rootMargin).toBe("200px"); // updated before it scrolls in
    act(() => store.set({ frame: 5 }));
    expect(el.textContent).toBe("5");

    FakeObserver.show(false);
    const before = renders;
    for (let f = 6; f < 30; f++) act(() => store.set({ frame: f }));
    expect(renders).toBe(before); // no re-render for frames no one sees
    expect(el.textContent).toBe("5");

    FakeObserver.show(true);
    expect(el.textContent).toBe("29");
    act(() => store.set({ frame: 30 }));
    expect(el.textContent).toBe("30");
  });

  it("holds while the tab is hidden, though the panel is on screen", () => {
    store.set({ frame: 0 });
    const el = mount(<Probe />);
    setHidden(true);
    expect(el.querySelector("p")!.dataset.shown).toBe("false");
    for (let f = 1; f < 10; f++) act(() => store.set({ frame: f }));
    expect(el.textContent).toBe("0");
    setHidden(false);
    expect(el.textContent).toBe("9");
  });

  it("without IntersectionObserver, always follows", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    store.set({ frame: 0 });
    const el = mount(<Probe />);
    act(() => store.set({ frame: 3 }));
    expect(el.textContent).toBe("3");
  });
});

describe("the telemetry panel", () => {
  const hero = parseHero(raw);
  const cursor = (el: HTMLElement) =>
    Number(el.querySelector('[data-row="head"] [data-cursor]')!.getAttribute("x1"));

  it("moves its cursor with the playhead without rebuilding its curves", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    const el = mount(
      <SessionContext.Provider value={session}>
        <TelemetryPanel />
      </SessionContext.Provider>,
    );
    act(() => session.playback.set({ frame: 10 }));
    const built = vi.mocked(linePath).mock.calls.length;
    expect(built).toBeGreaterThan(0);
    const x0 = cursor(el);
    for (let f = 11; f < 40; f++) act(() => session.playback.set({ frame: f }));
    expect(cursor(el)).toBeGreaterThan(x0);
    expect(vi.mocked(linePath).mock.calls.length).toBe(built);
    // Switching the run draws the other run's curves.
    act(() => session.playback.set({ mode: "counterfactual" }));
    expect(vi.mocked(linePath).mock.calls.length).toBeGreaterThan(built);
  });

  it("holds its cursor off screen and puts it on the playhead when it comes back", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    const el = mount(
      <SessionContext.Provider value={session}>
        <TelemetryPanel />
      </SessionContext.Provider>,
    );
    act(() => session.playback.set({ frame: 10 }));
    const at10 = cursor(el);
    FakeObserver.show(false);
    act(() => session.playback.set({ frame: 60 }));
    expect(cursor(el)).toBe(at10);
    FakeObserver.show(true);
    expect(cursor(el)).toBeGreaterThan(at10);
  });
});
