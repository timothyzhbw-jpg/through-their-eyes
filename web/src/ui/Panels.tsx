// Chapters of the moment's story: what happened (the beats), what he believed (the decision on
// his belief), and the other match (the counterfactual and what the look was worth). Numbers here
// are read straight from the sim export and say so, in Chalk; only a value the verifier checked is
// set in Floodlight with its check (SPEC 5.3). The beats follow the hero's lens: the look over the
// shoulder (blind_side_run, hand-written), any other look before a decision told from the runs
// (cutback_scan; far_post_finish, where the look is at the keeper), a marker's look at the man he
// marks (corner_blind_side), or the press he plays out of (press_escape).

import { CountUp } from "./CountUp";
import { WithoutLookLines } from "../without/WithoutLook";
import {
  actionLabel,
  isSeen,
  isShot,
  runLabels,
  type Hero,
  type KeeperStep,
  type Marker,
  placedShot,
  type Run,
  type Scan,
} from "../data/hero";
import type { RunName } from "../data/types";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { Chapter, Title } from "./Chapter";
import { CheckIcon } from "./icons";
import { LineText } from "./Narration";
import { renameIds, shortName } from "../data/roster";
import { SourceChip } from "../provenance/SourceChip";

interface Beat {
  from: number; // frame
  text: string;
}

function beats(hero: Hero, run: Run): Beat[] {
  if (hero.keeperStep) return keeperBeats(hero, run, hero.keeperStep);
  if (hero.marker && hero.keyScan) return markerBeats(hero, run, hero.keyScan, hero.marker);
  // The bundled hero keeps its hand-written story: the judges' tour and the video quote it.
  if (hero.keyScan && hero.scenario === "blind_side_run") {
    return scanBeats(hero, run, hero.keyScan);
  }
  return hero.keyScan ? lookBeats(hero, run, hero.keyScan) : pressureBeats(hero, run);
}

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** How the run's shot ended (its action's outcome): a sentence for the story, a few words for
 * the counterfactual card. Null when the run's action is not a shot. */
export function shotEnd(run: Run): { from: number; text: string; short: string } | null {
  const act = run.action;
  if (!act || !isShot(run.decision?.chosen)) return null;
  const from = act.end ?? run.frames - 1;
  const keeper = act.keeper ?? "the keeper";
  if (act.outcome === "goal") return { from, text: "Goal.", short: "goal" };
  if (act.outcome === "saved")
    return { from, text: `${keeper} saves it.`, short: `saved by ${keeper}` };
  if (act.outcome === "wide") return { from, text: "Wide.", short: "wide" };
  return { from, text: "He shoots.", short: "" };
}

/** How the shot a keeper faced ended in a run, in words. */
function keeperEnd(hero: Hero, k: KeeperStep, run: RunName): { text: string; short: string } {
  const r = k.resolved[run];
  const heroId = hero.heroId ?? "He";
  if (r.type === "save") return { text: `${heroId} saves it.`, short: "He saves it" };
  if (r.type === "goal") return { text: `${k.shooter} scores.`, short: `${k.shooter} scores` };
  if (r.type === "out") return { text: "Wide.", short: "Wide" };
  return { text: "The shot is still going when the clip ends.", short: "Still going" };
}

/**
 * A keeper's step (screened_shot): the step across his goal (or, without it, standing still),
 * the build-up, the shot, whether he saw the shooter strike it, his dive and how it ended. Sight
 * is the sim's perception (seen_by); a beat it cannot back is left out.
 */
function keeperBeats(hero: Hero, run: Run, k: KeeperStep): Beat[] {
  const factual = run.name === "factual";
  const heroId = hero.heroId ?? "He";
  const shot = run.events.find((e) => e.id === k.shot.id) ?? k.shot;
  const s = hero.ids.indexOf(k.shooter);
  const r = k.resolved[run.name];
  const dive = run.events.find(
    (e) => e.type === "dive" && e.player === heroId && e.frame >= shot.frame && e.frame < r.frame,
  );
  const list: (Beat | null)[] = [
    factual
      ? { from: k.frame, text: `${heroId} steps ${k.lateral.toFixed(1)} m across.` }
      : { from: k.frame, text: `Same moment, but ${heroId} stays where he is. No step.` },
    ...run.events
      .filter((e) => e.type === "pass" && e.frame < shot.frame)
      .map((e) => ({ from: e.frame, text: `${e.player} plays it to ${e.attrs.to}.` })),
    { from: shot.frame, text: `${k.shooter} shoots.` },
    run.sight && s >= 0
      ? {
          from: shot.frame,
          text: isSeen(hero, run, shot.frame, hero.hero, s)
            ? `He sees ${k.shooter} strike it.`
            : `He does not see ${k.shooter} strike it.`,
        }
      : null,
    dive ? { from: dive.frame, text: `${heroId} dives.` } : null,
    { from: r.frame, text: keeperEnd(hero, k, run.name).text },
  ];
  return list.filter((b): b is Beat => b !== null).sort((a, b) => a.from - b.from);
}

