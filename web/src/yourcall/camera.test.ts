// "Your call" (SPEC 7): the camera behind the ball carrier frames every option, and a swipe from
// him picks the option it points at. Pure maths on a three.js camera: no WebGL needed.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { parseHero } from "../data/hero";
import { heroMoment } from "../plan/moment";
import { parseWhatIfs } from "../whatif/whatif";
import { declutter, frameCall, markerAt, project, swipePick, toWorld } from "./camera";
import { callOptions } from "./options";
import { pictureOf } from "./picture";

const hero = parseHero(raw);
const options = callOptions(hero, parseWhatIfs(whatIfJson, hero, heroMoment(hero)));
const picture = pictureOf(hero)!;
const carrier = picture.players[picture.carrier].truth;

const SIZES = [
  { name: "desktop", w: 860, h: 470 },
  { name: "phone", w: 343, h: 400 },
];

describe("Your call: the camera", () => {
  for (const { name, w, h } of SIZES) {
    it(`frames the carrier and every option on a ${name}`, () => {
      const cam = frameCall(carrier, options, 0, w, h);
      for (const o of options) {
        const [x, y] = project(cam, toWorld(o.anchor), w, h);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(w);
        expect(y).toBeLessThan(h);
        const [mx, my] = markerAt(cam, o.anchor, w, h);
        expect(mx).toBeGreaterThan(16);
        expect(mx).toBeLessThan(w - 16);
        expect(my).toBeGreaterThan(16); // the whole marker shows
        expect(my).toBeLessThan(y);
      }
      const [cx, cy] = project(cam, toWorld(carrier, 0), w, h);
      expect(cx).toBeGreaterThan(0);
      expect(cx).toBeLessThan(w);
      expect(cy).toBeLessThan(h);
    });
  }

  it("sits behind him as his team attacks, above the pitch", () => {
    const home = frameCall(carrier, options, 0, 800, 500);
    expect(home.position.x).toBeLessThan(carrier[0]);
    expect(home.position.y).toBeGreaterThan(5);
    const away = frameCall(carrier, options, 1, 800, 500);
    expect(away.position.x).toBeGreaterThan(carrier[0]);
  });

  it("is the same camera for the same moment and size", () => {
    const a = frameCall(carrier, options, 0, 800, 500);
    const b = frameCall(carrier, options, 0, 800, 500);
    expect(a.position.toArray()).toEqual(b.position.toArray());
  });
});

describe("Your call: swipe to pass", () => {
  const markers = [
    { action: "pass:A", at: [300, 100] as [number, number] }, // up
    { action: "pass:B", at: [500, 300] as [number, number] }, // right
    { action: "carry", at: [300, 260] as [number, number] }, // just ahead, up
  ];
  const from: [number, number] = [300, 300];

  it("picks the option in the swipe's direction", () => {
    expect(swipePick(from, [0, -150], markers)).toBe("pass:A");
    expect(swipePick(from, [90, 5], markers)).toBe("pass:B");
  });

  it("prefers the option nearest the swipe's end along the same line", () => {
    expect(swipePick(from, [0, -36], markers)).toBe("carry");
    expect(swipePick(from, [0, -190], markers)).toBe("pass:A");
  });

  it("ignores a tap, and a swipe that points at nobody", () => {
    expect(swipePick(from, [3, -4], markers)).toBeNull();
    expect(swipePick(from, [-80, 40], markers)).toBeNull();
  });
});

describe("Your call: markers", () => {
  it("pushes overlapping markers apart and leaves the others where they are", () => {
    const out = declutter(
      [
        [100, 100],
        [104, 102],
        [300, 300],
      ],
      30,
    );
    expect(Math.hypot(out[0][0] - out[1][0], out[0][1] - out[1][1])).toBeGreaterThanOrEqual(29.9);
    expect(out[2]).toEqual([300, 300]);
  });
});
