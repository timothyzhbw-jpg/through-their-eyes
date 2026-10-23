// The highlight's shot list (SPEC 7): which frames of the moment the breakdown's plan plays, on
// which camera, under which verified line. Read off the validated plan alone, so the same plan
// always gives the same list, and nothing is encoded: "Play highlight" runs the plan on the
// app's own reel (the breakdown runner), the list is its cut sheet for an editor.

import { renameIds } from "../data/roster";
import { relToFrame, type MomentContext } from "../plan/moment";
import type { Script, TelestrationPlan } from "../plan/schema";

export type ShotCamera = "split" | "pov" | "tactical" | "broadcast" | "player_lock";

export interface Shot {
  n: number; // 1-based
  camera: ShotCamera;
  player: string | null; // whose eyes, for a POV shot
  inFrame: number; // frame of the moment's clip
  outFrame: number;
  speed: number;
  seconds: number; // screen time: frames at the clip's dt, over the speed
  caption: string | null; // the verified line spoken over it, ids written as names
}

export const CAMERA_LABEL: Record<ShotCamera, string> = {
  split: "Split: pitch and eyes",
  pov: "First person",
  tactical: "Tactical board",
  broadcast: "Broadcast",
  player_lock: "Locked on him",
};

/** Shots of a plan: each `pov` and `play` step that covers frames. */
export function shotList(plan: TelestrationPlan, m: MomentContext, script: Script): Shot[] {
  const frame = (rel: number) => Math.round(relToFrame(m, rel));
  const shots: (Omit<Shot, "n" | "caption"> & { t: number })[] = [];
  const lines: { t: number; line: string }[] = [];
  let camera: ShotCamera = "split";
  let cursor = m.decisionFrame;

  for (const step of plan.steps) {
    switch (step.do) {
      case "camera":
        camera = step.mode;
        break;
      case "rewind":
        cursor = frame(step.to);
        break;
      case "pov": {
        const inFrame = frame(step.from);
        const outFrame = frame(step.to);
        shots.push({
          t: step.t,
          camera: "pov",
          player: step.player,
          inFrame,
          outFrame,
          speed: step.speed,
          seconds: seconds(m, inFrame, outFrame, step.speed),
        });
        cursor = outFrame;
        break;
      }
      case "play": {
        const outFrame = frame(step.to);
        if (outFrame > cursor) {
          shots.push({
            t: step.t,
            camera,
            player: null,
            inFrame: cursor,
            outFrame,
            speed: step.speed,
            seconds: seconds(m, cursor, outFrame, step.speed),
          });
        }
        cursor = outFrame;
        break;
      }
      case "voice":
        if (step.line in script) lines.push({ t: step.t, line: step.line });
        break;
      default:
        break;
    }
  }

  // A line sits under the last shot that began before it; lines before the first shot sit under it.
  return shots.map(({ t, ...shot }, k) => {
    const next = shots[k + 1]?.t ?? Infinity;
    const under = lines.find((l) => (k === 0 || l.t >= t) && l.t < next);
    return {
      n: k + 1,
      ...shot,
      caption: under ? renameIds(script[under.line]) : null,
    };
  });
}

function seconds(m: MomentContext, from: number, to: number, speed: number): number {
  return Math.round(((to - from) * m.dt * 100) / speed) / 100;
}

/** The shot list as plain text (what the panel copies): one shot a line. */
export function shotListText(shots: readonly Shot[]): string {
  return shots
    .map(
      (s) =>
        `${s.n}. frames ${s.inFrame}–${s.outFrame}, ${CAMERA_LABEL[s.camera]}` +
        (s.player ? ` (${renameIds(s.player)})` : "") +
        `, ${s.seconds} s` +
        (s.caption ? `: “${s.caption}”` : ""),
    )
    .join("\n");
}
