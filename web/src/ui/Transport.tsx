// The bar along the bottom of the live screen: play / pause, the timeline with scan bars and the
// decision marker (the key scan and the decision, or where the ball reaches a marker's man, are
// labelled under it, and jump there), the clock, the view options and the camera. In a stitched
// match the timeline also marks where each possession starts (hero possessions shaded) and the
// hero moments, with jumps between possessions; the clock is the match clock, also inside a hero
// moment's breakdown.

import { useEffect, useRef, useState } from "react";
import { possessionAt } from "../match/match";
import { useView } from "../session";
import { useStore } from "../store/store";
import { PauseIcon, PlayIcon } from "./icons";
import { intro } from "./intro";
import { CameraSwitch, ViewOptions } from "./Stage";

export function Transport() {
  const session = useView();
  const { hero, playback, controls } = session;
  const playing = useStore(playback, (s) => s.playing);
  const frame = useStore(playback, (s) => s.frame);
  const offset = session.kind === "hero" ? session.offset : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        // The pre-match card has the page: Space must not play the picture behind it.
        if (intro.get().open) return;
        e.preventDefault();
        controls.togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls]);

  return (
    <section className="transport" aria-label="Playback">
      <button
        type="button"
        className="play btn-icon"
        aria-label={playing ? "Pause" : "Play"}
        onClick={controls.togglePlay}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <Timeline />
      <div className="clock" title={offset ? "Match clock" : undefined}>
        <b>{((frame + offset) * hero.dt).toFixed(2)} s</b>
        <span> · frame {Math.floor(frame) + offset}</span>
      </div>
      {hero.match && (
        <div className="jumps">
          <PossessionJumps />
        </div>
      )}
      <ViewOptions />
      <CameraSwitch />
    </section>
  );
}

/** Previous / next possession of a stitched match. */
function PossessionJumps() {
  const { hero, playback, controls } = useView();
  const frame = useStore(playback, (s) => s.frame);
  const match = hero.match!;
  const now = possessionAt(match, frame);
  const prev = match.possessions[now.index - 1];
  const next = match.possessions[now.index + 1];
  // Within the first second of a possession, "previous" goes to the one before it.
  const back = frame - now.start > 1 / hero.dt || !prev ? now : prev;
  return (
    <>
      <button type="button" onClick={() => controls.seek(back.start)} title="Start of possession">
        ◀ Possession
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && controls.seek(next.start)}
        title="Next possession"
      >
        Possession ▶
      </button>
    </>
  );
}

