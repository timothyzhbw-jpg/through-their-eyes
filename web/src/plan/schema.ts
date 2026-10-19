// TelestrationPlan: the cue list a breakdown is played from (SPEC 6). The Telestrator agent will
// write it; this file is the contract. zod plays the role pydantic plays on the Python side:
// one declaration gives both the TypeScript type and the runtime check.
//
// Times: `t` is seconds since the plan started (wall clock). `from` / `to` are seconds of match
// time relative to the moment's anchor, the hero's reception (negative = before it).

import { z } from "zod";

const At = z.number().min(0);
const Rel = z.number().min(-60).max(60);
const Speed = z.number().min(0.1).max(2);
const PlayerId = z.string().regex(/^[HA]\d{1,2}$/);

export const CAMERA_MODES = ["split", "pov", "tactical"] as const;

/** Hold the current frame. */
const Freeze = z.strictObject({ t: At, do: z.literal("freeze") });
/** Jump to a moment-relative time and hold. */
const Rewind = z.strictObject({ t: At, do: z.literal("rewind"), to: Rel });
/** Play from the current frame to `to` (not in the SPEC sketch: needed to show the outcome). */
const Play = z.strictObject({ t: At, do: z.literal("play"), to: Rel, speed: Speed });
/** Which view gets the space. `broadcast` and `player_lock` arrive with those cameras. */
const Camera = z.strictObject({ t: At, do: z.literal("camera"), mode: z.enum(CAMERA_MODES) });
/** First-person segment through `player`'s eyes, eased yaw, at most MAX_POV_CLIP_S. */
const Pov = z.strictObject({
  t: At,
  do: z.literal("pov"),
  player: PlayerId,
  from: Rel,
  to: Rel,
  speed: Speed,
});
/** Highlight one scan on the timeline and the board; the label comes from a verified claim. */
const ScanMarker = z.strictObject({
  t: At,
  do: z.literal("scan_marker"),
  scan: z.string(),
  label_claim: z.string().optional(),
});
/** Turn on an analytics layer. Only `vision` exists so far (pitch control, pressing: M4). */
const Zone = z.strictObject({
  t: At,
  do: z.literal("zone"),
  layer: z.enum(["vision"]),
  player: PlayerId,
});
/** Belief ghosts ("where he thought they were") or the counterfactual ghost path. */
const Ghost = z.strictObject({
  t: At,
  do: z.literal("ghost"),
  kind: z.enum(["belief", "counterfactual"]),
  cf: z.string().optional(),
});
/** Show (later: speak) one line of the approved Script. */
const Voice = z.strictObject({ t: At, do: z.literal("voice"), line: z.string() });

export const PlanStep = z.discriminatedUnion("do", [
  Freeze,
  Rewind,
  Play,
  Camera,
  Pov,
  ScanMarker,
  Zone,
  Ghost,
  Voice,
]);

export const TelestrationPlan = z.strictObject({
  moment: z.string(),
  duration_s: z.number().positive().max(120),
  steps: z.array(PlanStep).min(1).max(100),
});

export type PlanStep = z.infer<typeof PlanStep>;
export type TelestrationPlan = z.infer<typeof TelestrationPlan>;

/** Script lines a plan's voice steps refer to, by line id. */
export type Script = Record<string, string>;
