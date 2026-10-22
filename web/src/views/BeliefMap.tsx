// His live belief map (SPEC 7; teammates' feedback 2026-10-21): the disc in the corner beside his
// eyes shows where the player whose eyes these are believes everyone is (the export's ghost
// positions), frame by frame, so each scan visibly corrects his picture. It is drawn around him,
// attacking up; a player beyond its reach sits on its rim, toward where he is. Red: the defenders nearest the ball carrier in his belief (two or three, within
// PRESS_RADIUS_M). Green: his likeliest receivers at his decision, as he weighed them (pass
// options with at least LIKELY_MIN_PROB, at most three): with the look H9, without it H4 and
// others. Everyone else is neutral; a player out of his sight right now is drawn as remembered.
// Read from the sim export, not a verified claim, and labelled so.

import { useMemo } from "react";
import type { Camera3D } from "../store/playback";
import { isSeen, type Hero } from "../data/hero";
import type { RunName } from "../data/types";
import { useView, type ViewSession } from "../session";
import { useStore } from "../store/store";
import { FIELD, LAW1 } from "./fieldMarkings";
import "./beliefMap.css";

export const DISC_RADIUS_M = 32; // how far around him the disc reaches
export const PRESS_RADIUS_M = 25; // a defender farther than this from the carrier is not pressing
export const PRESS_MAX = 3;
export const LIKELY_MIN_PROB = 0.05; // a pass option he gave less than this is not "likely"
export const LIKELY_MAX = 3;

const SIZE = 168; // svg units: the disc's diameter
const SCALE = SIZE / 2 / DISC_RADIUS_M;

export type BeliefRole = "press" | "option" | "other";

export interface BelievedPlayer {
  id: string;
  team: number;
  x: number; // m, where he believes the player is
  y: number;
  seen: boolean; // in his sight at this frame
  role: BeliefRole;
}

export interface Belief {
  me: { x: number; y: number; head: number }; // where he is, and his head yaw (rad)
  carrier: string;
  players: BelievedPlayer[]; // everyone but him
  ball: { x: number; y: number };
  /** Pitch metres to disc units, attacking up, him at the centre. */
  toDisc(x: number, y: number): { x: number; y: number };
}

/** His team's attacking direction along x: home attacks +x (SPEC 3.1). */
function attackSign(hero: Hero, j: number): number {
  return hero.players[j].team === 0 ? 1 : -1;
}

/** His likeliest receivers at his decision, as he weighed them on his belief. */
function likelyReceivers(hero: Hero, mode: RunName): string[] {
  const options = hero.runs[mode].decision?.options ?? [];
  return [...options]
    .filter((o) => o.action.startsWith("pass:") && o.prob >= LIKELY_MIN_PROB)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, LIKELY_MAX)
    .map((o) => o.action.slice("pass:".length));
}

/** His belief at frame `f` (rounded: the belief changes at sightings, not between frames). */
export function beliefAt(hero: Hero, mode: RunName, f: number): Belief | null {
  const me = hero.heroId ? hero.ids.indexOf(hero.heroId) : -1;
  if (me < 0) return null;
  const run = hero.runs[mode];
  const n = hero.n;
  const frame = Math.max(0, Math.min(run.frames - 1, Math.round(f)));
  const at = (arr: Float32Array, j: number) => ({
    x: arr[(frame * n + j) * 2],
    y: arr[(frame * n + j) * 2 + 1],
  });
  const mine = at(run.pos, me);
  const owner = run.owner[frame];
  const carrier = owner >= 0 ? owner : me;
  const where = (j: number) => (j === me ? mine : at(run.ghost, j));
  const team = hero.players[me].team;
  const c = where(carrier);
  const dist = (j: number) => {
    const p = where(j);
    return Math.hypot(p.x - c.x, p.y - c.y);
  };
  const opponents = hero.players
    .map((p, j) => ({ p, j }))
    .filter(({ p }) => p.team !== hero.players[carrier].team)
    .map(({ j }) => j)
    .sort((a, b) => dist(a) - dist(b));
  const press = new Set(opponents.slice(0, PRESS_MAX).filter((j) => dist(j) <= PRESS_RADIUS_M));
  const likely = new Set(likelyReceivers(hero, mode));
  const sign = attackSign(hero, me);
  const players = hero.players.flatMap((p, j): BelievedPlayer[] => {
    if (j === me) return [];
    const pos = at(run.ghost, j);
    const role: BeliefRole = press.has(j)
      ? "press"
      : p.team === team && likely.has(p.id)
        ? "option"
        : "other";
    return [{ id: p.id, team: p.team, ...pos, seen: isSeen(hero, run, frame, me, j), role }];
  });
  // Attacking up: ahead (+x for home) is up, his left (+y for home) is left.
  const toDisc = (x: number, y: number) => ({
    x: SIZE / 2 - (y - mine.y) * sign * SCALE,
    y: SIZE / 2 - (x - mine.x) * sign * SCALE,
  });
  return {
    me: { ...mine, head: run.head[frame * n + me] },
    carrier: hero.ids[carrier],
    players,
    ball: { x: run.ball[frame * 2], y: run.ball[frame * 2 + 1] },
    toDisc,
  };
}

