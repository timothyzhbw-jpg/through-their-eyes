// Personalized viewing (SPEC 7): what following does to the order of moments, the address's
// round trip, storage that is missing or throws, and the one-line summary.

import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../deeplink";
import { parseHero } from "../data/hero";
import { exportJson, matchExport } from "../testing";
import { MOMENT_LINKS } from "../moments/moments";
import {
  isMode,
  MODES,
  MORE_PERSONAS,
  NO_CHOICES,
  parsePlayer,
  parseTeam,
  playerOptions,
  type Choices,
} from "./follow";
import {
  audienceFor,
  browserStorage,
  mergeChoices,
  readSaved,
  searchWith,
  STORAGE_KEY,
  writeAddress,
  writeSaved,
} from "./persist";
import {
  followedIndex,
  involvedCount,
  involvementByScenario,
  involvementOf,
  linkTier,
  momentWho,
  NOBODY,
  rankBy,
  tierOf,
} from "./rank";
import { createPersonal, persistOnChange } from "./state";
import { followingText, yourView } from "./summary";

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};
const broken = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("quota", "QuotaExceededError");
  },
  removeItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
};

describe("the two modes and More", () => {
  it("maps Casual fan and Tactical analyst onto casual and analyst, the rest under More", () => {
    expect(MODES.map((m) => [m.label, m.persona])).toEqual([
      ["Casual fan", "casual"],
      ["Tactical analyst", "analyst"],
    ]);
    expect([...MORE_PERSONAS].sort()).toEqual(["audio_description", "coach", "player_fan"]);
    expect(isMode("analyst")).toBe(true);
    expect(isMode("coach")).toBe(false);
  });
});

describe("what a value can name", () => {
  it("reads a club by its code in any case and a player by roster id", () => {
    expect(parseTeam("KES")).toBe(0);
    expect(parseTeam("cor")).toBe(1);
    expect(parseTeam("ARS")).toBeNull();
    expect(parseTeam("")).toBeNull();
    expect(parsePlayer("h8")).toBe("H8");
    expect(parsePlayer("A11")).toBe("A11");
    expect(parsePlayer("H12")).toBeNull();
    expect(parsePlayer("__proto__")).toBeNull();
    expect(parsePlayer("toString")).toBeNull();
  });
  it("lists both line-ups by shirt number, home first", () => {
    const options = playerOptions(exportJson.players);
    expect(options).toHaveLength(exportJson.players.length);
    expect(options[0]).toMatchObject({ team: 0, number: 1 });
    expect(options[11]).toMatchObject({ team: 1, number: 1 });
  });
});

