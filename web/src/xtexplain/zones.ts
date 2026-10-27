// Expected threat (xT), told concretely per audience (SPEC 4.5, 7; teammate feedback 2026-10-23:
// "too abstract"). Pure logic, no React: which zone the ball moved from and to, named as a
// coach would name it, and the two versions of the sentence.
//
// - concrete (analyst, coach): the zones by name, the value at each end and the difference. The
//   grid export holds one value per cell (units 1e-4) and nothing else, so the text speaks of the
//   zone's value and makes no claim about its shot, goal or move parts.
// - plain (casual fan and the others): one sentence in everyday words, no jargon, no digit.
//
// Every digit comes from a value passed in: the grid's cells (xtAt) or a verified claim.
// The band and lane names are explain/functions.py's (BANDS, LANES), so a zone named here agrees
// with the pass_zones claim that names the same place.

import type { Persona } from "../api/client";
import type { Vec2 } from "../data/types";
import {
  HALF_LENGTH,
  PITCH_L,
  PITCH_W,
  attackSign,
  xtAt,
  type Team,
  type XtGrid,
} from "../tacticslab/metrics";

/** The xT grid's size: analytics/xt_grid.json "shape". */
export const GRID = { cols: 16, rows: 12 };

export type Band = "own_third" | "own_half" | "opponents_half" | "final_third";
export type Lane = "right_wing" | "right_of_centre" | "centre" | "left_of_centre" | "left_wing";

const THIRD = PITCH_L / 6; // 17.5 m either side of the halfway line
const LANE = PITCH_W / 10; // 6.8 m: half a lane's width

export interface Zone {
  band: Band;
  lane: Lane;
  col: number; // the xT grid cell: column along x from the own goal line
  row: number; // row along y, in the attacking frame
}

const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));

/** The zone of a point for `team`, in the frame where the team attacks +x (right is y < 0). */
export function zoneAt(p: Vec2, team: Team, grid: Pick<XtGrid, "cols" | "rows">): Zone {
  const s = attackSign(team);
  const [x, y] = [s * p[0], s * p[1]];
  const band: Band =
    x < -THIRD ? "own_third" : x < 0 ? "own_half" : x < THIRD ? "opponents_half" : "final_third";
  const lane: Lane =
    y < -3 * LANE
      ? "right_wing"
      : y < -LANE
        ? "right_of_centre"
        : y <= LANE
          ? "centre"
          : y <= 3 * LANE
            ? "left_of_centre"
            : "left_wing";
  return {
    band,
    lane,
    col: Math.floor(clamp(((x + HALF_LENGTH) / PITCH_L) * grid.cols, grid.cols - 1)),
    row: Math.floor(clamp(((y + PITCH_W / 2) / PITCH_W) * grid.rows, grid.rows - 1)),
  };
}

const BAND_RANK: Record<Band, number> = {
  own_third: 0,
  own_half: 1,
  opponents_half: 2,
  final_third: 3,
};

/** Who the zones belong to: "his" in a hero moment, "their" for a team. */
export type Owner = "his" | "their";

const LANE_NAME: Record<Lane, string> = {
  right_wing: "right wing",
  right_of_centre: "right half-space",
  centre: "central",
  left_of_centre: "left half-space",
  left_wing: "left wing",
};

/** "his own half, central": the zone named plainly (analyst version). */
export function zoneName(z: Zone, owner: Owner): string {
  const band =
    z.band === "own_third"
      ? `${owner} own third`
      : z.band === "own_half"
        ? `${owner} own half`
        : z.band === "opponents_half"
          ? "the opponents' half"
          : "the attacking third";
  return `${band}, ${LANE_NAME[z.lane]}`;
}

// ---------- a move ----------

export interface Leg {
  at: Vec2;
  zone: Zone;
  xt: number | null; // the value there: the grid's, or a verified claim's; null when not known
}

/**
 * Where the ball went, and what it was worth. `pass`: kicked from `from`, received at `to`.
 * `runs`: where the ball ended without the look (`from`) and with it (`to`).
 */
export interface Move {
  mode: "pass" | "runs";
  team: Team;
  from: Leg;
  to: Leg;
  /** The difference, as the source gives it: the two ends' values, or a claim's. */
  delta: number | null;
  deltaDigits: number;
  label?: string;
}

export interface MoveInput {
  mode: Move["mode"];
  team: Team;
  from: Vec2;
  to: Vec2;
  grid?: XtGrid | null;
  /** A verified claim's value for the end, used instead of the grid's. */
  toXt?: number | null;
  /** A verified claim's difference (cf_value), used instead of the two values'. */
  delta?: number | null;
  deltaDigits?: number;
  label?: string;
}

