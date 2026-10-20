// Skeleton data view (SPEC 7, optional): per player only what the sim records, drawn the way
// limb-tracking data is shown: the position, the torso line from the body yaw, the head ray from
// the head yaw (true, or as a tracking system reports it), the head-torso angle as a fan, and the
// head ray lit while the scan detector marks a scan. Off by default; one toggle for the broadcast
// camera and the tactical board; a hero moment and a stitched match both draw it.

import { describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero, Sample, sampleInto, wrapAngle, type Hero, type Run } from "../data/hero";
import { createMatchSession, type MatchSession } from "../match/matchSession";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, type Session, type ViewSession } from "../session";
import { createPlayback } from "../store/playback";
import { API, fakeFetch, fakeSockets, MATCH, matchExport, render } from "../testing";
import { PovOptions, TacticalOptions } from "../ui/Stage";
import { SkeletonLayer } from "./SkeletonLayer";
import { SkeletonLegend } from "./SkeletonLegend";
import {
  fanEdges,
  litBy,
  litMask,
  Pose,
  poseInto,
  shoulders,
  SkeletonGeometry,
  trackedHead,
} from "./skeleton";

// useFrame needs a Canvas; the geometry is tested through SkeletonGeometry instead.
vi.mock("@react-three/fiber", async (original) => ({
  ...(await original<typeof import("@react-three/fiber")>()),
  useFrame: () => {},
  useThree: (pick: (s: { size: { width: number; height: number } }) => unknown) =>
    pick({ size: { width: 800, height: 450 } }),
}));

const DEG = 180 / Math.PI;
const hero = parseHero(raw);
const H8 = hero.ids.indexOf("H8");
const KEY = { start: 50, end: 70 }; // the scan detector's scan of H8 in the factual run (the key scan)

const heroSession = (): Session => createSession(hero, EXAMPLE_PLAN, payloadJson);
function matchSession(): MatchSession {
  const fetch = fakeFetch({});
  return createMatchSession(parseHero(structuredClone(matchExport())), {
    api: createApi(API, MATCH, fetch),
    dataUrl: "/data/",
    fetch,
    socket: fakeSockets(),
  });
}

/** Every <button> of the markup with its text, aria-pressed, disabled and title. */
function buttons(html: string) {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, text]) => ({
    text: text.replace(/<[^>]+>/g, ""),
    pressed: /aria-pressed="([^"]*)"/.exec(attrs)?.[1] ?? null,
    disabled: /\sdisabled=""/.test(attrs),
    title: /title="([^"]*)"/.exec(attrs)?.[1] ?? null,
  }));
}
const button = (html: string, text: string) => buttons(html).find((b) => b.text === text);
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("the toggle", () => {
  it("is off by default, in a hero moment and in a stitched match", () => {
    expect(createPlayback(hero).get().skeleton).toBe(false);
    expect(createPlayback(hero).get().skeletonSource).toBe("true");
    for (const s of [heroSession(), matchSession()] as ViewSession[]) {
      expect(s.playback.get().skeleton).toBe(false);
      s.controls.toggle("skeleton");
      expect(s.playback.get().skeleton).toBe(true);
      s.controls.toggle("skeleton");
      expect(s.playback.get().skeleton).toBe(false);
    }
  });

  it("is one chip in the view options, for the board and the broadcast camera", () => {
    // The live screen keeps every overlay toggle behind View options (ui/Stage.tsx): the board's
    // group holds the skeleton's chip, the first person's group has none.
    for (const s of [heroSession(), matchSession()] as ViewSession[]) {
      expect(button(render(s, <TacticalOptions />), "Skeleton")?.pressed).toBe("false");
      expect(button(render(s, <PovOptions />), "Skeleton")).toBeUndefined();
      s.controls.setCamera("broadcast");
      s.controls.toggle("skeleton");
      expect(button(render(s, <TacticalOptions />), "Skeleton")?.pressed).toBe("true");
    }
  });
});

// ---------- the tracked head yaw ----------

/** A deterministic normal sampler (mulberry32 + Box-Muller). */
function normals(seed: number) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/**
 * One player whose true head yaw sweeps through +-pi and makes a fast scan, tracked with the sim's
 * sensor model (independent 2 degree noise per frame), exported as sim.export does: only the
 * detector's angular velocity of the tracked yaw, rounded to 1e-4 rad/s.
 */
