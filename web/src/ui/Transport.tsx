// Play / pause, clock, timeline with scan bars and the decision marker, jumps and speed.

import { useEffect, useRef, useState } from "react";
import { useSession } from "../session";
import { useStore } from "../store/store";

const SPEEDS = [0.25, 0.5, 1];

export function Transport() {
  const { hero, playback, controls } = useSession();
  const playing = useStore(playback, (s) => s.playing);
  const frame = useStore(playback, (s) => s.frame);
  const speed = useStore(playback, (s) => s.speed);
  const mode = useStore(playback, (s) => s.mode);
  const run = hero.runs[mode];

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
      <div className="clock">
        <b>{(frame * hero.dt).toFixed(2)} s</b> · frame {Math.floor(frame)}
      </div>
      <Timeline />
      <div className="jumps">
        <button type="button" onClick={() => controls.seek(Math.max(0, hero.keyScan.start - 8))}>
          Key scan
        </button>
        <button
          type="button"
          onClick={() => controls.seek(run.decision ? run.decision.frame : hero.reception)}
        >
          Decision
        </button>
        <select
          value={String(SPEEDS.includes(speed) ? speed : 1)}
          onChange={(e) => controls.setSpeed(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={String(s)}>
              {s}×
            </option>
          ))}
        </select>
      </div>
    </section>
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
  const { hero, playback, controls } = useSession();
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

  return (
    <div className="timeline" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          <rect x={6} y={height / 2 - 1} width={width - 12} height={2} fill="var(--line)" />
          {scans.map((s) => (
            <rect
              key={s.id}
              x={X(s.start)}
              y={8}
              width={Math.max(3, X(s.end) - X(s.start))}
              height={height - 16}
              fill={s.key ? "var(--sight)" : "rgba(142,163,154,0.7)"}
            />
          ))}
          {mode === "counterfactual" && povPlayer === hero.heroId && (
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
