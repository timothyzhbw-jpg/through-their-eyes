// Tactical board: an orthographic camera straight down on the pitch. Shows the POV player's vision
// cone (a shader of the sim's FOV model), who is in his sight, the hero's belief ghosts, the pass
// he played, and the ghost path of the other run. Everything is drawn flat, in layer order
// (renderOrder) with depth testing off, like a 2D canvas, so later GLSL overlays such as pitch
// control can slot in as extra layers.

import { Line } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type ComponentRef, type RefObject } from "react";
import * as THREE from "three";
import { halfCone, isSeen, Sample, sampleInto, speedAt, type Hero, type Run } from "../data/hero";
import type { RunName } from "../data/types";
import { useSession } from "../session";
import type { PlaybackState } from "../store/playback";
import { useStore } from "../store/store";
import {
  COLORS,
  LABEL,
  PITCH,
  getLabelTexture,
  getPitchTexture,
  teamColor,
  useRedrawOn,
} from "./scene";
import { TacticalToolbar } from "./TacticalToolbar";

const EXTENT = { x: 111, y: 74 }; // m shown: the pitch plus a 3 m apron
const TOKEN_R = 0.95; // m
const MIN_TOKEN_PX = 6; // tokens never shrink below this radius on small screens
const NAME_PX = 20; // on-screen height of a name label
const TAG_PX = 24; // on-screen height of a tag such as "shoulder check"
const TAG_ASPECT = 512 / 96; // LABEL.tag canvas
const NAME_ASPECT = 192 / 96; // LABEL.name canvas
const CONE_RADIUS = 45; // m drawn
const LAYER = {
  field: 0,
  pitch: 1,
  goals: 2,
  cone: 3,
  path: 4,
  connector: 5,
  ghost: 6,
  halo: 7,
  token: 8,
  outline: 9,
  number: 10,
  name: 11,
  marker: 12,
  ball: 13,
};
const flat = { transparent: true, depthTest: false, depthWrite: false } as const;
const lie = -Math.PI / 2; // rotate a plane from XY into the pitch plane (XZ)

interface Shared {
  sample: Sample;
  state: PlaybackState;
  run: Run;
  me: number;
}

export function TacticalView() {
  return (
    <figure className="view tac" aria-label="Tactical view from above">
      <TacticalToolbar />
      <div className="canvas-wrap">
        <Canvas
          orthographic
          frameloop="demand"
          flat
          dpr={[1, 2]}
          gl={{ antialias: true }}
          camera={{ position: [0, 100, 0], zoom: 6, near: 1, far: 300 }}
          fallback={<p className="no-webgl">This view needs WebGL.</p>}
        >
          <TacticalScene />
        </Canvas>
      </div>
    </figure>
  );
}

function TacticalScene() {
  const { hero, playback } = useSession();
  useRedrawOn(playback);
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const zoom = Math.max(1e-3, Math.min(size.width / EXTENT.x, size.height / EXTENT.y)); // px/m
  const px = 1 / zoom; // metres per CSS pixel: labels are sized in pixels
  const scale = Math.max(1, MIN_TOKEN_PX / (TOKEN_R * zoom));

  useLayoutEffect(() => {
    camera.up.set(0, 0, -1); // screen up = pitch +y
    camera.position.set(0, 100, 0);
    camera.lookAt(0, 0, 0);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, zoom, invalidate]);

  const mode = useStore(playback, (s) => s.mode);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const shared = useRef<Shared>({
    sample: new Sample(hero.n),
    state: playback.get(),
    run: hero.runs[mode],
    me: hero.hero,
  });
  // Sample once per redraw, before the layers below read it (negative priority runs first).
  useFrame(() => {
    const s = shared.current;
    s.state = playback.get();
    s.run = hero.runs[s.state.mode];
    s.me = hero.ids.indexOf(s.state.povPlayer);
    sampleInto(s.sample, hero, s.run, s.state.frame, s.state.comfort);
  }, -1);

  return (
    <>
      <color attach="background" args={["#14271d"]} />
      <Field />
      <VisionCone hero={hero} shared={shared} />
      <PassLine run={hero.runs[mode]} mode={mode} shared={shared} />
      <OtherRunGhost hero={hero} mode={mode} shared={shared} px={px} />
      <BeliefGhosts hero={hero} shared={shared} scale={scale} />
      <Tokens hero={hero} shared={shared} scale={scale} px={px} pov={hero.ids.indexOf(povPlayer)} />
      <ScanMarker hero={hero} shared={shared} scale={scale} px={px} />
      <Ball shared={shared} scale={Math.max(1, 3.5 / (0.45 * zoom))} />
    </>
  );
}

type SharedRef = RefObject<Shared>;

