// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chapter } from "./Chapter";
import { FloodlightBackground } from "./FloodlightBackground";
import { useReveal } from "./reveal";
import { TextReveal } from "./TextReveal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets: Element[] = [];
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  intersect(on: boolean) {
    act(() =>
      this.callback(
        this.targets.map((target) => ({
          target,
          isIntersecting: on,
        })) as IntersectionObserverEntry[],
        this as unknown as IntersectionObserver,
      ),
    );
  }
}

const mounted: { root: Root; container: HTMLElement }[] = [];
let reduced = false;

function rect(top: number, bottom = top + 100): DOMRect {
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top } as DOMRect;
}

function mount(stagger = 0) {
  function Probe() {
    const ref = useReveal<HTMLDivElement>(stagger);
    return (
      <div ref={ref}>
        <button type="button">Read more</button>
      </div>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  mounted.push({ root, container });
  return container.firstElementChild as HTMLElement;
}

beforeEach(() => {
  reduced = false;
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({ matches: reduced && query === "(prefers-reduced-motion: reduce)" }) as MediaQueryList,
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(rect(1000));
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    rect(1000),
  ] as unknown as DOMRectList);
});

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scroll reveal", () => {
  it("adds no animation class with reduced motion", () => {
    reduced = true;
    const el = mount();
    expect(el.className).toBe("");
    expect(FakeObserver.all).toHaveLength(0);
  });

  it("shows elements already in view at once", () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue(rect(20));
    const el = mount();
    expect(el.classList.contains("reveal-visible")).toBe(true);
    expect(el.classList.contains("reveal-now")).toBe(true);
    expect(el.classList.contains("reveal-pending")).toBe(false);
    expect(FakeObserver.all).toHaveLength(0);
  });

  it("gives an observed element the visible class once", () => {
    const el = mount();
    const observer = FakeObserver.all[0];
    expect(el.classList.contains("reveal-pending")).toBe(true);
    observer.intersect(true);
    expect(el.classList.contains("reveal-visible")).toBe(true);
    expect(el.classList.contains("reveal-pending")).toBe(false);
    expect(observer.unobserve).toHaveBeenCalledTimes(1);
    observer.intersect(false);
    observer.intersect(true);
    expect(observer.unobserve).toHaveBeenCalledTimes(1);
    expect(el.classList.contains("reveal-visible")).toBe(true);
  });

  it("reveals at once when focused before entering the viewport", () => {
    const el = mount();
    act(() =>
      el.querySelector("button")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true })),
    );
    expect(el.classList.contains("reveal-visible")).toBe(true);
    expect(el.classList.contains("reveal-now")).toBe(true);
    expect(el.classList.contains("reveal-pending")).toBe(false);
    expect(FakeObserver.all[0].unobserve).toHaveBeenCalledTimes(1);
  });

  it("shows an element that is not rendered without animating it", () => {
    vi.mocked(Element.prototype.getClientRects).mockReturnValue([] as unknown as DOMRectList);
    const el = mount();
    expect(el.classList.contains("reveal-now")).toBe(true);
    expect(el.classList.contains("reveal-pending")).toBe(false);
    expect(FakeObserver.all).toHaveLength(0);
  });

  it("sets the stagger delay, capped at five steps of 60 ms", () => {
    expect(mount(2).style.getPropertyValue("--reveal-delay")).toBe("120ms");
    expect(mount(9).style.getPropertyValue("--reveal-delay")).toBe("300ms");
  });

  it("disconnects and clears its classes when the element goes away", () => {
    const el = mount();
    const observer = FakeObserver.all[0];
    act(() => mounted[0].root.render(<div />));
    expect(observer.disconnect).toHaveBeenCalled();
    expect(el.className).toBe("");
    expect(el.style.getPropertyValue("--reveal-delay")).toBe("");
  });

  it("re-runs when the stagger changes", () => {
    function Probe({ n }: { n: number }) {
      const ref = useReveal<HTMLDivElement>(n);
      return <div ref={ref} />;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => root.render(<Probe n={1} />));
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue("--reveal-delay")).toBe("60ms");
    act(() => root.render(<Probe n={3} />));
    expect(el.style.getPropertyValue("--reveal-delay")).toBe("180ms");
    expect(FakeObserver.all[0].disconnect).toHaveBeenCalled();
  });

  it("gives a chapter a single pending ancestor over its content", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() =>
      root.render(
        <Chapter className="x" kicker="k" title="t" lede="l">
          <p>body</p>
        </Chapter>,
      ),
    );
    expect(container.querySelectorAll(".reveal-pending")).toHaveLength(1);
    expect(container.querySelector(".chapter-title")!.closest(".reveal-pending")).toBe(
      container.querySelector("section"),
    );
  });
});

describe("scroll-linked text and floodlight", () => {
  function mountText() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() =>
      root.render(
        <h2>
          <TextReveal>
            Why tactics <em>work.</em>
          </TextReveal>
        </h2>,
      ),
    );
    return container.querySelector("h2")!;
  }

  function flushScroll() {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frames.splice(0).forEach((callback) => callback(0)));
  }

  it("shows every word at once and holds the background with reduced motion", () => {
    reduced = true;
    const heading = mountText();
    const words = heading.querySelectorAll<HTMLElement>(".scroll-word");
    expect(heading.textContent).toBe("Why tactics work.");
    for (const word of words) {
      expect(word.style.opacity).toBe("1");
      expect(word.style.transform).toBe("translateY(0px)");
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => root.render(<FloodlightBackground />));
    expect(container.querySelector(".floodlight-background")!.getAttribute("data-paused")).toBe(
      "true",
    );
  });

  it("pauses the background while the tab is hidden", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => root.render(<FloodlightBackground />));
    const background = container.querySelector(".floodlight-background")!;
    expect(background.getAttribute("data-paused")).toBe("false");
    const ownHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    if (ownHidden) Object.defineProperty(document, "hidden", ownHidden);
    else Reflect.deleteProperty(document, "hidden");
    expect(background.getAttribute("data-paused")).toBe("true");
  });

  it("keeps the text in the DOM and finishes every word after scrolling past", () => {
    const heading = mountText();
    expect(heading.textContent).toBe("Why tactics work.");
    expect(heading.querySelectorAll(".scroll-word")).toHaveLength(3);
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue(rect(100));
    flushScroll();
    for (const word of heading.querySelectorAll<HTMLElement>(".scroll-word")) {
      expect(word.style.opacity).toBe("1");
      expect(word.style.transform).toBe("translateY(0px)");
    }
  });

  it("finishes the whole heading when its top reaches 60 percent of the viewport", () => {
    const heading = mountText();
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue(
      rect(window.innerHeight * 0.6),
    );
    flushScroll();
    for (const word of heading.querySelectorAll<HTMLElement>(".scroll-word")) {
      expect(word.style.opacity).toBe("1");
    }
  });
});
