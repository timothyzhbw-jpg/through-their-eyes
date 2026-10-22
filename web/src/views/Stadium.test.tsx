// @vitest-environment happy-dom
// The stadium switch (SPEC 7): the procedural stadium and grass draw until the baked one is
// ready, stay when it fails, and step aside once it is in.

import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOOK } from "../quality/look";
import { quality } from "../quality/quality";
import { grassMaterial, stadium } from "./bakedStadium";
import { Grass, Stadium } from "./Stadium";

vi.mock("@react-three/fiber", async (original) => ({
  ...(await original<typeof import("@react-three/fiber")>()),
  useFrame: () => {},
}));

// happy-dom has no 2D canvas: a context that accepts every call is enough to build the textures.
const original = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  const noop = (): unknown =>
    new Proxy(() => {}, {
      get: (_, key) => (key === "width" ? 100 : noop()),
      apply: () => noop(),
    });
  HTMLCanvasElement.prototype.getContext = (() => noop()) as never;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = original;
});

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>).toLowerCase();

describe("the stadium switch", () => {
  it("draws the procedural stadium and grass while the baked one loads, and after it fails", () => {
    for (const status of ["off", "waiting", "loading", "failed"] as const) {
      stadium.set({ mode: "baked", status, model: null });
      const out = html(<Stadium />);
      expect(out).toContain("<instancedmesh"); // the procedural crowd
      expect(out).not.toContain("<primitive");
      expect(html(<Grass />).match(/<mesh[ >]/g)).toHaveLength(2); // apron and pitch
    }
  });

  it("swaps in the baked stadium once it is ready; the grass stays, shaped by its light", () => {
    stadium.set({
      mode: "baked",
      status: "ready",
      model: { scene: new THREE.Group(), time: { value: 0 }, groundLight: new THREE.Texture() },
    });
    const out = html(<Stadium />);
    expect(out).toContain("<primitive");
    expect(out).not.toContain("<instancedmesh");
    expect(out).toContain("<sprite"); // the masts' glow and the sky stay
    const grass = html(<Grass />);
    expect(grass.match(/<mesh[ >]/g)).toHaveLength(2); // the same apron and pitch
    expect(grass).not.toContain("<meshstandardmaterial"); // with the baked grass material
  });

  it("with the shared look the grass takes a hint of sheen and no image-based light", () => {
    quality.set({ tier: "low", source: "link" });
    try {
      stadium.set({ mode: "baked", status: "loading", model: null });
      const grass = html(<Grass />);
      expect(grass.match(/<meshphysicalmaterial/g)).toHaveLength(2);
      expect(grass).toContain(`specularintensity="${LOOK.grassSpecular}"`);
      expect(grass.match(/envmapintensity="0"/g)).toHaveLength(2);
    } finally {
      quality.set({ tier: "standard", source: "default" });
    }
  });
});

describe("the baked grass material", () => {
  it("keeps the baked light's multiply, and with the look is physical with the look's sheen", () => {
    const light = new THREE.Texture();
    const plain = grassMaterial({ color: "#173826" }, light);
    expect(plain).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(plain).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const look = grassMaterial({ color: LOOK.apron, envMapIntensity: 0 }, light, {
      specularIntensity: LOOK.grassSpecular,
    });
    expect(look).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((look as THREE.MeshPhysicalMaterial).specularIntensity).toBe(LOOK.grassSpecular);
    expect(look.envMapIntensity).toBe(0);
    for (const m of [plain, look]) {
      expect(m.lightMap).toBe(light);
      expect(m.lightMapIntensity).toBe(0); // the light only shapes it, through the shader
      const shader = {
        uniforms: {},
        vertexShader: "",
        fragmentShader: "#include <common>\n#include <opaque_fragment>",
      };
      m.onBeforeCompile(shader as never, null as never);
      expect(shader.fragmentShader).toContain("outgoingLight *= pow( max( bake * uBake");
    }
  });
});