/** The picture in picture beside his eyes is his belief map on a hero moment; else the board. */
export function beliefPip(session: ViewSession, camera: Camera3D): boolean {
  return session.kind === "hero" && !!session.hero.heroId && camera === "pov";
}

const HALF_L = 52.5;
const HALF_W = 34;

export function BeliefMap() {
  const { hero, playback } = useView();
  const mode = useStore(playback, (s) => s.mode);
  const frame = useStore(playback, (s) => Math.round(s.frame));
  const b = useMemo(() => beliefAt(hero, mode, frame), [hero, mode, frame]);
  if (!b) return null;
  const sign = attackSign(hero, hero.ids.indexOf(hero.heroId!));
  const p = (x: number, y: number) => b.toDisc(x, y);
  // The pitch's outline, halfway line and boxes, clipped to the disc.
  const line = (x1: number, y1: number, x2: number, y2: number, k: string) => {
    const a = p(x1, y1);
    const z = p(x2, y2);
    return <line key={k} className="pitch-line" x1={a.x} y1={a.y} x2={z.x} y2={z.y} />;
  };
  const box = (s: number, depth: number, half: number, k: string) => [
    line(s * HALF_L, -half, s * (HALF_L - depth), -half, `${k}a`),
    line(s * (HALF_L - depth), -half, s * (HALF_L - depth), half, `${k}b`),
    line(s * (HALF_L - depth), half, s * HALF_L, half, `${k}c`),
  ];
  const me = p(b.me.x, b.me.y);
  // Beyond the disc, a player is pinned to its rim, toward where he is: the runner he has to find
  // is often 25-30 m away.
  const rim = SIZE / 2 - 6;
  const onDisc = (q: { x: number; y: number }) => {
    const dx = q.x - me.x;
    const dy = q.y - me.y;
    const r = Math.hypot(dx, dy);
    return r <= rim
      ? { ...q, rim: false }
      : { x: me.x + (dx * rim) / r, y: me.y + (dy * rim) / r, rim: true };
  };
  // His head, as a short line from his dot (world yaw: anticlockwise from +x).
  const look = p(b.me.x + 6 * Math.cos(b.me.head), b.me.y + 6 * Math.sin(b.me.head));
  const ball = p(b.ball.x, b.ball.y);
  const press = b.players.filter((q) => q.role === "press").length;
  const options = b.players.filter((q) => q.role === "option").map((q) => q.id);
  const label =
    `${hero.heroId}'s picture of the pitch: ${press} defenders closing on ${b.carrier}` +
    (options.length ? `; his likeliest passes: ${options.join(", ")}` : "");
  return (
    <div className="belief-map">
      <p className="belief-title">
        His picture{" "}
        <span className="source" title="Read from the sim export, not a verified claim">
          sim
        </span>
      </p>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
        <defs>
          <clipPath id="belief-disc">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} />
          </clipPath>
        </defs>
        <circle className="disc" cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} />
        <g clipPath="url(#belief-disc)">
          {line(-HALF_L, -HALF_W, HALF_L, -HALF_W, "t1")}
          {line(-HALF_L, HALF_W, HALF_L, HALF_W, "t2")}
          {line(-HALF_L, -HALF_W, -HALF_L, HALF_W, "g1")}
          {line(HALF_L, -HALF_W, HALF_L, HALF_W, "g2")}
          {line(0, -HALF_W, 0, HALF_W, "half")}
          {box(sign, LAW1.penaltyAreaDepth, FIELD.penaltyAreaHalfWidth, "pa")}
          {box(-sign, LAW1.penaltyAreaDepth, FIELD.penaltyAreaHalfWidth, "pb")}
          {b.players.map((q) => {
            const s = onDisc(p(q.x, q.y));
            return (
              <circle
                key={q.id}
                className={[
                  "token",
                  s.rim ? "rim" : "",
                  q.role,
                  q.team === hero.players[hero.ids.indexOf(hero.heroId!)].team ? "mate" : "opp",
                  q.seen ? "seen" : "remembered",
                ].join(" ")}
                cx={s.x}
                cy={s.y}
                r={s.rim ? 3.6 : 4.6}
              >
                <title>{q.id}</title>
              </circle>
            );
          })}
          <circle className="ball" cx={ball.x} cy={ball.y} r={2.4} />
          <line className="look" x1={me.x} y1={me.y} x2={look.x} y2={look.y} />
          <circle className="me" cx={me.x} cy={me.y} r={5.4} />
        </g>
      </svg>
      <p className="belief-legend" aria-hidden="true">
        <i className="press" /> Closing in <i className="option" /> His options
      </p>
    </div>
  );
}
