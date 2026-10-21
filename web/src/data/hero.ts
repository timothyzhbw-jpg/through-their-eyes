// Load an export and turn it into flat typed arrays in metres and radians: a hero moment (two
// runs: what happened, and the counterfactual) or a stitched match (one run on the match clock).
// Everything the views draw is sampled from here, at a fractional frame (linear interpolation).

import { parseMatch, type MatchInfo } from "../match/match";
import type {
  ExportAction,
  ExportBlindSide,
  ExportCounterfactual,
  ExportDecision,
  ExportDetectedScan,
  ExportEvent,
  ExportMatchRun,
  ExportPlayer,
  ExportRun,
  HeroExport,
  MatchExport,
  RunName,
} from "./types";

export const SCHEMA_VERSION = 5;

export interface Scan {
  id: string;
  player: string;
  start: number; // frame
  end: number; // frame
  key: boolean;
}

export interface Run {
  name: RunName;
  frames: number;
  pos: Float32Array; // index (frame * n + player) * 2 + xy, m
  head: Float32Array; // index frame * n + player, rad
  body: Float32Array;
  ball: Float32Array; // index frame * 2 + xy, m
  ghost: Float32Array; // like pos: where the hero believes each player is (zeros in a match)
  seenBy: Uint32Array; // index frame * n + observer: bitmask of the players he sees
  sight: boolean; // seenBy was exported (a stitched match has no sight data: all zeros)
  owner: Int16Array;
  events: ExportEvent[];
  scans: Scan[];
  decision: ExportDecision | null;
  action: ExportAction | null;
  possessionValue: number;
  firstPass: ExportEvent | null; // the pass that starts the moment
  blindSide: ExportBlindSide;
  detector: DetectorRun | null; // null in a match (the match export has no detector run)
}

/** The scan detector at work on one run (SPEC 4.7), on the tracked head yaw. */
export interface DetectorRun {
  omega: Float32Array; // index t * n + player, rad/s, from frame t to t + 1 (frames - 1 rows)
  onsets: number[][]; // [player] candidate onset frames
  scans: DetectedScan[][]; // [player] accepted scans
}

export interface DetectedScan {
  start: number;
  end: number;
  peak: number;
  amplitude: number; // rad
  side: 1 | -1;
}

export interface DetectorParams {
  omegaThreshold: number; // rad/s
  minExcursion: number; // rad
  returnTolerance: number; // rad
  onsetFrames: number;
  maxDurationS: number;
}

export interface Vision {
  halfCone: number; // rad
  edgeSigma: number;
  narrowingPerMps: number;
  minHalfCone: number;
  distanceSigma: number; // m
}

/**
 * What the views play. `kind: "hero"` is one hero moment with its counterfactual run;
 * `kind: "match"` is a stitched match (SPEC 3.1): one run on the match clock with its possessions
 * and moments, no hero, beliefs, sight, vision model or counterfactual. A match has no second run
 * to compare, so both run names point at the stitched run and the views hide what needs one.
 */
export interface Hero {
  kind: "hero" | "match";
  scenario: string;
  seed: number;
  dt: number;
  players: ExportPlayer[];
  ids: string[];
  n: number;
  hero: number; // player index; -1 in a match
  heroId: string | null; // null in a match
  runner: number; // player index, -1 if the scenario has none
  runnerId: string | null;
  keyScan: Scan | null; // the look the counterfactual drops; null without a scan lens
  counterfactual: ExportCounterfactual | null; // null in a match
  vision: Vision | null; // null in a match (the match export has no vision model)
  detector: DetectorParams | null; // the scan detector's settings; null in a match
  deltaXt: number;
  runs: Record<RunName, Run>;
  reception: number; // frame the hero receives the ball (the moment's anchor)
  match: MatchInfo | null; // possessions, score and moments of a stitched match
}

function flatten(rows: number[][], scale: number): Float32Array {
  const width = rows.length ? rows[0].length : 0;
  const out = new Float32Array(rows.length * width);
  rows.forEach((row, f) => row.forEach((v, k) => (out[f * width + k] = v * scale)));
  return out;
}

