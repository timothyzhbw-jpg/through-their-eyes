// What a shot films (SPEC 10): the stadium, the ground, the players, and the camera.
// Optional pieces (rings, labels, ghosts, the vision cone) read the shot from cineRuntime
// inside the frame, so load() does not have to wait for React to render them.

import { useStore } from "../store/store";
import { featuresOf, quality } from "../quality/quality";
import { LookRig } from "../quality/QualityPost";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Sample, halfCone, sampleInto, speedAt } from "../data/hero";
import { trial } from "../players/trial";
import { useView } from "../session";
import { BeliefRings } from "../views/BeliefRings";
import { COLORS, LABEL, getLabelTexture, teamColor } from "../views/scene";
import { NIGHT, PlayerShadows, Stadium, sceneClock } from "../views/Stadium";
import { Ground } from "../views/PovView";
import { poseToken } from "../views/tokens";
import { anchorPoint, coneEnvelope } from "./anchors";
import { cineRuntime } from "./runtime";
import { cameraAt, pitchToWorld, shakeAt, type Anchor, type Vec3 } from "./shot";

const CAPSULE = new THREE.CapsuleGeometry(0.28, 0.95, 6, 14);
const HEAD = new THREE.SphereGeometry(0.14, 20, 14);
const BODY_CENTRE = 0.755;
const HEAD_CENTRE = 1.66;
const RING_Y = 0.05;
const CONE_Y = 0.04;
const NEAR = 0.05;
const FAR = 400;

/** Filled at priority -1 and read by the layers later in the same advance(). */
let stageSample: Sample | null = null;

