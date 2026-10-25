// Scan step-through (SPEC 7): every look the hero takes before the ball reaches him becomes a freeze
// frame the viewer steps through, and the last frame explains his decision.
//
// The steps come from the run's own scan events (the hero's scans that start before his
// reception); the bundled file (`sim.export --steps`, agents/steps.py) adds, per step, the freeze
// frame (the middle of the scan's dwell), who came into his sight, every player's velocity from the
// sim, the verified lines in en and zh, and his picture: who the look made new in it, and his
// options on his belief without and with it (the decision model, read only,
// explain/belief_options.py). The run without the key scan keeps that look as a missing step. A
// teaching file (coach.ts) opens on his start view and adds its two beats. Pure functions here; the
// controller and the screen are beside it.

import { actionLabel, type Hero, type Run } from "../data/hero";
import type { ExportDecision, RunName, Vec2 } from "../data/types";
import { checkPayload, claimRun, type Narration } from "../narration/payload";
import type { MomentContext } from "../plan/moment";
import { LANGUAGES, type Language } from "../whatif/whatif";
import type { ScanDirection } from "./story";

export const STEPS_VERSION = 2;

/** The bundled step-through of each hero moment, by `<scenario>-<seed>`. */
export const STEP_FILES: Record<string, string> = {
  "blind_side_run-3": "steps_seed3.json",
  "press_escape-0": "steps_press_escape_seed0.json",
  "pro_scan-116": "steps_pro_scan_seed116.json", // the coach's example (coach.ts)
};

/** Why the step-through stays shut for a moment without a bundled file. */
export const NO_STEPS =
  "His looks are worked out ahead of time; they are bundled for the demo's hero moments only.";

/** How far ahead a movement arrow reaches: the player's velocity now, kept for this long. */
export const PROJECTION_S = 1;
/** Movement arrows: players this close to the hero, moving at least this fast. */
export const ARROW_RADIUS_M = 30;
export const ARROW_MIN_SPEED = 0.5; // m/s

interface RawStep {
  id: string;
  start: number;
  end: number;
  frame: number;
  side: "left" | "right";
  over: boolean;
  missing: boolean;
  sight: string[];
  lines: string[];
  vel: number[][]; // [player][xy] mm/s
  picture: Picture | null; // what the look added (null when missing)
  direction?: ScanDirection; // a teaching file's scripted look
}

/** A teaching file's frozen beat (agents/steps.py `Beat`). */
interface RawBeat {
  id: BeatId;
  frame: number;
  start: number;
  end: number;
  happened: boolean;
  lines: string[];
  vel: number[][];
  picture: Picture;
  rule: Rule;
}

interface RawStart {
  frame: number;
  options: OptionRow[];
  vel: number[][];
}

interface RawFinal {
  frame: number;
  chosen: string;
  forced: boolean;
  focus: [string, string];
  lines: string[];
  vel: number[][];
}

interface RawRun {
  reception: number;
  decision: number;
  intro: string[];
  start: RawStart;
  steps: RawStep[];
  beats?: RawBeat[]; // a teaching file only
  final: RawFinal;
  answers: Partial<Record<Language, unknown>>;
}

interface RawSteps {
  version: number;
  scenario: string;
  seed: number;
  moment: string;
  hero: string;
  teaching?: boolean; // the coach's example: its look times are scripted (coach.ts)
  runs: Record<RunName, RawRun>;
}

// ---------- what he knew and could do (agents/steps.py `build_pictures`) ----------

/** One option of the decision model on his belief (explain/belief_options.py): believed success,
 * choice weight and value, as if the ball were at his feet. */
export interface OptionRow {
  action: string;
  p: number;
  prob: number;
  value: number;
}

/** A player new in his picture on a look: came into his sight, or believed more than NEW_M from
 * where he had him; how far from him he had him without the look and has him with it, m. */
export interface NewsRow {
  id: string;
  entered: boolean;
  moved: number;
  before: number;
  after: number;
}

/** A frozen step's picture: his options before (a look: without it, at the same moment; a beat:
 * at the step before) and now, which it opened and closed, and for a look who is new in it. */
