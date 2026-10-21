// The low, medium and high render tiers of the 3D view (quality.ts), loaded only when one is
// chosen. LookRig draws the shared look (look.ts): the AgX curve and the players' rim light.
//
// QualityPost takes over drawing at priority 1, as PovMotionBlur does at the other tiers. The
// scene lands in a half-float buffer that three.js treats like the canvas (the trick
// PovMotionBlur uses): the look's curve, the sRGB encoding and the fog are applied exactly as
// when the scene is drawn straight to the screen, so the low tier and the post tiers start from
// the same picture and the passes only add fidelity: ambient occlusion (GTAO, high), bloom on
// the lamp heads (high), depth of field through the key-moment slow motion, the first-person
// head-whip blur (PovMotionBlur's maths and shader, decoding and encoding around its sum), and
// SMAA on the way to the screen. three.js's own addons, MIT, no new dependency.
//
// QualityEnvironment gives the scene image-based lighting: a prefiltered (PMREM) environment
// rendered once from a small procedural night stadium (sky, stands, four lamp banks, the pitch's
// bounce), so kits and skin pick up the floodlights; no HDRI is downloaded. It adds to the
// stadium's lights; the grass takes none of it (PovView), so the pitch keeps its colour.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { beatAt, beatsOf, motion } from "../beat/beat";
import { cuts } from "../beat/cut";
import type { Sample } from "../data/hero";
import { useView } from "../session";
import { useStore } from "../store/store";
import {
  blurPlan,
  headYawRate,
  MAX_SIGMA_FRACTION,
  povBlurSigmaPx,
  TAPS_PER_SIDE,
  type BlurPlan,
} from "../views/motionBlur";
import { blurFragmentShader, blurVertexShader } from "../views/PovMotionBlur";
import { FLOODLIGHTS } from "../views/stadiumGeometry";
import { NIGHT } from "../views/Stadium";
import { addRim, aimRim, bakedLook, LOOK, playerMaterials, removeRim, undoBakedLook } from "./look";
import {
  dofAt,
  featuresOf,
  focusOf,
  FrameMeter,
  quality,
  stepDown,
  type Features,
} from "./quality";

const TAPS = 2 * TAPS_PER_SIDE + 1;
/** Bloom: only what is brighter than white in linear light blooms (the lamps, not the kits). */
const BLOOM = LOOK.bloomDisplay;
/**
 * Depth of field at full strength, in BokehPass units (blur = metres off focus × aperture, in
 * screen units, at most maxBlur). The broadcast camera sees 40–110 m of depth, so it gets far
 * less: a hint of a long lens, not a miniature.
 */
const DOF = {
  aperture: { pov: 0.00007, broadcast: 0.00003 },
  maxBlur: 0.0035,
  aheadM: 18,
  minFocusM: 18, // in first person the players near him stay readable
};
const AO = { radius: 0.5, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: 8 };
/** Ambient occlusion is soft by nature: computed at this share of the resolution, upsampled. */
const AO_RESOLUTION = 0.5;
export const ENVIRONMENT_INTENSITY = LOOK.environment;

interface Chain {
  composer: EffectComposer;
  ao: GTAOPass | null;
  bloom: UnrealBloomPass | null;
  bokeh: BokehPass | null;
  blurA: ShaderPass;
  blurB: ShaderPass;
  smaa: SMAAPass | null;
  width: number;
  height: number;
  pixelRatio: number;
  dispose(): void;
}

function blurShader() {
  return {
    uniforms: {
      tInput: { value: null as THREE.Texture | null },
      uTexel: { value: 1 },
      uOffsets: { value: new Array<number>(TAPS).fill(0) },
      uWeights: { value: new Array<number>(TAPS).fill(0) },
      uDecode: { value: true }, // the chain's buffers hold the encoded picture
      uVignette: { value: 0 },
    },
    vertexShader: blurVertexShader,
    fragmentShader: blurFragmentShader,
  };
}

