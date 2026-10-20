// Shape of the JSON written by `python -m sim.export` (schema version 4): a hero moment
// (`export_hero`) or a stitched match (`export_match`, SPEC 3.1).
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
  possession?: number; // in a stitched match: the possession it belongs to
}

export interface ExportOption {
  action: string; // "pass:H9", "carry", "shot"
  target: Vec2; // m, chosen on his belief
  p_success: number; // on his belief: "he thought"
  value: number; // expected threat after the action
  prob: number; // softmax probability on the player's belief
  // The same option re-scored on the true state at the decision (SPEC 5.1): "it was".
  p_success_true: number | null;
  value_true: number | null;
  target_true: Vec2 | null; // pass targets re-chosen along the receiver's true run
  p_success_true_same_target: number | null; // his believed target held fixed
  receiver: string | null; // passes only
  receiver_believed: Vec2 | null; // m, where he believed the receiver was
  receiver_true: Vec2 | null; // m, where the receiver was
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
  blind_side: ExportBlindSide;
}

/** Blind-side alerts (SPEC 4.4), computed from tracking only by analytics/blind_side.py. */
export interface ExportBlindSide {
  intervals: { observer: string; target: string; start: number; end: number }[];
  frames: [number, number, number][][]; // [frame] -> [observer, target, frames unseen] (indices)
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
  // The look the counterfactual drops; null for a hero whose lens is not the scan (press_escape).
  key_scan: { id: string; start: number; end: number } | null;
  counterfactual: ExportCounterfactual;
  vision: ExportVision;
  delta_xt: number;
  runs: Record<RunName, ExportRun>;
}

/** The hero's counterfactual run: the key scan dropped, or one action forced (SPEC 3.7). */
export type ExportCounterfactual =
  | { id: string; intervention: "drop_scan"; scan: string }
  | { id: string; intervention: "force_action"; action: string };

// ---------- a stitched match (sim.export.export_match, SPEC 3.1) ----------

export interface ExportScore {
  home: number;
  away: number;
}

/** One possession of a stitched match: a scenario run with its own seed, on the match clock. */
export interface ExportPossession {
  index: number;
  scenario: string; // "possession_play", "blind_side_run", "press_escape"
  seed: number;
  start: number; // match frame of its first frame
  frames: number;
  restart: string; // kick_off | throw_in | goal_kick | corner | cut
  score_before: ExportScore;
  hero: string | null; // the scenario's hero
  hero_moment: string | null; // id of its hero moment, in match time
}

/** A MomentCard (explain/cards.py) lifted to match time by explain/match.py. */
export interface ExportMatchMoment {
  id: string; // in match time
  kind: string;
  actor: string | null;
  receiver: string | null;
  frame_start: number;
  frame_end: number;
  anchor_frame: number;
  anchor_t: number;
  live_only: boolean;
  selected_lens: string | null;
  possession: number;
  local_id: string; // the card id inside its possession (local frames)
  hero: boolean; // the possession's hero decision: it has a breakdown
  start: number; // the possession's first match frame
}

/** The factual run of a stitched match: no beliefs, sight, decision or counterfactual. */
export type ExportMatchRun = Pick<
  ExportRun,
  "frames" | "pos" | "head" | "body" | "ball" | "owner" | "events" | "blind_side"
>;

export interface MatchExport {
  version: number;
  kind: "match";
  scenario: "match";
  seed: number;
  dt: number;
  hero: null;
  players: ExportPlayer[];
  match: { duration_s: number; score: ExportScore; possessions: ExportPossession[] };
  runs: { factual: ExportMatchRun };
  moments: ExportMatchMoment[];
}
