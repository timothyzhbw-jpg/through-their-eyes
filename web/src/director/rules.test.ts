// The camera director's rules (director/rules.ts) on event sequences: what it suggests, from
// which frame, and how early before the ball arrives; and how the suggestion on screen is chosen
// (director/pick.ts): held while it is the viewer's shot, sticky, never too late, and the auto
// director's cuts (a minimum shot length, never in the middle of a scan).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import type { ExportEvent } from "../data/types";
import { matchExport } from "../testing";
import {
  AutoCutter,
  autoTarget,
  linger,
  LINGER_S,
  pick,
  satisfied,
  shotPatch,
  type ViewShot,
} from "./pick";
import {
  candidates,
  CARRY_S,
  LEAD_S,
  MIN_SHOT_S,
  MOMENT_HOLD_S,
  runKnowledge,
  TURNOVER_S,
  type Announced,
  type Knowledge,
  type Suggestion,
} from "./rules";

const DT = 0.04;
const hero = parseHero(raw);
const TEAMS = new Map(hero.players.map((p) => [p.id, p.team] as const));

const ev = (type: string, frame: number, player: string, attrs: object = {}): ExportEvent => ({
  id: `${type}:${player}:${String(frame).padStart(4, "0")}`,
  type,
  frame,
  player,
  attrs: attrs as Record<string, unknown>,
});
const pass = (frame: number, from: string, to: string, end: number) =>
  ev("pass", frame, from, { to, end, outcome: "complete", receiver: to });
const scan = (frame: number, player: string, end: number, amplitude = 2.0) =>
  ev("scan", frame, player, { end, amplitude, direction: 1, key: false });

type Alert = readonly [string, string, number];
function knowledge(
  events: ExportEvent[],
  alerts: Record<number, Alert[]> = {},
  moments: Announced[] = [],
): Knowledge {
  return {
    dt: DT,
    teams: TEAMS,
    events: [...events].sort((a, b) => a.frame - b.frame),
    alerts: (f) => alerts[f] ?? [],
    moments,
  };
}

const BROADCAST: ViewShot = { camera: "broadcast", povPlayer: "H8", focus: "split" };
// The away goalkeeper's eyes: no rule ever suggests them, so every suggestion shows.
const NEUTRAL: ViewShot = { camera: "pov", povPlayer: "A1", focus: "split" };
const frames = (s: number) => Math.round(s / DT);
const onEyes = (player: string): ViewShot => ({ camera: "pov", povPlayer: player, focus: "split" });

/** The suggestion on screen at each frame from `from` to `to`, as the director keeps it. */
function play(k: Knowledge, from: number, to: number, view: ViewShot = NEUTRAL) {
  const out: { frame: number; s: Suggestion | null }[] = [];
  let last: string | null = null;
  for (let f = from; f <= to; f++) {
    const p = pick(candidates(k, f), f, view, last, new Set(), k.dt);
    last = p.top?.id ?? null;
    out.push({ frame: f, s: p.show });
  }
  return out;
}
const line = (s: Suggestion | null) => (s ? `${s.title}: ${s.reason}` : null);
/** Frames where the chip changes, with its line. */
function changes(rows: ReturnType<typeof play>) {
  const out: [number, string | null][] = [];
  for (const r of rows) if (line(r.s) !== out.at(-1)?.[1]) out.push([r.frame, line(r.s)]);
  return out.filter((c, i) => i > 0 || c[1] !== null);
}

