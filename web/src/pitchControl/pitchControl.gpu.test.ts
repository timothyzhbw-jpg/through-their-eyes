// Pitch-control shader vs the numpy kernel (SPEC 4): the tactical board's GLSL, run by three.js in
// headless Chrome (WebGL2; SwiftShader, Chrome's software rasteriser, where there is no GPU),
// against analytics/pitch_control.py on the 10 fixed snapshots of eval/pitch_control_parity.py,
// at the centre of every cell of the backend's 1 m grid. Needs Chrome or Chromium: see
// scripts/gpu.mjs.

import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchChrome, rendererOf, serveTestPage } from "../../scripts/gpu.mjs";
import { COLORS } from "../views/scene";
import type { Overlay, Rows } from "./harness";
import { OPACITY } from "./pitchControl";
import snapshots from "./snapshots.json";

const SPEC_TOLERANCE = 0.02; // SPEC 4: max abs diff, every snapshot
// What float32 arithmetic and the reference's rounding to 1e-4 leave: catches a wrong parameter
// or a changed formula long before 0.02 does (sigma 0.45 -> 0.46 moves P by up to ~0.01).
const FLOAT32_TOLERANCE = 1e-3;

interface Snapshot {
  frame: number;
  label: string;
  home: number[][]; // [x, y, vx, vy], mm and mm/s
  away: number[][];
  control: number[]; // P(home), 1e-4, x fastest from (-x, -y)
}

const fixture: { grid: { cell: number; nx: number; ny: number }; snapshots: Snapshot[] } =
  snapshots;
const { nx, ny } = fixture.grid;
const metres = (rows: number[][]): Rows => rows.map((row) => row.map((v) => v / 1000));
const cellName = (k: number) => `(${-52 + (k % nx)}, ${-33.5 + Math.floor(k / nx)}) m`;

let server: Awaited<ReturnType<typeof serveTestPage>>;
let browser: Browser;
let page: Page;
let renderer = "";
const pageErrors: string[] = [];

beforeAll(async () => {
  // The harness page imports the production module, served as in `npm run dev`.
  server = await serveTestPage("src/pitchControl/harness.html");
  browser = await launchChrome();
  page = await browser.newPage();
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    const text = msg.text();
    // Chrome's notes on readPixels stalls are about speed, not correctness.
    if (/GL Driver Message \(OpenGL, Performance/.test(text)) return;
    if (msg.type() === "error" || msg.type() === "warning") pageErrors.push(text);
  });
  await page.goto(server.url);
  await page.waitForFunction(() => window.pitchControlHarness !== undefined);
  renderer = await rendererOf(page);
  // Starting Vite, Chrome and the harness page took more than 60 s on a loaded runner (main's CI
  // failed once on this hook): the parity checks themselves stay strict, only their set-up waits.
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
}, 60_000);

const control = (home: Rows, away: Rows) =>
  page.evaluate(([h, a]) => window.pitchControlHarness!.control(h, a), [home, away] as const);

const overlay = (home: Rows, away: Rows): Promise<Overlay> =>
  page.evaluate(([h, a]) => window.pitchControlHarness!.overlay(h, a), [home, away] as const);

describe("pitch-control shader vs the numpy kernel (SPEC 4)", () => {
  const report: string[] = [];
  afterAll(() => console.info(`pitch-control parity on ${renderer}\n${report.join("\n")}`));

  it("has 10 snapshots on the 1 m grid", () => {
    expect(fixture.grid.cell).toBe(1);
    expect(fixture.snapshots).toHaveLength(10);
  });

  it.each(fixture.snapshots)(
    "frame $frame ($label): max abs diff below 0.02 on the 1 m grid",
    async (s) => {
      const p = await control(metres(s.home), metres(s.away));
      expect(p).toHaveLength(nx * ny);
      let max = 0;
      let at = 0;
      p.forEach((v, k) => {
        const d = Math.abs(v - s.control[k] / 1e4);
        if (d > max) [max, at] = [d, k];
      });
      report.push(`  frame ${s.frame} (${s.label}): max |GLSL - numpy| ${max.toExponential(2)}`);
      expect(max, `worst cell ${cellName(at)}`).toBeLessThan(SPEC_TOLERANCE);
      expect(max, `worst cell ${cellName(at)}`).toBeLessThan(FLOAT32_TOLERANCE);
    },
    20_000,
  );

  it("gives the away team the rest when the teams swap", async () => {
    const s = fixture.snapshots.find((x) => x.label === "decision")!;
    const home = await control(metres(s.home), metres(s.away));
    const away = await control(metres(s.away), metres(s.home));
    const worst = Math.max(...home.map((p, k) => Math.abs(p + away[k] - 1)));
    expect(worst).toBeLessThan(1e-5);
  });

  it("compiles and draws without a WebGL error or warning", () => {
    expect(pageErrors).toEqual([]);
  });
});

describe("the board's colour ramp on the GPU", () => {
  const s = fixture.snapshots.find((x) => x.label === "decision")!;
  const p = s.control.map((v) => v / 1e4);
  const rgb = (k: number, px: number[]) => px.slice(4 * k, 4 * k + 3);
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Saturated cells away from the frontier: the line is not drawn there.
  const deep = (owner: (q: number) => boolean) =>
    p.flatMap((q, k) => {
      const x = k % nx;
      const y = Math.floor(k / nx);
      if (x < 2 || y < 2 || x > nx - 3 || y > ny - 3) return [];
      const near = [-2, -1, 1, 2].flatMap((d) => [p[k + d], p[k + d * nx]]);
      return [q, ...near].every(owner) ? [k] : [];
    });

  it("tints each team's space with its colour over the pitch green", async () => {
    const { pixels, background } = await overlay(metres(s.home), metres(s.away));
    for (const [cells, color] of [
      [deep((q) => q > 0.999), COLORS.home],
      [deep((q) => q < 0.001), COLORS.away],
    ] as const) {
      expect(cells.length).toBeGreaterThan(100);
      const want = hex(color).map((c, i) => OPACITY * c + (1 - OPACITY) * background[i]);
      for (const k of cells) {
        rgb(k, pixels).forEach((got, i) => expect(Math.abs(got - want[i])).toBeLessThanOrEqual(2));
      }
    }
  });

  it("draws a light line on the frontier, where control passes one half", async () => {
    const { pixels } = await overlay(metres(s.home), metres(s.away));
    const tint = Math.max(...[COLORS.home, COLORS.away].map((c) => luma(hex(c))));
    const closest: number[] = []; // per crossing of 1/2 between two neighbours, the nearer cell
    for (let k = 0; k < p.length; k++) {
      for (const j of [k + 1, k + nx]) {
        if ((j === k + 1 && j % nx === 0) || j >= p.length) continue;
        if ((p[k] - 0.5) * (p[j] - 0.5) < 0) {
          closest.push(Math.abs(p[k] - 0.5) < Math.abs(p[j] - 0.5) ? k : j);
        }
      }
    }
    expect(closest.length).toBeGreaterThan(20);
    const lit = closest.filter((k) => luma(rgb(k, pixels)) > tint);
    expect(lit.length / closest.length).toBeGreaterThan(0.9);
  });
});
