// Verified numbers with presence (SPEC 7): the first time a verified number comes up it counts up
// from zero in its own format and lands with a check stamp. Cosmetic only: the page's text is the
// verified value all along (the counting digits are drawn by CSS on top of it, and screen readers
// never get them), and under reduced motion the value and the stamp are there at once.

import { useEffect, useRef, useState } from "react";
import { motion } from "../beat/beat";
import { useStore } from "../store/store";
import { CheckIcon } from "./icons";

export const COUNT_MS = 650;
const NUMBER = /^(.*?)(\d+(?:\.\d+)?)(.*)$/su;

const counted = new Set<string>(); // numbers that have counted up once on this page

/** For tests: every number counts again. */
export function forgetCounts(): void {
  counted.clear();
}

/** `text` with its first number at `progress` (0..1) of its value; at 1, exactly `text`. */
export function countText(text: string, progress: number): string {
  if (progress >= 1) return text;
  const m = NUMBER.exec(text);
  if (!m) return text;
  const [, before, digits, after] = m;
  const decimals = digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0;
  const scale = 10 ** decimals;
  // Round down, so the count never shows more than the verified value.
  const value = Math.floor(Number(digits) * Math.max(0, progress) * scale + 1e-9) / scale;
  return `${before}${value.toFixed(decimals)}${after}`;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * One verified number. `id` names it (line and position), so it counts only the first time;
 * `whenVisible` waits until it is scrolled into view (below the fold).
 */
export function CountUp({
  text,
  id,
  whenVisible = false,
}: {
  text: string;
  id: string;
  whenVisible?: boolean;
}) {
  const reduced = useStore(motion, (s) => s.reduced);
  const [progress, setProgress] = useState(() => (reduced || counted.has(id) ? 1 : 0));
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (progress >= 1) return;
    if (reduced) return setProgress(1);
    let raf = 0;
    let observer: IntersectionObserver | null = null;
    const run = () => {
      counted.add(id);
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / COUNT_MS);
        setProgress(t >= 1 ? 1 : easeOut(t));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (whenVisible && typeof IntersectionObserver !== "undefined" && el.current) {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer?.disconnect();
        run();
      });
      observer.observe(el.current);
    } else run();
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
    // Counting is started once per mount; a new text is a new id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reduced]);
  const done = progress >= 1;
  // The text in the page is always the verified value; while counting it is transparent and the
  // digits on top are drawn from data-count by CSS, with empty alt text for screen readers.
  return (
    <span
      ref={el}
      className={done ? "count done" : "count counting"}
      data-count={done ? undefined : countText(text, progress)}
    >
      <span className="count-value">{text}</span>
      {/* There from the start, hidden while counting, so the line does not move when it lands. */}
      <span className="stamp" aria-hidden="true">
        <CheckIcon />
      </span>
    </span>
  );
}
