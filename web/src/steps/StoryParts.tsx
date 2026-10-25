// The coaching story of the scan step-through (story.ts): the timeline strip under the picture, the
// per-look and decision blocks on the card, and the half-turn arc drawn over the board and his eyes.

import { useMemo } from "react";
import type { Hero, Run } from "../data/hero";
import type { Vec2 } from "../data/types";
import { useStore } from "../store/store";
import type { StepThrough } from "./controller";
import type { Step } from "./steps";
import {
  decisionStory,
  fewScansLine,
  halfTurn,
  halfTurnArc,
  lookStory,
  pictureView,
  scansBeforeReceiving,
  tagOf,
  tickLabel,
  timeline,
  type HalfTurn,
} from "./story";

/** The half-turn of the run on screen, or null (the story then says nothing about turning). */
export function useHalfTurn(hero: Hero, run: Run): HalfTurn | null {
  return useMemo(() => halfTurn(hero, run), [hero, run]);
}

/** A tick per scan on the time before his decision, labelled L, R, B or F against his body;
 * clicking one jumps to that freeze. The reception is marked; the decision is a tick of its own. */
export function ScanTimeline({ st }: { st: StepThrough }) {
  const s = useStore(st.state, (x) => x);
  const hero = st.session.hero;
  const steps = st.list();
  const run = hero.runs[s.mode];
  const line = useMemo(() => timeline(hero, run, steps), [hero, run, steps]);
  if (!steps.length) return null;
  let number = 0;
  return (
    <div className="ss-timeline" role="group" aria-label="Scan timeline">
      <div className="ss-rail" aria-hidden="true" />
      <span
        className="ss-tl-mark"
        style={{ left: `${line.reception * 100}%` }}
        title="The ball reaches him"
      >
        <i />
        <b>Ball arrives</b>
      </span>
      {line.ticks.map((t) => {
        number += 1;
        return (
          <button
            key={t.stepId}
            type="button"
            className={[
              "ss-tick",
              t.stepIndex === s.index ? "on" : "",
              t.missing ? "missing" : "",
            ].join(" ")}
            style={{ left: `${t.frac * 100}%` }}
            aria-label={tickLabel(t, number)}
            aria-current={t.stepIndex === s.index ? "step" : undefined}
            onClick={() => st.go(t.stepIndex)}
          >
            {t.label}
          </button>
        );
      })}
      {line.decision >= 0 && (
        <button
          type="button"
          className={`ss-tick decide${line.decision === s.index ? " on" : ""}`}
          style={{ left: "100%" }}
          aria-label="His decision"
          aria-current={line.decision === s.index ? "step" : undefined}
          onClick={() => st.go(line.decision)}
        >
          D
        </button>
      )}
    </div>
  );
}

/** The card's story for a look: where he looked, who came into view, how his picture changed, and
 * what he was thinking. Nothing for a look this run does not take. */
export function LookStoryBlock({ st, step }: { st: StepThrough; step: Step }) {
  const s = useStore(st.state, (x) => x);
  const hero = st.session.hero;
  const run = hero.runs[s.mode];
  const list = st.list();
  const story = useMemo(() => {
    if (step.kind !== "look") return null;
    const number = list.filter((x) => x.kind === "look").indexOf(step) + 1;
    return lookStory(hero, run, step, number);
  }, [hero, run, step, list]);
  if (!story) return null;
  return (
    <section className="ss-story" aria-label="What this look did">
      <p className="ss-label">Where he looked</p>
      <p className="ss-fact">
        <span className="ss-dir">{story.direction}</span>
        {story.words}, {story.degrees}° from his body's facing
      </p>
      <p className="ss-label">In view</p>
      <ul className="ss-people">
        {story.inView.length ? (
          story.inView.map((p) => (
            <li key={p.id} className={p.team === 0 ? "home" : "away"}>
              {tagOf(p)}
            </li>
          ))
        ) : (
          <li className="none">Nobody new</li>
        )}
      </ul>
    </section>
  );
}

/** What a frozen step changed and what he made of it: for a look, who is new in his picture (or
 * that nothing is); his options on his belief, compared at the same frame with and without the look,
 * ↑ opened, ↓ closed, ↗ rose and ↘ fell; and one line of what he is thinking that links the two.
 * The start view lists his options before any look. Nothing for a missing look or the decision. */
