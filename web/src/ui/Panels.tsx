// Chapters of the moment's story: what happened (the beats), what he believed (the decision on
// his belief), and the other match (the counterfactual and what the look was worth). Numbers here
// are read straight from the sim export and say so, in Chalk; only a value the verifier checked is
// set in Floodlight with its check (SPEC 5.3). The beats follow the hero's lens: the look over the
// shoulder (blind_side_run), a marker's look at the man he marks (corner_blind_side), or the press
// he plays out of (press_escape).

import { CountUp } from "./CountUp";
import {
  actionLabel,
  isSeen,
  runLabels,
  type Hero,
  type Marker,
  type Run,
  type Scan,
} from "../data/hero";
import type { RunName } from "../data/types";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { Chapter, Title } from "./Chapter";
import { CheckIcon } from "./icons";
import { LineText } from "./Narration";

interface Beat {
  from: number; // frame
  text: string;
}

function beats(hero: Hero, run: Run): Beat[] {
  if (hero.marker && hero.keyScan) return markerBeats(hero, run, hero.keyScan, hero.marker);
  return hero.keyScan ? scanBeats(hero, run, hero.keyScan) : pressureBeats(hero, run);
}

const SIGHT_GAP_S = 0.5; // out of sight at least this long before the look to be worth a beat

/** Where a marker's man was when the pass to him ended, in words, with the separation. */
export function markerOutcome(hero: Hero, m: Marker, run: RunName): string {
  const heroId = hero.heroId ?? "He";
  const r = m.resolved[run];
  const sep = `${heroId} ${m.separation[run].toFixed(1)} m from`;
  if (r.type === "reception") return `${m.man} receives it with ${sep} him.`;
  if (r.type === "interception" && r.player === heroId) return `${heroId} intercepts it.`;
  if (r.type === "interception") return `${r.player} intercepts it, ${sep} ${m.man}.`;
  if (r.type === "out") return `The ball goes out, ${sep} ${m.man}.`;
  return `The pass is still running when the clip ends, ${sep} ${m.man}.`;
}

/**
 * A marker's look (no decision on the ball): his man goes out of his sight, the look over his
 * shoulder (or, without it, eyes on the ball), the pass to his man and how close he was when it
 * arrived. Sight is the sim's perception (seen_by); a beat it cannot back is left out.
 */
function markerBeats(hero: Hero, run: Run, key: Scan, m: Marker): Beat[] {
  const factual = run.name === "factual";
  const heroId = hero.heroId ?? "He";
  const man = hero.runner;
  const sees = (f: number) => run.sight && isSeen(hero, run, f, hero.hero, man);
  let lastSeen = -1;
  for (let f = key.start - 1; f >= 0 && lastSeen < 0; f--) if (sees(f)) lastSeen = f;
  const gone = run.sight && lastSeen >= 0 && (key.start - lastSeen - 1) * hero.dt >= SIGHT_GAP_S;
  let seenAt = -1; // the first frame of the look in which he sees his man
  for (let f = key.start; f <= key.end && seenAt < 0; f++) if (sees(f)) seenAt = f;
  const opening = run.firstPass && run.firstPass.id !== m.pass.id ? run.firstPass : null;
  const list: (Beat | null)[] = [
    { from: 0, text: `${heroId} marks ${m.man}.` },
    opening && { from: opening.frame, text: `${opening.player} plays it to ${opening.attrs.to}.` },
    gone ? { from: lastSeen + 1, text: `${m.man} moves out of ${heroId}'s sight.` } : null,
    factual
      ? {
          from: key.start,
          text: `${heroId} checks over his shoulder: a ${((key.end - key.start) * hero.dt).toFixed(2)} s look away from the ball.`,
        }
      : {
          from: key.start,
          text: `Same moment, but ${heroId} keeps his eyes on the ball. No look over the shoulder.`,
        },
    !run.sight
      ? null
      : factual && seenAt >= 0
        ? { from: seenAt, text: `He sees ${m.man} in that look.` }
        : !factual && seenAt < 0
          ? {
              from: key.end,
              text: `He does not see ${m.man}: he pictures him where he last saw him.`,
            }
          : null,
    { from: m.pass.frame, text: `${m.pass.player} plays it to ${m.man}.` },
    { from: m.resolved[run.name].frame, text: markerOutcome(hero, m, run.name) },
  ];
  // In time order; beats on the same frame keep their order above.
  return list.filter((b): b is Beat => b !== null).sort((a, b) => a.from - b.from);
}

