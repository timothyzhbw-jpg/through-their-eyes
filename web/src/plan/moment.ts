// What a plan is checked against: the moment's clip, its anchor and the ids it may refer to.
// The id and anchor follow the MomentCard of explain/moments.py (SPEC 5.1): a decision after a
// scan is "m:decision_after_scan:<actor>:<decision frame>", anchored at the decision. The kind
// depends on the lens (a pressure hero's is "m:pressed_decision:…"), so the service's id is used
// when there is one; without it the scan hero's id is derived from the export.

import type { Hero, Scan } from "../data/hero";

export interface MomentContext {
  id: string;
  anchorFrame: number; // MomentCard.anchor_frame (the decision); plan times are relative to it
  dt: number;
  frames: number; // length of the factual clip
  players: string[];
  scans: string[]; // scan event ids in the factual run
  keyScan: Scan | null; // the look the counterfactual drops; null for a hero without one
  hero: string;
  counterfactual: string; // id of the counterfactual run
  decisionFrame: number;
  endFrame: number; // the hero's action is resolved: where a breakdown starts
}

/** The hero moment of a hero export; `id` is the MomentCard id when the service gave one. */
export function heroMoment(hero: Hero, id?: string | null): MomentContext {
  if (hero.kind !== "hero" || !hero.heroId || !hero.counterfactual) {
    throw new Error("a stitched match has no single hero moment");
  }
  const run = hero.runs.factual;
  const decisionFrame = run.decision?.frame ?? hero.reception;
  return {
    id: id ?? `m:decision_after_scan:${hero.heroId}:${String(decisionFrame).padStart(4, "0")}`,
    anchorFrame: decisionFrame,
    dt: hero.dt,
    frames: run.frames,
    players: hero.ids,
    scans: run.scans.map((s) => s.id),
    keyScan: hero.keyScan,
    hero: hero.heroId,
    counterfactual: hero.counterfactual.id,
    decisionFrame,
    endFrame: Math.min(run.frames - 1, run.action?.end ?? run.frames - 1),
  };
}

export function relToFrame(m: MomentContext, rel: number): number {
  return Math.max(0, Math.min(m.frames - 1, m.anchorFrame + rel / m.dt));
}

export function frameToRel(m: MomentContext, frame: number): number {
  return (frame - m.anchorFrame) * m.dt;
}
