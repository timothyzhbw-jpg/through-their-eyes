// What the key-moment beat draws (SPEC 7, beat.ts): the arc of pitch his look swept, filling in
// as he turns with the current gaze brightest, and a gold ring with a glow on the player the look
// is for from the frame he first comes into sight. In the 3D view (the sweep on the grass on the
// broadcast camera, faint in first person) and on the tactical board. All of it follows the
// frame, so a paused or replayed beat looks the same; nothing here is a number.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { type Hero, type Run, type Sample, wrapAngle } from "../data/hero";
import { useView } from "../session";
import type { PlaybackState } from "../store/playback";
import { COLORS } from "../views/scene";
import { quality } from "../quality/quality";
import { beatAt, beatsOf, motion, popAt, pushAt, ringAt, type Beat } from "./beat";

const SWEEP_RADIUS = 30; // m drawn
const SWEEP_FADE_S = 1.0; // match seconds the swept arc stays after the scan
const RING = COLORS.gold;

/** The arc a look has swept by frame `f`: from yaw `from` over `span` rad, gaze at `lead`. */
export interface Sweep {
  from: number;
  span: number;
  lead: number; // current gaze, rad from `from`
  alpha: number; // 0..1: full during the scan, fading after it
}

const sweepCache = new WeakMap<Beat, Map<Run, Float64Array>>();

/** Head yaw relative to the scan's first frame, unwrapped, per frame of the scan and its fade. */
function relYaw(hero: Hero, run: Run, b: Beat): Float64Array {
  let byRun = sweepCache.get(b);
  if (!byRun) sweepCache.set(b, (byRun = new Map()));
  let rel = byRun.get(run);
  if (rel) return rel;
  const { start, end } = b.scan;
  const n = hero.n;
  const j = b.observer;
  rel = new Float64Array(end - start + 1);
  for (let f = start + 1; f <= end; f++) {
    const d = wrapAngle(run.head[f * n + j] - run.head[(f - 1) * n + j]);
    rel[f - start] = rel[f - start - 1] + d;
  }
  byRun.set(run, rel);
  return rel;
}

/** The swept arc at frame `f`, widened by the half cone on both sides; null outside a scan. */
export function sweepAt(hero: Hero, run: Run, b: Beat, f: number, half: number): Sweep | null {
  const { start, end } = b.scan;
  if (b.dropped || f < start) return null;
  const age = (f - end) * hero.dt;
  if (age > SWEEP_FADE_S) return null;
  const rel = relYaw(hero, run, b);
  const upto = Math.min(end, f) - start;
  const i = Math.floor(upto);
  const t = upto - i;
  const now = i + 1 < rel.length ? rel[i] + (rel[i + 1] - rel[i]) * t : rel[i];
  let lo = Math.min(0, now);
  let hi = Math.max(0, now);
  for (let k = 0; k <= i; k++) {
    lo = Math.min(lo, rel[k]);
    hi = Math.max(hi, rel[k]);
  }
  const base = run.head[start * hero.n + b.observer];
  const span = Math.min(2 * Math.PI, hi - lo + 2 * half);
  return {
    from: base + lo - half,
    span,
    lead: now - lo + half,
    alpha: age <= 0 ? 1 : 1 - age / SWEEP_FADE_S,
  };
}

const sweepVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy; // metres from the observer, pitch axes (the disc lies in the pitch plane)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const sweepFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFrom, uSpan, uLead, uRadius, uAlpha;
  varying vec2 vPos;
  const float TAU = 6.283185307179586;
  void main() {
    float d = length(vPos);
    float rel = mod(atan(vPos.y, vPos.x) - uFrom + 2.0 * TAU, TAU);
    if (rel > uSpan) discard;
    float edge = smoothstep(0.0, 0.05, rel) * smoothstep(0.0, 0.05, uSpan - rel);
    float gaze = exp(-pow((rel - uLead) / 0.16, 2.0));
    float fade = 1.0 - smoothstep(uRadius * 0.25, uRadius, d);
    gl_FragColor = vec4(uColor, uAlpha * edge * fade * (0.35 + 0.65 * gaze));
  }
