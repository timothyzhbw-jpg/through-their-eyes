// Live match stats in the viewer (SPEC 4.6, 7). The payload is analytics/live_stats.py
// `MatchStats` (GET /api/matches/<id>/stats?tracks=true). Totals at a frame are rebuilt from the
// tracks and the cues the way StatsTimeline.snapshot does: distances from the per-second
// checkpoints, everything else from cues whose value is already final.

import { z } from "zod";
import type { Persona } from "../api/client";
import { clubName } from "../data/roster";

const Parts = z.object({
  lane: z.number(),
  passer: z.number(),
  receiver: z.number(),
  distance: z.number(),
});

const CueBase = {
  id: z.string(),
  frame: z.number(),
  t: z.number(),
  possession: z.number().nullable(),
};

const PassCue = z.object({
  ...CueBase,
  kind: z.literal("pass"),
  kick: z.number(),
  player: z.string(),
  receiver: z.string().nullable(),
  outcome: z.enum(["complete", "intercepted", "out"]),
  distance_m: z.number(),
  ball_kmh: z.number(),
  difficulty: z.number(),
  band: z.string(),
  components: Parts,
});

const ShotCue = z.object({
  ...CueBase,
  kind: z.literal("shot"),
  kick: z.number(),
  player: z.string(),
  speed_kmh: z.number(),
});

const SprintCue = z.object({
  ...CueBase,
  kind: z.literal("sprint"),
  player: z.string(),
  start: z.number(),
  end: z.number(),
  peak_frame: z.number(),
  peak_kmh: z.number(),
  distance_m: z.number(),
});

const DistanceCue = z.object({
  ...CueBase,
  kind: z.literal("distance"),
  player: z.string(),
  metres: z.number(),
});

const CueSchema = z.discriminatedUnion("kind", [PassCue, ShotCue, SprintCue, DistanceCue]);

export const PlayerTotalsSchema = z.object({
  id: z.string(),
  team: z.number(),
  number: z.number(),
  role: z.string(),
  name: z.string(),
  short: z.string(),
  distance_m: z.number(),
  hsr_m: z.number(),
  sprint_m: z.number(),
  top_kmh: z.number(),
  sprints: z.number(),
  passes: z.number(),
  completed: z.number(),
  accuracy: z.number().nullable(),
  mean_difficulty: z.number().nullable(),
  shots: z.number(),
  top_shot_kmh: z.number().nullable(),
});
export type PlayerTotals = z.infer<typeof PlayerTotalsSchema>;

export const TeamTotalsSchema = z.object({
  team: z.number(),
  distance_m: z.number(),
  passes: z.number(),
  completed: z.number(),
  accuracy: z.number().nullable(),
  mean_difficulty: z.number().nullable(),
  shots: z.number(),
  top_shot_kmh: z.number().nullable(),
  top_kmh: z.number(),
});
export type TeamTotals = z.infer<typeof TeamTotalsSchema>;

const SpeedRun = z.object({
  player: z.string(),
  start: z.number(),
  kmh10: z.array(z.number()),
  sprint: z.array(z.tuple([z.number(), z.number()])), // [start, end) absolute frames
});
type SpeedRun = z.infer<typeof SpeedRun>;

const Tracks = z.object({
  every: z.number(),
  distance_dm: z.array(z.array(z.number())),
  hsr_dm: z.array(z.array(z.number())),
  sprint_dm: z.array(z.array(z.number())),
  top_kmh10: z.array(z.array(z.number())),
  ball_kmh10: z.array(z.number()),
  speed: z.array(SpeedRun),
});

const Definitions = z.object({
  hsr_kmh: z.number(),
  sprint_kmh: z.number(),
  sprint_min_s: z.number(),
  smooth_s: z.number(),
  release_s: z.number(),
  distance_step_m: z.number(),
  difficulty_weights: z.record(z.string(), z.number()),
  distance_scale_m: z.number(),
  lane_sigma_s: z.number(),
  reaction_s: z.number(),
  v_max_mps: z.number(),
  control_radius_m: z.number(),
  run_in_spread_m: z.number(),
  bands: z.array(z.tuple([z.number(), z.string()])),
  sources: z.array(z.string()),
});

/** analytics/live_stats.py MatchStats. `source` is always the measured feed, never a claim. */
export const MatchStatsSchema = z.object({
  version: z.number(),
  match: z.string(),
  kind: z.enum(["hero", "match"]),
  dt: z.number(),
  frames: z.number(),
  frame: z.number(),
  t: z.number(),
  source: z.literal("tracking"),
  definitions: Definitions,
  players: z.array(PlayerTotalsSchema),
  teams: z.array(TeamTotalsSchema),
  cues: z.array(CueSchema),
  tracks: Tracks.nullable(),
});
export type MatchStats = z.infer<typeof MatchStatsSchema>;
export type Cue = z.infer<typeof CueSchema>;

