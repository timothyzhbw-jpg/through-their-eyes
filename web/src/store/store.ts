// A minimal observable store: one state object, replaced (never mutated) on every `set`.
// React components read it with `useStore(store, selector)`; the render loop and the plan
// executor read it with `store.get()` and write it with `store.set()`.

import { useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const change = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...change };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Re-render when the selected value changes. The selector must return a primitive or an object
 * already in the state (not a new object each call), or React re-renders forever.
 */
export function useStore<T, U>(store: Store<T>, selector: (state: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
