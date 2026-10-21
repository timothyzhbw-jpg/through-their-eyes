// The live match stats panel (SPEC 4.6, 7): the analyst's table, a casual viewer's headlines, or
// the player a fan follows. The same panel in a hero moment (the viewer menu picks the persona)
// and in a stitched match (its own audience switch). Numbers are measured, not verified claims.

import { useState } from "react";
import type { Persona } from "../api/client";
import { useView, type ViewSession } from "../session";
import {
  audienceOf,
  ballKmh,
  cuesUpTo,
  headlines,
  speedKmh,
  totalsAt,
  type Audience,
  type Cue,
  type PlayerTotals,
  type Stats,
  type TeamTotals,
} from "../stats/stats";
import { useStats } from "../stats/store";
import { createStore, useStore, type Store } from "../store/store";
import { Segmented } from "./Segmented";
import "./stats.css";
import { clubName } from "../data/roster";

const DASH = "–";
const SOURCE =
  "Measured from tracking and the event feed (analytics/stats.py): a metric, not a verified claim";
const PARTS = ["lane", "passer", "receiver", "distance"] as const;

type PassCue = Extract<Cue, { kind: "pass" }>;
type ShotCue = Extract<Cue, { kind: "shot" }>;

const NO_PERSONA = createStore({ persona: "casual" as Persona });

function personaStore(view: ViewSession): Store<{ persona: Persona }> {
  return view.kind === "hero" ? (view.breakdown as Store<{ persona: Persona }>) : NO_PERSONA;
}

function Source() {
  return (
    <span className="source" title={SOURCE}>
      tracking
    </span>
  );
}

function pct(accuracy: number | null): string {
  return accuracy === null ? DASH : `${Math.round(accuracy * 100)}%`;
}

function metres(value: number): string {
  return value.toFixed(1);
}

/** Ball speed, subscribed on its own so the table does not render every frame. */
function BallSpeed({ stats }: { stats: Stats }) {
  const { playback } = useView();
  const kmh = useStore(playback, (s) => Math.round(ballKmh(stats, s.frame) * 10) / 10);
  return (
    <p className="stats-ball">
      Ball speed <b>{kmh.toFixed(1)} km/h</b> <Source />
    </p>
  );
}

/** His speed while he is above 19.8 km/h. Re-renders when the tenth changes. */
function SpeedNow({ stats, id }: { stats: Stats; id: string }) {
  const { playback } = useView();
  const kmh = useStore(playback, (s) => {
    const v = speedKmh(stats, id, s.frame);
    return v === null ? null : Math.round(v * 10) / 10;
  });
  if (kmh === null) return null;
  return (
    <p className="stats-now">
      <b>{kmh.toFixed(1)}</b> km/h now
    </p>
  );
}

function TeamLine({ team }: { team: TeamTotals }) {
  const name = clubName(team.team);
  return (
    <p className="stats-team" data-team={team.team}>
      <span className="dot" data-team={team.team} />
      {name} {team.completed}/{team.passes} passes · {pct(team.accuracy)} ·{" "}
      {(team.distance_m / 1000).toFixed(2)} km
    </p>
  );
}

function PlayerRow({ p }: { p: PlayerTotals }) {
  return (
    <tr data-player-row={p.id}>
      <td className="player">
        <span className="who">
          <span className="dot" data-team={p.team} />
          <span className="shirt">{p.number}</span>
          <span title={p.name}>{p.short}</span>
          <span className="sr-only">{p.name}</span>
        </span>
      </td>
      <td>{metres(p.distance_m)}</td>
      <td className="hsr">{metres(p.hsr_m)}</td>
      <td className="sprint">{metres(p.sprint_m)}</td>
      <td>{p.top_kmh.toFixed(1)}</td>
      <td>{p.sprints}</td>
      <td>
        {p.completed}/{p.passes}
      </td>
      <td>{pct(p.accuracy)}</td>
      <td>{p.mean_difficulty === null ? DASH : p.mean_difficulty.toFixed(2)}</td>
    </tr>
  );
}

