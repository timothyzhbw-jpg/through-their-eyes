// Perception telemetry (SPEC 4.7, 7): curves for the player in the first-person view, with a
// cursor on the playhead; the scan detector's own onsets and scans; belief error for the hero only.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, type Session } from "../session";
import { API, exportJson, fakeFetch, fakeSockets, render } from "../testing";
import { TelemetryPanel } from "../ui/TelemetryPanel";
import { Hud } from "../views/PovOverlay";
import { DEG, frameX, keyPoints, telemetry } from "./telemetry";

const hero = parseHero(raw);
const key = hero.keyScan!; // the bundled scan hero has one
const ROWS = ["head", "speed", "sight", "belief"];
// One time axis for both runs, so the two curves line up when overlaid (and on switching runs).
const AXIS = Math.max(hero.runs.factual.frames, hero.runs.counterfactual.frames);

const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson);

function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}
const tags = (html: string, marker: string) =>
  [...html.matchAll(new RegExp(`<[a-z]+[^>]*\\s${marker}="[^"]*"[^>]*>`, "g"))].map((m) => m[0]);
const cursors = (html: string) => tags(html, "data-cursor").map((t) => Number(attr(t, "x1")));
const row = (html: string, name: string) =>
  html.split(`data-row="${name}"`)[1].split("data-row=")[0];
const value = (html: string, name: string) => /class="tvalue">([^<]*)</.exec(row(html, name))![1];
const series = (html: string, name: string) =>
  attr(tags(html, "data-series").find((t) => attr(t, "data-series") === name) ?? "", "d");
const at = (s: Session, patch: Parameters<Session["playback"]["set"]>[0]) => {
  s.playback.set(patch);
  return render(s, <TelemetryPanel />);
};

describe("the cursor follows the playhead", () => {
  it("sits at the playhead's frame in every row, fractional frames included", () => {
    const s = offline();
    const frames = hero.runs.factual.frames;
    for (const f of [0, key.start, key.start + 7.5, frames - 1]) {
      const xs = cursors(at(s, { frame: f }));
      expect(xs).toHaveLength(ROWS.length);
      for (const x of xs) expect(x).toBeCloseTo(frameX(AXIS, f), 6);
    }
  });

  it("keeps one time axis for both runs, though the run without the look is shorter", () => {
    const s = offline();
    expect(hero.runs.counterfactual.frames).toBeLessThan(AXIS);
    const factual = cursors(at(s, { frame: 100 }));
    const cf = cursors(at(s, { mode: "counterfactual", frame: 100 }));
    expect(cf).toEqual(factual);
    for (const x of cf) expect(x).toBeCloseTo(frameX(AXIS, 100), 6);
    const last = hero.runs.counterfactual.frames - 1;
    expect(cursors(at(s, { mode: "counterfactual", frame: last + 5 }))[0]).toBeCloseTo(
      frameX(AXIS, last),
      6,
    );
  });

  it("reads out the HUD's head angle and players in sight at the playhead", () => {
    const s = offline();
    for (const f of [key.start - 5, key.start + 6.4, key.end + 3]) {
      const panel = at(s, { frame: f });
      const hud = render(s, <Hud />);
      const head = /head (\d+)° from the ball/.exec(hud)![1];
      const sight = /(\d+) players in sight/.exec(hud)![1];
      expect(value(panel, "head")).toBe(`${head}°`);
      expect(value(panel, "sight")).toBe(sight);
    }
  });

  it("reads out the detector's angular speed for the frame at the playhead", () => {
    const s = offline();
    const j = hero.ids.indexOf("H8");
    const f = key.start + 1;
    const omega = exportJson.runs.factual.scan_detector.omega[f][j] * 1e-4;
    expect(value(at(s, { frame: f + 0.6 }), "speed")).toBe(
      `${(Math.abs(omega) * DEG).toFixed(0)}°/s`,
    );
  });
});

