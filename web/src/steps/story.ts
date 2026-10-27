// The scan step-through as a coaching story (SPEC 7): for every look the hero takes before the ball
// reaches him, which way he looked against his own body, who came into view, how his picture of the
// pitch changed and what he was thinking; then his decision, linked to what the looks showed; then,
// only when the data shows it, that he received the ball on the half-turn.
//
// Everything here is computed in TypeScript from the exports the app already loads (positions, head
// and body yaw, the hero's belief ghosts, the decision record) and the bundled steps. The sentences
// are templates with data slots: no model writes them and every digit is a data value.

import { actionLabel, wrapAngle, type Hero, type Run } from "../data/hero";
import { shortName } from "../data/roster";
import type { Vec2 } from "../data/types";
import { HALF_LENGTH } from "../tacticslab/metrics";
import { TEACHING_WORDS } from "./coach";
import {
  NEW_M,
  receptionOf,
  type BeatStep,
  type DecisionStep,
  type LookStep,
  type NewsRow,
  type OptionRow,
  type Picture,
  type Step,
} from "./steps";

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

// ---------- which way he looked ----------

/** Left, right, behind or forward, against his body. */
export type ScanDirection = "L" | "R" | "B" | "F";

/** A look within this of his body's facing is "forward"; from BEHIND_MIN round is "behind" (over
 * the shoulder, as Take his eyes calls a look from 120°); the rest is left or right. */
export const FORWARD_MAX = rad(45);
export const BEHIND_MIN = rad(120);

/** Head yaw relative to body yaw, rad in (-π, π]; positive turns counter-clockwise, to his left. */
export const headVsBody = (head: number, body: number): number => wrapAngle(head - body);

export function classifyDirection(rel: number): ScanDirection {
  const a = Math.abs(wrapAngle(rel));
  if (a < FORWARD_MAX) return "F";
  if (a >= BEHIND_MIN) return "B";
  return wrapAngle(rel) > 0 ? "L" : "R";
}

export const DIRECTION_WORDS: Record<ScanDirection, string> = {
  L: "to his left",
  R: "to his right",
  B: "behind him",
  F: "ahead of him",
};

/** The direction of a look, from the hero's head and body yaw at its freeze frame. */
export function scanDirection(hero: Hero, run: Run, frame: number) {
  const f = clampFrame(run, frame);
  const rel = headVsBody(run.head[f * hero.n + hero.hero], run.body[f * hero.n + hero.hero]);
  return { code: classifyDirection(rel), rel, degrees: Math.round(Math.abs(deg(rel))) };
}

const clampFrame = (run: Run, f: number) => Math.max(0, Math.min(run.frames - 1, Math.round(f)));

// ---------- who came into view, and what it did to his picture ----------

export interface Person {
  id: string;
  number: number; // shirt number
  name: string; // "N. Varnhall"
  team: 0 | 1;
}

export const personOf = (hero: Hero, id: string): Person => {
  const p = hero.players[hero.ids.indexOf(id)];
  return { id, number: p.number, name: shortName(id), team: p.team };
};

export const tagOf = (p: Person): string => `#${p.number} ${p.name}`;

/** How far his picture of a player is from where he is, m (his belief ghost against the sim). */
export function beliefError(hero: Hero, run: Run, frame: number, id: string): number {
  const f = clampFrame(run, frame);
  const j = hero.ids.indexOf(id);
  const i = (f * hero.n + j) * 2;
  return Math.hypot(run.ghost[i] - run.pos[i], run.ghost[i + 1] - run.pos[i + 1]);
}

/** A seen player is "now known" when his picture of him ends within this, m, having been out by at
 * least CORRECTION_MIN_M before the look. */
export const KNOWN_M = 1;
export const CORRECTION_MIN_M = 1;

export interface BeliefChange {
  person: Person;
  before: number; // m, at the look's onset
  after: number; // m, at its end
}

export interface LookStory {
  stepId: string;
  number: number; // 1 for his first look
  direction: ScanDirection;
  words: string; // the direction in words
  degrees: number; // from his body's facing
  inView: Person[]; // who came into view
  changes: BeliefChange[]; // pictures this look corrected, the biggest first
  thinking: string; // what he is thinking
}

const metres = (m: number) => m.toFixed(1);

