// "Without the look", told (SPEC 5.3, 7; teammates' feedback 2026-10-21): which look was removed,
// what losing it cost, and where the pass went in expected threat. The lines are verified claims
// rendered in en and zh by sim.export --without-look (explain/look_cost.py) and bundled per hero;
// the app checks them against the replay like any payload (checkPayload) and shows only those
// that pass. No model call, no cache: a static file of a few KB, fetched on first use.

import type { Fetch } from "../api/client";
import type { Hero } from "../data/hero";
import { checkPayload, claimRun, type Narration } from "../narration/payload";
import type { Session } from "../session";
import { createStore, type Store } from "../store/store";
import { LANGUAGES, type Language } from "../whatif/whatif";

export const WITHOUT_VERSION = 1;

/** The bundled lines of each scan hero, by `<scenario>-<seed>`. */
export const WITHOUT_FILES: Record<string, string> = {
  "blind_side_run-3": "without_look_seed3.json",
  "far_post_finish-11": "without_look_far_post_finish_seed11.json",
};

interface RawWithoutLook {
  version: number;
  moment: string;
  hero: string;
  removed: { id: string; start: number; end: number };
  answers: Partial<Record<Language, unknown>>;
  xt: { units: string; cols: number; rows: number; fitted: boolean; grid: number[][] };
}

export interface WithoutLook {
  removed: { id: string; start: number; end: number }; // the dropped scan, factual frames
  side: "left" | "right" | null; // over which shoulder, from the verified removed_look claim
  answers: Partial<Record<Language, Narration>>; // only the languages whose payload passed
  errors: string[]; // why a language's payload was refused
  cols: number; // the xT grid: column i along x from the own goal line, row j along y
  rows: number;
  grid: number[]; // [i * rows + j], xT for a team attacking +x
  fitted: boolean; // false: the smooth prior (no fit was cached)
}

export function parseWithoutLook(json: unknown, hero: Hero, moment: string): WithoutLook {
  const raw = json as RawWithoutLook;
  if (!raw || raw.version !== WITHOUT_VERSION) {
    throw new Error(`without-look file version ${raw?.version}, app expects ${WITHOUT_VERSION}`);
  }
  if (raw.moment !== moment) throw new Error(`the lines are for ${raw.moment}, not ${moment}`);
  if (raw.hero !== hero.heroId)
    throw new Error(`the lines are ${raw.hero}'s, not ${hero.heroId}'s`);
  if (raw.removed.id !== hero.keyScan?.id) {
    throw new Error(`the removed look ${raw.removed.id} is not this moment's key scan`);
  }
  const events = new Set(
    [...hero.runs.factual.events, ...hero.runs.counterfactual.events].map((e) => e.id),
  );
  const scope = {
    moment,
    events,
    frames: (c: Parameters<typeof claimRun>[0]) => hero.runs[claimRun(c)].frames,
  };
  const answers: WithoutLook["answers"] = {};
  const errors: string[] = [];
  for (const lang of LANGUAGES) {
    const checked = checkPayload(raw.answers?.[lang], scope);
    if (checked.ok) answers[lang] = checked.narration;
    else errors.push(...checked.errors.map((e) => `${lang}: ${e}`));
  }
  const removed = Object.values(answers)
    .map((n) => n?.claims.get("removed_look"))
    .find((c) => c?.verdict === "supported");
  const side = removed?.values.side;
  return {
    removed: raw.removed,
    side: side === "left" || side === "right" ? side : null,
    answers,
    errors,
    cols: raw.xt.cols,
    rows: raw.xt.rows,
    grid: raw.xt.grid.flat().map((v) => v * 1e-4),
    fitted: raw.xt.fitted,
  };
}

export interface WithoutLookState {
  status: "none" | "loading" | "ready" | "failed"; // none: no bundle for this hero
  data: WithoutLook | null;
  error: string | null;
}

export interface WithoutLookController {
  state: Store<WithoutLookState>;
  load(): Promise<void>;
}

const DATA_URL = `${import.meta.env.BASE_URL}data/`;
const controllers = new WeakMap<Session, WithoutLookController>();

/** The bundled lines of this hero moment, fetched once. `fetchImpl` and `dataUrl`: tests. */
export function withoutLookOf(
  session: Session,
  fetchImpl: Fetch = (url) => fetch(url),
  dataUrl = DATA_URL,
): WithoutLookController {
  let c = controllers.get(session);
  if (!c) controllers.set(session, (c = create(session, fetchImpl, dataUrl)));
  return c;
}

function create(session: Session, fetchImpl: Fetch, dataUrl: string): WithoutLookController {
  const { hero, moment } = session;
  const file = hero.keyScan ? WITHOUT_FILES[`${hero.scenario}-${hero.seed}`] : undefined;
  const state = createStore<WithoutLookState>({
    status: file ? "loading" : "none",
    data: null,
    error: null,
  });
  let loading: Promise<void> | null = null;
  return {
    state,
    load() {
      if (!file) return Promise.resolve();
      loading ??= (async () => {
        try {
          const res = await fetchImpl(dataUrl + file);
          if (!res.ok) throw new Error(`${file} could not be fetched`);
          const data = parseWithoutLook(await res.json(), hero, moment.id);
          state.set({ status: "ready", data, error: null });
        } catch (err) {
          state.set({ status: "failed", error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return loading;
    },
  };
}
