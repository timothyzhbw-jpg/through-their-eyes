// Rigged players in the first-person view (SPEC 7, on by default). One converted Gameplay
// Football player (web/public/models/grf_player.glb), cloned per player. Every pose is a pure
// function of the playback frame (rig.ts):
// - position from the sim; the body faces body_yaw (plus the hips' share of a look, look.ts);
// - gait: idle / walk / sprint blended by the sim speed, the playback rate matched to it so the
//   feet do not slide (gait.ts), the phase integrated along the run;
// - a kick at each pass and shot event, its ball contact on the event's frame: the body turns to
//   the pass first, then winds up, stands on the plant foot through the strike, and the 3D
//   views' ball sits on the kicking foot (gait.ts, kickBall.ts; the sim's passer may face
//   anywhere);
// - the neck turned so the head points along head_yaw (look.ts): scans are visible;
// - the extra clips (extra.ts; `?anims=base` turns them off): a mocap kick at every pass instead
//   of the standing pass, the trunk joining every scan's look over the shoulder (not under
//   prefers-reduced-motion), and with them a real walk at slow speeds (walk.ts; `?walk=0` leaves
//   it out), cross-fading into the jog on one gait phase (gait.ts);
// - kits in the fictional clubs' colours, keepers in their own (kit.ts);
// - bodies closer than a body is wide are drawn apart, render only (separate.ts).
// By default (trial.ts; `?look=v1` for the plain kits) it loads the re-skinned copy,
// grf_player_look.glb (same skeleton and clips byte for byte): kit designs from
// models/kit_mask.webp, a cloth normal map, and baked occlusion plus the keepers' sleeves and
// gloves from its `_LOOK` attribute (shading.ts). index.html preloads both files.
// The tokens' shirt numbers and blind-side rings stay on (PovView); only their bodies hide.

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Component, type ReactNode, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type Hero, Sample, sampleInto } from "../data/hero";
import type { ExportPlayer, RunName } from "../data/types";
import { useView } from "../session";
import { useStore } from "../store/store";
import { EXTRA_URL, type ExtraClips, extraClips } from "./extra";
import { type KickBallOffset, clearKickBall, setKickBall } from "./kickBall";
import { Separation } from "./separate";
import { type Look, trial } from "./trial";
import { WALK_URL, type WalkClips, walkClips } from "./walk";
import { BOOTS, SOLE, hairColour, kitOf, kitTexture, skinTone } from "./kit";
import { withLook } from "./shading";
import {
  type ModelMeta,
  type Motion,
  type Rig,
  PLAYER_HEIGHT,
  kickBall,
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
  const look = useStore(trial, (s) => s.look);
  const anims = useStore(trial, (s) => s.anims);
  const walk = useStore(trial, (s) => s.walk);
  if (anims !== "extra") return <Dressed look={look} extra={null} walk={null} />;
  // Fetched alongside the clips, not after them.
  useLoader.preload(GLTFLoader, look === "v2" ? LOOK_MODEL_URL : MODEL_URL);
  if (walk) useLoader.preload(GLTFLoader, WALK_URL);
  return (
    <ExtraFallback>
      <WithExtra look={look} walk={walk} />
    </ExtraFallback>
  );
}

function WithExtra({ look, walk }: { look: Look; walk: boolean }) {
  const gltf = useLoader(GLTFLoader, EXTRA_URL);
  const extra = useMemo(() => extraClips(gltf), [gltf]);
  if (!walk) return <Dressed look={look} extra={extra} walk={null} />;
  return (
    <WalkFallback>
      <WithWalk look={look} extra={extra} />
    </WalkFallback>
  );
}

function WithWalk({ look, extra }: { look: Look; extra: ExtraClips }) {
  const gltf = useLoader(GLTFLoader, WALK_URL);
  const walk = useMemo(() => walkClips(gltf), [gltf]);
  return <Dressed look={look} extra={extra} walk={walk} />;
}

/** The look's files: the re-skinned model with its kit mask (v2), or the plain model (v1). The
 * extra clips and the walk bind to either: both have the same skeleton, byte for byte. */
function Dressed({
  look,
  extra,
  walk,
}: {
  look: Look;
  extra: ExtraClips | null;
  walk: WalkClips | null;
}) {
  return look === "v2" ? (
    <LookPlayers extra={extra} walk={walk} />
  ) : (
    <Rigged url={MODEL_URL} extra={extra} walk={walk} />
  );
}

function LookPlayers({ extra, walk }: { extra: ExtraClips | null; walk: WalkClips | null }) {
  const mask = useLoader(THREE.ImageLoader, KIT_MASK_URL);
  return <Rigged url={LOOK_MODEL_URL} mask={mask} extra={extra} walk={walk} />;
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

function Rigged({
  url,
  mask,
  extra,
  walk,
}: {
  url: string;
  mask?: HTMLImageElement;
  extra: ExtraClips | null;
  walk: WalkClips | null;
}) {
  const { hero, playback } = useView();
  const gltf = useLoader(GLTFLoader, url);
  const meta = gltf.scene.userData as ModelMeta;
  const reduced = useReducedMotion();
  const clips = useMemo(() => modelClips(meta, extra, walk), [meta, extra, walk]);
  const scale = PLAYER_HEIGHT / meta.height_m;
  const motion = useMemo<Record<RunName, Motion>>(() => {
    const factual = runMotion(hero, hero.runs.factual, clips, scale);
    // A stitched match has one run under both names: its motion is computed once.
    const cf = hero.runs.counterfactual;
    return {
      factual,
      counterfactual: cf === hero.runs.factual ? factual : runMotion(hero, cf, clips, scale),
    };
  }, [hero, clips, scale]);
  useEffect(() => {
    // The first-person view's own kicks leave the ball where the sim has it: his body is hidden.
    const offset: KickBallOffset = (mode, frame, out) =>
      kickBall(motion[mode], frame, hero.dt, out, hiddenPlayer(hero, playback.get()));
    setKickBall(offset);
    return () => clearKickBall(offset);
  }, [motion, hero, playback]);
  const rigs = useMemo(
    () =>
      hero.players.map((p, j) => {
        const rig = makeRig(gltf, scale, clips.extra, walk);
        const materials = mask ? dressLook(rig, p, j, mask, kitNormalMap(gltf)) : dress(rig, p, j);
        return { rig, materials };
      }),
    [gltf, hero, scale, clips, mask, walk],
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
  const separation = useMemo(() => new Separation(hero.n), [hero]);

  useFrame(() => {
    const s = playback.get();
    const run = hero.runs[s.mode];
    sampleInto(sample, hero, run, s.frame, s.comfort);
    const { off } = separation.update(run, s.frame);
    const me = hiddenPlayer(hero, s); // his own body, in his eyes
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
      // Render only: the body stands where the others leave room for it (separate.ts); the
      // pose above, and every number and overlay, stay on the sim's spot.
      rig.holder.position.x += off[2 * j];
      rig.holder.position.z -= off[2 * j + 1];
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

/** Whose body is not drawn: the first-person view's own (nobody's on the broadcast camera). */
function hiddenPlayer(hero: Hero, s: { camera: string; povPlayer: string }): number {
  return s.camera === "broadcast" ? -1 : hero.ids.indexOf(s.povPlayer);
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
