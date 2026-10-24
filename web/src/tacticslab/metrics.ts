// The Tactics lab's metrics (SPEC 4.8, 7), computed in the browser from the events and tracking an
// export already carries: no new export fields, no model and no service. Each metric has a
// definition and a source that the card prints beside it. What the sim models decides what can be
// said: the ball changes hands on interceptions in open play, and on tackles in the pressure hero
// only (docs/NUMBERS.md M4), so the press card counts those two and says so; it has no fouls,
// challenges or duels.

import type { Hero, Run } from "../data/hero";
import type { ExportEvent, Vec2 } from "../data/types";

export type Team = 0 | 1;

export const HALF_LENGTH = 52.5; // m, pitch 105 x 68 with the origin at the centre spot
export const PITCH_L = 105; // m
export const PITCH_W = 68; // m
const THIRD = PITCH_L / 3;

/** The sim's team letter and shirt number ("H8"): home is the team that attacks +x. */
export const teamOf = (playerId: string): Team => (playerId.startsWith("H") ? 0 : 1);
export const attackSign = (team: Team): 1 | -1 => (team === 0 ? 1 : -1);

/** x in the frame where the team attacks +x. */
const forward = (team: Team, x: number): number => x * attackSign(team);

// ---------- definitions, printed on the cards ----------

export const THIRD_START = HALF_LENGTH - THIRD; // 17.5 m: where the attacking third begins
/** PPDA's pressing zone: the opponent's own 60% of the pitch, as it is usually drawn. */
export const PRESS_ZONE_SHARE = 0.6;
export const PRESS_ZONE_FROM = -HALF_LENGTH + (1 - PRESS_ZONE_SHARE) * PITCH_L; // -10.5 m in the attacker's frame
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
  possession: number | null; // null in a lone hero run
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
      possession: e.possession ?? null,
    });
  }
  return out;
}

// ---------- high press ----------

