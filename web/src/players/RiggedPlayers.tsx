// Rigged players in the first-person view (SPEC 7, one-day trial). One converted Gameplay
// Football player (web/public/models/grf_player.glb), cloned per player. Every pose is a pure
// function of the playback frame (rig.ts):
// - position from the sim; the body faces body_yaw (plus the hips' share of a look, look.ts);
// - gait: idle / walk / sprint blended by the sim speed, the playback rate matched to it so the
//   feet do not slide (gait.ts), the phase integrated along the run;
// - the standing pass clip with its ball contact on each pass event, the body turned so the
//   kick goes along the pass while it plays (the sim's passer may face anywhere);
// - the neck turned so the head points along head_yaw (look.ts): scans are visible;
// - kits in the fictional clubs' colours (kit.ts).
// The tokens' shirt numbers and blind-side rings stay on (PovView); only their bodies hide.

import { useFrame, useLoader } from "@react-three/fiber";
import { Component, type ReactNode, useEffect, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Sample, sampleInto } from "../data/hero";
import type { ExportPlayer, RunName } from "../data/types";
import { useSession } from "../session";
import { trial } from "./trial";
import { BOOTS, hairColour, kitTexture, skinTone } from "./kit";
import {
  type ModelMeta,
  type Motion,
  type Rig,
  PLAYER_HEIGHT,
  makeRig,
  modelClips,
  poseRig,
  runMotion,
} from "./rig";

export const MODEL_URL = `${import.meta.env.BASE_URL}models/grf_player.glb`;

/** Kit in the club's colours with the shirt number; flat skin, hair and boots. */
function dress(rig: Rig, player: ExportPlayer, j: number): THREE.Material[] {
  const byName: Record<string, THREE.Material> = {
    kit: new THREE.MeshStandardMaterial({
      map: kitTexture(player.team, player.number),
      roughness: 0.75,
    }),
    skin: new THREE.MeshStandardMaterial({ color: skinTone(j), roughness: 0.65 }),
    hair: new THREE.MeshStandardMaterial({ color: hairColour(j), roughness: 0.9 }),
    boots: new THREE.MeshStandardMaterial({ color: BOOTS, roughness: 0.5 }),
  };
  rig.model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.material = byName[name] ?? byName.skin;
  });
  return Object.values(byName);
}

export function RiggedPlayers() {
  const { hero, playback } = useSession();
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const meta = gltf.scene.userData as ModelMeta;
  const clips = useMemo(() => modelClips(meta), [meta]);
  const motion = useMemo<Record<RunName, Motion>>(
    () => ({
      factual: runMotion(hero, hero.runs.factual, clips.gait),
      counterfactual: runMotion(hero, hero.runs.counterfactual, clips.gait),
    }),
    [hero, clips],
  );
  const rigs = useMemo(
    () =>
      hero.players.map((p, j) => {
        const rig = makeRig(gltf, PLAYER_HEIGHT / meta.height_m);
        return { rig, materials: dress(rig, p, j) };
      }),
    [gltf, hero, meta],
  );
  useEffect(
    () => () => {
      for (const { rig, materials } of rigs) {
        rig.mixer.stopAllAction();
        materials.forEach((m) => m.dispose());
      }
    },
    [rigs],
  );
  const sample = useMemo(() => new Sample(hero.n), [hero]);

  useFrame(() => {
    const s = playback.get();
    const run = hero.runs[s.mode];
    sampleInto(sample, hero, run, s.frame, s.comfort);
    const me = s.camera === "broadcast" ? -1 : hero.ids.indexOf(s.povPlayer); // hidden: his own
    for (let j = 0; j < hero.n; j++) {
      const { rig } = rigs[j];
      rig.holder.visible = j !== me;
      if (!rig.holder.visible) continue;
      const x = sample.pos[2 * j];
      const y = sample.pos[2 * j + 1];
      poseRig(
        rig,
        motion[s.mode],
        clips,
        j,
        s.frame,
        hero.dt,
        x,
        y,
        sample.body[j],
        sample.head[j],
      );
    }
  });

  return (
    <>
      {rigs.map(({ rig }, j) => (
        <primitive key={hero.ids[j]} object={rig.holder} />
      ))}
    </>
  );
}

/** If the model cannot load, switch the trial off: the tokens come back. */
export class RiggedFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Rigged players (trial) failed to load; showing tokens.", error);
    trial.set({ rigged: false });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
