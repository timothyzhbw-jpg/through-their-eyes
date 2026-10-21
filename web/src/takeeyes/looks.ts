// "Take his eyes" (SPEC 3.7, 7): the look grid precomputed by sim.export.export_looks. The viewer
// gives the hero one look, from the pass to him until his decision, and sees the moment
// re-simulated with it: every cell of the grid (a time × a direction) is a re-simulation, bundled
// with its verified lines in en and zh. No live re-simulation, no model call.
//
// Before his decision a look changes only his head and what he believes (the export refuses one
// that changes anything else), so a look's run is the factual run with his head, his sight and
// his belief spliced in over the window (`lookRun`); from the decision on it is its own run,
// stored for the players on the ball only (`after`, the what-ifs' ghost-path format).

import { actionLabel, type Hero, type Run, type Scan } from "../data/hero";
import type { ExportAction, ExportDecision, ExportEvent } from "../data/types";
import { checkPayload, claimRun, type Narration } from "../narration/payload";
import type { MomentContext } from "../plan/moment";
import { LANGUAGES, type Language, type WhatIfRun } from "../whatif/whatif";

export const LOOK_VERSION = 1;

/** The bundled look grid of each hero moment, by `<scenario>-<seed>`. */
export const LOOK_FILES: Record<string, string> = {
  "blind_side_run-3": "look_seed3.json",
  "press_escape-0": "look_press_escape_seed0.json",
};

/** Why Take his eyes stays shut for a moment without a bundled grid. */
export const NO_GRID =
  "Every look is re-simulated ahead of time; the looks are bundled for the demo's hero moments only.";

interface RawLook {
  start: number;
  end: number;
  direction: number; // 1e-4 rad
  amplitude: number;
}

interface RawEntry {
  id: string;
  head: number[]; // 1e-4 rad, every frame of the window
  seen: number[]; // bitmask of the players he sees, every frame of the window
  // No look: [frame - window start][2 * player + xy] mm. A look: the players it moved, from its
  // first frame: {player: [[x, y] per frame]}; the others as with no look.
  ghost: number[][] | Record<string, number[][]>;
  events: ExportEvent[]; // his events in the window
  decision: ExportDecision;
  action: ExportAction | null;
  outcome: string;
  possession_value: number;
  delta_xt: number;
  changed: boolean;
  run: number;
  answers: Record<Language, unknown>;
}

interface RawCell extends Partial<RawEntry> {
  frame: number;
  offset: number;
  unavailable: string | null;
  look?: RawLook;
}

interface RawRun {
  start: number;
  frames: number;
  players: string[];
  pos: number[][]; // [frame][2 * k + xy] mm, players in `players` order
  ball: number[][];
  events: ExportEvent[];
}

interface RawLooks {
  version: number;
  moment: string;
  hero: string;
  window: [number, number];
  reception: number;
  decision_frame: number;
  spacing_s: number;
  frames: number[];
  offsets: number[];
  own_looks: { id: string; start: number; end: number; offset: number }[];
  factual: { chosen: string; outcome: string; possession_value: number };
  no_look: RawEntry;
  cells: RawCell[];
  runs: RawRun[];
  summary: { cells: number; available: number; changed: number; differ_from_no_look: number };
}

/** One look of the grid, or no look at all. Angles in radians, positions in metres. */
export interface LookEntry {
  id: string; // "look:H8:0050:-150", or "look:H8:none"
  frame: number | null; // the look's first frame; null: no look
  offset: number | null; // degrees from the ball, + to his left
  look: { start: number; end: number; direction: number; amplitude: number } | null;
  head: Float32Array; // his head yaw over the window
  seen: Uint32Array; // whom he sees over the window
  ghost: Float32Array; // his belief over the window: [(frame - start) * n + player] * 2 + xy
  events: ExportEvent[];
  decision: ExportDecision;
  action: ExportAction | null;
  outcome: string; // "kept", "lost", "open", …: what came of his action
  possessionValue: number;
  deltaXt: number; // what he really did minus this, in expected threat
  changed: boolean; // he decides differently from what he really did
  after: WhatIfRun; // from the decision on; players not on the ball as in the factual run
  answers: Partial<Record<Language, Narration>>; // only answers that pass the checks
  errors: string[];
}

