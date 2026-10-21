// Toolbar of the tactical board: its label and overlay toggles.

import { runLabels } from "../data/hero";
import { useView, type Toggle } from "../session";
import { useStore } from "../store/store";
import { noBeliefs, SKELETON_TITLE } from "./PovOverlay";

export function TacticalToolbar() {
  const { hero, playback } = useView();
  const focus = useStore(playback, (s) => s.focus);
  const mode = useStore(playback, (s) => s.mode);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const ghostsAvailable = povPlayer === hero.heroId;
  const labels = runLabels(hero);
  return (
    <div className="viewbar">
      <div className="label">
        Tactical
        {focus === "tactical" && <span className="live-dot" aria-hidden="true" />}
      </div>
      <div className="toggles">
        <Chip
          name="cone"
          label="Vision cone"
          disabled={!hero.vision}
          title={
            hero.vision
              ? `${povPlayer}'s field of view`
              : "The vision model comes with a hero moment's export"
          }
        />
        <Chip
          name="beliefGhosts"
          label="Belief ghosts"
          disabled={!ghostsAvailable}
          title={ghostsAvailable ? "Where he believes each player is" : noBeliefs(hero)}
        />
        <Chip
          name="options"
          label="Pass options"
          title="At the decision: every option he weighed, on his belief and on the truth"
        />
        <Chip
          name="blindSide"
          label="Blind side"
          title="Live: who has lost sight of a player on the move, from tracking only"
        />
        <Chip
          name="pitchControl"
          label="Pitch control"
          title="Which team gets to each point of the pitch first (home: coral, away: blue)"
        />
        <Chip name="skeleton" label="Skeleton" title={SKELETON_TITLE} />
        {hero.counterfactual && (
          <Chip
            name="cfGhost"
            label={mode === "factual" ? labels.ghostOfCounterfactual : labels.ghostOfFactual}
            title="Ball path of the other run, from the decision on"
          />
        )}
      </div>
    </div>
  );
}

function Chip(props: { name: Toggle; label: string; title: string; disabled?: boolean }) {
  const { playback, controls } = useView();
  const on = useStore(playback, (s) => s[props.name]);
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={on && !props.disabled}
      disabled={props.disabled}
      title={props.title}
      onClick={() => controls.toggle(props.name)}
    >
      {props.label}
    </button>
  );
}