`;

function sweepMaterial(flat: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: sweepVertex,
    fragmentShader: sweepFragment,
    uniforms: {
      uColor: { value: new THREE.Color(COLORS.gold) },
      uFrom: { value: 0 },
      uSpan: { value: 0 },
      uLead: { value: 0 },
      uRadius: { value: SWEEP_RADIUS },
      uAlpha: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: !flat,
    blending: THREE.AdditiveBlending,
    polygonOffset: !flat,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

function glowTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,226,140,0.9)");
  g.addColorStop(0.35, "rgba(255,214,110,0.35)");
  g.addColorStop(1, "rgba(255,214,110,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Frame {
  beat: Beat | null;
  run: Run;
  s: PlaybackState;
}

/** The beat on screen: its window holds the frame (or its ring or sweep still fades). */
function current(hero: Hero, s: PlaybackState): Frame {
  const run = hero.runs[s.mode];
  const beats = beatsOf(hero, run);
  const tail = Math.max(SWEEP_FADE_S, 1.2) / hero.dt; // longest fade after the window
  const beat =
    beatAt(beats, s.frame) ?? beats.find((b) => s.frame > b.end && s.frame <= b.end + tail) ?? null;
  return { beat, run, s };
}

/** In the 3D view: the ring and glow on the target, and the sweep on the grass. */
export function BeatLayer3D({ sample, half }: { sample: Sample; half: number }) {
  const { hero, playback } = useView();
  const ring = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const sweep = useRef<THREE.Mesh>(null);
  const mats = useMemo(
    () => ({
      ring: new THREE.MeshBasicMaterial({
        color: RING,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
      glow: new THREE.SpriteMaterial({
        map: glowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
      sweep: sweepMaterial(false),
    }),
    [],
  );

  useFrame(({ camera, gl }) => {
    const { beat, run, s } = current(hero, playback.get());
    const r = ring.current;
    const g = glow.current;
    const w = sweep.current;
    if (!r || !g || !w) return;
    const shown = beat && beat.target >= 0 ? ringAt(beat, s.frame) : 0;
    // For checks (the smoke test): the beat's push and the target's ring on screen.
    const data = gl.domElement.dataset;
    const push = pushAt(hero, run, s.frame).toFixed(2);
    if (data.beatPush !== push) data.beatPush = push;
    if (data.beatRing !== shown.toFixed(2)) data.beatRing = shown.toFixed(2);
    r.visible = g.visible = shown > 0;
    if (beat && shown > 0) {
      const x = sample.pos[2 * beat.target];
      const y = sample.pos[2 * beat.target + 1];
      const pop = motion.get().reduced ? 0 : popAt(beat, s.frame);
      // Far away in first person a ring of a metre is a few pixels: keep it readable.
      r.position.set(x, 0.04, -y);
      const far =
        s.camera === "pov" ? Math.max(1, camera.position.distanceTo(r.position) / 14) : 1.3;
      r.scale.setScalar(far * (1 + 0.7 * pop));
      mats.ring.opacity = 0.9 * shown;
      g.position.set(x, 1.15, -y);
      g.scale.setScalar(2.6 * far * (1 + 0.5 * pop));
      mats.glow.opacity = 0.75 * shown;
    }
    const arc = beat ? sweepAt(hero, run, beat, s.frame, half) : null;
    w.visible = !!arc && beat!.observer >= 0;
    if (arc && beat) {
      w.position.set(sample.pos[2 * beat.observer], 0.03, -sample.pos[2 * beat.observer + 1]);
      const u = mats.sweep.uniforms;
      u.uFrom.value = arc.from;
      u.uSpan.value = arc.span;
      u.uLead.value = arc.lead;
      // The post tiers add it as light in linear space and encode after (quality/): the same
      // look on screen takes about a third of the light.
      const post = quality.get().tier !== "standard" ? 0.3 : 1;
      u.uAlpha.value = arc.alpha * (s.camera === "broadcast" ? 0.34 : 0.12) * post;
    }
  });

  return (
    <>
      <mesh
        ref={sweep}
        rotation-x={-Math.PI / 2}
        material={mats.sweep}
        visible={false}
        renderOrder={2}
      >
        <circleGeometry args={[SWEEP_RADIUS, 96]} />
      </mesh>
      <mesh
        ref={ring}
        rotation-x={-Math.PI / 2}
        material={mats.ring}
        visible={false}
        renderOrder={3}
      >
        <ringGeometry args={[0.62, 0.86, 48]} />
      </mesh>
      <sprite ref={glow} material={mats.glow} visible={false} renderOrder={4} />
    </>
  );
}

/** On the tactical board: the sweep under the cone and a ring around the target's token. */
export function BeatBoardLayer({
  sample,
  half,
  scale,
  renderOrder,
}: {
  sample: Sample;
  half: number;
  scale: number;
  renderOrder: { sweep: number; ring: number };
}) {
  const { hero, playback } = useView();
  const ring = useRef<THREE.Mesh>(null);
  const sweep = useRef<THREE.Mesh>(null);
  const mats = useMemo(
    () => ({
      ring: new THREE.MeshBasicMaterial({
        color: RING,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
      sweep: sweepMaterial(true),
    }),
    [],
  );

  useFrame(() => {
    const { beat, run, s } = current(hero, playback.get());
    const r = ring.current;
    const w = sweep.current;
    if (!r || !w) return;
    const shown = beat && beat.target >= 0 ? ringAt(beat, s.frame) : 0;
    r.visible = shown > 0;
    if (beat && shown > 0) {
      const pop = motion.get().reduced ? 0 : popAt(beat, s.frame);
      r.position.set(sample.pos[2 * beat.target], 0, -sample.pos[2 * beat.target + 1]);
      r.scale.setScalar(scale * (1 + 0.6 * pop));
      mats.ring.opacity = shown;
    }
    const arc = beat ? sweepAt(hero, run, beat, s.frame, half) : null;
    w.visible = !!arc && s.cone && beat!.observer >= 0;
    if (arc && beat) {
      w.position.set(sample.pos[2 * beat.observer], 0, -sample.pos[2 * beat.observer + 1]);
      const u = mats.sweep.uniforms;
      u.uFrom.value = arc.from;
      u.uSpan.value = arc.span;
      u.uLead.value = arc.lead;
      u.uAlpha.value = arc.alpha * 0.32;
    }
  });

  return (
    <>
      <mesh
        ref={sweep}
        rotation-x={-Math.PI / 2}
        material={mats.sweep}
        visible={false}
        renderOrder={renderOrder.sweep}
      >
        <circleGeometry args={[SWEEP_RADIUS, 96]} />
      </mesh>
      <mesh
        ref={ring}
        rotation-x={-Math.PI / 2}
        material={mats.ring}
        visible={false}
        renderOrder={renderOrder.ring}
      >
        <ringGeometry args={[1.55, 1.95, 48]} />
      </mesh>
    </>
  );
}
