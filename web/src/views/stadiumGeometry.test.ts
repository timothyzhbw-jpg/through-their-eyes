// Checks of the procedural stadium: the stands frame the pitch without getting in the way of the
// broadcast camera, the crowd sits in the stands, and the masts stand behind them.

import { describe, expect, it } from "vitest";
import { BROADCAST_CAMERA } from "./broadcast";
import { PITCH } from "./scene";
import {
  BOARDS,
  FLOODLIGHTS,
  loopPoint,
  perimeter,
  PROFILE,
  roofHeight,
  seats,
  setback,
  standHeight,
} from "./stadiumGeometry";

describe("stadium", () => {
  const camera = setback(BROADCAST_CAMERA.x, BROADCAST_CAMERA.y);

  it("hangs the broadcast camera under the near roof, above the upper tier", () => {
    expect(camera).toBeGreaterThan(0);
    expect(BROADCAST_CAMERA.height - standHeight(camera)!).toBeGreaterThan(3);
    expect(roofHeight(camera)! - BROADCAST_CAMERA.height).toBeGreaterThan(3);
  });

  it("leaves the camera a clear view of the whole pitch over the near stand", () => {
    const c = BROADCAST_CAMERA;
    for (let x = -PITCH.halfLength; x <= PITCH.halfLength; x += 1.5) {
      for (const y of [-PITCH.halfWidth, 0, PITCH.halfWidth]) {
        // Walk the ray from the camera to the grass; wherever it is over the stands, it must
        // pass at least 1 m above them.
        for (let s = 0; s < 1; s += 0.002) {
          const px = c.x + (x - c.x) * s;
          const py = c.y + (y - c.y) * s;
          const ground = standHeight(setback(px, py));
          if (ground === null) continue;
          expect(c.height * (1 - s) - ground).toBeGreaterThan(1);
        }
      }
    }
  });

  it("seats a crowd of nearly twenty thousand, all in the stands", () => {
    const all = seats();
    expect(all.length).toBeGreaterThan(15000);
    expect(all.length).toBeLessThan(25000);
    for (const seat of all) {
      const d = setback(seat.x, seat.y);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(PROFILE[PROFILE.length - 1][0]);
      expect(seat.z).toBeGreaterThanOrEqual(PROFILE[1][1]); // on a rake, not in front of it
      expect(seat.z).toBeLessThanOrEqual(standHeight(d)! + 1e-6); // and not above the stands
    }
  });

  it("walks the loop of the stands at the given setback, facing the pitch", () => {
    for (const d of [0, 5, 20]) {
      const length = perimeter(d);
      for (let s = 0; s < length; s += length / 97) {
        const [x, y, nx, ny] = loopPoint(d, s);
        expect(setback(x, y)).toBeCloseTo(d, 6);
        expect(setback(x + nx, y + ny)).toBeCloseTo(d - 1, 6); // the normal points inwards
      }
    }
  });

  it("puts the boards between the pitch and the stands, and the masts behind the stands", () => {
    const { touchline, goalLine } = BOARDS;
    expect(touchline.y).toBeGreaterThan(PITCH.halfWidth + 2);
    expect(touchline.halfLength).toBeGreaterThan(PITCH.halfLength);
    expect(goalLine.x).toBeGreaterThan(PITCH.halfLength + 2); // behind the goal nets
    expect(setback(touchline.halfLength, touchline.y)).toBeLessThan(-1); // the ends too
    expect(setback(goalLine.x, goalLine.halfLength)).toBeLessThan(-1);
    expect(FLOODLIGHTS).toHaveLength(4);
    for (const mast of FLOODLIGHTS) {
      expect(setback(mast.x, mast.y)).toBeGreaterThan(PROFILE[PROFILE.length - 1][0]);
    }
  });
});