export interface LookCell {
  frame: number;
  offset: number;
  unavailable: string | null; // why no look starts there (a scan under way)
  entry: LookEntry | null;
}

export interface Looks {
  moment: string;
  heroId: string;
  window: [number, number]; // [the pass to him, his decision)
  reception: number;
  decisionFrame: number;
  spacingS: number;
  frames: number[]; // the grid's look frames, ascending
  offsets: number[]; // the grid's directions, degrees
  ownLooks: { id: string; start: number; end: number; offset: number }[]; // his, factual run
  factual: { chosen: string; outcome: string; possessionValue: number };
  noLook: LookEntry;
  cells: LookCell[];
  summary: { cells: number; available: number; changed: number; differFromNoLook: number };
}

const rad = (v: number) => v * 1e-4;

function afterRun(raw: RawRun, hero: Hero): WhatIfRun {
  const n = hero.n;
  const fac = hero.runs.factual;
  const pos = new Float32Array(raw.frames * 2 * n);
  for (let k = 0; k < raw.frames; k++) {
    const f = Math.min(raw.start + k, fac.frames - 1);
    pos.set(fac.pos.subarray(f * 2 * n, (f + 1) * 2 * n), k * 2 * n);
  }
  raw.players.forEach((id, p) => {
    const j = hero.ids.indexOf(id);
    if (j < 0) throw new Error(`look run has unknown player ${id}`);
    for (let k = 0; k < raw.frames; k++) {
      pos[(k * n + j) * 2] = raw.pos[k][2 * p] / 1000;
      pos[(k * n + j) * 2 + 1] = raw.pos[k][2 * p + 1] / 1000;
    }
  });
  return {
    start: raw.start,
    frames: raw.frames,
    pos,
    ball: Float32Array.from(raw.ball.flat(), (v) => v / 1000),
    events: raw.events,
  };
}

function entryOf(
  raw: RawEntry,
  cell: { frame: number | null; offset: number | null; look: RawLook | null },
  base: Float32Array | null,
  ctx: { hero: Hero; moment: string; window: [number, number]; runs: WhatIfRun[] },
): LookEntry {
  const { hero } = ctx;
  const [start, end] = ctx.window;
  const n = hero.n;
  const span = end - start + 1;
  let ghost: Float32Array;
  if (Array.isArray(raw.ghost)) {
    ghost = Float32Array.from(raw.ghost.flat(), (v) => v / 1000);
  } else {
    if (!base || cell.frame === null) throw new Error(`${raw.id}: a sparse belief needs a base`);
    ghost = base.slice();
    for (const [id, rows] of Object.entries(raw.ghost)) {
      const j = hero.ids.indexOf(id);
      rows.forEach(([x, y], k) => {
        const at = (cell.frame! - start + k) * n + j;
        ghost[2 * at] = x / 1000;
        ghost[2 * at + 1] = y / 1000;
      });
    }
  }
  if (ghost.length !== span * 2 * n || raw.head.length !== span || raw.seen.length !== span) {
    throw new Error(`${raw.id}: the window has ${span} frames`);
  }
  const after = ctx.runs[raw.run];
  if (!after) throw new Error(`${raw.id}: no run ${raw.run}`);
  const entry: LookEntry = {
    id: raw.id,
    frame: cell.frame,
    offset: cell.offset,
    look: cell.look
      ? {
          start: cell.look.start,
          end: cell.look.end,
          direction: rad(cell.look.direction),
          amplitude: rad(cell.look.amplitude),
        }
      : null,
    head: Float32Array.from(raw.head, rad),
    seen: Uint32Array.from(raw.seen),
    ghost,
    events: raw.events,
    decision: raw.decision,
    action: raw.action,
    outcome: raw.outcome,
    possessionValue: raw.possession_value,
    deltaXt: raw.delta_xt,
    changed: raw.changed,
    after,
    answers: {},
    errors: [],
  };
  const factualEvents = hero.runs.factual.events.map((e) => e.id);
  const scope = {
    moment: `${ctx.moment}?${raw.id}`,
    events: new Set([...factualEvents, ...raw.events.map((e) => e.id)]),
    frames: (c: Parameters<typeof claimRun>[0]) =>
      claimRun(c) === "factual" ? hero.runs.factual.frames : after.start + after.frames,
  };
  for (const lang of LANGUAGES) {
    const checked = checkPayload(raw.answers?.[lang], scope);
    if (checked.ok) entry.answers[lang] = checked.narration;
    else entry.errors.push(...checked.errors.map((e) => `${lang}: ${e}`));
  }
  return entry;
}

