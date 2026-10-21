// Live tags over players in the broadcast view (SPEC 4.6, 7): with the match stats, the ball
// carrier's name and measured sprint, pass, distance and shot tags (marked `tracking`). Without
// them, the sim's sprint tag. Scans and blind-side alerts stay the sim's, for the POV player.

import { alertsAt, unseenLabel } from "../alerts/blindSide";
import { speedAt, type Hero, type Run } from "../data/hero";
import { statTags, type Stats } from "../stats/stats";

/** Sprint threshold, m/s: the same as the live stream's overlay (api/store.py, SPEC 4.6). */
export const SPRINT_MPS = 7.0;

export interface LiveTag {
  player: number;
  kind: "sprint" | "scan" | "blind" | "name" | "speed" | "distance" | "pass" | "shot";
  label: string; // "SPRINT", "KEY SCAN", "BLIND SIDE"
  text: string; // "H9 31 km/h", "H9 unseen 2.1 s"
}

const TRACKING = new Set<LiveTag["kind"]>(["name", "speed", "distance", "pass", "shot"]);

/** Where a tag's number comes from: the tracking feed, or the sim export. */
export function tagSource(kind: LiveTag["kind"]): "sim" | "tracking" {
  return TRACKING.has(kind) ? "tracking" : "sim";
}

/** `owner[frame]`, held inside the run when the playhead sits outside it. */
function ownerAt(owner: ArrayLike<number>, frame: number): number {
  const n = owner.length;
  if (n === 0) return -1;
  const f = Math.floor(frame);
  const i = f < 0 ? 0 : f >= n ? n - 1 : f;
  return owner[i];
}

/** Tags at a (fractional) frame. Stats replace the sim's sprint tags on the factual run only. */
export function liveTags(
  hero: Hero,
  run: Run,
  frame: number,
  povPlayer: number,
  blindSide: boolean,
  stats: Stats | null = null,
): LiveTag[] {
  const tags: LiveTag[] = [];
  if (stats && run.name === "factual") {
    for (const tag of statTags(stats, frame, ownerAt(run.owner, frame))) {
      const player = hero.ids.indexOf(tag.player);
      if (player < 0) continue;
      tags.push({
        player,
        kind: tag.kind === "sprint" ? "speed" : tag.kind,
        label: tag.label,
        text: tag.text,
      });
    }
  } else {
    for (let j = 0; j < hero.n; j++) {
      const speed = speedAt(hero, run, j, frame);
      if (speed > SPRINT_MPS) {
        const kmh = Math.round(speed * 3.6);
        tags.push({
          player: j,
          kind: "sprint",
          label: "SPRINT",
          text: `${hero.ids[j]} ${kmh} km/h`,
        });
      }
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