function scanBeats(hero: Hero, run: Run, key: Scan): Beat[] {
  const factual = run.name === "factual";
  const runner = hero.runnerId ?? "the runner";
  const dec = run.decision;
  const act = run.action;
  const err = dec && hero.runnerId ? dec.belief_error[hero.runnerId] : 0;
  const age = dec && hero.runnerId ? dec.belief_age[hero.runnerId] : 0;
  const chosen = dec ? actionLabel(dec.chosen) : "";
  const p = dec ? (dec.options.find((o) => o.action === dec.chosen)?.prob ?? 0) : 0;
  const passer = run.firstPass?.player ?? "The centre-back";
  const outcome = !act
    ? ""
    : run.decision?.chosen === "shot"
      ? "He shoots."
      : act.outcome === "complete"
        ? `Completed to ${act.receiver}.`
        : act.outcome == null
          ? "The pass is still running when the clip ends."
          : `Lost: ${act.outcome}${act.receiver ? ` by ${act.receiver}` : ""}.`;
  const s = (f: number) => (f * hero.dt).toFixed(2);
  return [
    {
      from: 0,
      text: `${passer} has the ball at the back. ${hero.heroId} drops in to receive with his back to goal.`,
    },
    {
      from: run.firstPass?.frame ?? 0,
      text: `The pass is on its way. ${runner} starts a run behind ${hero.heroId}, outside his field of view.`,
    },
    factual
      ? {
          from: key.start,
          text: `${hero.heroId} checks over his shoulder: a ${s(key.end - key.start)} s look away from the ball.`,
        }
      : {
          from: key.start,
          text: `Same moment, but ${hero.heroId} keeps his eyes on the ball. No look over the shoulder.`,
        },
    factual
      ? {
          from: key.end,
          text: `He has seen ${runner} running in behind. His picture of ${runner} is ${err.toFixed(1)} m off.`,
        }
      : {
          from: key.end,
          text: `He still pictures ${runner} where he last saw him, ${age.toFixed(1)} s ago: ${err.toFixed(1)} m from where he really is.`,
        },
    {
      from: dec ? dec.frame : run.frames - 1,
      text: `Decision: ${chosen.charAt(0).toLowerCase() + chosen.slice(1)} (chosen with probability ${p.toFixed(2)}).`,
    },
    { from: act?.end ?? run.frames - 1, text: outcome },
  ];
}

/** A decision under pressure; in the re-simulated run the forced action and what it led to. */
function pressureBeats(hero: Hero, run: Run): Beat[] {
  const factual = run.name === "factual";
  const dec = run.decision;
  const act = run.action;
  const heroId = hero.heroId ?? "He";
  const passer = run.firstPass?.player ?? "A teammate";
  const chosen = dec ? actionLabel(dec.chosen) : "";
  const p = dec ? (dec.options.find((o) => o.action === dec.chosen)?.prob ?? 0) : 0;
  const decided = dec ? dec.frame : run.frames - 1;
  const lost = run.events.find(
    (e) => e.frame >= decided && ["tackle", "interception"].includes(e.type),
  );
  const outcome = lost
    ? { from: lost.frame, text: `Lost: ${lost.type} by ${lost.player}.` }
    : act
      ? {
          from: act.end ?? run.frames - 1,
          text:
            run.decision?.chosen === "shot"
              ? "He shoots."
              : act.outcome === "complete"
                ? `Completed to ${act.receiver}: out of the press.`
                : act.outcome == null
                  ? "The pass is still running when the clip ends."
                  : `Lost: ${act.outcome}${act.receiver ? ` by ${act.receiver}` : ""}.`,
        }
      : { from: run.frames - 1, text: "He keeps the ball." };
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  return [
    { from: 0, text: `${passer} plays it to ${heroId}.` },
    { from: hero.reception, text: `${heroId} takes it with an opponent closing him down.` },
    factual
      ? {
          from: decided,
          text: `Decision: ${lower(chosen)} (chosen with probability ${p.toFixed(2)}).`,
        }
      : { from: decided, text: `Decision forced in the re-simulation: ${lower(chosen)}.` },
    outcome,
  ];
}