describe("a pass toward a player", () => {
  const k = knowledge([pass(10, "H4", "H8", 60), ev("reception", 60, "H8")]);

  it("suggests his eyes the frame the pass is played, long before the ball arrives", () => {
    expect(changes(play(k, 0, 120))).toEqual([
      [10, "Switch to H8's eyes: the ball is coming to him."],
      [60, "Switch to H8's eyes: he has just received the ball."],
      [60 + frames(CARRY_S), null],
    ]);
    const first = play(k, 10, 10)[0].s!;
    expect(first).toMatchObject({ rule: "incoming", shot: { camera: "pov", player: "H8" } });
    expect((first.arrival! - 10) * DT).toBeGreaterThanOrEqual(LEAD_S);
  });

  it("is not suggested when the ball arrives in under half a second", () => {
    const quick = knowledge([pass(10, "H4", "H8", 22)]); // 0.48 s
    expect(play(quick, 10, 21).every((r) => r.s?.rule !== "incoming")).toBe(true);
    const justInTime = knowledge([pass(10, "H4", "H8", 23)]); // 0.52 s
    expect(play(justInTime, 10, 10)[0].s?.rule).toBe("incoming");
  });

  it("appears no later than half a second before the reception, or not at all", () => {
    // The viewer arrives (a seek) while the ball is in flight.
    for (const at of [40, 47, 48, 50, 55]) {
      const s = play(k, at, at)[0].s;
      if ((60 - at) * DT >= LEAD_S) expect(s?.rule, `frame ${at}`).toBe("incoming");
      else expect(s?.rule, `frame ${at}`).not.toBe("incoming");
    }
  });

  it("is boosted when the receiver checks over his shoulder before the ball arrives", () => {
    const withScan = knowledge([pass(10, "H4", "H8", 60), scan(30, "H8", 45)]);
    const rows = play(withScan, 10, 59);
    expect(changes(rows)).toEqual([
      [10, "Switch to H8's eyes: the ball is coming to him."],
      [30, "Switch to H8's eyes: he checks over his shoulder before the ball arrives."],
    ]);
    // The same suggestion, kept on screen and raised.
    expect(rows[0].s!.id).toBe(rows.at(-1)!.s!.id);
    expect(rows.at(-1)!.s!.priority).toBeGreaterThan(rows[0].s!.priority);
    const look = knowledge([pass(10, "H4", "H8", 60), scan(30, "H8", 45, 1.3)]); // under 90°
    expect(line(play(look, 30, 30)[0].s)).toBe(
      "Switch to H8's eyes: he looks around before the ball arrives.",
    );
    // Another player's scan changes nothing.
    const other = knowledge([pass(10, "H4", "H8", 60), scan(30, "H9", 45)]);
    expect(line(play(other, 30, 30)[0].s)).toBe("Switch to H8's eyes: the ball is coming to him.");
  });

  it("says when the receiver has lost sight of a player on his blind side", () => {
    const blind = knowledge([pass(10, "H4", "H8", 60)], { 25: [["H8", "H9", 0.6]] });
    expect(line(play(blind, 25, 25)[0].s)).toBe(
      "Switch to H8's eyes: the ball is coming to him, and H9 is on his blind side.",
    );
  });

  it("stops when the ball is won back before it arrives", () => {
    const cut = knowledge([
      pass(10, "H4", "H8", 60),
      ev("interception", 30, "A5"),
      ev("possession_change", 30, "A5"),
    ]);
    expect(changes(play(cut, 10, 90))).toEqual([
      [10, "Switch to H8's eyes: the ball is coming to him."],
      [30, "Switch to the broadcast camera: A5 has won the ball."],
      [30 + frames(TURNOVER_S), null],
    ]);
  });
});

describe("blind-side alerts", () => {
  const home = [ev("reception", 2, "H4")];

  it("suggest the tactical board when a defender loses sight of an attacker", () => {
    const k = knowledge(home, { 50: [["A8", "H9", 0.4]] });
    expect(line(play(k, 50, 50)[0].s)).toBe(
      "Switch to the tactical board: A8 has lost sight of H9 on his blind side.",
    );
    expect(play(k, 50, 50)[0].s!.shot).toEqual({ camera: "tactical" });
  });

  it("not for a team-mate, and not while the ball is on its way to someone", () => {
    expect(play(knowledge(home, { 50: [["H8", "H9", 0.4]] }), 50, 50)[0].s).toBeNull();
    const flight = knowledge([...home, pass(40, "H4", "H8", 90)], { 50: [["A8", "H9", 0.4]] });
    expect(play(flight, 50, 50)[0].s!.rule).toBe("incoming");
  });

  it("keep the alert on screen while it lasts, even when another one is longer", () => {
    const alerts: Record<number, Alert[]> = {};
    for (let f = 50; f < 70; f++) alerts[f] = [["A8", "H9", (f - 49) * DT]];
    for (let f = 55; f < 70; f++) alerts[f].push(["A5", "H10", 2]);
    const rows = play(knowledge(home, alerts), 50, 70);
    expect(changes(rows)).toEqual([
      [50, "Switch to the tactical board: A8 has lost sight of H9 on his blind side."],
      [70, null],
    ]);
  });
});

