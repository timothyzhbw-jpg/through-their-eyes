// The live stream in the page (SPEC 2): the header control that follows the stream (or the
// "Offline data" badge when there is no live service), and the moments: for a hero moment, those
// the stream has detected, in the order they arrived; for a stitched match, every moment with its
// lens: the hero moments first (they open their breakdowns), then every other one folded into a
// row per kind and lens (those a lens explains first; sprints and the like after).

import { WHAT_IF_FILES } from "../data/load";
import type { LiveFeed, LiveMoment, LiveState, LiveStatus } from "../live/feed";
import { scenarioLabel, scenarioMatchId, type MatchMoment, type Possession } from "../match/match";
import type { MatchSession } from "../match/matchSession";
import { RecapButton } from "../recap/RecapButton";
import { useId, useState, type ReactElement } from "react";
import { useSession, useView } from "../session";
import { MISSING_RUNS } from "../yourcall/controller";
import { createStore, useStore, type Store } from "../store/store";
import { Chapter } from "./Chapter";
import { ChevronIcon } from "./icons";
import "./live.css";
import { shortName } from "../data/roster";

/** "Offline data" without the live service; otherwise the Live button and the stream's state. */
export function LiveBar() {
  const { feed, offline } = useView();
  if (!feed) {
    return (
      <span
        className="data-badge"
        title={`Playing the bundled synthetic match: ${offline ?? "no live service"}.`}
      >
        Offline data
      </span>
    );
  }
  return <LiveControl feed={feed} />;
}

// Short enough to sit beside the Live pill; the tooltip says where the frames come from.
const STATUS: Record<LiveStatus, string> = {
  off: "replay",
  connecting: "connecting…",
  streaming: "streaming",
  paused: "paused",
  ended: "match over",
  lost: "connection lost",
};

function LiveControl({ feed }: { feed: LiveFeed }) {
  const { playback, controls, kind } = useView();
  const live = useStore(playback, (s) => s.live);
  const status = useStore(feed.state, (s) => s.status);
  const sprint = useStore(feed.state, (s) => s.sprint);
  const error = useStore(feed.state, (s) => s.error);
  return (
    <div className="live" role="group" aria-label="Live stream">
      <button
        type="button"
        className="live-chip"
        aria-pressed={live}
        onClick={live ? controls.leaveLive : controls.goLive}
        title={
          live
            ? "Leave the stream and replay from here"
            : status === "ended"
              ? "Watch the match again from the live stream"
              : "Watch the match from the live stream"
        }
      >
        <i aria-hidden="true" />
        Live
      </button>
      {(live || status === "ended" || status === "lost") && (
        <span
          className={`live-status ${status}`}
          title={error ?? "Frames arrive live from the API over a WebSocket"}
        >
          {/* a hero moment streams one possession: "match over" would oversell it */}
          {status === "ended" && kind === "hero" ? "stream ended" : STATUS[status]}
          {live && sprint.length > 0 && (
            <span className="sprint"> · sprinting {sprint.map(shortName).join(", ")}</span>
          )}
        </span>
      )}
    </div>
  );
}

const KIND: Record<string, string> = {
  pressed_decision: "Decision under pressure",
  decision_after_scan: "Decision after a scan",
  line_breaking_pass: "Line-breaking pass",
  marker_scan: "Marker's scan",
  sprint: "Sprint",
};

/** A moment's label: kind · actor, then the receiver unless the row would give his answer away. */
export function momentLabel(
  m: Pick<LiveMoment, "kind" | "actor" | "receiver">,
  { receiver = true }: { receiver?: boolean } = {},
): string {
  const kind = KIND[m.kind] ?? m.kind.replaceAll("_", " ");
  const who = (id: string) => shortName(id);
  return `${kind} · ${m.actor ? who(m.actor) : "?"}${receiver && m.receiver ? ` → ${who(m.receiver)}` : ""}`;
}

/** A kind's name for a count of them: singular, plural. */
const KIND_COUNT: Record<string, [string, string]> = {
  sprint: ["sprint", "sprints"],
  line_breaking_pass: ["line-breaking pass", "line-breaking passes"],
  pressed_decision: ["decision under pressure", "decisions under pressure"],
  decision_after_scan: ["decision after a scan", "decisions after a scan"],
  marker_scan: ["marker's scan", "markers' scans"],
};

/** A group of routine moments in words: "141 sprints", "1 sprint"; a kind with no name of its
 * own reads "4 × first touch turn". */
export function routineLabel(kind: string, n: number): string {
  const names = KIND_COUNT[kind];
  return names ? `${n} ${names[n === 1 ? 0 : 1]}` : `${n} × ${kind.replaceAll("_", " ")}`;
}