describe("switching whose eyes", () => {
  it("draws the selected player's curves and the detector's marks for him", () => {
    const s = offline();
    const h8 = at(s, { frame: key.start });
    s.controls.setPovPlayer("H9");
    const h9 = render(s, <TelemetryPanel />);
    expect(h8).toContain('data-player="H8"');
    expect(h9).toContain('data-player="H9"');
    for (const name of ["head", "speed", "sight"]) {
      expect(series(h9, name)).toBeTruthy();
      expect(series(h9, name)).not.toBe(series(h8, name));
    }
    const j = hero.ids.indexOf("H9");
    const last = hero.runs.factual.frames - 1;
    const onsets = exportJson.runs.factual.scan_detector.onsets[j].filter((f) => f + 1 <= last);
    expect(tags(h9, "data-onset").map((t) => Number(attr(t, "data-onset")))).toEqual(onsets);
    expect(cursors(h9)).toEqual(cursors(h8)); // same playhead
  });

  it("marks the key scan, the detector's scan on it, and an onset the gate rejected", () => {
    const html = at(offline(), { frame: key.start });
    const scans = tags(row(html, "head"), "data-scan");
    expect(scans.find((t) => attr(t, "data-scan") === key.id)).toContain('class="scan key"');
    const detected = tags(row(html, "speed"), "data-detected").map((t) =>
      Number(attr(t, "data-detected")),
    );
    expect(detected.some((start) => Math.abs(start - key.start) <= 3)).toBe(true);
    const onsets = tags(row(html, "speed"), "data-onset");
    expect(onsets.find((t) => Number(attr(t, "data-onset")) === key.start)).toContain(
      "onset accepted",
    );
    expect(onsets.some((t) => t.includes("onset rejected"))).toBe(true);
    expect(tags(row(html, "speed"), "data-threshold")).toHaveLength(1);
  });

  it("without the look, outlines where the hero's key scan was and detects nothing there", () => {
    const html = at(offline(), { mode: "counterfactual", frame: key.start });
    expect(row(html, "head")).toContain("data-dropped-key");
    const detected = tags(row(html, "speed"), "data-detected").map((t) =>
      Number(attr(t, "data-detected")),
    );
    expect(detected.some((start) => Math.abs(start - key.start) <= 3)).toBe(false);
  });
});

describe("belief error is the hero's only", () => {
  it("shows the hero's error on the runner: belief ghost to true position", () => {
    const s = offline();
    const html = at(s, { frame: key.end });
    expect(value(html, "belief")).toMatch(/^\d+\.\d m$/);
    expect(row(html, "belief")).toContain("H9");
    expect(series(html, "belief")).toBeTruthy();

    const t = telemetry(hero, hero.runs.factual, "H8");
    const j = hero.ids.indexOf("H9");
    const f = hero.runs.factual.decision!.frame;
    const run = exportJson.runs.factual;
    const gap = Math.hypot(
      (run.ghost[f][2 * j] - run.pos[f][2 * j]) / 1000,
      (run.ghost[f][2 * j + 1] - run.pos[f][2 * j + 1]) / 1000,
    );
    expect(t.belief!.target).toBe("H9");
    expect(t.belief!.error[f]).toBeCloseTo(gap, 4);
  });

  it("agrees with the decision's belief error at the decision, in both runs", () => {
    const s = offline();
    for (const mode of ["factual", "counterfactual"] as const) {
      const dec = hero.runs[mode].decision!;
      const html = at(s, { mode, frame: dec.frame });
      expect(value(html, "belief")).toBe(`${dec.belief_error.H9.toFixed(1)} m`);
    }
  });

  it("shows n/a for anyone else", () => {
    const s = offline();
    for (const id of ["H9", "A5"]) {
      s.controls.setPovPlayer(id);
      const html = render(s, <TelemetryPanel />);
      expect(value(html, "belief")).toBe("n/a");
      expect(series(html, "belief")).toBeNull();
      expect(telemetry(hero, hero.runs.factual, id).belief).toBeNull();
    }
  });

  it("labels every value as a computed sim metric, never a verified claim", () => {
    const html = at(offline(), { frame: key.start });
    for (const name of ROWS) {
      expect(row(html, name)).toMatch(/class="source"[^>]*title="[^"]*not a verified claim/);
    }
    expect(html).not.toContain("source verified");
    expect(html).not.toContain("✓");
  });
});

const points = (d: string | null) =>
  (d ?? "")
    .split(/[ML]/)
    .filter(Boolean)
    .map((p) => p.trim().split(" ").map(Number));

describe("the other run, overlaid", () => {
  it("draws the run without the look under the run with it, coinciding until the key scan", () => {
    const html = at(offline(), { frame: key.start });
    const other = tags(row(html, "head"), "data-series").find(
      (t) => attr(t, "data-series") === "head-other",
    )!;
    expect(attr(other, "data-run")).toBe("counterfactual");
    const mine = points(series(html, "head"));
    const theirs = points(series(html, "head-other"));
    expect(mine).toHaveLength(hero.runs.factual.frames);
    expect(theirs).toHaveLength(hero.runs.counterfactual.frames);
    for (let f = 0; f <= key.start; f++) expect(theirs[f]).toEqual(mine[f]);
    const apart = (f: number) => Math.abs(theirs[f][1] - mine[f][1]);
    expect(
      Math.max(...[...Array(key.end - key.start)].map((_, k) => apart(key.start + 1 + k))),
    ).toBeGreaterThan(10);
  });

  it("overlays the run with the look when the run without it is on screen", () => {
    const html = at(offline(), { mode: "counterfactual", frame: key.start });
    const other = tags(html, "data-series").find((t) => attr(t, "data-series") === "head-other")!;
    expect(attr(other, "data-run")).toBe("factual");
    // The whole run with the look, past the end of the shorter one: one axis for both.
    expect(points(series(html, "head-other"))).toHaveLength(hero.runs.factual.frames);
  });

  it("overlays the hero's belief error too: it drops after the look, stays high without it", () => {
    const html = at(offline(), { frame: key.start });
    const f = hero.runs.factual.decision!.frame;
    const y = (name: string) => points(series(html, name))[f][1];
    expect(y("belief-other")).toBeLessThan(y("belief")); // larger error is higher up (smaller y)
    const s = offline();
    s.controls.setPovPlayer("H9");
    expect(series(render(s, <TelemetryPanel />), "belief-other")).toBeNull();
  });

  it("is not drawn live: the stream sends one run", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fakeFetch({})),
      socket: fakeSockets(),
    });
    session.feed!.state.set({ latest: 100 });
    const html = at(session, { live: true, frame: 100 });
    expect(series(html, "head-other")).toBeNull();
    expect(series(html, "belief-other")).toBeNull();
  });
});

