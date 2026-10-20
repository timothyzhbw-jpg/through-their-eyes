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
import { PovOverlay } from "../views/PovOverlay";
import { DEG, frameX, telemetry } from "./telemetry";

const hero = parseHero(raw);
const key = hero.keyScan;
const ROWS = ["head", "speed", "sight", "belief"];

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
      for (const x of xs) expect(x).toBeCloseTo(frameX(frames, f), 6);
    }
  });

  it("uses the run on screen: without the look the run is shorter", () => {
    const s = offline();
    const cf = hero.runs.counterfactual.frames;
    expect(cf).not.toBe(hero.runs.factual.frames);
    const xs = cursors(at(s, { mode: "counterfactual", frame: 100 }));
    for (const x of xs) expect(x).toBeCloseTo(frameX(cf, 100), 6);
  });

  it("reads out the HUD's head angle and players in sight at the playhead", () => {
    const s = offline();
    for (const f of [key.start - 5, key.start + 6.4, key.end + 3]) {
      const panel = at(s, { frame: f });
      const hud = render(s, <PovOverlay />);
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
