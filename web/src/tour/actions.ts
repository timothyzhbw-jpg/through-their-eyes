// What each tour step does when it comes up: only the app's own controls, the ones a viewer's
// clicks call. Each one sets its step up from whatever the viewer left on screen (Back, a jump,
// their own clicks), so running it twice changes nothing more. Nothing here calls a model or
// costs a request beyond what the step shows; the wrong-number check and the failure drill wait
// for the tour card's own button (TourActs.tsx).

import type { Agent, Persona } from "../api/client";
import type { Narration } from "../narration/payload";
import type { MatchSession } from "../match/matchSession";
import type { Session, ViewSession } from "../session";
import { numericValues } from "../tamper/tamper";
import type { Language } from "../whatif/whatif";
import { yourCallOf } from "../yourcall/controller";
import type { EnterName } from "./steps";

type Cleanup = () => void;
type Enter = (session: Session) => Cleanup | void;

/** The agent the failure drill takes down: its fallback (the template plan) is easy to see. */
export const DRILL_AGENT: Agent = "telestrator";

/** The audience whose commentary carries numbers (the casual fan's has none), so the evidence
 * and the wrong-number steps have one to show; and the one the language step switches to. */
export const NUMBERS_FOR: Persona = "analyst";
export const SWITCH_TO: { persona: Persona; language: Language } = {
  persona: "casual",
  language: "zh",
};

/** The line the evidence and wrong-number steps open: the first whose claim has a number and an
 * evidence frame, so both steps show the same claim; else the first line with any claim. */
export function tourClaim(
  narration: Narration | null,
): { line: string; claim: string; slot: string | null; value: number | null } | null {
  if (!narration) return null;
  let first: { line: string; claim: string; slot: null; value: null } | null = null;
  for (const line of narration.lines) {
    for (const id of line.claims) {
      const claim = narration.claims.get(id);
      if (!claim) continue;
      const [number] = numericValues(claim);
      if (number && claim.seek_frame != null) {
        return { line: line.id, claim: id, slot: number[0], value: number[1] };
      }
      first ??= { line: line.id, claim: id, slot: null, value: null };
    }
  }
  return first;
}

/** Close what one step leaves open that would cover the next: Your call, the evidence card. */
function clear(s: Session, keep: { evidence?: boolean; yourCall?: boolean } = {}): void {
  const yc = yourCallOf(s);
  if (!keep.yourCall && yc.state.get().step !== "closed") yc.close();
  if (!keep.evidence && s.playback.get().evidenceLine) s.controls.closeEvidence();
}

/**
 * Run `then` once the breakdown on screen is settled (asking the service for it if nobody has),
 * after the session has finished putting it on screen. Returns a cancel for a step left early.
 */
function whenBreakdown(s: Session, then: () => void): Cleanup {
  const settled = () => ["ready", "failed"].includes(s.breakdown.get().status);
  if (settled()) {
    then();
    return () => {};
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  let off: (() => void) | null = s.breakdown.subscribe(() => {
    if (!settled() || !off) return;
    off();
    off = null;
    timer = setTimeout(then, 0); // the session's show() is still running
  });
  if (s.breakdown.get().status === "waiting") s.controls.requestBreakdown();
  return () => {
    off?.();
    off = null;
    if (timer) clearTimeout(timer);
  };
}

/** The Analyst's commentary (online; offline the bundled breakdown is all there is). A no-op when
 * it is on screen already; otherwise its breakdown is asked for (cached on the service). */
function withNumbers(s: Session): void {
  if (s.api) s.controls.setPersona(NUMBERS_FOR);
}

/** Open the tour's line at its claim's evidence, unless it is open already. */
function openTourLine(s: Session): ReturnType<typeof tourClaim> {
  const pick = tourClaim(s.breakdown.get().narration);
  if (pick && s.playback.get().evidenceLine !== pick.line)
    s.controls.openLine(pick.line, pick.claim);
  return pick;
}

/** Set a step up on whichever page shows it: the hero moment's, or the stitched match's (its
 * recap). A step meant for the other page does nothing here. */
export function enterStep(name: EnterName, s: ViewSession): Cleanup | void {
  if (name === "recap") return s.kind === "match" ? openRecap(s) : undefined;
  if (s.kind === "hero") return ENTER[name](s);
}

/** The match's recap as at full time, unless it is on screen already (the `?play=recap` link
 * the hero page's step opens has asked for it): the card on the live screen, the reel to play. */
function openRecap(s: MatchSession): void {
  const { fullTime, status } = s.recap.state.get();
  if (fullTime && (status === "ready" || status === "loading")) return;
  s.recap.openAtFullTime(null, null);
}

const ENTER: Record<Exclude<EnterName, "recap">, Enter> = {
  none: (s) => clear(s),

  /** The Telestrator's breakdown with the Analyst's commentary: the first-person replay with its
   * key scan, and captions whose numbers are verified. */
  replay(s) {
    clear(s);
    s.controls.leaveLive();
    s.controls.setMode("factual");
    withNumbers(s);
    s.controls.playBreakdown();
  },

  /** The re-simulated run from just before the look (or a second before the decision), with
   * the other run's path drawn as a ghost and the board beside his eyes. */
  counterfactual(s) {
    clear(s);
    const { controls, playback, hero, moment } = s;
    controls.leaveLive();
    controls.setMode("counterfactual");
    if (!playback.get().cfGhost) controls.toggle("cfGhost");
    const focus = playback.get().focus;
    if (focus === "pov" || focus === "broadcast") controls.setFocus("split");
    controls.seek(
      Math.max(0, hero.keyScan?.start ?? moment.decisionFrame - Math.round(1 / hero.dt)),
    );
    if (!playback.get().playing) controls.togglePlay();
  },

  openEvidence(s) {
    clear(s, { evidence: true });
    withNumbers(s);
    return whenBreakdown(s, () => void openTourLine(s));
  },

  /** The same line's evidence with "Try a wrong number" open on its claim; the check itself is
   * the card's button. */
  openTamper(s) {
    clear(s, { evidence: true });
    withNumbers(s);
    return whenBreakdown(s, () => {
      const pick = openTourLine(s);
      if (pick?.slot && s.tamper.get().open !== pick.claim) s.controls.openTamper(pick.claim);
    });
  },

  yourCall(s) {
    clear(s, { yourCall: true });
    const yc = yourCallOf(s);
    if (yc.state.get().step === "closed") yc.open();
  },

  /** The same moment for another audience in another language, played (asked for at once). */
  audience(s) {
    clear(s);
    s.controls.leaveLive();
    s.controls.setPersona(SWITCH_TO.persona);
    s.controls.setLanguage(SWITCH_TO.language);
    s.controls.playBreakdown();
  },

  /** The Producer's desk with the drill's agent picked; running it is the card's button. */
  producer(s) {
    clear(s);
    const { breakdown, producer, controls } = s;
    if (breakdown.get().status === "waiting") controls.requestBreakdown();
    const origin = breakdown.get().origin;
    const pending = origin?.kind === "api" && !!origin.drill?.pending.length;
    if (!pending && !producer.get().down.length) controls.toggleDown(DRILL_AGENT);
  },
};