export interface PressMetrics {
  team: Team;
  regains: number; // interceptions and tackles by this team, anywhere: each is a regain
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
export const XG_CAP = 0.6;
export const XG_PEAK = 0.35;
export const XG_D0 = 6; // m
export const XG_SCALE = 7; // m
export function distanceXg(d: number): number {
  return Math.min(XG_CAP, XG_PEAK * Math.exp(-(d - XG_D0) / XG_SCALE));
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
  const fx = clamp(((s * p[0] + HALF_LENGTH) / PITCH_L) * g.cols - 0.5, g.cols - 1);
  const fy = clamp(((s * p[1] + PITCH_W / 2) / PITCH_W) * g.rows - 0.5, g.rows - 1);
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

// ---------- pressing and playing out from the back ----------

export const PRESSED = 0.7;
export const MIN_BYPASSED = 2;
export const COUNTER_WINDOW_S = 10;
export const TRANSITION_WINDOW_S = 5;
const PRESS_SMOOTH_FRAMES = 5;
const PRESS_REACTION_S = 0.7;
const PRESS_V_MAX = 5;
const PRESS_THRESHOLD_S = 1.5;
const PRESS_SIGMA_S = 0.45;
const PRESS_TARGET_LEAD_S = 1;

function segmentStart(hero: Hero, frame: number): number {
  let start = 0;
  for (const p of hero.match?.possessions ?? []) if (p.start <= frame) start = p.start;
  return start;
}

function playerPoint(run: Run, n: number, j: number, frame: number): Vec2 {
  const i = (frame * n + j) * 2;
  return [run.pos[i], run.pos[i + 1]];
}

function playerVelocity(hero: Hero, run: Run, j: number, frame: number): Vec2 {
  const k = Math.min(PRESS_SMOOTH_FRAMES, frame - segmentStart(hero, frame));
  if (k <= 0) return [0, 0];
  const now = playerPoint(run, hero.n, j, frame);
  const before = playerPoint(run, hero.n, j, frame - k);
  return [(now[0] - before[0]) / (k * hero.dt), (now[1] - before[1]) / (k * hero.dt)];
}

function arrivalProbability(defender: Vec2, velocity: Vec2, target: Vec2): number {
  const after: Vec2 = [
    defender[0] + velocity[0] * PRESS_REACTION_S,
    defender[1] + velocity[1] * PRESS_REACTION_S,
  ];
  const tti =
    PRESS_REACTION_S + Math.hypot(target[0] - after[0], target[1] - after[1]) / PRESS_V_MAX;
  const dx = target[0] - defender[0];
  const dy = target[1] - defender[1];
  const speed = Math.hypot(...velocity);
  const cos = (velocity[0] * dx + velocity[1] * dy) / Math.max(speed * Math.hypot(dx, dy), 1e-5);
  const withHeading = tti + (speed * Math.acos(Math.max(-1, Math.min(1, cos)))) / Math.PI;
  const z = (Math.PI / (Math.sqrt(3) * PRESS_SIGMA_S)) * (PRESS_THRESHOLD_S - withHeading);
  return 1 / (1 + Math.exp(-z));
}

/** Bekkers pressing intensity on the carrier at a kick, from the exported tracking only. */
export function pressingIntensity(hero: Hero, run: Run, frame: number, playerId: string): number {
  const carrier = hero.ids.indexOf(playerId);
  if (carrier < 0 || frame < 0 || frame >= run.frames) return 0;
  const team = hero.players[carrier].team;
  const target = playerPoint(run, hero.n, carrier, frame);
  const targetVelocity = playerVelocity(hero, run, carrier, frame);
  const ball: Vec2 = [run.ball[frame * 2], run.ball[frame * 2 + 1]];
  const led = (p: Vec2, v: Vec2): Vec2 => [
    p[0] + v[0] * PRESS_TARGET_LEAD_S,
    p[1] + v[1] * PRESS_TARGET_LEAD_S,
  ];
  let noPress = 1;
  for (let j = 0; j < hero.n; j++) {
    if (hero.players[j].team === team) continue;
    const at = playerPoint(run, hero.n, j, frame);
    const velocity = playerVelocity(hero, run, j, frame);
    const body = arrivalProbability(at, velocity, led(target, targetVelocity));
    const onBall = arrivalProbability(at, velocity, led(ball, targetVelocity));
    noPress *= 1 - Math.max(body, onBall);
  }
  return 1 - noPress;
}

export interface BuildUpPass {
  id: string;
  frame: number;
  team: Team;
  player: string;
  receiver: string | null;
  pressure: number;
  bypassed: number;
  completed: boolean;
  pressed: boolean;
  scenario: string | null;
}

export interface TeamBuildUp {
  team: Team;
  passes: number;
  completed: number;
  pressured: number;
  completedPressured: number;
  lineBreaking: number;
  lineBreakingPressured: number;
}

export interface BuildUpMetrics {
  teams: [TeamBuildUp, TeamBuildUp];
  best: BuildUpPass | null;
  list: BuildUpPass[];
}

/** Own-half passes, pressure at the kick, and completed passes past a line of opponents. */
export function buildUpMetrics(hero: Hero): BuildUpMetrics {
  const run = hero.runs.factual;
  const list: BuildUpPass[] = [];
  for (const e of run.events) {
    if (e.type !== "pass") continue;
    const from = point(e.attrs.start);
    const to = point(e.attrs.end_at);
    if (!from || !to) continue;
    const team = teamOf(e.player);
    if (forward(team, from[0]) >= 0) continue;
    const completed = e.attrs.outcome === "complete";
    const end = num(e.attrs.end);
    let bypassed = 0;
    if (completed && end !== null && end >= 0 && end < run.frames) {
      for (let j = 0; j < hero.n; j++) {
        const p = hero.players[j];
        if (p.team === team || p.role === "GK") continue;
        const ahead =
          forward(team, playerPoint(run, hero.n, j, e.frame)[0]) > forward(team, from[0]);
        const behind = forward(team, playerPoint(run, hero.n, j, end)[0]) < forward(team, to[0]);
        if (ahead && behind) bypassed++;
      }
    }
    const pressure = pressingIntensity(hero, run, e.frame, e.player);
    list.push({
      id: e.id,
      frame: e.frame,
      team,
      player: e.player,
      receiver: typeof e.attrs.receiver === "string" ? e.attrs.receiver : null,
      pressure,
      bypassed,
      completed,
      pressed: pressure >= PRESSED,
      scenario:
        hero.match?.possessions.find(
          (p) =>
            p.index === e.possession ||
            (e.possession === undefined && e.frame >= p.start && e.frame < p.start + p.frames),
        )?.scenario ?? (hero.kind === "hero" ? hero.scenario : null),
    });
  }
  const teams = [0, 1].map((team) => {
    const mine = list.filter((p) => p.team === team);
    const pressed = mine.filter((p) => p.pressed);
    const breaking = mine.filter((p) => p.completed && p.bypassed >= MIN_BYPASSED);
    return {
      team: team as Team,
      passes: mine.length,
      completed: mine.filter((p) => p.completed).length,
      pressured: pressed.length,
      completedPressured: pressed.filter((p) => p.completed).length,
      lineBreaking: breaking.length,
      lineBreakingPressured: breaking.filter((p) => p.pressed).length,
    };
  }) as [TeamBuildUp, TeamBuildUp];
  const candidates = list.filter((p) => p.completed && p.pressed && p.bypassed >= MIN_BYPASSED);
  candidates.sort(
    (a, b) =>
      Number(b.scenario === "press_escape") - Number(a.scenario === "press_escape") ||
      b.pressure - a.pressure ||
      b.bypassed - a.bypassed ||
      a.frame - b.frame,
  );
  return { teams, best: candidates[0] ?? null, list };
}

// ---------- counter-attack ----------

export interface CounterExample {
  team: Team;
  win: Regain;
  endFrame: number;
  endKind: "final_third" | "shot";
  seconds: number;
  passes: number;
  xtAdded: number;
  from: Vec2;
  to: Vec2;
}

function completedPasses(
  events: readonly ExportEvent[],
  team: Team,
  possession: number | null,
  from: number,
  to: number,
) {
  return events.filter((e) => {
    const end = num(e.attrs.end);
    return (
      e.type === "pass" &&
      (e.possession ?? null) === possession &&
      teamOf(e.player) === team &&
      e.attrs.outcome === "complete" &&
      e.frame > from &&
      end !== null &&
      end <= to
    );
  });
}

/** The fastest clear regain-to-attack sequence per regain, then the fastest in the run. */
export function counterAttack(
  hero: Hero,
  xt: XtGrid,
): { best: CounterExample | null; list: CounterExample[] } {
  const events = hero.runs.factual.events;
  const wins = regains(events);
  const list: CounterExample[] = [];
  for (const win of wins) {
    const limit = win.frame + COUNTER_WINDOW_S * FPS;
    let found: { frame: number; kind: CounterExample["endKind"]; at: Vec2 } | null = null;
    for (const e of events) {
      if (e.frame <= win.frame || e.frame > limit || (e.possession ?? null) !== win.possession)
        continue;
      if (e.type === "interception" || e.type === "tackle") break;
      if (teamOf(e.player) !== win.team) continue;
      if (e.type === "shot") {
        const at = point(e.attrs.start);
        if (at) found = { frame: e.frame, kind: "shot", at };
      } else if (!win.high && e.type === "pass" && e.attrs.outcome === "complete") {
        const at = point(e.attrs.end_at);
        const end = num(e.attrs.end);
        if (at && end !== null && end <= limit && forward(win.team, at[0]) > THIRD_START) {
          found = { frame: end, kind: "final_third", at };
        }
      }
      if (found) break;
    }
    if (!found) continue;
    const passes = completedPasses(events, win.team, win.possession, win.frame, found.frame);
    const gains = progression(events, win.team, xt).list;
    const ids = new Set(passes.map((e) => e.id));
    list.push({
      team: win.team,
      win,
      endFrame: found.frame,
      endKind: found.kind,
      seconds: (found.frame - win.frame) * hero.dt,
      passes: passes.length,
      xtAdded: gains.filter((g) => ids.has(g.id)).reduce((sum, g) => sum + g.xt, 0),
      from: win.at,
      to: found.at,
    });
  }
  list.sort((a, b) => a.seconds - b.seconds || b.xtAdded - a.xtAdded || a.win.frame - b.win.frame);
  return { best: list[0] ?? null, list };
}

// ---------- transition after losing the ball ----------

export interface TransitionExample {
  team: Team; // the attackers who won it
  losingTeam: Team;
  win: Regain;
  endFrame: number;
  seconds: number;
  lineTowardGoal: number; // m; positive: the losing back line retreated
  spaceAtLoss: number; // m from the back line to its own goal
  spaceAtEnd: number;
  xtStart: number;
  xtPeak: number;
  peakFrame: number;
  peakAt: Vec2;
}

function possessionEnd(hero: Hero, win: Regain): number {
  const p = hero.match?.possessions.find((q) => q.index === win.possession);
  return p
    ? Math.min(hero.runs.factual.frames - 1, p.start + p.frames - 1)
    : hero.runs.factual.frames - 1;
}

/** What a loss exposed before the next loss, the window's end, or the stitched cut. */
export function transitionAfterLoss(
  hero: Hero,
  xt: XtGrid,
): { best: TransitionExample | null; list: TransitionExample[] } {
  const run = hero.runs.factual;
  const wins = regains(run.events);
  const list: TransitionExample[] = [];
  for (const win of wins) {
    const next = wins.find((r) => r.frame > win.frame && r.possession === win.possession);
    const end = Math.min(
      possessionEnd(hero, win),
      win.frame + TRANSITION_WINDOW_S * FPS,
      next?.frame ?? Infinity,
    );
    if (end <= win.frame) continue;
    const losingTeam = (1 - win.team) as Team;
    const sign = attackSign(losingTeam);
    const line = (frame: number) =>
      Math.min(
        ...hero.players.flatMap((p, j) =>
          p.team === losingTeam && p.role !== "GK"
            ? [sign * playerPoint(run, hero.n, j, frame)[0]]
            : [],
        ),
      );
    const startLine = line(win.frame);
    const endLine = line(end);
    let xtPeak = -Infinity;
    let peakFrame = win.frame;
    let peakAt = win.at;
    for (let f = win.frame; f <= end; f++) {
      const at: Vec2 = [run.ball[f * 2], run.ball[f * 2 + 1]];
      const value = xtAt(xt, at, win.team);
      if (value > xtPeak) {
        xtPeak = value;
        peakFrame = f;
        peakAt = at;
      }
    }
    list.push({
      team: win.team,
      losingTeam,
      win,
      endFrame: end,
      seconds: (end - win.frame) * hero.dt,
      lineTowardGoal: startLine - endLine,
      spaceAtLoss: startLine + HALF_LENGTH,
      spaceAtEnd: endLine + HALF_LENGTH,
      xtStart: xtAt(xt, win.at, win.team),
      xtPeak,
      peakFrame,
      peakAt,
    });
  }
  list.sort(
    (a, b) => b.xtPeak - a.xtPeak || b.spaceAtLoss - a.spaceAtLoss || a.win.frame - b.win.frame,
  );
  return { best: list[0] ?? null, list };
}
