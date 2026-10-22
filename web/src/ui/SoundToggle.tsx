// The Sound switch (SPEC 7): the narration voice and the crowd, off until the viewer turns them
// on. On a hero moment it is the moment's switch; on a stitched match, the match's (its recap's
// voice, and every breakdown opened from it share it: voice/voice.ts SoundSwitch).

import { useView } from "../session";
import { useStore } from "../store/store";
import { SoundOffIcon, SoundOnIcon } from "./icons";

/** Spoken narration (Azure AI Speech through the API). Off until the viewer turns it on or
 * chooses audio description. Its name stays "Sound"; `aria-pressed` carries the state. The text
 * button shows "Sound" and draws "off" / "on" from aria-pressed (live.css), so what it shows
 * is in its name (WCAG 2.5.3). On a stitched match it is the match's switch (its recap's voice,
 * and every breakdown opened from it). Until the sound has been on once the icon button says
 * "Tap for sound" (then that is its name): browsers start sound only from a tap. A line that
 * could not be spoken says so next to it. */
export function SoundToggle({ icon = false }: { icon?: boolean }) {
  const session = useView();
  const { voice, setSound } =
    session.kind === "hero"
      ? { voice: session.voice, setSound: session.controls.setSound }
      : { voice: session.recap.voice, setSound: session.recap.setSound };
  const on = useStore(voice.state, (s) => s.on);
  const status = useStore(voice.state, (s) => s.status);
  const error = useStore(voice.state, (s) => s.error);
  const asked = useStore(voice.sound, (s) => s.asked);
  const hint = icon && voice.available && !on && !asked;
  const failed = on && status === "failed";
  const title = !voice.available
    ? "The voice needs the live service"
    : failed
      ? `Speech failed: ${error}`
      : on
        ? "Turn the commentary voice and the crowd off"
        : "Speak each narration line as it comes up, with the crowd";
  return (
    <>
      <button
        type="button"
        className={[
          "sound",
          icon ? "btn btn-icon" : "",
          hint ? "with-hint" : "",
          failed ? "failed" : "",
          on && status === "loading" ? "loading" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={hint ? undefined : "Sound"}
        aria-pressed={on}
        disabled={!voice.available}
        title={title}
        onClick={() => setSound(!on)}
      >
        {!icon ? (
          "Sound"
        ) : hint ? (
          <>
            <SoundOffIcon />
            <span className="sound-hint">Tap for sound</span>
          </>
        ) : on ? (
          <SoundOnIcon />
        ) : (
          <SoundOffIcon />
        )}
      </button>
      {icon && failed && (
        <span className="sound-note" role="status" title={title}>
          No voice
        </span>
      )}
    </>
  );
}
