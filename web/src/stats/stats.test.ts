// The live match stats in the viewer (SPEC 4.6, 7): the API's numbers, aggregated at the playhead
// exactly as analytics/live_stats.py does at that frame (the fixture is its output for
// blind_side_run seed 3, written by `python -m analytics.live_stats --web-fixture`), never showing
// a cue before the frame at which it is final.

import { describe, expect, it } from "vitest";
import fixture from "./fixture_seed3.json";
import {
  audienceOf,
  ballKmh,
  cuesUpTo,
  headlines,
  parseStats,
  prepare,
  speedKmh,
  sprintKmh,
  statTags,
  totalsAt,
  type Stats,
} from "./stats";

const stats: Stats = prepare(parseStats(fixture.stats));
const snapshots = Object.entries(fixture.snapshots).map(
  ([f, s]) => [Number(f), parseStats(s)] as const,
);

describe("the stats payload", () => {
  it("parses the API's MatchStats with tracks and names", () => {
    expect(stats.raw.source).toBe("tracking");
    expect(stats.raw.players).toHaveLength(22);
    expect(stats.raw.tracks?.every).toBe(25);
    const h8 = stats.raw.players.find((p) => p.id === "H8")!;
    expect(h8.name).toBe("Joss Ferriday");
    expect(h8.short).toBe("J. Ferriday");
  });

  it("refuses a payload that is not MatchStats", () => {
    expect(() => parseStats({ players: [] })).toThrow();
    expect(() => parseStats({ ...fixture.stats, source: "verified" })).toThrow();
  });
});

describe("totals at the playhead match the API's snapshot at that frame", () => {
  for (const [frame, snap] of snapshots) {
    it(`frame ${frame}`, () => {
      expect(frame % 25).toBe(0); // distances update once a second, at the checkpoints
      const at = totalsAt(stats, frame);
      snap.players.forEach((p, j) => {
        const mine = at.players[j];
        expect(mine.id).toBe(p.id);
        expect(mine.distance_m).toBeCloseTo(p.distance_m, 1);
        expect(mine.hsr_m).toBeCloseTo(p.hsr_m, 1);
        expect(mine.sprint_m).toBeCloseTo(p.sprint_m, 1);
        expect(Math.abs(mine.top_kmh - p.top_kmh)).toBeLessThanOrEqual(0.051);
        expect([mine.sprints, mine.passes, mine.completed, mine.shots]).toEqual([
          p.sprints,
          p.passes,
          p.completed,
          p.shots,
        ]);
        if (p.mean_difficulty === null) expect(mine.mean_difficulty).toBeNull();
        else expect(Math.abs(mine.mean_difficulty! - p.mean_difficulty)).toBeLessThan(0.0051);
      });
      snap.teams.forEach((t, k) => {
        expect([at.teams[k].passes, at.teams[k].completed]).toEqual([t.passes, t.completed]);
        expect(Math.abs(at.teams[k].distance_m - t.distance_m)).toBeLessThan(1.2);
      });
      expect(cuesUpTo(stats, frame).map((c) => c.id)).toEqual(snap.cues.map((c) => c.id));
    });
  }
});

describe("speeds at the playhead", () => {
  // A run above 19.8 km/h with a stretch above 25.2 km/h (`sprint`, as Python compared it).
  const run = stats.raw.tracks!.speed.find((r) => r.sprint.some(([a, b]) => b - a >= 10))!;
  const [a] = run.sprint.find(([x, y]) => y - x >= 10)!;

  it("reads a player's speed above 19.8 km/h from the tracks, and nothing below it", () => {
    expect(speedKmh(stats, run.player, run.start)).toBe(run.kmh10[0] / 10);
    expect(speedKmh(stats, run.player, run.start - 1)).toBeNull();
    expect(speedKmh(stats, run.player, run.start + run.kmh10.length)).toBeNull();
  });

  it("tags a sprint only once he has been above 25.2 km/h for 0.4 s", () => {
    expect(sprintKmh(stats, run.player, a)).toBeNull();
    expect(sprintKmh(stats, run.player, a + 8)).toBeNull();
    expect(sprintKmh(stats, run.player, a + 9)).toBe(run.kmh10[a + 9 - run.start] / 10);
  });

  it("reads the ball's smoothed speed", () => {
    const k = 60;
    expect(ballKmh(stats, k)).toBe(stats.raw.tracks!.ball_kmh10[k] / 10);
    expect(ballKmh(stats, 10_000)).toBe(stats.raw.tracks!.ball_kmh10.at(-1)! / 10);
  });
});

