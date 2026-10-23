// The scan radar in a three.js view (radar.ts): the tactical board ("board") or the broadcast
// camera ("broadcast"; the view hides it in first person). With the skeleton on, every scanning
// player, turning with the head yaw the skeleton draws; without it, the key scan's player during
// his key scan. The view samples the frame first and passes that Sample; this layer reads the
// playback of either session, a hero moment's or a stitched match's.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Sample } from "../data/hero";
import { useView } from "../session";
import { RadarGeometry, radarTrack, type RadarVariant } from "./radar";
import { Pose, poseInto } from "./skeleton";

interface Props {
  sample: Sample; // the frame the view sampled this redraw
  variant: RadarVariant;
  scale?: number; // the board's token scale
  px?: number; // the board's metres per CSS pixel
}

export function RadarLayer({ sample, variant, scale = 1, px = 0 }: Props) {
  const { hero, playback } = useView();
  const drawing = useMemo(() => new RadarGeometry(hero.n, variant), [hero, variant]);
  const pose = useMemo(() => new Pose(hero.n), [hero]);
  useEffect(() => () => drawing.dispose(), [drawing]);

  useFrame(() => {
    const s = playback.get();
    const run = hero.runs[s.mode];
    const every = s.skeleton && (variant === "board" || s.camera === "broadcast");
    poseInto(pose, hero, run, sample, s.frame, every ? s.skeletonSource : "true");
    const track = radarTrack(hero, run, every ? "every" : "key");
    drawing.update(track, run, hero.dt, s.frame, sample, pose.yaw, scale, px);
  });

  return <primitive object={drawing.mesh} />;
}