describe("detected moments", () => {
  const card = (id: string, lens: string | null, frameEnd: number, live = false) => ({
    id,
    kind: id.split(":")[1],
    actor: id.split(":")[2],
    anchor_frame: frameEnd - 40,
    frame_end: frameEnd,
    anchor_t: (frameEnd - 40) * DT,
    selected_lens: lens,
    live_only: live,
  });

  it("the hero moment suggests its breakdown from the frame it is announced, for a while", () => {
    const k = knowledge([], {}, [
      { card: card("m:decision_after_scan:H8:0075", "scan", 100), breakdown: true },
    ]);
    const hold = frames(MOMENT_HOLD_S);
    expect(changes(play(k, 90, 100 + hold + 5))).toEqual([
      [100, "Watch the breakdown: a moment was detected, H8's decision after a scan."],
      [100 + hold, null],
    ]);
    expect(play(k, 100, 100)[0].s).toMatchObject({ action: "breakdown", shot: null, auto: false });
  });

  it("another moment with a lens suggests a replay with its lens's camera", () => {
    const k = (lens: string) =>
      knowledge([], {}, [
        { card: card("m:line_breaking_pass:H4:0015", lens, 95), breakdown: false },
      ]);
    expect(play(k("pressure"), 95, 95)[0].s).toMatchObject({
      action: "replay",
      shot: { camera: "tactical" },
      title: "Replay on the tactical board",
      reason: "a moment was detected, H4's line-breaking pass.",
      auto: false,
    });
    expect(play(k("space"), 95, 95)[0].s!.shot).toEqual({ camera: "tactical" });
    expect(play(k("scan"), 95, 95)[0].s).toMatchObject({
      shot: { camera: "pov", player: "H4" },
      title: "Replay through H4's eyes",
    });
  });

  it("the breakdown comes first: a routine pass does not push it off", () => {
    const k = knowledge([pass(110, "H4", "H8", 160)], {}, [
      { card: card("m:decision_after_scan:H8:0075", "scan", 100), breakdown: true },
    ]);
    expect(changes(play(k, 100, 130))).toEqual([
      [100, "Watch the breakdown: a moment was detected, H8's decision after a scan."],
    ]);
  });

  it("a live-only moment (a sprint) suggests nothing", () => {
    const k = knowledge([], {}, [
      { card: card("m:sprint:H9:0085", null, 96, true), breakdown: false },
    ]);
    expect(play(k, 96, 96)[0].s).toBeNull();
  });
});

