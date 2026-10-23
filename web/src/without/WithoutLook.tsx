// "Without the look", told on screen (SPEC 7; teammates' feedback 2026-10-21), from the verified
// lines of without.ts:
// - where the caption goes, in the run without the look while no caption is up: which look was
//   removed and what that cost;
// - at the edge of his eyes, on that shoulder's side, while the look would have lasted;
// - in the verdict: what was held constant, how often the held-out seeds change (gates.ts), and
//   where each run's pass went, in expected threat, with an explainer that draws the xT grid and
//   both passes' ends. The two values on the grid are the verified line's. Every count on the
//   held-out line is read from hero_gates.json.

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Hero } from "../data/hero";
import type { Narration, PayloadLine } from "../narration/payload";
import { SourceChip } from "../provenance/SourceChip";
import { useView } from "../session";
import { createStore, useStore, type Store } from "../store/store";
import { KindTags, LineText } from "../ui/Narration";
import type { Language } from "../whatif/whatif";
import { heroGatesOf, type HeroGate, type HeroGatesState } from "./gates";
import { withoutLookOf, type WithoutLook, type WithoutLookState } from "./without";
import { passMoves } from "../xtexplain/moves";
import { usePersona, XtMoveExplain } from "../xtexplain/XtMoveExplain";
import { versionFor } from "../xtexplain/zones";
import "./without.css";

const NONE: Store<WithoutLookState> = createStore<WithoutLookState>({
  status: "none",
  data: null,
  error: null,
});
const NO_GATES: Store<HeroGatesState> = createStore<HeroGatesState>({
  status: "none",
  gate: null,
});
const NO_LANGUAGE: Store<{ language: Language }> = createStore({ language: "en" as Language });

/** The bundled lines of the hero moment on screen, once the app has loaded them (main.tsx, or a
 * match opening the breakdown); null on a match or before. Components never fetch. */
function useWithoutLook(): WithoutLook | null {
  const session = useView();
  const c = session.kind === "hero" ? withoutLookOf(session) : null;
  return useStore(c?.state ?? NONE, (s) => s.data);
}

/** This hero's held-out count, once the session has loaded it; null when the file is missing. */
function useHeroGate(): HeroGate | null {
  const session = useView();
  const c = session.kind === "hero" ? heroGatesOf(session) : null;
  return useStore(c?.state ?? NO_GATES, (s) => s.gate);
}

/** The held-out sentence. Every count is the entry's; the wording follows what changed. */
function heldOutText(gate: HeroGate): string {
  const [first, last] = gate.seeds;
  const span = `${first}–${last}`;
  const changed =
    gate.what === "decision"
      ? `he decides differently in ${gate.changed}`
      : `he places the shot differently in ${gate.changed}`;
  return `Over ${gate.n} held-out seeds (${span}), ${changed}; in ${gate.same} he doesn't.`;
}

/** What the comparison kept the same, then — when the file has this hero — how often it changes. */
function ComparisonBasis({ gate }: { gate: HeroGate | null }) {
  return (
    <>
      <p className="without-basis">
        Held constant: the same match and the same seed; only this one look is removed.
      </p>
      {gate && (
        <p className="without-basis">
          {heldOutText(gate)}{" "}
          {/* SourceChip has no eval-report kind; "sim" is the nearest, and the title says this
              is an eval result read from a committed report, not a live sim value. */}
          <SourceChip kind="sim" title={`Eval result from ${gate.report}`} spoken />
        </p>
      )}
    </>
  );
}

/** The narration in the breakdown's language, else English; and its lines by id. */
function useNarration(w: WithoutLook | null): {
  narration: Narration | null;
  line: (id: string) => PayloadLine | undefined;
} {
  const session = useView();
  const language = useStore(
    session.kind === "hero" ? session.breakdown : NO_LANGUAGE,
    (b) => b.language,
  );
  const narration = w?.answers[language] ?? w?.answers.en ?? null;
  return { narration, line: (id) => narration?.lines.find((l) => l.id === id) };
}

