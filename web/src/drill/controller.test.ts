// Academy drill (SPEC 7): the controller's clock and the look it settles on. The countdown runs on
// the moment's own time at the chosen pace, the head turns live within the scan range at a scan's
// speed, the turn locks onto the grid when it ends or when the ball arrives, the call comes at his
// decision with his picture for that look, and the result is that look's re-simulated run.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import lookJson from "../../public/data/look_seed3.json";
import whatIfJson from "../../public/data/whatif_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import type { Fetch } from "../takeeyes/controller";
import { cellAt, NO_GRID } from "../takeeyes/looks";
import { pressureExport } from "../testing";
import { drillOf, type Drill } from "./controller";
import { HEAD_SPEED_DEG_S } from "./snap";

const hero = parseHero(raw);
const served: Fetch = async (url) => ({
  ok: url.endsWith("look_seed3.json"),
  json: async () => lookJson,
});
const DT = hero.dt;
const [WINDOW_START] = lookJson.window;
const RECEPTION = lookJson.reception;
const DECISION = lookJson.decision_frame;

async function ready(): Promise<Drill> {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, whatIfJson);
  const d = drillOf(session, served, "/data/");
  d.open();
  expect(d.state.get().step).toBe("loading");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  expect(d.state.get().step).toBe("ready");
  return d;
}

/** Run the clock in steps of `dt` wall seconds for `seconds`. */
function run(d: Drill, seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds - 1e-9; t += dt) d.tick(Math.min(dt, seconds - t));
}

describe("the drill's clock", () => {
  it("starts as the pass is played to him, with the moment's time to the reception", async () => {
    const d = await ready();
    expect(d.countdown()).toBeCloseTo((RECEPTION - WINDOW_START) * DT, 9); // before Start too
    d.start();
    expect(d.state.get().frame).toBe(WINDOW_START);
    expect(d.countdown()).toBeCloseTo((RECEPTION - WINDOW_START) * DT, 9); // 2.2 s
    expect(d.playback.get().frame).toBe(WINDOW_START);
    expect(d.playback.get().camera).toBe("pov");
  });

  it.each([0.5, 1] as const)(
    "at pace %s counts down that many seconds of the moment per wall second",
    async (pace) => {
      const d = await ready();
      d.setPace(pace);
      d.start();
      run(d, 1);
      const frame = WINDOW_START + pace / DT;
      expect(d.state.get().frame).toBeCloseTo(frame, 6);
      expect(d.playback.get().frame).toBeCloseTo(frame, 6);
      expect(d.countdown()).toBeCloseTo(Math.ceil(((RECEPTION - frame) * DT - 1e-9) * 10) / 10, 9);
    },
  );

  it("reaches 0 as the ball arrives and hands over at his decision, no look taken", async () => {
    const d = await ready();
    d.setPace(1);
    d.start();
    run(d, (RECEPTION - WINDOW_START) * DT + 0.01);
    expect(d.countdown()).toBe(0);
    const locked = d.state.get().locked!;
    expect(locked.cell).toBeNull();
    expect(locked.entry.id).toBe("look:H8:none");
    expect(d.state.get().step).toBe("running");
    run(d, (DECISION - RECEPTION) * DT);
    expect(d.state.get().step).toBe("calling");
    expect(d.state.get().frame).toBe(DECISION);
  });
});

