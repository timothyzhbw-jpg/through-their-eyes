// The tours (SPEC 7). The quick tour is door 1's story (doors/), a first-time visitor's one path
// of about a minute: watch the look, remove it, compare the outcomes, see every number checked,
// then an end card whose only choices are Your turn, For studios and Watch again ("Watch the look"
// on the intro card and under the picture, ?tour=quick). The full tour walks the three doors in
// order in about ninety seconds, so a judge with three minutes sees each signature feature
// without exploring (Settings' "Full tour", ?tour=1). The studios' walk opens each step of door 3
// (?tour=story; journey/). Each step opens its door, lights up one thing the app already draws (a
// ring, the page dimmed around it where the picture is not the point), says one plain line, and
// sets the app up with the app's own controls (actions.ts).
//
// It never takes the app over: the overlay lets every click through, the card is a non-modal
// dialog, and closing it at any step (Skip tour, Done, Escape) leaves the app as that step left it.
// Reduced motion: no animated ring, no smooth scrolling.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useView, type ViewSession } from "../session";
import { openDoor } from "../doors/state";
import { openStep } from "../journey/state";
import { useStore } from "../store/store";
import { intro } from "../ui/intro";
import { revealInMenu, settingsMenu } from "../ui/Stage";
import { prefersReducedMotion } from "../yourcall/controller";
import { enterStep } from "./actions";
import { GUTTER, onScreen, PHONE_MAX, placeCard, type Box, type Keep, type Size } from "./layout";
import {
  envOf,
  indexOf,
  resolveSteps,
  secondsOf,
  stepsOf,
  targetOf,
  wordsOf,
  type TourKind,
  type TourStep,
} from "./steps";
import { closeTour, goToStep, startTour, tour } from "./tourState";
import { ACT_VIEW } from "./TourActs";
import { StepLines } from "./StepLines";
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
  // The step's door first, so what it sets up is on the page it shows (a match has no doors).
  if (step.door && session.kind === "hero") openDoor(step.door);
  cancel = enterStep(step.enter, session) ?? null;
  // The studios' steps open the journey's panel for theirs (the tour brings its target into view
  // itself).
  if (step.journey && session.kind === "hero") openStep(step.journey, { reveal: false });
}

const viewport = (): Size => ({ w: window.innerWidth, h: window.innerHeight });
const boxOf = (r: DOMRect): Box => ({ top: r.top, left: r.left, width: r.width, height: r.height });
const NOTHING = { target: null, keep: [], home: null, floor: null };
const PHONE_ROOM = 200; // px: the least room under the picture the quick tour's sheet takes

/** The quick tour's panel sits in the moment card's place (App.tsx leaves a `.tour-home` there,
 * where that slot floats over the picture): the picture's middle, the player and the pass stay
 * clear. On a phone, and where the slot is in the page's flow, the card is placed as usual. */
function homeBox(): Box | null {
  const home = document.querySelector(".stage-card > .tour-home");
  const slot = home?.parentElement;
  if (!home || !slot || getComputedStyle(slot).position !== "absolute") return null;
  const r = slot.getBoundingClientRect();
  return r.width > 0 ? boxOf(r) : null;
}

/** What the card should leave visible, by weight: what the viewer reads (the caption, the
 * moment or evidence card, Your call's and Take his eyes' cards, the board beside his eyes), then
 * the controls. */
const KEEP_CLEAR: [string, number][] = [
  [".stage-caption", 3],
  [".stage .views", 2], // the picture: on a phone it is only the top of the screen
  [".stage-card > *", 3],
  [".slot.pip", 3],
  [".yc-card", 3],
  [".te-card", 3],
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
  const kind = useStore(tour, (s) => s.kind);
  // The step on screen was set up in the other view (a start or a move since then is new).
  const switched =
    open && arrived !== null && arrived.seq === seq && arrived.session.kind !== session.kind;
  // A tour with no step this page can show (the quick tour on a stitched match) does not open.
  const empty = useMemo(
    () => open && resolveSteps(envOf(session), stepsOf(kind)).length === 0,
    [open, session, kind],
  );
  useEffect(() => {
    if (switched || empty) closeTour();
  }, [switched, empty]);
  return open && !switched && !empty
    ? createPortal(<TourOverlay session={session} />, document.body)
    : null;
}