export interface Picture {
  frame: number;
  before: OptionRow[];
  options: OptionRow[];
  opened: string[];
  closed: string[];
  news?: NewsRow[];
}

/** What a teaching rule saw and did (sim/scenarios/pro_scan.py `RuleCall`): the outfield
 * opponent he believed would be nearest when the ball came, those within its radius, and the
 * drop-back (m, and how far the nearest of them would then be) or the side his body opens to. */
export interface Rule {
  frame: number;
  nearest: string;
  nearest_m: number;
  near: string[];
  radius_m: number;
  moved_m?: number;
  after_m?: number | null;
  side?: number;
}

/** A player new in his picture counts as news when his believed position moved this far, m. */
export const NEW_M = 1;
/** An option is open when he believes it succeeds at least this often. */
export const OPEN_P = 0.5;

/** (opened, closed) between two option sets, as explain/belief_options.py `option_changes`:
 * opened when its believed success reaches OPEN_P from below or from not playable; closed when it
 * falls below OPEN_P or stops being playable. */
export function optionChanges(before: OptionRow[], after: OptionRow[]): [string[], string[]] {
  const was = new Map(before.map((o) => [o.action, o.p]));
  const now = new Map(after.map((o) => [o.action, o.p]));
  const opened = [...now].filter(([a, p]) => p >= OPEN_P && (was.get(a) ?? 0) < OPEN_P);
  const closed = [...now].filter(([a, p]) => p < OPEN_P && (was.get(a) ?? 0) >= OPEN_P);
  const gone = [...was].filter(([a, p]) => !now.has(a) && p >= OPEN_P);
  return [opened.map(([a]) => a), [...closed, ...gone].map(([a]) => a)];
}

/** The first frozen step of a teaching file: he faces the ball, before any look. */
export interface StartStep {
  kind: "start";
  id: "start";
  frame: number;
  options: OptionRow[];
  lines: string[];
  vel: Float32Array;
}

/** One look: a freeze frame at its dwell. */
export interface LookStep {
  kind: "look";
  id: string; // the scan event
  start: number;
  end: number;
  frame: number; // the freeze frame
  side: "left" | "right"; // from the ball
  over: boolean; // over his shoulder
  missing: boolean; // this run does not take it (the run without the key scan)
  sight: string[]; // who came into his sight on it
  lines: string[]; // its verified lines (line ids of the run's narration)
  vel: Float32Array; // every player's velocity at the freeze frame, m/s: [2 * player + xy]
  picture: Picture | null; // what the look added to his picture and options (null when missing)
  direction?: ScanDirection; // a teaching file's scripted look; else from his head and body
}

/** A teaching file's beats, told whether or not they happened: after his look left, did he drop
 * back toward the ball (frozen when the rule acted, between his looks); after his look right, did
 * he receive side-on (frozen at his reception)? */
export type BeatId = "drop_back" | "half_turn";

export interface BeatStep {
  kind: "beat";
  id: BeatId;
  frame: number; // the freeze frame
  start: number; // drop_back: when the rule acted, where his path starts
  end: number; // his reception: drop_back's path ends there
  happened: boolean;
  lines: string[];
  vel: Float32Array;
  picture: Picture; // his options now, against the step before
  rule: Rule;
}

/** The last step: his decision. */
export interface DecisionStep {
  kind: "decision";
  id: "decision";
  frame: number;
  chosen: string;
  forced: boolean; // a what-if forced it (press_escape's "if he carried it")
  focus: [string, string]; // the two players the freeze leaves lit
  lines: string[];
  vel: Float32Array;
}

export type Step = StartStep | LookStep | BeatStep | DecisionStep;

export interface RunSteps {
  reception: number;
  decision: number;
  intro: string[];
  start: { frame: number; options: OptionRow[] }; // his options before his first look
  // A teaching file's start view, then his looks and its beats in time order, then his decision.
  steps: Step[];
  answers: Partial<Record<Language, Narration>>; // only answers that pass the checks
  errors: string[];
}

export interface Steps {
  moment: string;
  heroId: string;
  teaching: boolean; // the coach's example: say that its look times are scripted
  runs: Record<RunName, RunSteps>;
}

