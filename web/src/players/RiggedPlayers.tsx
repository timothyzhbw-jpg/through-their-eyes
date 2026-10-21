// Rigged players in the first-person view (SPEC 7, on by default). One converted Gameplay
// Football player (web/public/models/grf_player.glb), cloned per player. Every pose is a pure
// function of the playback frame (rig.ts):
// - position from the sim; the body faces body_yaw (plus the hips' share of a look, look.ts);
// - gait: idle / walk / sprint blended by the sim speed, the playback rate matched to it so the
//   feet do not slide (gait.ts), the phase integrated along the run;
// - the standing pass clip with its ball contact on each pass event, the body turned so the
//   kick goes along the pass while it plays (the sim's passer may face anywhere);
// - the neck turned so the head points along head_yaw (look.ts): scans are visible;
// - kits in the fictional clubs' colours, keepers in their own (kit.ts).
// By default (trial.ts; `?look=v1` for the plain kits) it loads the re-skinned copy,
// grf_player_look.glb (same skeleton and clips byte for byte): kit designs from
// models/kit_mask.webp, a cloth normal map, and baked occlusion plus the keepers' sleeves and
// gloves from its `_LOOK` attribute (shading.ts). index.html preloads both files.
// The tokens' shirt numbers and blind-side rings stay on (PovView); only their bodies hide.

import { useFrame, useLoader } from "@react-three/fiber";
import { Component, type ReactNode, useEffect, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Sample, sampleInto } from "../data/hero";
import type { ExportPlayer, RunName } from "../data/types";
import { useView } from "../session";
import { useStore } from "../store/store";
import { trial } from "./trial";
import { BOOTS, SOLE, hairColour, kitOf, kitTexture, skinTone } from "./kit";
import { withLook } from "./shading";
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
export const LOOK_MODEL_URL = `${import.meta.env.BASE_URL}models/grf_player_look.glb`;
export const KIT_MASK_URL = `${import.meta.env.BASE_URL}models/kit_mask.webp`;
const NORMAL_STRENGTH = 1;

/** Kit in the club's colours (the keeper's own kit) with the shirt number; flat skin, hair and
 * boots. */
function dress(rig: Rig, player: ExportPlayer, j: number): THREE.Material[] {
  const byName: Record<string, THREE.Material> = {
    kit: new THREE.MeshStandardMaterial({
      map: kitTexture(player),
      roughness: 0.75,
    }),
    skin: new THREE.MeshStandardMaterial({ color: skinTone(j), roughness: 0.65 }),
    hair: new THREE.MeshStandardMaterial({ color: hairColour(j), roughness: 0.9 }),
    boots: new THREE.MeshStandardMaterial({ color: BOOTS, roughness: 0.5 }),
  };
  return assign(rig, byName);
}

/** The v2 look: the kit's design and cloth normals, occlusion everywhere, the keeper's long
 * sleeves and gloves, a light sole edge on the boots. */
function dressLook(
  rig: Rig,
  player: ExportPlayer,
  j: number,
  mask: HTMLImageElement,
  normalMap: THREE.Texture | null,
): THREE.Material[] {
  const kit = kitOf(player);
  const byName: Record<string, THREE.Material> = {
    kit: withLook(
      new THREE.MeshStandardMaterial({
        map: kitTexture(player, mask),
        normalMap,
        // glTF's normal maps with three.js's derivative tangents: y flips, as GLTFLoader does.
        normalScale: new THREE.Vector2(NORMAL_STRENGTH, -NORMAL_STRENGTH),
        roughness: 0.8,
      }),
    ),
    skin: withLook(new THREE.MeshStandardMaterial({ color: skinTone(j), roughness: 0.6 }), {
      g: kit.sleeve,
      b: kit.glove,
    }),
    hair: withLook(new THREE.MeshStandardMaterial({ color: hairColour(j), roughness: 0.9 })),
    boots: withLook(new THREE.MeshStandardMaterial({ color: BOOTS, roughness: 0.45 }), {
      g: SOLE,
    }),
  };
  return assign(rig, byName);
}

function assign(rig: Rig, byName: Record<string, THREE.Material>): THREE.Material[] {
  rig.model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.material = byName[name] ?? byName.skin;
  });
  return Object.values(byName);
}

export function RiggedPlayers() {
  const look = useStore(trial, (s) => s.look);
  return look === "v2" ? <LookPlayers /> : <Players url={MODEL_URL} />;
}

function LookPlayers() {
  const mask = useLoader(THREE.ImageLoader, KIT_MASK_URL);
  return <Players url={LOOK_MODEL_URL} mask={mask} />;
}

/** The kit material's normal map in the loaded model, if it has one. */
function kitNormalMap(gltf: { scene: THREE.Object3D }): THREE.Texture | null {
  let found: THREE.Texture | null = null;
  gltf.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.name === "kit" && m.normalMap) found = m.normalMap;
  });
  return found;
}

function Players({ url, mask }: { url: string; mask?: HTMLImageElement }) {
  const { hero, playback } = useView();
  const gltf = useLoader(GLTFLoader, url);
  const meta = gltf.scene.userData as ModelMeta;
  const clips = useMemo(() => modelClips(meta), [meta]);
  const motion = useMemo<Record<RunName, Motion>>(() => {
    const factual = runMotion(hero, hero.runs.factual, clips.gait);
    // A stitched match has one run under both names: its motion is computed once.
    const cf = hero.runs.counterfactual;
    return {
      factual,
      counterfactual: cf === hero.runs.factual ? factual : runMotion(hero, cf, clips.gait),
    };
  }, [hero, clips]);
  const rigs = useMemo(
    () =>
      hero.players.map((p, j) => {
        const rig = makeRig(gltf, PLAYER_HEIGHT / meta.height_m);
        const materials = mask ? dressLook(rig, p, j, mask, kitNormalMap(gltf)) : dress(rig, p, j);
        return { rig, materials };
      }),
    [gltf, hero, meta, mask],
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

/** If the model cannot load, switch the rigged players off: the tokens come back. */
export class RiggedFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Rigged players failed to load; showing tokens.", error);
    trial.set({ rigged: false });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