describe("the free look", () => {
  it("turns his head live toward the drag, no faster than a scan, and never past 150 degrees", async () => {
    const d = await ready();
    d.setPace(1);
    d.start();
    d.turnTo(-400); // a fling far to his right
    expect(d.state.get().target).toBe(-150);
    d.tick(0.1);
    expect(d.state.get().head).toBeCloseTo(-HEAD_SPEED_DEG_S * 0.1, 6);
    run(d, 0.5);
    expect(d.state.get().head).toBe(-150);
    // his head in the first-person view: the look-free head turned by the drag
    const stage = d.stage()!;
    const n = hero.n;
    const f = Math.floor(d.state.get().frame);
    const base = d.looks()!.noLook.head[f - WINDOW_START];
    const yaw = stage.hero.runs.factual.head[f * n + hero.hero];
    const turned = Math.atan2(Math.sin(yaw - base), Math.cos(yaw - base));
    expect((turned * 180) / Math.PI).toBeCloseTo(-150, 3);
  });

  it("locks on release to the nearest look of the grid: its start and its widest angle", async () => {
    const d = await ready();
    d.setPace(1);
    d.start();
    run(d, (38 - WINDOW_START) * DT); // frame 38
    d.turnTo(-118);
    run(d, 0.4);
    expect(d.state.get().turn!.start).toBeCloseTo(38, 6);
    expect(d.state.get().turn!.peak).toBe(-118);
    d.release();
    const locked = d.state.get().locked!;
    expect(locked.cell).toEqual({ frame: 40, offset: -90 });
    expect(locked.entry.id).toBe("look:H8:0040:-090");
    expect(locked.entry).toBe(cellAt(d.looks()!, 40, -90)!.entry);
    // the head goes back to the ball, and no second look is taken
    run(d, 0.5);
    expect(d.state.get().head).toBe(0);
    d.turnTo(140);
    expect(d.state.get().target).toBe(0);
    expect(d.state.get().locked!.entry.id).toBe("look:H8:0040:-090");
  });

  it("with the arrow keys: held, the head turns at a scan's speed; let go, the look locks", async () => {
    const d = await ready();
    d.setPace(1);
    d.start();
    run(d, (50 - WINDOW_START) * DT);
    d.hold(+1); // ← : to his left
    run(d, 0.3); // 121 degrees of turn
    d.release();
    const { locked } = d.state.get();
    expect(locked!.turn!.peak).toBeCloseTo(HEAD_SPEED_DEG_S * 0.3, 0);
    expect(locked!.cell).toEqual({ frame: 50, offset: 150 }); // 121 is nearer 150 than 90
  });

  it("does not count a small turn as a look: he may still look before the ball arrives", async () => {
    const d = await ready();
    d.setPace(1);
    d.start();
    d.turnTo(20);
    run(d, 0.2);
    d.release();
    expect(d.state.get().locked).toBeNull();
    expect(d.state.get().small).toBe(true);
    run(d, 0.4);
    d.turnTo(-150);
    run(d, 0.4);
    d.release();
    expect(d.state.get().locked!.cell!.offset).toBe(-150);
  });

  it("ends a look still under way as the ball arrives, at the angle it reached", async () => {
    const d = await ready();
    d.setPace(1);
    d.start();
    run(d, (60 - WINDOW_START) * DT);
    d.turnTo(-150);
    run(d, (RECEPTION - 60) * DT + 0.01);
    const locked = d.state.get().locked!;
    expect(locked.turn!.start).toBeCloseTo(60, 6);
    expect(locked.cell).toEqual({ frame: 60, offset: -150 });
  });
});

describe("the call and the result", () => {
  it("decides from his picture with the drill's look, then shows that look's run", async () => {
    const d = await ready();
    d.setPace(1);
    d.start();
    run(d, (50 - WINDOW_START) * DT);
    d.turnTo(-150);
    run(d, 0.5);
    d.release();
    run(d, 2);
    expect(d.state.get().step).toBe("calling");
    const yc = d.call()!;
    const entry = cellAt(d.looks()!, 50, -150)!.entry!;
    // Your call's picture, from the look's belief at the decision
    expect(yc.picture!.players.find((p) => p.id === "H9")!.stale).toBe(false);
    expect(yc.options.map((o) => o.action).sort()).toEqual(
      entry.decision.options.map((o) => o.action).sort(),
    );
    expect(d.boardStage()).not.toBeNull(); // mounted, hidden, while the viewer decides
    yc.aim("pass:H9");
    expect(yc.state.get().aim).toBe("pass:H9");
    yc.choose("nonsense");
    expect(d.state.get().step).toBe("calling");
    yc.choose("pass:H9");
    expect(d.state.get().step).toBe("result");
    expect(d.state.get().pick).toBe("pass:H9");
    // the board plays what he really did with the look's run as the gold ghost
    const stage = d.boardStage()!;
    expect(stage.kind === "hero" && stage.whatIfs!.options[0].run).toBe(entry.after);
    expect(d.board.get()).toMatchObject({ whatIf: entry.id, frame: DECISION, playing: true });
    // his eyes stay at the decision, ready for another go
    expect(d.playback.get().frame).toBe(DECISION);
    d.again();
    expect(d.state.get().step).toBe("ready");
    d.start();
    expect(d.state.get().tries).toBe(2);
    expect(d.state.get().locked).toBeNull();
  });
});

describe("where the drill cannot open", () => {
  it("is a moment without a bundled look grid", () => {
    const pressure = parseHero({ ...pressureExport(), seed: 7 });
    const d = drillOf(createSession(pressure, null, null));
    expect(d.unavailable).toBe(NO_GRID);
    d.open();
    expect(d.state.get().step).toBe("closed");
  });
});
