// The other run's path tag on the tactical board (SPEC 7): the tag sits beside the end of the
// path ("without the look"), clear of the player tokens, and is dropped when the board is too
// small to carry it. Coordinates are pitch metres: x along the pitch, y across it, y up on screen.

import { describe, expect, it } from "vitest";
import { PATH_TAG_GAP, PATH_TAG_MIN_PITCH_PX, pathTagPx, placePathTag } from "./boardLabels";

/** Distance in metres from a point to the tag rectangle (0 when the point is inside it). */
function distanceToTag(
  tag: { x: number; y: number },
  w: number,
  h: number,
  p: [number, number],
): number {
  const dx = Math.max(Math.abs(p[0] - tag.x) - w / 2, 0);
  const dy = Math.max(Math.abs(p[1] - tag.y) - h / 2, 0);
  return Math.hypot(dx, dy);
}

/** True when every token circle keeps its clearance from the tag rectangle. */
function clearOf(
  tag: { x: number; y: number },
  w: number,
  h: number,
  tokens: ArrayLike<number>,
  clearance: number,
): boolean {
  const near = (x: number, y: number) => distanceToTag(tag, w, h, [x, y]) >= clearance - 1e-9;
  for (let k = 0; k + 1 < tokens.length; k += 2) {
    if (!near(tokens[k], tokens[k + 1])) return false;
  }
  return true;
}

describe("path tag size", () => {
  it("is hidden on small boards and scales between 14 and 24 px", () => {
    expect(pathTagPx(200)).toBeNull();
    expect(pathTagPx(319)).toBeNull();
    expect(pathTagPx(PATH_TAG_MIN_PITCH_PX)).toBe(14);
    expect(pathTagPx(384)).toBe(16);
    expect(pathTagPx(1000)).toBe(24);
  });
});

describe("path tag placement", () => {
  it("goes above the path end when nothing is in the way", () => {
    const tag = placePathTag({ end: [10, 0], w: 20, h: 4, tokens: [], clearance: 0 });
    expect(tag.index).toBe(0);
    expect(tag.x).toBeCloseTo(10, 9);
    expect(tag.y).toBeCloseTo(0 + PATH_TAG_GAP + 2, 9);
  });

  it("moves below the end when a token sits above it", () => {
    const w = 20;
    const h = 4;
    const clearance = 1.5;
    const tokens = [10, 3];
    const tag = placePathTag({ end: [10, 0], w, h, tokens, clearance });
    expect(tag.index).toBe(1);
    expect(tag.x).toBeCloseTo(10, 9);
    expect(tag.y).toBeCloseTo(-3.5, 9);
    expect(clearOf(tag, w, h, tokens, clearance)).toBe(true);
  });

  it("steps aside when tokens crowd both above and below the end", () => {
    const w = 8;
    const h = 2;
    const clearance = 1.5;
    const tokens = [10, 3, 10, -3];
    const tag = placePathTag({ end: [10, 0], w, h, tokens, clearance });
    expect([2, 4]).toContain(tag.index);
    expect(clearOf(tag, w, h, tokens, clearance)).toBe(true);
  });

  it("keeps the whole tag on the pitch, clamped at the touchline and the goal line", () => {
    const top = placePathTag({ end: [0, 33], w: 20, h: 4, tokens: [], clearance: 0 });
    expect(top.index).toBe(0);
    expect(top.y).toBeCloseTo(34 - 2, 9);

    const right = placePathTag({ end: [52, 0], w: 20, h: 4, tokens: [], clearance: 0 });
    expect(right.index).toBe(0);
    expect(right.x).toBeCloseTo(52.5 - 10, 9);
  });

  it("keeps a preferred side while it is clear", () => {
    const tag = placePathTag({
      end: [0, 0],
      w: 10,
      h: 2,
      tokens: [],
      clearance: 0,
      prefer: 1,
    });
    expect(tag.index).toBe(1);
    expect(tag.y).toBeCloseTo(-PATH_TAG_GAP - 1, 9);
  });

  it("falls back when the preferred side is blocked", () => {
    const w = 10;
    const h = 2;
    const tag = placePathTag({
      end: [0, 0],
      w,
      h,
      tokens: [0, -2.5], // where candidate 1 would be
      clearance: 1.5,
      prefer: 1,
    });
    expect(tag.index).toBe(0);
    expect(tag.y).toBeCloseTo(PATH_TAG_GAP + 1, 9);
  });

  it("picks a stable candidate when tokens cover the whole pitch", () => {
    const tokens: number[] = [];
    for (let x = -52; x <= 52; x += 2) {
      for (let y = -34; y <= 34; y += 2) tokens.push(x, y);
    }
    const a = placePathTag({ end: [10, 0], w: 20, h: 4, tokens, clearance: 1 });
    const b = placePathTag({ end: [10, 0], w: 20, h: 4, tokens, clearance: 1 });
    expect(a.index).toBeGreaterThanOrEqual(0);
    expect(a.index).toBeLessThanOrEqual(5);
    expect(b).toEqual(a);
  });
});
