// Shirt-number labels in the 3D view (SPEC 7): a label that would sit on a nearer one is lifted
// one label up; if that spot is taken too, it is hidden. Nearer labels win, and the runner's gold
// label always shows.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { declutter, labelBox, labelHeight, type LabelBox } from "./declutter";

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

describe("how high a shirt number floats", () => {
  // His eyes: 1.72 m up, looking level; a number 2.1 m up, 0.36 m of digits; heads top at 1.8 m.
  const camera = new THREE.PerspectiveCamera(60, 1440 / 900, 0.05, 300);
  camera.position.set(0, 1.72, 0);
  camera.lookAt(0, 1.72, -10);
  camera.updateMatrixWorld();
  const view = { width: 1440, height: 900 };
  const [BASE, HEAD, TEXT, GAP, MAX] = [2.1, 1.8, 0.36, 6, 28];
  /** Where his number lands, and his head top, on screen (px, y down), d metres ahead. */
  const onScreen = (d: number) => {
    const box = labelBox(camera, new THREE.Vector3(0.3, BASE, -d), TEXT, view)!;
    const k = box.h > MAX ? MAX / box.h : 1;
    const y = labelHeight(BASE, HEAD, box.h / TEXT, TEXT * k, GAP);
    const label = labelBox(camera, new THREE.Vector3(0.3, y, -d), TEXT, view)!;
    const head = labelBox(camera, new THREE.Vector3(0.3, HEAD, -d), TEXT, view)!;
    return { y, bottom: label.y + (label.h * k) / 2, head: head.y };
  };

  it("stays 2.1 m up over a player across the pitch", () => {
    // From about 16 m out, 2.1 m up already leaves the gap over his head.
    for (const d of [20, 30, 60]) expect(onScreen(d).y).toBe(BASE);
  });

  it("sits just above a near player's head instead of up in the stands", () => {
    for (const d of [1.2, 2, 3]) {
      const { y, bottom, head } = onScreen(d);
      expect(y).toBeLessThan(BASE);
      expect(head - bottom).toBeCloseTo(GAP, 0); // px between his head and the number
    }
    // At 2.1 m up it would have floated far above him: over 100 px at 1.2 m.
    const box = labelBox(camera, new THREE.Vector3(0.3, BASE, -1.2), TEXT, view)!;
    const head = labelBox(camera, new THREE.Vector3(0.3, HEAD, -1.2), TEXT, view)!;
    expect(head.y - box.y).toBeGreaterThan(100);
  });
});
