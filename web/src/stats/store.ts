// One live-stats load per session (SPEC 4.6): GET /api/matches/<id>/stats?tracks=true when the
// session has a service, then the viewer's own parse. Offline, there is nothing to load.

import { useView, type ViewSession } from "../session";
import { useStore, createStore, type Store } from "../store/store";
import { parseStats, prepare, type Stats } from "./stats";

export type StatsStatus = "loading" | "ready" | "failed" | "offline";

export interface StatsState {
  status: StatsStatus;
  stats: Stats | null;
  error: string | null;
}

const stores = new WeakMap<ViewSession, Store<StatsState>>();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The session's stats store, created on the first ask and shared after that. */
export function statsStore(view: ViewSession): Store<StatsState> {
  const existing = stores.get(view);
  if (existing) return existing;
  if (!view.api) {
    const offline = createStore<StatsState>({ status: "offline", stats: null, error: null });
    stores.set(view, offline);
    return offline;
  }
  const store = createStore<StatsState>({ status: "loading", stats: null, error: null });
  stores.set(view, store);
  void view.api.stats().then(
    (body) => {
      try {
        store.set({ status: "ready", stats: prepare(parseStats(body)), error: null });
      } catch (err) {
        store.set({ status: "failed", stats: null, error: message(err) });
      }
    },
    (err) => store.set({ status: "failed", stats: null, error: message(err) }),
  );
  return store;
}

/** The session on screen and its stats. */
export function useStats(): StatsState {
  const view = useView();
  return useStore(statsStore(view), (s) => s);
}
