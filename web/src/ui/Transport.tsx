// Play / pause, clock, timeline with scan bars and the decision marker, jumps and speed. In a
// stitched match the timeline also marks where each possession starts (hero possessions shaded)
// and the hero moments; the clock is the match clock, also inside a hero moment's breakdown.

import { useEffect, useRef, useState } from "react";
import { possessionAt } from "../match/match";
import { useView } from "../session";
import { useStore } from "../store/store";

const SPEEDS = [0.25, 0.5, 1];
const MATCH_SPEEDS = [0.5, 1, 2, 4]; // a whole match is long: faster, no slow motion

export function Transport() {
  const session = useView();
  const { hero, playback, controls } = session;
  const playing = useStore(playback, (s) => s.playing);
  const frame = useStore(playback, (s) => s.frame);
  const speed = useStore(playback, (s) => s.speed);
  const mode = useStore(playback, (s) => s.mode);
  const run = hero.runs[mode];
  const offset = session.kind === "hero" ? session.offset : 0;
  const speeds = hero.match ? MATCH_SPEEDS : SPEEDS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        controls.togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls]);

  return (
    <section className="transport" aria-label="Playback">
      <button type="button" className="play" onClick={controls.togglePlay}>
        {playing ? "Pause" : "Play"}
      </button>
      <div className="clock" title={offset ? "Match clock" : undefined}>
        <b>{((frame + offset) * hero.dt).toFixed(2)} s</b> · frame {Math.floor(frame) + offset}
      </div>
      <Timeline />
      <div className="jumps">
        {hero.match ? (
          <PossessionJumps />
        ) : (
          <>
            {hero.keyScan && (
              <button
                type="button"
                onClick={() => controls.seek(Math.max(0, hero.keyScan!.start - 8))}
              >
                Key scan
              </button>
            )}
            <button
              type="button"
              onClick={() => controls.seek(run.decision ? run.decision.frame : hero.reception)}
            >
              Decision
            </button>
          </>
        )}
        <select
          value={String(speeds.includes(speed) ? speed : 1)}
          onChange={(e) => controls.setSpeed(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {speeds.map((s) => (
            <option key={s} value={String(s)}>
              {s}×
            </option>
          ))}
        </select>
      </div>
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
  const scanTop = hero.match ? 15 : 8;
  const heroes = hero.match?.moments.filter((m) => m.hero) ?? [];

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
                    ? "rgba(255,211,107,0.16)"
                    : p.index % 2
                      ? "rgba(230,238,233,0.05)"
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
                  fill="rgba(230,238,233,0.6)"
                />
              )}
              <text x={X(p.start) + 4} y={10} className="possession-label">
                {p.index + 1}
              </text>
            </g>
          ))}
          <rect x={6} y={height / 2 - 1} width={width - 12} height={2} fill="var(--line)" />
          {scans.map((s) => (
            <rect
              key={s.id}
              x={X(s.start)}
              y={scanTop}
              width={Math.max(hero.match ? 1.5 : 3, X(s.end) - X(s.start))}
              height={height - 2 * scanTop}
              fill={s.key ? "var(--sight)" : "rgba(142,163,154,0.7)"}
            />
          ))}
          {mode === "counterfactual" && key && povPlayer === hero.heroId && (
            <rect
              x={X(key.start)}
              y={8}
              width={X(key.end) - X(key.start)}
              height={height - 16}
              fill="none"
              stroke="var(--gold)"
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
              stroke="var(--gold)"
              strokeWidth={2}
              rx={3}
            />
          )}
          {run.decision && (
            <path
              d={`M ${X(run.decision.frame)} ${height / 2 - 7} l 6 7 l -6 7 l -6 -7 z`}
              fill="var(--fg)"
            />
          )}
          {heroes.map((m) => (
            <path
              key={m.id}
              d={`M ${X(m.anchor_frame)} ${height / 2 - 8} l 7 8 l -7 8 l -7 -8 z`}
              fill="var(--gold)"
            />
          ))}
          {run.action?.end !== undefined && (
            <rect
              x={X(run.action.end) - 1}
              y={6}
              width={2}
              height={height - 12}
              fill="var(--muted)"
            />
          )}
          <rect x={X(Math.min(frame, last)) - 1} y={2} width={2} height={height - 4} fill="#fff" />
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
    </div>
  );
}