function convertRun(name: RunName, raw: ExportRun, hero: string | null, n: number): Run {
  const scans = raw.events
    .filter((e) => e.type === "scan")
    .map((e) => ({
      id: e.id,
      player: e.player,
      start: e.frame,
      end: Number(e.attrs.end),
      key: Boolean(e.attrs.key),
    }));
  return {
    name,
    frames: raw.frames,
    pos: flatten(raw.pos, 1e-3),
    head: flatten(raw.head, 1e-4),
    body: flatten(raw.body, 1e-4),
    ball: flatten(raw.ball, 1e-3),
    ghost: raw.ghost ? flatten(raw.ghost, 1e-3) : new Float32Array(raw.frames * 2 * n),
    seenBy: raw.seen_by ? Uint32Array.from(raw.seen_by.flat()) : new Uint32Array(raw.frames * n),
    sight: !!raw.seen_by,
    owner: Int16Array.from(raw.owner),
    events: raw.events,
    scans,
    decision: raw.decision,
    action: raw.action,
    possessionValue: raw.possession_value,
    firstPass: raw.events.find((e) => e.type === "pass" && e.player !== hero) ?? null,
    blindSide: raw.blind_side,
    detector: raw.scan_detector
      ? {
          omega: flatten(raw.scan_detector.omega, 1e-4),
          onsets: raw.scan_detector.onsets,
          scans: raw.scan_detector.scans.map((player) =>
            player.map((s: ExportDetectedScan) => ({ ...s, amplitude: s.amplitude * 1e-4 })),
          ),
        }
      : null,
  };
}

export function parseHero(json: unknown): Hero {
  const raw = json as HeroExport | MatchExport;
  if (!raw || typeof raw !== "object" || !raw.runs?.factual) throw new Error("not an export");
  if (raw.version !== SCHEMA_VERSION) {
    throw new Error(
      `export schema version ${raw.version}, app expects ${SCHEMA_VERSION}: re-run python -m sim.export`,
    );
  }
  if (isMatchExport(raw)) return parseMatchExport(raw);
  if (!raw.runs.counterfactual) throw new Error("not a hero-moment export");
  const ids = raw.players.map((p) => p.id);
  const n = ids.length;
  const runs = {
    factual: convertRun("factual", raw.runs.factual, raw.hero, n),
    counterfactual: convertRun("counterfactual", raw.runs.counterfactual, raw.hero, n),
  };
  const keyScanId = raw.key_scan?.id ?? null;
  const keyScan = keyScanId ? runs.factual.scans.find((s) => s.id === keyScanId) : null;
  if (keyScanId && !keyScan) throw new Error(`key scan ${keyScanId} missing from the factual run`);
  const reception = runs.factual.events.find(
    (e) => e.type === "reception" && e.player === raw.hero,
  );
  const v = raw.vision;
  const d = raw.scan_detector;
  return {
    kind: "hero",
    scenario: raw.scenario,
    seed: raw.seed,
    dt: raw.dt,
    players: raw.players,
    ids,
    n: ids.length,
    hero: ids.indexOf(raw.hero),
    heroId: raw.hero,
    runner: raw.runner ? ids.indexOf(raw.runner) : -1,
    runnerId: raw.runner,
    keyScan: keyScan ?? null,
    counterfactual: raw.counterfactual,
    vision: {
      halfCone: v.half_cone * 1e-4,
      edgeSigma: v.edge_sigma * 1e-4,
      narrowingPerMps: v.narrowing_per_mps * 1e-4,
      minHalfCone: v.min_half_cone * 1e-4,
      distanceSigma: v.distance_sigma * 1e-3,
    },
    detector: {
      omegaThreshold: d.omega_threshold * 1e-4,
      minExcursion: d.min_excursion * 1e-4,
      returnTolerance: d.return_tolerance * 1e-4,
      onsetFrames: d.onset_frames,
      maxDurationS: d.max_duration_s,
    },
    deltaXt: raw.delta_xt,
    runs,
    reception: reception ? reception.frame : (runs.factual.decision?.frame ?? 0),
    match: null,
  };
}

const isMatchExport = (raw: HeroExport | MatchExport): raw is MatchExport =>
  "kind" in raw && raw.kind === "match";

