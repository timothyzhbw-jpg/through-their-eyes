// The stadium's screens for For studios' Stadium and Value sections: the Stadium Screen Studio's own
// show (stadium/), built once per page from the same bundled files the studio page reads, on the
// programme's event for the moment on screen. Offline: no service, no model. The 3D bowl stays on
// the studio page (?studio=1); here the screens are the flat Screen wall. The studio's code loads
// only when a step needs it, so the first screen does not wait for it.

import { useEffect, useState } from "react";
import type { EventType } from "../stadium/rules";
import type { Show } from "../stadium/show";

/** The bundled moments the programme is built on: the key look is the studio's hero export
 * (STUDIO_FILES.hero, hero_seed3.json), the goal its "without the look" file for far_post_finish
 * (STUDIO_FILES.goalWithout, seed 11). journey.test.tsx checks both against the files. */
export const STADIUM_MOMENTS: readonly { scenario: string; seed: number; event: EventType }[] = [
  { scenario: "blind_side_run", seed: 3, event: "key-look" },
  { scenario: "far_post_finish", seed: 11, event: "goal" },
];

/** The programme's event for this moment, or null when the stadium has no screens of its own for
 * it (the panel then shows the key look's, and says so). */
export function stadiumEventFor(scenario: string, seed: number): EventType | null {
  return STADIUM_MOMENTS.find((m) => m.scenario === scenario && m.seed === seed)?.event ?? null;
}

/** The index of `type` in the programme, else the key look's, else the first. */
export function eventIndex(events: readonly { type: EventType }[], type: EventType | null): number {
  const at = (t: EventType) => events.findIndex((e) => e.type === t);
  const i = type ? at(type) : -1;
  return i >= 0 ? i : Math.max(0, at("key-look"));
}

let showPromise: Promise<Show> | null = null;

/** The page's one show, loaded on first use; null while it loads, an Error if it cannot. */
export function useStadiumShow(): Show | Error | null {
  const [show, setShow] = useState<Show | Error | null>(null);
  useEffect(() => {
    let alive = true;
    showPromise ??= import("../stadium/StudioApp").then((m) =>
      m.loadStudio(`${import.meta.env.BASE_URL}data/`),
    );
    showPromise.then(
      (s) => alive && setShow(s),
      (err) => {
        showPromise = null; // a later visit may try again
        if (alive) setShow(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return show;
}
