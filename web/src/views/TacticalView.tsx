// Tactical board: an orthographic camera straight down on the pitch. Shows the POV player's vision
// cone (a shader of the sim's FOV model), who is in his sight, the hero's belief ghosts, the pass
// he played, the ghost path of the other run, and on request both teams' pitch control (a shader
// of analytics/pitch_control.py, ../pitchControl/) and the skeleton (../skeleton/). Everything is
// drawn flat, in layer order (renderOrder) with depth testing off, like a 2D canvas.

import { Line } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type ComponentRef, type RefObject } from "react";
import * as THREE from "three";
import {
  actionLabel,
  halfCone,
  isSeen,
  runLabels,
  Sample,
  sampleInto,
  actionTarget,
  speedAt,
  type Hero,
  type Run,
  type Vision,
} from "../data/hero";
import type { RunName } from "../data/types";
import {
  colorFor,
  optionsVisible,
  passOptions,
  valueRange,
  widthFor,
} from "../options/passOptions";
import { useSession, useView } from "../session";
import type { PlaybackState } from "../store/playback";
import { useStore } from "../store/store";
import { ballPath, ghostAt, involvedPlayers, optionOf } from "../whatif/whatif";
import { ghostAlpha, ghostLabelAlpha } from "./ghosts";
import type { Line2 } from "three/examples/jsm/lines/Line2.js";
import { ALERT_COLOR, alertsAt, pulse } from "../alerts/blindSide";
import { isKeeper, kitOf } from "../players/kit";
import { BlindSideOverlay } from "../ui/BlindSideOverlay";
import { pathTagPx, placePathTag } from "./boardLabels";
import { FIELD } from "./fieldMarkings";
import {
  BOARD_EXTENT,
  boardZoom,
  COLORS,
  LABEL,
  PITCH,
  getLabelTexture,
  getPitchTexture,
  teamColor,
  useRedrawOn,
} from "./scene";
import { PitchControlLayer } from "../pitchControl/PitchControlLayer";
import { OptionsOverlay } from "../ui/OptionsOverlay";
import { SkeletonLayer } from "../skeleton/SkeletonLayer";
import { SkeletonLegend } from "../skeleton/SkeletonLegend";
import { aimYaw, VISOR_COLOR } from "./tokens";
import { BeatBoardLayer } from "../beat/BeatLayers";
import { motion } from "../beat/beat";

const TOKEN_R = 0.95; // m
/** A keeper's token keeps its team colour with a band in his kit's colour (players/kit.ts). */
const GK_BAND = [0.55, 0.77] as const; // m, inner and outer radius
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
const DRAW_ON_S = 0.6; // the other run's ghost path draws itself on when it appears

interface Shared {
  sample: Sample;
  state: PlaybackState;
  run: Run;
  me: number;
}

export function TacticalView() {
  const { kind } = useView();
  return (
    <figure className="view tac" aria-label="Tactical view from above">
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
        {kind === "hero" && <OptionsOverlay />}
        <BlindSideOverlay />
        <SkeletonLegend />
      </div>
    </figure>
  );
}

