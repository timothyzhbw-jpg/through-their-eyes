// DOM around the first-person canvas: the toolbar (label, player picker, comfort and ghost
// toggles), and over the canvas the HUD and the caption of the current narration line.

import { useMemo } from "react";
import { Sample, isSeen, sampleInto, wrapAngle } from "../data/hero";
import { useSession } from "../session";
import { useStore } from "../store/store";
import { Caption } from "../ui/Narration";

export function PovToolbar() {
  const { hero, playback, controls } = useSession();
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const comfort = useStore(playback, (s) => s.comfort);
  const ghosts = useStore(playback, (s) => s.beliefGhosts);
  const focus = useStore(playback, (s) => s.focus);
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
  const hx = sample.pos[2 * me];
  const hy = sample.pos[2 * me + 1];
  const toBall = Math.atan2(sample.ball[1] - hy, sample.ball[0] - hx);
  const offBall = Math.abs(wrapAngle(sample.head[me] - toBall)) * (180 / Math.PI);
  let inSight = 0;
  for (let j = 0; j < hero.n; j++) if (j !== me && isSeen(hero, run, frame, me, j)) inSight++;
  const scan = run.scans.find(
    (s) => s.player === povPlayer && sample.frame >= s.start && sample.frame <= s.end,
  );
  const key = hero.keyScan;
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
    </div>
  );
}