/** In the caption's place, in the run without the look: which look, and what it cost. */
export function WithoutLookNote() {
  const { playback } = useView();
  const mode = useStore(playback, (s) => s.mode);
  const w = useWithoutLook();
  const { narration, line } = useNarration(w);
  const [explain, setExplain] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  if (mode !== "counterfactual" || !narration) return null;
  const shown = [line("removed_look"), line("look_cost")].filter((l): l is PayloadLine => !!l);
  if (!shown.length) return null;
  const zones = line("pass_zones");
  return (
    <div className="without-note" role="note" aria-label="The run without the look">
      {shown.map((l) => (
        <p key={l.id} className={`without-line ${l.id}`}>
          <LineText text={l.text} verified />
        </p>
      ))}
      {zones && (
        <button
          ref={opener}
          type="button"
          className="link without-xt"
          onClick={() => setExplain(true)}
        >
          Where the pass went
        </button>
      )}
      {explain && w && zones && (
        <XtExplainer
          w={w}
          narration={narration}
          line={zones}
          opener={opener}
          onClose={() => setExplain(false)}
        />
      )}
    </div>
  );
}

/** In the verdict: what was held constant, the held-out count, what it cost and where each pass
 * went, with the xT explainer. */
export function WithoutLookLines() {
  const w = useWithoutLook();
  const gate = useHeroGate();
  const { narration, line } = useNarration(w);
  const [explain, setExplain] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const shown = narration
    ? [line("look_cost"), line("pass_zones")].filter((l): l is PayloadLine => !!l)
    : [];
  // The comparison, once this hero has bundled lines or a held-out count. The count is hidden
  // when its entry is missing; what was held constant stays.
  if (!narration && !gate) return null;
  const zones = narration ? line("pass_zones") : undefined;
  return (
    <div className="without-lines">
      <ComparisonBasis gate={gate} />
      {narration &&
        shown.map((l) => (
          <p key={l.id} className={`worth-line ${l.id}`}>
            <LineText text={l.text} verified /> <KindTags narration={narration} line={l} />
          </p>
        ))}
      {zones && (
        <button ref={opener} type="button" className="btn" onClick={() => setExplain(true)}>
          How xT works
        </button>
      )}
      {explain && w && zones && narration && (
        <XtExplainer
          w={w}
          narration={narration}
          line={zones}
          opener={opener}
          onClose={() => setExplain(false)}
        />
      )}
    </div>
  );
}

/** The edge of his eyes on the removed look's side, while the look would have lasted. */
export function RemovedLookEdge() {
  const { hero, playback } = useView();
  const w = useWithoutLook();
  const on = useStore(
    playback,
    (s) =>
      !!w &&
      s.mode === "counterfactual" &&
      s.camera === "pov" &&
      s.povPlayer === hero.heroId &&
      s.frame >= w.removed.start &&
      s.frame <= w.removed.end,
  );
  if (!on || !w?.side) return null;
  return (
    <div className={`removed-edge ${w.side}`} aria-hidden="true">
      <span>Removed look</span>
    </div>
  );
}

// ---------- the explainer ----------

const LENGTH = 105;
const WIDTH = 68;
const PX = 10; // svg units per metre

/** His team's attacking direction: the grid is for a team attacking +x (home). */
function attackSign(hero: Hero): number {
  const me = hero.players.find((p) => p.id === hero.heroId);
  return me?.team === 1 ? -1 : 1;
}

/** The value of `slot` as the verified line shows it (three decimals), if the line holds it. */
function shownValue(
  narration: Narration,
  line: PayloadLine,
  slot: string,
): { text: string; raw: number } | null {
  const raw = narration.claims.get("pass_zones")?.values[slot];
  if (typeof raw !== "number") return null;
  const text = raw.toFixed(3);
  return line.text.includes(text) ? { text, raw } : null;
}

