// The run toggle in the header: what happened, and the counterfactual re-simulation, named by
// its intervention (the dropped look, or the forced action). The other match is always Dusk, never
// Floodlight. A stitched match has no second run.

import { runLabels } from "../data/hero";
import type { RunName } from "../data/types";
import { useView } from "../session";
import { useStore } from "../store/store";
import { Segmented } from "./Segmented";

export function RunToggle() {
  const { hero, playback, controls } = useView();
  const mode = useStore(playback, (s) => s.mode);
  if (!hero.counterfactual) return null;
  const labels = runLabels(hero);
  return (
    <Segmented<RunName>
      label="Run"
      className="run"
      value={mode}
      onPick={controls.setMode}
      options={[
        { value: "factual", label: labels.factual },
        { value: "counterfactual", label: labels.counterfactual, className: "cf" },
      ]}
    />
  );
}
