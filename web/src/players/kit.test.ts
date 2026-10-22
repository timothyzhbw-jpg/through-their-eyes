// Kits (SPEC 7): each keeper wears his own kit (the trailer's look-dev), every other player his
// team's, and the keepers' colours stay clear of both teams, the pitch and the reserved data
// colours.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import { parseHero } from "../data/hero";
import type { ExportPlayer } from "../data/types";
import { ALERT_COLOR } from "../alerts/blindSide";
import { DETECTOR_COLOR } from "../skeleton/skeleton";
import { COLORS } from "../views/scene";
import { ALL_KITS, GK_KITS, KITS, type Kit, isKeeper, kitOf, kitSlot, paintDesign } from "./kit";

const hero = parseHero(raw);
const FLOODLIGHT = "#f6d566"; // --floodlight in styles.css
const PITCH = ["#1f4a32", "#245638", "#173826"]; // the mowing stripes and the grass around them

const player = (team: 0 | 1, role: string): Pick<ExportPlayer, "team" | "role"> => ({
  team,
  role,
});

/** CIE 1976 colour difference in L*a*b* (D65): about 2 is just noticeable. */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const lin = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const [r, g, bl] = lin;
    const xyz = [
      (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047,
      0.2126 * r + 0.7152 * g + 0.0722 * bl,
      (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883,
    ].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
    return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

describe("kit lookup", () => {
  it("dresses a keeper in his team's keeper kit and everyone else in the team kit", () => {
    for (const team of [0, 1] as const) {
      expect(kitOf(player(team, "GK"))).toBe(GK_KITS[team]);
      for (const role of ["CB", "FB", "DM", "CM", "AM", "W", "ST"])
        expect(kitOf(player(team, role))).toBe(KITS[team]);
    }
  });

  it("gives the four kits four slots, and kitOf reads its slot", () => {
    const players = [0, 1].flatMap((t) => ["GK", "CB"].map((r) => player(t as 0 | 1, r)));
    expect(new Set(players.map(kitSlot))).toEqual(new Set([0, 1, 2, 3]));
    for (const p of players) expect(ALL_KITS[kitSlot(p)]).toBe(kitOf(p));
  });

  it("finds one keeper per team in the hero export: H1 and A1", () => {
    const keepers = hero.players.filter(isKeeper);
    expect(keepers.map((p) => p.id)).toEqual(["H1", "A1"]);
    expect(keepers.map((p) => kitOf(p).shirt)).toEqual(["#2ec4b6", "#c062e8"]);
    for (const p of hero.players.filter((q) => !isKeeper(q)))
      expect(kitOf(p).shirt).toBe(p.team === 0 ? COLORS.home : COLORS.away);
  });

  it("keeps the keepers' shirts clear of the teams, each other, the pitch and the data colours", () => {
    const reserved = [FLOODLIGHT, DETECTOR_COLOR, ALERT_COLOR, COLORS.sight, COLORS.gold];
    for (const [team, gk] of GK_KITS.entries()) {
      const near = [...KITS.map((k) => k.shirt), GK_KITS[1 - team].shirt, ...PITCH, ...reserved];
      for (const c of near) expect(deltaE(gk.shirt, c), `${gk.shirt} vs ${c}`).toBeGreaterThan(30);
    }
  });
});

describe("kit design (v2 look)", () => {
  const SIZE = 100;
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  /** Paint one kit over its plain colours with one mask channel set at (u, v); read it back. */
  function paintAt(kit: Kit, u: number, v: number, channel: 0 | 1 | 2, under: string): number[] {
    const base = new Uint8ClampedArray(SIZE * SIZE * 4);
    const mask = new Uint8ClampedArray(SIZE * SIZE * 4);
    const i = 4 * (Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE));
    base.set([...hex(under), 255], i);
    mask[i + channel] = 255;
    paintDesign(base, mask, SIZE, kit);
    return Array.from(base.subarray(i, i + 3));
  }
  const [home, away] = KITS;

  it("colours the side panels on the shirt and on the shorts separately", () => {
    expect(paintAt(home, 0.25, 0.3, 0, home.shirt)).toEqual(hex(home.panel[0]!));
    expect(paintAt(home, 0.2, 0.5, 0, home.shorts)).toEqual(hex(home.panel[1]!));
    expect(paintAt(away, 0.25, 0.3, 0, away.shirt)).toEqual(hex(away.shirt)); // no shirt panel
  });

  it("colours the raglan only where the kit has one", () => {
    expect(paintAt(away, 0.25, 0.1, 1, away.shirt)).toEqual(hex(away.raglan!));
    expect(paintAt(home, 0.25, 0.1, 1, home.shirt)).toEqual(hex(home.shirt));
  });

  it("trims the cuffs of outfield players, not the keepers' (their long sleeves go on)", () => {
    expect(paintAt(home, 0.03, 0.05, 2, home.shirt)).toEqual(hex(home.trim));
    for (const gk of GK_KITS) {
      expect(paintAt(gk, 0.03, 0.05, 2, gk.raglan!)).toEqual(hex(gk.raglan!));
      expect(paintAt(gk, 0.25, 0.01, 2, gk.shirt)).toEqual(hex(gk.trim)); // the collar
    }
  });

  it("dresses only the keepers in long sleeves and gloves", () => {
    for (const k of KITS) expect([k.sleeve, k.glove]).toEqual([undefined, undefined]);
    for (const k of GK_KITS) expect(k.sleeve && k.glove).toBeTruthy();
  });

  it("keeps every design colour clear of the reserved data colours", () => {
    const reserved = [FLOODLIGHT, DETECTOR_COLOR, ALERT_COLOR];
    for (const k of ALL_KITS) {
      const used = [k.panel[0], k.panel[1], k.raglan, k.sleeve, k.glove].filter(
        (c): c is string => !!c,
      );
      for (const c of used)
        for (const r of reserved) expect(deltaE(c, r), `${c} vs ${r}`).toBeGreaterThan(30);
    }
  });
});
