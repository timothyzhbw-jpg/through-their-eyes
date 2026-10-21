// The upgraded look's shading (SPEC 7, `?look=v2`). Every part of the rigged player reads the
// model's `_LOOK` vertex attribute (demo/grf/reskin.py; three.js names it `_look`):
// - R: ambient occlusion baked in Blender from the rest pose. It takes the whole of the
//   hemisphere's light (the armpits, the neck, under the shorts) and half of the lamps', so the
//   shapes read under the floodlights without the creases going black;
// - G: the keepers' long sleeves (skin) or the sole (boots), mixed to an accent colour;
// - B: the keepers' gloves (skin).

import * as THREE from "three";

export const DIRECT_AO = 0.5;

export interface Accents {
  g?: string; // colour where the G mask is set
  b?: string; // colour where the B mask is set
}

/** Patch a standard material to read `_LOOK`. One program for every player: accents are uniforms. */
export function withLook<M extends THREE.MeshStandardMaterial>(
  material: M,
  accents: Accents = {},
): M {
  const uniforms = {
    uLookG: { value: new THREE.Color(accents.g ?? "#000000") },
    uLookGOn: { value: accents.g ? 1 : 0 },
    uLookB: { value: new THREE.Color(accents.b ?? "#000000") },
    uLookBOn: { value: accents.b ? 1 : 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 _look;\nvarying vec4 vLook;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvLook = _look;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec4 vLook;
uniform vec3 uLookG;
uniform float uLookGOn;
uniform vec3 uLookB;
uniform float uLookBOn;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
	diffuseColor.rgb = mix(diffuseColor.rgb, uLookG, vLook.g * uLookGOn);
	diffuseColor.rgb = mix(diffuseColor.rgb, uLookB, vLook.b * uLookBOn);`,
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= vLook.r;
	reflectedLight.directDiffuse *= mix(1.0, vLook.r, ${DIRECT_AO.toFixed(2)});`,
      );
  };
  material.customProgramCacheKey = () => "look-v2";
  return material;
}
