// The judge tour (SPEC 7): an optional walk of about ninety seconds through the signature
// features, so a judge with three minutes sees each of them without exploring. Each step lights up
// one thing the app already draws (a ring, the page dimmed around it where the picture is not the
// point), says one plain line, and sets the app up with the app's own controls (actions.ts).
//
// It never takes the app over: the overlay lets every click through, the card is a non-modal
// dialog, and closing it at any step (Skip tour, Done, Escape) leaves the app as that step left it.
// Started from "Take the 90-second tour" (the lineup card, the moment card, the story) or the
// link ?tour=1 (deeplink.ts). Reduced motion: no animated ring, no smooth scrolling.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useView, type ViewSession } from "../session";
import { useStore } from "../store/store";
import { intro } from "../ui/intro";
import { prefersReducedMotion } from "../yourcall/controller";
import { enterStep } from "./actions";
import { onScreen, PHONE_MAX, placeCard, type Box, type Keep, type Size } from "./layout";
import { envOf, indexOf, resolveSteps, targetOf, wordsOf, type TourStep } from "./steps";
import { closeTour, goToStep, startTour, tour } from "./tourState";
import { ACT_VIEW } from "./TourActs";
import "./tour.css";

const RING_PAD = 6; // px between the target and its ring

// The arrival the current step was set up for, and how to cancel what it still waits for. Module
// scope: the overlay may mount again (StrictMode, a match opening a hero moment) without arriving.
let arrived: { seq: number; session: ViewSession } | null = null;
let cancel: (() => void) | null = null;
tour.subscribe(() => {
  if (tour.get().open) return;
  cancel?.();
  cancel = null;
});

function arrive(session: ViewSession, step: TourStep, seq: number) {
  if (arrived?.seq === seq && arrived.session === session) return;
  arrived = { seq, session };
  cancel?.();
  cancel = null;
  cancel = enterStep(step.enter, session) ?? null;
}

const viewport = (): Size => ({ w: window.innerWidth, h: window.innerHeight });
const boxOf = (r: DOMRect): Box => ({ top: r.top, left: r.left, width: r.width, height: r.height });
const NOTHING = { target: null, keep: [] };

/** What the card should leave visible, by weight: what the viewer reads (the caption, the
 * moment or evidence card, Your call's card, the board beside his eyes), then the controls. */
const KEEP_CLEAR: [string, number][] = [
  [".stage-caption", 3],
  [".stage .views", 2], // the picture: on a phone it is only the top of the screen
  [".stage-card > *", 3],
  [".slot.pip", 3],
  [".yc-card", 3],
  [".stage-run", 2],
  [".header-end", 2],
  [".transport", 2],
  [".stage-top", 1],
  [".stage-head .brand", 1],
];
const CAPTION_ROOM = 110; // px: the caption's slot is empty between lines, keep a line's room

function keepClear(target: Element): Keep[] {
  const keep: Keep[] = [];
  for (const [selector, weight] of KEEP_CLEAR) {
    const el = document.querySelector(selector);
    if (!el || el === target || target.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) continue;
    const box = boxOf(r);
    if (selector === ".stage-caption" && box.height < CAPTION_ROOM) {
      box.top = r.bottom - CAPTION_ROOM;
      box.height = CAPTION_ROOM;
    }
    if (box.height <= 0) continue;
    // Around the target (the evidence card around its wrong-number box): it matters less.
    keep.push({ box, weight: el.contains(target) ? 1 : weight });
  }
  return keep;
}

/** The ancestors that clip what they hold (the moment card scrolls): a ring stays inside them. */
function clippers(el: Element): Element[] {
  const out: Element[] = [];
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(a);
    if (overflowX !== "visible" || overflowY !== "visible") out.push(a);
  }
  return out;
}