function TacticalScene() {
  const { kind, hero, playback } = useView();
  useRedrawOn(playback);
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const zoom = boardZoom(size.width, size.height); // px/m
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
      <PitchControlLayer hero={hero} renderOrder={LAYER.pitch + 0.5} />
      {hero.vision && <VisionCone hero={hero} vision={hero.vision} shared={shared} />}
      <BeatBoardLayer
        sample={shared.current.sample}
        half={hero.vision?.halfCone ?? 0}
        scale={scale}
        renderOrder={{ sweep: LAYER.cone + 0.5, ring: LAYER.halo + 0.5 }}
      />
      <PassLine run={hero.runs[mode]} mode={mode} shared={shared} />
      {hero.counterfactual && (
        <OtherRunGhost hero={hero} mode={mode} shared={shared} px={px} scale={scale} />
      )}
      <PassOptionsLayer hero={hero} mode={mode} shared={shared} scale={scale} />
      <BeliefGhosts hero={hero} shared={shared} scale={scale} px={px} />
      <SkeletonLayer sample={shared.current.sample} variant="board" scale={scale} />
      <Tokens hero={hero} shared={shared} scale={scale} px={px} pov={hero.ids.indexOf(povPlayer)} />
      <ScanMarker hero={hero} shared={shared} scale={scale} px={px} />
      <Ball shared={shared} scale={Math.max(1, 3.5 / (0.45 * zoom))} />
      {kind === "hero" && <WhatIfGhost hero={hero} shared={shared} scale={scale} px={px} />}
      <BlindSideLayer hero={hero} shared={shared} scale={scale} />
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
          [x, 0, -FIELD.goalHalfWidth],
          [back, 0, -FIELD.goalHalfWidth],
          [back, 0, FIELD.goalHalfWidth],
          [x, 0, FIELD.goalHalfWidth],
        ] as [number, number, number][];
      }),
    [],
  );
  return (
    <>
      <mesh rotation-x={lie} renderOrder={LAYER.field}>
        <planeGeometry args={[BOARD_EXTENT.x + 40, BOARD_EXTENT.y + 40]} />
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

function VisionCone({ hero, vision, shared }: { hero: Hero; vision: Vision; shared: SharedRef }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: coneVertex,
        fragmentShader: coneFragment,
        uniforms: {
          uColor: { value: new THREE.Color(COLORS.sight) },
          uYaw: { value: 0 },
          uHalf: { value: vision.halfCone },
          uEdge: { value: vision.edgeSigma },
          uSigmaD: { value: vision.distanceSigma },
          uRadius: { value: CONE_RADIUS },
          uAlpha: { value: 0.3 },
        },
        ...flat,
      }),
    [vision],
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
    material.uniforms.uHalf.value = halfCone(vision, speedAt(hero, run, me, state.frame));
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
    const [tx, ty] = actionTarget(action); // a pass's target, a shot's aim
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
  scale: number;
  px: number;
}