export function parseLooks(json: unknown, hero: Hero, m: MomentContext): Looks {
  const raw = json as RawLooks;
  if (!raw || raw.version !== LOOK_VERSION || !Array.isArray(raw.cells)) {
    throw new Error(`look file version ${raw?.version}, app expects ${LOOK_VERSION}`);
  }
  if (raw.moment !== m.id) throw new Error(`the looks are for ${raw.moment}, not ${m.id}`);
  if (raw.hero !== hero.heroId)
    throw new Error(`the looks are ${raw.hero}'s, not ${hero.heroId}'s`);
  const ctx = {
    hero,
    moment: raw.moment,
    window: raw.window,
    runs: raw.runs.map((r) => afterRun(r, hero)),
  };
  const noLook = entryOf(raw.no_look, { frame: null, offset: null, look: null }, null, ctx);
  const cells = raw.cells.map((c): LookCell => ({
    frame: c.frame,
    offset: c.offset,
    unavailable: c.unavailable,
    entry:
      c.unavailable === null
        ? entryOf(
            c as RawEntry,
            { frame: c.frame, offset: c.offset, look: c.look ?? null },
            noLook.ghost,
            ctx,
          )
        : null,
  }));
  return {
    moment: raw.moment,
    heroId: raw.hero,
    window: raw.window,
    reception: raw.reception,
    decisionFrame: raw.decision_frame,
    spacingS: raw.spacing_s,
    frames: raw.frames,
    offsets: raw.offsets,
    ownLooks: raw.own_looks,
    factual: {
      chosen: raw.factual.chosen,
      outcome: raw.factual.outcome,
      possessionValue: raw.factual.possession_value,
    },
    noLook,
    cells,
    summary: {
      cells: raw.summary.cells,
      available: raw.summary.available,
      changed: raw.summary.changed,
      differFromNoLook: raw.summary.differ_from_no_look,
    },
  };
}

export function cellAt(looks: Looks, frame: number, offset: number): LookCell | undefined {
  return looks.cells.find((c) => c.frame === frame && c.offset === offset);
}

// ---------- the grid: snapping a time and a direction ----------

/** Seconds before the ball reaches him, for a look frame (0 at the reception). */
export const secondsBefore = (looks: Looks, frame: number, dt: number): number =>
  Math.round((looks.reception - frame) * dt * 10) / 10;

/** The grid frame nearest to `frame`. */
export function snapFrame(looks: Looks, frame: number): number {
  return looks.frames.reduce((best, f) =>
    Math.abs(f - frame) < Math.abs(best - frame) ? f : best,
  );
}

/** The grid direction nearest to `deg` (degrees from the ball, + to his left), on the circle. */
export function snapOffset(looks: Looks, deg: number): number {
  const gap = (a: number) => Math.abs(((((a - deg) % 360) + 540) % 360) - 180);
  return looks.offsets.reduce((best, o) => (gap(o) < gap(best) ? o : best));
}

