// The Content and Value steps need a verified breakdown to build on (SPEC 7). On a cold visit
// (?step=content) none is on screen yet, so on entering the step the moment's breakdown is asked
// for through the app's own path (session.controls.requestBreakdown: POST /api/breakdowns), but
// only where the service has it cached: the hero moments the site prewarms (infra/prewarm.py,
// every moment × persona × language). Anything else, a breakdown that failed, or one that waits
// on the daily cap, shows a "Generate the breakdown" button instead, so a visit never starts a
// model call by itself.

import { useEffect } from "react";
import type { BreakdownState } from "../breakdown/breakdown";
import { MOMENT_LINKS } from "../moments/moments";
import { useBreakdown, useSession } from "../session";

/** The hero moments whose breakdowns are prewarmed on the deployed service.
 * tests/test_prewarm.py checks each is a moment the pre-warm serves. */
export const PREWARMED: readonly string[] = MOMENT_LINKS.flatMap((m) =>
  m.scenario ? [m.scenario] : [],
);

export type Gate =
  | { kind: "have" } // a verified breakdown is on screen
  | { kind: "load" } // not here yet, and the service has it cached: ask for it
  | { kind: "wait" } // the request is out
  | { kind: "offer"; why: string } // asking might start a model call: the viewer decides
  | { kind: "offline" }; // no service: only the bundled breakdown exists

/** What the step does about the breakdown it needs. Pure: the hook and the tests share it. */
export function gateOf(b: BreakdownState, online: boolean, scenario: string): Gate {
  if (b.narration) return { kind: "have" };
  if (!online) return { kind: "offline" };
  if (b.status === "loading") return { kind: "wait" };
  if (b.status === "failed") {
    return { kind: "offer", why: `The service did not give one${b.error ? ` (${b.error})` : ""}.` };
  }
  if (b.origin?.kind === "api" && !b.origin.cached) {
    return {
      kind: "offer",
      why: "The service made this one fresh rather than serving a cached one, so asking again runs the agent crew again.",
    };
  }
  if (b.origin?.kind === "api" && (b.origin.capped || b.origin.rateLimited)) {
    return { kind: "offer", why: "The service could not serve a cached one." };
  }
  if (!PREWARMED.includes(scenario)) {
    return {
      kind: "offer",
      why: "This moment's breakdown is not prewarmed, so asking for it may run the agent crew.",
    };
  }
  return { kind: "load" };
}

/** The gate of the session on screen. */
export function useGate(): Gate {
  const session = useSession();
  const b = useBreakdown();
  return gateOf(b, session.api !== null, session.hero.scenario);
}

/** On mounting (entering the step), load a cached breakdown that is not on screen yet. */
export function useCachedBreakdown(): void {
  const { controls } = useSession();
  const gate = useGate();
  const load = gate.kind === "load";
  useEffect(() => {
    if (load) controls.requestBreakdown();
  }, [load, controls]);
}

/** In place of what needs a breakdown while there is none: the wait, or the button. */
export function BreakdownWait({ what, offline }: { what: string; offline: string }) {
  const { controls } = useSession();
  const gate = useGate();
  switch (gate.kind) {
    case "have":
      return null;
    case "load":
    case "wait":
      return (
        <p className="note studio-wait" role="status">
          Loading the verified breakdown the {what} is built from…
        </p>
      );
    case "offer":
      return (
        <div className="studio-wait studio-generate">
          <p className="note" role="status">
            {gate.why} The {what} is built from a verified breakdown.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => controls.requestBreakdown()}
          >
            Generate the breakdown
          </button>
        </div>
      );
    case "offline":
      return (
        <p className="note studio-wait" role="status">
          {offline}
        </p>
      );
  }
}