/** Moments of one kind explained by one lens (null: none, a live overlay). */
export interface MomentGroup {
  kind: string;
  lens: string | null;
  moments: MatchMoment[]; // in match order
}

export interface MomentGroups {
  heroes: MatchMoment[]; // the hero moments, in match order: they open breakdowns
  groups: MomentGroup[]; // every other moment: those a lens explains first, then by size
}

/** A group this small starts open: a few rows say more than a count. */
export const OPEN_UP_TO = 5;

/**
 * A whole match has about 200 moments (match-1: 149 sprints, some 40 line-breaking passes): the
 * few a judge should open must not be buried. The hero moments come first; every other moment is
 * folded into its kind and lens's group, those a lens explains first, the bigger groups first.
 * Each moment appears once.
 */
export function groupMoments(moments: readonly MatchMoment[]): MomentGroups {
  const heroes = moments.filter((m) => m.hero);
  const byKind = new Map<string, MomentGroup>();
  for (const m of moments) {
    if (m.hero) continue;
    const id = `${m.kind}|${m.selected_lens ?? ""}`;
    const group = byKind.get(id);
    if (group) group.moments.push(m);
    else byKind.set(id, { kind: m.kind, lens: m.selected_lens, moments: [m] });
  }
  const groups = [...byKind.values()].sort(
    (a, b) =>
      Number(a.lens === null) - Number(b.lens === null) || b.moments.length - a.moments.length,
  );
  return { heroes, groups };
}

/** Which lens explains a moment (SPEC 5.2); sprints and the like are live overlays only. */
export function lensLabel(m: Pick<LiveMoment, "selected_lens" | "live_only">): string {
  if (m.selected_lens) return `${m.selected_lens} lens`;
  return m.live_only ? "live only" : "no lens";
}

/** Moments detected on the live stream; the hero moment opens its breakdown. A stitched match
 * lists all of its moments. */
export function MomentsPanel() {
  const session = useView();
  if (session.kind === "match") return <MatchMoments session={session} />;
  return session.feed ? <Moments feed={session.feed} /> : null;
}