describe("filtering: the followed first", () => {
  const items = [
    { id: "a", who: involvementOf(["A3"]) },
    { id: "b", who: involvementOf(["H8", "H9"]) },
    { id: "c", who: involvementOf(["H2"]) },
    { id: "d", who: NOBODY },
    { id: "e", who: involvementOf(["H8"]) },
  ];
  const order = (follow: Parameters<typeof tierOf>[0]) =>
    rankBy(items, (i) => tierOf(follow, i.who)).map((i) => i.id);

  it("keeps the given order when nobody is followed", () => {
    expect(order({ team: null, player: null })).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("puts the followed player's moments first, then the club's, then the rest", () => {
    expect(order({ team: 0, player: "H8" })).toEqual(["b", "e", "c", "a", "d"]);
  });
  it("a club alone lifts every moment with one of its players, in order", () => {
    expect(order({ team: 1, player: null })).toEqual(["a", "b", "c", "d", "e"]);
    expect(order({ team: 0, player: null })).toEqual(["b", "c", "e", "a", "d"]);
  });
  it("a player alone lifts their moments", () => {
    expect(order({ team: null, player: "H2" })).toEqual(["c", "a", "b", "d", "e"]);
  });
  it("the whole match ranks with the followed club's once anything is followed", () => {
    expect(tierOf({ team: null, player: null }, NOBODY, true)).toBe(2);
    expect(tierOf({ team: 1, player: null }, NOBODY, true)).toBe(1);
  });
  it("counts the moments that involve them", () => {
    expect(
      involvedCount(
        { team: 0, player: "H8" },
        items.map((i) => i.who),
      ),
    ).toBe(3);
  });
  it("reads a match moment's actor and receiver", () => {
    const who = momentWho({ actor: "A4", receiver: null });
    expect(who.players.has("A4")).toBe(true);
    expect(who.teams.has(1)).toBe(true);
  });
});

describe("involvement from the export in memory", () => {
  it("a hero moment shows its hero and runner", () => {
    const hero = parseHero(exportJson);
    const byScenario = involvementByScenario(hero);
    expect([...byScenario.keys()]).toEqual([hero.scenario]);
    const who = byScenario.get(hero.scenario)!;
    expect(who.players.has(hero.heroId!)).toBe(true);
    expect(who.players.has(hero.runnerId!)).toBe(true);
  });
  it("a match shows each scenario's possession hero and the moments' players", () => {
    const hero = parseHero(matchExport());
    const byScenario = involvementByScenario(hero);
    expect(byScenario.get("blind_side_run")!.players.has("H8")).toBe(true);
    expect(byScenario.get("press_escape")!.teams.has(0)).toBe(true);
  });
  it("on a hero page the full-match link is not lifted: its players are not known", () => {
    const hero = parseHero(exportJson);
    expect(hero.match).toBeFalsy();
    const byScenario = involvementByScenario(hero);
    const follow = { team: 0 as const, player: "H8" };
    expect(linkTier(follow, null, byScenario, Boolean(hero.match))).toBe(2);
    expect(linkTier(follow, null, byScenario, true)).toBe(1);
    const ranked = rankBy(MOMENT_LINKS, (l) =>
      linkTier(follow, l.scenario, byScenario, Boolean(hero.match)),
    );
    const full = MOMENT_LINKS.findIndex((l) => l.scenario === null);
    expect(ranked.map((l) => l.id).indexOf(MOMENT_LINKS[full]!.id)).toBeGreaterThanOrEqual(full);
  });
  it("lifts the rail's links for a followed player and keeps the rest in place", () => {
    const hero = parseHero(matchExport());
    const byScenario = involvementByScenario(hero);
    const ranked = rankBy(MOMENT_LINKS, (l) =>
      linkTier({ team: null, player: "H8" }, l.scenario, byScenario, true),
    );
    const ids = ranked.map((l) => l.id);
    // H8 is the hero of the look and of the pressure; the corner and the goal are not in this
    // fixture, so they keep their order after those two, with the full match among them.
    expect(ids.slice(0, 2)).toEqual(["look", "pressure"]);
    expect(ids).toHaveLength(MOMENT_LINKS.length);
    expect(new Set(ids).size).toBe(MOMENT_LINKS.length);
  });
});

describe("what the page asks for", () => {
  const link: Choices = { ...NO_CHOICES, persona: null, language: null };
  const saved: Choices = { ...NO_CHOICES, persona: "coach", language: "zh" };
  it("online it is the address over what was saved", () => {
    const merged = mergeChoices(link, saved);
    expect(audienceFor(link, merged, false)).toEqual({ persona: "coach", language: "zh" });
  });
  it("offline a saved audience or language is not asked for", () => {
    const merged = mergeChoices(link, saved);
    expect(audienceFor(link, merged, true)).toEqual({ persona: null, language: null });
    const withLink: Choices = { ...link, persona: "analyst" };
    expect(audienceFor(withLink, mergeChoices(withLink, saved), true)).toEqual({
      persona: "analyst",
      language: null,
    });
  });
});

describe("the ring under the followed player", () => {
  // PovView and TacticalView draw one mint ring where `j === useFollowedIndex(hero.ids)`, so the
  // index is what decides it (the scenes themselves need WebGL; web smoke loads them).
  const ids = parseHero(exportJson).ids;
  const indexOf = (player: string | null) => followedIndex(player, ids);
  it("is the followed player's index, once", () => {
    const j = indexOf(ids[3]!);
    expect(j).toBe(3);
    expect(ids.filter((_, i) => i === j)).toHaveLength(1);
  });
  it("is none when nobody is followed or the id is not in this export", () => {
    expect(indexOf(null)).toBe(-1);
    expect(indexOf("Z99")).toBe(-1);
  });
});

describe("the address", () => {
  it("round-trips the four choices through the query string and deeplink.ts", () => {
    const choices: Choices = { persona: "analyst", language: "zh", team: 1, player: "H8" };
    const search = searchWith("?intro=0&view=tactical", choices);
    const link = parseDeepLink(search);
    expect(link).toMatchObject({ persona: "analyst", language: "zh", team: 1, player: "H8" });
    expect(link.view).toBe("tactical");
    expect(link.intro).toBe(false);
    expect(link.warnings).toEqual([]);
    expect(search).toContain("team=COR");
  });
  it("drops what is no longer chosen and keeps the other parameters", () => {
    const search = searchWith("?team=KES&player=H8&match=match-1", NO_CHOICES);
    expect(search).toBe("?match=match-1");
    expect(searchWith("", NO_CHOICES)).toBe("");
  });
  it("is not a link to a spot: following does not skip the intro or stop the autoplay", () => {
    const link = parseDeepLink("?team=KES&player=H8&persona=coach&lang=zh");
    expect(link.intro).toBe(true);
    expect(link.autoplay).toBe(true);
  });
  it("warns about, and ignores, values it does not know", () => {
    const link = parseDeepLink("?team=XXX&player=Z9");
    expect(link.team).toBeNull();
    expect(link.player).toBeNull();
    expect(link.warnings).toEqual(["team=XXX", "player=Z9"]);
  });
  it("replaces the address without a page load, and survives a browser that refuses", () => {
    const calls: string[] = [];
    const win = {
      location: { pathname: "/app/", search: "?intro=0", hash: "#moment" },
      history: {
        state: null,
        replaceState: (_s: unknown, _t: string, url: string) => calls.push(url),
      },
    } as unknown as Pick<Window, "location" | "history">;
    expect(writeAddress({ ...NO_CHOICES, team: 0 }, win)).toBe(true);
    expect(calls).toEqual(["/app/?intro=0&team=KES#moment"]);
    const refusing = {
      location: win.location,
      history: {
        state: null,
        replaceState: () => {
          throw new DOMException("too many calls", "SecurityError");
        },
      },
    } as unknown as Pick<Window, "location" | "history">;
    expect(writeAddress({ ...NO_CHOICES, team: 1 }, refusing)).toBe(false);
  });
});

describe("localStorage", () => {
  const choices: Choices = { persona: "coach", language: "en", team: 0, player: "A9" };
  it("round-trips the choices", () => {
    const s = memory();
    expect(writeSaved(choices, s)).toBe(true);
    expect(readSaved(s)).toEqual(choices);
  });
  it("starts with nothing chosen when nothing is saved or the value is not ours", () => {
    expect(readSaved(memory())).toEqual(NO_CHOICES);
    const s = memory();
    s.data.set(STORAGE_KEY, "not json {");
    expect(readSaved(s)).toEqual(NO_CHOICES);
    s.data.set(STORAGE_KEY, JSON.stringify({ persona: "villain", team: "ZZZ", player: 7 }));
    expect(readSaved(s)).toEqual(NO_CHOICES);
    s.data.set(STORAGE_KEY, "null");
    expect(readSaved(s)).toEqual(NO_CHOICES);
  });
  it("fails soft when storage throws on read, on write, or is missing", () => {
    expect(readSaved(broken)).toEqual(NO_CHOICES);
    expect(writeSaved(choices, broken)).toBe(false);
    expect(writeSaved(choices, null)).toBe(false);
    expect(readSaved(null)).toEqual(NO_CHOICES);
  });
  it("is null where reaching localStorage itself throws", () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      expect(browserStorage()).toBeNull();
      expect(readSaved()).toEqual(NO_CHOICES);
      expect(writeSaved(choices)).toBe(false);
    } finally {
      if (desc) Object.defineProperty(globalThis, "localStorage", desc);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
  it("the address wins over storage, field by field", () => {
    const link: Choices = { persona: null, language: "zh", team: null, player: "H2" };
    expect(mergeChoices(link, choices)).toEqual({
      persona: "coach",
      language: "zh",
      team: 0,
      player: "H2",
    });
  });
});

describe("saving on every change", () => {
  it("writes once per change and not for a change that changes nothing", () => {
    const store = createPersonal();
    const written: Choices[] = [];
    const stop = persistOnChange(store, (c) => written.push(c));
    store.set({ team: 1 });
    store.set({ team: 1 });
    store.set({ player: "A5", persona: "analyst" });
    stop();
    store.set({ player: null });
    expect(written).toEqual([
      { ...NO_CHOICES, team: 1 },
      { persona: "analyst", language: null, team: 1, player: "A5" },
    ]);
  });
});

describe("the Your view line", () => {
  it("says who it is for and that nobody is followed yet", () => {
    expect(
      yourView({ persona: "casual", language: "en", follow: NO_CHOICES, involved: 0, total: 4 }),
    ).toBe("Your view: Casual fan · English · following nobody yet");
  });
  it("names the club and the player and counts their moments", () => {
    const line = yourView({
      persona: "analyst",
      language: "zh",
      follow: { team: 0, player: "H8" },
      involved: 3,
      total: 12,
    });
    expect(line).toBe(
      "Your view: Tactical analyst · 中文 · following Kestrel Bay and J. Ferriday · 3 of 12 moments in reach involve them",
    );
  });
  it("says so when none of the moments in reach involve them", () => {
    expect(
      yourView({
        persona: "coach",
        language: "en",
        follow: { team: 1, player: null },
        involved: 0,
        total: 1,
      }),
    ).toBe(
      "Your view: Coach · English · following Corvane Vale · none of the moments in reach involve them",
    );
    expect(followingText(NO_CHOICES)).toBeNull();
  });
});
