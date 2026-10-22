// One tactics-cards load per session (SPEC 4.8): GET /api/matches/<id>/tactics when the session
// has a service, then the viewer's own parse. Offline, there is nothing to load.

import { useView, type ViewSession } from "../session";
import { createStore, useStore, type Store } from "../store/store";
import { parseTactics, type TacticsView } from "./tactics";

export type TacticsStatus = "loading" | "ready" | "failed" | "offline";

export interface TacticsState {
  status: TacticsStatus;
  tactics: TacticsView | null;
  error: string | null;
}

const stores = new WeakMap<ViewSession, Store<TacticsState>>();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The session's tactics store, created on the first ask and shared after that. */
export function tacticsStore(view: ViewSession): Store<TacticsState> {
  const existing = stores.get(view);
  if (existing) return existing;
  if (!view.api) {
    const offline = createStore<TacticsState>({ status: "offline", tactics: null, error: null });
    stores.set(view, offline);
    return offline;
  }
  const store = createStore<TacticsState>({ status: "loading", tactics: null, error: null });
  stores.set(view, store);
  void view.api.tactics().then(
    (body) => {
      try {
        store.set({ status: "ready", tactics: parseTactics(body), error: null });
      } catch (err) {
        store.set({ status: "failed", tactics: null, error: message(err) });
      }
    },
    (err) => store.set({ status: "failed", tactics: null, error: message(err) }),
  );
  return store;
}

/** The session on screen and its tactics cards. */
export function useTactics(): TacticsState {
  const view = useView();
  return useStore(tacticsStore(view), (s) => s);
}
