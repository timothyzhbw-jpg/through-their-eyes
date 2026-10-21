// Panels below the live screen follow the playhead only while someone can see them: off screen,
// or in a hidden tab, a re-render on every frame is work for no one, and on a phone it takes
// main-thread time from the views (SPEC 7). The canvases need none of this: they draw from
// requestAnimationFrame, which the browser already stops in a hidden tab.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useStore, type Store } from "../store/store";

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Whether `ref`'s element is within `margin` of the viewport, in a visible tab. True until
 * measured, and always where there is no IntersectionObserver (server rendering).
 */
export function useOnScreen(ref: RefObject<Element | null>, margin = "200px"): boolean {
  const [near, setNear] = useState(true);
  const [hidden, setHidden] = useState(isHidden);
  useEffect(() => {
    const onVisibility = () => setHidden(isHidden());
    document.addEventListener("visibilitychange", onVisibility);
    const el = ref.current;
    const observer =
      el && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => setNear(entries[entries.length - 1].isIntersecting),
            {
              rootMargin: margin,
            },
          )
        : null;
    if (el) observer?.observe(el);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, [ref, margin]);
  return near && !hidden;
}

/** `useStore` while `follow` is true; while it is false, the last value, so changes do not
 * re-render. When `follow` turns true again the component re-renders with the current value. */
export function useStoreWhile<T, U>(
  follow: boolean,
  store: Store<T>,
  selector: (state: T) => U,
): U {
  const held = useRef<{ value: U } | null>(null);
  const value = useStore(store, (s) =>
    follow || !held.current ? selector(s) : held.current.value,
  );
  useEffect(() => {
    held.current = { value };
  });
  return value;
}
