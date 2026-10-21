// The shared look of the low, medium and high tiers (quality.ts), matched to the Blender trailer
// shots on the art director's targets (8-bit sRGB frames of the 3D view, Rec.709 luma):
// black floor about (5, 8, 6); sky at most 16 luma, B−R 4–10; stands and crowd about (18, 20, 24);
// a lit pitch stripe about (32, 62, 42) with G/R ≥ 1.7; a lit coral shirt with G/R 0.45–0.5;
// lamp halos at most three lamp heads across, no streaks. Every tier draws it the same way.

import * as THREE from "three";
import { FLOODLIGHTS } from "../views/stadiumGeometry";

// The look's tone curve: AgX (Blender renders with AgX, look None: one curve for both), then a
// lift to the shared black floor (5, 8, 6), so no channel ever reaches 0. three.js calls it as its
// custom tone mapping, in every material when the scene is drawn straight to the canvas and in
// the post chain's OutputPass (lookOutput below), so every tier gets the same curve.
const LOOK_CORAL = 0.45; // extra saturation on coral hues, before the curve
const FLOOR = [5, 8, 6].map((v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  "vec3 CustomToneMapping( vec3 color ) { return color; }",
  `// AgX desaturates the coral kits towards orange: a little more saturation on coral hues only,
  // before the curve (as the Blender side does for the greens); gold, skin and green untouched.
  vec3 lookCoral( vec3 c ) {
    float hi = max( c.r, max( c.g, c.b ) );
    float lo = min( c.r, min( c.g, c.b ) );
    if ( hi <= 0.0 || c.r < hi || hi - lo < 1e-5 ) return c;
    float hue = 60.0 * ( c.g - c.b ) / ( hi - lo ); // degrees, red is 0
    float w = 1.0 - smoothstep( 4.0, 14.0, abs( hue - 6.0 ) );
    float y = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    return max( vec3( 0.0 ), mix( vec3( y ), c, 1.0 + ${LOOK_CORAL.toFixed(2)} * w ) );
  }
  vec3 CustomToneMapping( vec3 color ) {
    const vec3 lookFloor = vec3( ${FLOOR.map((v) => v.toFixed(6)).join(", ")} );
    return lookFloor + AgXToneMapping( lookCoral( color ) ) * ( 1.0 - lookFloor );
  }`,
);

/** Make an OutputPass apply the look's curve (it sets no define for a custom curve itself). */
export function lookOutput(pass: { material: THREE.ShaderMaterial }): void {
  const p = pass as unknown as { _toneMapping: number; _outputColorSpace: string };
  p._toneMapping = THREE.CustomToneMapping;
  p._outputColorSpace = THREE.SRGBColorSpace;
  pass.material.defines = { CUSTOM_TONE_MAPPING: "", SRGB_TRANSFER: "" };
  pass.material.needsUpdate = true;
}

export const LOOK = {
  toneMapping: THREE.CustomToneMapping, // AgX and the black floor, above
  exposure: 0.8,
  grassSpecular: 0.06, // a hint of sheen: matte grass reads too saturated from above
  rim: { color: "#fff2d8", strength: 0.55, power: 2.5 }, // the floodlights' warm white
  crowdTint: "#b4bcc8", // multiplies the crowd's shirts: neutral-cool, no team-colour flashes
  crowdGrey: 0.75, // how far every shirt is pulled to the crowd grey (classic: 0.45 for colours)
  // The night sky as authored before the curve: AgX's toe would crush the classic #04070c.
  sky: { zenith: "#0d131b", horizon: "#202c36" },
  starShadow: 0.27, // each of the three fill masts' shadows (25–35 %)
  keyShadow: 0.34, // the key mast's (+x, +y): the fills are at 0.75 of the key
  shadowTipWidth: 0.9, // m at the tip; 0.5 m (the shoulders) at the feet
  glowOpacity: 0.32, // the lamp's own glow sprite, its halo and flare off
  glowScale: 22, // m across: about three lamp heads (a lamp face is 9.2 m)
  lamp: 4, // lamp face brightness (× the lamp colour): above the bloom threshold at high
  environment: 0.3, // image-based light, never seen as a background
  // Bloom where a tier or a cine shot has one: only the lamp heads are this bright in linear
  // light, and a tight radius keeps the halo within about three lamp heads.
  bloom: { strength: 0.25, radius: 0.08, threshold: 2.0 }, // cine's linear chain
  bloomDisplay: { strength: 0.25, radius: 0.08, threshold: 0.96 }, // the live chain: encoded values
};

/** The key floodlight (the +x, +y mast), seen from the centre spot, in three.js world axes. */
export const KEY_LIGHT = (() => {
  const m = FLOODLIGHTS[0];
  return new THREE.Vector3(m.x, m.height, -m.y).normalize();
})();

const rimUniforms = {
  uRimColor: { value: new THREE.Color(LOOK.rim.color) },
  uRimStrength: { value: LOOK.rim.strength },
  uRimKey: { value: new THREE.Vector3(0, 1, 0) }, // the key light's direction in view space
};

/** Point the rim at the key light as seen from `camera` (once per drawn frame). */
export function aimRim(camera: THREE.Camera): void {
  rimUniforms.uRimKey.value.copy(KEY_LIGHT).transformDirection(camera.matrixWorldInverse);
}

interface Saved {
  before: THREE.Material["onBeforeCompile"];
  key: THREE.Material["customProgramCacheKey"];
}

/**
 * A Fresnel rim on a lit material, strongest on the side that faces the key floodlight: it
 * separates the players from the dark stands, as the rim light does in the Blender shots.
 */
export function addRim(material: THREE.Material): void {
  if (material.userData.rim || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial)
    return;
  const saved: Saved = { before: material.onBeforeCompile, key: material.customProgramCacheKey };
  material.userData.rim = saved;
  material.onBeforeCompile = (shader, renderer) => {
    saved.before.call(material, shader, renderer);
    Object.assign(shader.uniforms, rimUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform vec3 uRimKey;",
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          float facing = saturate(dot(normal, normalize(vViewPosition)));
          float fresnel = pow(1.0 - facing, ${LOOK.rim.power.toFixed(1)});
          float side = saturate(dot(normal, uRimKey) * 0.5 + 0.5);
          outgoingLight += uRimColor * uRimStrength * fresnel * side;
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `${saved.key.call(material)}|rim`;
  material.needsUpdate = true;
}

/** Take the rim off again (back to the standard tier). */
export function removeRim(material: THREE.Material): void {
  const saved = material.userData.rim as Saved | undefined;
  if (!saved) return;
  material.onBeforeCompile = saved.before;
  material.customProgramCacheKey = saved.key;
  delete material.userData.rim;
  material.needsUpdate = true;
}

/** The materials of the players in `root`: the rigged meshes and the token bodies. */
export function playerMaterials(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !((mesh as THREE.SkinnedMesh).isSkinnedMesh || o.userData.player)) return;
    const m = mesh.material;
    for (const mat of Array.isArray(m) ? m : [m]) out.push(mat);
  });
  return out;
}