function Field() {
  const goals = useMemo(
    () =>
      [-1, 1].map((g) => {
        const x = g * PITCH.halfLength;
        const back = x + g * 1.8;
        return [
          [x, 0, -3.66],
          [back, 0, -3.66],
          [back, 0, 3.66],
          [x, 0, 3.66],
        ] as [number, number, number][];
      }),
    [],
  );
  return (
    <>
      <mesh rotation-x={lie} renderOrder={LAYER.field}>
        <planeGeometry args={[EXTENT.x + 40, EXTENT.y + 40]} />
        <meshBasicMaterial color="#14271d" {...flat} />
      </mesh>
      <mesh rotation-x={lie} renderOrder={LAYER.pitch}>
        <planeGeometry args={[PITCH.length, PITCH.width]} />
        <meshBasicMaterial map={getPitchTexture()} {...flat} />
      </mesh>
      {goals.map((points, k) => (
        <Line
          key={k}
          points={points}
          color="#ffffff"
          opacity={0.62}
          lineWidth={1.2}
          renderOrder={LAYER.goals}
          {...flat}
        />
      ))}
    </>
  );
}

// ---------- vision cone: the sim's FOV model as a fragment shader ----------

const coneVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy; // metres from the observer, pitch axes (the disc is rotated into XZ)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Angular term and distance decay of analytics/vision.py field_of_view(); no occlusion yet.
const coneFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uYaw, uHalf, uEdge, uSigmaD, uRadius, uAlpha;
  varying vec2 vPos;
  const float PI = 3.141592653589793;
  void main() {
    float d = length(vPos);
    float off = abs(mod(atan(vPos.y, vPos.x) - uYaw + PI, 2.0 * PI) - PI);
    float angular = off <= uHalf ? 1.0 : exp(-0.5 * pow((off - uHalf) / uEdge, 2.0));
    float fov = angular * exp(-0.5 * pow(d / uSigmaD, 2.0));
    float fade = 1.0 - smoothstep(0.0, uRadius, d); // drawing only: fades the disc edge
    gl_FragColor = vec4(uColor, uAlpha * fov * fade);
  }
