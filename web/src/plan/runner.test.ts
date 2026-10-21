// The breakdown waits for a spoken line (SPEC 6 Voice): a voice step, and the end of the plan, hold
// while `hold()` is set and then for a short gap, so the next caption does not cut the line off.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import { scriptOf, validatePayload } from "../narration/payload";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { advance, createPlayback } from "../store/playback";
import { heroMoment, relToFrame } from "./moment";
import { BreakdownRunner, MAX_HOLD_S, VOICE_GAP_S } from "./runner";
import { resolvePlan } from "./validate";

const hero = parseHero(raw);
const moment = heroMoment(hero);
const checked = validatePayload(payloadJson, moment, hero);
const SCRIPT = scriptOf(checked.ok ? checked.narration : null);

const LINES = {
  moment: moment.id,
  duration_s: 2,
  steps: [
    { t: 0.2, do: "voice", line: "L1" },
    { t: 1.5, do: "voice", line: "L2" },
    { t: 1.6, do: "camera", mode: "broadcast" },
  ],
};

function started(plan: unknown, hold?: () => boolean) {
  const playback = createPlayback(hero);
  const runner = new BreakdownRunner(playback, hero, moment, hold ? { hold } : undefined);
  const resolved = resolvePlan(plan, moment, SCRIPT);
  expect(resolved.source).toBe("given");
  runner.start(resolved.plan);
  return { playback, runner, plan: resolved.plan };
}

