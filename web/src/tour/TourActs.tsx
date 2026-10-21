// The tour card's own button on a step, for what calls the live service: the wrong-number check
// (POST /api/verify), the sound, and the failure drill and its bring-back (each a fresh crew run).
// The tour never presses these by itself; each is the viewer's click on the app's own control.

import type { ComponentType } from "react";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { wrongNumber } from "../tamper/tamper";
import { tourClaim } from "./actions";
import type { ActName } from "./steps";

/** Check the evidence card's prefilled wrong number: the verifier's answer shows in the card. */
function CheckWrongNumber() {
  const { controls, tamper } = useSession();
  const { narration, status } = useBreakdown();
  const checking = useStore(tamper, (t) => t.status === "checking");
  const pick = tourClaim(narration);
  if (status !== "ready" && status !== "failed") return null; // the breakdown is on its way
  if (!pick?.slot || pick.value === null) {
    return <p className="tour-note">This breakdown has no number to change.</p>;
  }
  const { claim, slot, value } = pick;
  return (
    <button
      type="button"
      className="btn"
      disabled={checking}
      onClick={() => {
        if (tamper.get().open !== claim) controls.openTamper(claim);
        void controls.tryValue(claim, slot, wrongNumber(value));
      }}
    >
      {checking ? "Checking…" : "Check a wrong number"}
    </button>
  );
}

function Sound() {
  const { controls, voice } = useSession();
  const on = useStore(voice.state, (v) => v.on);
  return (
    <button type="button" className="btn" onClick={() => controls.setSound(!on)}>
      {on ? "Turn the sound off" : "Turn the sound on"}
    </button>
  );
}

/** Run the drill with the picked agents down, then bring the downed one back. A refusal (the
 * per-client limit, today's cap) shows the service's own reason, as the Producer panel does. */
function Drill() {
  const { controls, producer } = useSession();
  const { origin, status } = useBreakdown();
  const busy = useStore(producer, (p) => p.busy);
  const picked = useStore(producer, (p) => p.down.length > 0);
  const error = useStore(producer, (p) => p.error);
  const drill = origin?.kind === "api" ? origin.drill : null;
  const pending = drill?.pending[0];
  let control;
  if (busy) {
    control = (
      <button type="button" className="btn" disabled>
        {busy === "drill" ? "Running the crew…" : "Bringing it back…"}
      </button>
    );
  } else if (pending) {
    control = (
      <button type="button" className="btn" onClick={() => controls.bringBack(pending)}>
        Bring it back
      </button>
    );
  } else if (drill && !picked) {
    control = <p className="tour-note">Back from its checkpoint.</p>;
  } else {
    control = (
      <button
        type="button"
        className="btn"
        disabled={!picked || status === "loading"}
        title={picked ? undefined : "Pick an agent to take down first"}
        onClick={controls.runDrill}
      >
        Run the drill
      </button>
    );
  }
  return (
    <>
      {control}
      {error && !busy && <p className="tour-note error">{error}</p>}
    </>
  );
}

export const ACT_VIEW: Record<ActName, ComponentType> = {
  checkWrongNumber: CheckWrongNumber,
  sound: Sound,
  drill: Drill,
};
