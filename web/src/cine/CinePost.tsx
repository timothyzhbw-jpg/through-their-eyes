// The capture frame's post chain (SPEC 10). A useFrame at priority 1 takes over drawing, the way
// PovMotionBlur does, so React Three Fiber does not draw the scene a second time. The scene lands
// in a multisampled half-float buffer (linear HDR). Depth of field, bloom, the head-whip blur and
// a peripheral falloff run there, and OutputPass is the only place that tone-maps and encodes.
// The last head-whip sigma is left on the capture runtime for render() to return.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Sample } from "../data/hero";
import { useView } from "../session";
import {
  blurPlan,
  headYawRate,
  MAX_SIGMA_FRACTION,
  povBlurSigmaPx,
  TAPS_PER_SIDE,
  type BlurPlan,
} from "../views/motionBlur";
import { blurFragmentShader, blurVertexShader } from "../views/PovMotionBlur";
import { LOOK, lookOutput } from "../quality/look";
import { featuresOf, quality } from "../quality/quality";
import { anchorPoint } from "./anchors";
import { cineRuntime } from "./runtime";
import { horizontalFovDeg, pitchToWorld } from "./shot";

const TAPS = 2 * TAPS_PER_SIDE + 1;

const PERIPHERY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Peripheral vision: a small disc blur (13 taps on a golden-angle spiral, so no rings) that grows
// from the middle of the frame to the corners, up to 1.4% of the frame height, and darkens the
// edges by up to 0.55.
const PERIPHERY_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uPeriphery;
uniform float uAspect; // width / height
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p) / length(vec2(uAspect, 1.0) * 0.5); // 0 at the centre, 1 in a corner
  float grow = smoothstep(0.45, 1.0, r);
  float radius = 0.014 * uPeriphery * grow;
  vec3 sum = texture2D(tDiffuse, vUv).rgb;
  for (int k = 0; k < 12; k++) {
    float a = float(k) * 2.39996;
    float d = sqrt((float(k) + 0.5) / 12.0);
    vec2 tap = vec2(cos(a), sin(a)) * d * radius;
    sum += texture2D(tDiffuse, vUv + vec2(tap.x / uAspect, tap.y)).rgb;
  }
  sum /= 13.0;
  sum *= 1.0 - 0.55 * uPeriphery * grow;
  gl_FragColor = vec4(sum, 1.0);
}`;

interface BlurUniforms {
  uTexel: { value: number };
  uOffsets: { value: number[] };
  uWeights: { value: number[] };
  uDecode: { value: boolean };
  uVignette: { value: number };
}

interface BokehUniforms {
  focus: { value: number };
  aperture: { value: number };
  maxblur: { value: number };
}

interface PeriUniforms {
  uPeriphery: { value: number };
  uAspect: { value: number };
}

function blurShader() {
  return {
    uniforms: {
      tInput: { value: null as THREE.Texture | null },
      uTexel: { value: 1 },
      uOffsets: { value: new Array<number>(TAPS).fill(0) },
      uWeights: { value: new Array<number>(TAPS).fill(0) },
      uDecode: { value: false },
      uVignette: { value: 0 },
    },
    vertexShader: blurVertexShader,
    fragmentShader: blurFragmentShader,
  };
}

function asQuad(material: THREE.Material) {
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  material.blending = THREE.NoBlending;
}

function writeTaps(pass: ShaderPass, plan: BlurPlan, texel: number, vignette: number) {
  const u = pass.uniforms as unknown as BlurUniforms;
  const offsets = u.uOffsets.value;
  const weights = u.uWeights.value;
  for (let k = 0; k < TAPS; k++) {
    offsets[k] = plan.offsets[k] ?? 0;
    weights[k] = plan.weights[k] ?? 0;
  }
  u.uTexel.value = texel;
  u.uDecode.value = false;
  u.uVignette.value = vignette;
}

interface Chain {
  composer: EffectComposer;
  bokeh: BokehPass;
  bloom: UnrealBloomPass;
  blurA: ShaderPass;
  blurB: ShaderPass;
  periphery: ShaderPass;
  width: number;
  height: number;
  pixelRatio: number;
  dispose: () => void;
}

function buildChain(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Chain {
  // The constructor stores the target's pixel size. setSize below replaces it with the canvas.
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(gl, target);
  const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.02, maxblur: 0.01 });
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.85);
  const blurA = new ShaderPass(blurShader(), "tInput");
  const blurB = new ShaderPass(blurShader(), "tInput");
  const periphery = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uPeriphery: { value: 0 },
      uAspect: { value: 16 / 9 },
    },
    vertexShader: PERIPHERY_VERTEX,
    fragmentShader: PERIPHERY_FRAGMENT,
  });
  for (const pass of [blurA, blurB, periphery]) asQuad(pass.material);
  const output = new OutputPass();
  if (featuresOf(quality.get().tier, false).look) lookOutput(output); // the look's curve
  bokeh.enabled = false;
  bloom.enabled = false;
  blurA.enabled = false;
  blurB.enabled = false;
  periphery.enabled = false;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bokeh);
  composer.addPass(bloom);
  composer.addPass(blurA);
  composer.addPass(blurB);
  composer.addPass(periphery);
  composer.addPass(output);
  return {
    composer,
    bokeh,
    bloom,
    blurA,
    blurB,
    periphery,
    width: 0,
    height: 0,
    pixelRatio: 0,
    dispose() {
      bokeh.dispose();
      bloom.dispose();
      blurA.dispose();
      blurB.dispose();
      periphery.dispose();
      output.dispose();
      composer.dispose();
    },
  };
}

/** Focus distance in metres: a number, or the camera's distance to an anchor (eyes: the eye point). */
function focusMetres(
  focus: number | Parameters<typeof anchorPoint>[4],
  camera: THREE.Camera,
  resolve: (anchor: Parameters<typeof anchorPoint>[4]) => [number, number, number],
): number {
  if (typeof focus === "number") return focus;
  const [x, y, z] = pitchToWorld(resolve(focus));
  return Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
}

export function CinePost() {
  const { hero, playback } = useView();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const scratch = useMemo(() => new Sample(hero.n), [hero]);
  const buffer = useMemo(() => new THREE.Vector2(), []);
  const chain = useMemo(() => buildChain(gl, scene, camera), [gl, scene, camera]);
  const planBuffer = useMemo(() => blurPlan(0, 1), []);
  useEffect(() => () => chain.dispose(), [chain]);

  useFrame((state) => {
    const { width: cssW, height: cssH } = state.size;
    if (cssW < 1 || cssH < 1) return;
    const pr = gl.getPixelRatio();
    if (chain.width !== cssW || chain.height !== cssH || chain.pixelRatio !== pr) {
      chain.width = cssW;
      chain.height = cssH;
      chain.pixelRatio = pr;
      chain.composer.setPixelRatio(pr);
      chain.composer.setSize(cssW, cssH);
    }

    const shot = cineRuntime.shot;
    // With the shared look (`&quality=` low, medium or high: quality/look.ts) the curve and
    // exposure of the live view and the Blender shots; a shot's exposure is relative to it.
    const look = featuresOf(quality.get().tier, false).look;
    gl.toneMapping = look ? LOOK.toneMapping : THREE.ACESFilmicToneMapping;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMappingExposure = (shot?.exposure ?? 1) * (look ? LOOK.exposure : 1);

    const dof = shot?.dof ?? null;
    chain.bokeh.enabled = dof !== null;
    if (dof) {
      const s = playback.get();
      const metres = focusMetres(dof.focus, camera, (anchor) =>
        anchorPoint(hero, hero.runs[s.mode], s.frame, shot?.smooth ?? 0, anchor, "eye", scratch),
      );
      const u = chain.bokeh.uniforms as unknown as BokehUniforms;
      u.focus.value = metres;
      u.aperture.value = dof.aperture;
      u.maxblur.value = dof.maxBlur;
    }

    // With the shared look a shot's bloom catches the lamp heads only (the halo cap).
    const bloom = shot?.bloom ? (look ? LOOK.bloom : shot.bloom) : null;
    chain.bloom.enabled = bloom !== null;
    if (bloom) {
      chain.bloom.strength = bloom.strength;
      chain.bloom.radius = bloom.radius;
      chain.bloom.threshold = bloom.threshold;
    }

    gl.getDrawingBufferSize(buffer);
    const width = Math.max(1, buffer.x);
    const s = playback.get();
    const run = hero.runs[s.mode];
    const whip = !!(shot?.pov && shot.motionBlur);
    const j = whip ? hero.ids.indexOf(shot.pov ?? "") : -1;
    const yawRate = j < 0 ? 0 : headYawRate(hero, run, j, s.frame, false);
    const hfov = horizontalFovDeg(
      (camera as THREE.PerspectiveCamera).fov,
      (camera as THREE.PerspectiveCamera).aspect || 1,
    );
    const sigma = whip
      ? povBlurSigmaPx({
          motionBlur: true, // the shot asked for it (`whip`)
          reducedMotion: false,
          camera: "pov",
          playing: true, // a film frame is motion: the playback store only pauses between frames
          yawRate,
          widthPx: width,
          hfovDeg: hfov,
        })
      : 0;
    const plan = blurPlan(sigma, width, planBuffer);
    cineRuntime.blurSigma = plan.passes ? plan.sigma : 0;
    const texel = 1 / width;
    const vignette = Math.min(1, plan.sigma / (MAX_SIGMA_FRACTION * width));
    chain.blurA.enabled = plan.passes >= 1;
    chain.blurB.enabled = plan.passes >= 2;
    if (plan.passes >= 1) writeTaps(chain.blurA, plan, texel, plan.passes === 1 ? vignette : 0);
    if (plan.passes >= 2) writeTaps(chain.blurB, plan, texel, vignette);

    const periphery = shot?.periphery ?? 0;
    chain.periphery.enabled = periphery > 0;
    if (periphery > 0) {
      const u = chain.periphery.uniforms as unknown as PeriUniforms;
      u.uPeriphery.value = periphery;
      u.uAspect.value = width / Math.max(1, buffer.y);
    }

    chain.composer.render(0);
  }, 1);

  return null;
}
