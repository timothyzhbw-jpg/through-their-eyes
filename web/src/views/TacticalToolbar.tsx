// Toolbar of the tactical board: its label and overlay toggles.

import { useSession, type Toggle } from "../session";
import { useStore } from "../store/store";

export function TacticalToolbar() {
  const { hero, playback } = useSession();
  const focus = useStore(playback, (s) => s.focus);
  const mode = useStore(playback, (s) => s.mode);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const ghostsAvailable = povPlayer === hero.heroId;
  return (
    <div className="viewbar">
      <div className="label">
        Tactical
        {focus === "tactical" && <span className="live-dot" aria-hidden="true" />}
      </div>
      <div className="toggles">
        <Chip name="cone" label="Vision cone" title={`${povPlayer}'s field of view`} />
        <Chip
          name="beliefGhosts"
          label="Belief ghosts"
          disabled={!ghostsAvailable}
          title={
            ghostsAvailable
              ? "Where he believes each player is"
              : `Beliefs are recorded for ${hero.heroId} only`
          }
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
        <Chip
          name="cfGhost"
          label={mode === "factual" ? "Ghost: no look" : "Ghost: with look"}
          title="Ball path of the other run, from the decision on"
        />
      </div>
    </div>
  );
}

function Chip(props: { name: Toggle; label: string; title: string; disabled?: boolean }) {
  const { playback, controls } = useSession();
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
