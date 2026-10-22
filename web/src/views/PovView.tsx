// First-person view: the camera sits in the chosen player's head (1.72 m) and turns with his head
// yaw; 95 degrees of horizontal field of view (SPEC 7). With "Motion blur" on (off by default), a
// whipping head blurs the picture sideways, as a camera's would (PovMotionBlur.tsx). Players are
// animated by default (players/); the "Animated players" switch turns them off, back to capsule
// bodies turned to their body yaw, with a head on top turned to their head yaw: a white visor
// shows where they look.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { Sample, sampleInto } from "../data/hero";
import { useView } from "../session";
import { useStore } from "../store/store";
import { trial } from "../players/trial";
import { RiggedFallback, RiggedPlayers } from "../players/RiggedPlayers";
import { ALL_KITS, kitSlot } from "../players/kit";
import { COLORS, LABEL, PITCH, getLabelTexture, getPitchTexture, useRedrawOn } from "./scene";
import { PovOverlay } from "./PovOverlay";
import { InstantFrame } from "./InstantFrame";
import { poseToken, VISOR_COLOR } from "./tokens";
import { ALERT_COLOR, alertsAt, pulse } from "../alerts/blindSide";
import { pathFor, type Shot } from "./broadcast";
import { beatFraming, BroadcastLayers, filmBroadcast } from "./BroadcastLayers";
import { declutter, labelBox } from "./declutter";
import { MotionBlur } from "./PovMotionBlur";
import { NIGHT, PlayerShadows, Stadium } from "./Stadium";
import { SkeletonLegend } from "../skeleton/SkeletonLegend";
import { pushedBy } from "../beat/beat";
import { BeatLayer3D } from "../beat/BeatLayers";
import { cuts, viewKey } from "../beat/cut";
import { Grade } from "../beat/Grade";

export const EYE_HEIGHT = 1.72; // m
export const POV_HFOV = (95 * Math.PI) / 180;
const LOOK_AHEAD = 10; // m: the camera looks at a point this far ahead, 1.3 m high
const BODY_CENTRE = 0.755; // capsule centre height (body 1.51 m tall)
const HEAD_CENTRE = 1.66; // head sphere centre height
const HEAD_RADIUS = 0.14;
const POV_NEAR = 0.05;
const POV_FAR = 300;
// Shirt numbers: a 0.75 m sprite 2.1 m up; the digits fill about 0.36 m of its height and 1.6
// times that across. One that would sit on a nearer number is lifted by that height (declutter.ts).
const LABEL_Y = 2.1;
const LABEL_TEXT = 0.36;
const LABEL_ASPECT = 1.6;
const labelAt = new THREE.Vector3();
/** Fog (m): in first person the stands fade into the night; the broadcast camera is further out. */
const FOG = { pov: [45, 120], broadcast: [130, 300] } as const;

/**
 * The 3D view. It films through one of two cameras (SPEC 7): first person (above) or the
 * broadcast camera, high on the near side following the ball (broadcast.ts, BroadcastLayers.tsx).
 * One canvas for both, so a cut between them in a breakdown is instant. Both show the stadium
 * (Stadium.tsx); colours go through ACES tone mapping.
 */
export function PovView() {
  const { playback } = useView();
  const broadcast = useStore(playback, (s) => s.camera === "broadcast");
  return (
    <figure
      className={broadcast ? "view pov broadcast" : "view pov"}
      aria-label={broadcast ? "Broadcast view" : "First-person view"}
    >
      <div className="canvas-wrap">
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          gl={{ antialias: true }}
          camera={{ fov: 60, near: POV_NEAR, far: POV_FAR }}
          fallback={<p className="no-webgl">This view needs WebGL.</p>}
        >
          <PovScene />
          <InstantFrame />
        </Canvas>
        <Grade />
        <PovOverlay />
        {broadcast && <SkeletonLegend />}
      </div>
    </figure>
  );
}

const capsule = new THREE.CapsuleGeometry(0.28, 0.95, 6, 14);
const headGeometry = new THREE.SphereGeometry(HEAD_RADIUS, 20, 14);
// A band round the front of the head, centred on its local +x (cylinder angle pi/2), +-55 degrees.
const visorGeometry = new THREE.CylinderGeometry(
  HEAD_RADIUS + 0.008,
  HEAD_RADIUS + 0.008,
  0.075,
  20,
  1,
  true,
  Math.PI / 2 - 0.96,
  1.92,
);