/** The scans a run's steps are made of: the hero's scans that start before the ball reaches him. */
export function scanStepIds(hero: Hero, run: Run): string[] {
  const reception = receptionOf(hero, run);
  return run.scans
    .filter((s) => s.player === hero.heroId && s.start < reception)
    .sort((a, b) => a.start - b.start)
    .map((s) => s.id);
}

/** When the ball reaches the hero in this run (his first reception up to his decision). */
export function receptionOf(hero: Hero, run: Run): number {
  const decision = run.decision?.frame ?? Infinity;
  const e = run.events.find(
    (x) => x.type === "reception" && x.player === hero.heroId && x.frame <= decision,
  );
  return e ? e.frame : hero.reception;
}

const velocities = (rows: number[][], n: number): Float32Array => {
  if (rows.length !== n) throw new Error(`velocities for ${rows.length} players, not ${n}`);
  return Float32Array.from(rows.flat(), (v) => v / 1000);
};

/** A picture's opened and closed lists must be the diff of the options it carries. */
function checkPicture(p: Picture, id: string): void {
  const [opened, closed] = optionChanges(p.before, p.options);
  if (opened.join() !== p.opened.join() || closed.join() !== p.closed.join())
    throw new Error(`${id}: its opened and closed options are not its options' diff`);
}

function runSteps(
  raw: RawRun,
  name: RunName,
  hero: Hero,
  moment: string,
  teaching: boolean,
): RunSteps {
  const run = hero.runs[name];
  const own = raw.steps.filter((s) => !s.missing).map((s) => s.id);
  const expected = scanStepIds(hero, run);
  if (own.join() !== expected.join()) {
    throw new Error(
      `the ${name} run's looks are ${expected.join(", ") || "none"}, the file has ` +
        `${own.join(", ") || "none"}: regenerate it (web/README.md)`,
    );
  }
  for (const s of raw.steps.filter((x) => x.missing)) {
    if (!hero.runs.factual.scans.some((x) => x.id === s.id) || run.scans.some((x) => x.id === s.id))
      throw new Error(`${s.id} is not a look this run leaves out`);
  }
  if (
    !run.decision ||
    run.decision.frame !== raw.final.frame ||
    run.decision.chosen !== raw.final.chosen
  )
    throw new Error(`the ${name} run's decision is not the file's`);
  const looks: Step[] = raw.steps.map((s) => {
    if ((s.picture === null) !== s.missing)
      throw new Error(`${s.id}: a look taken has a picture, a missing one none`);
    if (s.picture) checkPicture(s.picture, s.id);
    return {
      kind: "look" as const,
      id: s.id,
      start: s.start,
      end: s.end,
      frame: s.frame,
      side: s.side,
      over: s.over,
      missing: s.missing,
      sight: s.sight,
      lines: s.lines,
      vel: velocities(s.vel, hero.n),
      picture: s.picture,
      ...(s.direction ? { direction: s.direction } : {}),
    };
  });
  const reception = receptionOf(hero, run);
  const beats: Step[] = (raw.beats ?? []).map((b) => {
    if (b.id !== "drop_back" && b.id !== "half_turn") throw new Error(`unknown beat ${b.id}`);
    const at = b.id === "half_turn" ? b.frame : b.end;
    if (at !== reception || b.end !== reception)
      throw new Error(`the ${name} run's ${b.id} is not at his reception: regenerate the file`);
    if (b.id === "drop_back" && (b.frame !== b.start || b.frame !== b.rule.frame))
      throw new Error(`the ${name} run's drop-back is not when its rule acted`);
    checkPicture(b.picture, b.id);
    return {
      kind: "beat" as const,
      id: b.id,
      frame: b.frame,
      start: b.start,
      end: b.end,
      happened: b.happened,
      lines: b.lines,
      vel: velocities(b.vel, hero.n),
      picture: b.picture,
      rule: b.rule,
    };
  });
  // In time order (a sort keeps a look before a beat on the same frame).
  const steps: Step[] = [...looks, ...beats].sort((a, b) => a.frame - b.frame);
  if (teaching)
    steps.unshift({
      kind: "start",
      id: "start",
      frame: raw.start.frame,
      options: raw.start.options,
      lines: [],
      vel: velocities(raw.start.vel, hero.n),
    });
  steps.push({
    kind: "decision",
    id: "decision",
    frame: raw.final.frame,
    chosen: raw.final.chosen,
    forced: raw.final.forced,
    focus: raw.final.focus,
    lines: raw.final.lines,
    vel: velocities(raw.final.vel, hero.n),
  });
  const out: RunSteps = {
    reception: raw.reception,
    decision: raw.decision,
    intro: raw.intro,
    start: { frame: raw.start.frame, options: raw.start.options },
    steps,
    answers: {},
    errors: [],
  };
  const events = new Set([
    ...hero.runs.factual.events.map((e) => e.id),
    ...hero.runs.counterfactual.events.map((e) => e.id),
  ]);
  const scope = {
    moment: `${moment}?steps:${name}`,
    events,
    frames: (c: Parameters<typeof claimRun>[0]) => hero.runs[claimRun(c)].frames,
  };
  for (const lang of LANGUAGES) {
    const checked = checkPayload(raw.answers?.[lang], scope);
    if (checked.ok) out.answers[lang] = checked.narration;
    else out.errors.push(...checked.errors.map((e) => `${lang}: ${e}`));
  }
  return out;
}

