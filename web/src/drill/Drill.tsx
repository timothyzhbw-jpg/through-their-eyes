// Academy drill (SPEC 7): a scan trainer over the look grid. You are him, in first person, a moment
// before the pass reaches him; a countdown runs to the ball's arrival. Drag the picture sideways
// (or hold ← / →) to turn his head and let go: that is your look, snapped to the nearest look the
// sim re-ran (controller.ts, snap.ts). At his decision you make the pass with only what your look
// showed (Your call's picture), then see what came of your look in the sim next to his real look
// and no look. Every line is verified, every value is the grid's; no model call.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { shortName } from "../data/roster";
import type { Narration, PayloadLine } from "../narration/payload";
import { SourceChip } from "../provenance/SourceChip";
import { SessionContext, useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { takeEyesOf } from "../takeeyes/controller";
import { callLabel } from "../takeeyes/looks";
import { isVerified, KindTags, LineText, lineClaims } from "../ui/Narration";
import { Segmented } from "../ui/Segmented";
import { PovView } from "../views/PovView";
import { TacticalView } from "../views/TacticalView";
import { LANGUAGES, type Language } from "../whatif/whatif";
import { CallView } from "../yourcall/YourCall";
import { drillOf, startDrillClock, type Drill, type Pace } from "./controller";
import { levelHref, levelOf, LEVELS, nextLevel } from "./levels";
import { drillResult, lookWords, pictureWords } from "./result";
import { SCAN_MAX_DEG, SCAN_MIN_DEG } from "./snap";
import { COACH_LABEL, coachHref } from "../steps/coach";
import "./drill.css";

/** The drill's name and what it is, wherever it is named. */
export const DRILL_NAME = "Academy drill";
export const DRILL_SUB = "Check your shoulder before the ball arrives";

/** The hero moment's academy drill. */
export function useDrill(): Drill {
  return drillOf(useSession());
}

/** Whether the academy drill has the stage. */
export function useDrillOpen(): boolean {
  return useStore(useDrill().state, (s) => s.step !== "closed");
}

/** The drill's header pill while it is open: pressed, it closes the drill. */
function DrillButton() {
  const d = useDrill();
  return (
    <button
      id="drill-open"
      type="button"
      className="btn dr-open"
      aria-pressed={true}
      title="Close the drill"
      onClick={d.close}
    >
      {DRILL_NAME}
    </button>
  );
}

/** The live screen's place while the drill is open: the same header, then the stage. */
export function DrillScreen({ start, scene = true }: { start: ReactNode; scene?: boolean }) {
  const d = useDrill();
  return (
    <section
      className="stage dr-screen"
      aria-label={DRILL_NAME}
      onKeyDown={(e) => {
        if (e.key === "Escape") d.close();
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
          <DrillButton />
        </div>
      </header>
      <DrillStage scene={scene} />
    </section>
  );
}

/** The stage while the drill is open: the view and the card. `scene`: draw WebGL views. */
export function DrillStage({ scene = true }: { scene?: boolean }) {
  const d = useDrill();
  const step = useStore(d.state, (s) => s.step);
  const markers = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => startDrillClock(d), [d]);
  if (step === "closed") return null;
  return (
    <div className="dr-main">
      <DrillView d={d} scene={scene} markers={markers} />
      <Card d={d} pickByKeyboard={() => markers.current[0]?.focus()} />
    </div>
  );
}

// ---------- the view: his eyes with the countdown and his head; the call; the result's board ----------

/** His head in words: degrees to his right or left of the ball. */
function headWords(head: number): string {
  const deg = Math.round(Math.abs(head));
  if (deg < 3) return "Facing the ball";
  return `${deg}° to his ${head > 0 ? "left" : "right"} of the ball`;
}

/**
 * His eyes stay mounted for the whole drill, and the result's board from the call on (hidden until
 * the result, InstantFrame compiles it): no view is created at a cut, so none shows blank. The call
 * is Your call's view over them; until its picture has drawn, his last frame shows through.
 */
function DrillView(props: {
  d: Drill;
  scene: boolean;
  markers: RefObject<(HTMLButtonElement | null)[]>;
}) {
  const { d, scene, markers } = props;
  const step = useStore(d.state, (s) => s.step);
  const locked = useStore(d.state, (s) => s.locked);
  const stage = d.stage();
  const board = d.boardStage();
  const yc = step === "calling" ? d.call() : null;
  const result = step === "result";
  return (
    <figure
      className={`dr-view step-${step}`}
      aria-label={result ? "What came of your look" : yc ? "Your call" : "His eyes"}
    >
      <div className="dr-stage">
        {scene && stage && (
          <SessionContext.Provider value={stage}>
            <div className={result ? "dr-slot main gone" : "dr-slot main"}>
              <PovView />
            </div>
          </SessionContext.Provider>
        )}
        {scene && board && (
          <SessionContext.Provider value={board}>
            <div className="dr-slot main">
              <TacticalView hidden={!result} />
            </div>
          </SessionContext.Provider>
        )}
        {(step === "ready" || step === "running") && <Overlay d={d} />}
        {yc && (
          <div className="dr-call">
            <CallView yc={yc} scene={scene} buttons={markers} />
          </div>
        )}
        {result && (
          <p className="dr-tag" aria-hidden="true">
            Gold: {locked?.cell ? "your scan's" : "no scan's"} run · his real run
          </p>
        )}
      </div>
    </figure>
  );
}

const DRAG_DEG_PER_PX = (w: number) => SCAN_MAX_DEG / Math.max(120, Math.min(320, w * 0.35));

/** Over his eyes: the countdown, his head on a dial, and the drag surface (a slider for his head). */
function Overlay({ d }: { d: Drill }) {
  const step = useStore(d.state, (s) => s.step);
  const head = useStore(d.state, (s) => s.head);
  const locked = useStore(d.state, (s) => s.locked);
  const frame = useStore(d.state, (s) => s.frame);
  const looks = d.looks();
  const left = d.countdown();
  const running = step === "running";
  const drag = useRef<{ x: number; per: number; id: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const name = shortName(d.session.hero.heroId ?? "");
  useEffect(() => {
    if (running) surface.current?.focus({ preventScroll: true });
  }, [running]);
  void frame; // the countdown re-renders with the clock

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!running || locked) return;
    const w = e.currentTarget.getBoundingClientRect().width;
    drag.current = { x: e.clientX, per: DRAG_DEG_PER_PX(w), id: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // no capture (a synthetic pointer): the drag still works inside the view
    }
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    // Drag right, look right (his right is a negative angle from the ball).
    d.turnTo(-(e.clientX - g.x) * g.per);
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    d.release();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (!e.repeat) d.hold(dir);
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    d.release();
  };

  return (
    <div className="dr-overlay">
      <p className="dr-countdown" aria-hidden="true">
        {left > 0 ? (
          <>
            Ball arrives in <b>{left.toFixed(1)}</b> s
          </>
        ) : (
          "The ball is here"
        )}
      </p>
      {locked && looks && (
        <p className="dr-locked" aria-hidden="true">
          {locked.cell
            ? `Your scan: ${lookWords(looks, locked.entry, d.session.hero.dt)}`
            : "No scan"}
        </p>
      )}
      <HeadDial d={d} />
      <div
        ref={surface}
        className={running && !locked ? "dr-surface live" : "dr-surface"}
        role="slider"
        tabIndex={running ? 0 : -1}
        aria-label={`${name}'s head`}
        aria-describedby="dr-how"
        aria-orientation="horizontal"
        aria-valuemin={-SCAN_MAX_DEG}
        aria-valuemax={SCAN_MAX_DEG}
        aria-valuenow={Math.round(-head)}
        aria-valuetext={headWords(head)}
        aria-disabled={!running || !!locked || undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => d.release()}
      />
    </div>
  );
}

const DIAL_R = 42;

/** His head from above: the ball straight up, the scan's reach on either side, the grid's
 * directions as ticks, his head as the needle; once the look is locked, its grid direction. */
function HeadDial({ d }: { d: Drill }) {
  const head = useStore(d.state, (s) => s.head);
  const locked = useStore(d.state, (s) => s.locked);
  const looks = d.looks();
  const c = DIAL_R + 14;
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [c - r * Math.sin(a), c - r * Math.cos(a)] as const;
  };
  const arc = (from: number, to: number, r: number) => {
    const points = [];
    for (let k = 0; k <= 24; k++) points.push(at(from + ((to - from) * k) / 24, r).join(","));
    return points.join(" ");
  };
  const [hx, hy] = at(head, DIAL_R);
  const snapped = locked?.cell?.offset ?? null;
  return (
    <svg className="dr-dial" width={2 * c} height={2 * c} aria-hidden="true">
      <circle className="dr-dial-face" cx={c} cy={c} r={DIAL_R + 8} />
      <polyline className="dr-reach" points={arc(SCAN_MIN_DEG, SCAN_MAX_DEG, DIAL_R)} />
      <polyline className="dr-reach" points={arc(-SCAN_MIN_DEG, -SCAN_MAX_DEG, DIAL_R)} />
      {looks?.offsets.map((o) => {
        const [x0, y0] = at(o, DIAL_R - 6);
        const [x1, y1] = at(o, DIAL_R + 6);
        return (
          <line
            key={o}
            className={o === snapped ? "dr-tick on" : "dr-tick"}
            x1={x0}
            y1={y0}
            x2={x1}
            y2={y1}
          />
        );
      })}
      <line className="dr-ball" x1={c} y1={c} x2={c} y2={c - DIAL_R - 6} />
      <line className="dr-needle" x1={c} y1={c} x2={hx} y2={hy} />
      <circle className="dr-me" cx={c} cy={c} r={4} />
    </svg>
  );
}