type PassCue = Extract<Cue, { kind: "pass" }>;
type ShotCue = Extract<Cue, { kind: "shot" }>;

/** Throws when `json` is not a MatchStats payload. */
export function parseStats(json: unknown): MatchStats {
  return MatchStatsSchema.parse(json);
}

/** `raw` plus the indexes the playhead lookups need. */
export interface Stats {
  raw: MatchStats;
  ids: string[];
  cues: Cue[]; // payload order, sorted by frame (stable)
  cueFrames: number[]; // parallel to `cues`, for the binary search
  players: Map<string, PlayerTotals>;
  speed: Map<string, SpeedRun[]>; // per player, sorted by start
}

/** Index a payload. Cues stay in payload order within one frame. */
export function prepare(raw: MatchStats): Stats {
  const cues = raw.cues.map((cue, i) => ({ cue, i }));
  cues.sort((a, b) => a.cue.frame - b.cue.frame || a.i - b.i);
  const speed = new Map<string, SpeedRun[]>();
  for (const run of raw.tracks?.speed ?? []) {
    const list = speed.get(run.player);
    if (list) list.push(run);
    else speed.set(run.player, [run]);
  }
  for (const list of speed.values()) list.sort((a, b) => a.start - b.start);
  return {
    raw,
    ids: raw.players.map((p) => p.id),
    cues: cues.map((x) => x.cue),
    cueFrames: cues.map((x) => x.cue.frame),
    players: new Map(raw.players.map((p) => [p.id, p])),
    speed,
  };
}

/** How many cues are final by `frame` (the slice end for `cuesUpTo`). */
function cueEnd(s: Stats, frame: number): number {
  const f = Math.floor(frame);
  const frames = s.cueFrames;
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid] <= f) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Cues with `frame <= floor(frame)`, in payload order. */
export function cuesUpTo(s: Stats, frame: number): Cue[] {
  return s.cues.slice(0, cueEnd(s, frame));
}

function tracksOf(s: Stats): NonNullable<MatchStats["tracks"]> {
  if (!s.raw.tracks) throw new Error("match stats have no tracks");
  return s.raw.tracks;
}

/** Checkpoint column for distances: one row per `every` frames, clamped to the payload. */
function checkpoint(s: Stats, frame: number): number {
  const rows = tracksOf(s).distance_dm.length;
  if (rows === 0) return 0;
  return Math.min(rows - 1, Math.max(0, Math.floor(Math.floor(frame) / 25)));
}