function trackedFixture(frames = 250) {
  const dt = 0.04;
  const noise = normals(7);
  const truth = new Float32Array(frames);
  const tracked = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const scan = f >= 120 && f < 140 ? Math.sin(((f - 120) / 20) * Math.PI) * 1.8 : 0;
    truth[f] = wrapAngle(2.6 + 0.01 * f + scan); // crosses +pi at f = 54
    tracked[f] = wrapAngle(truth[f] + noise() * (2 / DEG));
  }
  const omega = new Float32Array(frames - 1);
  for (let t = 0; t < frames - 1; t++) {
    omega[t] = Math.round((wrapAngle(tracked[t + 1] - tracked[t]) / dt) * 1e4) * 1e-4;
  }
  const run = { frames, head: truth, detector: { omega, onsets: [[]], scans: [[]] } } as unknown;
  return { hero: { n: 1, dt } as Hero, run: run as Run, truth, tracked };
}

describe("the tracked head yaw (as tracked)", () => {
  it("is the tracked series the detector ran on, rebuilt from its exported angular velocity", () => {
    const { hero: h, run, truth, tracked } = trackedFixture();
    const rebuilt = trackedHead(h, run)!;
    let fromTracked = 0;
    let fromTruth = 0;
    for (let f = 0; f < run.frames; f++) {
      fromTracked = Math.max(fromTracked, Math.abs(wrapAngle(rebuilt[f] - tracked[f])));
      fromTruth = Math.max(fromTruth, Math.abs(wrapAngle(rebuilt[f] - truth[f])));
    }
    // Only the constant is estimated (the mean of the noise, sigma / sqrt(frames)).
    expect(fromTracked * DEG).toBeLessThan(0.5);
    expect(fromTruth * DEG).toBeGreaterThan(4); // it carries the sensor noise: not the truth
  });

  it("on the bundled export: its turn rates are the detector's, its noise centred on the truth", () => {
    for (const run of [hero.runs.factual, hero.runs.counterfactual]) {
      const rebuilt = trackedHead(hero, run)!;
      expect(trackedHead(hero, run)).toBe(rebuilt); // computed once per run
      const n = hero.n;
      for (let j = 0; j < n; j++) {
        let worst = 0;
        let mean = 0;
        for (let f = 0; f < run.frames; f++) {
          const err = wrapAngle(rebuilt[f * n + j] - run.head[f * n + j]);
          worst = Math.max(worst, Math.abs(err));
          mean += err / run.frames;
          if (f === run.frames - 1) continue;
          const rate = wrapAngle(rebuilt[(f + 1) * n + j] - rebuilt[f * n + j]) / hero.dt;
          expect(Math.abs(rate - run.detector!.omega[f * n + j])).toBeLessThan(1e-3);
        }
        expect(worst * DEG).toBeLessThan(10); // 2 degree noise: 7.5 degrees at most in this run
        expect(Math.abs(mean) * DEG).toBeLessThan(0.5);
      }
    }
  });

  it("is not in a stitched match's export", () => {
    const match = matchSession().hero;
    expect(trackedHead(match, match.runs.factual)).toBeNull();
  });
});

// ---------- what lights the head ray ----------

describe("the head ray lights up", () => {
  it("while the scan detector marks a scan, on the tracked head yaw", () => {
    const run = hero.runs.factual;
    expect(litBy(run)).toBe("detector");
    const lit = litMask(hero, run);
    const at = (f: number, j: number) => lit[f * hero.n + j] === 1;
    expect(at(KEY.start - 1, H8)).toBe(false);
    for (let f = KEY.start; f <= KEY.end; f++) expect(at(f, H8)).toBe(true);
    expect(at(KEY.end + 1, H8)).toBe(false);
    for (let j = 0; j < hero.n; j++) {
      for (let f = 0; f < run.frames; f++) {
        const marked = run.detector!.scans[j].some((s) => f >= s.start && f <= s.end);
        expect(at(f, j)).toBe(marked);
      }
    }
  });

  it("not for H8 without the look: the dropped scan is nowhere in that run", () => {
    const run = hero.runs.counterfactual;
    const lit = litMask(hero, run);
    for (let f = KEY.start; f <= KEY.end; f++) expect(lit[f * hero.n + H8]).toBe(0);
  });

  it("in a stitched match, with no detector run, during the sim's own scans", () => {
    const match = matchSession().hero;
    const run = match.runs.factual;
    expect(litBy(run)).toBe("sim");
    const lit = litMask(match, run);
    expect(run.scans.length).toBeGreaterThan(0);
    for (const s of run.scans) {
      const j = match.ids.indexOf(s.player);
      for (let f = s.start; f <= s.end; f++) expect(lit[f * match.n + j]).toBe(1);
    }
    const total = lit.reduce((a, b) => a + b, 0);
    const expected = new Set(
      run.scans.flatMap((s) =>
        Array.from({ length: s.end - s.start + 1 }, (_, k) => `${s.start + k}:${s.player}`),
      ),
    );
    expect(total).toBe(expected.size);
  });
});