`;

function VisionCone({ hero, shared }: { hero: Hero; shared: SharedRef }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: coneVertex,
        fragmentShader: coneFragment,
        uniforms: {
          uColor: { value: new THREE.Color(COLORS.sight) },
          uYaw: { value: 0 },
          uHalf: { value: hero.vision.halfCone },
          uEdge: { value: hero.vision.edgeSigma },
          uSigmaD: { value: hero.vision.distanceSigma },
          uRadius: { value: CONE_RADIUS },
          uAlpha: { value: 0.3 },
        },
        ...flat,
      }),
    [hero],
  );
  useFrame(() => {
    const { sample, state, run, me } = shared.current;
    const m = mesh.current;
    if (!m) return;
    m.visible = state.cone;
    m.position.set(sample.pos[2 * me], 0, -sample.pos[2 * me + 1]);
    const scanning = run.scans.some(
      (s) => s.player === state.povPlayer && sample.frame >= s.start && sample.frame <= s.end,
    );
    material.uniforms.uYaw.value = sample.head[me];
    material.uniforms.uHalf.value = halfCone(hero.vision, speedAt(hero, run, me, state.frame));
    material.uniforms.uAlpha.value = scanning ? 0.5 : 0.3;
  });
  return (
    <mesh ref={mesh} rotation-x={lie} renderOrder={LAYER.cone} material={material}>
      <circleGeometry args={[CONE_RADIUS, 96]} />
    </mesh>
  );
}

// ---------- the pass he played, and the other run's ghost path ----------

function PassLine({ run, mode, shared }: { run: Run; mode: RunName; shared: SharedRef }) {
  const group = useRef<THREE.Group>(null);
  const action = run.action;
  const color = mode === "factual" ? COLORS.sight : COLORS.gold;
  const points = useMemo(() => {
    if (!action) return null;
    const [sx, sy] = action.start;
    const [tx, ty] = action.target;
    return {
      line: [
        [sx, 0, -sy],
        [tx, 0, -ty],
      ] as [number, number, number][],
      tx,
      ty,
    };
  }, [action]);
  useFrame(() => {
    if (group.current && action) group.current.visible = shared.current.state.frame >= action.frame;
  });
  if (!points) return null;
  const c = 0.9;
  return (
    <group ref={group}>
      <Line
        points={points.line}
        color={color}
        lineWidth={2}
        dashed
        dashSize={1.6}
        gapSize={1.2}
        renderOrder={LAYER.path}
        {...flat}
      />
      <Line
        segments
        points={[
          [points.tx - c, 0, -points.ty - c],
          [points.tx + c, 0, -points.ty + c],
          [points.tx + c, 0, -points.ty - c],
          [points.tx - c, 0, -points.ty + c],
        ]}
        color={color}
        lineWidth={2}
        renderOrder={LAYER.path}
        {...flat}
      />
    </group>
  );
}

interface GhostProps {
  hero: Hero;
  mode: RunName;
  shared: SharedRef;
  px: number;
}

function OtherRunGhost({ hero, mode, shared, px }: GhostProps) {
  const other = hero.runs[mode === "factual" ? "counterfactual" : "factual"];
  const color = other.name === "counterfactual" ? COLORS.gold : COLORS.sight;
  const line = useRef<ComponentRef<typeof Line>>(null);
  const group = useRef<THREE.Group>(null);
  const path = useMemo(() => {
    const start = other.decision?.frame ?? 0;
    const end = Math.min(other.frames - 1, other.action?.end ?? other.frames - 1);
    const points: [number, number, number][] = [];
    for (let f = start; f <= end; f++) points.push([other.ball[2 * f], 0, -other.ball[2 * f + 1]]);
    return { start, end, points };
  }, [other]);
  const label = getLabelTexture(
    other.name === "counterfactual" ? "without the look" : "with the look",
    { ...LABEL.tag, color },
  );
  const [ex, , ez] = path.points[path.points.length - 1];
  const tagH = Math.max(2.4, TAG_PX * px);

  useFrame(() => {
    const { state } = shared.current;
    const g = group.current;
    if (!g) return;
    g.visible = state.cfGhost && state.frame >= path.start && path.points.length > 1;
    // Grow the path with the playhead: draw only the segments already "played".
    const done = Math.max(
      1,
      Math.min(path.points.length - 1, Math.floor(state.frame - path.start)),
    );
    if (line.current) line.current.geometry.instanceCount = done;
  });

  return (
    <group ref={group}>
      <Line
        ref={line}
        points={path.points}
        color={color}
        lineWidth={2.5}
        dashed
        dashSize={1.0}
        gapSize={0.8}
        opacity={0.9}
        renderOrder={LAYER.path}
        {...flat}
      />
      <mesh position={[ex, 0, ez - 1.5 - tagH / 2]} rotation-x={lie} renderOrder={LAYER.name}>
        <planeGeometry args={[tagH * TAG_ASPECT, tagH]} />
        <meshBasicMaterial map={label} {...flat} />
      </mesh>
    </group>
  );
}

// ---------- belief ghosts: where the hero thinks everyone is ----------

const circlePoints = (r: number) =>
  Array.from({ length: 41 }, (_, k) => {
    const a = (k / 40) * 2 * Math.PI;
    return [r * Math.cos(a), 0, r * Math.sin(a)] as [number, number, number];
  });

function BeliefGhosts({ hero, shared, scale }: { hero: Hero; shared: SharedRef; scale: number }) {
  const rings = useRef<(THREE.Group | null)[]>([]);
  const all = useRef<THREE.Group>(null);
  const circle = useMemo(() => circlePoints(TOKEN_R), []);
  const connectors = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(hero.n * 6), 3));
    return geometry;
  }, [hero]);

  useFrame(() => {
    const { sample, state, me } = shared.current;
    const show = state.beliefGhosts && me === hero.hero;
    if (all.current) all.current.visible = show;
    if (!show) return;
    const xyz = connectors.attributes.position.array as Float32Array;
    for (let j = 0; j < hero.n; j++) {
      const gx = sample.ghost[2 * j];
      const gy = sample.ghost[2 * j + 1];
      const px = sample.pos[2 * j];
      const py = sample.pos[2 * j + 1];
      const visible = j !== hero.hero && Math.hypot(gx - px, gy - py) >= 1.2;
      const ring = rings.current[j];
      if (ring) {
        ring.visible = visible;
        ring.position.set(gx, 0, -gy);
      }
      xyz.set(visible ? [gx, 0, -gy, px, 0, -py] : [0, 0, 0, 0, 0, 0], j * 6);
    }
    connectors.attributes.position.needsUpdate = true;
  });

  return (
    <group ref={all}>
      <lineSegments geometry={connectors} renderOrder={LAYER.connector}>
        <lineBasicMaterial color={COLORS.fg} opacity={0.32} {...flat} />
      </lineSegments>
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            rings.current[j] = g;
          }}
          scale={scale}
        >
          <Line
            points={circle}
            color={j === hero.runner ? COLORS.gold : COLORS.fg}
            opacity={j === hero.runner ? 1 : 0.75}
            lineWidth={1.5}
            dashed
            dashSize={0.45}
            gapSize={0.35}
            renderOrder={LAYER.ghost}
            {...flat}
          />
        </group>
      ))}
    </group>
  );
}

// ---------- players ----------

interface TokensProps {
  hero: Hero;
  shared: SharedRef;
  scale: number;
  px: number;
  pov: number; // the POV player's index: outlined and named
}

function Tokens({ hero, shared, scale, px, pov }: TokensProps) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const halos = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(() => {
    const { sample, state, run, me } = shared.current;
    for (let j = 0; j < hero.n; j++) {
      groups.current[j]?.position.set(sample.pos[2 * j], 0, -sample.pos[2 * j + 1]);
      const halo = halos.current[j];
      if (halo) halo.visible = j !== me && isSeen(hero, run, state.frame, me, j);
    }
  });

  const nameH = Math.max(1.2, NAME_PX * px);
  return (
    <>
      {hero.players.map((p, j) => {
        const outline =
          j === hero.runner ? COLORS.gold : j === hero.hero || j === pov ? COLORS.white : null;
        const named = j === hero.hero || j === hero.runner || j === pov;
        return (
          <group
            key={p.id}
            ref={(g) => {
              groups.current[j] = g;
            }}
          >
            <group scale={scale}>
              <mesh
                ref={(m) => {
                  halos.current[j] = m;
                }}
                rotation-x={lie}
                renderOrder={LAYER.halo}
              >
                <circleGeometry args={[TOKEN_R + 0.45, 32]} />
                <meshBasicMaterial color={COLORS.sight} opacity={0.55} {...flat} />
              </mesh>
              <mesh rotation-x={lie} renderOrder={LAYER.token}>
                <circleGeometry args={[TOKEN_R, 32]} />
                <meshBasicMaterial color={teamColor(p.team)} {...flat} />
              </mesh>
              {outline && (
                <mesh rotation-x={lie} renderOrder={LAYER.outline}>
                  <ringGeometry args={[TOKEN_R - 0.1, TOKEN_R + 0.16, 32]} />
                  <meshBasicMaterial color={outline} {...flat} />
                </mesh>
              )}
              <mesh rotation-x={lie} renderOrder={LAYER.number}>
                <planeGeometry args={[1.6, 1.6]} />
                <meshBasicMaterial
                  map={getLabelTexture(String(p.number), { ...LABEL.token, color: COLORS.bg })}
                  {...flat}
                />
              </mesh>
            </group>
            {named && (
              <mesh
                position={[0, 0, -(TOKEN_R * scale + nameH / 2)]}
                rotation-x={lie}
                renderOrder={LAYER.name}
              >
                <planeGeometry args={[nameH * NAME_ASPECT, nameH]} />
                <meshBasicMaterial
                  map={getLabelTexture(p.id, {
                    ...LABEL.name,
                    color: j === hero.runner ? COLORS.gold : COLORS.white,
                  })}
                  {...flat}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

// ---------- plan scan marker ----------

interface MarkerProps {
  hero: Hero;
  shared: SharedRef;
  scale: number;
  px: number;
}

function ScanMarker({ hero, shared, scale, px }: MarkerProps) {
  const group = useRef<THREE.Group>(null);
  const label = getLabelTexture("shoulder check", { ...LABEL.tag, color: COLORS.gold });
  const tagH = Math.max(2.4, TAG_PX * px);
  const ring = (TOKEN_R + 1.25) * scale;
  useFrame(() => {
    const { sample, state } = shared.current;
    const g = group.current;
    if (!g) return;
    const scan = state.scanMarker
      ? hero.runs.factual.scans.find((s) => s.id === state.scanMarker)
      : undefined;
    g.visible = !!scan && sample.frame >= scan.start - 6 && sample.frame <= scan.end + 6;
    if (!scan) return;
    const j = hero.ids.indexOf(scan.player);
    g.position.set(sample.pos[2 * j], 0, -sample.pos[2 * j + 1]);
  });
  return (
    <group ref={group} visible={false}>
      <group scale={scale}>
        <mesh rotation-x={lie} renderOrder={LAYER.marker}>
          <ringGeometry args={[TOKEN_R + 0.9, TOKEN_R + 1.25, 48]} />
          <meshBasicMaterial color={COLORS.gold} {...flat} />
        </mesh>
      </group>
      <mesh position={[0, 0, ring + 0.3 + tagH / 2]} rotation-x={lie} renderOrder={LAYER.name}>
        <planeGeometry args={[tagH * TAG_ASPECT, tagH]} />
        <meshBasicMaterial map={label} {...flat} />
      </mesh>
    </group>
  );
}

function Ball({ shared, scale }: { shared: SharedRef; scale: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const { sample } = shared.current;
    group.current?.position.set(sample.ball[0], 0, -sample.ball[1]);
  });
  return (
    <group ref={group} scale={scale}>
      <mesh rotation-x={lie} renderOrder={LAYER.ball}>
        <circleGeometry args={[0.55, 24]} />
        <meshBasicMaterial color={COLORS.bg} {...flat} />
      </mesh>
      <mesh rotation-x={lie} renderOrder={LAYER.ball + 0.5}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial color="#ffffff" {...flat} />
      </mesh>
    </group>
  );
}
