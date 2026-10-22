// @vitest-environment happy-dom
// His live belief map (teammates' feedback 2026-10-21): the bottom-left disc beside his eyes shows
// where he believes everyone is, frame by frame, so each scan visibly corrects it. The defenders
// nearest the ball carrier (in his belief) are red, his likeliest receivers at his decision green,
// everyone else neutral; players out of his sight right now are drawn as remembered.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { isSeen, parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type ViewSession } from "../session";
import { BeliefMap, beliefAt, beliefPip, LIKELY_MIN_PROB } from "./BeliefMap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const n = hero.n;
const H8 = hero.ids.indexOf("H8");
const H9 = hero.ids.indexOf("H9");
const role = (b: ReturnType<typeof beliefAt>, id: string) =>
  b!.players.find((p) => p.id === id)?.role;

/** Where he believes player j is at frame f, read straight from the export's ghost array. */
function believed(mode: "factual" | "counterfactual", f: number, j: number): [number, number] {
  const g = hero.runs[mode].ghost;
  return [g[(f * n + j) * 2], g[(f * n + j) * 2 + 1]];
}
function truth(mode: "factual" | "counterfactual", f: number, j: number): [number, number] {
  const p = hero.runs[mode].pos;
  return [p[(f * n + j) * 2], p[(f * n + j) * 2 + 1]];
}

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(session: ViewSession) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <BeliefMap />
      </SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return container;
}

describe("his belief, frame by frame", () => {
  it("puts each player where he believes him, and his own dot where he is", () => {
    const b = beliefAt(hero, "factual", 70)!;
    for (const p of b.players) {
      const j = hero.ids.indexOf(p.id);
      expect([p.x, p.y]).toEqual(believed("factual", 70, j));
    }
    expect([b.me.x, b.me.y]).toEqual(truth("factual", 70, H8));
    expect(b.players.some((p) => p.id === "H8")).toBe(false);
  });

  it("is corrected by his scan: with the look he knows where H9 is, without it he does not", () => {
    const err = (mode: "factual" | "counterfactual", f: number) => {
      const p = beliefAt(hero, mode, f)!.players.find((q) => q.id === "H9")!;
      const t = truth(mode, f, H9);
      return Math.hypot(p.x - t[0], p.y - t[1]);
    };
    expect(err("factual", 55)).toBeGreaterThan(5); // before the look reaches him
    expect(err("factual", 70)).toBeLessThan(1); // after it
    expect(err("counterfactual", 70)).toBeGreaterThan(8); // the run without it
  });

  it("marks who he sees right now, the rest as remembered", () => {
    for (const f of [40, 62, 70]) {
      for (const p of beliefAt(hero, "factual", f)!.players) {
        const j = hero.ids.indexOf(p.id);
        expect(p.seen).toBe(isSeen(hero, hero.runs.factual, f, H8, j));
      }
    }
  });

  it("reds the defenders nearest the carrier in his belief, two or three of them", () => {
    for (const mode of ["factual", "counterfactual"] as const) {
      const b = beliefAt(hero, mode, 70)!;
      expect(b.carrier).toBe("H8");
      const red = b.players.filter((p) => p.role === "press");
      expect(red.length).toBeGreaterThanOrEqual(2);
      expect(red.length).toBeLessThanOrEqual(3);
      const team = (id: string) => hero.players.find((p) => p.id === id)!.team;
      expect(red.every((p) => team(p.id) === 1)).toBe(true);
      // Nearer to him than every opponent left neutral.
      const d = (p: { x: number; y: number }) => Math.hypot(p.x - b.me.x, p.y - b.me.y);
      const farthestRed = Math.max(...red.map(d));
      for (const p of b.players.filter((q) => team(q.id) === 1 && q.role !== "press"))
        expect(d(p)).toBeGreaterThanOrEqual(farthestRed);
    }
  });

  it("greens his likeliest receivers at his decision: H9 with the look, H4 without it", () => {
    expect(LIKELY_MIN_PROB).toBe(0.05);
    const withLook = beliefAt(hero, "factual", 70)!;
    expect(withLook.players.filter((p) => p.role === "option").map((p) => p.id)).toEqual(["H9"]);
    const without = beliefAt(hero, "counterfactual", 70)!;
    const green = without.players.filter((p) => p.role === "option").map((p) => p.id);
    expect(green).toContain("H4"); // his likeliest without the look (0.27), then H1 and H5
    expect(green.length).toBeGreaterThanOrEqual(2);
    expect(green.length).toBeLessThanOrEqual(3);
    expect(green).not.toContain("H9");
    expect(role(withLook, "A1")).toBe("other");
  });

  it("is drawn attacking up: a player ahead of him is above him on the disc", () => {
    const b = beliefAt(hero, "factual", 70)!;
    const ahead = b.players.find((p) => p.x - b.me.x > 10 && Math.abs(p.y - b.me.y) < 10)!;
    expect(ahead).toBeDefined();
    const s = b.toDisc(ahead.x, ahead.y);
    const me = b.toDisc(b.me.x, b.me.y);
    expect(s.y).toBeLessThan(me.y);
    // +y is his left when he attacks +x: to the left on the disc.
    const left = b.toDisc(b.me.x, b.me.y + 10);
    expect(left.x).toBeLessThan(me.x);
  });
});

describe("the disc", () => {
  it("draws his picture, labelled as the sim's", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    act(() => session.controls.seek(70));
    const page = mount(session);
    const svg = page.querySelector("svg[role=img]")!;
    // Players by their fictional names (SPEC 4.6), in the label and each token's title.
    expect(svg.getAttribute("aria-label")).toMatch(/^J\. Ferriday's picture of the pitch/);
    expect(svg.getAttribute("aria-label")).not.toMatch(/(?<![A-Za-z0-9_:])[HA](?:1[01]|[1-9])\b/);
    const titles = [...page.querySelectorAll("svg title")].map((t) => t.textContent ?? "");
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((t) => /^[A-Z]\. [A-Z][a-z]+$/.test(t))).toBe(true);
    expect(page.querySelectorAll("circle.token.press").length).toBeGreaterThanOrEqual(2);
    expect(page.querySelectorAll("circle.token.option")).toHaveLength(1);
    expect(page.textContent).toContain("His picture");
    expect(page.querySelector(".source")?.textContent).toBe("sim");
    act(() => session.controls.setMode("counterfactual"));
    expect(page.querySelectorAll("circle.token.option").length).toBeGreaterThanOrEqual(2);
    // Everyone is on the disc: beyond its reach, on its rim.
    const r = (c: Element) =>
      Math.hypot(Number(c.getAttribute("cx")) - 84, Number(c.getAttribute("cy")) - 84);
    const tokens = [...page.querySelectorAll("circle.token")];
    expect(tokens).toHaveLength(21);
    expect(Math.max(...tokens.map(r))).toBeLessThanOrEqual(84 - 6 + 1e-6);
    expect(page.querySelectorAll("circle.token.rim").length).toBeGreaterThan(0);
  });

  it("rides along with his eyes on a hero moment only", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    expect(beliefPip(session, "pov")).toBe(true);
    expect(beliefPip(session, "broadcast")).toBe(false);
    const match = { ...session, kind: "match" } as unknown as ViewSession;
    expect(beliefPip(match, "pov")).toBe(false);
  });
});
