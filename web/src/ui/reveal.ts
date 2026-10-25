/**
 * Scroll-reveal hooks for the story below the live picture: `useReveal` eases an element in once,
 * `useTextReveal` lifts a heading in word by word. Both show everything at once with reduced motion.
 */
import { useCallback, useEffect, useRef, useState } from "react";

// Full opacity keeps every word AA-readable over Night and the floodlight gradients.
export const UNREVEALED_WORD_OPACITY = 1;

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

// The faded state is the reader's scroll only: a scroll that follows their wheel, touch or a
// scrolling key. A scroll the page makes (a door's deep link, a new door's top, a tour step, the
// browser keeping its place while the 3D views mount, a test driver) leaves the headings plain
// text, as an anchor jump does.
const SCROLL_KEYS = new Set([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"]);
const READER_MS = 1500; // a scroll this soon after the reader's input is theirs (momentum too)
let readerAt = -Infinity;
if (typeof window !== "undefined") {
  const input = (e: Event) => {
    if (e instanceof KeyboardEvent && !SCROLL_KEYS.has(e.key)) return;
    readerAt = performance.now();
  };
  for (const type of ["wheel", "touchmove", "keydown"])
    window.addEventListener(type, input, { capture: true, passive: true });
}
const readerScrolling = () => performance.now() - readerAt < READER_MS;

let stopTopLock: (() => void) | null = null;

/** Jump `el` to the top of the view as an anchor would: the headings around it stay plain text. */
export function jumpTo(el: Element): void {
  stopTopLock?.();
  el.scrollIntoView({ block: "start", behavior: "instant" });
}

let holding = 0; // the frame holding the top, while a smooth scroll from the last page runs out

/** Jump to the top of the page (a new door), as an anchor would. A smooth scroll still running
 * from the last page (a tour step's) is not cancelled by one jump in Chromium: the top is held for
 * a few frames, until the reader scrolls, presses a key or chooses another target. */
export function jumpToTop(): void {
  stopTopLock?.();
  const top = () => {
    if (window.scrollY === 0 && window.scrollX === 0) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };
  top();
  if (typeof requestAnimationFrame === "undefined") return;
  let frames = 30;
  const stop = () => {
    cancelAnimationFrame(holding);
    holding = 0;
    frames = 0;
    stopTopLock = null;
    for (const type of READER) window.removeEventListener(type, stop, true);
  };
  stopTopLock = stop;
  for (const type of READER) window.addEventListener(type, stop, { capture: true, once: true });
  const hold = () => {
    if (frames-- <= 0) return stop();
    top();
    holding = requestAnimationFrame(hold);
  };
  holding = requestAnimationFrame(hold);
}

/** What the reader does to scroll the page themself. */
const READER = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/** Lift words with the reader's scroll, then finish visible text within a short ease on its own. */
export function useTextReveal<T extends HTMLElement>(reduced: boolean) {
  const cleanup = useRef<() => void>(() => {});
  return useCallback(
    (el: T | null) => {
      cleanup.current();
      cleanup.current = () => {};
      if (!el) return;
      const words = [...el.querySelectorAll<HTMLElement>(".scroll-word")];
      const reset = () => {
        for (const word of words) {
          word.style.removeProperty("opacity");
          word.style.removeProperty("transform");
        }
      };
      const showAll = () => {
        for (const word of words) {
          word.style.opacity = "1";
          word.style.transform = "translateY(0px)";
        }
      };
      if (
        reduced ||
        typeof IntersectionObserver === "undefined" ||
        el.getClientRects().length === 0
      ) {
        showAll();
        cleanup.current = reset;
        return;
      }

      let observer: IntersectionObserver | null = null;
      let frame = 0;
      let done = false;
      let scrolled = false; // the lifted state is only applied once the reader scrolls
      let visibleAt: number | null = null;
      const stop = () => {
        observer?.disconnect();
        el.removeEventListener("focusin", finish);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", schedule);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      };
      const finish = () => {
        if (done) return;
        done = true;
        showAll();
        stop();
      };
      const update = () => {
        frame = 0;
        if (done) return;
        const viewport = window.innerHeight;
        const end = viewport * 0.6;
        const { top, bottom } = el.getBoundingClientRect();
        if (top <= end) {
          finish();
          return;
        }
        if (!scrolled) return; // anchor jumps, prints and stills see plain text
        const visible = top < viewport && bottom > 0;
        if (!visible) visibleAt = null;
        else visibleAt ??= performance.now();
        const elapsed = visibleAt === null ? 0 : (performance.now() - visibleAt) / 360;
        const timed = 1 - (1 - Math.min(1, Math.max(0, elapsed))) ** 3;
        const progress = Math.min(
          1,
          Math.max(timed, (viewport * 0.95 - top) / (viewport * 0.35), 0),
        );
        if (progress === 1) {
          finish();
          return;
        }
        const count = words.length;
        words.forEach((word, index) => {
          const local = Math.min(1, Math.max(0, (progress * (count + 3) - index) / 4));
          word.style.opacity = String(UNREVEALED_WORD_OPACITY);
          word.style.transform = `translateY(${8 * (1 - local)}px)`;
        });
        if (visible) schedule();
      };
      const schedule = () => {
        if (!frame && !done) frame = requestAnimationFrame(update);
      };
      const onScroll = () => {
        if (readerScrolling()) scrolled = true; // a scroll the page made: plain text
        schedule(); // passed the 60% line by any scroll: finished
      };
      el.addEventListener("focusin", finish);
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", schedule);
      observer = new IntersectionObserver(schedule, { rootMargin: "20% 0px", threshold: 0 });
      observer.observe(el);
      update();
      cleanup.current = () => {
        stop();
        reset();
      };
    },
    [reduced],
  );
}

/**
 * Ease an element in once as it scrolls into view. Stagger is capped at 5 steps of 60 ms; with
 * reduced motion (or no IntersectionObserver) no class is added; focus inside reveals at once; an
 * element already in view, or not rendered, is shown without animating. Reveal a chapter, not the
 * wrappers around it: nested reveals stack their delays.
 */
export function useReveal<T extends HTMLElement>(stagger = 0) {
  const cleanup = useRef<() => void>(() => {});
  const delay = Math.min(Math.max(stagger, 0), 5) * 60;
  return useCallback(
    (el: T | null) => {
      cleanup.current();
      cleanup.current = () => {};
      if (!el) return;
      el.style.setProperty("--reveal-delay", `${delay}ms`);
      const reset = () => {
        el.classList.remove("reveal", "reveal-pending", "reveal-visible", "reveal-now");
        el.style.removeProperty("--reveal-delay");
      };
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        typeof IntersectionObserver === "undefined"
      ) {
        cleanup.current = reset;
        return;
      }

      let shown = false;
      let observer: IntersectionObserver | null = null;
      const show = (animate: boolean) => {
        if (shown) return;
        shown = true;
        el.classList.remove("reveal-pending");
        el.classList.add("reveal-visible");
        if (!animate) el.classList.add("reveal-now");
        observer?.unobserve(el);
        el.removeEventListener("focusin", onFocus);
      };
      const onFocus = () => show(false);
      el.classList.add("reveal");
      if (el.getClientRects().length === 0 || el.getBoundingClientRect().top < window.innerHeight) {
        show(false);
      } else {
        el.classList.add("reveal-pending");
        el.addEventListener("focusin", onFocus);
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) show(true);
          },
          { threshold: 0, rootMargin: "0px 0px -8% 0px" },
        );
        observer.observe(el);
      }
      cleanup.current = () => {
        observer?.disconnect();
        el.removeEventListener("focusin", onFocus);
        reset();
      };
    },
    [delay],
  );
}