export function PictureBlock({ st, step }: { st: StepThrough; step: Step }) {
  const s = useStore(st.state, (x) => x);
  const hero = st.session.hero;
  const run = hero.runs[s.mode];
  const teaching = !!st.steps()?.teaching;
  const view = useMemo(() => pictureView(hero, run, step, teaching), [hero, run, step, teaching]);
  if (!view) return null;
  return (
    <section className="ss-story ss-picture" aria-label="What he knew and could do">
      {view.news && (
        <>
          <p className="ss-label">New in his picture</p>
          {view.news.length ? (
            <ul className="ss-news">
              {view.news.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="ss-fact ss-nothing">Nothing new in his picture.</p>
          )}
        </>
      )}
      <p className="ss-label">{view.optionsLabel}</p>
      {view.optionsNote && <p className="ss-source">{view.optionsNote}</p>}
      <ul className="ss-options">
        {view.options.map((o) => (
          <li
            key={o.action}
            className={
              o.mark === "↑" || o.mark === "↗"
                ? "up"
                : o.mark === "↓" || o.mark === "↘"
                  ? "down"
                  : ""
            }
          >
            <span className="ss-opt">{o.label}</span>
            <span className="ss-p">
              {o.before !== null && view.compare ? `${percent(o.before)} → ` : ""}
              {percent(o.now)}
            </span>
            {o.mark && (
              <b
                className="ss-mark"
                aria-label={
                  o.mark === "↑"
                    ? "opened"
                    : o.mark === "↓"
                      ? "closed"
                      : o.mark === "↗"
                        ? "rose"
                        : "fell"
                }
              >
                {o.mark}
              </b>
            )}
          </li>
        ))}
      </ul>
      <p className="ss-label">What he's thinking</p>
      <blockquote className="ss-think">{view.thinking}</blockquote>
      <p className="ss-source">
        Believed chance of success, from the decision model on his belief at this frame, as if the
        ball were at his feet. Template filled from the sim's data; no model wrote it.
      </p>
    </section>
  );
}

const percent = (p: number) => `${Math.round(p * 100)}%`;

/** The card's story for the decision: what he chose and why (from the looks), the half-turn when
 * the data shows it, and the honest line when he made fewer scans than players average. */
export function DecisionStoryBlock({ st, step }: { st: StepThrough; step: Step }) {
  const s = useStore(st.state, (x) => x);
  const hero = st.session.hero;
  const run = hero.runs[s.mode];
  const list = st.list();
  const story = useMemo(() => decisionStory(hero, run, list), [hero, run, list]);
  const turn = useHalfTurn(hero, run);
  const few = fewScansLine(scansBeforeReceiving(hero, run));
  if (step.kind !== "decision" || (!story && !turn && !few)) return null;
  return (
    <section className="ss-story" aria-label="Why he chose it">
      {story && (
        <ul className="ss-why">
          {story.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {turn && (
        <p className="ss-fact ss-turn">
          <strong>{turn.caption}.</strong> {turn.detail}
        </p>
      )}
      {few && <p className="ss-fact ss-few">{few}</p>}
      <p className="ss-source">Template filled from the sim's data; no model wrote it.</p>
    </section>
  );
}

/** The arc as SVG lines. `segment` maps a pitch segment to the picture (the board's, or his
 * eyes', which clips what passes behind him); null where it is out of the picture. */
export function HalfTurnArc({
  turn,
  segment,
}: {
  turn: HalfTurn;
  segment: (a: Vec2, b: Vec2) => [Vec2, Vec2] | null;
}) {
  const { arc, tick } = halfTurnArc(turn);
  const pairs = [...arc.slice(1).map((p, k) => [arc[k], p] as [Vec2, Vec2]), tick];
  return (
    <g className="ss-turn-arc">
      {pairs.map(([a, b], k) => {
        const seg = segment(a, b);
        if (!seg) return null;
        const at = { x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1] };
        return (
          <g key={k}>
            <line className="under" {...at} />
            <line {...at} />
          </g>
        );
      })}
    </g>
  );
}
