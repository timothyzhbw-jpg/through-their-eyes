// Shape of the JSON written by `python -m sim.export` (schema version 2).
// Positions are integer mm, angles integer 1e-4 rad; pitch origin at the centre spot, home
// attacks +x. `hero.ts` converts everything to metres and radians once, at load time.

export type Vec2 = [number, number];
export type RunName = "factual" | "counterfactual";

export interface ExportPlayer {
  id: string; // "H8": team letter + shirt number
  team: 0 | 1; // 0 home, 1 away
  role: string;
  number: number;
}

export interface ExportEvent {
  id: string; // "<type>:<player>:<frame>", stable across runs
  type: string;
  frame: number;
  player: string;
  attrs: Record<string, unknown>;
}

export interface ExportOption {
  action: string; // "pass:H9", "carry", "shot"
  target: Vec2; // m
  p_success: number;
  value: number; // expected threat after the action
  prob: number; // softmax probability on the player's belief
}

export interface ExportDecision {
  frame: number;
  player: string;
  chosen: string;
  options: ExportOption[]; // sorted by prob, highest first
  belief_error: Record<string, number>; // m
  belief_age: Record<string, number>; // s
}

export interface ExportAction {
  frame: number;
  to: string;
  start: Vec2; // m
  target: Vec2; // m
  speed: number; // m/s
  distance: number; // m
  outcome: string;
  end?: number; // frame the pass was resolved
  end_at?: Vec2;
  receiver?: string | null;
}

export interface ExportRun {
  frames: number;
  pos: number[][]; // [frame][2 * player + xy], mm
  head: number[][]; // [frame][player], 1e-4 rad
  body: number[][];
  ball: number[][]; // [frame][xy], mm
  owner: number[]; // player index, -1 when free
  ghost: number[][]; // hero's believed positions, like pos
  seen: number[]; // bitmask of players the hero sees
  seen_by: number[][]; // [frame][observer] bitmask
  events: ExportEvent[];
  decision: ExportDecision | null;
  action: ExportAction | null;
  possession_value: number;
}

export interface ExportVision {
  half_cone: number; // 1e-4 rad
  edge_sigma: number;
  narrowing_per_mps: number;
  min_half_cone: number;
  distance_sigma: number; // mm
}

export interface HeroExport {
  version: number;
  scenario: string;
  seed: number;
  dt: number; // s per frame
  hero: string;
  runner: string | null;
  players: ExportPlayer[];
  key_scan: { id: string; start: number; end: number };
  counterfactual: { id: string; intervention: string; scan: string };
  vision: ExportVision;
  delta_xt: number;
  runs: Record<RunName, ExportRun>;
}