export function parseSteps(json: unknown, hero: Hero, m: MomentContext): Steps {
  const raw = json as RawSteps;
  if (!raw || raw.version !== STEPS_VERSION || !raw.runs?.factual || !raw.runs.counterfactual) {
    throw new Error(`step file version ${raw?.version}, app expects ${STEPS_VERSION}`);
  }
  if (raw.moment !== m.id) throw new Error(`the steps are for ${raw.moment}, not ${m.id}`);
  if (raw.hero !== hero.heroId)
    throw new Error(`the steps are ${raw.hero}'s, not ${hero.heroId}'s`);
  const teaching = raw.teaching === true;
  return {
    moment: raw.moment,
    heroId: raw.hero,
    teaching,
    runs: {
      factual: runSteps(raw.runs.factual, "factual", hero, raw.moment, teaching),
      counterfactual: runSteps(
        raw.runs.counterfactual,
        "counterfactual",
        hero,
        raw.moment,
        teaching,
      ),
    },
  };
}

/** The step of `run` that shows the same thing as `step` of the other run: the same look (taken
 * or missing), or the decision. Falls back to the nearest index. */
export function matchingStep(steps: Step[], step: Step | undefined, index: number): number {
  const k = step ? steps.findIndex((s) => s.id === step.id) : -1;
  return k >= 0 ? k : Math.min(index, steps.length - 1);
}

// ---------- words, no numbers ----------

/** Where a look goes, as Take his eyes says it: from the ball, over his shoulder from 120°. */
export function whereLabel(step: LookStep): string {
  return step.over ? `Over his ${step.side} shoulder` : `To his ${step.side}`;
}

export function stepTitle(step: Step): string {
  if (step.kind === "start") return "Facing the ball";
  if (step.kind === "decision") return step.forced ? "The what-if" : "His decision";
  if (step.kind === "beat") return BEAT_TITLES[step.id][step.happened ? 0 : 1];
  return step.missing ? "No look here" : whereLabel(step);
}

/** The steps told on the board, top-down: his decision, and where he received the ball. The
 * others are told through his eyes. */
export const onBoard = (step: Step): boolean =>
  step.kind === "decision" || (step.kind === "beat" && step.id === "drop_back");

/** A beat's title: (it happened, it did not). */
export const BEAT_TITLES: Record<BeatId, [string, string]> = {
  drop_back: ["He drops back", "No drop-back"],
  half_turn: ["On the half-turn", "Square to the ball"],
};

// ---------- movement hints: arrows from the sim's velocities ----------

export interface Arrow {
  player: number;
  team: 0 | 1;
  from: Vec2; // where he is at the freeze frame, m
  to: Vec2; // from + velocity * PROJECTION_S: a projection, not where he went
}

