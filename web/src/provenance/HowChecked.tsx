// "How is this checked?" under a note about numbers computed in code (source.ts): opened, it says
// what the numbers are and how that differs from the AI's narration, whose numbers the Verifier
// checks. On demand, so the note itself stays one plain line.

import { HOW_CHECKED, HOW_NARRATION_IS_CHECKED, NOTHING_TO_CHECK } from "./source";

export function HowChecked({ kinds }: { kinds: (keyof typeof HOW_CHECKED)[] }) {
  return (
    <details className="how-checked">
      <summary>How is this checked?</summary>
      <p>
        {kinds.map((k) => HOW_CHECKED[k]).join(" ")} {NOTHING_TO_CHECK} {HOW_NARRATION_IS_CHECKED}
      </p>
    </details>
  );
}
