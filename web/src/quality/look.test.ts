// The shared look's rim light (look.ts): patched onto lit player materials only, once, into the
// shader's output, and taken off again without a trace.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { addRim, playerMaterials, removeRim } from "./look";

const fakeShader = () => ({
  uniforms: {} as Record<string, unknown>,
  vertexShader: "",
  fragmentShader: "#include <common>\nvoid main() {\n#include <opaque_fragment>\n}",
});

describe("the rim light", () => {
  it("adds a Fresnel term before the output, with its own program", () => {
    const m = new THREE.MeshStandardMaterial();
    const key = m.customProgramCacheKey();
    addRim(m);
    const shader = fakeShader();
    m.onBeforeCompile(shader as never, {} as never);
    expect(Object.keys(shader.uniforms)).toEqual(["uRimColor", "uRimStrength", "uRimKey"]);
    expect(shader.fragmentShader.indexOf("fresnel")).toBeLessThan(
      shader.fragmentShader.indexOf("#include <opaque_fragment>"),
    );
    const rimKey = m.customProgramCacheKey();
    expect(rimKey).not.toBe(key); // a program of its own
    expect(rimKey.endsWith("|rim")).toBe(true);
    addRim(m); // once
    expect(m.customProgramCacheKey()).toBe(rimKey);
  });

  it("comes off without a trace", () => {
    const m = new THREE.MeshStandardMaterial();
    const key = m.customProgramCacheKey();
    addRim(m);
    removeRim(m);
    expect(m.customProgramCacheKey()).toBe(key);
    const shader = fakeShader();
    m.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).not.toContain("fresnel");
  });

  it("leaves unlit materials alone", () => {
    const m = new THREE.MeshBasicMaterial();
    addRim(m);
    expect(m.userData.rim).toBeUndefined();
  });

  it("finds the players: rigged meshes and token bodies, nothing else", () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    body.userData.player = true;
    const skinned = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    );
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
    root.add(body, skinned, pitch);
    expect(playerMaterials(root)).toEqual([body.material, skinned.material]);
  });
});
