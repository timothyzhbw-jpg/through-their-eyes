// The run toggle in the header: what happened, and the counterfactual re-simulation, named by
// its intervention (the dropped look, or the forced action). The other match is always Dusk, never
// Floodlight. A stitched match has no second run.
// One line under it puts the two decisions side by side (ui/outcomeLine.ts).
// Before the stream detects the moment the switch is locked, so a click never leaves the live
// stream.

import { useEffect, useId, useState } from "react";
import { runLabels } from "../data/hero";
import type { RunName } from "../data/types";
import type { LiveMoment, LiveState } from "../live/feed";
import { runLocked, useView } from "../session";
import { createStore, useStore, type Store } from "../store/store";
import { outcomeLine } from "./outcomeLine";
import { Segmented } from "./Segmented";

const NO_FEED: Store<Pick<LiveState, "moments">> = createStore({ moments: [] as LiveMoment[] });

export function RunToggle() {
  const session = useView();
  const { hero, playback, controls } = session;
  const mode = useStore(playback, (s) => s.mode);
  const live = useStore(playback, (s) => s.live);
  const feed = session.kind === "hero" ? session.feed : null;
  const momentId = session.kind === "hero" ? session.moment.id : null;
  const feedState: Store<Pick<LiveState, "moments">> = feed?.state ?? NO_FEED;
  const moments = useStore(feedState, (s) => s.moments);
  const locked = !!feed && momentId !== null && runLocked(live, moments, momentId);
  const hintId = useId();
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    if (!nudge) return;
    const timer = window.setTimeout(() => setNudge(false), 2500);
    return () => window.clearTimeout(timer);
  }, [nudge]);
  if (!hero.counterfactual) return null;
  const labels = runLabels(hero);
  const line = outcomeLine(hero);
  const described = locked ? { locked: true, describedBy: hintId } : {};
  return (
    <>
      <Segmented<RunName>
        label="Run"
        className="run"
        value={mode}
        onPick={controls.setMode}
        onLocked={() => setNudge(true)}
        options={[
          { value: "factual", label: labels.factual, ...described },
          {
            value: "counterfactual",
            label: labels.counterfactual,
            className: "cf",
            title: locked ? "Available once the moment arrives" : undefined,
            ...described,
          },
        ]}
      />
      {line && !locked && (
        <p className="run-outcome" data-testid="run-outcome">
          <span className="with">
            <b>With the look</b> → {line.withLook}
          </span>
          <span className="sep" aria-hidden="true">
            {" · "}
          </span>
          <span className="without">
            <b>Without</b> → {line.without}
          </span>
        </p>
      )}
      {locked && (
        <span className="run-hint" id={hintId} data-nudge={nudge || undefined}>
          Available once the moment arrives
        </span>
      )}
    </>
  );
}
