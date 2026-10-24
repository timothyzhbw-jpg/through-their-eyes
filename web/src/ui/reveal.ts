/**
 * Scroll-reveal hooks for the story below the live picture: `useReveal` eases an element in once,
 * `useTextReveal` fades a heading in word by word. Both show everything at once with reduced motion.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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

/** Reveal each word over the scroll interval ending with the element top at 60% of the viewport. */
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
      let scrolled = false; // the faded state is only applied once the reader scrolls
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
        const top = el.getBoundingClientRect().top;
        if (top <= end) {
          finish();
          return;
        }
        if (!scrolled) return; // anchor jumps, prints and stills see plain text
        const progress = Math.min(1, Math.max(0, (viewport * 0.95 - top) / (viewport * 0.35)));
        const count = words.length;
        words.forEach((word, index) => {
          const local = Math.min(1, Math.max(0, (progress * (count + 3) - index) / 4));
          word.style.opacity = String(0.15 + local * 0.85);
          word.style.transform = `translateY(${8 * (1 - local)}px)`;
        });
      };
      const schedule = () => {
        if (!frame && !done) frame = requestAnimationFrame(update);
      };
      const onScroll = () => {
        scrolled = true;
        schedule();
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
