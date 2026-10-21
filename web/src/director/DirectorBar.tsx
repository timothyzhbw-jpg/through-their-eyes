// The camera director in the page: one suggestion at a time, a chip that switches with one tap
// and says why, a way to dismiss it, and the Auto director switch. Above the views of a hero
// moment and of a stitched match alike, so it reads `useView()`.

import { useEffect, useMemo } from "react";
import { useView } from "../session";
import { useStore } from "../store/store";
import { Director, directorPrefs } from "./director";
import "./director.css";

/** On a phone the views are stacked: show the board when the viewer asks for it. */
function revealBoard(): void {
  if (typeof window === "undefined" || !window.matchMedia?.("(max-width: 880px)").matches) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document
    .querySelector(".view.tac")
    ?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
}

export function DirectorBar() {
  const session = useView();
  const director = useMemo(() => new Director(session), [session]);
  useEffect(() => director.attach(), [director]);
  const show = useStore(director.state, (s) => s.show);
  const directing = useStore(director.state, (s) => s.directing);
  const auto = useStore(directorPrefs, (s) => s.auto);

  const take = () => {
    const tactical = show?.shot?.camera === "tactical";
    director.take();
    if (tactical) revealBoard();
  };

  return (
    <section className="director" aria-label="Camera director">
      <span className="director-mark" aria-hidden="true">
        Director
      </span>
      <div className="director-slot">
        {show ? (
          <>
            <button
              type="button"
              className={`director-chip rule-${show.rule}`}
              onClick={take}
              title="Switch now"
            >
              <b>{show.title}</b>: {show.reason}
            </button>
            <button
              type="button"
              className="director-dismiss"
              aria-label="Dismiss the suggestion"
              title="Dismiss"
              onClick={director.dismiss}
            >
              ×
            </button>
          </>
        ) : (
          <span className="director-idle">
            {directing
              ? "The breakdown is choosing the cameras."
              : auto
                ? "Auto director on: it cuts when play gives a reason."
                : "Pick any camera. A suggestion shows here when play gives a reason to switch."}
          </span>
        )}
      </div>
      <button
        type="button"
        className="chip director-auto"
        aria-pressed={auto}
        onClick={() => directorPrefs.set({ auto: !auto })}
        title="Let the director cut the cameras: it holds each shot a moment, never cuts in the middle of a scan, and never starts a replay"
      >
        Auto director
      </button>
    </section>
  );
}
