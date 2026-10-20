// Perception telemetry for the player in the first-person view ("Whose eyes"), synced to the
// playhead: head angle to the ball, head angular speed with the scan detector at work, players in
// sight, and the hero's belief error. As in motorsport telemetry, the other run is overlaid
// (dashed) on one time axis, and the moment's key points mark every sparkline. Sparklines are SVG
// in viewBox units stretched to the row's width; strokes keep their pixel width
// (non-scaling-stroke). The logic is in telemetry/.

import { useMemo, type ReactNode } from "react";
import { Sample } from "../data/hero";
import type { RunName } from "../data/types";
import { useSession } from "../session";
import { createStore, useStore } from "../store/store";
import {
  frameX,
  keyPoints,
  linePath,
  readout,
  ROW_H,
  telemetry,
  valueY,
  VIEW_W,
  type KeyPoints,
  type Telemetry,
} from "../telemetry/telemetry";

const NO_FEED = createStore({ latest: -1 }); // offline: there is no stream to wait for
const THIN = { vectorEffect: "non-scaling-stroke" } as const;

const SIM_NOTE = "Computed from the sim export: a metric, not a verified claim";
const RUN_LABEL: Record<RunName, string> = {
  factual: "with the look",
  counterfactual: "without the look",
};
const DETECTOR_NOTE =
  "Computed by the scan detector from tracked head yaw: a metric, not a verified claim";

export function TelemetryPanel() {
  const { hero, playback, feed } = useSession();
  const mode = useStore(playback, (s) => s.mode);
  const frame = useStore(playback, (s) => s.frame);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const comfort = useStore(playback, (s) => s.comfort);
  const live = useStore(playback, (s) => s.live);
  const latest = useStore(feed?.state ?? NO_FEED, (s) => s.latest);
  const run = hero.runs[mode];
  const otherName: RunName = mode === "factual" ? "counterfactual" : "factual";
  const known = live ? Math.min(latest, run.frames - 1) : run.frames - 1;
  const t = useMemo(() => telemetry(hero, run, povPlayer, known), [hero, run, povPlayer, known]);
  // Live, the stream sends one run: no overlay.
  const o = useMemo(
    () => (live ? null : telemetry(hero, hero.runs[otherName], povPlayer)),
    [hero, otherName, povPlayer, live],
  );
  const kp = useMemo(() => keyPoints(hero, run, known), [hero, run, known]);
  const sample = useMemo(() => new Sample(hero.n), [hero]);
  const now = readout(hero, run, t, frame, comfort, sample);
  const player = hero.players[t.player];
  const cursor = frameX(t.axis, Math.min(frame, run.frames - 1));
  const guides = [
    ...new Set([
      ...(kp.scan ? [kp.scan.start, kp.scan.end] : []),
      ...kp.points.map((p) => p.frame),
    ]),
  ];
  const threshold = t.thresholdDeg.toFixed(0);
  const beliefMax = Math.max(t.max.belief, o?.max.belief ?? 0); // one scale for both runs
  const row = { cursor, guides, axis: t.axis };

  return (
    <section className="telemetry" aria-label="Perception telemetry" data-player={player.id}>
      <header>
        <h2>
          Perception telemetry · {player.id} <span className="role">{player.role}</span>
        </h2>
        <p className="note">
          Synced to the playhead. Computed metrics from the sim and the scan detector, not verified
          claims.
        </p>
      </header>

      <Axis hero={hero.heroId} kp={kp} axis={t.axis} />

      <Row
        name="head"
        label="Head to ball"
        value={`${now.headToBall.toFixed(0)}°`}
        detail="0–180° · sim scans"
        note={SIM_NOTE}
        {...row}
      >
        <Spans t={t} />
        {o && (
          <path
            data-series="head-other"
            data-run={otherName}
            d={linePath(o.headToBall, o.axis, 180, o.known)}
            className={`curve other run-${otherName}`}
            style={THIN}
          />
        )}
        <path
          data-series="head"
          data-run={mode}
          d={linePath(t.headToBall, t.axis, 180, t.known)}
          className={`curve run-${mode}`}
          style={THIN}
        />
      </Row>

      <Row
        name="speed"
        label="Head speed"
        value={`${now.headSpeed.toFixed(0)}°/s`}
        detail={`detector · threshold ${threshold}°/s`}
        note={DETECTOR_NOTE}
        {...row}
      >
        <Detector t={t} />
        <path
          data-series="speed"
          d={linePath(t.headSpeed, t.axis, t.max.speed, t.known - 1)}
          className="curve"
          style={THIN}
        />
      </Row>

      <Row
        name="sight"
        label="In sight"
        value={String(now.inSight)}
        detail="players he can see"
        note={SIM_NOTE}
        {...row}
      >
        <path
          data-series="sight"
          d={linePath(t.inSight, t.axis, t.max.inSight, t.known)}
          className="curve"
          style={THIN}
        />
      </Row>

      <Row
        name="belief"
        label={t.belief ? `Belief error · ${t.belief.target ?? "mean"}` : "Belief error"}
        value={now.belief === null ? "n/a" : `${now.belief.toFixed(1)} m`}
        detail={
          t.belief
            ? "his ghost to the true position"
            : `beliefs are recorded for ${hero.heroId} only`
        }
        note={SIM_NOTE}
        {...row}
      >
        {o?.belief && (
          <path
            data-series="belief-other"
            data-run={otherName}
            d={linePath(o.belief.error, o.axis, beliefMax, o.known)}
            className={`curve other run-${otherName}`}
            style={THIN}
          />
        )}
        {t.belief && (
          <path
            data-series="belief"
            data-run={mode}
            d={linePath(t.belief.error, t.axis, beliefMax, t.known)}
            className={`curve run-${mode}`}
            style={THIN}
          />
        )}
      </Row>

      <ul className="tlegend" aria-label="Legend">
        <li>
          <i className={`sw line run-${mode}`} /> {RUN_LABEL[mode]}
        </li>
        {o && (
          <li>
            <i className={`sw line other run-${otherName}`} /> {RUN_LABEL[otherName]}
          </li>
        )}
        <li>
          <i className="sw key" /> key scan
        </li>
        <li>
          <i className="sw scan" /> scan (sim)
        </li>
        <li>
          <i className="sw detected" /> scan (detector)
        </li>
        <li>
          <i className="sw onset" /> onset: over {threshold}°/s, turning away from the ball
        </li>
        <li>
          <i className="sw rejected" /> onset the gate rejected
        </li>
      </ul>
    </section>
  );
}

