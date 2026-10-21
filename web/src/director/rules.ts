// The camera director's rules: which camera is worth switching to at a frame, and why, from what
// the viewer's client knows by then: the events and moments the live stream has sent (or, in a
// replay, the run's own up to the playhead) and the frame's blind-side alerts. The viewer picks
// the camera; the director only suggests, unless the viewer turns on the auto director (pick.ts).
//
// Deterministic rules over stream events, no model: the same events give the same suggestions.
// Reasons are templates over player ids, with no numbers: nothing on screen needs verifying.
// A pass event carries its intended target (`to`) and the frame the ball arrives (`end`), as
// the stream sends it (api/live.py replays the recorded match); the outcome is never used.
//
// The rules, highest priority first:
//   breakdown  the hero moment was detected: watch its breakdown, for MOMENT_HOLD_S. First, so a
//              routine pass does not push it off in a match (the auto director never takes it).
//   incoming   a pass is played toward a player: his eyes, raised when he looks over his
//              shoulder before the ball arrives, or has lost sight of someone on his blind side.
//              Shown only while the ball is at least LEAD_S away (pick.ts).
//   carrier    a player has just received the ball: his eyes, for CARRY_S.
//   blind_side a defender has lost sight of an attacker on his blind side: the tactical board.
//   turnover   the ball was won: the broadcast camera, for TURNOVER_S.
//   replay     another moment with a lens was detected: replay it with its lens's camera (the scan
//              lens through the actor's eyes; pressure and space on the tactical board).

import type { Hero, Run } from "../data/hero";
import type { ExportEvent } from "../data/types";
import type { LiveMoment } from "../live/feed";

/** A camera the director can suggest. */
export type Shot =
  { camera: "pov"; player: string } | { camera: "tactical" } | { camera: "broadcast" };

export type Rule = "incoming" | "breakdown" | "carrier" | "blind_side" | "turnover" | "replay";

/** What taking the suggestion does: cut to its shot, open the breakdown, or replay the moment. */
export type Action = "cut" | "breakdown" | "replay";

export interface Suggestion {
  id: string; // stable while the reason lasts: the event or alert behind it
  rule: Rule;
  priority: number; // higher wins
  rank: number; // among equal priorities, higher first (newer, or unseen for longer)
  title: string; // what the chip does: "Switch to H8's eyes"
  reason: string; // why, in plain words: "the ball is coming to him."
  shot: Shot | null; // null: the breakdown, which directs itself
  action: Action;
  moment: LiveMoment | null; // the moment of a breakdown or a replay
  arrival: number | null; // frame the ball arrives, for a pass: shown only well before it
  auto: boolean; // the auto director may take it (camera cuts only)
}

/** A moment the stream has announced (at its `frame_end`); `breakdown`: it opens one here. */
export interface Announced {
  card: LiveMoment;
  breakdown: boolean;
}

/** What the client knows. Events in frame order; the rules read those up to the frame asked. */
export interface Knowledge {
  dt: number;
  teams: ReadonlyMap<string, number>; // player id -> team (0 home, 1 away)
  events: readonly ExportEvent[];
  alerts(frame: number): readonly (readonly [string, string, number])[]; // [observer, target, unseen s]
  moments: readonly Announced[];
}

export const LEAD_S = 0.5; // a pass suggestion shows at least this long before the ball arrives (1x)
export const CARRY_S = 1.2; // a reception keeps the receiver's eyes suggested this long
export const TURNOVER_S = 2; // the broadcast camera after the ball is won
export const MOMENT_HOLD_S = 8; // a detected moment's breakdown or replay stays suggested this long
export const MIN_SHOT_S = 2; // the auto director's shortest shot (wall clock)
const LOOKBACK_S = 8; // the latest pass or ball event is looked for this far back
const OVER_SHOULDER = Math.PI / 2; // a scan this far from the ball looks over the shoulder

export const PRIORITY: Record<Rule | "incoming_blind" | "incoming_scan", number> = {
  breakdown: 70,
  incoming_scan: 60,
  incoming_blind: 55,
  incoming: 50,
  carrier: 40,
  blind_side: 30,
  turnover: 25,
  replay: 20,
};

