// Following a player and his eyes (SPEC 7, personalized viewing): choosing who to follow in "Your
// view" makes him the EYES (the first-person view's owner, and the broadcast camera's lock) when
// the moment has his look data: at least one scan of his in the replayed run. Without it the viewer
// is told so and can still watch through his eyes with one button. Pure helpers.

import type { Hero } from "../data/hero";
import type { PlaybackState } from "../store/playback";

/** How many looks (scans) of `id` the moment's run has; 0 for a player that is not in it. */
export function lookCount(hero: Hero, id: string): number {
  return hero.runs.factual.scans.filter((s) => s.player === id).length;
}

export const hasLookData = (hero: Hero, id: string): boolean => lookCount(hero, id) > 0;

/** The shirt number of `id` in this export, or null. */
export function shirtOf(hero: Hero, id: string): number | null {
  return hero.players.find((p) => p.id === id)?.number ?? null;
}

/** What the followed player's eyes look like on this moment, for the line under the picker. */
export interface EyesStatus {
  id: string;
  looks: number;
  /** Whether the EYES selector already shows him. */
  current: boolean;
  /** The sentence a viewer reads. */
  text: string;
  /** The button's name when he is not the EYES yet. */
  button: string;
}

export function eyesStatus(hero: Hero, id: string, povPlayer: string): EyesStatus {
  const looks = lookCount(hero, id);
  const number = shirtOf(hero, id);
  const tag = number === null ? id : `#${number}`;
  return {
    id,
    looks,
    current: povPlayer === id,
    text:
      looks > 0
        ? `${tag} has ${looks === 1 ? "1 look" : `${looks} looks`} in this moment.`
        : `${tag} has no recorded looks in this moment. You can still watch through his eyes.`,
    button: `Watch through ${tag}'s eyes`,
  };
}

/** The playback patch that makes `id` the EYES; the broadcast camera locks on him as well. */
export function eyesPatch(
  state: Pick<PlaybackState, "camera">,
  id: string,
): Pick<PlaybackState, "povPlayer"> & Partial<Pick<PlaybackState, "lock">> {
  return state.camera === "broadcast" ? { povPlayer: id, lock: id } : { povPlayer: id };
}
