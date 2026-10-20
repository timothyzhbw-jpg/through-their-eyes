// The skeleton's key, over the view while the skeleton is on (SPEC 7, optional): what each mark
// is, the head yaw switch (true / as tracked), the head-torso angle of the player whose eyes the
// first-person view uses, and what is not data. Reads either session (useView).

import { useMemo } from "react";
import { Sample, sampleInto } from "../data/hero";
import { useView } from "../session";
import { useStore } from "../store/store";
import { Pose, poseInto, type YawSource } from "./skeleton";
import "./skeleton.css";

const DEG = 180 / Math.PI;

export function SkeletonLegend() {
  const { playback } = useView();
  const on = useStore(playback, (s) => s.skeleton);
  return on ? <Legend /> : null;
}

function Legend() {
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
    <div className="skeleton-key" role="group" aria-label="Skeleton data">
      <div className="sk-top">
        <span className="sk-title">Skeleton</span>
        <span className="source" title="Live overlay from the sim's tracking, not a verified claim">
          sim data
        </span>
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
          title={
            pose.litBy === "detector"
              ? "The head ray lights up while the scan detector marks a scan"
              : "A match export has no scan detector run: the head ray lights up during the sim's own scans"
          }
        >
          <i className={`sw lit ${pose.litBy}`} aria-hidden="true" />
          {pose.litBy === "detector" ? "lit: scan detector" : "lit: sim's own scans"}
        </li>
      </ul>
      <p className="sk-readout">
        {povPlayer}: head {twist}° off the torso
      </p>
      <p className="sk-note">No limbs: the sim has none (not data).</p>
    </div>
  );
}