/** Events that move the ball between players; the latest one says who has it. */
const BALL = new Set(["pass", "reception", "interception", "possession_change"]);
const TURNOVER = new Set(["interception", "possession_change"]);

const MOMENT_KIND: Record<string, string> = {
  decision_after_scan: "decision after a scan",
  pressed_decision: "decision under pressure",
  line_breaking_pass: "line-breaking pass",
};

const eyes = (player: string) => `Switch to ${player}'s eyes`;
const frames = (k: Knowledge, s: number) => Math.round(s / k.dt);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** How many known events are at or before frame `f` (events are in frame order). */
function known(events: readonly ExportEvent[], f: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].frame <= f) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The latest event that moves the ball, at or before `f` (within LOOKBACK_S); its index. */
function lastBall(k: Knowledge, n: number, f: number): number {
  const oldest = f - frames(k, LOOKBACK_S);
  for (let i = n - 1; i >= 0 && k.events[i].frame >= oldest; i--) {
    if (BALL.has(k.events[i].type)) return i;
  }
  return -1;
}

function incoming(k: Knowledge, n: number, f: number, passAt: number): Suggestion | null {
  const pass = k.events[passAt];
  const to = typeof pass.attrs.to === "string" ? pass.attrs.to : null;
  const end = num(pass.attrs.end);
  if (!to || to === pass.player || end === null || f >= end) return null;
  // His scan that overlaps the flight and has begun by now: the latest one.
  let look: ExportEvent | null = null;
  const oldest = pass.frame - frames(k, LOOKBACK_S);
  for (let i = n - 1; i >= 0 && k.events[i].frame >= oldest; i--) {
    const e = k.events[i];
    if (e.type === "scan" && e.player === to && (num(e.attrs.end) ?? -1) >= pass.frame) {
      look = e;
      break;
    }
  }
  const base = {
    id: `incoming:${pass.id}`,
    rule: "incoming" as const,
    rank: pass.frame,
    title: eyes(to),
    shot: { camera: "pov" as const, player: to },
    action: "cut" as const,
    moment: null,
    arrival: end,
    auto: true,
  };
  if (look) {
    const shoulder = (num(look.attrs.amplitude) ?? 0) >= OVER_SHOULDER;
    return {
      ...base,
      priority: PRIORITY.incoming_scan,
      reason: shoulder
        ? "he checks over his shoulder before the ball arrives."
        : "he looks around before the ball arrives.",
    };
  }
  const blind = [...k.alerts(f)].filter(([o]) => o === to).sort((a, b) => b[2] - a[2])[0];
  if (blind) {
    return {
      ...base,
      priority: PRIORITY.incoming_blind,
      reason: `the ball is coming to him, and ${blind[1]} is on his blind side.`,
    };
  }
  return { ...base, priority: PRIORITY.incoming, reason: "the ball is coming to him." };
}

/** The team on the ball: the team of whoever played, received or won it last. */
function teamOnBall(k: Knowledge, ball: number): number | null {
  if (ball < 0) return null;
  return k.teams.get(k.events[ball].player) ?? null;
}

function blindSide(k: Knowledge, f: number, attacking: number | null): Suggestion[] {
  if (attacking === null) return [];
  return k
    .alerts(f)
    .filter(([o, t]) => k.teams.get(o) !== attacking && k.teams.get(t) === attacking)
    .map(([observer, target, unseen]) => ({
      id: `blind_side:${observer}:${target}`,
      rule: "blind_side",
      priority: PRIORITY.blind_side,
      rank: unseen,
      title: "Switch to the tactical board",
      reason: `${observer} has lost sight of ${target} on his blind side.`,
      shot: { camera: "tactical" },
      action: "cut",
      moment: null,
      arrival: null,
      auto: true,
    }));
}

function momentLine(card: LiveMoment): string {
  const kind = MOMENT_KIND[card.kind] ?? card.kind.replaceAll("_", " ");
  return card.actor
    ? `a moment was detected, ${card.actor}'s ${kind}.`
    : `a moment was detected, a ${kind}.`;
}