export const THINKING_HEAD: Record<ScanDirection, string> = {
  L: "Checking my left.",
  R: "Checking my right.",
  B: "Checking behind me.",
  F: "Checking ahead.",
};

/** The thinking caption of a look: a template for its direction, then one for what it did to his
 * picture. Every name, shirt number and distance is a slot filled from the data. */
export function thinkingCaption(
  direction: ScanDirection,
  inView: Person[],
  changes: BeliefChange[],
): string {
  const head = THINKING_HEAD[direction];
  if (changes.length) {
    const named = changes
      .slice(0, 2)
      .map(
        (c) =>
          `${tagOf(c.person)} was ${metres(c.before)} m from where I had him; now I know where he is.`,
      );
    const rest = changes.length - 2;
    return [head, ...named, ...(rest > 0 ? [`${rest} more corrected.`] : [])].join(" ");
  }
  if (inView.length) return `${head} Everyone I can see is where I thought.`;
  return `${head} Nobody comes into view.`;
}

/** The story of one look; null for a look this run does not take. */
export function lookStory(hero: Hero, run: Run, step: LookStep, number: number): LookStory | null {
  if (step.missing) return null;
  const d = scanDirection(hero, run, step.frame);
  const inView = step.sight.map((id) => personOf(hero, id));
  const changes = inView
    .map((person) => ({
      person,
      before: beliefError(hero, run, step.start, person.id),
      after: beliefError(hero, run, step.end, person.id),
    }))
    .filter((c) => c.after <= KNOWN_M && c.before - c.after >= CORRECTION_MIN_M)
    .sort((a, b) => b.before - b.after - (a.before - a.after));
  const direction = lookDirection(hero, run, step);
  return {
    stepId: step.id,
    number,
    direction,
    words: step.direction ? TEACHING_WORDS[direction] : DIRECTION_WORDS[direction],
    degrees: d.degrees,
    inView,
    changes,
    thinking: thinkingCaption(direction, inView, changes),
  };
}

/** A look's direction: a teaching file's scripted label (coach.ts), else from his head against his
 * body at the freeze frame. */
export const lookDirection = (hero: Hero, run: Run, step: LookStep): ScanDirection =>
  step.direction ?? scanDirection(hero, run, step.frame).code;

// ---------- new information → his options (a frozen step's picture) ----------
// Every look must visibly bring something new and show what it did to his options. The bundle
// carries, per frozen step, who is new in his picture and his options on his belief (the decision
// model, read only, explain/belief_options.py) with and without this look at the same frozen frame;
// the words here are templates whose names, numbers and percentages are slots from that data.

/** A player as the story names him, by id. */
export type PersonOf = (id: string) => Person;

export const personLookup =
  (hero: Hero): PersonOf =>
  (id) =>
    personOf(hero, id);

/** An option in words. `turn`: his back is to goal, so a carry forward means turning with it. */
export function optionLabel(action: string, who: PersonOf, turn = false): string {
  if (action.startsWith("pass:")) return `Pass to ${tagOf(who(action.slice(5)))}`;
  if (action === "carry") return turn ? "Turn and carry" : "Carry forward";
  return actionLabel(action);
}

// A change of believed success this large is marked even when it does not cross 50%.
export const SHIFT = 0.2;

export interface OptionLine {
  action: string;
  label: string;
  before: number | null; // baseline believed success, 0-1 (null: not playable, or no baseline)
  now: number;
  mark: "↑" | "↓" | "↗" | "↘" | ""; // opened, closed, rose, fell
}

/** How many options the card lists, best valued first; every marked one is added. */
export const OPTIONS_SHOWN = 4;

/** His options now, best valued first: the top OPTIONS_SHOWN and every marked one, each with its
 * baseline and current believed success. For a look, both are at its freeze. */
export function optionLines(
  options: OptionRow[],
  before: OptionRow[] | null,
  opened: string[],
  closed: string[],
  who: PersonOf,
  turn = false,
): OptionLine[] {
  const was = new Map((before ?? []).map((o) => [o.action, o.p]));
  const markFor = (o: OptionRow): OptionLine["mark"] => {
    if (opened.includes(o.action)) return "↑";
    if (closed.includes(o.action)) return "↓";
    const previous = before ? was.get(o.action) : undefined;
    if (previous === undefined || Math.abs(o.p - previous) < SHIFT) return "";
    return o.p > previous ? "↗" : "↘";
  };
  const rows = options.filter((o, k) => k < OPTIONS_SHOWN || markFor(o));
  const gone = (before ?? []).filter(
    (o) => closed.includes(o.action) && !options.some((x) => x.action === o.action),
  );
  return [
    ...rows.map((o) => ({
      action: o.action,
      label: optionLabel(o.action, who, turn),
      before: before ? (was.get(o.action) ?? null) : null,
      now: o.p,
      mark: markFor(o),
    })),
    ...gone.map((o) => ({
      action: o.action,
      label: optionLabel(o.action, who, turn),
      before: o.p,
      now: 0,
      mark: "↓" as const,
    })),
  ];
}

