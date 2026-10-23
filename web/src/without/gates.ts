// Held-out evidence for the "Without the look" comparison (eval/hero_gates.py): over the
// held-out seeds, how often removing the key look changes the decision or the placement.
// web/public/data/hero_gates.json, checked with zod. A missing file or one that fails the check
// leaves the gates null, and the panel still says what was held constant. Components never
// fetch: the session loads it, the way it loads the without-look bundle.

import { z } from "zod";
import type { Fetch } from "../api/client";
import type { Session } from "../session";
import { createStore, type Store } from "../store/store";
import { WITHOUT_FILES } from "./without";

export const HERO_GATES_FILE = "hero_gates.json";

/** The scan heroes the comparison panels cover, taken from the without-look bundles. */
export const GATE_SCENARIOS: readonly string[] = [
  ...new Set(Object.keys(WITHOUT_FILES).map((key) => key.slice(0, key.lastIndexOf("-")))),
];

const Gate = z.strictObject({
  what: z.enum(["decision", "placement"]),
  changed: z.number().int().nonnegative(),
  n: z.number().int().positive(),
  same: z.number().int().nonnegative(),
  seeds: z.tuple([z.number().int(), z.number().int()]),
  report: z.string().min(1),
});
export type HeroGate = z.infer<typeof Gate>;

const HeroGatesFile = z.strictObject({
  version: z.literal(1),
  heroes: z.record(z.string(), Gate),
});

/** This hero's scenario when a comparison panel has a bundle for it, else null. */
export function gateScenario(scenario: string): string | null {
  return GATE_SCENARIOS.includes(scenario) ? scenario : null;
}

/** The file's heroes, or null when it is the wrong shape or its counts disagree. A hero with
 * no comparison panel is ignored; one the file lacks just shows no held-out line. */
export function parseHeroGates(json: unknown): Record<string, HeroGate> | null {
  const parsed = HeroGatesFile.safeParse(json);
  if (!parsed.success) return null;
  const heroes = parsed.data.heroes;
  for (const gate of Object.values(heroes)) {
    if (gate.same !== gate.n - gate.changed || gate.changed > gate.n) return null;
  }
  return heroes;
}

export interface HeroGatesState {
  status: "none" | "loading" | "ready" | "failed"; // none: this hero has no comparison panel
  gate: HeroGate | null;
}

export interface HeroGatesController {
  state: Store<HeroGatesState>;
  load(): Promise<void>;
}

const DATA_URL = `${import.meta.env.BASE_URL}data/`;
const controllers = new WeakMap<Session, HeroGatesController>();

/** This hero's held-out count, fetched once. `fetchImpl` and `dataUrl`: tests. */
export function heroGatesOf(
  session: Session,
  fetchImpl: Fetch = (url) => fetch(url),
  dataUrl = DATA_URL,
): HeroGatesController {
  let c = controllers.get(session);
  if (!c) controllers.set(session, (c = create(session, fetchImpl, dataUrl)));
  return c;
}

function create(session: Session, fetchImpl: Fetch, dataUrl: string): HeroGatesController {
  const scenario = gateScenario(session.hero.scenario);
  const state = createStore<HeroGatesState>({
    status: scenario ? "loading" : "none",
    gate: null,
  });
  let loading: Promise<void> | null = null;
  return {
    state,
    load() {
      if (!scenario) return Promise.resolve();
      loading ??= (async () => {
        try {
          const res = await fetchImpl(dataUrl + HERO_GATES_FILE);
          if (!res.ok) throw new Error(`${HERO_GATES_FILE} could not be fetched`);
          const heroes = parseHeroGates(await res.json());
          if (!heroes) throw new Error(`${HERO_GATES_FILE} failed validation`);
          state.set({ status: "ready", gate: heroes[scenario] ?? null });
        } catch {
          state.set({ status: "failed", gate: null });
        }
      })();
      return loading;
    },
  };
}