function moment(k: Knowledge, f: number, m: Announced): Suggestion | null {
  const { card } = m;
  if (f < card.frame_end || f >= card.frame_end + frames(k, MOMENT_HOLD_S)) return null;
  const common = {
    id: `moment:${card.id}`,
    rank: card.frame_end,
    reason: momentLine(card),
    moment: card,
    arrival: null,
    auto: false,
  };
  if (m.breakdown) {
    return {
      ...common,
      rule: "breakdown",
      priority: PRIORITY.breakdown,
      title: "Watch the breakdown",
      shot: null,
      action: "breakdown",
    };
  }
  const lens = card.selected_lens;
  if (lens === "scan" && card.actor) {
    return {
      ...common,
      rule: "replay",
      priority: PRIORITY.replay,
      title: `Replay through ${card.actor}'s eyes`,
      shot: { camera: "pov", player: card.actor },
      action: "replay",
    };
  }
  if (lens === "pressure" || lens === "space") {
    return {
      ...common,
      rule: "replay",
      priority: PRIORITY.replay,
      title: "Replay on the tactical board",
      shot: { camera: "tactical" },
      action: "replay",
    };
  }
  return null; // live-only moments (sprints) and moments without a lens
}

/** Every suggestion that holds at frame `f`, in no particular order (pick.ts ranks them). */
export function candidates(k: Knowledge, f: number): Suggestion[] {
  const out: Suggestion[] = [];
  const n = known(k.events, f);
  const ball = lastBall(k, n, f);
  const last = ball >= 0 ? k.events[ball] : null;
  if (last?.type === "pass") {
    const s = incoming(k, n, f, ball);
    if (s) out.push(s);
  } else if (last?.type === "reception" && f < last.frame + frames(k, CARRY_S)) {
    out.push({
      id: `carrier:${last.id}`,
      rule: "carrier",
      priority: PRIORITY.carrier,
      rank: last.frame,
      title: eyes(last.player),
      reason: "he has just received the ball.",
      shot: { camera: "pov", player: last.player },
      action: "cut",
      moment: null,
      arrival: null,
      auto: true,
    });
  } else if (last && TURNOVER.has(last.type) && f < last.frame + frames(k, TURNOVER_S)) {
    out.push({
      id: `turnover:${last.player}:${last.frame}`,
      rule: "turnover",
      priority: PRIORITY.turnover,
      rank: last.frame,
      title: "Switch to the broadcast camera",
      reason: `${last.player} has won the ball.`,
      shot: { camera: "broadcast" },
      action: "cut",
      moment: null,
      arrival: null,
      auto: true,
    });
  }
  out.push(...blindSide(k, f, teamOnBall(k, ball)));
  for (const m of k.moments) {
    const s = moment(k, f, m);
    if (s) out.push(s);
  }
  return out;
}

/** What a run on screen tells the director: its events, its blind-side alerts, the moments. */
export function runKnowledge(hero: Hero, run: Run, moments: readonly Announced[]): Knowledge {
  return eventKnowledge(hero, run, run.events, moments);
}

/** Like runKnowledge, with the events from somewhere else (the live stream's). `teams`: the
 * hero's player id -> team map, when the caller keeps one. */
export function eventKnowledge(
  hero: Hero,
  run: Run,
  events: readonly ExportEvent[],
  moments: readonly Announced[],
  teams: ReadonlyMap<string, number> = new Map(hero.players.map((p) => [p.id, p.team] as const)),
): Knowledge {
  // The rules ask for the same frame's alerts several times: keep the last one.
  let last = -1;
  let alerts: readonly (readonly [string, string, number])[] = [];
  return {
    dt: hero.dt,
    teams,
    events,
    alerts(f) {
      const i = Math.max(0, Math.min(run.frames - 1, Math.floor(f)));
      if (i !== last) {
        alerts = (run.blindSide.frames[i] ?? [])
          .filter(([, , unseen]) => unseen > 0)
          .map(([o, t, unseen]) => [hero.ids[o], hero.ids[t], unseen * hero.dt] as const);
        last = i;
      }
      return alerts;
    },
    moments,
  };
}
