// "What if…?" answers (SPEC 6, 7), precomputed by sim.export.export_what_ifs (free questions go to
// the live service, see ask.ts): every option of the hero's decision forced and re-simulated, with
// the verified answer (a SPEC 5.3 render payload in en and zh) and the forced run from the
// decision on, for the ghost path.

import { clampFrame, type Hero } from "../data/hero";
import type { ExportEvent } from "../data/types";
import { checkPayload, type Narration } from "../narration/payload";
import type { MomentContext } from "../plan/moment";

export const WHAT_IF_VERSION = 1;
export const LANGUAGES = ["en", "zh"] as const;
export type Language = (typeof LANGUAGES)[number];

interface RawOption {
  action: string;
  factual: boolean;
  question: Record<Language, string>;
  id?: string;
  frames?: number;
  pos?: number[][]; // [frame - start][2 * player + xy], mm
  ball?: number[][];
  events?: ExportEvent[];
  answers?: Record<Language, unknown>;
}

interface RawWhatIfs {
  version: number;
  moment: string;
  hero: string;
  decision_frame: number;
  start: number;
  factual_action: string;
  refusal: Record<Language, string>;
  options: RawOption[];
}

/** The forced run from `start` on, in metres. */
export interface WhatIfRun {
  start: number; // first frame stored (the decision)
  frames: number;
  pos: Float32Array; // index ((frame - start) * n + player) * 2 + xy
  ball: Float32Array; // index (frame - start) * 2 + xy
  events: ExportEvent[];
}

export interface WhatIfOption {
  action: string;
  factual: boolean; // what he did: no what-if
  question: Record<Language, string>;
  id: string | null; // "force:H8:0075:pass:H4"
  run: WhatIfRun | null;
  answers: Partial<Record<Language, Narration>>; // only answers that passed the checks
  errors: string[];
}

export interface WhatIfs {
  moment: string;
  decisionFrame: number;
  start: number;
  factualAction: string;
  refusal: Record<Language, string>;
  options: WhatIfOption[];
}

function convertRun(raw: RawOption, start: number): WhatIfRun | null {
  if (!raw.pos || !raw.ball || raw.frames === undefined) return null;
  return {
    start,
    frames: raw.frames,
    pos: Float32Array.from(raw.pos.flat(), (v) => v / 1000),
    ball: Float32Array.from(raw.ball.flat(), (v) => v / 1000),
    events: raw.events ?? [],
  };
}

export function parseWhatIfs(json: unknown, hero: Hero, m: MomentContext): WhatIfs {
  const raw = json as RawWhatIfs;
  if (!raw || raw.version !== WHAT_IF_VERSION || !Array.isArray(raw.options)) {
    throw new Error(`what-if file version ${raw?.version}, app expects ${WHAT_IF_VERSION}`);
  }
  if (raw.moment !== m.id) throw new Error(`what-ifs are for ${raw.moment}, not ${m.id}`);
  const factualEvents = hero.runs.factual.events.map((e) => e.id);
  const options = raw.options.map((o): WhatIfOption => {
    const run = convertRun(o, raw.start);
    const option: WhatIfOption = {
      action: o.action,
      factual: o.factual,
      question: o.question,
      id: o.id ?? null,
      run,
      answers: {},
      errors: [],
    };
    if (o.factual || !run || !o.id) return option;
    const scope = {
      moment: `${m.id}?${o.id}`,
      events: new Set([...factualEvents, ...run.events.map((e) => e.id)]),
      frames: () => Math.max(hero.runs.factual.frames, run.start + run.frames),
    };
    for (const lang of LANGUAGES) {
      const checked = checkPayload(o.answers?.[lang], scope);
      if (checked.ok) option.answers[lang] = checked.narration;
      else option.errors.push(...checked.errors.map((e) => `${lang}: ${e}`));
    }
    return option;
  });
  return {
    moment: raw.moment,
    decisionFrame: raw.decision_frame,
    start: raw.start,
    factualAction: raw.factual_action,
    refusal: raw.refusal,
    options,
  };
}

export function optionOf(whatIfs: WhatIfs | null, action: string | null) {
  return action ? whatIfs?.options.find((o) => o.action === action) : undefined;
}

// ---------- the ghost: the forced run at a fractional frame ----------

export interface GhostSample {
  pos: Float32Array; // 2 * n, m
  ball: Float32Array; // 2, m
}

/** Fill `out` with the forced run at frame `f`; false before the decision (no ghost yet). */
export function ghostAt(run: WhatIfRun, n: number, f: number, out: GhostSample): boolean {
  if (f < run.start) return false;
  const last = run.start + run.frames - 1;
  const c = Math.min(f, last) - run.start;
  const i0 = Math.floor(c);
  const i1 = Math.min(run.frames - 1, i0 + 1);
  const t = c - i0;
  for (let k = 0; k < 2 * n; k++) {
    out.pos[k] = run.pos[i0 * 2 * n + k] * (1 - t) + run.pos[i1 * 2 * n + k] * t;
  }
  for (let k = 0; k < 2; k++)
    out.ball[k] = run.ball[i0 * 2 + k] * (1 - t) + run.ball[i1 * 2 + k] * t;
  return true;
}

const ON_THE_BALL = new Set(["pass", "reception", "carry", "shot", "interception", "tackle"]);

/** Players the forced run's ball events involve (passer, target, receiver or interceptor): the
 * ghosts worth drawing. Everyone else drifts a little too, which would only add noise. */
export function involvedPlayers(run: WhatIfRun): Set<string> {
  const out = new Set<string>();
  for (const e of run.events) {
    if (!ON_THE_BALL.has(e.type)) continue;
    out.add(e.player);
    for (const key of ["to", "receiver"]) {
      const v = e.attrs[key];
      if (typeof v === "string") out.add(v);
    }
  }
  return out;
}

/** Ball positions of the forced run, one per frame from the decision on. */
export function ballPath(run: WhatIfRun): [number, number][] {
  return Array.from({ length: run.frames }, (_, k) => [run.ball[2 * k], run.ball[2 * k + 1]]);
}

/** Clamp a frame into the factual clip (seeks happen in the factual run, the ghost on top). */
export function seekFrame(hero: Hero, frame: number): number {
  return clampFrame(hero.runs.factual, frame);
}