describe("key points on the shared time axis", () => {
  it("marks the key scan, the ball reaching the hero, and his decision and pass", () => {
    const kp = keyPoints(hero, hero.runs.factual);
    expect(kp.scan).toEqual({ start: key.start, end: key.end, dropped: false });
    const arrival = hero.reception;
    const decision = hero.runs.factual.decision!.frame;
    expect(hero.runs.factual.action!.frame).toBe(decision); // the pass leaves as he decides
    expect(kp.points.map((p) => [p.frame, p.label])).toEqual([
      [arrival, `Ball at ${hero.heroId}`],
      [decision, "Decision · pass"],
    ]);
    // Close together: the first label sits left of its line, the second right of its own.
    expect(kp.points.map((p) => p.align)).toEqual(["end", "start"]);
  });

  it("draws them above the curves and as guides through every sparkline", () => {
    const html = at(offline(), { frame: key.start });
    const axis = row(html, "axis");
    const marks = tags(axis, "data-key-point").map((t) => Number(attr(t, "data-key-point")));
    expect(marks).toEqual([hero.reception, hero.runs.factual.decision!.frame]);
    expect(axis).toContain(`${hero.heroId} key scan`);
    const frames = [key.start, key.end, hero.reception, hero.runs.factual.decision!.frame];
    for (const name of ROWS) {
      const guides = tags(row(html, name), "data-guide").map((t) => Number(attr(t, "data-guide")));
      expect([...new Set(guides)].sort((a, b) => a - b)).toEqual(
        [...new Set(frames)].sort((a, b) => a - b),
      );
      for (const t of tags(row(html, name), "data-guide")) {
        expect(Number(attr(t, "x1"))).toBeCloseTo(frameX(AXIS, Number(attr(t, "data-guide"))), 6);
      }
    }
  });

  it("without the look, marks the dropped key scan", () => {
    const kp = keyPoints(hero, hero.runs.counterfactual);
    expect(kp.scan).toEqual({ start: key.start, end: key.end, dropped: true });
    expect(row(at(offline(), { mode: "counterfactual", frame: 10 }), "axis")).toContain("dropped");
  });

  it("live, shows only what has happened by the last frame sent", () => {
    const early = keyPoints(hero, hero.runs.factual, key.start + 5);
    expect(early.scan).toBeNull();
    expect(early.points).toEqual([]);
    const later = keyPoints(hero, hero.runs.factual, hero.reception);
    expect(later.scan).not.toBeNull();
    expect(later.points.map((p) => p.frame)).toEqual([hero.reception]);
  });
});

describe("live: nothing after the last frame the stream sent", () => {
  it("cuts curves, scans and onsets at that frame", () => {
    const t = telemetry(hero, hero.runs.factual, "H8", 40);
    expect(t.known).toBe(40);
    expect(t.scans).toEqual([]); // the key scan ends after frame 40
    expect(t.detected).toEqual([]);
    expect(t.onsets.every((o) => o.frame + 1 <= 40)).toBe(true);
    const later = telemetry(hero, hero.runs.factual, "H8", key.end);
    expect(later.scans.map((sc) => sc.id)).toEqual([key.id]);
  });

  it("draws the stream so far in the panel", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
      api: createApi(API, "blind_side_run-3", fakeFetch({})),
      socket: fakeSockets(),
    });
    session.feed!.state.set({ latest: 40 });
    const html = at(session, { live: true, frame: 40 });
    expect(series(html, "head")!.split(/[ML]/).filter(Boolean)).toHaveLength(41);
    expect(tags(html, "data-scan")).toEqual([]);
    expect(cursors(html)[0]).toBeCloseTo(frameX(hero.runs.factual.frames, 40), 6);
  });
});
