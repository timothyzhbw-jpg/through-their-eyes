// The camera director in the page, quietly: it follows the live screen of a hero moment and of a
// stitched match alike (so it reads `useView()`), and with the Auto director on (View options,
// ui/Stage.tsx) it cuts by itself. A suggestion it has for a camera shows as a small dot on that
// camera in the camera switch, which says why in its name and takes the suggestion when picked;
// nothing else of it is on the picture.

import { useEffect } from "react";
import { renameIds } from "../data/roster";
import type { ViewSession } from "../session";
import { useStore } from "../store/store";
import { Director } from "./director";
import type { Shot, Suggestion } from "./rules";

const directors = new WeakMap<ViewSession, Director>();

/** The session's director: one per session, so the camera switch and the page share it. */
export function directorOf(session: ViewSession): Director {
  let d = directors.get(session);
  if (!d) directors.set(session, (d = new Director(session)));
  return d;
}

/** Keep the session's director following the playhead while the live screen is up. */
export function DirectorAttach({ session }: { session: ViewSession }) {
  useEffect(() => directorOf(session).attach(), [session]);
  return null;
}

/** The camera a suggestion cuts to, as the camera switch names it; null for a breakdown or a
 * replay without a shot (the moment card has the breakdown). */
export function suggestedCamera(s: Suggestion | null): Shot["camera"] | null {
  return s?.shot?.camera ?? null;
}

/** The pending suggestion on a camera, for the switch: what it says, in plain words. */
export function useSuggestion(
  session: ViewSession,
): { camera: Shot["camera"]; text: string } | null {
  const show = useStore(directorOf(session).state, (s) => s.show);
  const camera = suggestedCamera(show);
  if (!show || !camera) return null;
  return { camera, text: `${renameIds(show.title)}: ${renameIds(show.reason)}` };
}