/** Dashed arrows for the players near the hero who are moving: each from where he is to where his
 * velocity at the freeze frame takes him in PROJECTION_S. The hero has none. */
export function movementArrows(hero: Hero, run: Run, frame: number, vel: Float32Array): Arrow[] {
  const n = hero.n;
  const f = Math.max(0, Math.min(run.frames - 1, Math.round(frame)));
  const at = (j: number): Vec2 => [run.pos[(f * n + j) * 2], run.pos[(f * n + j) * 2 + 1]];
  const me = at(hero.hero);
  const out: Arrow[] = [];
  for (let j = 0; j < n; j++) {
    if (j === hero.hero) continue;
    const from = at(j);
    const [vx, vy] = [vel[2 * j], vel[2 * j + 1]];
    if (Math.hypot(vx, vy) < ARROW_MIN_SPEED) continue;
    if (Math.hypot(from[0] - me[0], from[1] - me[1]) > ARROW_RADIUS_M) continue;
    out.push({
      player: j,
      team: hero.players[j].team,
      from,
      to: [from[0] + vx * PROJECTION_S, from[1] + vy * PROJECTION_S],
    });
  }
  return out;
}

// ---------- potential passes: the decision record ----------

export interface Lane {
  action: string;
  label: string;
  kind: "pass" | "carry" | "shot";
  receiver: string | null;
  from: Vec2; // the ball at his decision (his feet), m
  to: Vec2; // the target he chose for it on his belief
  prob: number; // how likely he was to choose it (lane width)
  chosen: boolean;
  seen: boolean; // its receiver came into his sight on the step's look
}

/**
 * Every option the decision model evaluated, from the run's decision record: the model runs once,
 * at his decision (SPEC 3.5), so a look's step shows the options he went on to weigh. Each lane runs
 * from the ball at the decision to the option's target on his belief. All passes in the sim are
 * played along the ground, so a lane has no pass type.
 */
export function potentialPasses(hero: Hero, run: Run, sight: string[] = []): Lane[] {
  const d: ExportDecision | null = run.decision;
  if (!d) return [];
  const n = hero.n;
  const at = (d.frame * n + hero.hero) * 2;
  const from: Vec2 = [run.pos[at], run.pos[at + 1]];
  return d.options.map((o) => ({
    action: o.action,
    label: actionLabel(o.action),
    kind: o.action.startsWith("pass:") ? "pass" : o.action.startsWith("shot") ? "shot" : "carry",
    receiver: o.receiver,
    from,
    to: o.target,
    prob: o.prob,
    chosen: o.action === d.chosen,
    seen: !!o.receiver && sight.includes(o.receiver),
  }));
}

// ---------- the decision's freeze: two players stay lit ----------

/** The player indices the decision's freeze leaves lit (the rest is dimmed, never blurred): exactly two, the pair the decision turns
 * on (a pass's receiver and the opponent nearest him; a carrier and his; a shooter and the
 * keeper). */
export function focusPlayers(hero: Hero, step: DecisionStep): [number, number] {
  const [a, b] = step.focus.map((id) => hero.ids.indexOf(id));
  if (a < 0 || b < 0 || a === b) throw new Error(`no pair to keep lit in ${step.focus.join()}`);
  return [a, b];
}

// ---------- the first-person camera, for overlays drawn over it ----------
// PovView films from his eyes (1.72 m) at his head yaw with a 95° horizontal field of view, looking
// at a point 10 m ahead and 1.3 m high. The overlay projects pitch points with the same pose.

export const POV = { eye: 1.72, lookAhead: 10, lookHeight: 1.3, hfov: (95 * Math.PI) / 180 };
const NEAR = 0.3; // m in front of the eye: closer points are clipped

export interface Pose {
  eye: [number, number, number]; // three.js world: x, up, -pitch y
  right: [number, number, number];
  up: [number, number, number];
  back: [number, number, number]; // the camera looks down -back
  tanX: number; // tan(hfov / 2)
  tanY: number;
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l] as [number, number, number];
};