function PassLog({ stats, frame }: { stats: Stats; frame: number }) {
  const passes = cuesUpTo(stats, frame)
    .filter((c): c is PassCue => c.kind === "pass")
    .reverse()
    .slice(0, 12);
  const weights = stats.raw.definitions.difficulty_weights;
  return (
    <div className="stats-log">
      <h3>
        Passes <Source />
      </h3>
      <ol className="stats-passes">
        {passes.map((cue) => {
          const passer = stats.players.get(cue.player)?.short ?? cue.player;
          const to =
            cue.outcome === "complete"
              ? (stats.players.get(cue.receiver ?? "")?.short ?? cue.receiver ?? DASH)
              : cue.outcome;
          return (
            <li key={cue.id} data-pass={cue.id}>
              <span className="who">
                {passer} → {to}
              </span>
              <span className="meta">
                {Math.round(cue.distance_m)} m · {cue.ball_kmh.toFixed(1)} km/h ·{" "}
                {cue.difficulty.toFixed(2)} {cue.band}
              </span>
              <span className="parts">
                {PARTS.map((name) => (
                  <span key={name}>
                    {name} {(weights[name] ?? 0).toFixed(2)} × {cue.components[name].toFixed(2)}
                  </span>
                ))}
              </span>
              <span className="diff-bar" aria-hidden="true">
                {PARTS.map((name) => (
                  <i
                    key={name}
                    className={name}
                    style={{ width: `${(weights[name] ?? 0) * cue.components[name] * 100}%` }}
                  />
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ShotLog({ stats, frame }: { stats: Stats; frame: number }) {
  const shots = cuesUpTo(stats, frame)
    .filter((c): c is ShotCue => c.kind === "shot")
    .reverse();
  if (shots.length === 0) return null;
  return (
    <div className="stats-log">
      <h3>Shots</h3>
      <ol className="stats-shots">
        {shots.map((cue) => (
          <li key={cue.id} data-shot="">
            {stats.players.get(cue.player)?.short ?? cue.player} {cue.speed_kmh.toFixed(1)} km/h
          </li>
        ))}
      </ol>
    </div>
  );
}

function Table({ stats, frame }: { stats: Stats; frame: number }) {
  const totals = totalsAt(stats, frame);
  return (
    <div className="stats-block">
      {totals.teams.map((team) => (
        <TeamLine key={team.team} team={team} />
      ))}
      {/* A scrolling box with no control inside: focusable, so the keyboard can scroll it. */}
      <div
        className="stats-table-wrap"
        role="region"
        tabIndex={0}
        aria-label="Player statistics table"
      >
        <table className="stats-table">
          <thead>
            <tr>
              <th className="player">
                Player <Source />
              </th>
              <th>Distance (m)</th>
              <th className="hsr">HSR (m)</th>
              <th className="sprint">Sprint (m)</th>
              <th>Top speed (km/h)</th>
              <th>Sprints</th>
              <th>Passes</th>
              <th>Accuracy</th>
              <th>Difficulty</th>
            </tr>
          </thead>
          <tbody>
            {totals.players.map((p) => (
              <PlayerRow key={p.id} p={p} />
            ))}
          </tbody>
        </table>
      </div>
      <BallSpeed stats={stats} />
      <PassLog stats={stats} frame={frame} />
      <ShotLog stats={stats} frame={frame} />
    </div>
  );
}

function Headlines({ stats, frame, ratings }: { stats: Stats; frame: number; ratings: boolean }) {
  const lines = headlines(stats, frame, { ratings });
  return (
    <ul className="stats-headlines">
      {lines.map((line) => (
        <li key={line.key} data-headline={line.key}>
          <span className="label">{line.label}</span>
          <span className="value">{line.value}</span>
          {line.who ? <span className="who">{line.who}</span> : null}
          <Source />
        </li>
      ))}
    </ul>
  );
}

function lastPass(stats: Stats, frame: number, id: string): PassCue | null {
  const cues = cuesUpTo(stats, frame);
  for (let i = cues.length - 1; i >= 0; i--) {
    const cue = cues[i];
    if (cue.kind === "pass" && (cue.player === id || cue.receiver === id)) return cue;
  }
  return null;
}

function PlayerCard({ stats, frame, id }: { stats: Stats; frame: number; id: string }) {
  const view = useView();
  const player = stats.players.get(id) ?? stats.raw.players[0];
  const row = totalsAt(stats, frame).players.find((p) => p.id === player.id) ?? player;
  const pass = lastPass(stats, frame, player.id);
  const home = stats.raw.players.filter((p) => p.team === 0);
  const away = stats.raw.players.filter((p) => p.team === 1);
  const option = (p: PlayerTotals) => (
    <option key={p.id} value={p.id}>
      {p.number} {p.short}
    </option>
  );
  const to = pass
    ? pass.outcome === "complete"
      ? (stats.players.get(pass.receiver ?? "")?.short ?? pass.receiver ?? DASH)
      : pass.outcome
    : "";
  return (
    <div className="stats-player" data-follow={id}>
      <select
        aria-label="Player"
        value={player.id}
        onChange={(e) => view.controls.setPovPlayer(e.target.value)}
      >
        <optgroup label={clubName(0)}>{home.map(option)}</optgroup>
        <optgroup label={clubName(1)}>{away.map(option)}</optgroup>
      </select>
      <header className="stats-player-id">
        <span className="dot" data-team={player.team} />
        <h3>{player.name}</h3>
        <p>
          {player.number} · {player.role}
        </p>
        <Source />
      </header>
      <dl className="stats-figures">
        <div>
          <dt>Distance</dt>
          <dd>{metres(row.distance_m)} m</dd>
        </div>
        <div>
          <dt>Top speed</dt>
          <dd>{row.top_kmh.toFixed(1)} km/h</dd>
        </div>
        <div>
          <dt>Sprints</dt>
          <dd>{row.sprints}</dd>
        </div>
        <div>
          <dt>Passes</dt>
          <dd>
            {row.completed}/{row.passes} · {pct(row.accuracy)}
          </dd>
        </div>
        <div>
          <dt>Difficulty</dt>
          <dd>{row.mean_difficulty === null ? DASH : row.mean_difficulty.toFixed(2)}</dd>
        </div>
      </dl>
      <SpeedNow stats={stats} id={player.id} />
      {pass && (
        <p className="stats-last">
          Last pass {stats.players.get(pass.player)?.short ?? pass.player} → {to} ·{" "}
          {Math.round(pass.distance_m)} m · {pass.difficulty.toFixed(2)} {pass.band}
        </p>
      )}
    </div>
  );
}

export function StatsPanel() {
  const view = useView();
  const { status, stats, error } = useStats();
  const persona = useStore(personaStore(view), (b) => b.persona);
  const [matchAudience, setMatchAudience] = useState<Audience>("table");
  const audience = view.kind === "hero" ? audienceOf(persona) : matchAudience;
  // Re-render on the checkpoint, a new final cue, the audience's player, or the run — not per frame.
  const playhead = useStore(view.playback, (s) => {
    const cues = stats ? cuesUpTo(stats, s.frame).length : 0;
    return `${Math.floor(s.frame / 25)}|${cues}|${s.povPlayer}|${s.mode}`;
  });
  const snap = view.playback.get();
  const ratings = view.kind === "match" || persona !== "audio_description";
  const other = view.kind === "hero" && snap.mode === "counterfactual";
  return (
    <section className="panel chapter stats" aria-label="Live match stats" data-audience={audience}>
      <header className="chapter-head">
        <div className="chapter-title">
          <p className="kicker">Live match stats</p>
          <h2>
            Every run, <em>every pass.</em>
          </h2>
        </div>
        <div className="chapter-lede">
          <p className="lede">
            Speeds, distances and passes measured from the tracking and the event feed as the match
            plays, synced to the playhead.
          </p>
          <p className="note">
            Measured from tracking and the event feed, not verified claims. Sprint: above 25.2 km/h
            for 0.4 s; high-speed running: above 19.8 km/h (Gualtieri et al., 2023). Pass difficulty
            0–1: 40% interception risk along the lane, 20% each pressure on the passer, pressure on
            the receiver and distance.
          </p>
          {view.kind === "match" && (
            <Segmented
              label="Stats for"
              value={matchAudience}
              onPick={setMatchAudience}
              options={[
                { value: "table", label: "Analyst" },
                { value: "headlines", label: "Casual" },
                { value: "player", label: "Player fan" },
              ]}
            />
          )}
        </div>
      </header>
      <div className="chapter-body" data-stats-at={playhead}>
        {other && <p className="note">Stats are for what really happened, not the other run.</p>}
        {status === "offline" && (
          <p className="note">
            Live stats come from the match service, which this page is not connected to.
          </p>
        )}
        {status === "loading" && <p className="note">Loading the live stats…</p>}
        {status === "failed" && <p className="note">The live stats could not be loaded: {error}</p>}
        {status === "ready" && stats && audience === "table" && (
          <Table stats={stats} frame={snap.frame} />
        )}
        {status === "ready" && stats && audience === "headlines" && (
          <Headlines stats={stats} frame={snap.frame} ratings={ratings} />
        )}
        {status === "ready" && stats && audience === "player" && (
          <PlayerCard stats={stats} frame={snap.frame} id={snap.povPlayer} />
        )}
      </div>
    </section>
  );
}
