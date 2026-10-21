// The live stream in the page (SPEC 2): the header control that follows the stream (or the
// "Offline data" badge when there is no live service), and the moments: for a hero moment, those
// the stream has detected, in the order they arrived; for a stitched match, every moment of every
// possession with its lens, the hero moments opening their breakdowns.

import type { LiveFeed, LiveMoment, LiveState, LiveStatus } from "../live/feed";
import { restartLabel, scenarioLabel, type MatchMoment } from "../match/match";
import type { MatchSession } from "../match/matchSession";
import { useSession, useView } from "../session";
import { createStore, useStore, type Store } from "../store/store";
import { Chapter } from "./Chapter";
import "./live.css";

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

const STATUS: Record<LiveStatus, string> = {
  off: "replay",
  connecting: "connecting…",
  streaming: "streaming from the API",
  paused: "paused",
  ended: "match over",
  lost: "connection lost",
};

function LiveControl({ feed }: { feed: LiveFeed }) {
  const { playback, controls } = useView();
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
        <span className={`live-status ${status}`} title={error ?? undefined}>
          {STATUS[status]}
          {live && sprint.length > 0 && (
            <span className="sprint"> · sprinting {sprint.join(", ")}</span>
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
  sprint: "Sprint",
};

export function momentLabel(m: LiveMoment): string {
  const kind = KIND[m.kind] ?? m.kind.replaceAll("_", " ");
  return `${kind} · ${m.actor ?? "?"}${m.receiver ? ` → ${m.receiver}` : ""}`;
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

/** Every moment of a stitched match, by possession. While live, those the stream has not
 * announced yet are dimmed; any of them replays, and the hero moments open their breakdowns. */
function MatchMoments({ session }: { session: MatchSession }) {
  const { match, controls, playback, screen } = session;
  const stream: Store<Pick<LiveState, "moments">> = session.feed?.state ?? NO_MOMENTS;
  const detected = useStore(stream, (s) => s.moments);
  const live = useStore(playback, (s) => s.live);
  const opening = useStore(screen, (s) => s.opening);
  const seen = new Set(detected.map((m) => m.id));
  const at = (f: number) => `${(f * session.hero.dt).toFixed(2)} s`;
  const heroCount = match.moments.filter((m) => m.hero).length;
  const breakdowns =
    heroCount === 0
      ? "No hero moments are available for breakdowns; every moment replays only."
      : `The ${heroCount} hero ${heroCount === 1 ? "moment opens its breakdown" : "moments open their breakdowns"}, played on each possession's own run; the others replay only.`;
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
    >
      <div className="possessions">
        {match.possessions.map((p) => (
          <section key={p.index} aria-label={`Possession ${p.index + 1}`}>
            <h3 className="possession-head">
              <b>Possession {p.index + 1}</b>
              <span>{scenarioLabel(p.scenario)}</span>
              <span>
                {restartLabel(p.restart)} · {at(p.start)}
              </span>
            </h3>
            <ol className="moment-list">
              {match.moments
                .filter((m) => m.possession === p.index)
                .map((m) => (
                  <MatchMomentRow
                    key={m.id}
                    m={m}
                    ahead={live && !seen.has(m.id)}
                    opening={opening === m.id}
                    onReplay={() => controls.replayMoment(m)}
                    onBreakdown={() => controls.openBreakdown(m)}
                    onYourCall={() => controls.openBreakdown(m, "yourcall")}
                  />
                ))}
            </ol>
          </section>
        ))}
      </div>
    </Chapter>
  );
}

function MatchMomentRow(props: {
  m: MatchMoment;
  ahead: boolean;
  opening: boolean;
  onReplay: () => void;
  onBreakdown: () => void;
  onYourCall: () => void;
}) {
  const { m } = props;
  const classes = [m.hero ? "hero" : "", props.ahead ? "ahead" : ""].filter(Boolean).join(" ");
  return (
    <li className={classes || undefined}>
      <button type="button" onClick={props.onReplay} title="Replay from this moment">
        <span className="t">{m.anchor_t.toFixed(2)} s</span>
        <span>
          {momentLabel(m)}{" "}
          <small className={m.selected_lens ? "lens on" : "lens"}>· {lensLabel(m)}</small>
        </span>
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
          disabled={props.opening}
          aria-label={`Your call: ${momentLabel(m)}`}
          title="Decide with only what he knew, then see what really happened"
        >
          Your call
        </button>
      )}
    </li>
  );
}