/** The first-person camera of player j at an integer frame (no easing: a freeze frame). */
export function povPose(hero: Hero, run: Run, j: number, frame: number, aspect: number): Pose {
  const n = hero.n;
  const f = Math.max(0, Math.min(run.frames - 1, Math.round(frame)));
  const x = run.pos[(f * n + j) * 2];
  const y = run.pos[(f * n + j) * 2 + 1];
  const yaw = run.head[f * n + j];
  const eye: [number, number, number] = [x, POV.eye, -y];
  const target = [
    x + POV.lookAhead * Math.cos(yaw),
    POV.lookHeight,
    -(y + POV.lookAhead * Math.sin(yaw)),
  ];
  // As three.js's lookAt: z from the target to the eye, x = up × z, y = z × x.
  const back = norm(sub(eye, target));
  const right = norm(cross([0, 1, 0], back));
  const up = norm(cross(back, right));
  const tanX = Math.tan(POV.hfov / 2);
  return { eye, right, up, back, tanX, tanY: tanX / aspect };
}

/** Camera-space depth of a pitch point at `height` (positive in front of the eye). */
function cameraPoint(pose: Pose, [x, y]: Vec2, height: number): [number, number, number] {
  const d = sub([x, height, -y], pose.eye);
  return [dot(d, pose.right), dot(d, pose.up), -dot(d, pose.back)];
}

function toPixels(pose: Pose, c: [number, number, number], w: number, h: number): Vec2 {
  const nx = c[0] / c[2] / pose.tanX;
  const ny = c[1] / c[2] / pose.tanY;
  return [((nx + 1) / 2) * w, ((1 - ny) / 2) * h];
}

/** Where a pitch point at `height` m shows in a w × h first-person view; null behind the eye. */
export function project(pose: Pose, p: Vec2, w: number, h: number, height = 0): Vec2 | null {
  const c = cameraPoint(pose, p, height);
  return c[2] < NEAR ? null : toPixels(pose, c, w, h);
}

/** A segment on the grass in the view, clipped where it comes nearer the eye than `near` m (it
 * passes behind him, or under the picture); null if all of it does. */
export function projectSegment(
  pose: Pose,
  a: Vec2,
  b: Vec2,
  w: number,
  h: number,
  height = 0,
  near = NEAR,
): [Vec2, Vec2] | null {
  let ca = cameraPoint(pose, a, height);
  let cb = cameraPoint(pose, b, height);
  if (ca[2] < near && cb[2] < near) return null;
  const clip = (p: number[], q: number[]): [number, number, number] => {
    const t = (near - p[2]) / (q[2] - p[2]);
    return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), near];
  };
  if (ca[2] < near) ca = clip(ca, cb);
  else if (cb[2] < near) cb = clip(cb, ca);
  return [toPixels(pose, ca, w, h), toPixels(pose, cb, w, h)];
}

/** Whether a projected point is inside the view (with a margin in px). */
export const inView = (p: Vec2 | null, w: number, h: number, margin = 0): p is Vec2 =>
  !!p && p[0] >= -margin && p[0] <= w + margin && p[1] >= -margin && p[1] <= h + margin;

/** A name tag on the picture: its centre x and baseline y, and its width, in pixels. */
export interface Tag {
  x: number;
  y: number;
  w: number;
}

/**
 * Rows for name tags under the players who came into sight, given nearest first: each keeps its
 * place, or drops a row (up to `rows - 1`) when it would touch a tag already placed, else is left
 * out (the card lists every name). With fictional names the tags are long, and players on nearly
 * the same bearing put one name over another. Returns each tag's row, null when left out.
 */
export function stackTags(
  tags: readonly Tag[],
  rowH: number,
  rows = 3,
  pad = 4,
): (number | null)[] {
  const placed: Tag[] = [];
  return tags.map((t) => {
    for (let r = 0; r < rows; r++) {
      const y = t.y + r * rowH;
      const clash = placed.some(
        (p) => Math.abs(p.x - t.x) < (p.w + t.w) / 2 + pad && Math.abs(p.y - y) < rowH,
      );
      if (!clash) {
        placed.push({ x: t.x, y, w: t.w });
        return r;
      }
    }
    return null;
  });
}
