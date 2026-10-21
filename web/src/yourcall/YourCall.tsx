// "Your call" (SPEC 7): decide at the hero's decision with only what he knew, then see what your
// call led to, the true picture, what he did and why, and the two compared. The 3D view is his
// picture from behind him (YourCallScene); over it, a label identifies the carrier, one marker per
// option (buttons: tap, or arrow keys and Enter) and a dotted path to the option aimed at; a swipe
// from the carrier picks the option it points at. The card tells each beat with verified lines only.

import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Vec2 } from "../data/types";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { KindTag } from "../ui/Narration";
import { LANGUAGES, type Language } from "../whatif/whatif";
import { declutter, frameCall, markerAt, project, swipePick, toWorld } from "./camera";
import { startYourCallClock, yourCallOf, type YourCall } from "./controller";
import { BEATS, isBeat, type Beat } from "./flow";
import type { CallOption } from "./options";
import { revealOf, type RevealLine } from "./reveal";
import { YourCallScene } from "./YourCallScene";
import "./yourcall.css";

const MARKER_PX = 36; // markers closer than this are pushed apart
const FALLBACK_SIZE = { w: 640, h: 400 }; // before the view is measured (and in tests)

const BEAT_LABEL: Record<Beat, string> = {
  outcome: "Your call",
  truth: "The truth",
  actual: "What he did",
  compare: "Compared",
};

/** The hero moment's Your call controller. */
export function useYourCall(): YourCall {
  return yourCallOf(useSession());
}

/** Whether Your call has the stage. */
export function useYourCallOpen(): boolean {
  return useStore(useYourCall().state, (s) => s.step !== "closed");
}