export function StoryPanel() {
  const { hero, playback, controls, offset } = useSession();
  const mode = useStore(playback, (s) => s.mode);
  const frame = useStore(playback, (s) => s.frame);
  const run = hero.runs[mode];
  const list = beats(hero, run).filter((b) => b.text);
  let now = 0;
  list.forEach((b, k) => {
    if (frame + 1e-6 >= b.from) now = k;
  });
  const labels = runLabels(hero);
  return (
    <Chapter
      className="story"
      kicker={`What happened · ${labels.tag[mode]}`}
      title={<Title lead="What" em="happened." />}
      lede="Every beat of the move on the match clock. Choose one to replay from there."
      aside={
        <p className="note">
          <span className="source" title="Read from the sim export, not a verified claim">
            sim
          </span>{" "}
          Timings, distances and probabilities read from the sim export.
        </p>
      }
    >
      <ol className="beats">
        {list.map((b, k) => (
          <li key={k} className={k === now ? "now" : undefined}>
            <button type="button" onClick={() => controls.seek(b.from)}>
              <span className="t">{((b.from + offset) * hero.dt).toFixed(2)} s</span>
              <span>{b.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </Chapter>
  );
}

/** What he believed at the decision: how far off his picture of the runner was, his options. */
export function DecisionPanel() {
  const { hero, playback, offset } = useSession();
  const mode = useStore(playback, (s) => s.mode);
  const run = hero.runs[mode];
  const dec = run.decision;
  if (!dec) return null;
  const runner = hero.runnerId;
  const runnerOption = runner ? dec.options.find((o) => o.action === `pass:${runner}`) : undefined;
  const at = ((dec.frame + offset) * hero.dt).toFixed(2);
  const error = runner ? dec.belief_error[runner] : null;
  return (
    <Chapter
      className="decision"
      kicker={`What he believed · at ${at} s`}
      label={`${hero.heroId}'s options at ${at} s, on his belief`}
      title={<Title lead="On his" em="belief." />}
      lede="He decides on what he believes, never on the truth. Each option is scored on his picture of the pitch; the probabilities come from the softmax of each option's expected threat."
    >
      <div className="belief">
        {runner && error !== null && (
          <figure className="numeral-figure">
            <p className="numeral">
              {error.toFixed(1)}
              <span className="unit">m</span>
            </p>
            <figcaption>
              His picture of {runner} was off by this much when he decided.{" "}
              <span className="source" title="Read from the sim export, not a verified claim">
                sim
              </span>
            </figcaption>
          </figure>
        )}
        <div className="options-figure">
          <p className="kicker">
            {hero.heroId}'s options at {at} s, on his belief{" "}
            <span className="source" title="Read from the sim export, not a verified claim">
              sim
            </span>
          </p>
          <div className="options">
            {dec.options.slice(0, 6).map((o) => (
              <div
                key={o.action}
                className={o.action === dec.chosen ? "opt chosen" : "opt"}
                title={`P(success) ${o.p_success.toFixed(2)} · value ${o.value.toFixed(4)} xT`}
              >
                <span className="name">{actionLabel(o.action)}</span>
                <span className="bar">
                  <i style={{ width: `${Math.max(1, o.prob * 100)}%` }} />
                </span>
                <span className="p">{o.prob.toFixed(2)}</span>
              </div>
            ))}
          </div>
          {runner && (
            <div className="facts">
              <Fact
                label={`Last saw ${runner}`}
                value={`${dec.belief_age[runner].toFixed(2)} s ago`}
              />
              <Fact
                label={`P(pass to ${runner} arrives), as he sees it`}
                value={runnerOption ? runnerOption.p_success.toFixed(2) : "not on"}
              />
            </div>
          )}
        </div>
      </div>
    </Chapter>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/**
 * The other match: what he did in each run and what the difference was worth. The value comes
 * from a verified counterfactual claim when the breakdown has one (Floodlight, with its check and
 * its line); otherwise from the sim export, in Chalk, marked as such.
 */
export function VerdictPanel() {
  const { hero, playback } = useSession();
  const { narration } = useBreakdown();
  const mode = useStore(playback, (s) => s.mode);
  if (!hero.counterfactual) return null;
  const labels = runLabels(hero);
  const marker = hero.marker;
  // What each run shows: his action, or for a marker how far he was from his man.
  const cardText = (run: RunName) =>
    marker
      ? `${marker.separation[run].toFixed(1)} m from ${marker.man}`
      : actionLabel(hero.runs[run].decision?.chosen ?? "");
  const claim =
    narration && !narration.fixture
      ? [...narration.claims.values()].find(
          (c) =>
            c.kind === "counterfactual" &&
            c.verdict === "supported" &&
            typeof c.values.dxt === "number" &&
            narration.lines.some((l) => l.claims.includes(c.id)),
        )
      : undefined;
  const line = claim ? narration?.lines.find((l) => l.claims.includes(claim.id)) : undefined;
  const value = claim ? (claim.values.dxt as number) : hero.deltaXt;
  const shown =
    value === null
      ? "\u2014"
      : `${value >= 0 ? "+" : "\u2212"}${Math.abs(value).toFixed(claim ? 2 : 3)}`;
  const look = !!hero.keyScan;
  return (
    <Chapter
      className="verdict"
      kicker={`Re-simulated · ${labels.tag.counterfactual}`}
      title={
        look ? <Title lead="Take the look" em="away." /> : <Title lead="The other" em="choice." />
      }
      lede={
        marker
          ? `We play the same match again with only that look removed. Everything else is held the same, so any difference comes from what he saw. Each card: how far he was from ${marker.man} when the pass to him ended.`
          : look
            ? "We play the same match again with only that look removed. Everything else is held the same, so any difference comes from what he saw."
            : "We play the same match again with his choice forced. Everything else is held the same, so any difference comes from that choice."
      }
    >
      <div className="versus">
        <div className={mode === "factual" ? "run-card on" : "run-card"}>
          <span className="kicker">{labels.tag.factual}</span>
          <span className="run-action">{cardText("factual")}</span>
        </div>
        <div className={mode === "counterfactual" ? "run-card cf on" : "run-card cf"}>
          <span className="kicker">{labels.tag.counterfactual}</span>
          <span className="run-action">{cardText("counterfactual")}</span>
        </div>
      </div>
      <div className={claim ? "worth verified" : "worth"}>
        <p className="numeral">
          {claim ? <CountUp text={shown} id={`verdict|${claim.id}|${shown}`} whenVisible /> : shown}
        </p>
        <div className="worth-text">
          {line ? (
            <p className="worth-line">
              <LineText text={line.text} verified />
            </p>
          ) : value === null ? (
            <p className="worth-line">
              {labels.gain}, in expected threat (xT), comes with the breakdown when its narration
              states it.
            </p>
          ) : (
            <p className="worth-line">{labels.gain}, in expected threat (xT).</p>
          )}
          <p className="note">
            {claim ? (
              <span className="checked">
                <CheckIcon size={12} /> Counterfactual · checked by the verifier, in code
              </span>
            ) : value === null ? null : hero.deltaSource === "lens" ? (
              <>
                <span className="source" title="From the moment's scan lens, not a verified claim">
                  lens
                </span>{" "}
                From the moment's scan lens, not a verified claim.
              </>
            ) : (
              <>
                <span className="source" title="Read from the sim export, not a verified claim">
                  sim
                </span>{" "}
                Read from the sim export, not a verified claim.
              </>
            )}{" "}
            Expected threat is how much a position raises the chance of scoring soon.
            {marker &&
              " For a marker, the look's worth is the expected turnover where the pass to his man ends: how likely his side is to win the ball there, times what is at stake."}{" "}
            Causal inside the simulation; not a claim about real football.
          </p>
        </div>
      </div>
    </Chapter>
  );
}