/** "New in his picture", in words: everyone whose believed position the look moved more than
 * NEW_M (largest first), then who only came into view, where he had them. Empty: nothing new. */
export function newsLines(news: NewsRow[], who: PersonOf): string[] {
  const moved = news.filter((n) => n.moved > NEW_M);
  const seen = news.filter((n) => n.moved <= NEW_M && n.entered);
  return [
    ...moved.map(
      (n) =>
        `${tagOf(who(n.id))}: ${metres(n.after)} m from him, not ${metres(n.before)} m (${metres(n.moved)} m from where he had him)`,
    ),
    ...(seen.length
      ? [`In view, where he had them: ${seen.map((n) => tagOf(who(n.id))).join(", ")}`]
      : []),
  ];
}

/** The second half of a thinking line: what the step did to his options. */
export function optionsClause(lines: OptionLine[], lead: string): string {
  const say = (l: OptionLine) => {
    const verb =
      l.mark === "↑" ? "is on" : l.mark === "↓" ? "is off" : l.mark === "↗" ? "rises" : "falls";
    return `${l.label.charAt(0).toLowerCase()}${l.label.slice(1)} ${verb} (${percent(l.before ?? 0)} → ${percent(l.now)})`;
  };
  const change = (l: OptionLine) => Math.abs(l.now - (l.before ?? 0));
  const negative = lines
    .filter((l) => l.mark === "↓" || l.mark === "↘")
    .sort((a, b) => change(b) - change(a));
  const positive = lines
    .filter((l) => l.mark === "↑" || l.mark === "↗")
    .sort((a, b) => change(b) - change(a));
  const said = [...negative.slice(0, 2), ...positive.slice(0, 2)].map(say);
  if (!said.length) return "No option opens, closes or moves much.";
  const more = negative.length + positive.length - said.length;
  return `${lead} ${said.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`;
}

/** What he is thinking at a look: what changed in his picture, then what that did to his options.
 * `picture.news` is the look's news. */
export function lookThinking(
  direction: ScanDirection,
  picture: Picture,
  who: PersonOf,
  turn = false,
): string {
  const news = picture.news ?? [];
  const top = news
    .filter((n) => n.moved > NEW_M)
    .reduce<NewsRow | null>(
      (nearest, n) => (nearest === null || n.after < nearest.after ? n : nearest),
      null,
    );
  const seen = news.filter((n) => n.entered).slice(0, 2);
  const what = top
    ? `${tagOf(who(top.id))} is ${metres(top.after)} m from me, not ${metres(top.before)} m.`
    : seen.length
      ? `${seen.map((n) => tagOf(who(n.id))).join(" and ")} in view, where I had them.`
      : "Nothing new: everyone is where I had them.";
  const lines = optionLines(
    picture.options,
    picture.before,
    picture.opened,
    picture.closed,
    who,
    turn,
  );
  return `${THINKING_HEAD[direction]} ${what} ${optionsClause(lines, "So")}`;
}

/** What he is thinking before any look, facing the ball: who has it, and his best option. */
export function startThinking(passer: string | null, options: OptionRow[], who: PersonOf): string {
  const best = options[0];
  const ball = passer ? `${tagOf(who(passer))} has the ball, and it is coming to me.` : "";
  const option = best
    ? `Before I look anywhere else, my best option is ${optionLabel(best.action, who, true).toLowerCase()} (${percent(best.p)}).`
    : "";
  return ["I face the ball.", ball, option].filter(Boolean).join(" ");
}

/** What he is thinking at a teaching beat (coach.ts): the rule's reason, from what he believed
 * when it acted, then what the step did to his options. `deg`: his body against the incoming ball
 * at the half-turn. */
