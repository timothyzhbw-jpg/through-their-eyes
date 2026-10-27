// @vitest-environment happy-dom
// xT told concretely per persona (xtexplain/): the zones named plainly, the right version for the
// chosen persona on every surface that explains xT, the from and to cells on the board, and no
// digit that is not a value passed in (a grid cell or a verified claim).

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import bundle from "../../public/data/without_look_seed3.json";
import { PERSONAS, type Persona } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { fakeFetch, json } from "../testing";
import { TacticsLabPanel } from "../tacticslab/TacticsLab";
import { buildCards } from "../tacticslab/cards";
import { NO_SCOPE } from "../tacticslab/scope";
import { parseXtGrid } from "../tacticslab/metrics";
import { withoutLookOf } from "../without/without";
import { WithoutLookLines } from "../without/WithoutLook";
import { lookWorthMove, passMoves } from "./moves";
import { cellBox, unionOf, xtCells } from "./XtCellsLayer";
import { XtClaimNote, XtMoveExplain } from "./XtMoveExplain";
import {
  COMPONENTS_LIMIT,
  moveOf,
  plainLine,
  valuesLine,
  versionFor,
  whereLine,
  zoneAt,
  zoneName,
  type Move,
} from "./zones";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const grid = parseXtGrid(bundle.xt);
const matchScope = { ...NO_SCOPE, match: hero };
const SIZE = { cols: 16, rows: 12 };

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  xtCells.set({ byId: new Map() });
  vi.unstubAllGlobals();
});

const cellsNow = () => unionOf(xtCells.get().byId);

