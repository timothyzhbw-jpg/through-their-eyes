// What the app starts from. With an API base URL and a service that answers its health probe in
// time, the match export comes from the API and the app plays live; otherwise everything comes
// from the bundled files in public/data, as before the API existed, and the header says
// "Offline data". The bundled render payload (a fixture) and what-if answers are loaded either
// way: the payload is the narration when the service cannot give one, the what-ifs carry the
// forced runs the suggested questions replay.
//
// Which match: `?match=<id>` in the address (an id the API serves, e.g. `match-1`, the stitched
// match); the default is the bundled hero moment, blind_side_run-3. Only the default is bundled,
// so any other match needs the live service.

import { createApi, MATCH_ID, PROBE_TIMEOUT_MS, type Api, type Fetch } from "../api/client";
import { parseHero, type Hero } from "./hero";

export const HERO_FILE = "hero_seed3.json";
// A fixture until the API answers (sim.export.render_payload_fixture).
export const PAYLOAD_FILE = "fixture_payload_seed3.json";
// Every option's "What if…?" answer, precomputed by sim.export.export_what_ifs.
export const WHAT_IF_FILE = "whatif_seed3.json";

export interface LoadOptions {
  apiBase: string | null; // VITE_API_URL; null: offline data only
  dataUrl: string; // where public/data is served, ending in "/"
  match?: string;
  fetch?: Fetch;
  probeTimeoutMs?: number;
}

export interface Loaded {
  hero: Hero;
  payload: unknown; // bundled render payload, or null
  whatIfs: unknown; // bundled what-ifs, or null
  api: Api | null; // null: offline data
  offline: string | null; // why the app runs on offline data
  momentId: string | null; // the hero moment's id, as the service names it; null: the default
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The match to play from `?match=` (a service match id such as `match-1`); else the default. */
export function matchFromUrl(search: string): string {
  const id = new URLSearchParams(search).get("match")?.trim() ?? "";
  return /^[a-z0-9_]+-\d+$/i.test(id) ? id : MATCH_ID;
}

/** A bundled JSON file, or null if it cannot be fetched. */
async function optional(fetchImpl: Fetch, url: string): Promise<unknown> {
  try {
    const res = await fetchImpl(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function loadData(opts: LoadOptions): Promise<Loaded> {
  const fetchImpl: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const bundled = Promise.all([
    optional(fetchImpl, opts.dataUrl + PAYLOAD_FILE),
    optional(fetchImpl, opts.dataUrl + WHAT_IF_FILE),
  ]);

  const match = opts.match ?? MATCH_ID;
  let hero: Hero | null = null;
  let api: Api | null = null;
  let momentId: string | null = null;
  let offline: string | null = "no live service configured (VITE_API_URL is not set)";
  if (opts.apiBase) {
    const candidate = createApi(opts.apiBase, match, fetchImpl);
    try {
      await candidate.health(opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS);
      // The info names the hero moment (its kind depends on the lens); without it the default
      // id is kept, which is right for the scan hero.
      const [exported, info] = await Promise.all([
        candidate.exportJson(),
        candidate.info().catch(() => null),
      ]);
      hero = parseHero(exported);
      momentId = hero.kind === "hero" ? (info?.hero_moment ?? null) : null;
      api = candidate;
      offline = null;
    } catch (err) {
      offline = `the live service did not answer (${message(err)})`;
    }
  }
  if (!hero) {
    hero = await bundledHero(fetchImpl, opts.dataUrl);
    if (match !== MATCH_ID) {
      offline = `${match} needs the live service, so the bundled ${MATCH_ID} plays: ${offline}`;
    }
  }
  const [payload, whatIfs] = await bundled;
  return { hero, payload, whatIfs, api, offline, momentId };
}

/** The bundled hero moment (blind_side_run seed 3). */
export async function bundledHero(fetchImpl: Fetch, dataUrl: string): Promise<Hero> {
  const url = dataUrl + HERO_FILE;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseHero(await res.json());
}

/**
 * The hero export of one scenario run (a possession of a stitched match): from the service,
 * which serves it as `<scenario>-<seed>` when TTE_MATCHES lists it; else the bundled one if it is
 * the same scenario and seed.
 */
export async function loadScenarioHero(
  api: Api,
  run: { scenario: string; seed: number },
  dataUrl: string,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<Hero> {
  const id = `${run.scenario}-${run.seed}`;
  let reason: string;
  try {
    return parseHero(await api.withMatch(id).exportJson());
  } catch (err) {
    reason = message(err);
  }
  if (id === MATCH_ID) return bundledHero(fetchImpl, dataUrl);
  throw new Error(`the service does not serve ${id} (${reason})`);
}
