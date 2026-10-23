// The Tactics lab's metrics (SPEC 4.8, 7), computed in the browser from the events and tracking an
// export already carries: no new export fields, no model and no service. Each metric has a
// definition and a source that the card prints beside it. What the sim models decides what can be
// said: the ball changes hands on interceptions in open play, and on tackles in the pressure hero
// only (docs/NUMBERS.md M4), so the press card counts those two and says so; it has no fouls,
// challenges or duels.

import type { ExportEvent, Vec2 } from "../data/types";

export type Team = 0 | 1;

export const HALF_LENGTH = 52.5; // m, pitch 105 x 68 with the origin at the centre spot
const THIRD = 105 / 3;

/** The sim's team letter and shirt number ("H8"): home is the team that attacks +x. */
export const teamOf = (playerId: string): Team => (playerId.startsWith("H") ? 0 : 1);
export const attackSign = (team: Team): 1 | -1 => (team === 0 ? 1 : -1);

/** x in the frame where the team attacks +x. */
const forward = (team: Team, x: number): number => x * attackSign(team);

// ---------- definitions, printed on the cards ----------

export const THIRD_START = HALF_LENGTH - THIRD; // 17.5 m: where the attacking third begins
/** PPDA's pressing zone: the opponent's own 60% of the pitch, as it is usually drawn. */
export const PRESS_ZONE_FROM = -HALF_LENGTH + 0.4 * 105; // -10.5 m in the attacker's frame
export const REGAIN_WINDOW_S = 10; // shots after a high regain count for this long
export const FPS = 25;

// ---------- reading events ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function point(v: unknown): Vec2 | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [x, y] = [num(v[0]), num(v[1])];
  return x === null || y === null ? null : [x, y];
}

/** A defensive action the sim models: an interception, or a tackle (pressure hero only). */
export const DEFENSIVE = ["interception", "tackle"] as const;

export interface Regain {
  id: string;
  frame: number;
  team: Team; // who won the ball
  kind: (typeof DEFENSIVE)[number];
  at: Vec2;
  high: boolean; // in the winner's attacking third
}

export function regains(events: readonly ExportEvent[]): Regain[] {
  const out: Regain[] = [];
  for (const e of events) {
    if (e.type !== "interception" && e.type !== "tackle") continue;
    const at = point(e.attrs.at);
    if (!at) continue;
    const team = teamOf(e.player);
    out.push({
      id: e.id,
      frame: e.frame,
      team,
      kind: e.type,
      at,
      high: forward(team, at[0]) > THIRD_START,
    });
  }
  return out;
}

// ---------- high press ----------

export interface PressMetrics {
  team: Team;
  actions: number; // interceptions and tackles by this team, anywhere
  regains: number; // the same: each one is a regain of the ball
  highRegains: number; // won in the attacking third
  zoneActions: number; // PPDA's denominator
  zonePasses: number; // opponent passes kicked in the zone: PPDA's numerator
  ppda: number | null; // null with no defensive action in the zone
  shotsAfterHighRegain: number; // by this team within REGAIN_WINDOW_S of a high regain
  xgAfterHighRegain: number;
}

export function pressMetrics(events: readonly ExportEvent[], team: Team): PressMetrics {
  const mine = regains(events).filter((r) => r.team === team);
  const inZone = (r: Regain) => forward(team, r.at[0]) > PRESS_ZONE_FROM;
  const zoneActions = mine.filter(inZone).length;
  // The opponent's passes kicked in the zone (attempted, whatever became of them).
  const zonePasses = events.filter((e) => {
    if (e.type !== "pass" || teamOf(e.player) === team) return false;
    const start = point(e.attrs.start);
    return !!start && forward(team, start[0]) > PRESS_ZONE_FROM;
  }).length;
  const high = mine.filter((r) => r.high);
  const window = REGAIN_WINDOW_S * FPS;
  const after = shotQuality(events, team).list.filter((s) =>
    high.some((r) => s.frame >= r.frame && s.frame <= r.frame + window),
  );
  return {
    team,
    actions: mine.length,
    regains: mine.length,
    highRegains: high.length,
    zoneActions,
    zonePasses,
    ppda: zoneActions ? zonePasses / zoneActions : null,
    shotsAfterHighRegain: after.length,
    xgAfterHighRegain: after.reduce((sum, s) => sum + s.xg, 0),
  };
}

// ---------- shot quality ----------