function roundTo(value: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Top speed so far: the checkpoint, then any faster sample after it up to `frame`. */
function topKmh(
  runs: SpeedRun[],
  atCheckpoint: number,
  checkpointFrame: number,
  frame: number,
): number {
  let top = atCheckpoint / 10;
  for (const run of runs) {
    const end = run.start + run.kmh10.length;
    const lo = Math.max(run.start, checkpointFrame + 1);
    const hi = Math.min(end, frame + 1);
    for (let f = lo; f < hi; f++) {
      const v = run.kmh10[f - run.start] / 10;
      if (v > top) top = v;
    }
  }
  return top;
}

/** Player and team totals at `frame`, as the API's snapshot at that frame. */
export function totalsAt(
  s: Stats,
  frame: number,
): { players: PlayerTotals[]; teams: TeamTotals[] } {
  const f = Math.floor(frame);
  const tr = tracksOf(s);
  const c = checkpoint(s, f);
  const cues = cuesUpTo(s, f);
  const players = s.raw.players.map((p, j) => {
    const passes = cues.filter((cue): cue is PassCue => cue.kind === "pass" && cue.player === p.id);
    const shots = cues.filter((cue): cue is ShotCue => cue.kind === "shot" && cue.player === p.id);
    const sprints = cues.filter((cue) => cue.kind === "sprint" && cue.player === p.id);
    const completed = passes.filter((cue) => cue.outcome === "complete").length;
    return {
      id: p.id,
      team: p.team,
      number: p.number,
      role: p.role,
      name: p.name,
      short: p.short,
      distance_m: (tr.distance_dm[c]?.[j] ?? 0) / 10,
      hsr_m: (tr.hsr_dm[c]?.[j] ?? 0) / 10,
      sprint_m: (tr.sprint_dm[c]?.[j] ?? 0) / 10,
      top_kmh: topKmh(s.speed.get(p.id) ?? [], tr.top_kmh10[c]?.[j] ?? 0, c * 25, f),
      sprints: sprints.length,
      passes: passes.length,
      completed,
      accuracy: passes.length ? roundTo(completed / passes.length, 4) : null,
      mean_difficulty: passes.length ? roundTo(mean(passes.map((cue) => cue.difficulty)), 2) : null,
      shots: shots.length,
      top_shot_kmh: shots.length ? Math.max(...shots.map((cue) => cue.speed_kmh)) : null,
    };
  });
  const teams = [0, 1].map((side) => {
    const mine = players.filter((p) => p.team === side);
    const ids = new Set(mine.map((p) => p.id));
    const passes = cues.filter((cue): cue is PassCue => cue.kind === "pass" && ids.has(cue.player));
    const shots = cues.filter((cue): cue is ShotCue => cue.kind === "shot" && ids.has(cue.player));
    const completed = passes.filter((cue) => cue.outcome === "complete").length;
    return {
      team: side,
      distance_m: mine.reduce((sum, p) => sum + p.distance_m, 0),
      passes: passes.length,
      completed,
      accuracy: passes.length ? roundTo(completed / passes.length, 4) : null,
      mean_difficulty: passes.length ? roundTo(mean(passes.map((cue) => cue.difficulty)), 2) : null,
      shots: shots.length,
      top_shot_kmh: shots.length ? Math.max(...shots.map((cue) => cue.speed_kmh)) : null,
      top_kmh: mine.reduce((top, p) => Math.max(top, p.top_kmh), 0),
    };
  });
  return { players, teams };
}

/** The run above 19.8 km/h that contains `frame`, if any. Runs are sorted and do not overlap. */
function runAt(runs: SpeedRun[], frame: number): SpeedRun | null {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const run = runs[mid];
    if (frame < run.start) hi = mid - 1;
    else if (frame >= run.start + run.kmh10.length) lo = mid + 1;
    else return run;
  }
  return null;
}

/** Smoothed speed (km/h) when `frame` is inside a run above 19.8 km/h, else null. */
export function speedKmh(s: Stats, playerId: string, frame: number): number | null {
  const f = Math.floor(frame);
  const run = runAt(s.speed.get(playerId) ?? [], f);
  return run ? run.kmh10[f - run.start] / 10 : null;
}

/** Speed once `frame` has sat inside a stretch above 25.2 km/h for 0.4 s (10 frames). */
export function sprintKmh(s: Stats, playerId: string, frame: number): number | null {
  const f = Math.floor(frame);
  const run = runAt(s.speed.get(playerId) ?? [], f);
  if (!run) return null;
  for (const [a, b] of run.sprint) {
    if (f >= a && f < b && f - a >= 9) return run.kmh10[f - run.start] / 10;
  }
  return null;
}

/** Smoothed ball speed (km/h) at `frame`, clamped to the track. */
export function ballKmh(s: Stats, frame: number): number {
  const series = s.raw.tracks?.ball_kmh10 ?? [];
  if (series.length === 0) return 0;
  let i = Math.floor(frame);
  if (i < 0) i = 0;
  else if (i >= series.length) i = series.length - 1;
  return series[i] / 10;
}

export type Audience = "table" | "headlines" | "player";

/** Which block of the panel a persona sees. The viewer menu sets the persona. */
export function audienceOf(persona: Persona): Audience {
  if (persona === "analyst" || persona === "coach") return "table";
  if (persona === "player_fan") return "player";
  return "headlines";
}

export interface Headline {
  key: string;
  label: string;
  value: string;
  who: string;
  detail?: string;
}

const DASH = "–";

function who(p: PlayerTotals): string {
  return `${p.short} (${p.number})`;
}

function percent(accuracy: number | null): string {
  return accuracy === null ? DASH : `${Math.round(accuracy * 100)}%`;
}

