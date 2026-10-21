// The pre-match opening lives above both kinds of live screen. Its store belongs to the page,
// so opening a possession's breakdown never brings it back.

import { useEffect, useId, useRef, useState } from "react";
import { useView } from "../session";
import { useStore } from "../store/store";
import { ArrowIcon } from "./icons";
import { intro } from "./intro";
import { lineup, measure, runMinutes, watchOptions, type LineupRow } from "./lineup";

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
  const { hero, controls } = useView();
  const teams = lineup(hero);
  const options = watchOptions(hero);
  const [chosen, setChosen] = useState(options[0]?.id ?? null);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const measured = measure(hero);
  const size = (row: LineupRow) => (measured === "count" ? row.scans : row.scansPerMinute);
  const highest = Math.max(0, ...teams.home.concat(teams.away).map(size));

  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    start.current?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        intro.set({ open: false });
      }
      if (event.key !== "Tab") return;
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
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="lineup-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialog}
    >
      <div className="lineup-inner">
        <header className="lineup-head">
          <p className="kicker">A synthetic match · every player fictional</p>
          <h2 id={titleId}>
            Home <em>v</em> Away
          </h2>
        </header>

        <div className="lineup-teams">
          {(["home", "away"] as const).map((team) => {
            const name = team === "home" ? "Home" : "Away";
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
                          {row.id}
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
          {measured === "count" ? "Scans counted" : "Scans per minute, counted"} from the scan
          events of this run ({playLength(runMinutes(hero))}).{" "}
          <span className="source" title="Read from the sim export, not a verified claim">
            sim
          </span>
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
                  controls.setPovPlayer(option.id);
                }}
              >
                <span className="persona-name">
                  {option.id} · {option.role}
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
              if (chosen) controls.setPovPlayer(chosen);
              intro.set({ open: false });
            }}
          >
            Start watching
            <ArrowIcon />
          </button>
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