/** How the run's pass or carry ended; null without a decision. */
function passEnd(run: Run): Beat | null {
  const act = run.action;
  if (!run.decision) return null;
  if (!act) return { from: run.frames - 1, text: "He keeps the ball." }; // a carry: no pass
  const from = act.end ?? run.frames - 1;
  if (act.outcome === "complete") return { from, text: `Completed to ${act.receiver}.` };
  if (act.outcome == null) return { from, text: "The pass is still running when the clip ends." };
  return { from, text: `Lost: ${act.outcome}${act.receiver ? ` by ${act.receiver}` : ""}.` };
}

/**
 * A look before the decision, told from the runs (cutback_scan, far_post_finish): the build-up
 * passes, the player the look is about going out of his sight, the look (or, without it, eyes on
 * the ball), whether he saw that player in it, the decision on his belief and how it ended. The
 * look is about the keeper before a shot, else the runner. Sight is the sim's perception
 * (seen_by); a beat it cannot back is left out.
 */
function lookBeats(hero: Hero, run: Run, key: Scan): Beat[] {
  const factual = run.name === "factual";
  const heroId = hero.heroId ?? "He";
  const dec = run.decision;
  const decided = dec ? dec.frame : run.frames - 1;
  const shot = isShot(hero.runs.factual.decision?.chosen);
  const target = shot ? (run.action?.keeper ?? null) : hero.runnerId;
  const t = target ? hero.ids.indexOf(target) : -1;
  const sees = (f: number) => t >= 0 && run.sight && isSeen(hero, run, f, hero.hero, t);
  let lastSeen = -1; // his last sighting of a teammate's run before the look
  for (let f = key.start - 1; f >= 0 && lastSeen < 0 && !shot; f--) if (sees(f)) lastSeen = f;
  const gone = lastSeen >= 0 && (key.start - lastSeen - 1) * hero.dt >= SIGHT_GAP_S;
  let seenAt = -1; // the first frame of the look in which he sees that player
  for (let f = key.start; f <= key.end && seenAt < 0; f++) if (sees(f)) seenAt = f;
  const p = dec ? (dec.options.find((o) => o.action === dec.chosen)?.prob ?? 0) : 0;
  const passes = run.events.filter(
    (e) => e.type === "pass" && e.player !== heroId && e.frame < decided,
  );
  const list: (Beat | null)[] = [
    ...passes.map((e) => ({ from: e.frame, text: `${e.player} plays it to ${e.attrs.to}.` })),
    gone ? { from: lastSeen + 1, text: `${target} moves out of ${heroId}'s sight.` } : null,
    factual
      ? {
          from: key.start,
          text: `${heroId} looks away from the ball: a ${((key.end - key.start) * hero.dt).toFixed(2)} s look.`,
        }
      : {
          from: key.start,
          text: `Same moment, but ${heroId} keeps his eyes on the ball. No look.`,
        },
    t < 0 || !run.sight
      ? null
      : factual && seenAt >= 0
        ? { from: seenAt, text: `He sees ${target} in that look.` }
        : !factual && seenAt < 0
          ? {
              from: key.end,
              text: `He does not see ${target}: he pictures him where he last saw him.`,
            }
          : null,
    dec
      ? {
          from: dec.frame,
          text: `Decision: ${lower(actionLabel(dec.chosen))} (chosen with probability ${p.toFixed(2)}).`,
        }
      : null,
    shotEnd(run) ?? passEnd(run),
  ];
  return list
    .filter((b): b is Beat => b !== null)
    .map(({ from, text }) => ({ from, text }))
    .sort((a, b) => a.from - b.from);
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
    : isShot(run.decision?.chosen)
      ? (shotEnd(run)?.text ?? "He shoots.")
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
          text: isShot(run.decision?.chosen)
            ? (shotEnd(run)?.text ?? "He shoots.")
            : act.outcome === "complete"
              ? `Completed to ${act.receiver}: out of the press.`
              : act.outcome == null
                ? "The pass is still running when the clip ends."
                : `Lost: ${act.outcome}${act.receiver ? ` by ${act.receiver}` : ""}.`,
        }
      : { from: run.frames - 1, text: "He keeps the ball." };
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
          <SourceChip kind="sim" /> Timings, distances and probabilities read from the sim export.
        </p>
      }
    >
      <ol className="beats">
        {list.map((b, k) => (
          <li key={k} className={k === now ? "now" : undefined}>
            <button type="button" onClick={() => controls.seek(b.from)}>
              <span className="t">{((b.from + offset) * hero.dt).toFixed(2)} s</span>
              <span>{renameIds(b.text)}</span>
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
      label={`${shortName(hero.heroId ?? "He")}'s options at ${at} s, on his belief`}
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
              His picture of {shortName(runner)} was off by this much when he decided.{" "}
              <SourceChip kind="sim" />
            </figcaption>
          </figure>
        )}
        <div className="options-figure">
          <p className="kicker">
            {shortName(hero.heroId ?? "He")}'s options at {at} s, on his belief{" "}
            <SourceChip kind="sim" />
          </p>
          <div className="options">
            {dec.options.slice(0, 6).map((o) => (
              <div
                key={o.action}
                className={o.action === dec.chosen ? "opt chosen" : "opt"}
                title={`P(success) ${o.p_success.toFixed(2)} · value ${o.value.toFixed(4)} xT`}
              >
                <span className="name">{renameIds(actionLabel(o.action))}</span>
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
                label={`Last saw ${shortName(runner)}`}
                value={`${dec.belief_age[runner].toFixed(2)} s ago`}
              />
              <Fact
                label={`P(pass to ${shortName(runner)} arrives), as he sees it`}
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
  const step = hero.keeperStep;
  const cardText = (run: RunName) => {
    if (marker) return `${marker.separation[run].toFixed(1)} m from ${marker.man}`;
    if (step) return keeperEnd(hero, step, run).short;
    const action = actionLabel(hero.runs[run].decision?.chosen ?? "");
    const end = shotEnd(hero.runs[run])?.short; // a shot: and how it ended
    return end ? `${action} · ${end}` : action;
  };
  const shot = placedShot(hero); // worth a chance of scoring on the truth, not xT
  const num = (x: unknown): x is number => typeof x === "number";
  // The verified worth: `dxt` (cf_value), or a placed shot's chances without and with the look
  // (cf_shot_value: p0, p1), on a line the narration airs.
  const claim =
    narration && !narration.fixture
      ? [...narration.claims.values()].find(
          (c) =>
            c.kind === "counterfactual" &&
            c.verdict === "supported" &&
            (num(c.values.dxt) || (num(c.values.p0) && num(c.values.p1))) &&
            narration.lines.some((l) => l.claims.includes(c.id)),
        )
      : undefined;
  const line = claim ? narration?.lines.find((l) => l.claims.includes(claim.id)) : undefined;
  const signed = (x: number, digits: number) =>
    `${x >= 0 ? "+" : "\u2212"}${Math.abs(x).toFixed(digits)}`;
  const { dxt, p0, p1 } = claim?.values ?? {};
  const shown = num(dxt)
    ? signed(dxt, 2)
    : num(p0) && num(p1)
      ? `${p0.toFixed(2)} \u2192 ${p1.toFixed(2)}`
      : hero.deltaXt === null
        ? "\u2014"
        : signed(hero.deltaXt, 3);
  const pending = !claim && hero.deltaXt === null; // nothing measured yet
  const unit = shot || step ? "on the true positions" : "in expected threat (xT)";
  const look = !!hero.keyScan;
  return (
    <Chapter
      className="verdict"
      kicker={`Re-simulated · ${labels.tag.counterfactual}`}
      title={
        step ? (
          <Title lead="Take the step" em="away." />
        ) : look ? (
          <Title lead="Take the look" em="away." />
        ) : (
          <Title lead="The other" em="choice." />
        )
      }
      lede={
        step
          ? "We play the same match again with only that step removed. Everything else is held the same, so any difference comes from where he stood."
          : marker
            ? `We play the same match again with only that look removed. Everything else is held the same, so any difference comes from what he saw. Each card: how far he was from ${shortName(marker.man)} when the pass to him ended.`
            : look
              ? "We play the same match again with only that look removed. Everything else is held the same, so any difference comes from what he saw."
              : "We play the same match again with his choice forced. Everything else is held the same, so any difference comes from that choice."
      }
    >
      <div className="versus">
        <div className={mode === "factual" ? "run-card on" : "run-card"}>
          <span className="kicker">{labels.tag.factual}</span>
          <span className="run-action">{renameIds(cardText("factual"))}</span>
        </div>
        <div className={mode === "counterfactual" ? "run-card cf on" : "run-card cf"}>
          <span className="kicker">{labels.tag.counterfactual}</span>
          <span className="run-action">{renameIds(cardText("counterfactual"))}</span>
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
          ) : pending ? (
            <p className="worth-line">
              {labels.gain}, {unit}, comes with the breakdown when its narration states it.
            </p>
          ) : (
            <p className="worth-line">
              {labels.gain}, {unit}.
            </p>
          )}
          <p className="note">
            {claim ? (
              <span className="checked">
                <CheckIcon size={12} /> Counterfactual · checked by the verifier, in code
              </span>
            ) : pending ? null : hero.deltaSource === "lens" ? (
              <>
                <SourceChip kind="lens" /> From the moment's scan lens, not a verified claim.
              </>
            ) : (
              <>
                <SourceChip kind="sim" /> Read from the sim export, not a verified claim.
              </>
            )}{" "}
            {step
              ? "His chance of saving it is the save model's, from when he first saw the ball and how far he could reach, on the true positions."
              : shot
                ? "His chance of scoring is the chance the shot he chose goes in: on target and not saved, on the true positions."
                : "Expected threat is how much a position raises the chance of scoring soon."}
            {marker &&
              " For a marker, the look's worth is the expected turnover where the pass to his man ends: how likely his side is to win the ball there, times what is at stake."}{" "}
            Causal inside the simulation; not a claim about real football.
          </p>
          <WithoutLookLines />
        </div>
      </div>
    </Chapter>
  );
}
