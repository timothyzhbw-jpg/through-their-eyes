// "With two more looks" (SPEC 3.7, 7), the opposite of the run without the look: the hero keeps
// every look of his own and adds one to his left and one to his right before the ball arrives
// (sim.counterfactual.two_more_looks). Its lines are verified claims rendered in en and zh by
// sim.export --extra-looks (explain/extra_looks.py) and bundled per hero, in the without-look
// bundle's format with `added` in place of `removed`. The app checks them against the replay like
// any payload (checkPayload) and shows only those that pass; `report` is the eval report with the
// held-out numbers, which the panel's source chip names. No model call: a static file of a few KB.

import type { Fetch } from "../api/client";
import type { Hero } from "../data/hero";
import { checkPayload, claimRun, type Narration } from "../narration/payload";
import type { Session } from "../session";
import { createStore, type Store } from "../store/store";
import { LANGUAGES, type Language } from "../whatif/whatif";

export const EXTRA_VERSION = 1;

/** The bundled lines of each scan hero, by `<scenario>-<seed>`. */
export const EXTRA_FILES: Record<string, string> = {
  "blind_side_run-3": "extra_looks_seed3.json",
};

/** A committed eval report, as the source chip names it. */
const REPORT = /^eval\/reports\/[a-z0-9_-]+\.md$/;

interface RawAdded {
  id: string;
  start: number;
  end: number;
  body_deg: number;
}

interface RawExtraLooks {
  version: number;
  moment: string;
  hero: string;
  id: string;
  added: RawAdded[];
  kept_own: boolean;
  report: string;
  answers: Partial<Record<Language, unknown>>;
}

export interface ExtraLooks {
  id: string; // the intervention: extra:<player>:<frame>:<deg>,…
  added: { id: string; start: number; end: number; bodyDeg: number }[]; // other run's frames
  keptOwn: boolean; // every look of his own still happened
  report: string; // the eval report with the held-out numbers
  answers: Partial<Record<Language, Narration>>; // only the languages whose payload passed
  errors: string[]; // why a language's payload was refused
}

export function parseExtraLooks(json: unknown, hero: Hero, moment: string): ExtraLooks {
  const raw = json as RawExtraLooks;
  if (!raw || raw.version !== EXTRA_VERSION) {
    throw new Error(`extra-looks file version ${raw?.version}, app expects ${EXTRA_VERSION}`);
  }
  if (raw.moment !== moment) throw new Error(`the lines are for ${raw.moment}, not ${moment}`);
  if (raw.hero !== hero.heroId)
    throw new Error(`the lines are ${raw.hero}'s, not ${hero.heroId}'s`);
  if (!Array.isArray(raw.added) || raw.added.length === 0) throw new Error("no added look");
  if (!raw.added.every((a) => a.id.startsWith(`scan:${hero.heroId}:`))) {
    throw new Error(`an added look is not ${hero.heroId}'s`);
  }
  if (typeof raw.report !== "string" || !REPORT.test(raw.report)) {
    throw new Error(`${raw.report} is not an eval report`);
  }
  // The claims' evidence is on the factual run, which the replay has; the added scans are not.
  const events = new Set(
    [...hero.runs.factual.events, ...hero.runs.counterfactual.events].map((e) => e.id),
  );
  const scope = {
    moment,
    events,
    frames: (c: Parameters<typeof claimRun>[0]) => hero.runs[claimRun(c)].frames,
  };
  const answers: ExtraLooks["answers"] = {};
  const errors: string[] = [];
  for (const lang of LANGUAGES) {
    const checked = checkPayload(raw.answers?.[lang], scope);
    if (checked.ok) answers[lang] = checked.narration;
    else errors.push(...checked.errors.map((e) => `${lang}: ${e}`));
  }
  return {
    id: raw.id,
    added: raw.added.map((a) => ({ id: a.id, start: a.start, end: a.end, bodyDeg: a.body_deg })),
    keptOwn: raw.kept_own === true,
    report: raw.report,
    answers,
    errors,
  };
}

export interface ExtraLooksState {
  status: "none" | "loading" | "ready" | "failed"; // none: no bundle for this hero
  data: ExtraLooks | null;
  error: string | null;
}

/** What his own look is compared with: the run without it, or the run with more. */
export type Compare = "without" | "extra";

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six"];
/** "two" for 2: the switch's label and the panel's sentence name as many looks as the bundle added. */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export interface ExtraLooksController {
  state: Store<ExtraLooksState>;
  compare: Store<{ value: Compare }>; // lives here, so a moment change keeps the switch
  load(): Promise<void>;
}

const DATA_URL = `${import.meta.env.BASE_URL}data/`;
const controllers = new WeakMap<Session, ExtraLooksController>();

/** The bundled lines of this hero moment, fetched once. `fetchImpl` and `dataUrl`: tests. */
export function extraLooksOf(
  session: Session,
  fetchImpl: Fetch = (url) => fetch(url),
  dataUrl = DATA_URL,
): ExtraLooksController {
  let c = controllers.get(session);
  if (!c) controllers.set(session, (c = create(session, fetchImpl, dataUrl)));
  return c;
}

function create(session: Session, fetchImpl: Fetch, dataUrl: string): ExtraLooksController {
  const { hero, moment } = session;
  const file = hero.keyScan ? EXTRA_FILES[`${hero.scenario}-${hero.seed}`] : undefined;
  const state = createStore<ExtraLooksState>({
    status: file ? "loading" : "none",
    data: null,
    error: null,
  });
  let loading: Promise<void> | null = null;
  return {
    state,
    compare: createStore<{ value: Compare }>({ value: "without" }),
    load() {
      if (!file) return Promise.resolve();
      loading ??= (async () => {
        try {
          const res = await fetchImpl(dataUrl + file);
          if (!res.ok) throw new Error(`${file} could not be fetched`);
          const data = parseExtraLooks(await res.json(), hero, moment.id);
          state.set({ status: "ready", data, error: null });
        } catch (err) {
          state.set({ status: "failed", error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return loading;
    },
  };
}