function mount(session: Session, node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
const session = () => createSession(hero, EXAMPLE_PLAN, payloadJson);

/** A move between two spots on the grid, for the home team. */
const home = (from: [number, number], to: [number, number]): Move =>
  moveOf({ mode: "pass", team: 0, from, to, grid });

describe("zone naming", () => {
  it("names the band and the lane as a coach would", () => {
    expect(zoneAt([-30, 0], 0, SIZE)).toMatchObject({ band: "own_third", lane: "centre" });
    expect(zoneAt([-10, 0], 0, SIZE)).toMatchObject({ band: "own_half", lane: "centre" });
    expect(zoneAt([10, 0], 0, SIZE)).toMatchObject({ band: "opponents_half" });
    expect(zoneAt([40, -10], 0, SIZE)).toMatchObject({
      band: "final_third",
      lane: "right_of_centre",
    });
    expect(zoneAt([40, 25], 0, SIZE)).toMatchObject({ lane: "left_wing" });
    expect(zoneAt([40, 10], 0, SIZE)).toMatchObject({ lane: "left_of_centre" });
    expect(zoneAt([40, -25], 0, SIZE)).toMatchObject({ lane: "right_wing" });
  });

  it("is the attacking frame: the away team's right is the other touchline", () => {
    // The away team attacks -x: a point at x = 40 is deep in its own end, and y = +10 is its right.
    expect(zoneAt([40, 10], 1, SIZE)).toMatchObject({
      band: "own_third",
      lane: "right_of_centre",
    });
    expect(zoneAt([-40, 10], 1, SIZE)).toMatchObject({ band: "final_third" });
  });

  it("puts a point in the grid cell the xT file would, corners and middle included", () => {
    expect(zoneAt([-52.5, -34], 0, SIZE)).toMatchObject({ col: 0, row: 0 });
    expect(zoneAt([52.5, 34], 0, SIZE)).toMatchObject({ col: 15, row: 11 });
    expect(zoneAt([0.01, 0.01], 0, SIZE)).toMatchObject({ col: 8, row: 6 });
  });

  it("says it in words", () => {
    const m = home([-10, 0], [40, -10]);
    expect(zoneName(m.from.zone, "his")).toBe("his own half, central");
    expect(whereLine(m, "his")).toBe(
      "From his own half, central, into the attacking third, right half-space.",
    );
    expect(whereLine(home([-30, 0], [-28, 0]), "their")).toBe("Within their own third, central.");
  });

  it("agrees with the verified pass_zones claim on the bundled moment", () => {
    const claim = bundle.answers.en.claims.find((c) => c.id === "pass_zones")!.values as Record<
      string,
      string
    >;
    const [mine, other] = passMoves(hero, grid);
    expect([mine.to.zone.band, mine.to.zone.lane]).toEqual([claim.band, claim.lane]);
    expect([other.to.zone.band, other.to.zone.lane]).toEqual([claim.cf_band, claim.cf_lane]);
  });
});

describe("the version per persona", () => {
  it("is plain for the casual fan and concrete for analyst and coach", () => {
    expect(versionFor("casual")).toBe("plain");
    expect(versionFor("analyst")).toBe("concrete");
    expect(versionFor("coach")).toBe("concrete");
    for (const p of PERSONAS) expect(["plain", "concrete"]).toContain(versionFor(p));
  });

  it("renders the plain sentence for casual: no jargon, no digit", () => {
    const m = home([-30, 0], [40, -10]);
    const page = mount(session(), <XtMoveExplain moves={[m]} owner="his" persona="casual" />);
    const el = page.querySelector("[data-xt-version]")!;
    expect(el.getAttribute("data-xt-version")).toBe("plain");
    expect(text(el)).toBe(
      "The ball moved from deep in its own end to near the goal, so a shot from closer became possible, and that is more threat.",
    );
    expect(text(el)).not.toMatch(/\d|xT|expected|zone|grid|half-space/i);
  });

  it("renders the zones and their values for analyst and coach", () => {
    const m = home([-10, 0], [40, -10]);
    for (const persona of ["analyst", "coach"] as Persona[]) {
      const page = mount(session(), <XtMoveExplain moves={[m]} owner="his" persona={persona} />);
      const el = page.querySelector("[data-xt-version]")!;
      expect(el.getAttribute("data-xt-version")).toBe("concrete");
      expect(text(el)).toContain(
        "From his own half, central, into the attacking third, right half-space.",
      );
      expect(text(el)).toContain(valuesLine(m)!);
      expect(text(el)).toContain(COMPONENTS_LIMIT);
    }
  });

  it("follows the persona the session has chosen", () => {
    const s = session();
    const m = home([-30, 0], [40, -10]);
    const page = mount(s, <XtMoveExplain moves={[m]} owner="his" />);
    expect(page.querySelector("[data-xt-version]")!.getAttribute("data-xt-version")).toBe("plain");
    act(() => s.breakdown.set({ persona: "analyst" }));
    expect(page.querySelector("[data-xt-version]")!.getAttribute("data-xt-version")).toBe(
      "concrete",
    );
  });

  it("never contradicts itself: the threat and the effect come from one sign", () => {
    // Into a lower band, but the value rose: the effect clause is left out, the sign is the delta's.
    const odd = moveOf({ mode: "pass", team: 0, from: [40, 0], to: [-30, 0], delta: 0.05 });
    expect(plainLine(odd)).toBe(
      "The ball moved from near the goal to deep in its own end, and that is more threat.",
    );
    const odd2 = moveOf({ mode: "runs", team: 0, from: [-30, 0], to: [40, 0], delta: -0.05 });
    expect(plainLine(odd2)).toBe(
      "With the scan the ball ended near the goal; without it, deep in its own end. That is less threat.",
    );
  });

  it("describes a pass that lost ground in the plain words, too", () => {
    expect(plainLine(home([40, 0], [-30, 0]))).toBe(
      "The ball moved from near the goal to deep in its own end, so a shot became harder to get, and that is less threat.",
    );
  });
});

describe("no hand-typed digits", () => {
  const moves = [
    home([-30, 0], [40, -10]),
    home([40, 0], [-30, 0]),
    home([-10, 0], [10, 5]),
    moveOf({ mode: "pass", team: 0, from: [-10, 0], to: [40, -10], grid, toXt: 0.157 }),
    moveOf({ mode: "runs", team: 0, from: [-10, 0], to: [40, -10], delta: 0.16, deltaDigits: 2 }),
  ];
  const digits = (s: string) => s.match(/\d+(\.\d+)?/g) ?? [];

  it("every number in the text is a value the move carries", () => {
    for (const m of moves) {
      const allowed = new Set<string>();
      for (const v of [m.from.xt, m.to.xt]) if (v !== null) allowed.add(v.toFixed(3));
      if (m.delta !== null) allowed.add(Math.abs(m.delta).toFixed(m.deltaDigits));
      const said = [whereLine(m, "his"), valuesLine(m) ?? "", plainLine(m), COMPONENTS_LIMIT];
      for (const n of said.flatMap(digits)) expect(allowed.has(n)).toBe(true);
      expect(digits(plainLine(m))).toEqual([]);
    }
  });

  it("the values are the grid's cells or the claim's, not a made-up number", () => {
    const [mine] = passMoves(hero, grid, { xt: 0.157, cfXt: 0.002 });
    expect(mine.to.xt).toBe(0.157);
    expect(valuesLine(mine)).toContain("at the end 0.157");
    expect(mine.from.xt).toBeGreaterThan(0);
    expect(mine.from.xt).toBeLessThan(Math.max(...grid.grid) + 1e-9);
  });

  it("says nothing about shot, goal or move parts: the grid export holds one value per cell", () => {
    expect(Object.keys(bundle.xt).sort()).toEqual(["cols", "fitted", "grid", "rows", "units"]);
    expect(valuesLine(moves[0])).not.toMatch(/shot probability|goal probability|move value/i);
  });
});

describe("the tactical board's cells", () => {
  it("light up for the concrete version only, and clear when it closes", () => {
    const m = home([-10, 0], [40, -10]);
    const plain = mount(session(), <XtMoveExplain moves={[m]} owner="his" persona="casual" />);
    expect(cellsNow()).toEqual([]);
    const s = session();
    const page = mount(s, <XtMoveExplain moves={[m]} owner="his" persona="analyst" />);
    const cells = cellsNow();
    expect(cells.map((c) => c.role)).toEqual(["from", "to"]);
    expect(cells[0]).toMatchObject({ col: m.from.zone.col, row: m.from.zone.row, sign: 1 });
    expect(cells[1]).toMatchObject({ col: m.to.zone.col, row: m.to.zone.row });
    expect(page.textContent).toContain("outlined");
    expect(plain.textContent).not.toContain("outlined");
    const mountedNow = mounted.find((x) => x.container === page)!;
    act(() => mountedNow.root.unmount());
    mounted.splice(mounted.indexOf(mountedNow), 1);
    expect(cellsNow()).toEqual([]);
  });

  it("two open at once keep their own cells: closing one leaves the other's", () => {
    const a = home([-10, 0], [40, -10]);
    const b = home([-30, 0], [10, 20]);
    const first = mount(session(), <XtMoveExplain moves={[a]} owner="his" persona="analyst" />);
    mount(session(), <XtMoveExplain moves={[b]} owner="his" persona="coach" />);
    expect(xtCells.get().byId.size).toBe(2);
    expect(cellsNow()).toHaveLength(4);
    const one = mounted.find((x) => x.container === first)!;
    act(() => one.root.unmount());
    mounted.splice(mounted.indexOf(one), 1);
    expect(cellsNow().map((c) => [c.col, c.row, c.role])).toEqual([
      [b.from.zone.col, b.from.zone.row, "from"],
      [b.to.zone.col, b.to.zone.row, "to"],
    ]);
  });

  it("a cell's box stays on the pitch, in the real grid, for both teams", () => {
    const g = parseXtGrid(bundle.xt);
    for (const sign of [1, -1] as const) {
      for (const [col, row] of [
        [0, 0],
        [g.cols - 1, g.rows - 1],
        [g.cols - 1, 0],
      ]) {
        const { cx, cy, w, h } = cellBox({ col, row, sign, role: "to" }, g.cols, g.rows);
        expect(Math.abs(cx) + w / 2).toBeLessThanOrEqual(52.5 + 1e-9);
        expect(Math.abs(cy) + h / 2).toBeLessThanOrEqual(34 + 1e-9);
      }
    }
  });

  it("a cell's box is where the grid puts it, turned for the team that attacks -x", () => {
    const [w, h] = [105 / 16, 68 / 12];
    expect(cellBox({ col: 0, row: 0, sign: 1, role: "from" })).toEqual({
      cx: -52.5 + w / 2,
      cy: -34 + h / 2,
      w,
      h,
    });
    const away = cellBox({ col: 0, row: 0, sign: -1, role: "from" });
    expect(away.cx).toBeCloseTo(52.5 - w / 2);
    expect(away.cy).toBeCloseTo(34 - h / 2);
  });
});

describe("where xT is explained", () => {
  async function loaded(persona: Persona): Promise<Session> {
    const s = session();
    const fetch = fakeFetch({ "GET /data/without_look_seed3.json": () => json(bundle) });
    await withoutLookOf(s, fetch, "/data/").load();
    act(() => s.breakdown.set({ persona }));
    return s;
  }

  it("the Without-the-look panel: plain for casual, the zones and both passes for the analyst", async () => {
    for (const [persona, version] of [
      ["casual", "plain"],
      ["analyst", "concrete"],
    ] as const) {
      const s = await loaded(persona);
      const page = mount(s, <WithoutLookLines />);
      act(() =>
        [...page.querySelectorAll("button")].find((b) => text(b) === "How xT works")!.click(),
      );
      const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
      const el = dialog.querySelector("[data-xt-version]")!;
      expect(el.getAttribute("data-xt-version")).toBe(version);
      if (version === "plain") {
        expect(text(dialog)).not.toMatch(/value iteration/);
      } else {
        expect(text(el)).toContain("His pass:");
        expect(text(el)).toContain("into the attacking third, right half-space");
        expect(text(el)).toContain("Without the scan:");
        expect(text(el)).toContain("at the end 0.157");
        expect(text(el)).toContain("at the end 0.002");
        expect(text(dialog)).toMatch(/value iteration/);
        expect(cellsNow().map((c) => c.role)).toEqual(["from", "to", "alt"]);
      }
      act(() => dialog.querySelector<HTMLElement>("button")!.click());
    }
  });

  const cfValue = (dxt: number) => ({
    id: "cf_value",
    kind: "counterfactual" as const,
    verdict: "supported" as const,
    values: { dxt },
    evidence: ["scan:H8:0050"],
  });

  it("the evidence card's cf_value: zones for the analyst, the claim's difference, no grid value", () => {
    const s = session();
    act(() => s.breakdown.set({ persona: "analyst" }));
    const page = mount(s, <XtClaimNote claim={cfValue(0.16)} />);
    const el = page.querySelector("[data-xt-version]")!;
    expect(el.getAttribute("data-xt-version")).toBe("concrete");
    expect(text(el)).toContain("Without the scan the ball ends in his own half, right half-space");
    expect(text(el)).toContain("The difference in value is +0.16.");
    expect(text(el)).not.toContain("at the end");
  });

  it("the evidence card's cf_value for the casual fan: one plain sentence, no digit", () => {
    const page = mount(session(), <XtClaimNote claim={cfValue(0.16)} />);
    const el = page.querySelector("[data-xt-version]")!;
    expect(el.getAttribute("data-xt-version")).toBe("plain");
    expect(text(el)).toBe(
      "With the scan the ball ended near the goal; without it, in its own half. So a shot from closer became possible, and that is more threat.",
    );
  });

  it("is only for cf_value, and only when the claim is supported", () => {
    const other = { ...cfValue(0.16), id: "cf_pass" };
    expect(mount(session(), <XtClaimNote claim={other} />).textContent).toBe("");
    const refuted = { ...cfValue(0.16), verdict: "refuted" as const };
    expect(mount(session(), <XtClaimNote claim={refuted} />).textContent).toBe("");
    expect(lookWorthMove(hero, 0.16)).toHaveLength(1);
  });

  it("the Tactics lab's build-up card carries the progression explanation, per persona", () => {
    const xt = parseXtGrid(bundle.xt);
    // The lab fetches its own copy of the grid too; answer it here so no request leaves the test.
    vi.stubGlobal("fetch", async () => json(bundle));
    for (const [persona, version] of [
      ["casual", "plain"],
      ["analyst", "concrete"],
    ] as const) {
      const s = session();
      s.breakdown.set({ persona });
      const page = mount(s, <TacticsLabPanel xt={xt} scope={matchScope} />);
      act(() =>
        [...page.querySelectorAll("button")]
          .find((b) => text(b) === "Possession play / breaking the press")!
          .click(),
      );
      const card = page.querySelector('[data-card="build_up"]')!;
      expect(card.querySelector("[data-xt-version]")!.getAttribute("data-xt-version")).toBe(
        version,
      );
    }
  });

  it("the best pass is told for the team it came from", () => {
    const card = buildCards(hero, grid, matchScope).find((c) => c.id === "build_up")!;
    expect(card.xtMove!.team).toBe(0);
    expect(card.xtMove!.label).toBe("Best pass (Home)");
  });

  it("the build-up card's best pass is a move between zones the card's numbers agree with", () => {
    const cards = buildCards(hero, grid, matchScope);
    const card = cards.find((c) => c.id === "build_up")!;
    expect(card.xtMove).toBeTruthy();
    const m = card.xtMove!;
    expect(m.delta).toBeCloseTo(m.to.xt! - m.from.xt!, 12);
    const best = card.metrics.find((x) => x.label === "Progression · xT gained")!.pro;
    expect(best).toContain(m.delta! >= 0 ? `+${m.delta!.toFixed(3)}` : "−");
    expect(card.xtMove).toEqual(
      buildCards(hero, grid, matchScope).find((c) => c.id === "build_up")!.xtMove,
    );
  });
});
