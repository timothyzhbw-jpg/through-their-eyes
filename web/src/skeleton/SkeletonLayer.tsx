// The skeleton in a three.js view (SPEC 7, optional): the tactical board ("board") or the
// broadcast camera ("broadcast"). The view samples the frame first (its useFrame runs at a
// negative priority) and passes that Sample; this layer reads the playback of either session, a
// hero moment's or a stitched match's.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Sample } from "../data/hero";
import { useView } from "../session";
import { Pose, poseInto, SkeletonGeometry, type SkeletonVariant } from "./skeleton";

interface Props {
  sample: Sample; // the frame the view sampled this redraw
  variant: SkeletonVariant;
  scale?: number; // the board's token scale (tokens never shrink below a few pixels)
}

export function SkeletonLayer({ sample, variant, scale = 1 }: Props) {
  const { hero, playback } = useView();
  const size = useThree((s) => s.size);
  const drawing = useMemo(() => new SkeletonGeometry(hero.n, variant), [hero, variant]);
  const pose = useMemo(() => new Pose(hero.n), [hero]);
  useEffect(() => () => drawing.dispose(), [drawing]);
  useEffect(() => drawing.resize(size.width, size.height), [drawing, size]);

  useFrame(() => {
    const s = playback.get();
    const on = s.skeleton && (variant === "board" || s.camera === "broadcast");
    drawing.group.visible = on;
    if (!on) return;
    const run = hero.runs[s.mode];
    poseInto(pose, hero, run, sample, s.frame, s.skeletonSource);
    drawing.update(pose, sample, scale);
  });

  return <primitive object={drawing.group} />;
}
