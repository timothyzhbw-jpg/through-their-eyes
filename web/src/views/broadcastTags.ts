// Live tags over players in the broadcast view (SPEC 7): sprint speed (threshold-triggered), and
// for the POV player his scans (as the first-person HUD's SCAN / KEY SCAN badge) and his
// blind-side alerts. All come from the export, not from claims, and are marked `sim` on screen:
// live deterministic overlays, not verified claims (as on the board and in first person).

import { speedAt, type Hero, type Run } from "../data/hero";
import { alertsAt, unseenLabel } from "../alerts/blindSide";

/** Sprint threshold, m/s: the same as the live stream's overlay (api/store.py, SPEC 4.6). */
export const SPRINT_MPS = 7.0;

export interface LiveTag {
  player: number;
  kind: "sprint" | "scan" | "blind";
  label: string; // "SPRINT", "KEY SCAN", "BLIND SIDE"
  text: string; // "H9 31 km/h", "H9 unseen 2.1 s"
}

/** Tags at a (fractional) frame: sprinters, then the POV player's scan in progress and his
 * blind-side alerts if shown. */
export function liveTags(
  hero: Hero,
  run: Run,
  frame: number,
  povPlayer: number,
  blindSide: boolean,
): LiveTag[] {
  const tags: LiveTag[] = [];
  for (let j = 0; j < hero.n; j++) {
    const speed = speedAt(hero, run, j, frame);
    if (speed > SPRINT_MPS) {
      const kmh = Math.round(speed * 3.6);
      tags.push({ player: j, kind: "sprint", label: "SPRINT", text: `${hero.ids[j]} ${kmh} km/h` });
    }
  }
  const scan = run.scans.find(
    (s) => s.player === hero.ids[povPlayer] && frame >= s.start && frame <= s.end,
  );
  if (scan) {
    const label = scan.key ? "KEY SCAN" : "SCAN";
    tags.push({ player: povPlayer, kind: "scan", label, text: hero.ids[povPlayer] });
  }
  if (blindSide) {
    for (const a of alertsAt(hero, run, frame)) {
      if (a.observer !== povPlayer) continue;
      const text = `${hero.ids[a.target]} ${unseenLabel(a.unseen)}`;
      tags.push({ player: a.target, kind: "blind", label: "BLIND SIDE", text });
    }
  }
  return tags;
}