function Moments({ feed }: { feed: LiveFeed }) {
  const { moment, controls } = useSession();
  const moments = useStore(feed.state, (s) => s.moments);
  const status = useStore(feed.state, (s) => s.status);
  return (
    <Chapter
      className="moments"
      split
      kicker="Moments · detected on the live stream"
      title={
        <>
          As they <em>happen.</em>
        </>
      }
      lede="A moment is announced when its window closes on the stream. Breakdowns run once the hero moment is detected, like a broadcast replay after a goal; the other moments replay only."
    >
      {moments.length === 0 ? (
        <p className="note">
          {status === "streaming" || status === "connecting"
            ? "Watching the stream: moments appear as they are detected."
            : "Moments appear here as the live stream detects them. Press Live to watch."}
        </p>
      ) : (
        <ol className="moment-list">
          {moments.map((m) => (
            <li key={m.id} className={m.id === moment.id ? "hero" : undefined}>
              <button
                type="button"
                onClick={() => controls.replayMoment(m)}
                title="Replay from this moment"
              >
                <span className="t">{m.anchor_t.toFixed(2)} s</span>
                <span>
                  {momentLabel(m)}
                  {m.selected_lens && <small> · {m.selected_lens} lens</small>}
                </span>
              </button>
              {m.id === moment.id && (
                <button type="button" className="btn" onClick={controls.playBreakdown}>
                  Breakdown
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Chapter>
  );
}

const NO_MOMENTS: Store<Pick<LiveState, "moments">> = createStore({ moments: [] as LiveMoment[] });

/** Every moment of a stitched match: the key ones first, the routine ones folded by kind. While
 * live, those the stream has not announced yet are dimmed; any of them replays, and the hero
 * moments open their breakdowns. */
function MatchMoments({ session }: { session: MatchSession }) {
  const { match, controls, playback, screen } = session;
  const stream: Store<Pick<LiveState, "moments">> = session.feed?.state ?? NO_MOMENTS;
  const detected = useStore(stream, (s) => s.moments);
  const live = useStore(playback, (s) => s.live);
  const opening = useStore(screen, (s) => s.opening);
  const seen = new Set(detected.map((m) => m.id));
  const { heroes, groups } = groupMoments(match.moments);
  const possession = new Map(match.possessions.map((p) => [p.index, p]));
  const heroCount = heroes.length;
  const breakdowns =
    heroCount === 0
      ? "No hero moments are available for breakdowns; every moment replays only."
      : `The ${heroCount} hero ${heroCount === 1 ? "moment opens its breakdown" : "moments open their breakdowns"}, played on each possession's own run; the others replay only.`;
  const row = (m: MatchMoment) => {
    const p = possession.get(m.possession);
    return (
      <MatchMomentRow
        key={m.id}
        m={m}
        ahead={live && !seen.has(m.id)}
        opening={opening === m.id}
        onReplay={() => controls.replayMoment(m)}
        onBreakdown={() => controls.openBreakdown(m)}
        onYourCall={() => controls.openBreakdown(m, "yourcall")}
        yourCallReason={p ? yourCallReason(p) : MISSING_RUNS}
        where={`Possession ${m.possession + 1}${p ? ` · ${scenarioLabel(p.scenario)}` : ""}`}
      />
    );
  };
  return (
    <Chapter
      className="moments match-moments"
      kicker="Moments · every possession, on the match clock"
      title={
        <>
          Every <em>moment.</em>
        </>
      }
      lede={`Every possession's moments, detected and explained on its own run and lifted to match time. ${breakdowns}`}
      aside={<RecapButton />}
    >
      <section className="key-moments" aria-label="Key moments">
        <h3 className="possession-head">
          <b>Hero moments</b>
          <span>Each opens its breakdown and Your call</span>
        </h3>
        {heroes.length === 0 ? (
          <p className="note">No hero moment in this match: every moment replays only.</p>
        ) : (
          <ol className="moment-list">{heroes.map(row)}</ol>
        )}
      </section>
      {groups.length > 0 && (
        <section className="routine-moments" aria-label="Other moments">
          <h3 className="possession-head">
            <b>Every other moment</b>
            <span>By kind: those a lens explains first, then the live overlays</span>
          </h3>
          <ul className="routine-groups">
            {groups.map((g) => (
              <MomentGroupRow key={`${g.kind}|${g.lens}`} group={g} row={row} />
            ))}
          </ul>
        </section>
      )}
    </Chapter>
  );
}

/** The moments of one kind and lens, folded into a row; a small group starts open. */
function MomentGroupRow({
  group,
  row,
}: {
  group: MomentGroup;
  row: (m: MatchMoment) => ReactElement;
}) {
  const { kind, lens, moments } = group;
  const [open, setOpen] = useState(moments.length <= OPEN_UP_TO);
  const id = useId();
  const how = lens ? `${lens} lens` : moments.every((m) => m.live_only) ? "live only" : "no lens";
  return (
    <li className={open ? "routine open" : "routine"}>
      <button
        type="button"
        className="routine-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span>{routineLabel(kind, moments.length)}</span>{" "}
        <small className={lens ? "lens on" : "lens"}>· {how}</small>
        <ChevronIcon />
      </button>
      {open && (
        <ol id={id} className="moment-list">
          {moments.map(row)}
        </ol>
      )}
    </li>
  );
}

/** Your call needs every option re-simulated, and those runs are bundled with the what-ifs. */
function yourCallReason(p: Possession): string | null {
  return WHAT_IF_FILES[scenarioMatchId(p)] ? null : MISSING_RUNS;
}

function MatchMomentRow(props: {
  m: MatchMoment;
  ahead: boolean;
  opening: boolean;
  onReplay: () => void;
  onBreakdown: () => void;
  onYourCall: () => void;
  yourCallReason: string | null;
  where: string; // its possession, as the timeline numbers them
}) {
  const { m } = props;
  const classes = [m.hero ? "hero" : "", props.ahead ? "ahead" : ""].filter(Boolean).join(" ");
  // A hero row that can open Your call must not name his receiver: that is his answer.
  const label = momentLabel(m, { receiver: !(m.hero && props.yourCallReason === null) });
  return (
    <li className={classes || undefined} data-possession={m.possession + 1}>
      <button type="button" onClick={props.onReplay} title="Replay from this moment">
        <span className="t">{m.anchor_t.toFixed(2)} s</span>
        <span>
          {label} <small className={m.selected_lens ? "lens on" : "lens"}>· {lensLabel(m)}</small>{" "}
          <small className="where">· {props.where}</small>
        </span>
        {/* The dimmer colour says it on screen; this says it to a screen reader. */}
        {props.ahead && <span className="sr-only"> · not on the stream yet</span>}
      </button>
      {m.hero && (
        <button type="button" className="btn" onClick={props.onBreakdown} disabled={props.opening}>
          {props.opening ? "Loading…" : "Breakdown"}
        </button>
      )}
      {m.hero && (
        <button
          type="button"
          className="btn"
          onClick={props.onYourCall}
          disabled={props.opening || props.yourCallReason !== null}
          aria-label={`Your call: ${label}`}
          title={
            props.yourCallReason ?? "Decide with only what he knew, then see what really happened"
          }
        >
          Your call
        </button>
      )}
    </li>
  );
}