function TourOverlay({ session }: { session: ViewSession }) {
  const at = useStore(tour, (s) => s.at);
  const seq = useStore(tour, (s) => s.seq);
  const kind = useStore(tour, (s) => s.kind);
  const env = useMemo(() => envOf(session), [session]);
  const steps = useMemo(() => resolveSteps(env, stepsOf(kind)), [env, kind]);
  const index = indexOf(steps, at);
  const step = steps[index];
  const { title, caption } = wordsOf(step, env);
  const last = index === steps.length - 1;
  const Act = step.act && session.kind === "hero" ? ACT_VIEW[step.act] : null;
  const ending = !!Act && step.act === "doors"; // the end card: its three choices are its buttons
  const focusId = useStore(tour, (s) => s.focus);
  const reduced = useMemo(prefersReducedMotion, []);

  const card = useRef<HTMLElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState(viewport);
  const [cardSize, setCardSize] = useState<Size>({ w: 400, h: 200 });
  const [seen, setSeen] = useState<{
    target: Box | null;
    keep: Keep[];
    home: Box | null;
    floor: number | null; // phone, quick tour, picture kept in view: the bottom of the picture
  }>(NOTHING);

  // Set the step up once per arrival, then hand the keyboard to the card: after the app's own
  // focus moves (closing Your call gives its pill the focus back), unless the step's own control
  // takes the keyboard (Your call's options). Back from a mode the card links to, on that link;
  // on the end card, its first choice.
  useEffect(() => arrive(session, step, seq), [session, step, seq]);
  useEffect(() => {
    if (step.focus === "app") return;
    const id = setTimeout(() => {
      const el =
        (focusId && document.getElementById(focusId)) ||
        (ending ? card.current?.querySelector<HTMLElement>(".tour-doors .btn") : null) ||
        next.current;
      el?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(id);
  }, [seq, step, focusId, ending]);

  useEffect(() => {
    const resize = () => setView(viewport());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  // Measure the card after every render, before the browser paints: a step's words change its
  // height, and it must be placed by its new height or it would hang off the screen for a frame.
  // Its whole height, not what a max-height lets show: placed by its clipped height, a card
  // under a phone's picture would settle lower and lower.
  useLayoutEffect(() => {
    const el = card.current;
    const r = el?.getBoundingClientRect();
    if (!el || !r || r.width <= 0 || r.height <= 0) return;
    const h = Math.max(r.height, el.scrollHeight);
    if (Math.abs(r.width - cardSize.w) > 0.5 || Math.abs(h - cardSize.h) > 0.5) {
      setCardSize({ w: r.width, h });
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
    // A target more than a screen and a half away is jumped to, not scrolled to: a smooth scroll
    // that far ran the whole story past the viewer for a second and a half (the failure drill).
    // A target in the header's ⋯ menu (who is watching) is shown by opening the menu; the step
    // closes it again when it leaves.
    let opened = false;
    const tick = () => {
      const el = targetOf(step);
      if (!opened && el && revealInMenu(el)) opened = true; // once: the viewer may close it
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
            const far = raw.bottom < -0.5 * innerHeight || raw.top > 1.5 * innerHeight;
            el.scrollIntoView({
              block: el.closest(".stage") ? "nearest" : "start",
              behavior: far && !reduced ? "instant" : behavior,
            });
          }
        }
      }
      const box = el ? visibleBox(el, clips) : null;
      const keep = el ? keepClear(el) : [];
      const home = homeBox();
      const views = document.querySelector(".stage .views")?.getBoundingClientRect();
      const floor =
        kind === "quick" && !step.dim && innerWidth < PHONE_MAX && views && views.height > 0
          ? Math.round(views.bottom)
          : null;
      const key = JSON.stringify([box, keep, home, floor]);
      if (key !== last) {
        last = key;
        setSeen({ target: box, keep, home, floor });
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      if (opened) settingsMenu.set({ open: false });
    };
  }, [step, seq, reduced, kind]);

  // While the page scrolls the ring moves with what it frames, without its glide (the glide is for
  // moving between steps): gliding, it trailed the target and framed whatever scrolled past.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let settle = 0;
    const onScroll = () => {
      root.current?.classList.add("scrolling");
      window.clearTimeout(settle);
      settle = window.setTimeout(() => root.current?.classList.remove("scrolling"), 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.clearTimeout(settle);
    };
  }, []);

  // On a phone the card folds into a bar once the viewer touches the app (Your call's options,
  // the evidence card): the card would cover what they are using. It opens again on each step.
  const phone = view.w < PHONE_MAX;
  const [folded, setFolded] = useState(false);
  // The quick tour's step on a feature with its own card (Your call): on a phone that card tells
  // the step, so the tour's card starts as a bar.
  const foldOnArrival = kind === "quick" && phone && step.focus === "app";
  useEffect(() => setFolded(foldOnArrival), [seq, foldOnArrival]);
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
  // The quick tour keeps the picture clear on a step that leaves it undimmed: on a wide screen in
  // the moment card's place, on a phone under the picture (scrolling inside when a small phone has
  // too little room there). A dim step is placed clear of the evidence card it points at.
  const under = seen.floor !== null && view.h - seen.floor - GUTTER >= PHONE_ROOM;
  const place: { top: number; left: number; width: number; maxHeight?: number } =
    seen.home && !phone
      ? {
          top: Math.max(GUTTER, Math.min(seen.home.top, view.h - GUTTER - cardSize.h)),
          left: seen.home.left,
          width: seen.home.width,
        }
      : under
        ? (() => {
            const top = Math.max(seen.floor! + 8, view.h - GUTTER - cardSize.h);
            return {
              top,
              left: GUTTER,
              width: view.w - 2 * GUTTER,
              maxHeight: view.h - GUTTER - top,
            };
          })()
        : placeCard(ring, view, cardSize, seen.keep);
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
      ref={root}
      className={["tour", reduced && "reduced", step.dim && "dim"].filter(Boolean).join(" ")}
      data-step={step.id}
      data-kind={kind}
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
              {KICKER[kind]} · {index + 1} of {steps.length}
            </p>
            <h2 id="tour-title" className="tour-title">
              {title}
            </h2>
            <p id="tour-caption" className="tour-caption" hidden={folded}>
              {caption}
            </p>
          </div>
        </div>
        {step.say && !folded && session.kind === "hero" && <StepLines say={step.say} />}
        {Act && !folded && (
          <div className="tour-act">
            <Act />
          </div>
        )}
        {/* The end card's choices are its only buttons (folded on a phone: Show, to see them). */}
        {(!ending || folded) && (
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
              <button type="button" className="btn btn-quiet" onClick={() => closeTour()}>
                Skip tour
              </button>
            )}
            {!ending && (
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
                  onClick={last ? () => closeTour() : () => go(index + 1)}
                >
                  {last ? "Done" : "Next"}
                </button>
              </span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const TOUR_LABEL: Record<TourKind, string> = {
  quick: "Watch the look",
  full: "Full tour · 90 s",
  story: `For studios · ${secondsOf("story")} s`, // its steps' holds (steps.json)
};

/** The tour card's kicker. */
const KICKER: Record<TourKind, string> = { quick: "The look", full: "Tour", story: "For studios" };

/** Start a tour at its first step ("Watch the look", "Full tour · 90 s", the studios' walk);
 * closes the intro card. */
export function TourButton({
  className = "btn btn-quiet",
  kind = "full",
}: {
  className?: string;
  kind?: TourKind;
}) {
  return (
    <button
      type="button"
      className={`${className} tour-start`}
      onClick={() => {
        intro.set({ open: false });
        startTour(null, kind);
      }}
    >
      {TOUR_LABEL[kind]}
    </button>
  );
}
