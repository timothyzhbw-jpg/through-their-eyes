// The quick tour's panel carries its step's verified lines (SPEC 7), so the caption under the
// picture can stand down while the tour runs: one panel per step. Every number in them comes from
// a verified claim: the breakdown's narration (checked by the Verifier, SPEC 5.3) or the bundled
// "without the look" lines (checked in en and zh at export, explain/look_cost.py), shown by the
// same components the live screen uses. A line of the unchecked offline sample says so. With the
// Sound switch on, the step's line is spoken as it shows, as the caption's lines are (session.ts).

import { useEffect } from "react";
import { comparisonLines } from "../autoplay/comparison";
import type { Narration, PayloadLine } from "../narration/payload";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { CheckIcon } from "../ui/icons";
import { isVerified, LineText, lineClaims } from "../ui/Narration";
import { withoutLookOf } from "../without/without";
import { WithoutLookLines, WithoutLookNote } from "../without/WithoutLook";
import type { SayName } from "./steps";

const CF_VALUE = "cf_value"; // explain/builders.py: what the change was worth

/** The breakdown's line for this step: the look's, the run without it, or the comparison. */
function narrationLine(narration: Narration | null, say: SayName): PayloadLine | null {
  if (!narration) return null;
  const { withLook, withoutLook } = comparisonLines(narration);
  const id =
    say === "look"
      ? withLook
      : say === "without"
        ? withoutLook
        : (narration.lines.find((l) => l.claims.includes(CF_VALUE))?.id ?? null);
  return narration.lines.find((l) => l.id === id) ?? null;
}

export function StepLines({ say, speak = false }: { say: SayName; speak?: boolean }) {
  const session = useSession();
  const { narration, status, voice } = useBreakdown();
  const bundled = useStore(withoutLookOf(session).state, (s) => s.data);
  const soundOn = useStore(session.voice.state, (s) => s.on);
  const told =
    bundled && (say === "without" || say === "compare") ? null : narrationLine(narration, say);
  const toldId = told?.id ?? null;
  useEffect(() => {
    if (!speak || !toldId || !soundOn) return;
    void session.voice.say(voice.find((c) => c.line === toldId));
  }, [speak, toldId, soundOn, voice, session]);
  // The run without the look, told by its bundled lines where the moment has them.
  if (bundled && say === "without") {
    return (
      <div className="tour-lines">
        <WithoutLookNote />
      </div>
    );
  }
  if (bundled && say === "compare") {
    return (
      <div className="tour-lines">
        <WithoutLookLines />
      </div>
    );
  }
  const line = told;
  if (!line) {
    return status === "loading" ? (
      <p className="tour-note">The verified line is on its way…</p>
    ) : null;
  }
  const verified = isVerified(narration!, line);
  return (
    <div className="tour-lines">
      <p className="tour-line" lang={narration!.payload.language}>
        <LineText text={line.text} verified={verified} claims={lineClaims(narration!, line)} />
        {verified ? (
          <span
            className="tour-checked"
            lang="en"
            title="Verified: every number in it was checked against the match data"
          >
            <CheckIcon />
            <span className="sr-only"> verified</span>
          </span>
        ) : (
          <span className="tour-sample" lang="en">
            {" "}
            · sample, not checked
          </span>
        )}
      </p>
    </div>
  );
}
