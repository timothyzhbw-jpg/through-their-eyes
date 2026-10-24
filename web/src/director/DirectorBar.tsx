// The camera director in the page: one suggestion at a time, a chip that switches with one tap
// and says why, and a way to dismiss it. Nothing shows while it has nothing to suggest; the Auto
// director switch is in View options (ui/Stage.tsx). Over the live screen of a hero moment and of
// a stitched match alike, so it reads `useView()`.

import { useEffect, useMemo } from "react";
import { useView } from "../session";
import { useStore } from "../store/store";
import { Director } from "./director";
import { renameIds } from "../data/roster";

/** On a phone, bring the live picture back into view when the viewer asks for the board. */
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

  if (!show) return null;
  const take = () => {
    const tactical = show.shot?.camera === "tactical";
    director.take();
    if (tactical) revealBoard();
  };

  return (
    <section className="director" aria-label="Camera director">
      <div className="director-slot">
        <button
          type="button"
          className={`chip director-chip rule-${show.rule}`}
          onClick={take}
          title="Switch now"
        >
          {/* The words clamp on a phone, not the padded chip (styles.css). */}
          <span className="director-text">
            <b>{renameIds(show.title)}</b>: {renameIds(show.reason)}
          </span>
        </button>
        <button
          type="button"
          className="icon-btn director-dismiss"
          aria-label="Dismiss the suggestion"
          title="Dismiss"
          onClick={director.dismiss}
        >
          ×
        </button>
      </div>
    </section>
  );
}