export function beatThinking(step: BeatStep, who: PersonOf, deg: number | null): string {
  const r = step.rule;
  const nearest = `${tagOf(who(r.nearest))}, ${metres(r.nearest_m)} m`;
  let why: string;
  if (step.id === "drop_back") {
    why =
      r.near.length && r.moved_m && r.after_m != null
        ? `${tagOf(who(r.nearest))} will be ${metres(r.nearest_m)} m from me when the ball comes: too tight to take it on my spot. I drop back ${metres(r.moved_m)} m, to ${metres(r.after_m)} m from him.`
        : `Nobody I know of will be within ${metres(r.radius_m)} m when the ball comes (nearest: ${nearest}). I stay on my spot.`;
  } else {
    why = r.side
      ? `${tagOf(who(r.nearest))} will be ${metres(r.nearest_m)} m from me as the ball arrives: I open my body ${deg !== null ? `${deg}° ` : ""}away from him, toward the forward lane.`
      : `Nobody I know of will be within ${metres(r.radius_m)} m as the ball arrives (nearest: ${nearest}). I take it square.`;
  }
  const p = step.picture;
  const lines = optionLines(p.options, p.before, p.opened, p.closed, who, true);
  return `${why} ${optionsClause(lines, "Now")}`;
}

/** A frozen step's picture block, put together for the card: a look's news lines (empty: nothing
 * new; null for other steps), his options with baseline → current and ↑ / ↓ / ↗ / ↘, and his
 * thinking line. Null for a missing look and for the decision (told by `decisionStory`). */
export interface PictureView {
  news: string[] | null;
  optionsLabel: string;
  optionsNote?: string;
  options: OptionLine[];
  compare: boolean; // show baseline → current
  thinking: string;
}

export function pictureView(
  hero: Hero,
  run: Run,
  step: Step,
  teaching: boolean,
): PictureView | null {
  const who = personLookup(hero);
  if (step.kind === "start")
    return {
      news: null,
      optionsLabel: "His options before any look",
      options: optionLines(step.options, null, [], [], who, true),
      compare: false,
      thinking: startThinking(passerOf(hero, run), step.options, who),
    };
  if (step.kind === "look") {
    const p = step.picture;
    if (step.missing || !p) return null;
    return {
      news: newsLines(p.news ?? [], who),
      optionsLabel: "His options: without this scan → with it",
      optionsNote: `Both are computed at the same frozen frame. ↑ ↓ cross 50%; ↗ ↘ move ${Math.round(SHIFT * 100)} points or more.`,
      options: optionLines(p.options, p.before, p.opened, p.closed, who, teaching),
      compare: true,
      thinking: lookThinking(lookDirection(hero, run, step), p, who, teaching),
    };
  }
  if (step.kind === "beat") {
    const p = step.picture;
    return {
      news: null,
      optionsLabel: "His options: last step → now",
      options: optionLines(p.options, p.before, p.opened, p.closed, who, true),
      compare: true,
      thinking: beatThinking(step, who, beatTurn(hero, run, step)?.ballDeg ?? null),
    };
  }
  return null;
}

/** Who plays the ball to him in this run (the first pass to him), or null. */
export function passerOf(hero: Hero, run: Run): string | null {
  const pass = run.events.filter((e) => e.type === "pass" && e.attrs.to === hero.heroId).at(0);
  return pass?.player ?? null;
}

// ---------- the decision, linked to the looks ----------

export interface DecisionStory {
  lines: string[];
}

const percent = (p: number) => `${Math.round(p * 100)}%`;

/** What he chose and why, from the decision record and what his looks showed. `steps` are the
 * run's steps; its looks are the ones that count. */
export function decisionStory(hero: Hero, run: Run, steps: Step[]): DecisionStory | null {
  const d = run.decision;
  if (!d) return null;
  const looks = steps.filter((s): s is LookStep => s.kind === "look" && !s.missing);
  const option = d.options.find((o) => o.action === d.chosen);
  const receiver = option?.receiver ?? null;
  const label = receiver ? `Pass to ${tagOf(personOf(hero, receiver))}` : actionLabel(d.chosen);
  const lines = [`He chose: ${label}.`];
  if (receiver) {
    const who = tagOf(personOf(hero, receiver));
    const k = looks.findIndex((s) => s.sight.includes(receiver));
    const err = metres(d.belief_error[receiver] ?? 0);
    const age = (d.belief_age[receiver] ?? 0).toFixed(1);
    lines.push(
      k >= 0
        ? `Look ${k + 1} brought ${who} into view. At the decision his picture of him was ${err} m off, ${age} s old.`
        : `He never looked at ${who} before deciding. His picture of him was ${err} m off, ${age} s old.`,
    );
  } else {
    lines.push(
      looks.length
        ? `He had taken ${looks.length} ${looks.length === 1 ? "look" : "looks"} before the ball reached him.`
        : "He took no look before the ball reached him.",
    );
  }
  if (option) lines.push(`The model gave this option ${percent(option.prob)} of its weight.`);
  return { lines };
}