function XtExplainer({
  w,
  narration,
  line,
  opener,
  onClose,
}: {
  w: WithoutLook;
  narration: Narration;
  line: PayloadLine;
  opener: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { hero } = useView();
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    const back = opener.current;
    return () => back?.focus({ preventScroll: true });
  }, [opener]);
  const sign = attackSign(hero);
  const max = Math.max(...w.grid, 1e-9);
  const cw = LENGTH / w.cols;
  const rh = WIDTH / w.rows;
  const ends = (
    [
      ["factual", hero.runs.factual.action?.end_at, shownValue(narration, line, "xt")],
      [
        "counterfactual",
        hero.runs.counterfactual.action?.end_at,
        shownValue(narration, line, "cf_xt"),
      ],
    ] as const
  ).flatMap(([run, at, value]) => {
    if (!at || !value) return [];
    const x = at[0] * sign;
    const y = at[1] * sign;
    const i = Math.min(w.cols - 1, Math.max(0, Math.floor((x + LENGTH / 2) / cw)));
    const j = Math.min(w.rows - 1, Math.max(0, Math.floor((y + WIDTH / 2) / rh)));
    return [{ run, x, y, i, j, value: value.text, raw: value.raw }];
  });
  const ending = (i: number, j: number) => ends.find((e) => e.i === i && e.j === j);
  const xtValue = ends.find((e) => e.run === "factual")?.raw;
  const cfValue = ends.find((e) => e.run === "counterfactual")?.raw;
  const moves = useMemo(
    () =>
      passMoves(hero, w, {
        xt: xtValue ?? null,
        cfXt: cfValue ?? null,
      }),
    [hero, w, xtValue, cfValue],
  );
  const technical = versionFor(usePersona()) === "concrete";
  // Pitch metres to svg: x from the own goal line, y up (his left when attacking right).
  const sx = (x: number) => (x + LENGTH / 2) * PX;
  const sy = (y: number) => (WIDTH / 2 - y) * PX;
  return createPortal(
    <div
      className="xt-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="xt-explainer card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="card-head">
          <h2 id={titleId}>Where the pass went, in expected threat</h2>
          <button ref={close} type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="xt-line">
          <LineText text={line.text} verified /> <KindTags narration={narration} line={line} />
        </p>
        <XtMoveExplain moves={moves} owner="his" valuesFrom="grid" />
        <svg
          className="xt-grid"
          viewBox={`-20 -20 ${LENGTH * PX + 40} ${WIDTH * PX + 40}`}
          role="img"
          aria-label="The expected threat grid, attacking right, with where each run's pass ended"
        >
          {w.grid.map((v, k) => {
            const i = Math.floor(k / w.rows);
            const j = k % w.rows;
            const end = ending(i, j);
            return (
              <rect
                key={k}
                className={end ? `xt-cell end ${end.run}` : "xt-cell"}
                x={i * cw * PX}
                y={(w.rows - 1 - j) * rh * PX}
                width={cw * PX}
                height={rh * PX}
                style={{ fillOpacity: 0.08 + 0.82 * Math.sqrt(v / max) }}
              />
            );
          })}
          <rect className="xt-pitch" x={0} y={0} width={LENGTH * PX} height={WIDTH * PX} />
          <line className="xt-pitch" x1={sx(0)} y1={0} x2={sx(0)} y2={WIDTH * PX} />
          {ends.map((e) => (
            <g key={e.run} className={`xt-end ${e.run}`}>
              <circle cx={sx(e.x)} cy={sy(e.y)} r={9} />
              <text
                className="xt-end-label"
                x={sx(e.x)}
                y={sy(e.y) + (e.run === "factual" ? -18 : 34)}
                textAnchor="middle"
              >
                xT {e.value}
              </text>
            </g>
          ))}
          <text className="xt-attack" x={LENGTH * PX} y={-6} textAnchor="end">
            attacking →
          </text>
        </svg>
        <p className="xt-legend">
          <i className="factual" aria-hidden="true" /> His pass{" "}
          <i className="counterfactual" aria-hidden="true" /> Without the look
        </p>
        <div className="xt-how">
          <p>
            Expected threat (xT) is how much having the ball in a zone raises a team's chance of
            scoring within its next few actions. Brighter zones are worth more.
          </p>
          {technical && (
            <p>
              Ours is a 16 × 12 grid learned from synthetic open play only, never from real matches.
              A zone's value is how often play there ends in a shot, times how often such a shot
              scores, plus how often it moves on, times the value of the zones its completed passes
              and carries reach (a lost ball is worth nothing): Singh's Markov model, solved by
              value iteration. Between zone centres the value is read smoothly, so a pass is valued
              where it ends, not by its zone alone. The difference between the two ends is what the
              look was worth.
              {!w.fitted && " This build uses the smooth prior: no fit was cached."}
            </p>
          )}
          <p>
            <a
              href="https://github.com/timothyzhbw-jpg/through-their-eyes/blob/main/docs/SPEC.md#45-expected-threat-xt"
              target="_blank"
              rel="noreferrer"
            >
              The method in the spec
            </a>
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