const CONE_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const CONE_FRAGMENT = /* glsl */ `
uniform vec2 uOrigin;
uniform float uYaw;
uniform float uHalf;
uniform float uEdge;
uniform float uRadius;
uniform float uGain;
uniform vec3 uColor;
varying vec3 vWorld;

float wrapA(float a) {
  const float PI = 3.14159265359;
  return mod(a + PI, 6.28318530718) - PI;
}

void main() {
  vec2 p = vec2(vWorld.x, -vWorld.z);
  vec2 d = p - uOrigin;
  float dist = length(d);
  float ang = abs(wrapA(atan(d.y, d.x) - uYaw));
  float angular = 1.0 - smoothstep(uHalf, uHalf + uEdge, ang);
  float radial = clamp(1.0 - dist / max(uRadius, 0.0001), 0.0, 1.0);
  float a = uGain * angular * radial;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

/** The crowd bobs from the shot clock while this view is mounted, then the wall clock returns. */
function CrowdClock() {
  useEffect(() => {
    const previous = sceneClock.now;
    sceneClock.now = () => cineRuntime.t;
    return () => {
      sceneClock.now = previous;
    };
  }, []);
  return null;
}

function Stage() {
  const { hero, playback } = useView();
  const sample = useMemo(() => new Sample(hero.n), [hero]);
  useFrame(({ scene }) => {
    const s = playback.get();
    sampleInto(sample, hero, hero.runs[s.mode], s.frame, false);
    stageSample = sample;
    const shot = cineRuntime.shot;
    if (shot && scene.fog instanceof THREE.Fog) {
      scene.fog.near = shot.fog[0];
      scene.fog.far = shot.fog[1];
    }
  }, -1);
  return (
    <>
      <color attach="background" args={[NIGHT.horizon]} />
      <fog attach="fog" args={[NIGHT.horizon, 60, 220]} />
    </>
  );
}

function Tokens() {
  const { hero, playback } = useView();
  const bodies = useRef<(THREE.Group | null)[]>([]);
  const heads = useRef<(THREE.Group | null)[]>([]);
  const materials = useMemo(
    () =>
      [0, 1].map((t) => new THREE.MeshStandardMaterial({ color: teamColor(t), roughness: 0.6 })),
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  useFrame(() => {
    const sample = stageSample;
    if (!sample) return;
    const s = playback.get();
    const show = !trial.get().rigged;
    const hidden = s.camera === "pov" ? hero.ids.indexOf(s.povPlayer) : -1;
    for (let j = 0; j < hero.n; j++) {
      const body = bodies.current[j];
      const head = heads.current[j];
      if (!body || !head) continue;
      body.visible = show && j !== hidden;
      body.position.set(sample.pos[2 * j], 0, -sample.pos[2 * j + 1]);
      poseToken(body, head, sample.body[j], sample.head[j]);
    }
  });
  return (
    <>
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            bodies.current[j] = g;
          }}
          visible={false}
        >
          <mesh position-y={BODY_CENTRE} geometry={CAPSULE} material={materials[p.team]} />
          <group
            position-y={HEAD_CENTRE}
            ref={(g) => {
              heads.current[j] = g;
            }}
          >
            <mesh geometry={HEAD} material={materials[p.team]} />
          </group>
        </group>
      ))}
    </>
  );
}

function Labels() {
  const { hero, playback } = useView();
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const textures = useMemo(
    () =>
      hero.players.map((p, j) =>
        getLabelTexture(String(p.number), {
          ...LABEL.shirt,
          color: j === hero.runner ? COLORS.gold : COLORS.white,
        }),
      ),
    [hero],
  );
  useFrame(() => {
    const sample = stageSample;
    if (!sample) return;
    const s = playback.get();
    const on = !!cineRuntime.shot?.labels;
    const hidden = s.camera === "pov" ? hero.ids.indexOf(s.povPlayer) : -1;
    for (let j = 0; j < hero.n; j++) {
      const sprite = sprites.current[j];
      if (!sprite) continue;
      sprite.visible = on && j !== hidden;
      sprite.position.set(sample.pos[2 * j], 2.1, -sample.pos[2 * j + 1]);
    }
  });
  return (
    <>
      {hero.players.map((p, j) => (
        <sprite
          key={p.id}
          ref={(s) => {
            sprites.current[j] = s;
          }}
          scale={[0.75, 0.75, 1]}
          visible={false}
        >
          <spriteMaterial map={textures[j]} depthWrite={false} toneMapped={false} />
        </sprite>
      ))}
    </>
  );
}

function placeRing(mesh: THREE.Mesh | null, j: number, on: boolean) {
  if (!mesh) return;
  const sample = stageSample;
  if (!on || !sample || j < 0) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.set(sample.pos[2 * j], RING_Y, -sample.pos[2 * j + 1]);
}

function Rings() {
  const { hero } = useView();
  const heroRing = useRef<THREE.Mesh>(null);
  const runnerRing = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const on = !!cineRuntime.shot?.rings;
    placeRing(heroRing.current, hero.hero, on);
    placeRing(runnerRing.current, hero.runner, on);
  });
  return (
    <>
      {hero.hero >= 0 && (
        <mesh ref={heroRing} rotation-x={-Math.PI / 2} visible={false}>
          <ringGeometry args={[0.8, 1.0, 40]} />
          <meshBasicMaterial
            color={COLORS.white}
            opacity={0.8}
            toneMapped={false}
            transparent
            depthWrite={false}
          />
        </mesh>
      )}
      {hero.runner >= 0 && hero.runner !== hero.hero && (
        <mesh ref={runnerRing} rotation-x={-Math.PI / 2} visible={false}>
          <ringGeometry args={[0.8, 1.0, 40]} />
          <meshBasicMaterial
            color={COLORS.gold}
            opacity={0.8}
            toneMapped={false}
            transparent
            depthWrite={false}
          />
        </mesh>
      )}
    </>
  );
}

/** Belief ghosts as the app draws them (views/BeliefRings.tsx): the trailer's ghosts match. */
function Ghosts() {
  return <BeliefRings sampleOf={() => stageSample} />;
}

function Cone() {
  const { hero, playback } = useView();
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uOrigin: { value: new THREE.Vector2() },
          uYaw: { value: 0 },
          uHalf: { value: 1 },
          uEdge: { value: 0.05 },
          uRadius: { value: 35 },
          uGain: { value: 0 },
          uColor: { value: new THREE.Color(COLORS.sight) },
        },
        vertexShader: CONE_VERTEX,
        fragmentShader: CONE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const fan = mesh.current;
    if (!fan) return;
    const shot = cineRuntime.shot;
    const sample = stageSample;
    const vision = hero.vision;
    if (!shot?.cone || !vision || !sample) {
      fan.visible = false;
      return;
    }
    // With the shared look the cone is the live view's look-sweep gold.
    material.uniforms.uColor.value.set(
      featuresOf(quality.get().tier, false).look ? COLORS.gold : COLORS.sight,
    );
    const s = playback.get();
    const run = hero.runs[s.mode];
    const j = hero.ids.indexOf(shot.cone.id);
    if (j < 0) {
      fan.visible = false;
      return;
    }
    const x = sample.pos[2 * j];
    const y = sample.pos[2 * j + 1];
    const radius = shot.cone.radius;
    fan.visible = true;
    fan.position.set(x, CONE_Y, -y);
    fan.scale.set(radius, radius, 1);
    const u = material.uniforms;
    (u.uOrigin.value as THREE.Vector2).set(x, y);
    u.uYaw.value = sample.head[j];
    u.uHalf.value = halfCone(vision, speedAt(hero, run, j, s.frame));
    u.uEdge.value = Math.max(vision.edgeSigma, 1e-4);
    u.uRadius.value = radius;
    u.uGain.value =
      shot.cone.opacity + shot.cone.flash * coneEnvelope(s.frame, run.scans, shot.cone.id);
  });
  return (
    // rotation.x = -π/2 turns the circle's +z normal to +y, so the fan faces the sky.
    <mesh ref={mesh} rotation-x={-Math.PI / 2} visible={false} frustumCulled={false}>
      <circleGeometry args={[1, 64]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function Ball() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const sample = stageSample;
    if (!sample || !ref.current) return;
    ref.current.position.set(sample.ball[0], 0.11, -sample.ball[1]);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.11, 20, 14]} />
      <meshStandardMaterial color="#ffffff" />
    </mesh>
  );
}

function CameraRig() {
  const { hero, playback } = useView();
  const scratch = useMemo(() => new Sample(hero.n), [hero]);
  useFrame((state) => {
    const shot = cineRuntime.shot;
    if (!shot) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    const s = playback.get();
    const aspect = state.size.width / Math.max(state.size.height, 1);
    const resolve = (anchor: Anchor, role: "eye" | "look") =>
      anchorPoint(hero, hero.runs[s.mode], s.frame, shot.smooth, anchor, role, scratch);
    const pose = cameraAt(shot, cineRuntime.t, resolve, aspect);
    const shake = shakeAt(shot.shake, cineRuntime.t);
    const eye: Vec3 = [pose.eye[0] + shake[0], pose.eye[1] + shake[1], pose.eye[2] + shake[2]];
    cineRuntime.drawn = { eye, look: pose.look, fov: pose.fov };
    const at = pitchToWorld(eye);
    const look = pitchToWorld(pose.look);
    cam.up.set(0, 1, 0);
    cam.position.set(at[0], at[1], at[2]);
    cam.lookAt(look[0], look[1], look[2]);
    cam.rotateZ((pose.roll * Math.PI) / 180);
    cam.fov = pose.fov;
    cam.near = NEAR;
    cam.far = FAR;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }, 0);
  return null;
}

export function CineScene() {
  const look = useStore(quality, (s) => featuresOf(s.tier, false).look);
  return (
    <>
      {look && <LookRig />}
      <CrowdClock />
      <Stage />
      <Stadium />
      <Ground />
      <PlayerShadows />
      <Tokens />
      <Labels />
      <Rings />
      <Ghosts />
      <Cone />
      <Ball />
      <CameraRig />
    </>
  );
}
