// The tactics cards (SPEC 4.8, 7): "Why build from the back?" and "Why focus on set pieces?", in
// the analyst's stats panel and in the end-of-match recap, for a hero moment or a stitched match
// alike (it reads the session with `useView()`). Numbers are measured from tracking and the event
// feed and carry the "tracking" source chip; the decision model's options carry "sim" (they are
// sim records, not stream data); each card's one sentence is a verified claim with its kind tag.
// The cards are whole-match numbers: in a match's stats panel they stay folded until full time,
// because the panel otherwise shows only what is known at the playhead.

import { useView, type ViewSession } from "../session";
import { useStore } from "../store/store";
import { KindTag } from "../ui/Narration";
import { useTactics } from "./store";
import {
  clock,
  fixed,
  optionLabel,
  pct,
  seekFrame,
  sentence,
  share,
  signed,
  TEAM,
  type Alternative,
  type CardId,
  type SetPieces,
  type TacticsView,
  type TeamBuildUp,
} from "./tactics";
import "./tactics.css";
import { SourceChip } from "../provenance/SourceChip";

const MEASURED =
  "Measured from tracking and the event feed (analytics/tactics.py): a metric, not a verified claim";
const SIM_RECORD =
  "The decision model's options as the sim recorded them (SPEC 3.5): not on the live stream, " +
  "not a verified claim";

function Source() {
  return <SourceChip kind="tracking" title={MEASURED} />;
}

/** Where the cards are drawn: the stats panel follows the playhead, the recap is full time. */
export type Where = "stats" | "recap";

/** The frame the session plays for a match frame of the cards, or null when it is not in it. */
function localFrame(view: ViewSession, frame: number): number | null {
  const offset = view.kind === "hero" ? view.offset : 0;
  const local = frame - offset;
  return local >= 0 && local < view.hero.runs.factual.frames ? local : null;
}

function Line({
  view,
  tactics,
  card,
  language,
}: {
  view: ViewSession;
  tactics: TacticsView;
  card: CardId;
  language: string;
}) {
  const said = sentence(tactics, card, language);
  if (!said) return null;
  const at = seekFrame(said);
  const local = at === null ? null : localFrame(view, at);
  const kinds = [...new Set(said.claims.map((c) => c.kind))];
  return (
    <div className="tactics-line" data-claim={said.line.claims.join(" ")}>
      <p lang={said.language}>{said.line.text}</p>
      <span className="tactics-line-meta">
        {kinds.map((k) => (
          <KindTag key={k} kind={k} />
        ))}
        <span
          className="verified"
          title="Every number in this sentence was checked by the Verifier"
        >
          verified
        </span>
        {local !== null && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              window.scrollTo({ top: 0 }); // the replay plays at the top
              view.controls.seek(local);
            }}
          >
            Watch
          </button>
        )}
      </span>
    </div>
  );
}

function Row({
  label,
  teams,
  cell,
}: {
  label: string;
  teams: TeamBuildUp[];
  cell: (t: TeamBuildUp) => string;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {teams.map((t) => (
        <td key={t.team}>{cell(t)}</td>
      ))}
    </tr>
  );
}

function Options({ alt }: { alt: Alternative }) {
  const who = `${alt.player}${alt.pressure === null ? "" : ` (pressure ${alt.pressure.toFixed(2)})`}`;
  const option = (label: string, o: Alternative["chosen"] | null) =>
    o && (
      <li key={label}>
        <span className="what">{label}</span> {optionLabel(o)} · P {o.p_success.toFixed(2)} · value{" "}
        {signed(o.value, 4)}
      </li>
    );
  return (
    <div className="tactics-options" data-decision={alt.id}>
      <p>
        {clock(alt.t)} {who}, in his own half, {alt.options} options:
      </p>
      <ul>
        {option("chose", alt.chosen)}
        {alt.best_short?.action !== alt.chosen.action && option("best short", alt.best_short)}
        {alt.best_long?.action !== alt.chosen.action && option("best long", alt.best_long)}
        {alt.safest &&
          alt.safest.action !== alt.chosen.action &&
          alt.safest.action !== alt.best_short?.action &&
          option("safest", alt.safest)}
      </ul>
    </div>
  );
}