/** The part of the element one can see: inside its clipping ancestors and the screen. */
function visibleBox(el: Element, clips: Element[]): Box | null {
  const r = el.getBoundingClientRect();
  let top = r.top;
  let left = r.left;
  let bottom = r.bottom;
  let right = r.right;
  for (const c of clips) {
    const b = c.getBoundingClientRect();
    top = Math.max(top, b.top);
    left = Math.max(left, b.left);
    bottom = Math.min(bottom, b.bottom);
    right = Math.min(right, b.right);
  }
  top = Math.max(top, 0);
  left = Math.max(left, 0);
  bottom = Math.min(bottom, window.innerHeight);
  right = Math.min(right, window.innerWidth);
  return bottom > top && right > left
    ? { top, left, width: right - left, height: bottom - top }
    : null;
}

/** The tour over the page, while it is open: the hero moment's steps, or a stitched match's (its
 * recap, reached by the hero page's link). A tour still open when the view switches between a
 * match and one of its hero moments' breakdowns closes: its steps belong to the other view. */
export function Tour() {
  const session = useView();
  const open = useStore(tour, (s) => s.open);
  const seq = useStore(tour, (s) => s.seq);
  // The step on screen was set up in the other view (a start or a move since then is new).
  const switched =
    open && arrived !== null && arrived.seq === seq && arrived.session.kind !== session.kind;
  useEffect(() => {
    if (switched) closeTour();
  }, [switched]);
  return open && !switched ? createPortal(<TourOverlay session={session} />, document.body) : null;
}

