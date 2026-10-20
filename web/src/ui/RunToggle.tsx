// The run toggle in the header: what happened, and the counterfactual re-simulation, named by
// its intervention (the dropped look, or the forced action). A stitched match has no second run.

import { runLabels } from "../data/hero";
import { useView } from "../session";
import { useStore } from "../store/store";

export function RunToggle() {
  const { hero, playback, controls } = useView();
  const mode = useStore(playback, (s) => s.mode);
  if (!hero.counterfactual) return null;
  const labels = runLabels(hero);
  return (
    <div className="segmented" role="group" aria-label="Run">
      <button
        type="button"
        aria-pressed={mode === "factual"}
        onClick={() => controls.setMode("factual")}
      >
        {labels.factual}
      </button>
      <button
        type="button"
        className="cf"
        aria-pressed={mode === "counterfactual"}
        onClick={() => controls.setMode("counterfactual")}
      >
        {labels.counterfactual}
      </button>
    </div>
  );
}
