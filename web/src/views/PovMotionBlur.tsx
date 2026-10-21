// Motion blur of the first-person view as a post-process (SPEC 7, the Floodlit design): the
// strength follows the measured head yaw rate of the player whose eyes these are (motionBlur.ts
// has the maths and the tap plan). Off under prefers-reduced-motion, on the broadcast camera and
// whenever the blur would be under half a pixel: then the scene is drawn straight to the canvas,
// as without this pass.
//
// The scene is drawn into a half-float target that three.js treats like the canvas (tone mapping
// and the sRGB encoding are applied, and fog is mixed after them, exactly as on screen), so the
// blurred frame converges on the sharp one and switching the pass on never shifts a colour. The
// blur decodes to linear light, sums its taps, and encodes for the screen again; a wide blur is
// two passes in a row, the second smoothing the first's comb of taps. The canvas carries the
// current sigma in data-blur-sigma (px) for checks and the fps script.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useView } from "../session";
import {
  blurPlan,
  headYawRate,
  MAX_SIGMA_FRACTION,
  povBlurSigmaPx,
  TAPS_PER_SIDE,
  type BlurPlan,
} from "./motionBlur";

const TAPS = 2 * TAPS_PER_SIDE + 1;
const MAX_RENDER_WIDTH = 1920;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D tInput;
uniform float uTexel; // 1 / canvas width: one drawing-buffer pixel in uv
uniform float uOffsets[${TAPS}]; // drawing-buffer px, independent of the target resolution
uniform float uWeights[${TAPS}];
uniform bool uDecode; // the input holds sRGB-encoded values (the scene target)
uniform float uVignette; // 0..1: the edges darken while the head whips round
varying vec2 vUv;

vec3 linearAt(vec2 uv) {
  vec4 c = texture2D(tInput, uv);
  return uDecode ? sRGBTransferEOTF(c).rgb : c.rgb;
}

void main() {
  vec3 sum = vec3(0.0);
  for (int k = 0; k < ${TAPS}; k++) {
    sum += uWeights[k] * linearAt(vUv + vec2(uOffsets[k] * uTexel, 0.0));
  }
  if (uVignette > 0.0) {
    float r = length((vUv - 0.5) * vec2(1.0, 0.82)) * 1.6;
    sum *= 1.0 - 0.45 * uVignette * smoothstep(0.55, 1.0, r);
  }
  gl_FragColor = vec4(sum, 1.0);
  #include <colorspace_fragment>
}`;

class BlurPass {
  readonly scene: THREE.WebGLRenderTarget;
  readonly mid: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private canvasWidth = 1;

  constructor() {
    this.scene = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.SRGBColorSpace,
      samples: 0,
    });
    // three.js applies tone mapping and the output encoding only for the canvas and XR targets:
    // flagged as one, this target holds exactly the frame the canvas would show.
    (this.scene as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    this.mid = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      samples: 0,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tInput: { value: null },
        uTexel: { value: 1 },
        uOffsets: { value: new Array<number>(TAPS).fill(0) },
        uWeights: { value: new Array<number>(TAPS).fill(0) },
        uDecode: { value: true },
        uVignette: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.canvasWidth = width;
    // Bound the offscreen workload at DPR 1 and 1920 px wide, preserving the canvas aspect.
    const scale = Math.min(1, 1 / pixelRatio, MAX_RENDER_WIDTH / width);
    const renderWidth = Math.max(1, Math.floor(width * scale));
    const renderHeight = Math.max(1, Math.floor(height * scale));
    if (this.scene.width !== renderWidth || this.scene.height !== renderHeight) {
      this.scene.setSize(renderWidth, renderHeight);
      this.mid.setSize(renderWidth, renderHeight);
    }
  }

  /** One horizontal pass of `plan`'s taps from `input` into `output` (null: the canvas). */
  draw(
    gl: THREE.WebGLRenderer,
    plan: BlurPlan,
    input: THREE.Texture,
    output: THREE.WebGLRenderTarget | null,
    decode: boolean,
    vignette: number,
  ) {
    const u = this.material.uniforms;
    u.tInput.value = input;
    u.uTexel.value = 1 / this.canvasWidth;
    u.uOffsets.value = plan.offsets;
    u.uWeights.value = plan.weights;
    u.uDecode.value = decode;
    u.uVignette.value = vignette;
    gl.setRenderTarget(output);
    gl.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.scene.dispose();
    this.mid.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

/** prefers-reduced-motion, kept current; a change redraws the view. */
function useReducedMotion(invalidate: () => void) {
  const reduced = useRef(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
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

/** Takes over drawing the first-person canvas (priority 1 runs after every other frame hook). */
export function MotionBlur({ hfov }: { hfov: number }) {
  const { hero, playback } = useView();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const reduced = useReducedMotion(invalidate);
  const pass = useMemo(() => new BlurPass(), []);
  const planBuffer = useMemo(() => blurPlan(0, 1), []);
  useEffect(() => () => pass.dispose(), [pass]);
  // Drawing into a half-float target needs a float colour buffer (nearly every WebGL2 GPU).
  const supported = useMemo(
    () =>
      gl.extensions.has("EXT_color_buffer_float") ||
      gl.extensions.has("EXT_color_buffer_half_float"),
    [gl],
  );
  const size = useMemo(() => new THREE.Vector2(), []);
  const hfovDeg = (hfov * 180) / Math.PI;

  useFrame(({ gl, scene, camera }) => {
    const s = playback.get();
    gl.getDrawingBufferSize(size);
    const j = hero.ids.indexOf(s.povPlayer);
    const yawRate = j < 0 ? 0 : headYawRate(hero, hero.runs[s.mode], j, s.frame, s.comfort);
    const sigma = povBlurSigmaPx({
      reducedMotion: reduced.current,
      camera: s.camera,
      yawRate,
      widthPx: size.x,
      hfovDeg,
    });
    const plan = blurPlan(supported ? sigma : 0, size.x, planBuffer);
    const shown = plan.passes ? plan.sigma.toFixed(1) : "0";
    if (gl.domElement.dataset.blurSigma !== shown) gl.domElement.dataset.blurSigma = shown;
    if (!plan.passes) {
      gl.setRenderTarget(null);
      gl.render(scene, camera);
      return;
    }
    pass.setSize(size.x, size.y, gl.getPixelRatio());
    gl.setRenderTarget(pass.scene);
    gl.render(scene, camera);
    const vignette = Math.min(1, plan.sigma / (MAX_SIGMA_FRACTION * size.x));
    if (plan.passes === 1) {
      pass.draw(gl, plan, pass.scene.texture, null, true, vignette);
    } else {
      pass.draw(gl, plan, pass.scene.texture, pass.mid, true, 0);
      pass.draw(gl, plan, pass.mid.texture, null, false, vignette);
    }
  }, 1);

  return null;
}
