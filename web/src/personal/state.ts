// The viewer's choices as one store the views read (the board, the 3D view, the moment lists),
// and the glue between it, the address and localStorage. The audience and language are applied by
// the breakdown (hero) or the recap (match): `audienceOf` gives both the same shape.

import type { Persona } from "../api/client";
import { createStore, type Store } from "../store/store";
import type { ViewSession } from "../session";
import type { Language } from "../whatif/whatif";
import { NO_CHOICES, type Choices } from "./follow";
import { writeAddress, writeSaved } from "./persist";

export type PersonalStore = Store<Choices>;

export const createPersonal = (initial: Choices = NO_CHOICES): PersonalStore =>
  createStore<Choices>(initial);

/** The one the page uses; main.tsx fills it from the address and storage. */
export const personal: PersonalStore = createPersonal();

/** Where a view's audience and language live and how to change them. */
export interface Audience {
  get(): { persona: Persona; language: Language };
  subscribe(listener: () => void): () => void;
  /** Choose another audience or language: the cached breakdown (or recap) for it, never a new
   * one when the service is off. */
  set(patch: { persona?: Persona; language?: Language }): void;
  online: boolean; // false: only the bundled breakdown exists, nothing else can be chosen
}

export function audienceOf(view: ViewSession): Audience {
  if (view.kind === "match") {
    const { recap } = view;
    return {
      get: () => recap.state.get(),
      subscribe: recap.state.subscribe,
      // Before the recap is asked for, choosing only sets what "Write the match recap" will ask;
      // after, it is the recap's own switch (cached for every audience the site serves).
      set: (patch) =>
        recap.state.get().status === "idle" ? recap.state.set(patch) : void recap.request(patch),
      online: view.api !== null,
    };
  }
  const { breakdown, controls } = view;
  return {
    get: () => breakdown.get(),
    subscribe: breakdown.subscribe,
    set: (patch) => {
      if (patch.persona) controls.setPersona(patch.persona);
      if (patch.language) controls.setLanguage(patch.language);
    },
    online: view.api !== null,
  };
}

/** Write the choices to the address and to storage after every change; returns the unsubscribe. */
export function persistOnChange(
  store: PersonalStore,
  write: (c: Choices) => void = (c) => {
    writeAddress(c);
    writeSaved(c);
  },
): () => void {
  let last = store.get();
  return store.subscribe(() => {
    const now = store.get();
    if (
      now.persona === last.persona &&
      now.language === last.language &&
      now.team === last.team &&
      now.player === last.player
    ) {
      return;
    }
    last = now;
    write(now);
  });
}
