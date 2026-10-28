// Two camera modes beside the camera switch on the bar (SPEC 7), neither a new camera: Player cam
// is the broadcast camera locked on the moment's hero (what a breakdown's "player_lock" step and
// the player fan's camera do), and the Auto director is the same switch as in View options →
// Camera. Picking a camera in the switch still clears the lock (session.ts setCamera / setFocus).
// View options → Camera has Player cam too: a phone hides this pair (cameraExtras.css), and a
// stitched match, which has no hero and the possession jumps on its bar, does not show it.

import { directorPrefs } from "../director/director";
import { useView, type ViewSession } from "../session";
import { useStore } from "../store/store";
import "./cameraExtras.css";

/** The moment's hero; null in a stitched match. */
const heroOf = (session: ViewSession): string | null =>
  session.kind === "hero" ? session.moment.hero : session.hero.heroId;

/** The broadcast camera follows the hero instead of the ball; pressed again, the ball. Hidden
 * when the session has no hero (a stitched match). */
export function PlayerCam() {
  const session = useView();
  const { playback } = session;
  const heroId = heroOf(session);
  const focus = useStore(playback, (s) => s.focus);
  const camera = useStore(playback, (s) => s.camera);
  const lock = useStore(playback, (s) => s.lock);
  if (!heroId) return null;
  const on = camera === "broadcast" && lock === heroId;
  const toggle = () =>
    playback.set(
      on
        ? { lock: null }
        : {
            camera: "broadcast",
            // The picture in picture stays as it was, as in the camera switch (Stage.tsx).
            focus: focus === "pov" || focus === "broadcast" ? "broadcast" : "split",
            lock: heroId,
          },
    );
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={on}
      onClick={toggle}
      title="The broadcast camera follows him instead of the ball"
    >
      Player cam
    </button>
  );
}

/** The Auto director switch of View options, on the bar too. Its name says what it does, so a
 * locator for View options' "Auto director" (exact) finds that one alone. */
export function AutoDirector() {
  const auto = useStore(directorPrefs, (s) => s.auto);
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={auto}
      aria-label="Auto director (cuts the cameras)"
      onClick={() => directorPrefs.set({ auto: !auto })}
      title="Let the director cut the cameras: it holds each shot a moment, never cuts in the middle of a scan, and never starts a replay"
    >
      Auto director
    </button>
  );
}

/** Rendered right after the camera switch, in a hero moment. */
export function CameraExtras() {
  const session = useView();
  if (!heroOf(session)) return null;
  return (
    <div className="camera-extras">
      <PlayerCam />
      <AutoDirector />
    </div>
  );
}
