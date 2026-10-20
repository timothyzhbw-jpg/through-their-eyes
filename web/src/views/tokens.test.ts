// The rendered pose must be the exported pose: a token's head points along head_yaw and its body
// along body_yaw (within 1e-3 rad), and at the key scan the hero's visor faces away from the ball
// by the angle the HUD reports.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import raw from "../../public/data/hero_seed3.json";
import { headOffBall, parseHero, Sample, sampleInto, wrapAngle } from "../data/hero";
import type { RunName } from "../data/types";
import { aimYaw, poseToken, worldYaw } from "./tokens";

const hero = parseHero(raw);
const key = hero.keyScan!; // the bundled scan hero has one
const TOL = 1e-3;

/** A token as PovView builds it: a body group on the pitch with the head group as its child. */
function token() {
  const body = new THREE.Group();
  const head = new THREE.Group();
  head.position.y = 1.66;
  body.add(head);
  return { body, head };
}

describe("player tokens show body and head yaw", () => {
  const frames = [0, key.start, Math.round((key.start + key.end) / 2), key.end, 100];
  for (const name of ["factual", "counterfactual"] as RunName[]) {
    it(`renders every player's export yaw in the ${name} run`, () => {
      const run = raw.runs[name];
      const sample = new Sample(hero.n);
      const { body, head } = token();
      const tick = new THREE.Group();
      for (const f of frames) {
        sampleInto(sample, hero, hero.runs[name], f);
        for (let j = 0; j < hero.n; j++) {
          body.position.set(sample.pos[2 * j], 0, -sample.pos[2 * j + 1]);
          poseToken(body, head, sample.body[j], sample.head[j]);
          aimYaw(tick, sample.head[j]);
          const headYaw = run.head[f][j] / 1e4;
          const bodyYaw = run.body[f][j] / 1e4;
          expect(Math.abs(wrapAngle(worldYaw(head) - headYaw))).toBeLessThan(TOL);
          expect(Math.abs(wrapAngle(worldYaw(body) - bodyYaw))).toBeLessThan(TOL);
          expect(Math.abs(wrapAngle(worldYaw(tick) - headYaw))).toBeLessThan(TOL);
        }
      }
    });
  }

  it("turns the head relative to the body without clamping", () => {
    const { body, head } = token();
    poseToken(body, head, 0.2, 0.2 + 3.0); // a near-reverse look over the shoulder
    expect(head.rotation.y).toBeCloseTo(3.0, 9);
    expect(Math.abs(wrapAngle(worldYaw(head) - 3.2))).toBeLessThan(TOL);
  });

  it("at the key scan, the hero's visor faces away from the ball as the HUD says", () => {
    const run = hero.runs.factual;
    const sample = new Sample(hero.n);
    const { body, head } = token();
    const offAt = (f: number) => {
      sampleInto(sample, hero, run, f);
      poseToken(body, head, sample.body[hero.hero], sample.head[hero.hero]);
      const x = sample.pos[2 * hero.hero];
      const y = sample.pos[2 * hero.hero + 1];
      const toBall = Math.atan2(sample.ball[1] - y, sample.ball[0] - x);
      const visorOff = Math.abs(wrapAngle(worldYaw(head) - toBall));
      expect(Math.abs(visorOff - headOffBall(sample, hero.hero))).toBeLessThan(TOL); // = HUD
      return visorOff;
    };
    const during = [];
    for (let f = key.start; f <= key.end; f++) during.push(offAt(f));
    expect(Math.max(...during)).toBeGreaterThan(Math.PI / 2); // facing away from the ball
    expect(offAt(key.start - 2)).toBeLessThan(Math.PI / 6); // before the scan: on the ball
  });
});
