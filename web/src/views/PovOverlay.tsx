// DOM over the 3D canvas: the comfort vignette. The first-person readouts (Hud, below) sit on the
// live screen next to the player picker (ui/Stage.tsx); the camera switch and the view's toggles
// in its bar; the caption over the picture (ui/Narration.tsx).

import { useMemo } from "react";
import { RemovedLookEdge } from "../without/WithoutLook";
import { Sample, headOffBall, isSeen, sampleInto, type Hero } from "../data/hero";
import { useView } from "../session";
import { useStore } from "../store/store";
import { alertsAt, unseenLabel } from "../alerts/blindSide";
import { shortName } from "../data/roster";

/** The Skeleton chip's tooltip, on the broadcast camera and the tactical board (SPEC 7). */
export const SKELETON_TITLE =
  "Skeleton data: every player's torso and head yaw, as limb tracking shows them (optional)";

/** Why the belief ghosts are off for this player: beliefs are recorded for the hero only. */
export function noBeliefs(hero: Hero): string {
  return hero.heroId
    ? `Beliefs are recorded for ${hero.heroId} only`
    : "Beliefs are recorded in a hero moment's breakdown";
}

export function PovOverlay() {
  const { playback } = useView();
  const comfort = useStore(playback, (s) => s.comfort);
  const pov = useStore(playback, (s) => s.camera === "pov");
  return (
    <>
      {pov && comfort && <div className="vignette" aria-hidden="true" />}
      <RemovedLookEdge />
    </>
  );
}

/** What he sees right now: head to ball, players in sight, the scan, blind-side alerts. */
export function Hud() {
  const { hero, playback } = useView();
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
    !!key &&
    mode === "counterfactual" &&
    povPlayer === hero.heroId &&
    sample.frame >= key.start &&
    sample.frame <= key.end;

  return (
    <div className="hud" aria-live="off">
      <span>
        {shortName(povPlayer)} · head {offBall.toFixed(0)}° from the ball
        {run.sight && <> · {inSight} players in sight</>}{" "}
        <span className="source" title="Live readouts from the sim, not a verified claim">
          sim
        </span>
      </span>
      {scan && (
        <span className={scan.key ? "badge key" : "badge"}>{scan.key ? "KEY SCAN" : "SCAN"}</span>
      )}
      {droppedLook && <span className="badge cf">removed look</span>}
      {blind.map((a) => (
        <span key={a.target} className="blind-hud">
          <span className="badge blind">BLIND SIDE</span> {shortName(hero.ids[a.target])}{" "}
          {unseenLabel(a.unseen)}{" "}
          <span className="source" title="Live overlay from tracking, not a verified claim">
            sim
          </span>
        </span>
      ))}
    </div>
  );
}
