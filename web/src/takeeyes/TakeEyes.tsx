// "Take his eyes" (SPEC 3.7, 7): the viewer chooses when and where the hero looks, and the sim
// re-runs the moment with that look as his only one between the pass and his decision. Every
// look of the grid was re-simulated ahead of time (looks.ts); this is the screen.
//
// The stage is the app's own views in a derived session (controller.ts): the tactical board with
// a dial over the hero (drag or tap the cone round him, snapped to the grid's directions; the
// directions are also a group of radio buttons) and the first-person view. A timeline under them
// picks the time. Looking plays the moment through his eyes with the look; the result shows both
// runs as ghost paths (the gold one never happened), or his picture at the decision with the look
// or with none. The card speaks only in verified lines.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { wrapAngle, type Hero } from "../data/hero";
import { shortName } from "../data/roster";
import type { Vec2 } from "../data/types";
import type { Narration } from "../narration/payload";
import { toPitch, toScreen } from "../options/passOptions";
import { SessionContext, useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { isVerified, KindTags, LineText, lineClaims } from "../ui/Narration";
import { Segmented } from "../ui/Segmented";
import { PovView } from "../views/PovView";
import { boardZoom } from "../views/scene";
import { TacticalView } from "../views/TacticalView";
import { LANGUAGES, type Language } from "../whatif/whatif";
import { startTakeEyesClock, takeEyesOf, type TakeEyes } from "./controller";
import type { ResultView } from "./flow";
import {
  aroundHim,
  callLabel,
  cellAt,
  secondsBefore,
  snapOffset,
  whereLabel,
  type LookEntry,
  type Looks,
} from "./looks";
import "./takeeyes.css";

const FALLBACK_SIZE = { w: 640, h: 400 }; // before the view is measured (and in tests)
const DIAL_M = 16; // the dial's radius on the pitch, metres…
const DIAL_PX = [64, 150] as const; // …kept within these pixels

/** The hero moment's Take his eyes controller. */
export function useTakeEyes(): TakeEyes {
  return takeEyesOf(useSession());
}

/** Whether Take his eyes has the stage. */
export function useTakeEyesOpen(): boolean {
  return useStore(useTakeEyes().state, (s) => s.step !== "closed");
}

/** What Take his eyes is, in plain words: its subtitle wherever it is named. */
export const TAKE_EYES_SUB = "Choose when and where he looks";

/** The header button that opens Take his eyes (pressed while it is open). */
export function TakeEyesButton() {
  const te = useTakeEyes();
  const open = useStore(te.state, (s) => s.step !== "closed");
  return (
    <button
      id="take-eyes-open"
      type="button"
      className="btn te-open"
      aria-pressed={open}
      disabled={!!te.unavailable}
      title={te.unavailable ?? `${TAKE_EYES_SUB}; the sim re-runs the moment`}
      onClick={() => (open ? te.close() : te.open())}
    >
      Take his eyes
    </button>
  );
}

function useSize(fallback: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The live screen's place while Take his eyes is open: the same header, then the stage. */
export function TakeEyesScreen({ start, scene = true }: { start: ReactNode; scene?: boolean }) {
  const te = useTakeEyes();
  return (
    <section
      className="stage te-screen"
      aria-label="Take his eyes"
      onKeyDown={(e) => {
        if (e.key === "Escape") te.close();
      }}
    >
      <header className="stage-head">
        <div className="brand">
          <h1>Through Their Eyes</h1>
          <p className="sub">
            A synthetic match<span className="sub-more"> · every player fictional</span>
          </p>
        </div>
        <div className="header-start">{start}</div>
        <div className="header-end">
          <TakeEyesButton />
        </div>
      </header>
      <TakeEyesStage scene={scene} />
    </section>
  );
}

/** The stage while Take his eyes is open: the views, the timeline and the card. `scene`: draw the
 * 3D view and the board (WebGL). */
export function TakeEyesStage({ scene = true }: { scene?: boolean }) {
  const te = useTakeEyes();
  const step = useStore(te.state, (s) => s.step);
  useEffect(() => startTakeEyesClock(te), [te]);
  if (step === "closed") return null;
  return (
    <div className="takeeyes">
      {te.looks() ? <EyesView te={te} scene={scene} /> : <div className="te-view te-empty" />}
      <Card te={te} />
    </div>
  );
}

// ---------- the views: the board with the dial, his eyes, the timeline ----------

function EyesView({ te, scene }: { te: TakeEyes; scene: boolean }) {
  const looks = te.looks()!;
  const s = useStore(te.state, (x) => x);
  // Re-render when the look on show changes (the derived session changes with it).
  const stage = te.stage();
  const [ref, { w, h }] = useSize(FALLBACK_SIZE);
  const board = s.step !== "looking"; // the board is the main view, but while he looks
  const hero = te.session.hero;
  return (
    <figure className={`te-view step-${s.step}`} aria-label="The moment, with your look">
      <div className="te-stage">
        {scene && stage && (
          <SessionContext.Provider value={stage}>
            <div className={board ? "te-slot pip" : "te-slot main"}>
              <PovView />
            </div>
            <div className={board ? "te-slot main" : "te-slot pip"}>
              <TacticalView />
            </div>
          </SessionContext.Provider>
        )}
        <div ref={ref} className="te-overlay">
          {s.step === "choosing" && <Dial te={te} hero={hero} looks={looks} w={w} h={h} />}
        </div>
        <p className="te-tag" aria-hidden="true">
          {viewTag(s.step, s.view)}
        </p>
      </div>
      <Timeline te={te} looks={looks} />
    </figure>
  );
}

function viewTag(step: string, view: ResultView): string {
  if (step === "choosing") return "Where will he look?";
  if (step === "looking") return "Through his eyes, with your look";
  if (view === "both") return "Gold: your look's run · his real run";
  return view === "picture" ? "His picture with your look" : "His picture with no look";
}

/** The dial over the hero on the board: the cone where he will look, a handle per direction of the
 * grid, and the arc a scan can reach. Drag or tap round him; or use the radio buttons. */
function Dial(props: { te: TakeEyes; hero: Hero; looks: Looks; w: number; h: number }) {
  const { te, hero, looks, w, h } = props;
  const frame = useStore(te.state, (s) => s.frame)!;
  const offset = useStore(te.state, (s) => s.offset)!;
  const zoom = boardZoom(w, h);
  const fac = hero.runs.factual;
  const me = hero.hero;
  const n = hero.n;
  const at: Vec2 = [fac.pos[(frame * n + me) * 2], fac.pos[(frame * n + me) * 2 + 1]];
  const ball: Vec2 = [fac.ball[2 * frame], fac.ball[2 * frame + 1]];
  const ballDir = Math.atan2(ball[1] - at[1], ball[0] - at[0]);
  const [cx, cy] = toScreen(at, w, h, zoom);
  const r = Math.min(DIAL_PX[1], Math.max(DIAL_PX[0], DIAL_M * zoom));
  const half = hero.vision?.halfCone ?? Math.PI / 3;
  const point = (dir: number, radius = r): Vec2 => [
    cx + radius * Math.cos(dir),
    cy - radius * Math.sin(dir),
  ];
  const dirOf = (o: number) => ballDir + (o * Math.PI) / 180;
  const wedge = (dir: number) => {
    const [x0, y0] = point(dir + half);
    const [x1, y1] = point(dir - half);
    return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z`;
  };
  const arc = (from: number, to: number, radius: number) => {
    const [x0, y0] = point(from, radius);
    const [x1, y1] = point(to, radius);
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    return `M${x0},${y0} A${radius},${radius} 0 ${large} ${to > from ? 0 : 1} ${x1},${y1}`;
  };
  const reach = (70 * Math.PI) / 180;
  const widest = (150 * Math.PI) / 180;
  const drag = useRef(false);
  const pickAt = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const [px, py] = toPitch([e.clientX - box.left, e.clientY - box.top], w, h, zoom);
    if (Math.hypot(px - at[0], py - at[1]) * zoom < 12) return; // on him: no direction
    const turn = wrapAngle(Math.atan2(py - at[1], px - at[0]) - ballDir);
    te.pick({ offset: snapOffset(looks, (turn * 180) / Math.PI) });
  };
  const ring = aroundHim(looks);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const by = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!by) {
      if (e.key === "Enter") {
        e.preventDefault();
        te.look();
      }
      return;
    }
    e.preventDefault();
    const next = (k + by + ring.length) % ring.length;
    te.pick({ offset: ring[next] });
    buttons.current[next]?.focus();
  };
  return (
    <>
      <svg
        className="te-dial"
        width={w}
        height={h}
        aria-hidden="true"
        onPointerDown={(e) => {
          drag.current = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // no capture (a synthetic pointer): the drag still works inside the view
          }
          pickAt(e);
        }}
        onPointerMove={(e) => {
          if (drag.current) pickAt(e);
        }}
        onPointerUp={() => (drag.current = false)}
        onPointerCancel={() => (drag.current = false)}
      >
        <path className="te-reach" d={arc(ballDir + reach, ballDir + widest, r + 10)} />
        <path className="te-reach" d={arc(ballDir - widest, ballDir - reach, r + 10)} />
        <path className="te-now" d={wedge(ballDir)} />
        <path className="te-cone" d={wedge(dirOf(offset))} />
        <line
          className="te-ray"
          x1={cx}
          y1={cy}
          x2={point(dirOf(offset))[0]}
          y2={point(dirOf(offset))[1]}
        />
        <circle className="te-me" cx={cx} cy={cy} r={7} />
      </svg>
      <div
        className="te-handles"
        role="radiogroup"
        aria-label={`Where ${shortName(hero.heroId ?? "")} looks`}
      >
        {ring.map((o, k) => {
          const [x, y] = point(dirOf(o), r + 10);
          const cell = cellAt(looks, frame, o);
          const label = whereLabel(o);
          return (
            <button
              key={o}
              ref={(b) => {
                buttons.current[k] = b;
              }}
              type="button"
              role="radio"
              aria-checked={o === offset}
              tabIndex={o === offset ? 0 : -1}
              className={o === offset ? "te-handle on" : "te-handle"}
              style={{ left: x, top: y }}
              aria-label={cell?.unavailable ? `${label}: not possible now` : label}
              title={cell?.unavailable ?? label}
              onClick={() => te.pick({ offset: o })}
              onKeyDown={(e) => onKey(e, k)}
            >
              <span
                aria-hidden="true"
                className="te-arrow"
                style={{ transform: `rotate(${(-dirOf(o) * 180) / Math.PI}deg)` }}
              >
                →
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** The timeline of the window, from the pass to him to his decision: the grid's times to pick,
 * his own looks, the ball's arrival and his decision. */
function Timeline({ te, looks }: { te: TakeEyes; looks: Looks }) {
  const s = useStore(te.state, (x) => x);
  const dt = te.session.hero.dt;
  const [start, end] = looks.window;
  const at = (f: number) => `${(100 * (f - start)) / (end - start)}%`;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const choosing = s.step === "choosing" || s.step === "result";
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!by) {
      if (e.key === "Enter" && s.step === "choosing") {
        e.preventDefault();
        te.look();
      }
      return;
    }
    e.preventDefault();
    const next = Math.min(looks.frames.length - 1, Math.max(0, k + by));
    te.pick({ frame: looks.frames[next] });
    buttons.current[next]?.focus();
  };
  return (
    <div className="te-timeline">
      <div className="te-track" aria-hidden="true">
        {looks.ownLooks.map((l) => (
          <span key={l.id} className="te-own" style={{ left: at(l.start) }} title="His own look">
            his look
          </span>
        ))}
        <span className="te-mark arrive" style={{ left: at(looks.reception) }}>
          ball arrives
        </span>
        <span className="te-mark decide" style={{ left: at(end) }}>
          he decides
        </span>
      </div>
      <div className="te-times" role="radiogroup" aria-label="When he looks">
        {looks.frames.map((f, k) => {
          const before = secondsBefore(looks, f, dt);
          const label =
            before === 0 ? "As the ball arrives" : `${before.toFixed(1)} s before the ball arrives`;
          return (
            <button
              key={f}
              ref={(b) => {
                buttons.current[k] = b;
              }}
              type="button"
              role="radio"
              aria-checked={f === s.frame}
              tabIndex={f === s.frame ? 0 : -1}
              disabled={!choosing}
              className={f === s.frame ? "te-time on" : "te-time"}
              style={{ left: at(f) }}
              aria-label={label}
              title={label}
              onClick={() => te.pick({ frame: f })}
              onKeyDown={(e) => onKey(e, k)}
            >
              {before === 0 ? "0" : `−${before.toFixed(1)}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- the card ----------

function useLanguage(): Language {
  const { language } = useBreakdown();
  return LANGUAGES.find((l) => l === language) ?? "en";
}

function Card({ te }: { te: TakeEyes }) {
  const s = useStore(te.state, (x) => x);
  const lang = useLanguage();
  const looks = te.looks();
  const heading = useRef<HTMLHeadingElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (s.step === "result" ? primary.current : heading.current)?.focus({ preventScroll: true });
  }, [s.step]);
  const heroId = te.session.hero.heroId ? shortName(te.session.hero.heroId) : "the player";
  const back = (
    <button type="button" className="btn btn-quiet" onClick={te.close}>
      Back to the replay
    </button>
  );

  if (s.step === "loading" || s.step === "error" || !looks) {
    return (
      <aside className="te-card" aria-labelledby="te-title">
        <h2 id="te-title" ref={heading} tabIndex={-1}>
          Take his eyes
        </h2>
        <p className="te-sub">{TAKE_EYES_SUB}</p>
        <p className="te-lead" role="status">
          {s.step === "error" ? `The looks could not be loaded: ${s.error}` : "Loading every look…"}
        </p>
        <div className="te-actions">{back}</div>
      </aside>
    );
  }
  const dt = te.session.hero.dt;
  const cell = s.frame !== null && s.offset !== null ? cellAt(looks, s.frame, s.offset) : undefined;
  const entry = cell?.entry ?? null;
  const when = s.frame === null ? "" : secondsBefore(looks, s.frame, dt);
  const choice =
    s.offset === null
      ? ""
      : `${whereLabel(s.offset)}, ${when === 0 ? "as the ball arrives" : `${Number(when).toFixed(1)} s before it arrives`}`;

  if (s.step === "choosing") {
    return (
      <aside className="te-card" aria-labelledby="te-title">
        <h2 id="te-title" ref={heading} tabIndex={-1}>
          Take his eyes
        </h2>
        <p className="te-sub">{TAKE_EYES_SUB}</p>
        <p className="te-lead">
          You are {heroId}. Between the pass and his decision he gets one look: you choose when, and
          where. The sim re-runs the moment with it.
        </p>
        <p className="te-choice" aria-live="polite">
          {choice}
        </p>
        {cell?.unavailable && <p className="te-hint">Not possible then: {cell.unavailable}</p>}
        <p className="te-hint">
          Drag the cone round him or tap a direction; pick the time below. Keyboard: arrow keys in
          each group, Enter to look.
        </p>
        <div className="te-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!entry}
            onClick={() => te.look()}
          >
            Look
          </button>
          {back}
        </div>
      </aside>
    );
  }
  if (!entry) return null;
  if (s.step === "looking") {
    return (
      <aside className="te-card" aria-labelledby="te-title">
        <h2 id="te-title" ref={heading} tabIndex={-1}>
          Through his eyes
        </h2>
        <p className="te-lead">{choice}. The moment plays on with that look as his only one.</p>
        <div className="te-actions">
          <button type="button" className="btn btn-primary" onClick={te.skip}>
            See what he does
          </button>
          {back}
        </div>
      </aside>
    );
  }
  const same = entry.decision.chosen === looks.factual.chosen;
  return (
    <aside className="te-card" aria-labelledby="te-title">
      <h2 id="te-title" ref={heading} tabIndex={-1}>
        {same ? "Same call as his" : "Your look changes his call"}
      </h2>
      <dl className="te-versus">
        <div className="yours">
          <dt>With your look</dt>
          <dd>{callLabel(entry.decision.chosen)}</dd>
        </div>
        <div>
          <dt>What he did</dt>
          <dd>{callLabel(looks.factual.chosen)}</dd>
        </div>
        <div>
          <dt>With no look</dt>
          <dd>{callLabel(looks.noLook.decision.chosen)}</dd>
        </div>
      </dl>
      <Lines narration={entry.answers[lang] ?? entry.answers.en} />
      <Segmented<ResultView>
        label="What the board shows"
        value={s.view}
        onPick={te.view}
        options={[
          { value: "both", label: "Both runs" },
          { value: "picture", label: "His picture" },
          { value: "none", label: "No look" },
        ]}
      />
      <div className="te-actions">
        <button ref={primary} type="button" className="btn btn-primary" onClick={te.again}>
          Try another look
        </button>
        {back}
      </div>
    </aside>
  );
}

function Lines({ narration }: { narration?: Narration }) {
  if (!narration?.lines.length) return null;
  return (
    <ul className="te-lines" aria-label="Verified lines">
      {narration.lines.map((l) => (
        <li key={l.id}>
          <KindTags narration={narration} line={l} />
          <span className="te-line">
            <LineText
              text={l.text}
              verified={isVerified(narration, l)}
              claims={lineClaims(narration, l)}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

export type { LookEntry };
