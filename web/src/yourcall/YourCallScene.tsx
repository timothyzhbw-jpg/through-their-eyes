// "Your call" (SPEC 7): the 3D view, filmed from behind the ball carrier (camera.ts). While the
// viewer decides it shows his picture: everyone where he believed they were, those he had not
// seen lately as grey ghosts, a ring on the grass under each option. The reveal plays the call's
// re-simulated run (Dusk ball, grass ring and dashed trail: it never happened), moves everyone
// from his picture to the truth, then plays what he did. Tokens, not the animated players: a
// picture in his head.

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { NIGHT, Stadium } from "../views/Stadium";
import { Goals } from "../views/PovView";
import {
  COLORS,
  LABEL,
  PITCH,
  getLabelTexture,
  getPitchTexture,
  teamColor,
  useRedrawOn,
} from "../views/scene";
import { useStore } from "../store/store";
import { TOKEN_SCALE } from "./camera";
import type { YourCall } from "./controller";
import { newPose, poseAt } from "./options";

const BODY_CENTRE = 0.755;
const HEAD_CENTRE = 1.66;
const BALL_R = 0.45; // drawn larger than a real ball: the camera is far back
const TRAIL = 200; // points in the ball's trail
const GREY = "#9aa39f";
// Floodlit's tokens (styles.css): Floodlight marks the options, Dusk the run that never happened.
const FLOODLIGHT = "#f6d566";
const DUSK = "#95a7ba";

const capsule = new THREE.CapsuleGeometry(0.3, 0.95, 6, 14);
const headGeometry = new THREE.SphereGeometry(0.15, 18, 12);
const ringGeometry = new THREE.RingGeometry(0.85, 1.15, 40);
const markerRing = new THREE.RingGeometry(1.2, 1.55, 48);
const ballRingGeometry = new THREE.RingGeometry(1.0, 1.4, 48);

type Look = "solid" | "belief" | "stale" | "ghost";