function OtherRunGhost({ hero, mode, shared, scale, px }: GhostProps) {
  const other = hero.runs[mode === "factual" ? "counterfactual" : "factual"];
  const color = other.name === "counterfactual" ? COLORS.gold : COLORS.sight;
  const line = useRef<ComponentRef<typeof Line>>(null);
  const group = useRef<THREE.Group>(null);
  const tag = useRef<THREE.Mesh>(null);
  const tip = useRef<THREE.Mesh>(null);
  const prefer = useRef(-1);
  const shownAt = useRef<number | null>(null); // wall time the path appeared: it draws itself on
  const invalidate = useThree((s) => s.invalidate);
  const path = useMemo(() => {
    const start = other.decision?.frame ?? 0;
    const end = Math.min(other.frames - 1, other.action?.end ?? other.frames - 1);
    const points: [number, number, number][] = [];
    for (let f = start; f <= end; f++) points.push([other.ball[2 * f], 0, -other.ball[2 * f + 1]]);
    return { start, end, points };
  }, [other]);
  const label = getLabelTexture(runLabels(hero).tag[other.name], { ...LABEL.tag, color });
  const [ex, , ez] = path.points[path.points.length - 1];
  const pitchPx = 105 / px;
  const tagPx = pathTagPx(pitchPx);
  const tagH = tagPx === null ? 0 : Math.max(2.4, tagPx * px);
  const tagW = tagH * TAG_ASPECT;

  useFrame(() => {
    const { sample, state } = shared.current;
    const g = group.current;
    if (!g) return;
    g.visible = state.cfGhost && state.frame >= path.start && path.points.length > 1;
    // Grow the path with the playhead: draw only the segments already "played". When it appears
    // with a stretch already played, that stretch draws itself on over DRAW_ON_S.
    const now = performance.now() / 1000;
    if (!g.visible) shownAt.current = null;
    else if (shownAt.current === null) shownAt.current = motion.get().reduced ? -Infinity : now;
    const drawn = Math.min(1, (now - (shownAt.current ?? -Infinity)) / DRAW_ON_S);
    const played = Math.min(path.points.length - 1, Math.floor(state.frame - path.start));
    const done = Math.max(1, Math.ceil(played * (1 - (1 - drawn) ** 3)));
    if (drawn < 1) invalidate();
    if (line.current) {
      line.current.geometry.instanceCount = done;
      // The dashes march with the playhead, so the path reads as the run it would have been.
      line.current.material.dashOffset = motion.get().reduced ? 0 : -state.frame * 0.09;
    }
    const head = tip.current;
    if (head) {
      const [hx, , hz] = path.points[Math.min(done, path.points.length - 1)];
      head.visible = g.visible && done < path.points.length - 1;
      head.position.set(hx, 0, hz);
      head.scale.setScalar(scale);
    }
    // The tag sits beside the path end, clear of the tokens, and keeps its side while it can.
    const mesh = tag.current;
    if (!mesh) return;
    if (tagPx === null) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const at = placePathTag({
      end: [ex, -ez],
      w: tagW,
      h: tagH,
      tokens: sample.pos,
      clearance: TOKEN_R * scale + 0.4,
      prefer: prefer.current,
    });
    prefer.current = at.index;
    mesh.position.set(at.x, 0, -at.y);
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
      <mesh ref={tip} rotation-x={lie} renderOrder={LAYER.path + 0.5}>
        <circleGeometry args={[0.55, 24]} />
        <meshBasicMaterial color={color} {...flat} opacity={0.95} />
      </mesh>
      <mesh ref={tag} rotation-x={lie} renderOrder={LAYER.name}>
        <planeGeometry args={[tagW, tagH]} />
        <meshBasicMaterial map={label} {...flat} />
      </mesh>
    </group>
  );
}

// ---------- pass options at the decision (SPEC 7) ----------

interface OptionsProps {
  hero: Hero;
  mode: RunName;
  shared: SharedRef;
  scale: number;
}

const w3 = ([x, y]: [number, number]): [number, number, number] => [x, 0, -y];

/** One line per option from the carrier to its believed target: width = chance he chose it,
 * colour = value, the chosen one haloed; dashed: the same option on the true state. */
function PassOptionsLayer({ hero, mode, shared, scale }: OptionsProps) {
  const run = hero.runs[mode];
  const options = useMemo(() => passOptions(hero, run), [hero, run]);
  const range = useMemo(() => valueRange(hero), [hero]);
  const ring = useMemo(() => circlePoints(1.0), []);
  const group = useRef<THREE.Group>(null);
  const decision = run.decision?.frame;
  useFrame(() => {
    const { state } = shared.current;
    if (group.current) {
      group.current.visible =
        state.options && decision !== undefined && optionsVisible(state.frame, decision);
    }
  });
  return (
    <group ref={group} visible={false}>
      {options.map((o) => {
        const color = colorFor(o.value, range);
        const width = widthFor(o.prob);
        if (o.kind !== "pass") {
          return (
            <group key={o.action} position={w3(o.target)} scale={scale}>
              <Line
                points={ring}
                color={color}
                lineWidth={width}
                renderOrder={LAYER.path + 0.3}
                {...flat}
              />
            </group>
          );
        }
        const line = [w3(o.from), w3(o.target)];
        const moved =
          o.targetTrue &&
          Math.hypot(o.targetTrue[0] - o.target[0], o.targetTrue[1] - o.target[1]) > 1.5;
        return (
          <group key={o.action}>
            {o.chosen && (
              <Line
                points={line}
                color="#ffffff"
                opacity={0.35}
                lineWidth={width + 6}
                renderOrder={LAYER.path + 0.1}
                {...flat}
              />
            )}
            {moved && o.targetTrue && (
              <Line
                points={[w3(o.from), w3(o.targetTrue)]}
                color={colorFor(o.valueTrue ?? o.value, range)}
                opacity={0.9}
                lineWidth={1.6}
                dashed
                dashSize={1.2}
                gapSize={0.9}
                renderOrder={LAYER.path + 0.2}
                {...flat}
              />
            )}
            <Line
              points={line}
              color={color}
              lineWidth={width}
              renderOrder={LAYER.path + 0.3}
              {...flat}
            />
          </group>
        );
      })}
    </group>
  );
}

// ---------- belief ghosts: where the hero thinks everyone is ----------

const circlePoints = (r: number) =>
  Array.from({ length: 41 }, (_, k) => {
    const a = (k / 40) * 2 * Math.PI;
    return [r * Math.cos(a), 0, r * Math.sin(a)] as [number, number, number];
  });

function BeliefGhosts({
  hero,
  shared,
  scale,
  px,
}: {
  hero: Hero;
  shared: SharedRef;
  scale: number;
  px: number;
}) {
  const rings = useRef<(THREE.Group | null)[]>([]);
  const tag = useRef<THREE.Mesh>(null);
  const tagH = Math.max(2.4, TAG_PX * px);
  const tagMap = useMemo(() => {
    const number = hero.runner >= 0 ? hero.players[hero.runner].number : null;
    return number === null
      ? null
      : getLabelTexture(`where he thinks #${number} is`, { ...LABEL.tag, color: COLORS.gold });
  }, [hero]);
  const lines = useRef<(Line2 | null)[]>([]);
  const all = useRef<THREE.Group>(null);
  const circle = useMemo(() => circlePoints(TOKEN_R), []);
  const connectors = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(hero.n * 6), 3));
    // RGBA per end: each line fades with its ghost (views/ghosts.ts)
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(hero.n * 8), 4));
    return geometry;
  }, [hero]);
  const fg = useMemo(() => new THREE.Color(COLORS.fg), []);

  useFrame(() => {
    const { sample, state, run, me } = shared.current;
    const show = state.beliefGhosts && me === hero.hero;
    if (all.current) all.current.visible = show;
    if (!show) return;
    const xyz = connectors.attributes.position.array as Float32Array;
    const rgba = connectors.attributes.color.array as Float32Array;
    let runnerAlpha = 0;
    for (let j = 0; j < hero.n; j++) {
      const gx = sample.ghost[2 * j];
      const gy = sample.ghost[2 * j + 1];
      const px = sample.pos[2 * j];
      const py = sample.pos[2 * j + 1];
      // Which ghosts and how strongly: the runner's in the moment by default, everyone's on request.
      const alpha = ghostAlpha(hero, run, state.frame, j, state.ghostsAll);
      if (j === hero.runner) runnerAlpha = alpha;
      const visible = alpha > 0.01;
      const ring = rings.current[j];
      if (ring) {
        ring.visible = visible;
        ring.position.set(gx, 0, -gy);
      }
      const line = lines.current[j];
      if (line) line.material.opacity = alpha * (j === hero.runner ? 1 : 0.75);
      xyz.set(visible ? [gx, 0, -gy, px, 0, -py] : [0, 0, 0, 0, 0, 0], j * 6);
      rgba.set([fg.r, fg.g, fg.b, 0.32 * alpha, fg.r, fg.g, fg.b, 0.32 * alpha], j * 8);
    }
    connectors.attributes.position.needsUpdate = true;
    connectors.attributes.color.needsUpdate = true;
    // For its first seconds the runner's ghost says what it is, above his ring (his real token and
    // name are usually just below it: the picture lags the run).
    const t = tag.current;
    if (t && hero.runner >= 0) {
      const a = runnerAlpha * ghostLabelAlpha(hero, run, state.frame);
      t.visible = a > 0.01;
      (t.material as THREE.MeshBasicMaterial).opacity = a;
      const r = hero.runner;
      t.position.set(
        sample.ghost[2 * r],
        0,
        -sample.ghost[2 * r + 1] - TOKEN_R * scale - tagH * 0.75,
      );
    }
  });

  return (
    <group ref={all}>
      <lineSegments geometry={connectors} renderOrder={LAYER.connector}>
        <lineBasicMaterial vertexColors {...flat} />
      </lineSegments>
      {tagMap && (
        <mesh ref={tag} rotation-x={lie} renderOrder={LAYER.name} visible={false}>
          <planeGeometry args={[tagH * TAG_ASPECT, tagH]} />
          <meshBasicMaterial map={tagMap} opacity={0} {...flat} />
        </mesh>
      )}
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            rings.current[j] = g;
          }}
          scale={scale}
          visible={false}
        >
          <Line
            ref={(l) => {
              lines.current[j] = l as Line2 | null;
            }}
            points={circle}
            color={j === hero.runner ? COLORS.gold : COLORS.fg}
            opacity={0}
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
  const ticks = useRef<(THREE.Group | null)[]>([]);

  useFrame(() => {
    const { sample, state, run, me } = shared.current;
    for (let j = 0; j < hero.n; j++) {
      groups.current[j]?.position.set(sample.pos[2 * j], 0, -sample.pos[2 * j + 1]);
      const tick = ticks.current[j];
      if (tick) {
        aimYaw(tick, sample.head[j]);
        tick.visible = !state.skeleton; // the skeleton draws its own head ray
      }
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
              {/* Head direction: a short tick from the edge of the token. */}
              <group
                ref={(g) => {
                  ticks.current[j] = g;
                }}
              >
                <mesh position-x={TOKEN_R + 0.6} rotation-x={lie} renderOrder={LAYER.halo + 0.5}>
                  <planeGeometry args={[1.1, 0.3]} />
                  <meshBasicMaterial color={VISOR_COLOR} opacity={0.95} {...flat} />
                </mesh>
              </group>
              <mesh rotation-x={lie} renderOrder={LAYER.token}>
                <circleGeometry args={[TOKEN_R, 32]} />
                <meshBasicMaterial color={teamColor(p.team)} {...flat} />
              </mesh>
              {isKeeper(p) && (
                <mesh rotation-x={lie} renderOrder={LAYER.token + 0.5}>
                  <ringGeometry args={[...GK_BAND, 32]} />
                  <meshBasicMaterial color={kitOf(p).shirt} {...flat} />
                </mesh>
              )}
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

// ---------- "What if…?" ghost (SPEC 6, 7) ----------

interface WhatIfGhostProps {
  hero: Hero;
  shared: SharedRef;
  scale: number;
  px: number;
}

/** The forced run over the actual one, from the decision on: its ball path, growing with the
 * playhead, and ghosts of the players on the ball in it (passer, target, receiver) where they
 * would have been. Gold: it never happened. */
function WhatIfGhost({ hero, shared, scale, px }: WhatIfGhostProps) {
  const { whatIfs, playback } = useSession();
  const selected = useStore(playback, (s) => s.whatIf);
  const option = optionOf(whatIfs, selected);
  const run = option?.run ?? null;
  const path = useMemo(
    () => (run ? ballPath(run).map(([x, y]) => [x, 0, -y] as [number, number, number]) : null),
    [run],
  );
  const ghost = useMemo(
    () => ({ pos: new Float32Array(2 * hero.n), ball: new Float32Array(2) }),
    [hero],
  );
  const involved = useMemo(() => (run ? involvedPlayers(run) : new Set<string>()), [run]);
  const group = useRef<THREE.Group>(null);
  const line = useRef<ComponentRef<typeof Line>>(null);
  const tokens = useRef<(THREE.Group | null)[]>([]);
  const ball = useRef<THREE.Group>(null);

  useFrame(() => {
    const { sample, state } = shared.current;
    const g = group.current;
    if (!g) return;
    const show = !!run && state.mode === "factual" && ghostAt(run, hero.n, state.frame, ghost);
    g.visible = show;
    if (!show || !run) return;
    const done = Math.max(1, Math.min(run.frames - 1, Math.floor(state.frame - run.start)));
    if (line.current) line.current.geometry.instanceCount = done;
    for (let j = 0; j < hero.n; j++) {
      const t = tokens.current[j];
      if (!t) continue;
      const moved = Math.hypot(
        ghost.pos[2 * j] - sample.pos[2 * j],
        ghost.pos[2 * j + 1] - sample.pos[2 * j + 1],
      );
      t.visible = involved.has(hero.ids[j]) && moved > 1.0;
      t.position.set(ghost.pos[2 * j], 0, -ghost.pos[2 * j + 1]);
    }
    ball.current?.position.set(ghost.ball[0], 0, -ghost.ball[1]);
  });

  if (!run || !path || !option) return null;
  const tagH = Math.max(2.4, TAG_PX * px);
  const [ex, , ez] = path[path.length - 1];
  const what = actionLabel(option.action);
  const label = getLabelTexture(option.tag ?? `what if: ${what[0].toLowerCase()}${what.slice(1)}`, {
    ...LABEL.tag,
    color: COLORS.gold,
  });
  return (
    <group ref={group} visible={false}>
      <Line
        ref={line}
        points={path}
        color={COLORS.gold}
        lineWidth={2.5}
        dashed
        dashSize={1.0}
        gapSize={0.8}
        renderOrder={LAYER.path}
        {...flat}
      />
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            tokens.current[j] = g;
          }}
          scale={scale}
          visible={false}
        >
          <mesh rotation-x={lie} renderOrder={LAYER.halo}>
            <circleGeometry args={[TOKEN_R, 32]} />
            <meshBasicMaterial color={COLORS.gold} opacity={0.35} {...flat} />
          </mesh>
          <mesh rotation-x={lie} renderOrder={LAYER.halo}>
            <ringGeometry args={[TOKEN_R - 0.12, TOKEN_R + 0.08, 32]} />
            <meshBasicMaterial color={COLORS.gold} opacity={0.9} {...flat} />
          </mesh>
        </group>
      ))}
      <group ref={ball} scale={Math.max(1, scale * 0.8)}>
        <mesh rotation-x={lie} renderOrder={LAYER.ball}>
          <ringGeometry args={[0.35, 0.6, 24]} />
          <meshBasicMaterial color={COLORS.gold} {...flat} />
        </mesh>
      </group>
      <mesh position={[ex, 0, ez - 1.5 - tagH / 2]} rotation-x={lie} renderOrder={LAYER.name}>
        <planeGeometry args={[tagH * TAG_ASPECT, tagH]} />
        <meshBasicMaterial map={label} {...flat} />
      </mesh>
    </group>
  );
}