function BuildUp({
  view,
  tactics,
  language,
}: {
  view: ViewSession;
  tactics: TacticsView;
  language: string;
}) {
  const { cards } = tactics;
  const d = cards.definitions;
  const teams = cards.build_up.teams;
  const featured = teams[cards.build_up.team];
  if (!teams.some((t) => t.all.passes)) return null;
  return (
    <article className="tactics-card" data-card="build_up" aria-label="Why build from the back?">
      <header>
        <p className="kicker">Build-up · {TEAM[featured.team]} in focus</p>
        <h3>
          Why build from the back? <Source />
        </h3>
      </header>
      <Line view={view} tactics={tactics} card="build_up" language={language} />
      <div className="tactics-table-wrap" role="region" tabIndex={0} aria-label="Build-up passes">
        <table className="tactics-table">
          <thead>
            <tr>
              <th scope="col">Passes in own half</th>
              {teams.map((t) => (
                <th scope="col" key={t.team} data-team={t.team}>
                  <span className="dot" data-team={t.team} />
                  {TEAM[t.team]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="All" teams={teams} cell={(t) => share(t.all)} />
            <Row label="Under pressure" teams={teams} cell={(t) => share(t.pressed)} />
            <Row label="Without pressure" teams={teams} cell={(t) => share(t.unpressed)} />
            <Row label="Short under pressure" teams={teams} cell={(t) => share(t.pressed_short)} />
            <Row
              label={`Short (< ${d.long_pass_m} m)`}
              teams={teams}
              cell={(t) => `${share(t.short)} · xT ${signed(t.short.xt)}`}
            />
            <Row
              label={`Long (${d.long_pass_m} m+)`}
              teams={teams}
              cell={(t) => `${share(t.long)} · xT ${signed(t.long.xt)}`}
            />
            <Row
              label={`Line-breaking (past ${d.min_bypassed}+)`}
              teams={teams}
              cell={(t) => `${t.line_breaking} · ${t.line_breaking_pressed} under pressure`}
            />
            <Row
              label="Lost · xT handed over"
              teams={teams}
              cell={(t) => `${t.lost} · ${fixed(t.lost_xt, 3)}`}
            />
          </tbody>
        </table>
      </div>
      {cards.build_up.alternatives.length > 0 && (
        <div className="tactics-sim">
          <h4>
            Where the sim records the options <SourceChip kind="sim" title={SIM_RECORD} />
          </h4>
          {cards.build_up.alternatives.map((alt) => (
            <Options key={alt.id} alt={alt} />
          ))}
        </div>
      )}
      <p className="note">
        Passes kicked in the passer&apos;s own half. Under pressure: pressing intensity {d.pressed}{" "}
        or more on the passer at the kick (Bekkers, 2025), the lexicon&apos;s heavy pressure. Long:
        to a teammate {d.long_pass_m} m or more away at the kick. Line-breaking: completed past{" "}
        {d.min_bypassed} or more outfield opponents. xT: expected threat (Singh, 2019), fitted on
        the sim&apos;s open play; a lost pass counts minus the opponent&apos;s xT where they won it.
        In open play who passes, when and to whom is scripted (possession play, SPEC 3.6); whether
        the ball arrives is not. Tackles are not modelled yet.
      </p>
    </article>
  );
}

function shotShare(sp: SetPieces): string {
  if (!sp.shots) return "no shots in the match";
  return `${sp.shots_from_corners} of ${sp.shots} · ${pct(sp.shot_share)}`;
}

function SetPieceCard({
  view,
  tactics,
  language,
}: {
  view: ViewSession;
  tactics: TacticsView;
  language: string;
}) {
  const sp = tactics.cards.set_pieces;
  if (!sp.awarded) return null;
  const best = sp.best;
  return (
    <article className="tactics-card" data-card="set_pieces" aria-label="Why focus on set pieces?">
      <header>
        <p className="kicker">Set pieces · corners</p>
        <h3>
          Why focus on set pieces? <Source />
        </h3>
      </header>
      <Line view={view} tactics={tactics} card="set_pieces" language={language} />
      <dl className="tactics-figures">
        <div>
          <dt>Corners</dt>
          <dd>
            {sp.corners}
            {sp.awarded > sp.corners ? ` (${sp.awarded} given)` : ""}
          </dd>
        </div>
        <div>
          <dt>Shots from corners</dt>
          <dd>{sp.shots_from_corners}</dd>
        </div>
        <div>
          <dt>xG from corners</dt>
          <dd>
            {fixed(sp.xg_from_corners)} · {fixed(sp.xg_per_corner)} per corner
          </dd>
        </div>
        <div>
          <dt>Shots from set pieces</dt>
          <dd>{shotShare(sp)}</dd>
        </div>
        {best && best.peak_xt !== null && (
          <div>
            <dt>Best corner</dt>
            <dd>
              {best.peak_player} at xT {fixed(best.peak_xt)}, {fixed(best.peak_s, 1)} s after the
              kick ({clock(best.t)})
            </dd>
          </div>
        )}
        {sp.open_play > 0 && (
          <div>
            <dt>Open play</dt>
            <dd>
              {sp.open_play} passages · best xT {fixed(sp.open_play_peak_median, 3)} (median) ·{" "}
              {sp.below_best} below the corner
            </dd>
          </div>
        )}
      </dl>
      <p className="note">
        xG: the sim&apos;s distance model for a shot (sim/decision.py). Peak: the completed pass
        received where it was worth the most expected threat to the receiving team.
        {sp.corners > 0 && sp.shots_from_corners === 0 && (
          <>
            {" "}
            A corner&apos;s passage ends after its cutback: the stitched match cuts it before a shot
            could follow (SPEC 3.1), so set-piece xG is zero here by construction.
          </>
        )}
        {sp.open_play > 0 && (
          <>
            {" "}
            Open play is mostly scripted possession play that rarely reaches the final third (SPEC
            3.6), so the comparison favours the corner.
          </>
        )}
      </p>
    </article>
  );
}

function Cards({
  view,
  tactics,
  language,
}: {
  view: ViewSession;
  tactics: TacticsView;
  language: string;
}) {
  return (
    <div className="tactics-cards">
      <BuildUp view={view} tactics={tactics} language={language} />
      <SetPieceCard view={view} tactics={tactics} language={language} />
    </div>
  );
}

/** What the cards answer, for a match or a hero moment. */
function lede(view: ViewSession): string {
  const from = view.kind === "match" ? "this match's" : "this moment's";
  return (
    `Two questions a coach would ask, answered from ${from} data: what building short under ` +
    "pressure gains or risks, and what a corner is worth."
  );
}

/** Whether the match playhead is at full time (the last frame). */
function useFullTime(view: ViewSession): boolean {
  const last = view.hero.runs.factual.frames - 1;
  return useStore(view.playback, (s) => s.frame >= last);
}

export function TacticsCards({ where, language = "en" }: { where: Where; language?: string }) {
  const view = useView();
  const fullTime = useFullTime(view);
  const { status, tactics, error } = useTactics();
  // A hero moment opened from a match serves the match's cards: they belong to the match view.
  if (view.kind === "hero" && view.possession !== null) return null;
  if (status === "offline") return null;
  const body =
    status === "ready" && tactics ? (
      <Cards view={view} tactics={tactics} language={language} />
    ) : status === "failed" ? (
      <p className="note">The tactics cards could not be loaded: {error}</p>
    ) : (
      <p className="note">Loading the tactics cards…</p>
    );
  const title = view.kind === "match" ? "Tactics at full time" : "Tactics in this moment";
  if (where === "stats" && view.kind === "match" && !fullTime) {
    return (
      <details className="tactics" data-where={where}>
        <summary>
          {title} <small>whole-match numbers, including what is still to come</small>
        </summary>
        <p className="lede">{lede(view)}</p>
        {body}
      </details>
    );
  }
  return (
    <section className="tactics" data-where={where} aria-label={title}>
      <h3 className="tactics-title">{title}</h3>
      <p className="lede">{lede(view)}</p>
      {body}
    </section>
  );
}