/** A stitched match: its one run on the match clock, plus possessions, score and moments. */
function parseMatchExport(raw: MatchExport): Hero {
  const ids = raw.players.map((p) => p.id);
  const run: ExportMatchRun & Partial<ExportRun> = raw.runs.factual;
  const factual = convertRun(
    "factual",
    { ...run, decision: null, action: null, possession_value: 0 } as ExportRun,
    null,
    ids.length,
  );
  return {
    kind: "match",
    scenario: raw.scenario,
    seed: raw.seed,
    dt: raw.dt,
    players: raw.players,
    ids,
    n: ids.length,
    hero: -1,
    heroId: null,
    runner: -1,
    runnerId: null,
    keyScan: null,
    counterfactual: null,
    vision: null,
    detector: null,
    deltaXt: 0,
    runs: { factual, counterfactual: factual },
    reception: 0,
    match: parseMatch(raw),
  };
}

/** What the two runs are called on screen: the dropped look, or the forced action. */
export interface RunLabels {
  factual: string; // the run toggle
  counterfactual: string;
  ghostOfFactual: string; // the ghost chip and tag showing the other run
  ghostOfCounterfactual: string;
  tag: Record<RunName, string>; // on the board and evidence: "without the look", "if he …"
  gain: string; // what `deltaXt` measures: factual minus counterfactual possession value
}

export function runLabels(hero: Hero): RunLabels {
  const cf = hero.counterfactual;
  if (cf?.intervention === "force_action") {
    const [verb, gerund] = forced(cf.action);
    return {
      factual: "What he did",
      counterfactual: `If he ${verb}`,
      ghostOfFactual: "Ghost: what he did",
      ghostOfCounterfactual: `Ghost: if he ${verb}`,
      tag: { factual: "what he did", counterfactual: `if he ${verb}` },
      gain: `Possession value gained over ${gerund}`,
    };
  }
  return {
    factual: "With the look",
    counterfactual: "Without the look",
    ghostOfFactual: "Ghost: with the look",
    ghostOfCounterfactual: "Ghost: no look",
    tag: { factual: "with the look", counterfactual: "without the look" },
    gain: "Expected threat gained by looking",
  };
}

/** A forced action as "if he …" and "… over …": ["carried it", "carrying it"]. */
function forced(action: string): [string, string] {
  if (action.startsWith("pass:"))
    return [`passed to ${action.slice(5)}`, `passing to ${action.slice(5)}`];
  if (action === "carry") return ["carried it", "carrying it"];
  if (action === "shot") return ["shot", "shooting"];
  return [`chose ${action}`, action];
}

// ---------- angles ----------

