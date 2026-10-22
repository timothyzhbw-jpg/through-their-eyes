// A stitched match in the page (SPEC 3.1): the score bug with the possession on screen and how
// play restarted, the match picker (`?match=`), and the way back from a hero moment's breakdown.

import { useEffect, useState } from "react";
import { MATCH_ID, type MatchList } from "../api/client";
import {
  possessionAt,
  restartLabel,
  scenarioLabel,
  scoreAt,
  type MatchMoment,
} from "../match/match";
import type { MatchSession } from "../match/matchSession";
import { useSession, useView } from "../session";
import { useStore } from "../store/store";
import "./match.css";
import { clubName } from "../data/roster";

/** Score, possession (n of N, its scenario) and restart at the playhead. */
export function Scoreboard() {
  const session = useView();
  return session.kind === "match" ? <ScoreBug session={session} /> : null;
}

function ScoreBug({ session }: { session: MatchSession }) {
  const { hero, match, playback, controls } = session;
  const frame = useStore(playback, (s) => Math.floor(s.frame));
  const p = possessionAt(match, frame);
  const score = scoreAt(hero, frame);
  const heroCard = match.moments.find((m) => m.hero && m.possession === p.index);
  return (
    <section className="scoreboard" aria-label="Score and possession">
      <div
        className="score"
        aria-label={`${clubName(0)} ${score.home}, ${clubName(1)} ${score.away}`}
      >
        <span className="team home">{clubName(0)}</span>
        <b>{score.home}</b>
        <span className="dash">–</span>
        <b>{score.away}</b>
        <span className="team away">{clubName(1)}</span>
      </div>
      <div className="possession">
        <span className="count">
          Possession {p.index + 1} of {match.possessions.length}
        </span>
        <span className="scenario">{scenarioLabel(p.scenario)}</span>
        <span className="restart">Restart: {restartLabel(p.restart)}</span>
      </div>
      {heroCard && <HeroShortcut card={heroCard} onOpen={controls.openBreakdown} />}
    </section>
  );
}

function HeroShortcut({
  card,
  onOpen,
}: {
  card: MatchMoment;
  onOpen: MatchSession["controls"]["openBreakdown"];
}) {
  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => onOpen(card)}
      title={`${card.actor}'s decision, through his eyes`}
    >
      {card.actor}'s hero moment
    </button>
  );
}

/** Which match to play: every match the service lists; picking one reloads with `?match=`. */
export function MatchPicker() {
  const { api } = useView();
  const [list, setList] = useState<MatchList | null>(null);
  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .matches()
      .then((l) => alive && setList(l))
      .catch(() => alive && setList(null));
    return () => {
      alive = false;
    };
  }, [api]);
  if (!api || !list || list.length < 2) return null;
  return (
    <label className="picker match-picker">
      <span className="sr-only">Match</span>
      <select value={api.match} onChange={(e) => openMatch(e.target.value)} aria-label="Match">
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {matchLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function matchLabel(m: { scenario: string; seed: number }): string {
  if (m.scenario === "match") return `Match ${m.seed} · stitched possessions`;
  return `Hero moment · ${scenarioLabel(m.scenario)}`;
}

function openMatch(id: string) {
  const url = new URL(window.location.href);
  if (id === MATCH_ID) url.searchParams.delete("match");
  else url.searchParams.set("match", id);
  window.location.assign(url.toString());
}

/** In a hero moment's breakdown inside a match: back to the match, and where this is. */
export function BackToMatch({ onBack }: { onBack: () => void }) {
  const { hero, possession, offset } = useSession();
  return (
    <div className="live" role="group" aria-label="Match">
      <button type="button" className="live-chip back" onClick={onBack}>
        ◀ Back to the match
      </button>
      {possession && (
        <span className="live-status">
          possession {possession.index + 1} · from {(offset * hero.dt).toFixed(2)} s
        </span>
      )}
    </div>
  );
}

/** Loading or failing to open a hero moment's breakdown. */
export function OpeningNotice() {
  const session = useView();
  return session.kind === "match" ? <Opening session={session} /> : null;
}

function Opening({ session }: { session: MatchSession }) {
  const opening = useStore(session.screen, (s) => s.opening);
  const error = useStore(session.screen, (s) => s.error);
  if (!opening && !error) return null;
  return (
    <p className={error ? "notice error" : "notice"} role="status">
      {error ? `Could not open the breakdown: ${error}` : "Loading the hero moment's breakdown…"}
    </p>
  );
}