export function YourCallScene({ yc, pose }: { yc: YourCall; pose: THREE.PerspectiveCamera }) {
  const { session, options, picture } = yc;
  const { hero } = session;
  useRedrawOn(yc.state);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const aim = useStore(yc.state, (s) => s.aim);
  const step = useStore(yc.state, (s) => s.step);
  const clip = useStore(yc.state, (s) => s.clip);

  useLayoutEffect(() => {
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    camera.fov = pose.fov;
    camera.near = pose.near;
    camera.far = pose.far;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, pose, invalidate]);

  const materials = useMemo(() => {
    const make = (color: string, opacity: number) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
      });
    return {
      solid: [0, 1].map((t) => make(teamColor(t), 1)),
      belief: [0, 1].map((t) => make(teamColor(t), 0.78)),
      ghost: [0, 1].map((t) => make(teamColor(t), 0.5)),
      stale: [0, 1].map(() => make(GREY, 0.3)),
    } satisfies Record<Look, THREE.Material[]>;
  }, []);
  useEffect(
    () => () => {
      for (const list of Object.values(materials)) list.forEach((m) => m.dispose());
    },
    [materials],
  );
  const bodies = useRef<(THREE.Mesh | null)[]>([]);
  const heads = useRef<(THREE.Mesh | null)[]>([]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const believedRings = useRef<(THREE.Mesh | null)[]>([]);
  const ball = useRef<THREE.Group>(null);
  const ballMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const ballRingMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const ghostBall = useRef<THREE.Group>(null);
  const links = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(hero.n * 6), 3));
    return g;
  }, [hero]);
  useEffect(() => () => links.dispose(), [links]);
  const work = useMemo(() => ({ a: newPose(hero.n), b: newPose(hero.n) }), [hero]);
  const trailOf = options.find((o) => o.action === clip?.of) ?? null;
  const trailPoints = useMemo(() => {
    const points: [number, number, number][] = [];
    if (!clip || !trailOf || step === "deciding" || step === "closed" || step === "truth")
      return points;
    const sample = newPose(hero.n);
    for (let f = clip.start; f <= Math.floor(clip.frame) && points.length < TRAIL - 1; f++) {
      poseAt(hero, trailOf, f, sample);
      points.push([sample.ball[0], 0.12, -sample.ball[1]]);
    }
    poseAt(hero, trailOf, clip.frame, sample);
    points.push([sample.ball[0], 0.12, -sample.ball[1]]);
    return points;
  }, [hero, clip, trailOf, step]);

  useFrame(() => {
    if (!picture) return;
    const s = yc.state.get();
    const byAction = (a: string | null) => options.find((o) => o.action === a) ?? null;
    const pos = work.a.pos;
    const looks: Look[] = new Array(hero.n).fill("solid");
    let ballAt: [number, number] = [picture.ball[0], picture.ball[1]];
    let forced = false;
    const lerp = s.step === "truth" ? ease(s.morph) : 0;

    if (s.step === "deciding" || s.step === "closed" || s.step === "truth") {
      for (const p of picture.players) {
        const t = s.step === "truth" ? lerp : 0;
        pos[2 * p.j] = p.believed[0] + (p.truth[0] - p.believed[0]) * t;
        pos[2 * p.j + 1] = p.believed[1] + (p.truth[1] - p.believed[1]) * t;
        if (s.step === "deciding" && p.j !== picture.carrier)
          looks[p.j] = p.stale ? "stale" : "belief";
      }
    } else if (s.clip) {
      const option = byAction(s.clip.of);
      if (option) {
        poseAt(hero, option, s.clip.frame, work.a);
        ballAt = [work.a.ball[0], work.a.ball[1]];
        forced = !option.factual;
        if (forced) looks.fill("ghost");
      }
    }

    for (let j = 0; j < hero.n; j++) {
      const g = groups.current[j];
      if (g) g.position.set(pos[2 * j], 0, -pos[2 * j + 1]);
      const team = hero.players[j].team;
      const material = materials[looks[j]][team];
      if (bodies.current[j]) bodies.current[j]!.material = material;
      if (heads.current[j]) heads.current[j]!.material = material;
    }

    // Truth beat: a ring where he pictured each misplaced player, linked to where he was.
    const xyz = links.attributes.position.array as Float32Array;
    for (const p of picture.players) {
      const ring = believedRings.current[p.j];
      const show = s.step === "truth" && p.off;
      if (ring) {
        ring.visible = show;
        ring.position.set(p.believed[0], 0.04, -p.believed[1]);
      }
      xyz.set(
        show
          ? [p.believed[0], 0.05, -p.believed[1], pos[2 * p.j], 0.05, -pos[2 * p.j + 1]]
          : [0, 0, 0, 0, 0, 0],
        p.j * 6,
      );
    }
    links.attributes.position.needsUpdate = true;

    ball.current?.position.set(ballAt[0], 0, -ballAt[1]);
    ballMaterial.current?.color.set(forced ? DUSK : COLORS.white);
    ballRingMaterial.current?.color.set(forced ? DUSK : COLORS.white);

    // Compared: where the viewer's call left the ball, beside what he did.
    const pick = byAction(s.pick);
    const g = ghostBall.current;
    if (g) {
      g.visible = s.step === "compare" && !!pick && !pick.factual;
      if (g.visible && pick) {
        poseAt(hero, pick, Number.MAX_SAFE_INTEGER, work.b);
        g.position.set(work.b.ball[0], 0, -work.b.ball[1]);
      }
    }
  });

  if (!picture) return null;
  return (
    <>
      <color attach="background" args={[NIGHT.horizon]} />
      <fog attach="fog" args={[NIGHT.horizon, 150, 360]} />
      <Stadium />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <planeGeometry args={[130, 92]} />
        <meshStandardMaterial color="#173826" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[PITCH.length, PITCH.width]} />
        <meshStandardMaterial map={getPitchTexture()} />
      </mesh>
      <Goals />
      {step === "deciding" &&
        options.map((o) => (
          <mesh
            key={o.action}
            geometry={markerRing}
            rotation-x={-Math.PI / 2}
            position={[o.anchor[0], 0.03, -o.anchor[1]]}
          >
            <meshBasicMaterial
              color={FLOODLIGHT}
              transparent
              opacity={aim === o.action ? 1 : 0.55}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            groups.current[j] = g;
          }}
          scale={TOKEN_SCALE}
        >
          {j === picture.carrier && (
            <mesh geometry={ringGeometry} rotation-x={-Math.PI / 2} position-y={0.03}>
              <meshBasicMaterial color={COLORS.white} depthWrite={false} toneMapped={false} />
            </mesh>
          )}
          <mesh
            ref={(m) => {
              bodies.current[j] = m;
            }}
            geometry={capsule}
            position-y={BODY_CENTRE}
            material={materials.solid[p.team]}
          />
          <mesh
            ref={(m) => {
              heads.current[j] = m;
            }}
            geometry={headGeometry}
            position-y={HEAD_CENTRE}
            material={materials.solid[p.team]}
          />
          {/* While deciding, the option markers carry the numbers. */}
          <sprite position-y={2.35} scale={[1.1, 1.1, 1]} visible={step !== "deciding"}>
            <spriteMaterial
              map={getLabelTexture(String(p.number), { ...LABEL.shirt, color: COLORS.white })}
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
        </group>
      ))}
      {picture.players.map((p) => (
        <mesh
          key={p.id}
          ref={(m) => {
            believedRings.current[p.j] = m;
          }}
          geometry={ringGeometry}
          rotation-x={-Math.PI / 2}
          visible={false}
        >
          <meshBasicMaterial color={COLORS.white} transparent opacity={0.8} depthWrite={false} />
        </mesh>
      ))}
      <lineSegments geometry={links}>
        <lineBasicMaterial color={COLORS.white} transparent opacity={0.7} depthWrite={false} />
      </lineSegments>
      {trailPoints.length > 1 && (
        <Line
          points={trailPoints}
          color={trailOf?.factual ? COLORS.white : DUSK}
          lineWidth={3}
          dashed={!trailOf?.factual}
          dashSize={1.0}
          gapSize={0.8}
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
        />
      )}
      <group ref={ball}>
        <mesh position-y={BALL_R}>
          <sphereGeometry args={[BALL_R, 20, 14]} />
          <meshBasicMaterial ref={ballMaterial} toneMapped={false} />
        </mesh>
        <mesh geometry={ballRingGeometry} rotation-x={-Math.PI / 2} position-y={0.04}>
          <meshBasicMaterial ref={ballRingMaterial} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <group ref={ghostBall} visible={false}>
        <mesh position-y={BALL_R}>
          <sphereGeometry args={[BALL_R, 20, 14]} />
          <meshBasicMaterial color={DUSK} transparent opacity={0.8} toneMapped={false} />
        </mesh>
        <mesh geometry={ballRingGeometry} rotation-x={-Math.PI / 2} position-y={0.04}>
          <meshBasicMaterial color={DUSK} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

/** Ease in and out (smoothstep) for the move from his picture to the truth. */
function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
