// The quick tour's panel carries its step's verified lines (SPEC 7), so the caption under the
// picture can stand down while the tour runs: one panel per step. Every number in them comes from
// a verified claim: the breakdown's narration (checked by the Verifier, SPEC 5.3) or the bundled
// "without the look" lines (checked in en and zh at export, explain/look_cost.py), shown by the
// same components the live screen uses. A line of the unchecked offline sample says so.

import { comparisonLines } from "../autoplay/comparison";
import type { Narration, PayloadLine } from "../narration/payload";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { CheckIcon } from "../ui/icons";
import { isVerified, LineText } from "../ui/Narration";
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

export function StepLines({ say }: { say: SayName }) {
  const session = useSession();
  const { narration, status } = useBreakdown();
  const bundled = useStore(withoutLookOf(session).state, (s) => s.data);
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
  const line = narrationLine(narration, say);
  if (!line) {
    return status === "loading" ? (
      <p className="tour-note">The verified line is on its way…</p>
    ) : null;
  }
  const verified = isVerified(narration!, line);
  return (
    <div className="tour-lines">
      <p className="tour-line">
        <LineText text={line.text} verified={verified} />
        {verified ? (
          <span
            className="tour-checked"
            title="Verified: every number in it was checked against the match data"
          >
            <CheckIcon />
            <span className="sr-only"> verified</span>
          </span>
        ) : (
          <span className="tour-sample"> · sample, not checked</span>
        )}
      </p>
    </div>
  );
}