export function wrapAngle(a: number): number {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

// ---------- sampling at a fractional frame ----------

/** Preallocated buffers for one frame; views keep one and refill it every render. */
export class Sample {
  frame = 0; // integer frame at or before the sample time
  pos: Float32Array;
  ghost: Float32Array;
  head: Float32Array; // head yaw, rad, world frame
  body: Float32Array; // body yaw, rad, world frame
  ball = new Float32Array(2);
  constructor(n: number) {
    this.pos = new Float32Array(2 * n);
    this.ghost = new Float32Array(2 * n);
    this.head = new Float32Array(n);
    this.body = new Float32Array(n);
  }
}

export function clampFrame(run: Run, f: number): number {
  return Math.max(0, Math.min(run.frames - 1, f));
}

/** Fill `out` with every player at fractional frame `f`. `eased` uses comfort-mode head yaw. */
export function sampleInto(out: Sample, hero: Hero, run: Run, f: number, eased = false): Sample {
  const n = hero.n;
  const c = clampFrame(run, f);
  const i0 = Math.floor(c);
  const i1 = Math.min(run.frames - 1, i0 + 1);
  const t = c - i0;
  for (let k = 0; k < 2 * n; k++) {
    out.pos[k] = lerp(run.pos[i0 * 2 * n + k], run.pos[i1 * 2 * n + k], t);
    out.ghost[k] = lerp(run.ghost[i0 * 2 * n + k], run.ghost[i1 * 2 * n + k], t);
  }
  for (let j = 0; j < n; j++) {
    out.head[j] = eased
      ? easedHeadAt(hero, run, j, c)
      : lerpAngle(run.head[i0 * n + j], run.head[i1 * n + j], t);
    out.body[j] = lerpAngle(run.body[i0 * n + j], run.body[i1 * n + j], t);
  }
  out.ball[0] = lerp(run.ball[i0 * 2], run.ball[i1 * 2], t);
  out.ball[1] = lerp(run.ball[i0 * 2 + 1], run.ball[i1 * 2 + 1], t);
  out.frame = i0;
  return out;
}

/** How far player j's head points away from the ball, rad in [0, pi] (the HUD figure). */
export function headOffBall(sample: Sample, j: number): number {
  const toBall = Math.atan2(
    sample.ball[1] - sample.pos[2 * j + 1],
    sample.ball[0] - sample.pos[2 * j],
  );
  return Math.abs(wrapAngle(sample.head[j] - toBall));
}

export function isSeen(hero: Hero, run: Run, frame: number, observer: number, target: number) {
  const mask = run.seenBy[Math.floor(clampFrame(run, frame)) * hero.n + observer];
  return ((mask >>> target) & 1) === 1;
}

/** Running speed of player j at frame f (finite difference of positions), m/s. */
export function speedAt(hero: Hero, run: Run, j: number, f: number): number {
  const i0 = Math.min(run.frames - 2, Math.floor(clampFrame(run, f)));
  if (i0 < 0) return 0;
  const n = hero.n;
  const dx = run.pos[((i0 + 1) * n + j) * 2] - run.pos[(i0 * n + j) * 2];
  const dy = run.pos[((i0 + 1) * n + j) * 2 + 1] - run.pos[(i0 * n + j) * 2 + 1];
  return Math.hypot(dx, dy) / hero.dt;
}

/** Half-angle of the sim's full-visibility cone at this running speed (SPEC 3.4). */
export function halfCone(vision: Vision, speed: number): number {
  return Math.max(vision.minHalfCone, vision.halfCone - vision.narrowingPerMps * speed);
}

// ---------- comfort mode: eased head yaw (SPEC 7) ----------
//
// Between frames the head yaw is interpolated with a monotone cubic (Fritsch-Carlson, as in
// PCHIP) instead of a straight line. Turns start and stop with zero angular velocity, so a scan
// eases in and out, but every frame keeps its exact value: the peak of a look over the shoulder
// is never cut short, and what the player saw stays on screen.

interface HeadCurve {
  yaw: Float64Array; // unwrapped head yaw per frame, rad
  slope: Float64Array; // tangent per frame, rad per frame
}

const curves = new WeakMap<Run, Map<number, HeadCurve>>();

function headCurve(hero: Hero, run: Run, j: number): HeadCurve {
  let perRun = curves.get(run);
  if (!perRun) curves.set(run, (perRun = new Map()));
  const cached = perRun.get(j);
  if (cached) return cached;

  const n = hero.n;
  const frames = run.frames;
  const yaw = new Float64Array(frames);
  yaw[0] = run.head[j];
  for (let f = 1; f < frames; f++) {
    yaw[f] = yaw[f - 1] + wrapAngle(run.head[f * n + j] - run.head[(f - 1) * n + j]);
  }
  const slope = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const before = f > 0 ? yaw[f] - yaw[f - 1] : null;
    const after = f < frames - 1 ? yaw[f + 1] - yaw[f] : null;
    if (before === null || after === null) slope[f] = before ?? after ?? 0;
    else if (before * after <= 0)
      slope[f] = 0; // local extremum or plateau edge: stop turning
    else slope[f] = 2 / (1 / before + 1 / after); // harmonic mean keeps it monotone
  }
  const curve = { yaw, slope };
  perRun.set(j, curve);
  return curve;
}

/** Eased head yaw of player j at fractional frame f (cubic Hermite between frames). */
export function easedHeadAt(hero: Hero, run: Run, j: number, f: number): number {
  const { yaw, slope } = headCurve(hero, run, j);
  const c = clampFrame(run, f);
  const i0 = Math.min(run.frames - 2, Math.floor(c));
  if (i0 < 0) return wrapAngle(yaw[0]);
  const t = c - i0;
  const t2 = t * t;
  const t3 = t2 * t;
  const value =
    (2 * t3 - 3 * t2 + 1) * yaw[i0] +
    (t3 - 2 * t2 + t) * slope[i0] +
    (-2 * t3 + 3 * t2) * yaw[i0 + 1] +
    (t3 - t2) * slope[i0 + 1];
  return wrapAngle(value);
}

// ---------- labels ----------

export function actionLabel(action: string): string {
  if (action.startsWith("pass:")) return `Pass to ${action.slice(5)}`;
  if (action === "carry") return "Carry forward";
  if (action === "shot") return "Shoot";
  return action;
}
