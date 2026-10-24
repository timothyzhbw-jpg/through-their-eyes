import { useCallback, useRef } from "react";

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