function TourOverlay({ session }: { session: ViewSession }) {
  const at = useStore(tour, (s) => s.at);
  const seq = useStore(tour, (s) => s.seq);
  const env = useMemo(() => envOf(session), [session]);
  const steps = useMemo(() => resolveSteps(env), [env]);
  const index = indexOf(steps, at);
  const step = steps[index];
  const { title, caption } = wordsOf(step, env);
  const last = index === steps.length - 1;
  const Act = step.act && session.kind === "hero" ? ACT_VIEW[step.act] : null;
  const reduced = useMemo(prefersReducedMotion, []);

  const card = useRef<HTMLElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState(viewport);
  const [cardSize, setCardSize] = useState<Size>({ w: 400, h: 200 });
  const [seen, setSeen] = useState<{ target: Box | null; keep: Keep[] }>(NOTHING);

  // Set the step up once per arrival, then hand the keyboard to the card: after the app's own
  // focus moves (closing Your call gives its pill the focus back), unless the step's own control
  // takes the keyboard (Your call's options).
  useEffect(() => arrive(session, step, seq), [session, step, seq]);
  useEffect(() => {
    if (step.focus === "app") return;
    const id = setTimeout(() => next.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(id);
  }, [seq, step]);

  useEffect(() => {
    const resize = () => setView(viewport());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  // Measure the card after every render, before the browser paints: a step's words change its
  // height, and it must be placed by its new height or it would hang off the screen for a frame.
  useLayoutEffect(() => {
    const r = card.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return;
    if (Math.abs(r.width - cardSize.w) > 0.5 || Math.abs(r.height - cardSize.h) > 0.5) {
      setCardSize({ w: r.width, h: r.height });
    }
  });

  // Follow the target every frame (it may appear late, grow, move with the layout or scroll; a
  // later selector can take over, as the verifier's answer does), and bring it into view when it
  // is new or has grown: on the live screen as little as needed (inside the moment card too), in
  // the story to the top.
  useEffect(() => {
    let frame = 0;
    let shownFor: Element | null = null;
    let shownHeight = 0;
    let clips: Element[] = [];
    let last = "";
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";
    const tick = () => {
      const el = targetOf(step);
      const raw = el?.getBoundingClientRect();
      // A new target, or this one grown (the wrong-number box opening): show it whole.
      if (el && raw && (el !== shownFor || Math.abs(raw.height - shownHeight) > 24)) {
        if (raw.width > 0 && raw.height > 0) {
          if (el !== shownFor) clips = clippers(el);
          shownFor = el;
          shownHeight = raw.height;
          const seen = visibleBox(el, clips);
          const cut = !seen || seen.height < raw.height - 1 || seen.width < raw.width - 1;
          if (cut || !onScreen(boxOf(raw), viewport())) {
            el.scrollIntoView({ block: el.closest(".stage") ? "nearest" : "start", behavior });
          }
        }
      }
      const box = el ? visibleBox(el, clips) : null;
      const keep = el ? keepClear(el) : [];
      const key = JSON.stringify([box, keep]);
      if (key !== last) {
        last = key;
        setSeen({ target: box, keep });
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [step, seq, reduced]);

  // On a phone the card folds into a bar once the viewer touches the app (Your call's options,
  // the evidence card): the card would cover what they are using. It opens again on each step.
  const phone = view.w < PHONE_MAX;
  const [folded, setFolded] = useState(false);
  useEffect(() => setFolded(false), [seq]);
  useEffect(() => {
    if (!phone) return;
    const down = (e: PointerEvent) => {
      if (card.current && !card.current.contains(e.target as Node)) setFolded(true);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [phone]);

  const { target } = seen;
  const ring = target && {
    top: target.top - RING_PAD,
    left: target.left - RING_PAD,
    width: target.width + 2 * RING_PAD,
    height: target.height + 2 * RING_PAD,
  };
  const place = placeCard(ring, view, cardSize, seen.keep);
  const go = (k: number) => {
    const to = steps[k];
    if (to) goToStep(to.id);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeTour();
    else if (e.key === "ArrowRight" && !last) go(index + 1);
    else if (e.key === "ArrowLeft" && index > 0) go(index - 1);
    else return;
    e.preventDefault();
    e.stopPropagation(); // the app's own Escape (Your call, menus) stays with the app
  };

  return (
    <div
      className={["tour", reduced && "reduced", step.dim && "dim"].filter(Boolean).join(" ")}
      data-step={step.id}
    >
      {ring && <div className="tour-ring" style={ring} aria-hidden="true" />}
      <section
        ref={card}
        className={folded ? "tour-card folded" : "tour-card"}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-caption"
        style={place}
        onKeyDown={onKeyDown}
      >
        {/* The live region stays; the words inside it are new on each step (and fade in). */}
        <div aria-live="polite" className="tour-say">
          <div key={seq} className="tour-words">
            <p className="kicker accent">
              Tour · {index + 1} of {steps.length}
            </p>
            <h2 id="tour-title" className="tour-title">
              {title}
            </h2>
            <p id="tour-caption" className="tour-caption" hidden={folded}>
              {caption}
            </p>
          </div>
        </div>
        {Act && !folded && (
          <div className="tour-act">
            <Act />
          </div>
        )}
        <div className="tour-nav">
          {folded ? (
            <button
              type="button"
              className="btn btn-quiet"
              aria-expanded={false}
              aria-controls="tour-caption"
              onClick={() => setFolded(false)}
            >
              Show
            </button>
          ) : last ? (
            <button type="button" className="btn btn-quiet" onClick={() => go(0)}>
              Start again
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={closeTour}>
              Skip tour
            </button>
          )}
          <span className="tour-moves">
            {!folded && (
              <button
                type="button"
                className="btn"
                disabled={index === 0}
                onClick={() => go(index - 1)}
              >
                Back
              </button>
            )}
            <button
              ref={next}
              type="button"
              className="btn btn-primary"
              onClick={last ? closeTour : () => go(index + 1)}
            >
              {last ? "Done" : "Next"}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}

/** "Take the 90-second tour": closes the lineup card if it is up, and starts at the first step. */
export function TourButton({ className = "btn btn-quiet" }: { className?: string }) {
  return (
    <button
      type="button"
      className={`${className} tour-start`}
      onClick={() => {
        intro.set({ open: false });
        startTour();
      }}
    >
      Take the 90-second tour
    </button>
  );
}