describe("voice hold", () => {
  it("uses a quarter-second gap and gives up after 12 s", () => {
    expect(VOICE_GAP_S).toBe(0.25);
    expect(MAX_HOLD_S).toBe(12);
  });

  it("with no hold, applies voice steps on plan time", () => {
    const log = (hold?: () => boolean) => {
      const { playback, runner } = started(LINES, hold);
      const marks: { t: number; line: string | null; focus: string; status: string }[] = [];
      for (const dt of [0.2, 1.3, 0.1, 0.5]) {
        runner.tick(dt);
        const s = playback.get();
        marks.push({
          t: runner.status.get().t,
          line: s.captionLine,
          focus: s.focus,
          status: runner.status.get().status,
        });
      }
      return marks;
    };
    const open = log();
    const never = log(() => false);
    expect(open.map(({ line, focus, status }) => ({ line, focus, status }))).toEqual(
      never.map(({ line, focus, status }) => ({ line, focus, status })),
    );
    for (let i = 0; i < open.length; i++) expect(open[i].t).toBeCloseTo(never[i].t);
    expect(open.map((m) => m.line)).toEqual(["L1", "L2", "L2", null]);
    expect(open.map((m) => m.focus)).toEqual(["split", "split", "broadcast", "broadcast"]);
    expect(open.map((m) => m.status)).toEqual(["running", "running", "running", "done"]);
    expect(open[1].t).toBeCloseTo(1.5);
    expect(open[2].t).toBeCloseTo(1.6);
  });

  it("holds the next voice step, then the camera, and does not finish early", () => {
    let wall = 0;
    let held = false;
    const { playback, runner } = started(LINES, () => held);
    const tick = (dt: number) => {
      runner.tick(dt);
      wall += dt;
    };

    tick(0.2);
    expect(playback.get().captionLine).toBe("L1");
    expect(runner.status.get().t).toBeCloseTo(0.2);

    // The first line is still being spoken from its step until 5 s.
    held = true;
    let maxT = runner.status.get().t;
    while (wall < 5 - 1e-9) {
      tick(Math.min(0.25, 5 - wall));
      maxT = Math.max(maxT, runner.status.get().t);
      expect(playback.get().captionLine).toBe("L1");
      expect(playback.get().focus).not.toBe("broadcast");
      expect(runner.status.get().status).toBe("running");
      expect(runner.time).toBeCloseTo(runner.status.get().t);
    }
    expect(wall).toBeCloseTo(5);
    expect(maxT).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(runner.status.get().t).toBeCloseTo(1.5);
    expect(runner.status.get().applied).toBe(1);

    held = false;
    tick(VOICE_GAP_S / 2);
    expect(playback.get().captionLine).toBe("L1");
    expect(playback.get().focus).not.toBe("broadcast");
    expect(runner.status.get().status).toBe("running");

    const order: string[] = [];
    const stop = playback.subscribe(() => {
      const s = playback.get();
      order.push(`${s.captionLine}:${s.focus}`);
    });
    tick(VOICE_GAP_S / 2 + 0.2);
    stop();
    expect(order).toEqual(["L2:split", "L2:broadcast"]);
    expect(playback.get().captionLine).toBe("L2");
    expect(playback.get().focus).toBe("broadcast");
    expect(runner.status.get().t).toBeCloseTo(1.7);
    expect(runner.status.get().status).toBe("running");

    tick(0.5);
    expect(runner.status.get().status).toBe("done");
    expect(playback.get().captionLine).toBeNull();
  });

  it("keeps the last caption up until the hold ends and the gap has passed", () => {
    let held = false;
    const { playback, runner } = started(
      {
        moment: moment.id,
        duration_s: 1,
        steps: [{ t: 0.2, do: "voice", line: "L1" }],
      },
      () => held,
    );
    runner.tick(0.2);
    expect(playback.get().captionLine).toBe("L1");
    held = true;
    runner.tick(5);
    expect(runner.status.get()).toMatchObject({ status: "running", t: 1, applied: 1 });
    expect(playback.get().captionLine).toBe("L1");

    held = false;
    runner.tick(VOICE_GAP_S / 2);
    expect(runner.status.get().status).toBe("running");
    expect(playback.get().captionLine).toBe("L1");
    runner.tick(VOICE_GAP_S / 2);
    expect(runner.status.get().status).toBe("done");
    expect(playback.get().captionLine).toBeNull();
  });

  it("applies earlier steps while a later voice step is held, and playback keeps running", () => {
    const plan = {
      moment: moment.id,
      duration_s: 3,
      steps: [
        { t: 0, do: "rewind", to: -1 },
        { t: 0, do: "play", to: 2.6, speed: 1 },
        { t: 0.2, do: "voice", line: "L1" },
        { t: 1, do: "camera", mode: "tactical" },
        { t: 1.5, do: "voice", line: "L2" },
      ],
    };
    const { playback, runner } = started(plan, () => true);
    expect(playback.get()).toMatchObject({
      playing: true,
      frame: relToFrame(moment, -1),
    });
    // The voice step at 0.2 is held from the start, so the camera at 1 s waits behind it.
    runner.tick(2);
    expect(playback.get().captionLine).toBeNull();
    expect(playback.get().focus).not.toBe("tactical");
    expect(runner.status.get().t).toBeCloseTo(0.2);
    const frame = playback.get().frame;
    advance(playback, hero, 0.5);
    expect(playback.get().frame).toBeGreaterThan(frame);
    expect(playback.get().playing).toBe(true);
  });

  it("still runs steps that fall before the voice step being held", () => {
    let held = false;
    const { playback, runner } = started(
      {
        moment: moment.id,
        duration_s: 3,
        steps: [
          { t: 0.2, do: "voice", line: "L1" },
          { t: 1, do: "camera", mode: "tactical" },
          { t: 1.5, do: "voice", line: "L2" },
        ],
      },
      () => held,
    );
    runner.tick(0.2);
    held = true;
    runner.tick(1);
    expect(playback.get().captionLine).toBe("L1");
    expect(playback.get().focus).toBe("tactical");
    expect(runner.status.get().t).toBeCloseTo(1.2);
    runner.tick(1);
    expect(playback.get().captionLine).toBe("L1");
    expect(runner.status.get().t).toBeCloseTo(1.5);
  });

  it("releases a hold that never ends after 12 s, one step at a time", () => {
    const { playback, runner } = started(LINES, () => true);
    runner.tick(0.2);
    expect(playback.get().captionLine).toBeNull();
    expect(runner.status.get().t).toBeCloseTo(0.2);
    runner.tick(MAX_HOLD_S / 2);
    runner.tick(MAX_HOLD_S / 2 - 1);
    expect(playback.get().captionLine).toBeNull();
    runner.tick(1);
    expect(playback.get().captionLine).toBe("L1");
    expect(runner.status.get().t).toBeCloseTo(0.2);

    runner.tick(1.3);
    expect(playback.get().captionLine).toBe("L1");
    expect(playback.get().focus).not.toBe("broadcast");
    expect(runner.status.get().t).toBeCloseTo(1.5);
    runner.tick(MAX_HOLD_S);
    expect(playback.get().captionLine).toBe("L2");
    runner.tick(0.1);
    expect(playback.get().focus).toBe("broadcast");
  });

  it("does not count time before a voice step against that step's 12 s", () => {
    let held = false;
    const { playback, runner } = started(
      {
        moment: moment.id,
        duration_s: 30,
        steps: [
          { t: 0.2, do: "voice", line: "L1" },
          { t: 20, do: "voice", line: "L2" },
        ],
      },
      () => held,
    );
    runner.tick(0.2);
    held = true;
    runner.tick(11);
    expect(playback.get().captionLine).toBe("L1");
    expect(runner.status.get().t).toBeCloseTo(11.2);
    runner.tick(9);
    expect(playback.get().captionLine).toBe("L1");
    expect(runner.status.get().t).toBeCloseTo(20);
    runner.tick(MAX_HOLD_S - 1);
    expect(playback.get().captionLine).toBe("L1");
    runner.tick(1);
    expect(playback.get().captionLine).toBe("L2");
  });

  it("start() and stop() clear a hold", () => {
    const { playback, runner, plan } = started(LINES, () => true);
    runner.tick(0.2);
    runner.tick(MAX_HOLD_S - 1);
    expect(playback.get().captionLine).toBeNull();

    runner.start(plan);
    runner.tick(0.2);
    runner.tick(MAX_HOLD_S - 1);
    expect(playback.get().captionLine).toBeNull();
    expect(runner.status.get().status).toBe("running");

    runner.stop();
    expect(runner.status.get().status).toBe("stopped");
    const t = runner.time;
    runner.tick(MAX_HOLD_S);
    expect(runner.time).toBe(t);
    expect(playback.get().captionLine).toBeNull();
  });

  it("releases the end of the plan after 12 s even if hold() stays set", () => {
    const { playback, runner } = started(
      {
        moment: moment.id,
        duration_s: 1,
        steps: [{ t: 0.2, do: "voice", line: "L1" }],
      },
      () => playback.get().captionLine === "L1",
    );
    runner.tick(0.2);
    expect(playback.get().captionLine).toBe("L1");
    runner.tick(1);
    expect(runner.status.get().status).toBe("running");
    expect(runner.status.get().t).toBeCloseTo(1);
    runner.tick(MAX_HOLD_S - 1);
    expect(runner.status.get().status).toBe("running");
    expect(playback.get().captionLine).toBe("L1");
    runner.tick(1);
    expect(runner.status.get().status).toBe("done");
    expect(playback.get().captionLine).toBeNull();
  });
});