/** The moment's key points above the sparklines, on the same time axis. */
function Axis({ hero, kp, axis }: { hero: string; kp: KeyPoints; axis: number }) {
  const pct = (f: number) => `${(frameX(axis, f) / VIEW_W) * 100}%`;
  return (
    <div className="trow" data-row="axis">
      <div className="tlabel">
        <span className="tname">Key points</span>
      </div>
      <div className="taxis">
        {kp.scan && (
          <span
            className={kp.scan.dropped ? "tbracket dropped" : "tbracket"}
            style={{
              left: pct(kp.scan.start),
              width: `calc(${pct(kp.scan.end)} - ${pct(kp.scan.start)})`,
            }}
          >
            <span>
              {hero} key scan{kp.scan.dropped ? " · dropped" : ""}
            </span>
          </span>
        )}
        {kp.points.map((p) => (
          <span
            key={p.frame}
            data-key-point={p.frame}
            className={`tpoint ${p.align}`}
            style={{ left: pct(p.frame) }}
          >
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row(props: {
  name: string;
  label: string;
  value: string;
  detail: string;
  note: string;
  cursor: number;
  guides: number[];
  axis: number;
  children: ReactNode;
}) {
  return (
    <div className="trow" data-row={props.name}>
      <div className="tlabel">
        <span className="tname">{props.label}</span>
        <span className="tread">
          <b className="tvalue">{props.value}</b>
          <span className="source" title={props.note}>
            sim
          </span>
        </span>
        <span className="tdetail">{props.detail}</span>
      </div>
      <svg
        className="spark"
        viewBox={`0 0 ${VIEW_W} ${ROW_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {props.guides.map((f) => (
          <line
            key={f}
            data-guide={f}
            x1={frameX(props.axis, f)}
            x2={frameX(props.axis, f)}
            y1={0}
            y2={ROW_H}
            className="guide"
            style={THIN}
          />
        ))}
        {props.children}
        <line
          data-cursor="playhead"
          x1={props.cursor}
          x2={props.cursor}
          y1={0}
          y2={ROW_H}
          className="cursor"
          style={THIN}
        />
      </svg>
    </div>
  );
}

/** The sim's scans of this player (ground truth), the key scan highlighted. */
function Spans({ t }: { t: Telemetry }) {
  const X = (f: number) => frameX(t.axis, f);
  return (
    <>
      {t.scans.map((s) => (
        <rect
          key={s.id}
          data-scan={s.id}
          className={s.key ? "scan key" : "scan"}
          x={X(s.start)}
          y={0}
          width={Math.max(2, X(s.end) - X(s.start))}
          height={ROW_H}
        />
      ))}
      {t.droppedKey && (
        <rect
          data-dropped-key={t.droppedKey.id}
          className="dropped-key"
          x={X(t.droppedKey.start)}
          y={1}
          width={X(t.droppedKey.end) - X(t.droppedKey.start)}
          height={ROW_H - 2}
          style={THIN}
        />
      )}
    </>
  );
}

/** The detector at work: its threshold, accepted scans and candidate onsets. */
function Detector({ t }: { t: Telemetry }) {
  const X = (f: number) => frameX(t.axis, f);
  const thresholdY = valueY(t.thresholdDeg, t.max.speed);
  return (
    <>
      {t.detected.map((s) => (
        <rect
          key={s.start}
          data-detected={s.start}
          className="detected"
          x={X(s.start)}
          y={0}
          width={Math.max(2, X(s.end) - X(s.start))}
          height={ROW_H}
        />
      ))}
      <line
        data-threshold={t.thresholdDeg.toFixed(0)}
        className="threshold"
        x1={0}
        x2={VIEW_W}
        y1={thresholdY}
        y2={thresholdY}
        style={THIN}
      />
      {t.onsets.map((o) => (
        <line
          key={o.frame}
          data-onset={o.frame}
          className={o.accepted ? "onset accepted" : "onset rejected"}
          x1={X(o.frame)}
          x2={X(o.frame)}
          y1={thresholdY}
          y2={valueY(t.headSpeed[o.frame], t.max.speed)}
          style={THIN}
        />
      ))}
    </>
  );
}