// ---------- scans before receiving, against the realism report ----------

/** Scans in the 10 s before receiving, as the published figure (Jordet et al., 2020: 3.0 ± 2.1;
 * docs/NUMBERS.md R1, eval/reports/realism.md); a test reads it back from that report. */
export const PUBLISHED_SCANS = 3;
export const WINDOW_S = 10;

/** How many scans the hero starts in the 10 s before the ball reaches him in this run. */
export function scansBeforeReceiving(hero: Hero, run: Run): number {
  const reception = receptionOf(hero, run);
  const from = reception - Math.round(WINDOW_S / hero.dt);
  return run.scans.filter((s) => s.player === hero.heroId && s.start >= from && s.start < reception)
    .length;
}

/** The honest line when he made fewer scans than players average; null otherwise. */
export function fewScansLine(count: number): string | null {
  if (count >= PUBLISHED_SCANS) return null;
  return `Players average about ${PUBLISHED_SCANS} scans in the ${WINDOW_S} s before receiving; he made ${count}.`;
}

// ---------- the half-turn ----------

/** Receiving side-on: his body is this far round from the incoming ball (a half-turn: neither
 * facing it nor turned away from it) and open to his next action. */
export const SIDE_ON_MIN = rad(45);
export const SIDE_ON_MAX = rad(135);
export const FACING_PLAY_MAX = rad(60);
export const HALF_TURN_CAPTION = "Receives side-on, on the half-turn";

export interface HalfTurn {
  frame: number; // his reception
  pos: Vec2; // where he stands, m
  body: number; // his body's facing, rad
  toBall: number; // bearing from him to where the ball came from, rad
  toAction: number; // bearing to his next action's target, rad
  ballDeg: number; // body vs the incoming ball, degrees
  actionDeg: number; // body vs his next action
  goalDeg: number; // body vs the goal he attacks
  caption: string;
  detail: string;
}

const bearing = (from: Vec2, to: Vec2) => Math.atan2(to[1] - from[1], to[0] - from[0]);
const between = (a: number, b: number) => Math.abs(wrapAngle(a - b));

/**
 * The angles at his reception: his body's facing against the incoming ball, the direction of his
 * next action (his decision's pass or carry target; a shot's target is the goal) and the goal he
 * attacks. Side-on, on the half-turn, when his body is SIDE_ON_MIN to SIDE_ON_MAX round from the
 * ball and within FACING_PLAY_MAX of his next action. Null when the data does not show that (or has
 * no incoming pass or no decision to measure against): the story says nothing about turning.
 */
export function halfTurn(hero: Hero, run: Run): HalfTurn | null {
  const at = turnAt(hero, run, receptionOf(hero, run));
  if (!at) return null;
  const { ball, action } = at;
  return ball < SIDE_ON_MIN || ball > SIDE_ON_MAX || action > FACING_PLAY_MAX ? null : at.turn;
}

/**
 * A teaching file's half-turn beat (coach.ts), for its arc: his body against the incoming ball at
 * his reception. Its rule turns him 45–90° from square, away from the presser, so his body need not
 * face his next action as `halfTurn` asks. Null when he received square.
 */
export function beatTurn(hero: Hero, run: Run, step: BeatStep): HalfTurn | null {
  if (step.id !== "half_turn" || !step.happened) return null;
  return turnAt(hero, run, step.frame)?.turn ?? null;
}

/** His angles at `frame` against the last pass to him and his decision (rad, and as a HalfTurn);
 * null without them. */
