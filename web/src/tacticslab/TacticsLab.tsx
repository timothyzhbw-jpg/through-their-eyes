// The Tactics lab (SPEC 4.8, 7): why common tactics work, told with this match's own synthetic
// data. A chapter of the moment page and of the match page: five cards (high press, decisions under
// pressure, corners, shot quality, progression), each with the definition and the source of every
// number, its hero moment, the With / Without comparison, and for the decision the pass lanes on a
// board. Everything is computed in the browser from the export on screen and the bundled xT grid:
// no model call, no service. It is match data, so there is no "demo data" in it.

import { useEffect, useMemo, useState } from "react";
import type { Hero } from "../data/hero";
import { shortName } from "../data/roster";
import { useView } from "../session";
import { Chapter, Title } from "../ui/Chapter";
import { SourceChip } from "../provenance/SourceChip";
import { SOURCES, computed } from "../provenance/source";
import {
  buildCards,
  compareHref,
  momentHref,
  type LabCard,
  type CardId,
  type Metric,
} from "./cards";
import { lanesAt, laneCounts, OPEN_P, type Lane } from "./lanes";
import { CARD_SCENARIO, loadScope, missingScenarios, NO_SCOPE, type Scope } from "./scope";
import { parseXtGrid, type XtGrid } from "./metrics";
import { boardPlayers, laneEnds, PITCH_LINES, VIEW_BOX } from "./board";
import { COLORS, teamColor } from "../views/scene";
import { XtMoveExplain } from "../xtexplain/XtMoveExplain";
import "./tacticslab.css";
import { GlossaryText } from "../glossary/GlossaryText";

/** The xT grid ships inside the "without the look" file (units 1e-4); the lab reads it from there. */
export const XT_FILE = "without_look_seed3.json";

let gridPromise: Promise<XtGrid> | null = null;