describe("audiences", () => {
  it("gives the analyst the table, a casual viewer headlines and a player fan his player", () => {
    expect(audienceOf("analyst")).toBe("table");
    expect(audienceOf("coach")).toBe("table");
    expect(audienceOf("casual")).toBe("headlines");
    expect(audienceOf("audio_description")).toBe("headlines");
    expect(audienceOf("player_fan")).toBe("player");
  });

  it("headlines are at most three, known by the playhead, and name the player", () => {
    const end = stats.raw.frames - 1;
    const lines = headlines(stats, end);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(3);
    const fastest = totalsAt(stats, end).players.reduce((a, b) => (b.top_kmh > a.top_kmh ? b : a));
    expect(lines[0]).toMatchObject({
      key: "top_speed",
      value: `${fastest.top_kmh.toFixed(1)} km/h`,
    });
    expect(lines[0].who).toContain(fastest.short);
    // The clubs go by their fictional names (SPEC 4.6).
    const accuracy = lines.find((h) => h.key === "pass_accuracy");
    expect(accuracy?.value).toMatch(/^Kestrel Bay (\d+%|–) · Corvane Vale (\d+%|–)$/);
    // Before the first pass is final, no headline is about passes.
    const firstPass = stats.raw.cues.find((c) => c.kind === "pass")!;
    expect(headlines(stats, firstPass.frame - 1).some((h) => h.key.includes("pass"))).toBe(false);
  });

  it("audio description gets no difficulty rating", () => {
    const end = stats.raw.frames - 1;
    expect(headlines(stats, end, { ratings: false }).some((h) => h.key === "hardest_pass")).toBe(
      false,
    );
  });
});

describe("in-view tags", () => {
  it("names the ball carrier with his shirt number and surname", () => {
    const tags = statTags(stats, 30, stats.ids.indexOf("H8"));
    expect(tags).toContainEqual({ player: "H8", kind: "name", label: "8", text: "FERRIDAY" });
    expect(statTags(stats, 30, -1).some((t) => t.kind === "name")).toBe(false);
  });

  it("shows a sprint with the player's name and speed only past the dwell", () => {
    const run = stats.raw.tracks!.speed.find((r) => r.sprint.some(([a, b]) => b - a >= 10))!;
    const at = run.sprint.find(([a, b]) => b - a >= 10)![0] + 9;
    const tag = statTags(stats, at, -1).find((t) => t.kind === "sprint")!;
    const p = stats.raw.players.find((x) => x.id === run.player)!;
    expect(tag).toMatchObject({ player: run.player, label: "SPRINT" });
    expect(tag.text).toBe(`${p.short} ${sprintKmh(stats, run.player, at)!.toFixed(1)} km/h`);
  });

  it("shows a completed pass on its receiver for 1.5 s, with distance and difficulty", () => {
    const pass = stats.raw.cues.find((c) => c.kind === "pass" && c.outcome === "complete")!;
    if (pass.kind !== "pass") throw new Error("not a pass");
    const tag = statTags(stats, pass.frame, -1).find((t) => t.kind === "pass")!;
    expect(tag.player).toBe(pass.receiver);
    expect(tag.label).toBe("PASS");
    expect(tag.text).toContain(`${Math.round(pass.distance_m)} m`);
    expect(tag.text).toContain(pass.band);
    expect(statTags(stats, pass.frame - 1, -1).some((t) => t.kind === "pass")).toBe(false);
    expect(statTags(stats, pass.frame + 37, -1).some((t) => t.kind === "pass")).toBe(true);
    expect(statTags(stats, pass.frame + 38, -1).some((t) => t.kind === "pass")).toBe(false);
  });

  it("shows a distance milestone for 2 s and a shot's speed on the shooter", () => {
    type Loose = { frame: number } & Record<string, unknown>;
    const raw = structuredClone(fixture.stats) as unknown as { cues: Loose[] };
    raw.cues.push(
      {
        kind: "distance",
        id: "distance:H9:250",
        frame: 100,
        t: 4,
        possession: null,
        player: "H9",
        metres: 250,
      },
      {
        kind: "shot",
        id: "shot:H9:0110",
        frame: 115,
        t: 4.6,
        possession: null,
        kick: 110,
        player: "H9",
        speed_kmh: 104.4,
      },
    );
    raw.cues.sort((a, b) => a.frame - b.frame);
    const s = prepare(parseStats(raw));
    expect(statTags(s, 100, -1)).toContainEqual({
      player: "H9",
      kind: "distance",
      label: "250 M",
      text: "N. Varnhall",
    });
    expect(statTags(s, 149, -1).some((t) => t.kind === "distance")).toBe(true);
    expect(statTags(s, 150, -1).some((t) => t.kind === "distance")).toBe(false);
    expect(statTags(s, 115, -1)).toContainEqual({
      player: "H9",
      kind: "shot",
      label: "SHOT",
      text: "N. Varnhall 104.4 km/h",
    });
    expect(statTags(s, 114, -1).some((t) => t.kind === "shot")).toBe(false);
  });
});