// ---------- the card ----------

function useLanguage(): Language {
  const { language } = useBreakdown();
  return LANGUAGES.find((l) => l === language) ?? "en";
}

function Card({ d, pickByKeyboard }: { d: Drill; pickByKeyboard: () => void }) {
  const s = useStore(d.state, (x) => x);
  const lang = useLanguage();
  const looks = d.looks();
  const { hero } = d.session;
  const heading = useRef<HTMLHeadingElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (s.step === "running") return; // the slider takes the focus
    (s.step === "result" || s.step === "ready" ? primary.current : heading.current)?.focus({
      preventScroll: true,
    });
  }, [s.step]);
  const name = hero.heroId ? shortName(hero.heroId) : "the player";
  const level = levelOf(hero.scenario, hero.seed);
  const kicker = (
    <p className="dr-kicker">
      {DRILL_NAME}
      {level ? ` · ${level.label}` : ""}
    </p>
  );
  const back = (
    <button type="button" className="btn btn-quiet" onClick={d.close}>
      Back to the replay
    </button>
  );

  if (s.step === "loading" || s.step === "error" || !looks) {
    return (
      <aside className="dr-card" aria-labelledby="dr-title">
        {kicker}
        <h2 id="dr-title" ref={heading} tabIndex={-1}>
          {DRILL_SUB}
        </h2>
        <p className="dr-lead" role="status">
          {s.step === "error" ? `The looks could not be loaded: ${s.error}` : "Loading every look…"}
        </p>
        <div className="dr-actions">{back}</div>
      </aside>
    );
  }

  if (s.step === "ready") {
    const spacing = looks.spacingS.toFixed(1);
    return (
      <aside className="dr-card" aria-labelledby="dr-title">
        {kicker}
        <h2 id="dr-title" ref={heading} tabIndex={-1}>
          {DRILL_SUB}
        </h2>
        <p className="dr-lead">
          You are {name}. The pass is on its way to you. Before it arrives, take one look: drag the
          picture sideways, or hold ← or →, and let go. Then make the pass with only what you saw.
        </p>
        <details className="how dr-how" id="dr-how">
          <summary>How the drill works</summary>
          <p className="dr-hint">
            A look turns his head {SCAN_MIN_DEG}–{SCAN_MAX_DEG}° from the ball, either side, at a
            scan&apos;s speed. The sim re-ran a look every {spacing} s in four directions ahead of
            time; yours becomes the nearest one.
          </p>
        </details>
        <Segmented<"0.5" | "1">
          label="Pace"
          value={String(s.pace) as "0.5" | "1"}
          onPick={(v) => d.setPace(Number(v) as Pace)}
          options={[
            { value: "0.5", label: "Half speed" },
            { value: "1", label: "Match speed" },
          ]}
        />
        <Levels current={level?.key ?? null} offline={!!d.session.offline} />
        <div className="dr-actions">
          <button
            ref={primary}
            type="button"
            className="btn btn-primary"
            onClick={() => {
              // On a phone the card is under his eyes: bring them back on screen.
              window.scrollTo({ top: 0 });
              d.start();
            }}
          >
            {s.tries ? "Go again" : "Start"}
          </button>
          {back}
        </div>
        <p className="dr-hint">
          No clock?{" "}
          <button
            type="button"
            className="dr-link"
            onClick={() => {
              d.close();
              takeEyesOf(d.session).open();
            }}
          >
            Take his eyes
          </button>{" "}
          lets you choose when and where he looks.
        </p>
        {!d.session.offline && (
          <p className="dr-hint">
            <a className="dr-link" href={coachHref()}>
              {COACH_LABEL}
            </a>
          </p>
        )}
      </aside>
    );
  }

  if (s.step === "running") {
    const turned = s.turn && !s.locked;
    return (
      <aside className="dr-card" aria-labelledby="dr-title">
        {kicker}
        <h2 id="dr-title" ref={heading} tabIndex={-1}>
          {s.locked ? "Eyes back on the ball" : "Look now"}
        </h2>
        <p className="dr-lead" aria-live="polite">
          {s.locked
            ? s.locked.cell
              ? `Your scan: ${lookWords(looks, s.locked.entry, hero.dt)}.`
              : s.locked.tooSmall
                ? `Too small for a scan: a scan turns at least ${SCAN_MIN_DEG}° from the ball. No scan.`
                : "No scan before the ball arrived."
            : s.small
              ? `Too small for a scan: turn at least ${SCAN_MIN_DEG}° from the ball.`
              : turned
                ? "Turning… let go to end your look."
                : "Drag the picture sideways, or hold ← or →."}
        </p>
        <p className="dr-hint" id="dr-how">
          One look. Let go and it snaps to the nearest look the sim re-ran.
        </p>
        <div className="dr-actions">
          <button type="button" className="btn btn-quiet" onClick={d.again}>
            Start over
          </button>
          {back}
        </div>
      </aside>
    );
  }

  const locked = s.locked!;
  if (s.step === "calling") {
    const yc = d.call();
    return (
      <aside className="dr-card" aria-labelledby="dr-title">
        {kicker}
        <h2 id="dr-title" ref={heading} tabIndex={-1}>
          Your call
        </h2>
        <p className="dr-lead">
          {locked.cell
            ? `Your scan: ${lookWords(looks, locked.entry, hero.dt)}.`
            : "You took no scan."}{" "}
          This is his picture with it: everyone stands where he pictured them, and the players he
          had not seen lately are grey.
        </p>
        <p className="dr-hint">
          Tap {yc?.options.some((o) => o.kind === "shot") ? "a teammate or a shot" : "a teammate"},
          or swipe from {name} toward one. Keyboard: Pick with the keyboard, then the arrow keys and
          Enter.
        </p>
        <div className="dr-actions">
          <button type="button" className="btn btn-quiet" onClick={pickByKeyboard}>
            Pick with the keyboard
          </button>
          {back}
        </div>
      </aside>
    );
  }

  // the result
  const r = drillResult({ hero, looks, entry: locked.entry, pick: s.pick!, language: lang });
  const yc = d.call();
  const next = nextLevel(level);
  const timing = !locked.cell
    ? { ok: false, text: "No scan before the ball arrived" }
    : r.late
      ? { ok: false, text: "Your scan came as the ball arrived" }
      : { ok: true, text: "You looked before the ball arrived" };
  return (
    <aside className="dr-card" aria-labelledby="dr-title">
      {kicker}
      <h2 id="dr-title" ref={heading} tabIndex={-1}>
        {r.sameAsHis ? "You made his call" : "Not the call he made"}
      </h2>
      <ul className="dr-checks" aria-label="Your drill">
        <li className={timing.ok ? "ok" : "no"}>
          <Mark ok={timing.ok} />
          {timing.text}
        </li>
        {r.runner && (
          <li className={r.runner.fresh ? "ok" : "no"}>
            <Mark ok={r.runner.fresh} />
            {r.runner.fresh
              ? `${shortName(r.runner.id)} was fresh in your picture`
              : `${shortName(r.runner.id)} was not in your picture lately`}
          </li>
        )}
        <li className={r.sameAsHis ? "ok" : "no"}>
          <Mark ok={r.sameAsHis} />
          {r.sameAsHis ? "Your pass is the one he played" : "He played another pass"}
        </li>
      </ul>
      <dl className="dr-you">
        <div>
          <dt>Your scan</dt>
          <dd>{r.look}</dd>
        </div>
        {r.saw && r.narration ? (
          <div>
            <dt>You saw</dt>
            <dd>
              <Line narration={r.narration} line={r.saw} />
            </dd>
          </div>
        ) : (
          !locked.cell && (
            <div>
              <dt>You saw</dt>
              <dd>Nobody new: with no look, only what was already in front of him.</dd>
            </div>
          )
        )}
        <div>
          <dt>Your call</dt>
          <dd>
            {callLabel(r.pick)}. {yc && pictureWords(yc.session.hero, r.pick)}{" "}
            <SourceChip kind="sim" spoken />
          </dd>
        </div>
      </dl>
      <h3 className="dr-sub">Your scan in the sim: he chooses with it</h3>
      {r.narration && r.lines.length > 0 && (
        <ul className="dr-lines" aria-label="Verified lines">
          {r.lines.map((l) => (
            <li key={l.id}>
              <Line narration={r.narration!} line={l} />
            </li>
          ))}
        </ul>
      )}
      <dl className="dr-versus" aria-label="Compared">
        <div className="yours">
          <dt>With your scan</dt>
          <dd>{callLabel(r.simCall)}</dd>
        </div>
        <div>
          <dt>What he did</dt>
          <dd>{callLabel(r.hisCall)}</dd>
          {r.hisLooks.length > 0 && (
            <dd className="dr-how">
              {r.hisLooks.map((w, k) => (k ? w.toLowerCase() : w)).join(", then ")}
            </dd>
          )}
        </div>
        <div>
          <dt>With no scan</dt>
          <dd>{callLabel(r.noLookCall)}</dd>
        </div>
      </dl>
      <div className="dr-actions">
        <button ref={primary} type="button" className="btn btn-primary" onClick={d.again}>
          Try again
        </button>
        {next && next.key !== level?.key && (
          <a className="btn" href={levelHref(next)}>
            Next: {next.label}
          </a>
        )}
        {back}
      </div>
    </aside>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className="dr-mark" aria-hidden="true">
      {ok ? "✓" : "✗"}
    </span>
  );
}

