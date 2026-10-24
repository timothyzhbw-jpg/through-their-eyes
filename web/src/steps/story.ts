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
import { receptionOf, type BeatStep, type DecisionStep, type LookStep, type Step } from "./steps";

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