const TIGHT_LABELS_PX = 96; // "Key scan" (~56 px) plus half of "Decision" and a gap

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Timeline() {
  const { hero, playback, controls } = useView();
  const frame = useStore(playback, (s) => s.frame);
  const mode = useStore(playback, (s) => s.mode);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const marker = useStore(playback, (s) => s.scanMarker);
  const [ref, width] = useWidth<HTMLDivElement>();
  const run = hero.runs[mode];
  const height = 40;
  const last = run.frames - 1;
  const X = (f: number) => 6 + ((width - 12) * f) / last;
  const key = hero.keyScan;
  const scans = run.scans.filter((s) => s.player === povPlayer);
  const marked = marker ? hero.runs.factual.scans.find((s) => s.id === marker) : undefined;
  const possessions = hero.match?.possessions ?? [];
  // A whole match has many scans: short bars, so possession bands and boundaries stay readable.
  const scanTop = hero.match ? 15 : 17;
  const heroes = hero.match?.moments.filter((m) => m.hero) ?? [];
  const decision = run.decision ? run.decision.frame : hero.reception;
  // The same mapping as X, in CSS: the labels need no measured width.
  const at = (f: number) => ({ left: `calc(6px + (100% - 12px) * ${f / last})` });
  // A decision inside or just after the key scan (a striker who looks while the ball comes): the
  // two labels would overlap, so "Key scan" ends where the scan starts and "Decision" starts at
  // its frame.
  const tight =
    !!key && width > 0 && X(decision) - X(key.start) < TIGHT_LABELS_PX && X(key.start) > 64;

  return (
    <div
      className="timeline"
      ref={ref}
      data-possessions={
        hero.match
          ? possessions
              .slice(1)
              .map((p) => p.start)
              .join()
          : undefined
      }
      data-heroes={hero.match ? heroes.map((m) => m.anchor_frame).join() : undefined}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          {possessions.map((p) => (
            <g key={`possession-${p.index}`}>
              <rect
                className={p.hero ? "possession hero-possession" : "possession"}
                x={X(p.start)}
                y={0}
                width={X(p.start + p.frames - 1) - X(p.start)}
                height={height}
                fill={
                  p.hero
                    ? "rgba(246,213,102,0.14)"
                    : p.index % 2
                      ? "rgba(239,237,229,0.05)"
                      : "transparent"
                }
              />
              {p.index > 0 && (
                <rect
                  className="possession-start"
                  x={X(p.start) - 1}
                  y={0}
                  width={2}
                  height={height}
                  fill="rgba(239,237,229,0.45)"
                />
              )}
              <text x={X(p.start) + 4} y={10} className="possession-label">
                {p.index + 1}
              </text>
            </g>
          ))}
          <rect
            x={6}
            y={height / 2 - 1}
            width={width - 12}
            height={2}
            rx={1}
            fill="var(--hairline-strong)"
          />
          <rect
            x={6}
            y={height / 2 - 1}
            width={Math.max(0, X(Math.min(frame, last)) - 6)}
            height={2}
            rx={1}
            fill="var(--chalk)"
          />
          {scans.map((s) => (
            <rect
              key={s.id}
              x={X(s.start)}
              y={scanTop}
              width={Math.max(hero.match ? 1.5 : 3, X(s.end) - X(s.start))}
              height={height - 2 * scanTop}
              fill={s.key ? "var(--floodlight)" : "var(--chalk-3)"}
            />
          ))}
          {mode === "counterfactual" && key && povPlayer === hero.heroId && (
            <rect
              x={X(key.start)}
              y={8}
              width={X(key.end) - X(key.start)}
              height={height - 16}
              fill="none"
              stroke="var(--dusk)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          )}
          {marked && (
            <rect
              x={X(marked.start) - 3}
              y={4}
              width={X(marked.end) - X(marked.start) + 6}
              height={height - 8}
              fill="none"
              stroke="var(--floodlight)"
              strokeWidth={2}
              rx={3}
            />
          )}
          {run.decision && (
            <path
              d={`M ${X(run.decision.frame)} ${height / 2 - 7} l 6 7 l -6 7 l -6 -7 z`}
              fill="var(--chalk)"
            />
          )}
          {heroes.map((m) => (
            <path
              key={m.id}
              d={`M ${X(m.anchor_frame)} ${height / 2 - 8} l 7 8 l -7 8 l -7 -8 z`}
              fill="var(--floodlight)"
            />
          ))}
          {run.action?.end !== undefined && (
            <rect
              x={X(run.action.end) - 1}
              y={6}
              width={2}
              height={height - 12}
              fill="var(--chalk-3)"
            />
          )}
          <circle cx={X(Math.min(frame, last))} cy={height / 2} r={7} fill="var(--chalk)" />
        </svg>
      )}
      <input
        type="range"
        min={0}
        max={last}
        step={0.01}
        value={Math.min(frame, last)}
        onChange={(e) => controls.seek(Number(e.target.value))}
        aria-label="Timeline"
      />
      {!hero.match && (
        <div className="marks">
          {key && (
            <button
              type="button"
              className={tight ? "mark key before" : "mark key"}
              style={at(key.start)}
              onClick={() => controls.seek(Math.max(0, key.start - 8))}
              title="Jump to just before the key scan"
            >
              Key scan
            </button>
          )}
          <button
            type="button"
            className={tight ? "mark after" : "mark"}
            style={at(decision)}
            onClick={() => controls.seek(decision)}
            title={
              hero.marker
                ? `Jump to where the pass to ${hero.marker.man} ends`
                : "Jump to the decision"
            }
          >
            {hero.marker ? "Ball arrives" : "Decision"}
          </button>
        </div>
      )}
    </div>
  );
}
