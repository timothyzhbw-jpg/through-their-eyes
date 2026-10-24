// Scan step-through (SPEC 7): each look the hero takes before the ball reaches him is a freeze
// frame the viewer steps through, and the last one explains his decision.
//
// A look is shown through his eyes at the middle of its dwell, with the board beside it: who came
// into his sight on it is ringed, dashed arrows project where the players near him are heading
// (their sim velocity at that frame, a second ahead), and "Potential passes" draws the options of
// his decision record. His decision is shown on the board with everything dimmed (never blurred) but
// the two players it turns on. The card speaks only in verified lines (agents/steps.py).

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { runLabels, type Hero, type Run } from "../data/hero";
import { shortName } from "../data/roster";
import type { RunName, Vec2 } from "../data/types";
import type { Narration, PayloadLine } from "../narration/payload";
import { toScreen } from "../options/passOptions";
import { SessionContext, useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { isVerified, KindTags, LineText } from "../ui/Narration";
import { Segmented } from "../ui/Segmented";
import { PovView } from "../views/PovView";
import { boardZoom } from "../views/scene";
import { TacticalView } from "../views/TacticalView";
import { LANGUAGES, type Language } from "../whatif/whatif";
import { stepThroughOf, type StepThrough } from "./controller";
import {
  inView,
  movementArrows,
  potentialPasses,
  povPose,
  project,
  projectSegment,
  focusPlayers,
  stepTitle,
  type Arrow,
  type DecisionStep,
  type Lane,
  type LookStep,
  type Step,
  stackTags,
} from "./steps";
import {
  DecisionStoryBlock,
  HalfTurnArc,
  LookStoryBlock,
  ScanTimeline,
  useHalfTurn,
} from "./StoryParts";
import "./steps.css";

const FALLBACK_SIZE = { w: 640, h: 400 }; // before the view is measured (and in tests)
const SWIPE_PX = 50;
const FOCUS_RADIUS_M = 4; // the undimmed circle round each of the two players on the board
const FOCUS_MIN_PX = 26;
const LANE_NEAR_M = 3; // first-person lanes start this far in front of his eyes
const TAG_ROW_PX = 14; // a name tag's row under a ringed player (12 px type)
const TAG_CHAR_PX = 7.2; // Geist Mono at 12 px

/** The hero moment's step-through. */
export function useStepThrough(): StepThrough {
  return stepThroughOf(useSession());
}

/** Whether the step-through has the stage. */
export function useStepThroughOpen(): boolean {
  return useStore(useStepThrough().state, (s) => s.open);
}

/** The header button that opens the step-through (pressed while it is open). */
export function ScanStepsButton() {
  const st = useStepThrough();
  const open = useStore(st.state, (s) => s.open);
  return (
    <button
      id="scan-steps-open"
      type="button"
      className="btn ss-open"
      aria-pressed={open}
      disabled={!!st.unavailable}
      title={st.unavailable ?? "Step through each look he took, frozen, then his decision"}
      onClick={() => (open ? st.close() : st.open())}
    >
      His looks
    </button>
  );
}

function useSize<T extends HTMLElement>(fallback: { w: number; h: number }) {
  const ref = useRef<T>(null);
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

function useLanguage(): Language {
  const { language } = useBreakdown();
  return LANGUAGES.find((l) => l === language) ?? "en";
}

/** The live screen's place while the step-through is open: the same header, then the stage. */
export function ScanStepsScreen({ start, scene = true }: { start: ReactNode; scene?: boolean }) {
  const st = useStepThrough();
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (e.key === "Escape") st.close();
    else if (e.key === "ArrowRight") {
      e.preventDefault();
      st.next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      st.back();
    } else return;
  };
  return (
    <section className="stage ss-screen" aria-label="His looks, step by step" onKeyDown={onKey}>
      <header className="stage-head">
        <div className="brand">
          <h1>Through Their Eyes</h1>
          <p className="sub">
            A synthetic match<span className="sub-more"> · every player fictional</span>
          </p>
        </div>
        <div className="header-start">{start}</div>
        <div className="header-end">
          <ScanStepsButton />
        </div>
      </header>
      <ScanStepsStage scene={scene} />
    </section>
  );
}

/** The stage while the step-through is open: the views, the steps and the card. `scene`: draw the
 * 3D view and the board (WebGL). */
export function ScanStepsStage({ scene = true }: { scene?: boolean }) {
  const st = useStepThrough();
  const s = useStore(st.state, (x) => x);
  if (!s.open) return null;
  const step = st.step();
  return (
    <div className={s.reduced ? "scansteps reduced" : "scansteps"}>
      {s.status === "ready" && step ? (
        <StepView st={st} step={step} scene={scene} />
      ) : (
        <div className="ss-view ss-empty" />
      )}
      <Card st={st} />
    </div>
  );
}

// ---------- the views ----------

function StepView({ st, step, scene }: { st: StepThrough; step: Step; scene: boolean }) {
  const s = useStore(st.state, (x) => x);
  const hero = st.session.hero;
  const run = hero.runs[s.mode];
  const board = step.kind === "decision"; // the decision is told on the board
  const turn = useHalfTurn(hero, run) !== null && step.kind === "decision";
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(e.clientY - from.y) > Math.abs(dx)) return;
    if (dx < 0) st.next();
    else st.back();
  };
  return (
    <figure className={`ss-view ss-${step.kind}`} aria-label={viewLabel(step)}>
      <div className="ss-stage" onPointerDown={onDown} onPointerUp={onUp}>
        <SessionContext.Provider value={st.stage()}>
          <Slot role={board ? "pip" : "main"} kind="pov" scene={scene}>
            {(w, h) =>
              (!board || turn) && (
                <PovMarks hero={hero} run={run} step={step} passes={s.passes} w={w} h={h} />
              )
            }
          </Slot>
          <Slot role={board ? "main" : "pip"} kind="board" scene={scene}>
            {(w, h) => (
              <BoardMarks
                hero={hero}
                run={run}
                step={step}
                passes={s.passes}
                w={w}
                h={h}
                main={board}
              />
            )}
          </Slot>
        </SessionContext.Provider>
        <p className="ss-tag" aria-hidden="true">
          {viewTag(step, runLabels(hero).tag[s.mode])}
        </p>
      </div>
      <div className="ss-foot">
        <ScanTimeline st={st} />
        <Strip st={st} />
        <Legend step={step} passes={s.passes} />
      </div>
    </figure>
  );
}

