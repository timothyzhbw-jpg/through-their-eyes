// The first screen (SPEC 2, 7): one line on what this is and one button. The card sits where the
// moment card goes (on a phone, a sheet at the bottom), so the picture stays in view behind it,
// resting on the stream's first frame. It waits for the viewer: nobody reads a card in 5 s. "Watch
// the look" opens door 1's story, the quick tour, where the page has it (a hero moment with a key
// scan and the run without it), else starts watching. The line-ups, whose eyes to watch and Just
// watch are one tap away, behind "Teams and more"; the other moments and the full tour are in the
// header's Settings. Its store belongs to the page, so opening a possession's breakdown never
// brings it back. Escape, or a click on the page around it, starts watching.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Hero } from "../data/hero";
import { useView, type ViewSession } from "../session";
import { useStore } from "../store/store";
import { ArrowIcon, ChevronIcon } from "./icons";
import { intro } from "./intro";
import { lineup, measure, runMinutes, watchOptions, type LineupRow } from "./lineup";
import { momentTitle } from "./Stage";
import { envOf, quickTourFits } from "../tour/steps";
import { startTour } from "../tour/tourState";
import { clubName, shortName } from "../data/roster";
import { SourceChip } from "../provenance/SourceChip";

/** How long the run is: seconds under a minute (a hero moment), else minutes. */
export function playLength(minutes: number): string {
  return minutes < 1
    ? `${(minutes * 60).toFixed(1)} seconds of play`
    : `${minutes.toFixed(1)} minutes of play`;
}

/** What the studio does, in one sentence (SPEC 0): the line-ups' pitch and the landing page's. */
export const PITCH =
  "An AI studio that explains key moments through the player's own perception — where he looked before the ball arrived, what he saw, what he believed — and re-simulates the moment without the look that made the play.";

// Scenarios whose key scan is a look over the shoulder (SPEC 3.6): the hook can say so.
const OVER_THE_SHOULDER = new Set(["blind_side_run", "cutback_scan"]);

/**
 * The card's one line: what this moment shows, from the runs (no numbers), then a call to look.
 * A hero moment says what the look did ("One look over his shoulder changed his pass."); a
 * stitched match says what it is.
 */
export function hookOf(view: ViewSession): { line: string; call: string } {
  if (view.kind === "match") {
    return { line: "A whole match, through the players' eyes.", call: "Watch it live." };
  }
  return { line: heroHook(view.hero), call: "See why." };
}

function heroHook(hero: Hero): string {
  const [lead, last] = momentTitle(hero);
  if (lead === "One look changed his" && OVER_THE_SHOULDER.has(hero.scenario)) {
    return `One look over his shoulder changed his ${last}`;
  }
  return `${lead} ${last}`;
}

export function IntroCard() {
  const open = useStore(intro, (s) => s.open);
  return open ? <OpenIntroCard /> : null;
}

function OpenIntroCard() {
  const view = useView();
  const { hero, playback, kind } = view;
  // Not controls.setPovPlayer: its viewer take-over would cancel the autoplay behind the card.
  const options = watchOptions(hero);
  const [chosen, setChosen] = useState(options[0]?.id ?? null);
  const [more, setMore] = useState(false);
  const titleId = useId();
  const moreId = useId();
  const dialog = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const { line, call } = hookOf(view);
  const quick = useMemo(() => kind === "hero" && quickTourFits(envOf(view)), [kind, view]);

  const startWatching = () => {
    if (chosen) playback.set({ povPlayer: chosen });
    intro.set({ open: false });
  };
  // The tour first, so the autoplay sees it open when the card closes (App.tsx).
  const start = () => {
    if (!quick) return startWatching();
    startTour(null, "quick");
    intro.set({ open: false });
  };

  useEffect(() => {
    const previous = document.activeElement;
    // With nothing focused before (a fresh load), the focus goes to the live screen's title on
    // close: left on <body>, the next Tab would start after the card, past the whole live screen.
    const title = document.querySelector<HTMLElement>(".stage .stage-head h1");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    primary.current?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        intro.set({ open: false });
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialog.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const shown = [...(focusable ?? [])].filter((el) => !el.closest("[hidden]"));
      if (!shown.length) return;
      const first = shown[0];
      const last = shown[shown.length - 1];
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
      const back =
        previous instanceof HTMLElement && previous !== document.body && previous.isConnected
          ? previous
          : title;
      back?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <>
      {/* The page around the card: a click there starts watching, as Start does. Nothing under
          it takes a click while the card is up (the live screen is inert). */}
      <div className="intro-scrim" aria-hidden="true" onClick={startWatching} />
      <section
        className={more ? "intro-card more" : "intro-card"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialog}
      >
        <p className="kicker">A synthetic match · every player fictional</p>
        <h2 id={titleId} className="intro-hook">
          {line} <em>{call}</em>
        </h2>
        <div className="intro-actions">
          <button
            type="button"
            className="btn btn-primary"
            ref={primary}
            onClick={start}
            title={
              quick ? "His look, the run without it, the two compared: about a minute" : undefined
            }
          >
            {kind === "match" ? "Watch the match" : quick ? "Watch the look" : "Watch the moment"}
            <ArrowIcon />
          </button>
          <button
            type="button"
            className="btn btn-quiet intro-more-toggle"
            aria-expanded={more}
            aria-controls={moreId}
            onClick={() => setMore((m) => !m)}
          >
            Teams and more
            <ChevronIcon />
          </button>
        </div>
        <div className="intro-more" id={moreId} hidden={!more}>
          <Lineup />
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
          {quick && (
            <div className="lineup-actions">
              <button type="button" className="btn" onClick={startWatching}>
                Just watch
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** The clubs, SPEC 0's one line, and both line-ups with each player's scans in this run. */
function Lineup() {
  const { hero } = useView();
  const teams = lineup(hero);
  const measured = measure(hero);
  const size = (row: LineupRow) => (measured === "count" ? row.scans : row.scansPerMinute);
  const highest = Math.max(0, ...teams.home.concat(teams.away).map(size));
  return (
    <>
      {/* A club's name never breaks across lines; the line breaks around the "v". */}
      <h3 className="lineup-clubs">
        <span className="lineup-club">{clubName(0)}</span> <em>v</em>{" "}
        <span className="lineup-club">{clubName(1)}</span>
      </h3>
      <p className="lineup-pitch">
        <em>See what they saw.</em> {PITCH}
      </p>
      <div className="lineup-teams">
        {(["home", "away"] as const).map((team) => {
          const name = clubName(team === "home" ? 0 : 1);
          return (
            <section className="lineup-team" key={team} aria-label={`${name} players`}>
              <header className="lineup-team-head">
                <h4>
                  <i style={{ background: `var(--${team})` }} aria-hidden="true" />
                  {name}
                </h4>
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
        {measured === "count" ? "Scans counted" : "Scans per minute, counted"} from the scan events
        of this run ({playLength(runMinutes(hero))}). <SourceChip kind="sim" />
      </p>
    </>
  );
}
