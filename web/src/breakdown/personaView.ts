// What each audience sees by default (SPEC 6, "Persona specs"; SPEC 7). Choosing a persona sets
// its view at once, before its breakdown arrives, so the switch is seen as well as heard: the
// casual fan gets his eyes and the runner he looked for; the analyst the tactical board with
// pitch control and the pass options; the coach first person and board side by side, the run
// without the look drawn; the player fan the broadcast camera locked on him; audio description
// the plain broadcast picture. The breakdown then plays the audience's own cut of the plan
// (agents/plan.py `persona_plan`), from the overlays `startOverlays` gives it.

import type { Persona } from "../api/client";
import type { PlaybackState } from "../store/playback";

/** The playback fields a persona's view sets; everything else stays the viewer's. */
export type PersonaView = Pick<
  PlaybackState,
  "focus" | "camera" | "cone" | "options" | "pitchControl" | "beliefGhosts" | "cfGhost"
> & { lockHero: boolean };

export const PERSONA_VIEW: Record<Persona, PersonaView> = {
  casual: {
    focus: "pov",
    camera: "pov",
    cone: false,
    options: false,
    pitchControl: false,
    beliefGhosts: true,
    cfGhost: false,
    lockHero: false,
  },
  analyst: {
    focus: "tactical",
    camera: "pov",
    cone: true,
    options: true,
    pitchControl: true,
    beliefGhosts: true,
    cfGhost: false,
    lockHero: false,
  },
  coach: {
    focus: "split",
    camera: "pov",
    cone: true,
    options: true,
    pitchControl: false,
    beliefGhosts: true,
    cfGhost: true,
    lockHero: false,
  },
  player_fan: {
    focus: "broadcast",
    camera: "broadcast",
    cone: true,
    options: false,
    pitchControl: false,
    beliefGhosts: false,
    cfGhost: false,
    lockHero: true,
  },
  audio_description: {
    focus: "broadcast",
    camera: "broadcast",
    cone: false,
    options: false,
    pitchControl: false,
    beliefGhosts: false,
    cfGhost: false,
    lockHero: false,
  },
};

/** The playback patch that shows `persona`'s view; `hero` is whom the player fan's camera follows
 * (null in a match before its hero is known: the ball, as for everyone else). */
export function personaViewPatch(persona: Persona, hero: string | null): Partial<PlaybackState> {
  const { lockHero, ...view } = PERSONA_VIEW[persona];
  return { ...view, lock: lockHero && hero ? hero : null };
}

/** The overlays a persona's breakdown starts from (its plan turns on the rest). */
export function startOverlays(persona: Persona): { options: boolean; pitchControl: boolean } {
  const { options, pitchControl } = PERSONA_VIEW[persona];
  return { options, pitchControl };
}