/** A call in words, placed shots included (near or far post, as the shooter sees it). */
export function callLabel(action: string): string {
  if (action === "shot:near") return "Shoot at the near post";
  if (action === "shot:far") return "Shoot at the far post";
  return actionLabel(action);
}

/** Where a look goes, in words: no numbers. */
export function whereLabel(offset: number): string {
  const side = offset > 0 ? "left" : "right";
  return Math.abs(offset) >= 120 ? `Over his ${side} shoulder` : `To his ${side}`;
}

/** The grid's directions in the order they go round him, from his left over his back to his
 * right (the arrow keys move along it). */
export function aroundHim(looks: Looks): number[] {
  const around = (o: number) => (o + 360) % 360; // counter-clockwise from the ball
  return [...looks.offsets].sort((a, b) => around(a) - around(b));
}

/** The grid cell nearest to his own look (his first one in the window), to start from. */
export function startingCell(looks: Looks): { frame: number; offset: number } {
  const own = looks.ownLooks[0];
  if (!own)
    return { frame: looks.frames[Math.floor(looks.frames.length / 2)], offset: looks.offsets[0] };
  return { frame: snapFrame(looks, own.start), offset: snapOffset(looks, own.offset) };
}

// ---------- a look's run, for the views ----------

/**
 * The run of a look (or no look) up to his decision: the factual run with his head, his sight,
 * his belief and his own events in the window replaced. The views play it as the
 * "counterfactual" run of a derived hero (controller.ts).
 */
export function lookRun(hero: Hero, looks: Looks, entry: LookEntry): Run {
  const fac = hero.runs.factual;
  const n = hero.n;
  const me = hero.hero;
  const [start, end] = looks.window;
  const frames = end + 1;
  const head = fac.head.slice(0, frames * n);
  const seenBy = fac.seenBy.slice(0, frames * n);
  const ghost = fac.ghost.slice(0, frames * 2 * n);
  for (let f = start; f <= end; f++) {
    head[f * n + me] = entry.head[f - start];
    seenBy[f * n + me] = entry.seen[f - start];
  }
  ghost.set(entry.ghost, start * 2 * n);
  const events = [
    ...fac.events.filter((e) => e.frame < end && !(e.player === looks.heroId && e.frame >= start)),
    ...entry.events,
  ].sort((a, b) => a.frame - b.frame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const scans: Scan[] = events
    .filter((e) => e.type === "scan")
    .map((e) => ({
      id: e.id,
      player: e.player,
      start: e.frame,
      end: Number(e.attrs.end),
      key: e.player === looks.heroId && e.frame === entry.frame,
    }));
  return {
    name: "counterfactual",
    frames,
    pos: fac.pos.slice(0, frames * 2 * n),
    head,
    body: fac.body.slice(0, frames * n),
    ball: fac.ball.slice(0, frames * 2),
    ghost,
    seenBy,
    sight: fac.sight,
    owner: fac.owner.slice(0, frames),
    events,
    scans,
    decision: entry.decision,
    action: entry.action,
    possessionValue: entry.possessionValue,
    firstPass: fac.firstPass,
    blindSide: { intervals: [], frames: [] }, // alerts are not re-run for a look
    detector: null,
  };
}

/** The players a look brought into his sight before he decided: not seen at its first frame,
 * seen at some frame of it up to the decision. */
export function broughtIntoSight(hero: Hero, looks: Looks, entry: LookEntry): string[] {
  if (!entry.look) return [];
  const [start, end] = looks.window;
  const first = entry.seen[entry.look.start - start];
  let seen = 0;
  for (let f = entry.look.start; f <= Math.min(entry.look.end, end); f++)
    seen |= entry.seen[f - start];
  return hero.ids.filter((_, j) => j !== hero.hero && (seen >> j) & 1 && !((first >> j) & 1));
}