function PovScene() {
  const { hero, playback } = useView();
  useRedrawOn(playback);
  useRedrawOn(trial);
  const rigged = useStore(trial, (s) => s.rigged);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const sample = useMemo(() => new Sample(hero.n), [hero]);
  const shot = useMemo<Shot>(() => ({ x: 0, y: 0, width: 0 }), []);
  const bodies = useRef<(THREE.Group | null)[]>([]);
  const heads = useRef<(THREE.Group | null)[]>([]);
  const alertRings = useRef<(THREE.Mesh | null)[]>([]);
  const ghosts = useRef<(THREE.Mesh | null)[]>([]);
  const labels = useRef<(THREE.Sprite | null)[]>([]);
  const ball = useRef<THREE.Mesh>(null);

  const materials = useMemo(
    () => ({
      shirts: ALL_KITS.map(
        (kit) => new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.6 }),
      ),
      visor: new THREE.MeshBasicMaterial({
        color: VISOR_COLOR,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      ghost: new THREE.MeshBasicMaterial({
        color: COLORS.fg,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
      runnerGhost: new THREE.MeshBasicMaterial({
        color: COLORS.gold,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    }),
    [],
  );

  // Runs before the layers' own frames (negative priority): they read `sample` and the camera.
  useFrame(({ scene, size }) => {
    const s = playback.get();
    const run = hero.runs[s.mode];
    sampleInto(sample, hero, run, s.frame, s.comfort);
    const broadcast = s.camera === "broadcast";
    const pov = hero.ids.indexOf(s.povPlayer);
    const me = broadcast ? -1 : pov; // whose body is hidden: nobody's on broadcast
    const showGhosts = s.beliefGhosts && pov === hero.hero;
    const alerted = new Set(s.blindSide ? alertsAt(hero, run, s.frame).map((a) => a.target) : []);
    const beat = pulse(performance.now() / 1000);
    for (let j = 0; j < hero.n; j++) {
      const ring = alertRings.current[j];
      if (ring) {
        ring.visible = alerted.has(j);
        ring.scale.setScalar(beat);
      }
      const x = sample.pos[2 * j];
      const y = sample.pos[2 * j + 1];
      const body = bodies.current[j];
      const head = heads.current[j];
      if (body && head) {
        body.position.set(x, 0, -y);
        body.visible = j !== me;
        poseToken(body, head, sample.body[j], sample.head[j]);
      }
      const ghost = ghosts.current[j];
      if (ghost) {
        const gx = sample.ghost[2 * j];
        const gy = sample.ghost[2 * j + 1];
        ghost.position.set(gx, BODY_CENTRE, -gy);
        ghost.visible = showGhosts && j !== pov && Math.hypot(gx - x, gy - y) > 1.2;
      }
    }
    ball.current?.position.set(sample.ball[0], 0.11, -sample.ball[1]);
    const aspect = size.width / size.height;
    const fog = scene.fog as THREE.Fog;
    // A switch of camera or view is a clean cut: the camera is on its new pose at once, and the
    // blur passes stay off around it (beat/cut.ts).
    const now = performance.now() / 1000;
    cuts.note(viewKey(s), now);
    if (cuts.inCut(now)) invalidate(); // until the blur has eased back
    [fog.near, fog.far] = FOG[s.camera];
    if (broadcast) {
      // The key-moment beat pushes in on whoever looks, then opens to the player he sees
      // (beat/beat.ts). In first person his field of view stays as it is: the beat slows time
      // and the vignette closes in instead (beat/Grade.tsx).
      const look = pushedBy(hero, run, s.frame);
      filmBroadcast(
        camera,
        pathFor(run, hero.dt),
        s.frame,
        aspect,
        shot,
        look && look.beat.observer >= 0
          ? beatFraming(look.beat, sample, s.frame, look.push)
          : undefined,
      );
    } else {
      // Keep the horizontal field of view fixed whatever the aspect ratio.
      const fov = (2 * Math.atan(Math.tan(POV_HFOV / 2) / aspect) * 180) / Math.PI;
      if (camera.fov !== fov || camera.near !== POV_NEAR || camera.aspect !== aspect) {
        camera.fov = fov;
        camera.near = POV_NEAR;
        camera.far = POV_FAR;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
      const hx = sample.pos[2 * me];
      const hy = sample.pos[2 * me + 1];
      const yaw = sample.head[me];
      camera.position.set(hx, EYE_HEIGHT, -hy);
      camera.lookAt(hx + LOOK_AHEAD * Math.cos(yaw), 1.3, -(hy + LOOK_AHEAD * Math.sin(yaw)));
    }
    // Shirt numbers, nearest first: lifted or hidden where they would sit on another; the
    // runner's gold number always shows.
    camera.updateMatrixWorld();
    const placed = declutter(
      hero.players.map((_, j) => {
        if (j === me || !labels.current[j]) return null;
        labelAt.set(sample.pos[2 * j], LABEL_Y, -sample.pos[2 * j + 1]);
        const box = labelBox(camera, labelAt, LABEL_TEXT, size, LABEL_ASPECT);
        return box && { ...box, priority: j === hero.runner };
      }),
    );
    placed.forEach(({ visible, lift }, j) => {
      const label = labels.current[j];
      if (!label) return;
      label.visible = visible;
      label.position.y = LABEL_Y + lift * LABEL_TEXT;
    });
    if (alerted.size) invalidate(); // keep the blind-side pulse going
  }, -1);

  return (
    <>
      <color attach="background" args={[NIGHT.horizon]} />
      <fog attach="fog" args={[NIGHT.horizon, ...FOG.pov]} />
      <Stadium />
      <Ground />
      <PlayerShadows />
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            bodies.current[j] = g;
          }}
        >
          <mesh
            position-y={BODY_CENTRE}
            geometry={capsule}
            material={materials.shirts[kitSlot(p)]}
            visible={!rigged}
          />
          <mesh
            ref={(m) => {
              alertRings.current[j] = m;
            }}
            rotation-x={-Math.PI / 2}
            position-y={0.03}
            visible={false}
          >
            <ringGeometry args={[0.45, 0.62, 40]} />
            <meshBasicMaterial color={ALERT_COLOR} transparent opacity={0.9} depthWrite={false} />
          </mesh>
          <group
            position-y={HEAD_CENTRE}
            ref={(g) => {
              heads.current[j] = g;
            }}
            visible={!rigged}
          >
            <mesh geometry={headGeometry} material={materials.shirts[kitSlot(p)]} />
            <mesh position-y={0.02} geometry={visorGeometry} material={materials.visor} />
          </group>
          <sprite
            ref={(l) => {
              labels.current[j] = l;
            }}
            position-y={LABEL_Y}
            scale={[0.75, 0.75, 1]}
          >
            <spriteMaterial
              map={getLabelTexture(String(p.number), {
                ...LABEL.shirt,
                color: j === hero.runner ? COLORS.gold : COLORS.white,
              })}
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
        </group>
      ))}
      {hero.players.map((p, j) => (
        <mesh
          key={p.id}
          ref={(m) => {
            ghosts.current[j] = m;
          }}
          geometry={capsule}
          material={j === hero.runner ? materials.runnerGhost : materials.ghost}
          visible={false}
        />
      ))}
      {rigged && (
        <RiggedFallback>
          <Suspense fallback={null}>
            <RiggedPlayers />
          </Suspense>
        </RiggedFallback>
      )}
      <mesh ref={ball}>
        <sphereGeometry args={[0.11, 20, 14]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <BeatLayer3D sample={sample} half={hero.vision?.halfCone ?? 0} />
      <BroadcastLayers sample={sample} />
      <MotionBlur hfov={POV_HFOV} />
    </>
  );
}

/** The apron, the marked pitch and the goals. The capture renderer films the same ground. */
export function Ground() {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <planeGeometry args={[130, 92]} />
        <meshStandardMaterial color="#173826" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[PITCH.length, PITCH.width]} />
        <meshStandardMaterial map={getPitchTexture()} />
      </mesh>
      <Goals />
    </>
  );
}

export function Goals() {
  const posts = [];
  for (const g of [-1, 1]) {
    for (const y of [-3.66, 3.66]) {
      posts.push(
        <mesh key={`${g}${y}`} position={[g * PITCH.halfLength, 1.22, -y]}>
          <cylinderGeometry args={[0.06, 0.06, 2.44, 10]} />
          <meshStandardMaterial color="#f4f6f5" />
        </mesh>,
      );
    }
    posts.push(
      <mesh key={`bar${g}`} position={[g * PITCH.halfLength, 2.44, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.06, 0.06, 7.32, 10]} />
        <meshStandardMaterial color="#f4f6f5" />
      </mesh>,
    );
  }
  return <>{posts}</>;
}
