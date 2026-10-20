// The live stream in the page (SPEC 2): the header control that follows the stream (or the
// "Offline data" badge when there is no live service), and the moments the stream has detected,
// in the order they arrived.

import type { LiveFeed, LiveMoment, LiveStatus } from "../live/feed";
import { useSession } from "../session";
import { useStore } from "../store/store";
import "./live.css";

/** "Offline data" without the live service; otherwise the Live button and the stream's state. */
export function LiveBar() {
  const { feed, offline } = useSession();
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
  const { playback, controls } = useSession();
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
      <span className={`live-status ${status}`} title={error ?? undefined}>
        {live || status === "ended" || status === "lost" ? STATUS[status] : STATUS.off}
        {live && sprint.length > 0 && (
          <span className="sprint"> · sprinting {sprint.join(", ")}</span>
        )}
      </span>
    </div>
  );
}

const KIND: Record<string, string> = {
  decision_after_scan: "Decision after a scan",
  line_breaking_pass: "Line-breaking pass",
  sprint: "Sprint",
};

export function momentLabel(m: LiveMoment): string {
  const kind = KIND[m.kind] ?? m.kind.replaceAll("_", " ");
  return `${kind} · ${m.actor ?? "?"}${m.receiver ? ` → ${m.receiver}` : ""}`;
}

/** Moments detected on the live stream; the hero moment opens its breakdown. */
export function MomentsPanel() {
  const { feed } = useSession();
  return feed ? <Moments feed={feed} /> : null;
}

function Moments({ feed }: { feed: LiveFeed }) {
  const { moment, controls } = useSession();
  const moments = useStore(feed.state, (s) => s.moments);
  const status = useStore(feed.state, (s) => s.status);
  return (
    <div className="panel moments">
      <div className="breakdown-head">
        <h2>Moments</h2>
        <span className="meta">detected on the live stream</span>
      </div>
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
                <button type="button" className="play small" onClick={controls.playBreakdown}>
                  Breakdown
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="note">
        A moment is announced when its window closes on the stream. Breakdowns run once the hero
        moment is detected, like a broadcast replay after a goal; the other moments replay only.
      </p>
    </div>
  );
}
