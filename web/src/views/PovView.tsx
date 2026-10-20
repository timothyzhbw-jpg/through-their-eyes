// First-person view: the camera sits in the chosen player's head (1.72 m) and turns with his head
// yaw; 95 degrees of horizontal field of view (SPEC 7). Players are capsule bodies turned to their
// body yaw, with a head on top turned to their head yaw: a white visor shows where they look.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Sample, sampleInto } from "../data/hero";
import { useSession } from "../session";
import {
  COLORS,
  LABEL,
  PITCH,
  getLabelTexture,
  getPitchTexture,
  teamColor,
  useRedrawOn,
} from "./scene";
import { PovOverlay, PovToolbar } from "./PovOverlay";
import { poseToken, VISOR_COLOR } from "./tokens";

export const EYE_HEIGHT = 1.72; // m
export const POV_HFOV = (95 * Math.PI) / 180;
const LOOK_AHEAD = 10; // m: the camera looks at a point this far ahead, 1.3 m high
const BODY_CENTRE = 0.755; // capsule centre height (body 1.51 m tall)
const HEAD_CENTRE = 1.66; // head sphere centre height
const HEAD_RADIUS = 0.14;

export function PovView() {
  return (
    <figure className="view pov" aria-label="First-person view">
      <PovToolbar />
      <div className="canvas-wrap">
        <Canvas
          frameloop="demand"
          flat
          dpr={[1, 2]}
          gl={{ antialias: true }}
          camera={{ fov: 60, near: 0.05, far: 300 }}
          fallback={<p className="no-webgl">This view needs WebGL.</p>}
        >
          <PovScene />
        </Canvas>
        <PovOverlay />
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
  const { hero, playback } = useSession();
  useRedrawOn(playback);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const sample = useMemo(() => new Sample(hero.n), [hero]);
  const bodies = useRef<(THREE.Group | null)[]>([]);
  const heads = useRef<(THREE.Group | null)[]>([]);
  const ghosts = useRef<(THREE.Mesh | null)[]>([]);
  const ball = useRef<THREE.Mesh>(null);

  // Keep the horizontal field of view fixed whatever the aspect ratio.
  useLayoutEffect(() => {
    camera.aspect = size.width / size.height;
    camera.fov = (2 * Math.atan(Math.tan(POV_HFOV / 2) / camera.aspect) * 180) / Math.PI;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);

  const materials = useMemo(
    () => ({
      teams: [0, 1].map(
        (t) => new THREE.MeshStandardMaterial({ color: teamColor(t), roughness: 0.6 }),
      ),
      visor: new THREE.MeshBasicMaterial({ color: VISOR_COLOR, side: THREE.DoubleSide }),
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

  useFrame(() => {
    const s = playback.get();
    const run = hero.runs[s.mode];
    sampleInto(sample, hero, run, s.frame, s.comfort);
    const me = hero.ids.indexOf(s.povPlayer);
    const showGhosts = s.beliefGhosts && me === hero.hero;
    for (let j = 0; j < hero.n; j++) {
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
        ghost.visible = showGhosts && j !== me && Math.hypot(gx - x, gy - y) > 1.2;
      }
    }
    ball.current?.position.set(sample.ball[0], 0.11, -sample.ball[1]);
    const hx = sample.pos[2 * me];
    const hy = sample.pos[2 * me + 1];
    const yaw = sample.head[me];
    camera.position.set(hx, EYE_HEIGHT, -hy);
    camera.lookAt(hx + LOOK_AHEAD * Math.cos(yaw), 1.3, -(hy + LOOK_AHEAD * Math.sin(yaw)));
  });

  return (
    <>
      <color attach="background" args={["#0c1a16"]} />
      <fog attach="fog" args={["#0c1a16", 45, 120]} />
      <hemisphereLight args={["#dfeee6", "#1b3326", 1.6]} />
      <directionalLight position={[-30, 60, 20]} intensity={1.4} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <planeGeometry args={[130, 92]} />
        <meshStandardMaterial color="#173826" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[PITCH.length, PITCH.width]} />
        <meshStandardMaterial map={getPitchTexture()} />
      </mesh>
      <Goals />
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            bodies.current[j] = g;
          }}
        >
          <mesh position-y={BODY_CENTRE} geometry={capsule} material={materials.teams[p.team]} />
          <group
            position-y={HEAD_CENTRE}
            ref={(g) => {
              heads.current[j] = g;
            }}
          >
            <mesh geometry={headGeometry} material={materials.teams[p.team]} />
            <mesh position-y={0.02} geometry={visorGeometry} material={materials.visor} />
          </group>
          <sprite position-y={2.1} scale={[0.75, 0.75, 1]}>
            <spriteMaterial
              map={getLabelTexture(String(p.number), {
                ...LABEL.shirt,
                color: j === hero.runner ? COLORS.gold : COLORS.white,
              })}
              depthWrite={false}
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
      <mesh ref={ball}>
        <sphereGeometry args={[0.11, 20, 14]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </>
  );
}

function Goals() {
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