function writeTaps(pass: ShaderPass, plan: BlurPlan, texel: number, vignette: number) {
  const u = pass.uniforms as Record<string, { value: unknown }>;
  const offsets = u.uOffsets.value as number[];
  const weights = u.uWeights.value as number[];
  for (let k = 0; k < TAPS; k++) {
    offsets[k] = plan.offsets[k] ?? 0;
    weights[k] = plan.weights[k] ?? 0;
  }
  u.uTexel.value = texel;
  u.uVignette.value = vignette;
}

/**
 * Labels, glows, rings, decals and other see-through overlays are not surfaces: they are hidden
 * while `pass` renders the scene for its own depth or normals (ambient occlusion, depth of field),
 * so they neither cast occlusion nor take a depth of their own. The pass's full-screen work still
 * reads the frame with them in it.
 */
function withoutOverlays<P extends { render: (...args: never[]) => void }>(
  scene: THREE.Scene,
  pass: P,
): P {
  const render = pass.render.bind(pass) as (...args: unknown[]) => void;
  const hidden: THREE.Object3D[] = [];
  (pass as unknown as { render: (...args: unknown[]) => void }).render = (...args) => {
    scene.traverse((o) => {
      if (!o.visible) return;
      const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const seeThrough = Array.isArray(material)
        ? material.some((m) => m.transparent)
        : !!material?.transparent;
      if ((o as THREE.Sprite).isSprite || seeThrough) {
        o.visible = false;
        hidden.push(o);
      }
    });
    try {
      render(...args);
    } finally {
      for (const o of hidden) o.visible = true;
      hidden.length = 0;
    }
  };
  return pass;
}