function turnAt(
  hero: Hero,
  run: Run,
  frame: number,
): { turn: HalfTurn; ball: number; action: number } | null {
  const d = run.decision;
  if (hero.kind !== "hero" || !d || !hero.heroId) return null;
  const pass = run.events
    .filter((e) => e.type === "pass" && e.attrs.to === hero.heroId && e.frame < frame)
    .at(-1);
  const origin = pass?.attrs.start as Vec2 | undefined;
  if (!origin) return null;
  const f = clampFrame(run, frame);
  const i = (f * hero.n + hero.hero) * 2;
  const pos: Vec2 = [run.pos[i], run.pos[i + 1]];
  const body = run.body[f * hero.n + hero.hero];
  const goal: Vec2 = [hero.players[hero.hero].team === 0 ? HALF_LENGTH : -HALF_LENGTH, 0];
  const option = d.options.find((o) => o.action === d.chosen);
  const target = d.chosen.startsWith("shot") || !option ? goal : option.target;
  const toBall = bearing(pos, origin);
  const toAction = bearing(pos, target);
  const ball = between(body, toBall);
  const action = between(body, toAction);
  const goalAngle = between(body, bearing(pos, goal));
  const ballDeg = Math.round(deg(ball));
  const actionDeg = Math.round(deg(action));
  const goalDeg = Math.round(deg(goalAngle));
  const turn = {
    frame,
    pos,
    body,
    toBall,
    toAction,
    ballDeg,
    actionDeg,
    goalDeg,
    caption: HALF_TURN_CAPTION,
    detail: `His body is ${ballDeg}° round from the incoming ball, ${actionDeg}° off his next action and ${goalDeg}° off the goal.`,
  };
  return { turn, ball, action };
}

export const ARC_RADIUS_M = 2.5;

/** The thin body-orientation arc on the grass: from the bearing of the incoming ball round to where
 * his body faces, radius ARC_RADIUS_M, and a tick pointing out along his facing. Pitch metres. */
export function halfTurnArc(ht: HalfTurn, steps = 16): { arc: Vec2[]; tick: [Vec2, Vec2] } {
  const turn = wrapAngle(ht.body - ht.toBall);
  const at = (a: number, r: number): Vec2 => [
    ht.pos[0] + r * Math.cos(a),
    ht.pos[1] + r * Math.sin(a),
  ];
  const arc = Array.from({ length: steps + 1 }, (_, k) =>
    at(ht.toBall + (turn * k) / steps, ARC_RADIUS_M),
  );
  return { arc, tick: [at(ht.body, ARC_RADIUS_M * 0.8), at(ht.body, ARC_RADIUS_M * 1.5)] };
}

// ---------- the timeline strip ----------

export interface Tick {
  stepIndex: number; // the step it jumps to
  stepId: string;
  frac: number; // 0 to 1 along the strip
  label: ScanDirection | "–"; // "–": a look this run does not take
  words: string; // the direction in words ("" for "–")
  missing: boolean;
}

export interface Timeline {
  from: number; // frame at the strip's left end
  to: number; // frame at its right end (his decision)
  ticks: Tick[]; // one per scan
  reception: number; // 0 to 1
  decision: number; // index of the decision step, or -1
}

/** The strip: the 10 s before the decision (or from the run's start), a tick per look at its
 * freeze frame, labelled by direction against his body. */
export function timeline(hero: Hero, run: Run, steps: Step[]): Timeline {
  const end =
    steps.find((s): s is DecisionStep => s.kind === "decision")?.frame ?? receptionOf(hero, run);
  const from = Math.max(
    0,
    Math.min(end - Math.round(WINDOW_S / hero.dt), ...steps.map((s) => s.frame)),
  );
  const span = Math.max(1, end - from);
  const frac = (f: number) => Math.max(0, Math.min(1, (f - from) / span));
  return {
    from,
    to: end,
    ticks: steps.flatMap((s, stepIndex) => {
      if (s.kind !== "look") return [];
      const label = s.missing ? ("–" as const) : lookDirection(hero, run, s);
      const words =
        label === "–" ? "" : s.direction ? TEACHING_WORDS[label] : DIRECTION_WORDS[label];
      return [{ stepIndex, stepId: s.id, frac: frac(s.frame), label, words, missing: s.missing }];
    }),
    reception: frac(receptionOf(hero, run)),
    decision: steps.findIndex((s) => s.kind === "decision"),
  };
}

export const tickLabel = (t: Tick, number: number): string =>
  t.missing ? `Look ${number}, not taken here` : `Look ${number}, ${t.words}`;
