// Rigged players in the first-person view (SPEC 7, on by default). One converted Gameplay
// Football player (web/public/models/grf_player.glb), cloned per player. Every pose is a pure
// function of the playback frame (rig.ts):
// - position from the sim; the body faces body_yaw (plus the hips' share of a look, look.ts);
// - gait: idle / walk / sprint blended by the sim speed, the playback rate matched to it so the
//   feet do not slide (gait.ts), the phase integrated along the run;
// - the standing pass clip with its ball contact on each pass event, the body turned so the
//   kick goes along the pass while it plays (the sim's passer may face anywhere);
// - the neck turned so the head points along head_yaw (look.ts): scans are visible;
// - the extra clips (extra.ts; `?anims=base` turns them off): a mocap kick at every pass instead
//   of the standing pass, the trunk joining every scan's look over the shoulder (not under
//   prefers-reduced-motion), and with them a real walk at slow speeds (walk.ts; `?walk=0` leaves
//   it out), cross-fading into the jog on one gait phase (gait.ts);
// - kits in the fictional clubs' colours, keepers in their own (kit.ts).
// The tokens' shirt numbers and blind-side rings stay on (PovView); only their bodies hide.

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Component, type ReactNode, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Sample, sampleInto } from "../data/hero";
import type { ExportPlayer, RunName } from "../data/types";
import { useView } from "../session";
import { useStore } from "../store/store";
import { EXTRA_URL, type ExtraClips, extraClips } from "./extra";
import { trial } from "./trial";
import { WALK_URL, type WalkClips, walkClips } from "./walk";
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
  rig.model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.material = byName[name] ?? byName.skin;
  });
  return Object.values(byName);
}

/** prefers-reduced-motion, kept current; a change redraws the view. */
function useReducedMotion() {
  const invalidate = useThree((s) => s.invalidate);
  const reduced = useRef(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => {
      reduced.current = query.matches;
      invalidate();
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [invalidate]);
  return reduced;
}

export function RiggedPlayers() {
  const anims = useStore(trial, (s) => s.anims);
  const walk = useStore(trial, (s) => s.walk);
  if (anims !== "extra") return <Rigged extra={null} walk={null} />;
  useLoader.preload(GLTFLoader, MODEL_URL); // fetched alongside the clips, not after them
  if (walk) useLoader.preload(GLTFLoader, WALK_URL);
  return (
    <ExtraFallback>
      <WithExtra walk={walk} />
    </ExtraFallback>
  );
}

function WithExtra({ walk }: { walk: boolean }) {
  const gltf = useLoader(GLTFLoader, EXTRA_URL);
  const extra = useMemo(() => extraClips(gltf), [gltf]);
  if (!walk) return <Rigged extra={extra} walk={null} />;
  return (
    <WalkFallback>
      <WithWalk extra={extra} />
    </WalkFallback>
  );
}

function WithWalk({ extra }: { extra: ExtraClips }) {
  const gltf = useLoader(GLTFLoader, WALK_URL);
  const walk = useMemo(() => walkClips(gltf), [gltf]);
  return <Rigged extra={extra} walk={walk} />;
}

function Rigged({ extra, walk }: { extra: ExtraClips | null; walk: WalkClips | null }) {
  const { hero, playback } = useView();
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const meta = gltf.scene.userData as ModelMeta;
  const reduced = useReducedMotion();
  const clips = useMemo(() => modelClips(meta, extra, walk), [meta, extra, walk]);
  const motion = useMemo<Record<RunName, Motion>>(() => {
    const check = clips.extra?.check ?? null;
    const factual = runMotion(hero, hero.runs.factual, clips.gait, check);
    // A stitched match has one run under both names: its motion is computed once.
    const cf = hero.runs.counterfactual;
    return {
      factual,
      counterfactual: cf === hero.runs.factual ? factual : runMotion(hero, cf, clips.gait, check),
    };
  }, [hero, clips]);
  const rigs = useMemo(
    () =>
      hero.players.map((p, j) => {
        const rig = makeRig(gltf, PLAYER_HEIGHT / meta.height_m, clips.extra, walk);
        return { rig, materials: dress(rig, p, j) };
      }),
    [gltf, hero, meta, clips, walk],
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
        !reduced.current,
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

/** If the extra clips cannot load, keep the rigged players on the engine's clips. */
class ExtraFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Extra animations failed to load; using the engine's clips.", error);
    trial.set({ anims: "base" });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** If the walk cannot load, keep the extra clips without it. */
class WalkFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("The walk failed to load; using the engine's slow gait.", error);
    trial.set({ walk: false });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
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
