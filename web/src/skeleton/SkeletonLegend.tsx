// The skeleton's key, over the view while the skeleton is on (SPEC 7, optional): what each mark
// is, the head yaw switch (true / as tracked), the head-torso angle of the player whose eyes the
// first-person view uses, and what is not data. Reads either session (useView).

import { useMemo } from "react";
import { Sample, sampleInto, type Hero } from "../data/hero";
import { shortName } from "../data/roster";
import { useView } from "../session";
import { useStore } from "../store/store";
import { Pose, poseInto, type YawSource } from "./skeleton";
import "./skeleton.css";
import { SourceChip } from "../provenance/SourceChip";
import { computed } from "../provenance/source";

const DEG = 180 / Math.PI;

/** The board's key, in the top corner the clip leaves emptiest (keyCorner). */
export function SkeletonLegend() {
  const { hero, playback } = useView();
  const on = useStore(playback, (s) => s.skeleton);
  const corner = useMemo(() => keyCorner(hero), [hero]);
  return on ? <Legend className={`at-${corner}`} /> : null;
}

/** The key in the live screen's top-left column, under the eyes picker, the director's suggestion
 * and the stats (App.tsx), not over them: for the broadcast camera as the main view (floating in
 * the view it sat on the director's "Switch to …" prompt, text on text), and on a phone for the
 * board too, in its own row under the picture (styles.css). */
export function StageSkeletonKey() {
  const { playback } = useView();
  const on = useStore(
    playback,
    (s) => s.skeleton && (s.camera === "broadcast" || s.focus === "tactical"),
  );
  return on ? <Legend /> : null;
}

/**
 * Which top corner of the board the key takes: the side of the pitch's top half (y > 0, the top
 * of the board) with less of the clip in it, over every run, the hero, his runner and the ball
 * counting three times. One place for the whole clip, so the key never moves while it plays. The
 * bottom edge is the pass options' key's and the live stat's; each hero leaves a different top
 * corner empty (the corner kick and the press escape play on the left).
 */
export function keyCorner(hero: Hero): "left" | "right" {
  let left = 0;
  let right = 0;
  const add = (x: number, y: number, weight: number) => {
    if (y <= 0) return;
    if (x < 0) left += weight;
    else right += weight;
  };
  for (const run of Object.values(hero.runs)) {
    for (let f = 0; f < run.frames; f++) {
      for (let j = 0; j < hero.n; j++) {
        const k = (f * hero.n + j) * 2;
        add(run.pos[k], run.pos[k + 1], j === hero.hero || j === hero.runner ? 3 : 1);
      }
      add(run.ball[2 * f], run.ball[2 * f + 1], 3);
    }
  }
  return left <= right ? "left" : "right";
}

function Legend({ className }: { className?: string }) {
  const { hero, playback, controls } = useView();
  const frame = useStore(playback, (s) => s.frame);
  const mode = useStore(playback, (s) => s.mode);
  const wanted = useStore(playback, (s) => s.skeletonSource);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const comfort = useStore(playback, (s) => s.comfort);
  const sample = useMemo(() => new Sample(hero.n), [hero]);
  const pose = useMemo(() => new Pose(hero.n), [hero]);

  const run = hero.runs[mode];
  sampleInto(sample, hero, run, frame, comfort);
  poseInto(pose, hero, run, sample, frame, wanted);
  const canTrack = run.detector !== null;
  const j = hero.ids.indexOf(povPlayer);
  const twist = Math.round(Math.abs(pose.twist[j]) * DEG);
  const options: [YawSource, string, string][] = [
    ["true", "True", "The sim's head yaw, as the other views draw it"],
    [
      "tracked",
      "As tracked",
      canTrack
        ? "Head yaw with the sim's sensor noise, as a tracking system reports it: what the scan detector reads"
        : "The tracked head yaw comes with a hero moment's export",
    ],
  ];

  return (
    <div
      className={className ? `skeleton-key ${className}` : "skeleton-key"}
      role="group"
      aria-label="Skeleton data"
    >
      <div className="sk-top">
        <span className="sk-title">Skeleton</span>
        <SourceChip kind="sim" title={computed("A live overlay from the simulation's tracking")} />
        <div className="segmented sk-source" role="group" aria-label="Head yaw">
          {options.map(([value, label, title]) => (
            <button
              key={value}
              type="button"
              aria-pressed={pose.source === value}
              disabled={value === "tracked" && !canTrack}
              title={title}
              onClick={() => controls.setSkeletonSource(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="sk-marks">
        <li title="Torso line: the shoulders, across the body yaw">
          <i className="sw torso" aria-hidden="true" />
          torso
        </li>
        <li title="Head ray: the head yaw">
          <i className="sw ray" aria-hidden="true" />
          head{pose.source === "tracked" && " (tracked, 2° sensor noise)"}
        </li>
        <li title="Fan: from the torso's facing to the head; it fills in as the angle grows">
          <i className="sw fan" aria-hidden="true" />
          head–torso angle
        </li>
        <li
          className="sk-lit"
          title={
            pose.litBy === "detector"
              ? "His head ray turns green while the scan detector marks a scan"
              : "A match export has no scan detector run: his head ray turns gold during the sim's own scans"
          }
        >
          <i className={`sw lit ${pose.litBy}`} aria-hidden="true" />
          {pose.litBy === "detector" ? "green" : "gold"}: scanning now (head turned away from the
          ball)
        </li>
      </ul>
      <p className="sk-readout">
        {shortName(povPlayer)}: head {twist}° off the torso
      </p>
      <p className="sk-note">No limbs: the sim has none (not data).</p>
    </div>
  );
}
