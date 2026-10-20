// What the app starts from. With an API base URL and a service that answers its health probe in
// time, the match export comes from the API and the app plays live; otherwise everything comes
// from the bundled files in public/data, as before the API existed, and the header says
// "Offline data". The bundled render payload (a fixture) and what-if answers are loaded either
// way: the payload is the narration when the service cannot give one, the what-ifs carry the
// forced runs the suggested questions replay.

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
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

  let hero: Hero | null = null;
  let api: Api | null = null;
  let offline: string | null = "no live service configured (VITE_API_URL is not set)";
  if (opts.apiBase) {
    const candidate = createApi(opts.apiBase, opts.match ?? MATCH_ID, fetchImpl);
    try {
      await candidate.health(opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS);
      hero = parseHero(await candidate.exportJson());
      api = candidate;
      offline = null;
    } catch (err) {
      offline = `the live service did not answer (${message(err)})`;
    }
  }
  if (!hero) {
    const url = opts.dataUrl + HERO_FILE;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    hero = parseHero(await res.json());
  }
  const [payload, whatIfs] = await bundled;
  return { hero, payload, whatIfs, api, offline };
}