function viewLabel(step: Step): string {
  if (step.kind === "decision") return "His decision, on the board";
  return step.missing ? "Through his eyes, with no look here" : "Through his eyes, frozen mid-look";
}

function viewTag(step: Step, run: string): string {
  if (step.kind === "decision") return `His decision · ${run}`;
  return step.missing ? `No look · ${run}` : `Frozen mid-look · ${run}`;
}

/** One view's place: its picture (kept mounted, so moving it to the corner never rebuilds its
 * WebGL scene) and the marks drawn over it at its measured size. */
function Slot(props: {
  role: "main" | "pip";
  kind: "pov" | "board";
  scene: boolean;
  children: (w: number, h: number) => ReactNode;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>(FALLBACK_SIZE);
  return (
    <div ref={ref} className={`ss-slot ${props.role} ss-${props.kind}`}>
      {props.scene && (props.kind === "pov" ? <PovView /> : <TacticalView />)}
      {props.children(w, h)}
    </div>
  );
}

/** Arrowheads for the movement hints, one per team. */
function Defs() {
  return (
    <defs>
      {(["home", "away"] as const).map((team) => (
        <marker
          key={team}
          id={`ss-head-${team}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className={`ss-head ${team}`} />
        </marker>
      ))}
    </defs>
  );
}

const teamClass = (a: Arrow) => (a.team === 0 ? "home" : "away");

/** Over his eyes: the players this look brought into sight, where the players near him are heading,
 * and the potential passes, all projected with the first-person camera's pose. */
function PovMarks(props: {
  hero: Hero;
  run: Run;
  step: Step;
  passes: boolean;
  w: number;
  h: number;
}) {
  const { hero, run, step, passes, w, h } = props;
  const turn = useHalfTurn(hero, run);
  if (step.kind === "decision") {
    // At his decision his eyes only carry the half-turn arc, when the data shows one.
    if (!turn) return null;
    const pose = povPose(hero, run, hero.hero, step.frame, w / h);
    return (
      <svg className="ss-marks" width={w} height={h} aria-hidden="true">
        <HalfTurnArc turn={turn} segment={(a, b) => projectSegment(pose, a, b, w, h, 0.03, 0.3)} />
      </svg>
    );
  }
  if (step.kind !== "look") return null;
  const pose = povPose(hero, run, hero.hero, step.frame, w / h);
  const n = hero.n;
  const f = step.frame;
  const at = (j: number): Vec2 => [run.pos[(f * n + j) * 2], run.pos[(f * n + j) * 2 + 1]];
  const arrows = movementArrows(hero, run, f, step.vel);
  const lanes = passes ? potentialPasses(hero, run, step.missing ? [] : step.sight) : [];
  const rings = step.missing ? [] : step.sight.map((id) => hero.ids.indexOf(id));
  // Ringed players, nearest first (lowest on the picture): their names stack instead of overlapping.
  const seen = rings
    .map((j) => {
      const feet = project(pose, at(j), w, h, 0);
      const head = project(pose, at(j), w, h, 2.0);
      if (!inView(feet, w, h, 40) || !head) return null;
      const name = shortName(hero.ids[j]);
      // A name near the picture's edge moves in rather than being cut ("H. Talvis").
      const half = (name.length * TAG_CHAR_PX + 6) / 2;
      const x = Math.min(Math.max(feet[0], half + 2), w - half - 2);
      return { j, feet, head, tall: Math.max(18, feet[1] - head[1]), name, x, half };
    })
    .filter((r) => r !== null)
    .sort((a, b) => b.feet[1] - a.feet[1]);
  const rows = stackTags(
    seen.map(({ feet, x, half }) => ({ x, y: feet[1] + 16, w: 2 * half })),
    TAG_ROW_PX,
  );
  return (
    <svg className="ss-marks" width={w} height={h} aria-hidden="true">
      <Defs />
      {lanes.map((lane) => {
        // From a few metres out: under his feet a lane runs off the bottom of the picture.
        const seg = projectSegment(pose, lane.from, lane.to, w, h, 0.02, LANE_NEAR_M);
        if (!seg) return null;
        return <LaneLine key={lane.action} lane={lane} a={seg[0]} b={seg[1]} w={w} h={h} />;
      })}
      {arrows.map((a) => {
        const seg = projectSegment(pose, a.from, a.to, w, h, 0.05);
        if (!seg) return null;
        return (
          <line
            key={a.player}
            className={`ss-arrow ${teamClass(a)}`}
            x1={seg[0][0]}
            y1={seg[0][1]}
            x2={seg[1][0]}
            y2={seg[1][1]}
            markerEnd={`url(#ss-head-${teamClass(a)})`}
          />
        );
      })}
      {seen.map(({ j, feet, head, tall, name, x }, k) => (
        <g key={j} className="ss-seen">
          <ellipse cx={feet[0]} cy={(feet[1] + head[1]) / 2} rx={tall * 0.32} ry={tall * 0.62} />
          {rows[k] !== null && (
            <text x={x} y={feet[1] + 16 + rows[k]! * TAG_ROW_PX}>
              {name}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function LaneLine(props: {
  lane: Lane;
  a: Vec2;
  b: Vec2;
  w: number;
  h: number;
  small?: boolean; // in the corner view: only his pick and the receivers this look found named
}) {
  const { lane, a, b, w, h, small } = props;
  const cls = `ss-lane ${lane.chosen ? "chosen" : lane.seen ? "seen" : ""} ${lane.kind}`;
  const width = (small ? 1 : 1.5) + (small ? 3 : 7) * Math.min(1, Math.max(0, lane.prob));
  const named = !small || lane.chosen || lane.seen;
  const end = inView(b, w, h, -8);
  return (
    <g className={cls}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={width} />
      {end && <circle cx={b[0]} cy={b[1]} r={small ? 2.5 : 4} />}
      {end && named && (
        <text x={b[0]} y={b[1] - 8}>
          {lane.receiver ? shortName(lane.receiver) : lane.kind === "carry" ? "Carry" : "Shot"}
        </text>
      )}
    </g>
  );
}

/** Over the board: the same marks top-down, and at the decision the dimming that leaves two lit. */
function BoardMarks(props: {
  hero: Hero;
  run: Run;
  step: Step;
  passes: boolean;
  w: number;
  h: number;
  main: boolean;
}) {
  const { hero, run, step, passes, w, h, main } = props;
  const zoom = boardZoom(w, h);
  const n = hero.n;
  const f = step.frame;
  const at = (j: number): Vec2 =>
    toScreen([run.pos[(f * n + j) * 2], run.pos[(f * n + j) * 2 + 1]], w, h, zoom);
  const look = step.kind === "look" ? step : null;
  const focus = step.kind === "decision" ? focusPlayers(hero, step) : null;
  // At his decision only the two players it turns on keep their arrows: the rest is dimmed.
  const arrows = movementArrows(hero, run, f, step.vel).filter(
    (a) => !focus || focus.includes(a.player),
  );
  // At his decision the board always shows the lane he chose; "Potential passes" adds the rest.
  const all = potentialPasses(hero, run, look && !look.missing ? look.sight : []);
  const lanes = passes ? all : step.kind === "decision" ? all.filter((l) => l.chosen) : [];
  const rings = look && !look.missing ? look.sight.map((id) => hero.ids.indexOf(id)) : [];
  const turn = useHalfTurn(hero, run);
  return (
    <>
      {focus && main && <FocusDim hero={hero} step={step as DecisionStep} at={at} zoom={zoom} />}
      <svg className={main ? "ss-marks" : "ss-marks small"} width={w} height={h} aria-hidden="true">
        <Defs />
        {lanes.map((lane) => {
          const a = toScreen(lane.from, w, h, zoom);
          const b = toScreen(lane.to, w, h, zoom);
          return <LaneLine key={lane.action} lane={lane} a={a} b={b} w={w} h={h} small={!main} />;
        })}
        {arrows.map((a) => {
          const p = toScreen(a.from, w, h, zoom);
          const q = toScreen(a.to, w, h, zoom);
          return (
            <line
              key={a.player}
              className={`ss-arrow ${teamClass(a)}`}
              x1={p[0]}
              y1={p[1]}
              x2={q[0]}
              y2={q[1]}
              markerEnd={`url(#ss-head-${teamClass(a)})`}
            />
          );
        })}
        {turn && step.kind === "decision" && (
          <HalfTurnArc
            turn={turn}
            segment={(a, b) => [toScreen(a, w, h, zoom), toScreen(b, w, h, zoom)]}
          />
        )}
        {rings.map((j) => {
          const [x, y] = at(j);
          return (
            <circle key={j} className="ss-seen-dot" cx={x} cy={y} r={Math.max(7, 1.6 * zoom)} />
          );
        })}
        {focus?.map((j) => {
          const [x, y] = at(j);
          return (
            <g key={j} className="ss-focus-ring">
              <circle cx={x} cy={y} r={Math.max(FOCUS_MIN_PX, FOCUS_RADIUS_M * zoom)} />
              <text x={x} y={y - Math.max(FOCUS_MIN_PX, FOCUS_RADIUS_M * zoom) - 6}>
                {shortName(hero.ids[j])}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}

/** Dim the whole board but a circle round each of the two players the decision turns on (a mask
 * with two holes over a backdrop filter). Dimmed, never blurred: the picture stays clear. */
export function FocusDim(props: {
  hero: Hero;
  step: DecisionStep;
  at: (j: number) => Vec2;
  zoom: number;
}) {
  const { hero, step, at, zoom } = props;
  const pair = focusPlayers(hero, step);
  const r = Math.max(FOCUS_MIN_PX, FOCUS_RADIUS_M * zoom);
  const holes = pair.map((j) => {
    const [x, y] = at(j);
    return `radial-gradient(circle ${r + 14}px at ${x}px ${y}px, transparent ${r}px, #000 ${r + 14}px)`;
  });
  const mask = holes.join(", ");
  return (
    <div
      className="ss-focus"
      data-focus={pair.map((j) => hero.ids[j]).join(" ")}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}

/** What the marks mean: drawing conventions, in words. */
function Legend({ step, passes }: { step: Step; passes: boolean }) {
  return (
    <ul className="ss-legend" aria-label="What the marks show">
      <li>
        <i className="ss-key-arrow" aria-hidden="true" />
        Dashed arrows: where each player near him is heading, projected a second ahead from his
        speed at this frame. A projection, not where he went.
      </li>
      {step.kind === "look" && !step.missing && (
        <li>
          <i className="ss-key-seen" aria-hidden="true" />
          Ringed: came into his sight on this look.
        </li>
      )}
      {passes && (
        <li>
          <i className="ss-key-lane" aria-hidden="true" />
          Lanes: the options he weighed at his decision, from the sim's record (the model weighs
          them only then); wider is likelier, gold is his pick. Every pass in the sim is along the
          ground.
        </li>
      )}
      {!passes && step.kind === "decision" && (
        <li>
          <i className="ss-key-lane" aria-hidden="true" />
          Gold lane: his pick. Lit: the two players it turns on; the rest is dimmed.
        </li>
      )}
    </ul>
  );
}

/** The steps in order: his looks (one not taken in this run is struck through), then his
 * decision. */
function Strip({ st }: { st: StepThrough }) {
  const s = useStore(st.state, (x) => x);
  const steps = st.list();
  let look = 0;
  return (
    <ol className="ss-strip" aria-label="Steps">
      {steps.map((step, k) => {
        const label = step.kind === "decision" ? "Decision" : `Look ${(look += 1)}`;
        const full = step.kind === "look" && step.missing ? `${label}, not taken here` : label;
        return (
          <li key={step.id}>
            <button
              type="button"
              className={[
                "ss-dot",
                k === s.index ? "on" : "",
                step.kind === "look" && step.missing ? "missing" : "",
              ].join(" ")}
              aria-current={k === s.index ? "step" : undefined}
              aria-label={full}
              onClick={() => st.go(k)}
            >
              {label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- the card ----------

function Card({ st }: { st: StepThrough }) {
  const s = useStore(st.state, (x) => x);
  const lang = useLanguage();
  const heading = useRef<HTMLHeadingElement>(null);
  const hero = st.session.hero;
  const labels = runLabels(hero);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [s.open, s.status]);
  const exit = (
    <button type="button" className="btn btn-quiet" onClick={st.close}>
      Back to the replay
    </button>
  );
  const steps = st.steps();
  if (s.status !== "ready" || !steps) {
    return (
      <aside className="ss-card" aria-labelledby="ss-title">
        <h2 id="ss-title" ref={heading} tabIndex={-1}>
          His looks
        </h2>
        <p className="ss-lead" role="status">
          {s.status === "error"
            ? `His looks could not be loaded: ${s.error}`
            : "Loading his looks…"}
        </p>
        <div className="ss-actions">{exit}</div>
      </aside>
    );
  }
  const runSteps = steps.runs[s.mode];
  const list = runSteps.steps;
  const step = list[s.index];
  const narration = runSteps.answers[lang] ?? runSteps.answers.en;
  const ids = [...(s.index === 0 ? runSteps.intro : []), ...step.lines];
  const looks = list.filter((x) => x.kind === "look");
  const lookNo = step.kind === "look" ? looks.indexOf(step) + 1 : 0;
  const kicker =
    step.kind === "decision"
      ? "The last step"
      : step.missing
        ? `Look ${lookNo} · not taken in this run`
        : `Look ${lookNo}`;
  const last = s.index === list.length - 1;
  return (
    <aside className="ss-card" aria-labelledby="ss-title">
      <p className="ss-kicker">{kicker}</p>
      <h2 id="ss-title" ref={heading} tabIndex={-1} aria-live="polite">
        {stepTitle(step)}
      </h2>
      <Lines narration={narration} ids={ids} />
      <LookStoryBlock st={st} step={step} />
      <DecisionStoryBlock st={st} step={step} />
      {step.kind === "look" && !step.missing && step.sight.length > 0 && (
        <SightChips hero={hero} ids={step.sight} />
      )}
      <button
        type="button"
        className="btn ss-passes"
        aria-pressed={s.passes}
        onClick={st.togglePasses}
      >
        Potential passes
      </button>
      <Segmented<RunName>
        label="Which run"
        value={s.mode}
        onPick={st.setMode}
        options={[
          { value: "factual", label: labels.factual },
          { value: "counterfactual", label: labels.counterfactual },
        ]}
      />
      <div className="ss-actions">
        {/* One element each, so focus stays on them from step to step: Back is only marked
            unavailable on the first step, and Next becomes Done on the last. */}
        <button type="button" className="btn" aria-disabled={s.index === 0} onClick={st.back}>
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={last ? st.close : st.next}>
          {last ? "Done" : "Next"}
        </button>
        {!last && exit}
      </div>
      <p className="ss-hint">Keyboard: ← and → step, Esc leaves. On a phone, swipe the picture.</p>
    </aside>
  );
}

function Lines({ narration, ids }: { narration?: Narration; ids: string[] }) {
  const lines = (narration?.lines ?? []).filter((l: PayloadLine) => ids.includes(l.id));
  if (!narration || !lines.length) return null;
  return (
    <ul className="ss-lines" aria-label="Verified lines">
      {lines.map((l) => (
        <li key={l.id}>
          <KindTags narration={narration} line={l} />
          <span className="ss-line">
            <LineText text={l.text} verified={isVerified(narration, l)} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function SightChips({ hero, ids }: { hero: Hero; ids: string[] }) {
  return (
    <div className="ss-sight">
      <p className="ss-label">Came into his sight on this look</p>
      <ul>
        {ids.map((id) => {
          const p = hero.players[hero.ids.indexOf(id)];
          return (
            <li key={id} className={p?.team === 0 ? "home" : "away"}>
              {shortName(id)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type { LookStep };
