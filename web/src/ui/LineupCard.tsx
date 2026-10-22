// The pre-match opening lives above both kinds of live screen. Its store belongs to the page,
// so opening a possession's breakdown never brings it back. It opens over a stream that is
// already playing, and closes by itself, on Start/Skip/Escape, or on any other click or key.

import { useEffect, useId, useRef, useState } from "react";
import { useView } from "../session";
import { useStore } from "../store/store";
import { ArrowIcon } from "./icons";
import { intro } from "./intro";
import { lineup, measure, runMinutes, watchOptions, type LineupRow } from "./lineup";
import { TourButton } from "../tour/Tour";
import { clubName, shortName } from "../data/roster";
import { SourceChip } from "../provenance/SourceChip";

export const INTRO_MS = 5000; // the card closes by itself after this long

/** How long the run is: seconds under a minute (a hero moment), else minutes. */
export function playLength(minutes: number): string {
  return minutes < 1
    ? `${(minutes * 60).toFixed(1)} seconds of play`
    : `${minutes.toFixed(1)} minutes of play`;
}

export function LineupCard() {
  const open = useStore(intro, (s) => s.open);
  return open ? <OpenLineupCard /> : null;
}

function OpenLineupCard() {
  const { hero, playback, kind } = useView();
  // Not controls.setPovPlayer: its viewer take-over would cancel the autoplay behind the card.
  const teams = lineup(hero);
  const options = watchOptions(hero);
  const [chosen, setChosen] = useState(options[0]?.id ?? null);
  const [counting, setCounting] = useState(true);
  const [reduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const measured = measure(hero);
  const size = (row: LineupRow) => (measured === "count" ? row.scans : row.scansPerMinute);
  const highest = Math.max(0, ...teams.home.concat(teams.away).map(size));

  useEffect(() => {
    if (!counting) return;
    const timer = window.setTimeout(() => intro.set({ open: false }), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [counting]);

  useEffect(() => {
    const previous = document.activeElement;
    // With nothing focused before (a fresh load), the focus goes to the live screen's title on
    // close: left on <body>, the next Tab would start after the card, past the whole live screen.
    const title = dialog.current?.closest(".stage")?.querySelector<HTMLElement>(".stage-head h1");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    start.current?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        intro.set({ open: false });
        return;
      }
      if (event.key === "Tab") {
        setCounting(false);
        const focusable = dialog.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      // Enter and Space act on the focused button. The bare modifiers do nothing.
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "Shift" ||
        event.key === "Control" ||
        event.key === "Alt" ||
        event.key === "Meta"
      ) {
        return;
      }
      intro.set({ open: false });
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      const back =
        previous instanceof HTMLElement && previous !== document.body && previous.isConnected
          ? previous
          : title;
      back?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="lineup-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={counting ? `${titleId}-auto` : undefined}
      ref={dialog}
      onClick={(event) => {
        if ((event.target as Element).closest("button, a, input, select, textarea, label")) return;
        intro.set({ open: false });
      }}
    >
      {counting && !reduced && (
        <span
          className="lineup-countdown"
          style={{ animationDuration: `${INTRO_MS}ms` }}
          aria-hidden="true"
        />
      )}
      {/* What the countdown line shows, for a screen reader (WCAG 2.2.1): it can be stopped. */}
      {counting && (
        <p className="sr-only" id={`${titleId}-auto`}>
          This card closes by itself in {INTRO_MS / 1000} seconds. Press Tab to keep it open.
        </p>
      )}
      <div className="lineup-inner">
        <header className="lineup-head">
          <p className="kicker">A synthetic match · every player fictional</p>
          <h2 id={titleId}>
            {clubName(0)} <em>v</em> {clubName(1)}
          </h2>
          <p className="lineup-pitch">
            <em>See what they saw.</em> An AI studio that explains key moments through the player's
            own perception — the scans before the ball arrived, what was visible, what he believed —
            and checks every number the crew says or captions before it airs.
          </p>
        </header>

        <div className="lineup-teams">
          {(["home", "away"] as const).map((team) => {
            const name = clubName(team === "home" ? 0 : 1);
            return (
              <section className="lineup-team" key={team} aria-label={`${name} players`}>
                <header className="lineup-team-head">
                  <h3>
                    <i style={{ background: `var(--${team})` }} aria-hidden="true" />
                    {name}
                  </h3>
                  <span>{measured === "count" ? "Scans" : "Scans / min"}</span>
                </header>
                <ol aria-label={`${name} line-up`}>
                  {teams[team].map((row) => (
                    <li
                      key={row.id}
                      data-player={row.id}
                      className={row.hero ? "lineup-hero" : undefined}
                    >
                      <span className="lineup-number">{row.number}</span>
                      <span className="lineup-player">
                        <span>
                          {shortName(row.id)}
                          {row.hero && <span className="sr-only"> · Hero</span>}
                        </span>
                        <span className="lineup-role">{row.role}</span>
                      </span>
                      <span className="lineup-bar" aria-hidden="true">
                        <i style={{ width: `${highest > 0 ? (size(row) / highest) * 100 : 0}%` }} />
                      </span>
                      <span className="lineup-rate">
                        {measured === "count" ? row.scans : row.scansPerMinute.toFixed(1)}
                        <span className="sr-only">
                          {measured === "count" ? " scans" : " scans per minute"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>

        <p className="lineup-note">
          A scan is a quick look away from the ball to check the space around him.{" "}
          {measured === "count" ? "Scans counted" : "Scans per minute, counted"} from the scan
          events of this run ({playLength(runMinutes(hero))}). <SourceChip kind="sim" />
        </p>

        <section className="lineup-watch" aria-labelledby={`${titleId}-eyes`}>
          <h3 className="kicker" id={`${titleId}-eyes`}>
            Whose eyes to watch
          </h3>
          <div className="lineup-options">
            {options.map((option) => (
              <button
                type="button"
                className="persona"
                key={option.id}
                aria-pressed={chosen === option.id}
                onClick={() => {
                  setChosen(option.id);
                  playback.set({ povPlayer: option.id });
                  setCounting(false);
                }}
              >
                <span className="persona-name">
                  {shortName(option.id)} · {option.role}
                </span>{" "}
                <span className="persona-note">{option.note}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="lineup-actions">
          <button
            type="button"
            className="btn btn-primary"
            ref={start}
            onClick={() => {
              if (chosen) playback.set({ povPlayer: chosen });
              intro.set({ open: false });
            }}
          >
            Start watching
            <ArrowIcon />
          </button>
          {kind === "hero" && <TourButton /> /* its steps are a hero moment's */}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => intro.set({ open: false })}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