function buildChain(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  f: Features,
): Chain {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.SRGBColorSpace,
    samples: 0,
  });
  const composer = new EffectComposer(gl, target);
  // Flagged as an XR target, three.js applies the curve and the encoding in every material as it
  // does for the canvas (the clone does not keep the flag: set it on both).
  for (const t of [composer.renderTarget1, composer.renderTarget2]) {
    (t as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  }
  composer.addPass(new RenderPass(scene, camera));
  const ao = f.ao ? withoutOverlays(scene, new GTAOPass(scene, camera, 1, 1)) : null;
  if (ao) {
    const setSize = ao.setSize.bind(ao);
    ao.setSize = (w: number, h: number) =>
      setSize(
        Math.max(1, Math.round(w * AO_RESOLUTION)),
        Math.max(1, Math.round(h * AO_RESOLUTION)),
      );
    ao.updateGtaoMaterial(AO);
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
  }
  const bloom = f.bloom
    ? new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold)
    : null;
  if (bloom) composer.addPass(bloom);
  const bokeh = f.dof
    ? withoutOverlays(scene, new BokehPass(scene, camera, { focus: 10, aperture: 0, maxblur: 0 }))
    : null;
  if (bokeh) {
    bokeh.enabled = false;
    composer.addPass(bokeh);
  }
  const blurA = new ShaderPass(blurShader(), "tInput");
  const blurB = new ShaderPass(blurShader(), "tInput");
  for (const pass of [blurA, blurB]) {
    pass.enabled = false;
    pass.material.depthTest = false;
    pass.material.depthWrite = false;
    pass.material.toneMapped = false;
    composer.addPass(pass);
  }
  // SMAA last, on the encoded picture, onto the screen (no OutputPass: nothing left to convert).
  const smaa = new SMAAPass();
  composer.addPass(smaa);
  return {
    composer,
    ao,
    bloom,
    bokeh,
    blurA,
    blurB,
    smaa,
    width: 0,
    height: 0,
    pixelRatio: 0,
    dispose() {
      for (const p of [ao, bloom, bokeh, blurA, blurB, smaa]) p?.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}

/** Takes over drawing the 3D canvas at the medium and high tiers. `sample`: PovScene's frame. */
export function QualityPost({ sample, hfov }: { sample: Sample; hfov: number }) {
  const { hero, playback } = useView();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const tier = useStore(quality, (s) => s.tier);
  const reduced = useStore(motion, (s) => s.reduced);
  const features = featuresOf(tier, reduced);
  const chain = useMemo(
    () => buildChain(gl, scene, camera, features),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gl, scene, camera, tier, reduced],
  );
  useEffect(() => () => chain.dispose(), [chain]);
  useEffect(() => {
    gl.domElement.dataset.quality = tier;
    return () => {
      delete gl.domElement.dataset.quality;
    };
  }, [gl, tier]);
  const planBuffer = useMemo(() => blurPlan(0, 1), []);
  const buffer = useMemo(() => new THREE.Vector2(), []);
  const focusPoint = useMemo(() => new THREE.Vector3(), []);
  const meter = useMemo(() => new FrameMeter(), [chain]); // a new chain is measured afresh
  const hfovDeg = (hfov * 180) / Math.PI;

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
    const s = playback.get();
    const run = hero.runs[s.mode];
    // An automatic tier that cannot keep up while playing steps down (quality.ts).
    if (meter.frame(performance.now() / 1000, s.playing) === "lower") stepDown();

    // Depth of field: only through the key-moment slow motion.
    // Never across a cut (beat/cut.ts): off around a camera switch, easing back after it.
    const cutScale = cuts.blurScale(performance.now() / 1000);
    const amount = chain.bokeh ? dofAt(hero, run, s.frame, s.camera) * cutScale : 0;
    if (chain.bokeh) {
      chain.bokeh.enabled = amount > 0.01;
      if (chain.bokeh.enabled) {
        const b = beatAt(beatsOf(hero, run), s.frame)!;
        const j = focusOf(b, s.frame, s.camera);
        const metres =
          j < 0
            ? DOF.aheadM
            : Math.max(
                s.camera === "pov" ? DOF.minFocusM : 0,
                camera.position.distanceTo(
                  focusPoint.set(sample.pos[2 * j], 1.2, -sample.pos[2 * j + 1]),
                ),
              );
        const u = chain.bokeh.uniforms as Record<string, { value: number }>;
        u.focus.value = metres;
        u.aperture.value = DOF.aperture[s.camera] * amount;
        u.maxblur.value = DOF.maxBlur * amount;
      }
    }
    const shownDof = amount.toFixed(2);
    if (gl.domElement.dataset.dof !== shownDof) gl.domElement.dataset.dof = shownDof;

    // The head-whip blur of first person, as at the standard tier.
    gl.getDrawingBufferSize(buffer);
    const width = Math.max(1, buffer.x);
    const j = hero.ids.indexOf(s.povPlayer);
    const yawRate = j < 0 ? 0 : headYawRate(hero, run, j, s.frame, s.comfort);
    const sigma =
      cutScale *
      povBlurSigmaPx({
        reducedMotion: reduced,
        camera: s.camera,
        playing: s.playing,
        yawRate,
        widthPx: width,
        hfovDeg,
      });
    const plan = blurPlan(sigma, width, planBuffer);
    const shown = plan.passes ? plan.sigma.toFixed(1) : "0";
    if (gl.domElement.dataset.blurSigma !== shown) gl.domElement.dataset.blurSigma = shown;
    const vignette = Math.min(1, plan.sigma / (MAX_SIGMA_FRACTION * width));
    chain.blurA.enabled = plan.passes >= 1;
    chain.blurB.enabled = plan.passes >= 2;
    if (plan.passes >= 1) writeTaps(chain.blurA, plan, 1 / width, plan.passes === 1 ? vignette : 0);
    if (plan.passes >= 2) writeTaps(chain.blurB, plan, 1 / width, vignette);

    chain.composer.render(0);
  }, 1);

  return null;
}