describe("what is on screen", () => {
  const k = knowledge([pass(10, "H4", "H8", 60)], { 20: [["A8", "H9", 0.4]] });

  it("holds the viewer's shot when it is already the best one, and hides those below it", () => {
    const rows = play(k, 10, 59, onEyes("H8"));
    expect(rows.every((r) => r.s === null)).toBe(true);
    const p = pick(candidates(k, 20), 20, onEyes("H8"), null, new Set(), DT);
    expect(p.top?.rule).toBe("incoming"); // held, not shown
  });

  it("drops a suggestion the viewer dismissed, until it ends", () => {
    const first = pick(candidates(k, 20), 20, BROADCAST, null, new Set(), DT).show!;
    const next = pick(candidates(k, 20), 20, BROADCAST, first.id, new Set([first.id]), DT);
    expect(next.show?.rule).toBe("blind_side");
  });

  it("lets a chip that just ended linger briefly, so the strip does not blink", () => {
    const k = knowledge([pass(10, "H4", "H8", 40), pass(60, "H4", "H9", 100)]);
    const prev = pick(candidates(k, 30), 30, NEUTRAL, null, new Set(), DT).show!;
    const at = (f: number, ended: number | null) =>
      linger(pick(candidates(k, f), f, NEUTRAL, null, new Set(), DT), prev, ended, f, DT);
    expect(at(40, 40)).toBe(prev); // the ball arrived: nothing yet in its place
    expect(at(40 + frames(LINGER_S) - 1, 40)).toBe(prev);
    expect(at(40 + frames(LINGER_S), 40)).toBeNull();
    expect(at(60, 40)?.id).toBe("incoming:pass:H4:0060"); // the next one takes over at once
    // Nothing lingers while the viewer is on the best camera already (held, not shown).
    const held = pick(candidates(k, 20), 20, onEyes("H8"), null, new Set(), DT);
    expect(linger(held, prev, 20, 20, DT)).toBeNull();
  });

  it("knows when a shot is the suggested one, and how to cut to it", () => {
    expect(satisfied({ camera: "pov", player: "H8" }, onEyes("H8"))).toBe(true);
    expect(satisfied({ camera: "pov", player: "H8" }, onEyes("H9"))).toBe(false);
    expect(satisfied({ camera: "pov", player: "H8" }, { ...onEyes("H8"), focus: "tactical" })).toBe(
      false,
    );
    expect(satisfied({ camera: "tactical" }, onEyes("H8"))).toBe(false);
    expect(satisfied({ camera: "tactical" }, { ...BROADCAST, focus: "tactical" })).toBe(true);
    expect(shotPatch({ camera: "pov", player: "H9" }, BROADCAST)).toEqual({
      camera: "pov",
      povPlayer: "H9",
      focus: "split",
    });
    expect(
      shotPatch({ camera: "pov", player: "H9" }, { ...BROADCAST, focus: "broadcast" }),
    ).toEqual({ camera: "pov", povPlayer: "H9", focus: "pov" });
    expect(shotPatch({ camera: "broadcast" }, { ...onEyes("H8"), focus: "tactical" })).toEqual({
      camera: "broadcast",
      focus: "split",
    });
    expect(shotPatch({ camera: "tactical" }, BROADCAST)).toEqual({ focus: "tactical" });
  });
});

describe("the auto director", () => {
  const k = knowledge([
    pass(10, "H4", "H8", 60),
    scan(62, "H8", 80),
    pass(70, "H8", "H9", 140),
    pass(150, "H9", "H10", 200),
  ]);

  /** Run the auto director frame by frame at 1x (25 Hz wall clock); returns its cuts. */
  function cuts(knows: Knowledge, from: number, to: number, start: ViewShot = NEUTRAL) {
    const cutter = new AutoCutter();
    let view = { ...start };
    const out: [number, string][] = [];
    for (let f = from; f <= to; f++) {
      const target = autoTarget(candidates(knows, f), view, new Set());
      const shot = cutter.decide(target, f, knows.dt, f * DT, view, (p) => scanning(knows, p, f));
      if (!shot) continue;
      view = { ...view, ...shotPatch(shot, view) };
      out.push([f, shot.camera === "pov" ? shot.player : shot.camera]);
    }
    return out;
  }
  const scanning = (knows: Knowledge, player: string, f: number) =>
    knows.events.some(
      (e) => e.type === "scan" && e.player === player && e.frame <= f && f <= Number(e.attrs.end),
    );

  it("cuts to the best camera, never two cuts closer than the minimum shot length", () => {
    const out = cuts(k, 0, 210);
    expect(out[0]).toEqual([10, "H8"]);
    for (let i = 1; i < out.length; i++) {
      expect((out[i][0] - out[i - 1][0]) * DT).toBeGreaterThanOrEqual(MIN_SHOT_S);
    }
  });

  it("never cuts away in the middle of a scan", () => {
    // H8 scans from 62 to 80; the pass to H9 at 70 waits for the scan to end.
    const out = cuts(k, 0, 210);
    expect(out[1]).toEqual([81, "H9"]);
    expect((140 - 81) * DT).toBeGreaterThanOrEqual(LEAD_S);
  });

  it("waits out the minimum shot, then cuts if the ball is still far enough away", () => {
    const quick = knowledge([pass(10, "H4", "H8", 60), pass(30, "H8", "H9", 90)]);
    expect(cuts(quick, 0, 90)).toEqual([
      [10, "H8"],
      [10 + frames(MIN_SHOT_S), "H9"],
    ]);
    const late = knowledge([pass(10, "H4", "H8", 60), pass(30, "H8", "H9", 66)]);
    expect(cuts(late, 0, 90)).toEqual([[10, "H8"]]); // H9's ball lands under half a second later
  });

  it("never starts a breakdown or a replay by itself", () => {
    const moment = knowledge([], {}, [
      {
        card: {
          id: "m:decision_after_scan:H8:0075",
          kind: "decision_after_scan",
          actor: "H8",
          anchor_frame: 75,
          frame_end: 100,
          anchor_t: 3,
          selected_lens: "scan",
        },
        breakdown: true,
      },
    ]);
    expect(cuts(moment, 90, 200)).toEqual([]);
  });
});

