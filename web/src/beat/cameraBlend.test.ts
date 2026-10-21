// Camera moves between his eyes and the broadcast camera (SPEC 7): the viewer's switch flies, the
// auto director's is a cut, so is a switch that comes with a seek, and reduced motion always cuts.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BLEND_S, blendProgress, CameraBlend, requestCut, shouldBlend } from "./cameraBlend";

const input = (camera: string, frame = 50, reduced = false, now = 10) => ({
  camera,
  frame,
  now,
  reduced,
});

describe("camera moves", () => {
  it("fly when the viewer switches camera mid-play", () => {
    expect(shouldBlend({ camera: "pov", frame: 49.6 }, input("broadcast"), false)).toBe(true);
  });

  it("cut when the director cuts, the playhead jumped, or motion is reduced", () => {
    const last = { camera: "pov", frame: 50 };
    expect(shouldBlend(last, input("broadcast"), true)).toBe(false);
    expect(shouldBlend(last, input("broadcast", 20), false)).toBe(false); // a rewind
    expect(shouldBlend(last, input("broadcast", 50, true), false)).toBe(false);
    expect(shouldBlend(last, input("pov"), false)).toBe(false); // no change
    expect(shouldBlend(null, input("pov"), false)).toBe(false); // the first draw
  });

  it("ease from 0 to 1 over the move and stay at 1 after it", () => {
    expect(blendProgress(10, 10)).toBe(0);
    expect(blendProgress(10, 10 + BLEND_S / 2)).toBeCloseTo(0.5, 6);
    expect(blendProgress(10, 10 + BLEND_S)).toBe(1);
    expect(blendProgress(null, 99)).toBe(1);
  });

  it("move the camera from the pose on screen to the new one", () => {
    const blend = new CameraBlend();
    const camera = new THREE.PerspectiveCamera(60);
    camera.position.set(0, 1.72, 0);
    blend.begin(camera, null, input("pov", 50, false, 10));
    expect(blend.apply(camera, null, 10)).toBe(false); // nothing to blend yet
    blend.begin(camera, null, input("broadcast", 50.4, false, 11));
    camera.position.set(0, 21, 60); // the view puts it on the broadcast pose
    expect(blend.apply(camera, null, 11 + BLEND_S / 2)).toBe(true);
    expect(camera.position.y).toBeGreaterThan(1.72);
    expect(camera.position.y).toBeLessThan(21);
    camera.position.set(0, 21, 60);
    expect(blend.apply(camera, null, 11 + BLEND_S)).toBe(false);
    expect(camera.position.y).toBe(21);
  });

  it("let the auto director's cut through without a move", () => {
    const blend = new CameraBlend();
    const camera = new THREE.PerspectiveCamera(60);
    blend.begin(camera, null, input("pov"));
    requestCut();
    blend.begin(camera, null, input("broadcast"));
    expect(blend.apply(camera, null, 10.1)).toBe(false);
  });
});