function Line({ narration, line }: { narration: Narration; line: PayloadLine }) {
  return (
    <>
      <KindTags narration={narration} line={line} />
      <span className="dr-line">
        <LineText
          text={line.text}
          verified={isVerified(narration, line)}
          claims={lineClaims(narration, line)}
        />
      </span>
    </>
  );
}

/** The drill's levels: the moments with a look grid, the one on screen marked. Each is a link: its
 * own page, as the moment rail's. Offline only the bundled moment plays. */
function Levels({ current, offline }: { current: string | null; offline: boolean }) {
  const [hint, setHint] = useState(false);
  if (LEVELS.length < 2) return null;
  return (
    <nav className="dr-levels" aria-label="Drill moments">
      <ul>
        {LEVELS.map((l) => {
          const here = l.key === current;
          const words = `${l.label}${l.difficulty ? ` · ${l.difficulty}` : ""}`;
          return (
            <li key={l.key}>
              {here || !offline ? (
                <a
                  className="dr-level"
                  href={levelHref(l)}
                  aria-current={here ? "page" : undefined}
                >
                  {words}
                </a>
              ) : (
                <button type="button" className="dr-level off" onClick={() => setHint(true)}>
                  {words}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hint && <p className="dr-hint">That moment needs the live service.</p>}
    </nav>
  );
}