/** The bundled xT grid, fetched once; `null` while loading, an Error if it cannot be read. */
export function useXtGrid(): XtGrid | Error | null {
  const [grid, setGrid] = useState<XtGrid | Error | null>(null);
  useEffect(() => {
    let alive = true;
    gridPromise ??= fetch(`${import.meta.env.BASE_URL}data/${XT_FILE}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${XT_FILE}: HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => parseXtGrid(json.xt));
    gridPromise.then(
      (g) => alive && setGrid(g),
      (err) => {
        gridPromise = null; // a later visit may try again
        if (alive) setGrid(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return grid;
}

const LOADING: Scope = { ...NO_SCOPE, online: true, loading: true };
const FAILED: Scope = { ...NO_SCOPE, online: true };

/**
 * The moments the cards measure (scope.ts), asked of the service the page already talks to:
 * loading while it answers, and only the bundled moment when there is no service.
 */
export function useScope(): Scope {
  const { api, hero } = useView();
  const missing = missingScenarios(hero);
  const asks = !!api && missing.length > 0;
  const [loaded, setLoaded] = useState<Scope | null>(null);
  useEffect(() => {
    if (!api || !asks) return;
    let alive = true;
    setLoaded(null); // the previous page's scope must not show while this one loads
    loadScope(api, missing, `${import.meta.env.BASE_URL}data/`).then(
      (s) => alive && setLoaded(s),
      () => alive && setLoaded(FAILED),
    );
    return () => {
      alive = false;
    };
    // `missing` follows `hero`: one ask per service and page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, hero, asks]);
  return asks ? (loaded ?? LOADING) : NO_SCOPE;
}

const sourceTitle = (m: Metric) =>
  m.sourceNote ? computed(m.sourceNote) : SOURCES[m.source].title;

function MetricRow({ m, split }: { m: Metric; split: boolean }) {
  return (
    <tr>
      <th scope="row">
        <GlossaryText text={m.label} />
        <details className="how lab-definition">
          <summary>What it counts</summary>
          <span className="lab-def">
            <GlossaryText text={m.definition} />
          </span>
          {m.zeroWhy && (
            <span className="lab-def lab-zero" data-zero>
              <GlossaryText text={m.zeroWhy} />
            </span>
          )}
        </details>
      </th>
      {m.values.map((v, i) => (
        <td key={i} data-team={split ? i : undefined}>
          {v}
        </td>
      ))}
      <td className="lab-source">
        <SourceChip kind={m.source} title={sourceTitle(m)} spoken />
      </td>
    </tr>
  );
}

function CardView({ card, onWatch }: { card: LabCard; onWatch: (frame: number) => void }) {
  const split = card.metrics.some((m) => m.values.length > 1);
  const moves = useMemo(() => (card.xtMove ? [card.xtMove] : []), [card.xtMove]);
  return (
    <article className="lab-card tile" data-card={card.id} aria-label={card.title}>
      <header>
        <p className="kicker">
          <GlossaryText text={card.kicker} />
        </p>
        <h3 className="block-title">
          <GlossaryText text={card.title} />
        </h3>
        <p className="lab-idea">
          <GlossaryText text={card.idea} />
        </p>
        <p className="lab-measured">
          <strong>Measured on:</strong> {card.measured}
        </p>
      </header>
      {card.empty ? (
        <p className="note lab-empty">
          <GlossaryText text={card.empty} />
        </p>
      ) : (
        <div className="table-wrap" role="region" tabIndex={0} aria-label={`${card.title} numbers`}>
          <table className="data-table lab-table">
            <thead>
              <tr>
                <th scope="col">Measured over {card.scope}</th>
                {split ? (
                  <>
                    <th scope="col" data-team="0">
                      <span className="dot" data-team="0" />
                      Home
                    </th>
                    <th scope="col" data-team="1">
                      <span className="dot" data-team="1" />
                      Away
                    </th>
                  </>
                ) : (
                  <th scope="col">Value</th>
                )}
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {card.metrics.map((m) => (
                <MetricRow key={m.label} m={m} split={split} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* The best pass may be either team's, so the zones are named "their". Outside a hero or
          match view usePersona falls back to casual: the lab then shows the plain sentence. */}
      {moves.length > 0 && <XtMoveExplain moves={moves} owner="their" />}
      <div className="lab-links">
        <a className="btn" href={momentHref(card.id)} data-link="moment">
          {card.here ? "This is the moment: reload it" : `Open the moment · ${card.moment.label}`}
        </a>
        <a
          className="btn"
          href={compareHref(card.id)}
          data-link="compare"
          title="The moment with the look, then without it (the With / Without toggle)"
        >
          With / without the look
        </a>
        {card.watch && (
          <button type="button" className="btn" onClick={() => onWatch(card.watch!.frame)}>
            {card.watch.label}
          </button>
        )}
      </div>
      <details className="how lab-limits">
        <summary>What these numbers leave out</summary>
        <p className="note">
          <GlossaryText text={card.limits} />
        </p>
      </details>
    </article>
  );
}

// ---------- the board: pass lanes at his decision ----------

const pct = (p: number | null) => (p === null ? "not playable" : p.toFixed(2));

function LaneBoard({ hero }: { hero: Hero }) {
  const run = hero.runs.factual;
  const lanes = useMemo(() => lanesAt(hero, run), [hero, run]);
  const players = useMemo(() => boardPlayers(hero, run), [hero, run]);
  if (!run.decision || !lanes.length) return null;
  const counts = laneCounts(lanes);
  const carrier = shortName(run.decision.player);
  return (
    <figure className="lab-board tile">
      <figcaption>
        <h3 className="block-title">
          Pass lanes at {carrier}&apos;s decision <SourceChip kind="sim" />
        </h3>
        <p>
          {counts.open} open · {counts.blocked} blocked, among his top options. Solid line: open
          (the pass would have arrived at least {Math.round(OPEN_P * 100)}% of the time on the
          truth). Dashed line with a cross: blocked. White halo: the one he chose.
        </p>
      </figcaption>
      <svg
        viewBox={VIEW_BOX}
        role="img"
        aria-label={`The pitch from above at ${carrier}'s decision: ${counts.open} open pass lanes and ${counts.blocked} blocked`}
      >
        <g className="lab-pitch">
          {PITCH_LINES.map((l, i) =>
            l.kind === "circle" ? (
              <circle key={i} cx={l.cx} cy={l.cy} r={l.r} />
            ) : (
              <rect key={i} x={l.x} y={l.y} width={l.w} height={l.h} />
            ),
          )}
          <line x1={0} y1={-34} x2={0} y2={34} />
        </g>
        {lanes.map((l) => (
          <LaneLine key={l.action} lane={l} />
        ))}
        {players.map((p) => (
          <g key={p.id} className="lab-player" data-carrier={p.carrier || undefined}>
            <circle cx={p.x} cy={p.y} r={1.25} fill={teamColor(p.team)} />
            {p.carrier && <circle cx={p.x} cy={p.y} r={1.9} className="lab-ring" />}
            <text x={p.x} y={p.y + 0.55} textAnchor="middle" fill={COLORS.bg}>
              {p.number}
            </text>
          </g>
        ))}
      </svg>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="Pass lanes">
        <table className="data-table lab-table lanes">
          <thead>
            <tr>
              <th scope="col">Lane</th>
              <th scope="col">State</th>
              <th scope="col">He thought · it was</th>
              <th scope="col">Nearest opponent to the receiver</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((l) => (
              <tr key={l.action} data-state={l.state} data-chosen={l.chosen || undefined}>
                <th scope="row">
                  {l.label}
                  {l.chosen && <span className="lab-chosen"> · chosen</span>}
                </th>
                <td>
                  {l.state === "open" ? "Open" : l.playable ? "Blocked" : "Blocked (not playable)"}
                  {l.misread && <span className="lab-def">He saw it the other way</span>}
                </td>
                <td>
                  {l.pBelief.toFixed(2)} · {pct(l.pTrue)} <SourceChip kind="sim" />
                </td>
                <td>
                  {l.pressure === null ? "–" : `${l.pressure.toFixed(1)} m`}{" "}
                  <SourceChip
                    kind="tracking"
                    title={computed(
                      "Measured from the tracking at the decision frame, in the browser",
                    )}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function LaneLine({ lane }: { lane: Lane }) {
  const { x1, y1, x2, y2, mx, my } = laneEnds(lane);
  return (
    <g className="lab-lane" data-state={lane.state} data-chosen={lane.chosen || undefined}>
      {lane.chosen && <line x1={x1} y1={y1} x2={x2} y2={y2} className="lab-halo" />}
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="lab-line" />
      {lane.state === "blocked" && (
        <path d={`M${mx - 0.9} ${my - 0.9}l1.8 1.8m0 -1.8l-1.8 1.8`} className="lab-cross" />
      )}
    </g>
  );
}

// ---------- the chapter ----------

/** `kicker`: the chapter's kicker where the lab is a step of the journey (journey/). */
export function TacticsLabPanel({
  xt: injected,
  scope: injectedScope,
  kicker = "Tactics lab",
}: {
  xt?: XtGrid;
  scope?: Scope; // tests
  kicker?: string;
}) {
  const view = useView();
  const loaded = useXtGrid();
  const grid = injected ?? (loaded instanceof Error ? null : loaded);
  const asked = useScope();
  const scope = injectedScope ?? asked;
  const cards = useMemo(() => buildCards(view.hero, grid, scope), [view.hero, grid, scope]);
  const [picked, setPicked] = useState<CardId>("high_press");
  const card = cards.find((c) => c.id === picked) ?? cards[0];
  // The board is the Decisions card's moment's: the page's own, or the one loaded for the card;
  // with no service the bundled moment is all there is.
  const laneHero =
    view.hero.kind === "match" || view.hero.scenario === CARD_SCENARIO.decisions
      ? view.hero
      : (scope.heroes[CARD_SCENARIO.decisions] ?? (scope.online ? null : view.hero));
  const watch = (frame: number) => {
    window.scrollTo({ top: 0 }); // the replay plays at the top
    view.controls.seek(frame);
  };
  return (
    <div id="tactics-lab">
      <Chapter
        className="tactics-lab"
        kicker={kicker}
        title={<Title lead="Why tactics" em="work." />}
        lede={`Five common tactics, each measured on the synthetic data of ${view.hero.kind === "match" ? "this match" : "the moment that shows it"}, and every card says which. Every number says what it is and where it comes from; every card opens the hero moment that shows it.`}
        label="Tactics lab"
      >
        <nav className="pick-row" aria-label="Tactic cards">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn"
              aria-pressed={c.id === card.id}
              onClick={() => setPicked(c.id)}
            >
              {c.title}
            </button>
          ))}
        </nav>
        {loaded instanceof Error && !injected && (
          <p className="note">
            The xT grid could not be loaded ({loaded.message}): progression is off.
          </p>
        )}
        <CardView card={card} onWatch={watch} />
        {laneHero && <LaneBoard hero={laneHero} />}
        {view.hero.kind === "match" && (
          <p className="note">
            The match has no decision of its own, so there are no lanes here: open a hero moment
            (the cards link to them) to see its pass lanes on the board.
          </p>
        )}
      </Chapter>
    </div>
  );
}