/** At most three lines known by `frame`. `ratings: false` skips pass difficulty (audio description). */
export function headlines(
  s: Stats,
  frame: number,
  opts: { ratings?: boolean } = { ratings: true },
): Headline[] {
  const ratings = opts.ratings !== false;
  const totals = totalsAt(s, frame);
  const cues = cuesUpTo(s, frame);
  const lines: Headline[] = [];
  const fastest = totals.players.reduce((a, b) => (b.top_kmh > a.top_kmh ? b : a));
  lines.push({
    key: "top_speed",
    label: "Top speed",
    value: `${fastest.top_kmh.toFixed(1)} km/h`,
    who: who(fastest),
  });
  const passes = cues.filter((c): c is PassCue => c.kind === "pass");
  if (passes.length) {
    lines.push({
      key: "pass_accuracy",
      label: "Pass accuracy",
      value: `${clubName(0)} ${percent(totals.teams[0]?.accuracy ?? null)} · ${clubName(1)} ${percent(totals.teams[1]?.accuracy ?? null)}`,
      who: "",
    });
  }
  const shots = cues.filter((c): c is ShotCue => c.kind === "shot");
  if (shots.length) {
    const best = shots.reduce((a, b) => (b.speed_kmh > a.speed_kmh ? b : a));
    const shooter = s.players.get(best.player);
    lines.push({
      key: "fastest_shot",
      label: "Fastest shot",
      value: `${best.speed_kmh.toFixed(1)} km/h`,
      who: shooter ? who(shooter) : best.player,
    });
  } else if (ratings) {
    const done = passes.filter((c) => c.outcome === "complete");
    if (done.length) {
      const best = done.reduce((a, b) => (b.difficulty > a.difficulty ? b : a));
      const passer = s.players.get(best.player);
      const receiver = best.receiver ? s.players.get(best.receiver) : undefined;
      lines.push({
        key: "hardest_pass",
        label: "Hardest pass",
        value: `${best.difficulty.toFixed(2)} ${best.band}`,
        who: `${passer?.short ?? best.player} → ${receiver?.short ?? best.receiver ?? DASH}`,
      });
    }
  } else if (passes.length) {
    const best = passes.reduce((a, b) => (b.distance_m > a.distance_m ? b : a));
    const passer = s.players.get(best.player);
    lines.push({
      key: "longest_pass",
      label: "Longest pass",
      value: `${Math.round(best.distance_m)} m`,
      who: passer ? who(passer) : best.player,
    });
  }
  return lines.slice(0, 3);
}

const TAG_FRAMES = 50; // the longest a cue's tag stays: 2 s at 25 Hz

export type StatTagKind = "name" | "sprint" | "distance" | "pass" | "shot";

export interface StatTag {
  player: string; // player id
  kind: StatTagKind;
  label: string;
  text: string;
}

/** The surname in a short name ("J. Ferriday" → "FERRIDAY"). */
function surname(short: string): string {
  const cut = short.indexOf(". ");
  return (cut >= 0 ? short.slice(cut + 2) : short).toUpperCase();
}

function fresh(frame: number, cueFrame: number, window: number): boolean {
  const age = frame - cueFrame;
  return age >= 0 && age < window;
}

/** In-view tags at `frame`. `owner` indexes `raw.players` (the ball carrier); negative: none. */
export function statTags(s: Stats, frame: number, owner: number): StatTag[] {
  const f = Math.floor(frame);
  // Only cues from the last 2 s can still be on screen (TAG_FRAMES); this runs every frame.
  const recent = s.cues.slice(cueEnd(s, f - TAG_FRAMES), cueEnd(s, f));
  const tags: StatTag[] = [];
  if (owner >= 0 && owner < s.raw.players.length) {
    const p = s.raw.players[owner];
    tags.push({ player: p.id, kind: "name", label: String(p.number), text: surname(p.short) });
  }
  for (const p of s.raw.players) {
    const kmh = sprintKmh(s, p.id, f);
    if (kmh !== null) {
      tags.push({
        player: p.id,
        kind: "sprint",
        label: "SPRINT",
        text: `${p.short} ${kmh.toFixed(1)} km/h`,
      });
    }
  }
  for (const cue of recent) {
    if (
      cue.kind === "pass" &&
      cue.outcome === "complete" &&
      cue.receiver &&
      fresh(f, cue.frame, 38)
    ) {
      tags.push({
        player: cue.receiver,
        kind: "pass",
        label: "PASS",
        text: `${Math.round(cue.distance_m)} m · ${cue.band}`,
      });
    }
  }
  for (const cue of recent) {
    if (cue.kind === "distance" && fresh(f, cue.frame, 50)) {
      const p = s.players.get(cue.player);
      tags.push({
        player: cue.player,
        kind: "distance",
        label: `${cue.metres} M`,
        text: p?.short ?? cue.player,
      });
    }
  }
  for (const cue of recent) {
    if (cue.kind === "shot" && fresh(f, cue.frame, 50)) {
      const p = s.players.get(cue.player);
      tags.push({
        player: cue.player,
        kind: "shot",
        label: "SHOT",
        text: `${p?.short ?? cue.player} ${cue.speed_kmh.toFixed(1)} km/h`,
      });
    }
  }
  return tags;
}