/** xG of an unplaced shot `d` m from the goal centre: sim/decision.py `distance_xg`. */
export function distanceXg(d: number): number {
  return Math.min(0.6, 0.35 * Math.exp(-(d - 6) / 7));
}

export interface Shot {
  id: string;
  frame: number;
  player: string;
  team: Team;
  distance: number; // m, from where it was kicked to the centre of the goal it attacks
  xg: number;
}

export interface ShotQuality {
  team: Team;
  shots: number;
  xg: number;
  perShot: number | null;
  list: Shot[];
}

export function shotQuality(events: readonly ExportEvent[], team: Team): ShotQuality {
  const list: Shot[] = [];
  for (const e of events) {
    if (e.type !== "shot" || teamOf(e.player) !== team) continue;
    const start = point(e.attrs.start);
    if (!start) continue;
    const distance = Math.hypot(attackSign(team) * HALF_LENGTH - start[0], start[1]);
    list.push({
      id: e.id,
      frame: e.frame,
      player: e.player,
      team,
      distance,
      xg: distanceXg(distance),
    });
  }
  const xg = list.reduce((sum, s) => sum + s.xg, 0);
  return { team, shots: list.length, xg, perShot: list.length ? xg / list.length : null, list };
}

// ---------- progression: xT added by passes ----------

/** The xT grid: `grid[i * rows + j]`, column i along x from the own goal line, for a team that
 * attacks +x (analytics/xt.py; the export ships it in units of 1e-4). */
export interface XtGrid {
  cols: number;
  rows: number;
  grid: number[];
}

export function parseXtGrid(raw: {
  units?: string;
  cols: number;
  rows: number;
  grid: number[][];
}): XtGrid {
  if (raw.units !== "1e-4") throw new Error(`xT grid in units ${raw.units}, expected 1e-4`);
  return { cols: raw.cols, rows: raw.rows, grid: raw.grid.flat().map((v) => v * 1e-4) };
}

/** xT of a point for `team`: bilinear between cell centres, constant beyond the outermost ones
 * (analytics/xt.py `grid_value`). */
export function xtAt(g: XtGrid, p: Vec2, team: Team): number {
  const s = attackSign(team);
  const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));
  const fx = clamp(((s * p[0] + 52.5) / 105) * g.cols - 0.5, g.cols - 1);
  const fy = clamp(((s * p[1] + 34) / 68) * g.rows - 0.5, g.rows - 1);
  const i = Math.min(Math.floor(fx), g.cols - 2);
  const j = Math.min(Math.floor(fy), g.rows - 2);
  const [tx, ty] = [fx - i, fy - j];
  const at = (a: number, b: number) => g.grid[a * g.rows + b];
  return (
    (1 - tx) * (1 - ty) * at(i, j) +
    tx * (1 - ty) * at(i + 1, j) +
    (1 - tx) * ty * at(i, j + 1) +
    tx * ty * at(i + 1, j + 1)
  );
}

export interface PassGain {
  id: string;
  frame: number;
  player: string;
  receiver: string | null;
  from: Vec2;
  to: Vec2;
  xt: number; // xT where it was received minus xT where it was kicked
}

export interface Progression {
  team: Team;
  passes: number; // kicked
  completed: number;
  xtAdded: number; // summed over completed passes
  progressive: number; // completed passes that added xT
  best: PassGain | null;
  list: PassGain[]; // completed passes, in order
}

export function progression(events: readonly ExportEvent[], team: Team, xt: XtGrid): Progression {
  const mine = events.filter((e) => e.type === "pass" && teamOf(e.player) === team);
  const list: PassGain[] = [];
  for (const e of mine) {
    const from = point(e.attrs.start);
    const to = point(e.attrs.end_at);
    if (e.attrs.outcome !== "complete" || !from || !to) continue;
    list.push({
      id: e.id,
      frame: e.frame,
      player: e.player,
      receiver: typeof e.attrs.receiver === "string" ? e.attrs.receiver : null,
      from,
      to,
      xt: xtAt(xt, to, team) - xtAt(xt, from, team),
    });
  }
  const best = list.reduce<PassGain | null>((b, g) => (b === null || g.xt > b.xt ? g : b), null);
  return {
    team,
    passes: mine.length,
    completed: list.length,
    xtAdded: list.reduce((sum, g) => sum + g.xt, 0),
    progressive: list.filter((g) => g.xt > 0).length,
    best,
    list,
  };
}