/** The header button that opens Your call. */
export function YourCallButton() {
  const yc = useYourCall();
  const open = useStore(yc.state, (s) => s.step !== "closed");
  return (
    <button
      type="button"
      className="yc-open"
      aria-pressed={open}
      disabled={!!yc.unavailable}
      title={yc.unavailable ?? "Decide with only what he knew, then see what really happened"}
      onClick={() => (open ? yc.close() : yc.open())}
    >
      Your call
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

/** The stage while Your call is open: the view and the card. `scene`: draw the 3D view (WebGL). */
export function YourCallStage({ scene = true }: { scene?: boolean }) {
  const yc = useYourCall();
  const step = useStore(yc.state, (s) => s.step);
  useEffect(() => startYourCallClock(yc), [yc]);
  if (step === "closed") return null;
  return (
    <section
      className="yourcall"
      aria-label="Your call"
      onKeyDown={(e) => {
        if (e.key === "Escape") yc.close();
      }}
    >
      <CallView yc={yc} scene={scene} />
      <Card yc={yc} />
    </section>
  );
}

// ---------- the view: his picture, the markers, the dotted path, the swipe ----------

function CallView({ yc, scene }: { yc: YourCall; scene: boolean }) {
  const { session, options, picture } = yc;
  const step = useStore(yc.state, (s) => s.step);
  const aim = useStore(yc.state, (s) => s.aim);
  const tried = useStore(yc.state, (s) => s.tried);
  const [ref, { w, h }] = useSize(FALLBACK_SIZE);
  const carrier = picture!.players[picture!.carrier];
  const team = carrier.team;
  const camera = useMemo(
    () => frameCall(carrier.truth, options, team, w, h),
    [carrier, options, team, w, h],
  );
  const carrierPx = useMemo(
    () => project(camera, toWorld(carrier.truth), w, h),
    [camera, carrier, w, h],
  );
  const markers = useMemo(() => {
    const raw = options.map((o) => markerAt(camera, o.anchor, w, h));
    const placed = declutter(raw, MARKER_PX);
    return options
      .map((o, k) => ({ option: o, at: placed[k] }))
      .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
  }, [options, camera, w, h]);
  const aimed = options.find((o) => o.action === aim) ?? null;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const stale = new Set(picture!.players.filter((p) => p.stale).map((p) => p.id));
  const deciding = step === "deciding";

  const local = (e: PointerEvent<HTMLElement>): Vec2 => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const pickBySwipe = (e: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    if (!start) return null;
    const [x, y] = local(e);
    const at = markers.map((m) => ({ action: m.option.action, at: m.at }));
    return swipePick(carrierPx, [x - start.x, y - start.y], at);
  };
  const onMarkerKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    buttons.current[(k + step + markers.length) % markers.length]?.focus();
  };

  return (
    <figure className={`yc-view step-${step}`} aria-label="His picture, from behind him">
      <div ref={ref} className="yc-canvas">
        {scene && (
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            gl={{ antialias: true }}
            camera={{ fov: camera.fov, near: camera.near, far: camera.far }}
            fallback={<p className="no-webgl">This view needs WebGL.</p>}
          >
            <YourCallScene yc={yc} pose={camera} />
          </Canvas>
        )}
        {deciding && aimed && (
          <svg className="yc-path" width={w} height={h} aria-hidden="true">
            <polyline
              points={pathPoints(aimed, carrier.truth, camera, w, h)}
              className={`kind-${aimed.kind}`}
            />
          </svg>
        )}
        {deciding && (
          <div
            className="yc-swipe"
            aria-hidden="true"
            onPointerDown={(e) => {
              const [x, y] = local(e);
              swipe.current = { x, y };
              try {
                e.currentTarget.setPointerCapture(e.pointerId); // keep the drag past the edge
              } catch {
                // no capture (a synthetic pointer): the drag still works inside the view
              }
            }}
            onPointerMove={(e) => {
              if (swipe.current) yc.aim(pickBySwipe(e));
            }}
            onPointerUp={(e) => {
              const pick = pickBySwipe(e);
              swipe.current = null;
              if (pick) yc.choose(pick);
              else yc.aim(null);
            }}
            onPointerCancel={() => {
              swipe.current = null;
              yc.aim(null);
            }}
          />
        )}
        {/* Under the markers: it never hides one. */}
        {deciding && (
          <p
            className="yc-you"
            aria-hidden="true"
            style={{ left: carrierPx[0], top: carrierPx[1] + 18 }}
          >
            {carrier.id} · you
          </p>
        )}
        {deciding && (
          <div className="yc-markers" role="group" aria-label={`Options of ${carrier.id}`}>
            {markers.map(({ option: o, at }, k) => {
              const unseen = !!o.receiver && stale.has(o.receiver);
              const done = tried.includes(o.action);
              const name = [o.label, unseen && "not seen lately", done && "tried"]
                .filter(Boolean)
                .join(", ");
              return (
                <button
                  key={o.action}
                  ref={(b) => {
                    buttons.current[k] = b;
                  }}
                  type="button"
                  className={[
                    "yc-marker",
                    `kind-${o.kind}`,
                    unseen && "unseen",
                    done && "tried",
                    aim === o.action && "aimed",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ left: at[0], top: at[1] }}
                  aria-label={name}
                  title={name}
                  onClick={() => yc.choose(o.action)}
                  onFocus={() => yc.aim(o.action)}
                  onBlur={() => yc.aim(null)}
                  onPointerEnter={() => yc.aim(o.action)}
                  onPointerLeave={() => yc.aim(null)}
                  onKeyDown={(e) => onMarkerKey(e, k)}
                >
                  <span aria-hidden="true">{o.short}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="yc-tag" aria-hidden="true">
          {viewTag(step, session.hero.heroId ?? "")}
        </p>
      </div>
    </figure>
  );
}

function viewTag(step: string, hero: string): string {
  if (step === "deciding") return `His picture · you are ${hero}`;
  if (step === "outcome") return "Re-simulated: your call";
  if (step === "truth") return "The truth at the decision";
  return "What happened";
}

/** The dotted path of an option on screen: along the grass from the carrier to its target. */
function pathPoints(
  option: CallOption,
  from: Vec2,
  camera: Parameters<typeof project>[0],
  w: number,
  h: number,
): string {
  const to = option.target;
  const points: string[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const at: Vec2 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    const [x, y] = project(camera, toWorld(at, 0.1), w, h);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

// ---------- the card: the prompt, then each beat of the reveal ----------

function Card({ yc }: { yc: YourCall }) {
  const { session, options } = yc;
  const state = useStore(yc.state, (s) => s);
  const { narration, language, status } = useBreakdown();
  const lang: Language = LANGUAGES.find((l) => l === language) ?? "en";
  const reveal = useMemo(
    () =>
      state.pick
        ? revealOf({
            hero: session.hero,
            options,
            whatIfs: session.whatIfs,
            narration,
            language: lang,
            pick: state.pick,
          })
        : null,
    [session, options, narration, lang, state.pick],
  );
  const primary = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Each step moves the focus: to its main button in the reveal, to the heading while deciding.
  useEffect(() => {
    (state.step === "deciding" ? heading.current : primary.current)?.focus({ preventScroll: true });
  }, [state.step]);

  const heroId = session.hero.heroId ?? "the player";
  const playing = !!state.clip?.playing;
  const back = (
    <button type="button" className="yc-secondary" onClick={yc.close}>
      Back to the replay
    </button>
  );

  if (state.step === "deciding") {
    return (
      <aside className="yc-card" aria-labelledby="yc-title">
        <h2 id="yc-title" ref={heading} tabIndex={-1}>
          Your call
        </h2>
        <p className="yc-lead">
          You are {heroId}. You know only what he knew: everyone stands where he pictured them, and
          the players he had not seen lately are grey.
        </p>
        <p className="yc-hint">
          Tap a teammate, or swipe from {heroId} toward one. Keyboard: arrow keys, then Enter.
        </p>
        {state.tried.length > 0 && (
          <p className="yc-hint">Tried: {state.tried.map(labelOf(options)).join(", ")}</p>
        )}
        <div className="yc-actions">{back}</div>
      </aside>
    );
  }
  if (!reveal || !isBeat(state.step)) return null;
  const beat = state.step;
  const nextLabel: Record<Beat, string> = {
    outcome: "See the truth",
    truth: "What he did",
    actual: "Compare",
    compare: "Try another option",
  };
  const fixture = [reveal.outcome, reveal.truth, reveal.actual, reveal.compare]
    .flatMap((b) => b.lines)
    .some((l) => l.source === "fixture");
  const waiting = status === "loading" || status === "waiting";

  return (
    <aside className="yc-card" aria-labelledby="yc-title">
      <ol className="yc-steps" aria-label="Reveal">
        {BEATS.map((b, k) => (
          <li key={b} aria-current={b === beat ? "step" : undefined}>
            <span className="sr-only">Step {k + 1} of 4: </span>
            {BEAT_LABEL[b]}
          </li>
        ))}
      </ol>
      <div className="yc-beat" aria-live="polite">
        {beat === "outcome" && (
          <>
            <h2 id="yc-title" ref={heading} tabIndex={-1}>
              {reveal.outcome.title}
            </h2>
            {!reveal.same && (
              <p className="yc-lead">
                Re-simulated from the decision with your call forced; everything else plays as the
                sim would. Causal inside the sim only.
              </p>
            )}
            <Lines lines={reveal.outcome.lines} />
            {playing && <p className="yc-hint">Playing…</p>}
          </>
        )}
        {beat === "truth" && (
          <>
            <h2 id="yc-title" ref={heading} tabIndex={-1}>
              {reveal.truth.title}
            </h2>
            {reveal.truth.moved.length > 0 ? (
              <p className="yc-lead">
                Not where he pictured them: {reveal.truth.moved.join(", ")}.{" "}
                <span className="source" title="Read from the sim export, not a verified claim">
                  sim
                </span>
              </p>
            ) : (
              <p className="yc-lead">Everyone was where he pictured them.</p>
            )}
            <Lines lines={reveal.truth.lines} />
          </>
        )}
        {beat === "actual" && (
          <>
            <h2 id="yc-title" ref={heading} tabIndex={-1}>
              {reveal.actual.title}
            </h2>
            <Lines lines={reveal.actual.lines} />
            {playing && <p className="yc-hint">Playing…</p>}
          </>
        )}
        {beat === "compare" && (
          <>
            <h2 id="yc-title" ref={heading} tabIndex={-1}>
              {reveal.same ? "Same call as his" : "Your call and his"}
            </h2>
            <dl className="yc-versus">
              <div className="yours">
                <dt>Your call</dt>
                <dd>{reveal.compare.yours}</dd>
              </div>
              <div className="his">
                <dt>His call</dt>
                <dd>{reveal.compare.his}</dd>
              </div>
            </dl>
            <Lines lines={reveal.compare.lines} />
          </>
        )}
        {waiting && beat !== "outcome" && (
          <p className="yc-hint">The breakdown's verified lines are on their way…</p>
        )}
        {fixture && (
          <p className="yc-hint">
            Offline fixture: lines marked “fixture” were not checked by the verifier.
          </p>
        )}
      </div>
      <div className="yc-actions">
        <button
          ref={primary}
          type="button"
          className="play small"
          onClick={beat === "compare" ? yc.retry : yc.next}
        >
          {nextLabel[beat]}
        </button>
        {beat !== "compare" && (
          <button type="button" className="yc-secondary" onClick={yc.skip}>
            Skip to the comparison
          </button>
        )}
        {back}
      </div>
    </aside>
  );
}

const labelOf = (options: CallOption[]) => (action: string) =>
  options.find((o) => o.action === action)?.label ?? action;

function Lines({ lines }: { lines: RevealLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="yc-lines">
      {lines.map((l) => (
        <li key={`${l.source}:${l.id}`}>
          <span className="kind-tags">
            {l.kinds.map((k) => (
              <KindTag key={k} kind={k} />
            ))}
          </span>
          <span className="yc-line">{l.text}</span>
          {l.source === "fixture" && <span className="source">fixture</span>}
        </li>
      ))}
    </ul>
  );
}
