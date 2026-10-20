// The tactical board's pitch-control layer (SPEC 7): which team gets to every point of the pitch
// first, drawn per pixel by the shader in pitchControl.ts. Home colour where the home team
// controls, away colour where the away team does, clear where it is contested, and a light line
// on the frontier. Toggled by the board's "Pitch control" chip.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Hero } from "../data/hero";
import { useView } from "../session";
import {
  ControlInputs,
  controlInputsAt,
  createPitchControlMaterial,
  createPitchControlMesh,
  setControlInputs,
} from "./pitchControl";

export function PitchControlLayer({ hero, renderOrder }: { hero: Hero; renderOrder: number }) {
  const { playback } = useView(); // a hero moment or a stitched match: both draw it
  const inputs = useMemo(() => new ControlInputs(), []);
  const material = useMemo(() => createPitchControlMaterial(), []);
  const mesh = useMemo(() => createPitchControlMesh(material), [material]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );
  useFrame(() => {
    const state = playback.get();
    mesh.visible = state.pitchControl;
    if (!mesh.visible) return;
    controlInputsAt(inputs, hero, hero.runs[state.mode], state.frame);
    setControlInputs(material, inputs);
  });
  return <primitive object={mesh} renderOrder={renderOrder} />;
}
