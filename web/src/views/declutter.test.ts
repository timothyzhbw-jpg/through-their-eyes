// Shirt-number labels in the 3D view (SPEC 7): a label that would sit on a nearer one is lifted
// one label up; if that spot is taken too, it is hidden. Nearer labels win, and the runner's gold
// label always shows.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { declutter, labelBox, type LabelBox } from "./declutter";

const box = (x: number, y: number, depth: number, priority = false): LabelBox => ({
  x,
  y,
  w: 20,
  h: 20,
  depth,
  priority,
});

describe("decluttering shirt numbers", () => {
  it("leaves labels that do not touch where they are", () => {
    expect(declutter([box(0, 0, 10), box(100, 0, 20), box(0, 100, 5)])).toEqual([
      { visible: true, lift: 0 },
      { visible: true, lift: 0 },
      { visible: true, lift: 0 },
    ]);
  });

  it("keeps the nearest in place, lifts the next one, and hides a third on the same spot", () => {
    const out = declutter([box(0, 0, 30), box(5, 3, 10), box(-4, 2, 20)]);
    expect(out[1]).toEqual({ visible: true, lift: 0 }); // nearest
    expect(out[2]).toEqual({ visible: true, lift: 1 }); // next: one label up
    expect(out[0]).toEqual({ visible: false, lift: 0 }); // farthest: no room left
  });

  it("always shows the runner's label, even behind a nearer one", () => {
    const out = declutter([box(0, 0, 5), box(0, 0, 40, true)]);
    expect(out[1]).toEqual({ visible: true, lift: 0 });
    expect(out[0]).toEqual({ visible: true, lift: 1 });
  });

  it("hides a label that is off the picture or behind the camera", () => {
    expect(declutter([null, box(0, 0, 10)])).toEqual([
      { visible: false, lift: 0 },
      { visible: true, lift: 0 },
    ]);
  });

  it("does not depend on the order the players come in", () => {
    const boxes = [box(0, 0, 30), box(5, 3, 10), box(-4, 2, 20), box(200, 0, 50)];
    const out = declutter(boxes);
    const order = [3, 1, 0, 2];
    const shuffled = declutter(order.map((k) => boxes[k]));
    order.forEach((k, i) => expect(shuffled[i]).toEqual(out[k]));
  });
});

describe("a label's box on screen", () => {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 500);
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 1.7, -10);
  camera.updateMatrixWorld();
  const view = { width: 1000, height: 500 };

  it("shrinks with distance and centres on the label", () => {
    const near = labelBox(camera, new THREE.Vector3(0, 1.7, -10), 0.75, view)!;
    const far = labelBox(camera, new THREE.Vector3(0, 1.7, -20), 0.75, view)!;
    expect(near.x).toBeCloseTo(500, 3);
    expect(near.y).toBeCloseTo(250, 3);
    expect(far.w).toBeCloseTo(near.w / 2, 3);
    expect(near.depth).toBeCloseTo(10, 3);
  });

  it("has no box behind the camera", () => {
    expect(labelBox(camera, new THREE.Vector3(0, 1.7, 10), 0.75, view)).toBeNull();
  });
});