export function moveOf(input: MoveInput): Move {
  const size = input.grid ?? GRID;
  const value = (p: Vec2) => (input.grid ? xtAt(input.grid, p, input.team) : null);
  const from: Leg = {
    at: input.from,
    zone: zoneAt(input.from, input.team, size),
    xt: value(input.from),
  };
  const to: Leg = {
    at: input.to,
    zone: zoneAt(input.to, input.team, size),
    xt: input.toXt ?? value(input.to),
  };
  const delta = input.delta ?? (from.xt !== null && to.xt !== null ? to.xt - from.xt : null);
  return {
    mode: input.mode,
    team: input.team,
    from,
    to,
    delta,
    deltaDigits: input.deltaDigits ?? 3,
    label: input.label,
  };
}

// ---------- the concrete version ----------

const MINUS = "−";
const signed = (v: number, digits: number) => {
  const text = Math.abs(v).toFixed(digits);
  return Number(text) === 0 ? text : `${v < 0 ? MINUS : "+"}${text}`;
};

/** "From his own half, central, into the attacking third, right half-space." */
export function whereLine(m: Move, owner: Owner): string {
  const [a, b] = [zoneName(m.from.zone, owner), zoneName(m.to.zone, owner)];
  if (m.mode === "runs") return `Without the scan the ball ends in ${a}; with it, in ${b}.`;
  return a === b ? `Within ${a}.` : `From ${a}, into ${b}.`;
}

/** The values at the two ends and the difference; null when none is known. */
export function valuesLine(m: Move): string | null {
  const [a, b] = [m.from.xt, m.to.xt];
  if (m.mode === "pass" && a !== null && b !== null && m.delta !== null) {
    return `Zone value at the start ${a.toFixed(3)}, at the end ${b.toFixed(3)}: a difference of ${signed(m.delta, m.deltaDigits)}.`;
  }
  if (m.delta !== null) return `The difference in value is ${signed(m.delta, m.deltaDigits)}.`;
  return null;
}

/** What the grid cannot say: it holds one value per zone, no shot, goal or move parts. */
export const COMPONENTS_LIMIT =
  "The grid holds one value per zone, so this is this zone's value; it does not split it into " +
  "shot, goal and move parts.";

// ---------- the plain version ----------

const PLACE_TO: Record<Band, string> = {
  own_third: "deep in its own end",
  own_half: "its own half",
  opponents_half: "the other side's half",
  final_third: "near the goal",
};
const PLACE_AT: Record<Band, string> = {
  own_third: "deep in its own end",
  own_half: "in its own half",
  opponents_half: "in the other side's half",
  final_third: "near the goal",
};

/** One plain sentence for a casual fan: no jargon, and no digit. */
export function plainLine(m: Move): string {
  const [a, b] = [m.from.zone.band, m.to.zone.band];
  const rank = BAND_RANK[b] - BAND_RANK[a];
  // One source for the sign: the delta when known, the band rank only as a fallback.
  const gain = m.delta === null ? rank : m.delta;
  const threat = gain > 0 ? "more threat" : gain < 0 ? "less threat" : "no more threat";
  // The effect clause is told only when it agrees with the threat; otherwise it is left out.
  const effect =
    rank === 0
      ? "so the ball stayed about as far from goal"
      : rank > 0 && gain > 0
        ? "so a shot from closer became possible"
        : rank < 0 && gain < 0
          ? "so a shot became harder to get"
          : null;
  if (m.mode === "runs") {
    const tail = effect ? `${capital(effect)}, and that is ${threat}.` : `That is ${threat}.`;
    return `With the scan the ball ended ${PLACE_AT[b]}; without it, ${PLACE_AT[a]}. ${tail}`;
  }
  const then = effect ? `${effect}, and that is ${threat}.` : `and that is ${threat}.`;
  return rank === 0
    ? `The ball moved sideways ${PLACE_AT[b]}, ${then}`
    : `The ball moved from ${PLACE_TO[a]} to ${PLACE_TO[b]}, ${then}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- the persona ----------

export type XtVersion = "plain" | "concrete";

/** Casual, the player's fan and audio description get the plain sentence; analyst and coach the
 * concrete zones and values. */
export function versionFor(persona: Persona): XtVersion {
  return persona === "analyst" || persona === "coach" ? "concrete" : "plain";
}

/** The board cells to highlight for these moves: where it was kicked, where it went, and where the
 * other run's ball went. */
export interface BoardCell {
  col: number;
  row: number;
  sign: 1 | -1;
  role: "from" | "to" | "alt";
}

export function boardCells(moves: readonly Move[]): BoardCell[] {
  const out: BoardCell[] = [];
  const add = (z: Zone, team: Team, role: BoardCell["role"]) => {
    if (!out.some((c) => c.col === z.col && c.row === z.row)) {
      out.push({ col: z.col, row: z.row, sign: attackSign(team), role });
    }
  };
  moves.forEach((m, i) => {
    if (i === 0) add(m.from.zone, m.team, "from");
    add(m.to.zone, m.team, i === 0 ? "to" : "alt");
  });
  return out;
}