describe("on the bundled hero moment (seed 3)", () => {
  const live = (runName: "factual" | "counterfactual") =>
    runKnowledge(hero, hero.runs[runName], []);

  it("follows the ball to H8, his look over his shoulder, then the pass to H9", () => {
    expect(hero.runs.factual.frames - 1).toBeLessThan(139 + frames(CARRY_S)); // H9 keeps it
    const rows = play(live("factual"), 0, hero.runs.factual.frames - 1);
    expect(changes(rows)).toEqual([
      [15, "Switch to H8's eyes: the ball is coming to him."],
      [42, "Switch to H8's eyes: the ball is coming to him, and H9 is on his blind side."],
      [50, "Switch to H8's eyes: he checks over his shoulder before the ball arrives."],
      [70, "Switch to H8's eyes: he has just received the ball."],
      // H9 is already looking over his shoulder (73-88) as the ball is played.
      [75, "Switch to H9's eyes: he checks over his shoulder before the ball arrives."],
      [139, "Switch to H9's eyes: he has just received the ball."],
    ]);
  });

  it("without the look, H8 never checks over his shoulder", () => {
    const rows = play(live("counterfactual"), 0, hero.runs.counterfactual.frames - 1);
    const lines = rows.map((r) => line(r.s));
    expect(lines).toContain("Switch to H8's eyes: the ball is coming to him.");
    expect(lines.some((l) => l?.includes("H8's eyes: he checks over his shoulder"))).toBe(false);
  });

  it("every pass suggestion shows at least half a second before its reception", () => {
    for (const name of ["factual", "counterfactual"] as const) {
      const run = hero.runs[name];
      const rows = play(live(name), 0, run.frames - 1);
      const firstShown = new Map<string, number>();
      for (const r of rows) {
        if (r.s?.rule === "incoming" && !firstShown.has(r.s.id)) firstShown.set(r.s.id, r.frame);
      }
      expect(firstShown.size).toBeGreaterThan(0);
      for (const [id, frame] of firstShown) {
        const arrival = rows.find((r) => r.s?.id === id)!.s!.arrival!;
        expect((arrival - frame) * hero.dt, `${name} ${id}`).toBeGreaterThanOrEqual(LEAD_S);
      }
    }
  });
});

describe("reasons", () => {
  it("are plain words: no number in them but the players' shirt ids", () => {
    const match = parseHero(matchExport());
    const runs = [
      runKnowledge(hero, hero.runs.factual, []),
      runKnowledge(hero, hero.runs.counterfactual, []),
      runKnowledge(
        match,
        match.runs.factual,
        match.match!.moments.map((card) => ({ card, breakdown: card.hero })),
      ),
    ];
    const seen = new Set<string>();
    for (const k of runs) {
      const frames = k === runs[2] ? match.runs.factual.frames : hero.runs.factual.frames;
      for (let f = 0; f < frames; f++) {
        for (const c of candidates(k, f)) seen.add(`${c.title}: ${c.reason}`);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
    const ids = new RegExp(`\\b(${hero.ids.join("|")})\\b`, "g");
    for (const text of seen) expect(text.replace(ids, "")).not.toMatch(/\d/);
  });
});