// ---------- the pose ----------

describe("the pose", () => {
  const at = (h: Hero, run: Run, frame: number, source: "true" | "tracked") => {
    const sample = sampleInto(new Sample(h.n), h, run, frame);
    return { sample, pose: poseInto(new Pose(h.n), h, run, sample, frame, source) };
  };

  it("true: the head yaw the other views draw, and the torso yaw; the angle is signed", () => {
    const { sample, pose } = at(hero, hero.runs.factual, 61.5, "true");
    expect(pose.source).toBe("true");
    for (let j = 0; j < hero.n; j++) {
      expect(pose.yaw[j]).toBeCloseTo(sample.head[j], 6);
      expect(pose.body[j]).toBeCloseTo(sample.body[j], 6);
      expect(pose.twist[j]).toBeCloseTo(wrapAngle(sample.head[j] - sample.body[j]), 5);
    }
    // In the key scan H8's head is turned far off his torso.
    expect(Math.abs(pose.twist[H8]) * DEG).toBeGreaterThan(45);
    expect(pose.lit[H8]).toBe(1);
  });

  it("as tracked: the tracked yaw, interpolated between frames", () => {
    const run = hero.runs.factual;
    const tracked = trackedHead(hero, run)!;
    const { pose } = at(hero, run, 60.25, "tracked");
    expect(pose.source).toBe("tracked");
    const a = tracked[60 * hero.n + H8];
    const b = tracked[61 * hero.n + H8];
    expect(wrapAngle(pose.yaw[H8] - (a + 0.25 * wrapAngle(b - a)))).toBeCloseTo(0, 5);
  });

  it("falls back to the true yaw in a stitched match", () => {
    const match = matchSession().hero;
    const { sample, pose } = at(match, match.runs.factual, 100, "tracked");
    expect(pose.source).toBe("true");
    expect(pose.yaw[0]).toBeCloseTo(sample.head[0], 6);
  });

  it("the torso line is the shoulders: across the torso's facing, centred on the player", () => {
    for (const body of [0, 0.7, -2.4, Math.PI]) {
      const [x1, y1, x2, y2] = shoulders(10, -4, body, 0.25);
      expect((x1 + x2) / 2).toBeCloseTo(10, 6);
      expect((y1 + y2) / 2).toBeCloseTo(-4, 6);
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(0.5, 6);
      expect((x2 - x1) * Math.cos(body) + (y2 - y1) * Math.sin(body)).toBeCloseTo(0, 6);
    }
  });

  it("the fan opens from the torso's facing to the head, on the side the head turned", () => {
    const left = fanEdges(0.5, 1.2, new Float32Array(7));
    expect(left[0]).toBeCloseTo(0.5, 6);
    expect(left[3]).toBeCloseTo(1.1, 6);
    expect(left[6]).toBeCloseTo(1.7, 6);
    const right = fanEdges(0.5, -1.2, new Float32Array(7));
    expect(right[6]).toBeCloseTo(-0.7, 6);
  });
});

// ---------- what is drawn ----------

