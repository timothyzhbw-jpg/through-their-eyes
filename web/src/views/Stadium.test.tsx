// @vitest-environment happy-dom
// The stadium switch (SPEC 7): the procedural stadium and grass draw until the baked one is
// ready, stay when it fails, and step aside once it is in.

import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stadium } from "./bakedStadium";
import { Ground, Stadium } from "./Stadium";

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
      expect(html(<Ground />).match(/<mesh[ >]/g)).toHaveLength(2); // apron and pitch
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
    const grass = html(<Ground />);
    expect(grass.match(/<mesh[ >]/g)).toHaveLength(2); // the same apron and pitch
    expect(grass).not.toContain("<meshstandardmaterial"); // with the baked grass material
  });
});