/** A small night stadium for the environment map: sky, stands, four lamp banks, the pitch. */
function environmentScene(): THREE.Scene {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uZenith: { value: new THREE.Color(NIGHT.zenith) },
        uHorizon: { value: new THREE.Color(NIGHT.horizon) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uHorizon;
        varying vec3 vDir;
        void main() {
          gl_FragColor = vec4(mix(uHorizon, uZenith, smoothstep(-0.02, 0.45, vDir.y)), 1.0);
        }`,
    }),
  );
  env.add(sky);
  // The stands: a dark band all round, lit a little from above.
  const stands = new THREE.Mesh(
    new THREE.CylinderGeometry(95, 80, 34, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: "#151d22", side: THREE.BackSide }),
  );
  stands.position.y = 15;
  env.add(stands);
  // The pitch's green bounce.
  const pitch = new THREE.Mesh(
    new THREE.CircleGeometry(80, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color("#245638").multiplyScalar(0.55) }),
  );
  env.add(pitch);
  // The lamp banks: bright, warm, facing the centre spot.
  const lamp = new THREE.MeshBasicMaterial({
    color: new THREE.Color(NIGHT.lamp).multiplyScalar(12),
  });
  for (const m of FLOODLIGHTS) {
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), lamp);
    bank.position.set(m.x, m.height, -m.y);
    bank.lookAt(0, 0, 0);
    env.add(bank);
  }
  return env;
}

/** Image-based lighting for the 3D view, rendered once; put back as it was on the way out. */
export function QualityEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = environmentScene();
    const target = pmrem.fromScene(env, 0.04, 0.5, 400, { position: new THREE.Vector3(0, 6, 0) });
    const before = { environment: scene.environment, intensity: scene.environmentIntensity };
    scene.environment = target.texture;
    scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    env.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
    pmrem.dispose();
    invalidate();
    return () => {
      scene.environment = before.environment;
      scene.environmentIntensity = before.intensity;
      target.dispose();
      invalidate();
    };
  }, [gl, scene, invalidate]);
  return null;
}

/**
 * The shared look on the live view: the AgX curve at the look's exposure, and the rim light on
 * every player material (the rigged GLB loads late: looked for twice a second). Put back as it
 * was on the way out.
 */
export function LookRig() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const rimmed = useMemo(() => new Set<THREE.Material>(), []);
  const baked = useMemo(() => new Map<THREE.Material, THREE.Color>(), []);
  const tick = useMemo(() => ({ n: 0 }), []);
  useEffect(() => {
    const before = { toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure };
    gl.toneMapping = LOOK.toneMapping;
    gl.toneMappingExposure = LOOK.exposure;
    invalidate();
    return () => {
      gl.toneMapping = before.toneMapping;
      gl.toneMappingExposure = before.exposure;
      for (const m of rimmed) removeRim(m);
      rimmed.clear();
      undoBakedLook(baked);
      invalidate();
    };
  }, [gl, invalidate, rimmed, baked]);
  useFrame(({ camera }) => {
    aimRim(camera);
    if (tick.n++ % 30) return;
    const before = baked.size;
    bakedLook(scene, baked); // the baked stadium loads late too
    if (baked.size !== before) invalidate();
    for (const m of playerMaterials(scene)) {
      if (rimmed.has(m)) continue;
      addRim(m);
      rimmed.add(m);
      invalidate();
    }
  });
  return null;
}

/** Everything a tier draws beyond the standard picture: the look, the environment, the post. */
export default function QualityLayer({ sample, hfov }: { sample: Sample; hfov: number }) {
  const tier = useStore(quality, (s) => s.tier);
  const reduced = useStore(motion, (s) => s.reduced);
  const f = featuresOf(tier, reduced);
  return (
    <>
      {f.look && <LookRig />}
      {f.environment && <QualityEnvironment />}
      {f.post && <QualityPost sample={sample} hfov={hfov} />}
    </>
  );
}