// ---------- blind-side alerts (SPEC 4.4, 7) ----------

interface BlindSideProps {
  hero: Hero;
  shared: SharedRef;
  scale: number;
}

/** A thin line from each observer to the player he has lost sight of, and a pulsing ring on that
 * player. Lines of the POV player's own alerts are brighter. Redraws continuously while on. */
function BlindSideLayer({ hero, shared, scale }: BlindSideProps) {
  const invalidate = useThree((s) => s.invalidate);
  const rings = useRef<(THREE.Group | null)[]>([]);
  const lines = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(hero.n * hero.n * 6), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(hero.n * hero.n * 6), 3),
    );
    return geometry;
  }, [hero]);
  const bright = useMemo(() => new THREE.Color(ALERT_COLOR), []);
  const dim = useMemo(() => new THREE.Color(ALERT_COLOR).multiplyScalar(0.55), []);

  useFrame(() => {
    const { sample, state, run, me } = shared.current;
    const alerts = state.blindSide ? alertsAt(hero, run, state.frame) : [];
    const xyz = lines.attributes.position.array as Float32Array;
    const rgb = lines.attributes.color.array as Float32Array;
    alerts.forEach((a, k) => {
      const [ox, oy] = [sample.pos[2 * a.observer], sample.pos[2 * a.observer + 1]];
      const [tx, ty] = [sample.pos[2 * a.target], sample.pos[2 * a.target + 1]];
      xyz.set([ox, 0, -oy, tx, 0, -ty], k * 6);
      const c = a.observer === me ? bright : dim;
      rgb.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
    });
    lines.setDrawRange(0, alerts.length * 2);
    lines.attributes.position.needsUpdate = true;
    lines.attributes.color.needsUpdate = true;
    const targets = new Set(alerts.map((a) => a.target));
    const beat = pulse(performance.now() / 1000);
    for (let j = 0; j < hero.n; j++) {
      const ring = rings.current[j];
      if (!ring) continue;
      ring.visible = targets.has(j);
      ring.position.set(sample.pos[2 * j], 0, -sample.pos[2 * j + 1]);
      ring.scale.setScalar(scale * beat);
    }
    if (alerts.length) invalidate(); // keep the pulse going
  });

  return (
    <group>
      <lineSegments geometry={lines} renderOrder={LAYER.connector}>
        <lineBasicMaterial vertexColors opacity={0.9} {...flat} />
      </lineSegments>
      {hero.players.map((p, j) => (
        <group
          key={p.id}
          ref={(g) => {
            rings.current[j] = g;
          }}
          visible={false}
        >
          <mesh rotation-x={lie} renderOrder={LAYER.halo}>
            <ringGeometry args={[TOKEN_R + 0.35, TOKEN_R + 0.75, 40]} />
            <meshBasicMaterial color={ALERT_COLOR} opacity={0.85} {...flat} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