describe("the geometry", () => {
  function drawn(variant: "board" | "broadcast", frame: number) {
    const run = hero.runs.factual;
    const sample = sampleInto(new Sample(hero.n), hero, run, frame);
    const pose = poseInto(new Pose(hero.n), hero, run, sample, frame, "true");
    const g = new SkeletonGeometry(hero.n, variant);
    g.update(pose, sample, 1);
    return { g, pose, sample };
  }

  it("one torso line and one head ray per player, lit rays apart; nothing else per player", () => {
    const lit = litMask(hero, hero.runs.factual);
    for (const variant of ["board", "broadcast"] as const) {
      for (const frame of [20, 60]) {
        const { g } = drawn(variant, frame);
        const marked = hero.ids.filter((_, j) => lit[frame * hero.n + j]).length;
        expect(g.torso.count).toBe(hero.n);
        expect(g.lit.count).toBe(marked);
        expect(g.rays.count).toBe(hero.n - marked);
        expect(g.spine.count).toBe(variant === "broadcast" ? hero.n : 0);
      }
    }
    expect(lit[60 * hero.n + H8]).toBe(1); // H8 in the key scan
  });

  it("a lit ray starts at the player and points along his head yaw", () => {
    const { g, pose, sample } = drawn("board", 60);
    const lit = litMask(hero, hero.runs.factual);
    const litPlayers = hero.ids.map((_, j) => j).filter((j) => lit[60 * hero.n + j]);
    const k = litPlayers.indexOf(H8); // lit rays are drawn in player order
    const [ax, , az, bx, , bz] = g.lit.segment(k);
    // The board lies in three.js XZ: pitch (x, y) -> (x, 0, -y).
    const [px, py] = [sample.pos[2 * H8], sample.pos[2 * H8 + 1]];
    expect(Math.hypot(ax - px, -az - py)).toBeLessThan(1.5); // from the token's edge
    expect(Math.atan2(-(bz - az), bx - ax)).toBeCloseTo(pose.yaw[H8], 4);
  });

  it("the fan's opacity grows with the head-torso angle", () => {
    const { g, pose } = drawn("board", 60);
    let most = 0;
    let least = 0;
    for (let j = 1; j < hero.n; j++) {
      if (Math.abs(pose.twist[j]) > Math.abs(pose.twist[most])) most = j;
      if (Math.abs(pose.twist[j]) < Math.abs(pose.twist[least])) least = j;
    }
    expect(g.fanAlpha(most)).toBeGreaterThan(g.fanAlpha(least));
  });
});

// ---------- legend and switch ----------

describe("the legend", () => {
  it("is shown only while the skeleton is on", () => {
    const s = heroSession();
    expect(render(s, <SkeletonLegend />)).toBe("");
    s.controls.toggle("skeleton");
    expect(render(s, <SkeletonLegend />)).not.toBe("");
  });

  it("switches the head yaw between true and as tracked, and says what is data", () => {
    const s = heroSession();
    s.controls.toggle("skeleton");
    s.playback.set({ frame: 60 });
    let html = render(s, <SkeletonLegend />);
    expect(button(html, "True")?.pressed).toBe("true");
    expect(button(html, "As tracked")).toMatchObject({ pressed: "false", disabled: false });
    const text = plain(html);
    expect(text).toContain("lit: scan detector");
    expect(text).toMatch(/limbs/i);
    expect(text).toContain("not data");
    s.controls.setSkeletonSource("tracked");
    html = render(s, <SkeletonLegend />);
    expect(button(html, "As tracked")?.pressed).toBe("true");
    expect(plain(html)).toContain("2° sensor noise");
  });

  it("reads out the head-torso angle of the player whose eyes the view uses", () => {
    const s = heroSession();
    s.controls.toggle("skeleton");
    s.playback.set({ frame: 60, povPlayer: "H8" });
    const run = hero.runs.factual;
    const sample = sampleInto(new Sample(hero.n), hero, run, 60);
    const pose = poseInto(new Pose(hero.n), hero, run, sample, 60, "true");
    const deg = Math.round(Math.abs(pose.twist[H8]) * DEG);
    expect(plain(render(s, <SkeletonLegend />))).toContain(`H8: head ${deg}° off the torso`);
  });

  it("in a stitched match: true yaw only, lit by the sim's scans", () => {
    const s = matchSession();
    s.controls.toggle("skeleton");
    s.controls.setSkeletonSource("tracked"); // asked for, not available: the true yaw is drawn
    const html = render(s, <SkeletonLegend />);
    expect(button(html, "True")?.pressed).toBe("true");
    expect(button(html, "As tracked")).toMatchObject({ pressed: "false", disabled: true });
    expect(button(html, "As tracked")?.title).toContain("hero moment");
    expect(plain(html)).toContain("lit: sim's own scans");
  });
});

describe("the layers", () => {
  it("render in a hero moment and in a stitched match (useView, not useSession)", () => {
    for (const s of [heroSession(), matchSession()] as ViewSession[]) {
      const sample = new Sample(s.hero.n);
      expect(() => render(s, <SkeletonLayer sample={sample} variant="board" />)).not.toThrow();
      expect(() => render(s, <SkeletonLayer sample={sample} variant="broadcast" />)).not.toThrow();
      expect(() => render(s, <SkeletonLegend />)).not.toThrow();
    }
  });
});
