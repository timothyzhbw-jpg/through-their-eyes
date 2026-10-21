// "Your call" (SPEC 7): the options the viewer may pick at the hero's decision, and the run each
// one plays. An option is offered only if it has a re-simulated run: the forced run precomputed
// per option (whatif_*.json, SPEC 3.7), the run that happened for his own choice, or the export's
// own counterfactual when it forces that action (press_escape forces a carry).

import {
  actionLabel,
  clampFrame,
  isShot,
  Sample,
  sampleInto,
  shotPost,
  type Hero,
} from "../data/hero";
import { optionLabel } from "../options/passOptions";
import type { Vec2 } from "../data/types";
import type { MomentContext } from "../plan/moment";
import { ghostAt, optionOf, type WhatIfRun, type WhatIfs } from "../whatif/whatif";
import { believedAt } from "./picture";

/** Frames the clip of what happened keeps running after his action is resolved. */
export const HOLD_FRAMES = 12;

export type OptionRun =
  | { source: "factual" } // what he did: the run that happened
  | { source: "whatif"; run: WhatIfRun } // forced and re-simulated from the decision
  | { source: "counterfactual" }; // the export's counterfactual run forces this action

export interface CallOption {
  action: string; // "pass:H9", "carry", "shot", "shot:far"
  kind: "pass" | "carry" | "shot";
  label: string; // "Pass to H9"
  short: string; // on the marker: the receiver's shirt number, or the label
  receiver: string | null;
  anchor: Vec2; // the marker: the receiver's token (believedAt), else the option's target
  target: Vec2; // where he would have aimed it, on his belief (the end of the dotted path)
  factual: boolean; // what he did
  run: OptionRun;
}

function runOf(hero: Hero, whatIfs: WhatIfs | null, action: string, chosen: string) {
  if (action === chosen) return { source: "factual" } as const;
  const forced = optionOf(whatIfs, action)?.run;
  if (forced) return { source: "whatif", run: forced } as const;
  const cf = hero.counterfactual;
  if (cf?.intervention === "force_action" && cf.action === action) {
    return { source: "counterfactual" } as const;
  }
  return null;
}

/**
 * Every option of the hero's decision that has a run to play, listed left to right as seen from
 * behind him facing the attack (home attacks +x, so his left is +y): an order that says nothing
 * about how likely he was to pick each one. Your call opens only when this is every option
 * (controller.ts): a shorter list would point at the one he did not pick.
 */
export function callOptions(hero: Hero, whatIfs: WhatIfs | null): CallOption[] {
  const d = hero.runs.factual.decision;
  if (!d || hero.hero < 0) return [];
  const team = hero.players[hero.hero].team;
  const out: CallOption[] = [];
  for (const o of d.options) {
    const run = runOf(hero, whatIfs, o.action, d.chosen);
    if (!run) continue;
    const pass = o.action.startsWith("pass:");
    const receiver = pass ? o.action.slice(5) : null;
    const receiverJ = receiver === null ? -1 : hero.ids.indexOf(receiver);
    const number = receiverJ >= 0 ? hero.players[receiverJ].number : undefined;
    const shot = isShot(o.action);
    const post = shotPost(o.action);
    const label =
      o.action === "carry" ? "Carry" : shot ? optionLabel(o.action) : actionLabel(o.action);
    out.push({
      action: o.action,
      kind: pass ? "pass" : shot ? "shot" : "carry",
      label,
      short:
        number !== undefined
          ? String(number)
          : post
            ? `${post === "near" ? "Near" : "Far"} post`
            : shot
              ? "Shot"
              : "Carry",
      receiver,
      // On the receiver's token. Carry and shot have none: the option's target, which is also
      // where the dotted path ends.
      anchor: receiverJ >= 0 ? believedAt(hero, receiverJ) : o.target,
      target: o.target,
      factual: o.action === d.chosen,
      run,
    });
  }
  const side = team === 0 ? -1 : 1; // sort key: smaller is further left
  return out.sort((a, b) => side * (a.anchor[1] - b.anchor[1]) || a.anchor[0] - b.anchor[0]);
}

export interface Clip {
  start: number; // the decision
  end: number; // the call is resolved (and a moment after, for what happened)
}

/** The frames an option's run plays: from the decision until it is resolved. */
export function clipOf(hero: Hero, moment: MomentContext, option: CallOption): Clip {
  const start = moment.decisionFrame;
  if (option.run.source === "whatif") {
    const run = option.run.run;
    return { start: run.start, end: run.start + run.frames - 1 };
  }
  const name = option.run.source === "factual" ? "factual" : "counterfactual";
  const run = hero.runs[name];
  const resolved = run.action?.end ?? run.frames - 1;
  return { start, end: clampFrame(run, Math.max(start, resolved + HOLD_FRAMES)) };
}

/** Where everyone and the ball are in an option's run at fractional frame `f`. */
export interface Pose {
  pos: Float32Array; // 2 * n, m
  ball: Float32Array; // 2, m
}

export function newPose(n: number): Pose {
  return { pos: new Float32Array(2 * n), ball: new Float32Array(2) };
}

const samples = new WeakMap<Hero, Sample>();

export function poseAt(hero: Hero, option: CallOption, f: number, out: Pose): Pose {
  if (option.run.source === "whatif") {
    ghostAt(option.run.run, hero.n, Math.max(f, option.run.run.start), out);
    return out;
  }
  const run = hero.runs[option.run.source === "factual" ? "factual" : "counterfactual"];
  let sample = samples.get(hero);
  if (!sample) samples.set(hero, (sample = new Sample(hero.n)));
  sampleInto(sample, hero, run, f);
  out.pos.set(sample.pos);
  out.ball.set(sample.ball);
  return out;
}
