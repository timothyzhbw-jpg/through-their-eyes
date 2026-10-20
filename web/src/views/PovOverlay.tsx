// DOM around the first-person canvas: the toolbar (label, player picker, comfort and ghost
// toggles), and over the canvas the HUD and the caption of the current narration line.

import { useMemo } from "react";
import { Sample, headOffBall, isSeen, sampleInto } from "../data/hero";
import { useSession } from "../session";
import { useStore } from "../store/store";
import { alertsAt, unseenLabel } from "../alerts/blindSide";
import { Caption } from "../ui/Narration";
import { trial } from "../players/trial";

export function PovToolbar() {
  const { hero, playback, controls } = useSession();
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const comfort = useStore(playback, (s) => s.comfort);
  const ghosts = useStore(playback, (s) => s.beliefGhosts);
  const focus = useStore(playback, (s) => s.focus);
  const rigged = useStore(trial, (s) => s.rigged);
  const player = hero.players[hero.ids.indexOf(povPlayer)];
  const ghostsAvailable = povPlayer === hero.heroId;

  return (
    <div className="viewbar">
      <div className="label">
        First person · {player.id} <span className="role">{player.role}</span>
        {focus === "pov" && <span className="live-dot" aria-hidden="true" />}
      </div>
      <div className="toggles">
        <label className="picker">
          <span className="sr-only">Whose eyes</span>
          <select
            value={povPlayer}
            onChange={(e) => controls.setPovPlayer(e.target.value)}
            aria-label="Whose eyes"
          >
            {[0, 1].map((team) => (
              <optgroup key={team} label={team === 0 ? "Home" : "Away"}>
                {hero.players
                  .filter((p) => p.team === team)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · {p.role}
                      {p.id === hero.heroId ? " (hero)" : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="chip"
          aria-pressed={comfort}
          onClick={() => controls.toggle("comfort")}
          title="Eased head turns and slower playback when the head whips round"
        >
          Comfort
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={ghosts && ghostsAvailable}
          disabled={!ghostsAvailable}
          onClick={() => controls.toggle("beliefGhosts")}
          title={
            ghostsAvailable
              ? "Where he believes each player is"
              : `Beliefs are recorded for ${hero.heroId} only`
          }
        >
          Belief ghosts
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={rigged}
          onClick={() => trial.set({ rigged: !rigged })}
          title="Animated players from Gameplay Football instead of tokens: a one-day trial"
        >
          Rigged players (trial)
        </button>
      </div>
    </div>
  );
}

export function PovOverlay() {
  const { playback } = useSession();
  const comfort = useStore(playback, (s) => s.comfort);
  return (
    <>
      {comfort && <div className="vignette" aria-hidden="true" />}
      <Caption />
      <Hud />
    </>
  );
}

function Hud() {
  const { hero, playback } = useSession();
  const frame = useStore(playback, (s) => s.frame);
  const mode = useStore(playback, (s) => s.mode);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const comfort = useStore(playback, (s) => s.comfort);
  const sample = useMemo(() => new Sample(hero.n), [hero]);

  const run = hero.runs[mode];
  sampleInto(sample, hero, run, frame, comfort);
  const me = hero.ids.indexOf(povPlayer);
  const offBall = headOffBall(sample, me) * (180 / Math.PI);
  let inSight = 0;
  for (let j = 0; j < hero.n; j++) if (j !== me && isSeen(hero, run, frame, me, j)) inSight++;
  const scan = run.scans.find(
    (s) => s.player === povPlayer && sample.frame >= s.start && sample.frame <= s.end,
  );
  const key = hero.keyScan;
  const showBlind = useStore(playback, (s) => s.blindSide);
  const blind = showBlind ? alertsAt(hero, run, frame).filter((a) => a.observer === me) : [];
  const droppedLook =
    mode === "counterfactual" &&
    povPlayer === hero.heroId &&
    sample.frame >= key.start &&
    sample.frame <= key.end;

  return (
    <div className="hud" aria-live="off">
      <span>
        {povPlayer} · head {offBall.toFixed(0)}° from the ball
      </span>
      <span>{inSight} players in sight</span>
      {scan && (
        <span className={scan.key ? "badge key" : "badge"}>{scan.key ? "KEY SCAN" : "SCAN"}</span>
      )}
      {droppedLook && <span className="badge key">no look in this run</span>}
      {blind.map((a) => (
        <span key={a.target} className="blind-hud">
          <span className="badge blind">BLIND SIDE</span> {hero.ids[a.target]}{" "}
          {unseenLabel(a.unseen)}{" "}
          <span className="source" title="Live overlay from tracking, not a verified claim">
            sim
          </span>
        </span>
      ))}
    </div>
  );
}
