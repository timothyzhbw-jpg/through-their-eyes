import { describe, expect, it } from "vitest";
import { SCREEN_IDS } from "./formats";
import {
  assignScreens,
  commitAt,
  describeContent,
  sponsorSlots,
  EVENT_TYPES,
  FADE,
  fadeLevel,
  MIN_GAP_MS,
  programme,
  RULES,
  sponsorFor,
  transitions,
  type StudioEvent,
} from "./rules";
import { SPONSORS } from "./sponsors";
import { facts } from "./testing";

const events = programme(facts());
const byType = (type: StudioEvent["type"]) => events.find((e) => e.type === type)!;

/** An event of `type` with nothing behind it: no players, cards or still. */
const bare = (type: StudioEvent["type"]): StudioEvent => ({
  id: type,
  type,
  label: type,
  note: "",
  rehearsal: true,
  players: [],
  cards: [],
  still: null,
});

describe("the programme", () => {
  it("has one event of each type, built from the bundled files", () => {
    expect(events.map((e) => e.type)).toEqual([...EVENT_TYPES]);
    const look = byType("key-look");
    expect(look.rehearsal).toBe(false);
    expect(look.still?.hero).toBe("H8");
    expect(look.still?.pass?.receiver).toBe("H9");
    expect(look.cards.map((c) => c.figure)).toEqual(["0.8 s", "0.8 seconds"]);
    const goal = byType("goal");
    expect(goal.players.map((p) => p.id)).toEqual(["H9"]);
    expect(goal.cards[0].figure).toBe("0.4 s");
    expect(goal.cards[0].lines).toEqual([
      "N. Varnhall looked over his left shoulder 0.4 s before the ball reached him.",
    ]);
  });

  it("marks the events with no moment in the files as rehearsal cues, with no match facts", () => {
    for (const type of ["press-win", "corner"] as const) {
      const e = byType(type);
      expect(e.rehearsal).toBe(true);
      expect(e.note).toMatch(/^Rehearsal cue/);
      expect(e.cards).toEqual([]);
      expect(e.still).toBeNull();
    }
  });

  it("names, numbers and kits come from the export's roster", () => {
    const walk = byType("walk-out");
    expect(walk.players.map((p) => [p.id, p.name, p.number, p.club])).toEqual([
      ["H8", "Joss Ferriday", 8, "Kestrel Bay"],
      ["H9", "Nico Varnhall", 9, "Kestrel Bay"],
    ]);
    expect(walk.players[0].kit.shirt).toBe("#ff7a5c");
  });
});

describe("assignScreens", () => {
  it("fills every screen for every event, with a kind from its rule", () => {
    events.forEach((event, i) => {
      const a = assignScreens(event, i);
      for (const s of SCREEN_IDS) {
        expect([...RULES[event.type][s], "sponsor"]).toContain(a[s].kind);
      }
    });
  });

  it("takes the first kind in a screen's list that the event can fill", () => {
    const look = assignScreens(byType("key-look"), 1);
    expect(look.main.kind).toBe("tactical");
    expect(look.tunnel).toMatchObject({
      kind: "walkout",
      player: { id: "H8" },
      kicker: "THE LOOK",
    });
    expect(look.ribbon.kind).toBe("stat");
    expect(look["concourse-a"]).toMatchObject({ kind: "stat", key: "stat:stat:without:H8" });
    // Without a still, the key look's main board falls back to its stat card.
    const noStill = assignScreens({ ...byType("key-look"), still: null }, 1);
    expect(noStill.main.kind).toBe("stat");
  });

  it("puts the scorer, never a sponsor, on the goal's main board and tunnel", () => {
    const goal = assignScreens(byType("goal"), 4);
    expect(goal.main.kind).toBe("stat");
    expect(goal.tunnel).toMatchObject({ kind: "walkout", player: { id: "H9" }, kicker: "GOAL" });
    const noCard = assignScreens({ ...byType("goal"), cards: [] }, 4);
    expect(noCard.main).toMatchObject({ kind: "walkout", player: { id: "H9" } });
  });

  it("shows only sponsors and walk-outs for an event with nothing behind it", () => {
    for (const type of EVENT_TYPES) {
      const a = assignScreens(bare(type), 0);
      for (const s of SCREEN_IDS) expect(a[s].kind).toBe("sponsor");
    }
  });

  it("never puts the board on the ribbon (no room for a pitch)", () => {
    for (const type of EVENT_TYPES) expect(RULES[type].ribbon).not.toContain("tactical");
  });

  it("is a pure function: the same event lights the same screens", () => {
    events.forEach((e, i) => expect(assignScreens(e, i)).toEqual(assignScreens(e, i)));
  });

  it("rotates the sponsors: each screen moves on one with every event", () => {
    expect(sponsorFor("ribbon", 0)).not.toEqual(sponsorFor("ribbon", 1));
    expect(sponsorFor("main", 0)).not.toEqual(sponsorFor("tunnel", 0));
    const seen = new Set(
      events.flatMap((e, i) =>
        Object.values(assignScreens(e, i)).flatMap((c) =>
          c.kind === "sponsor" ? [c.sponsor.id] : [],
        ),
      ),
    );
    expect(seen).toEqual(new Set(SPONSORS.map((s) => s.id)));
  });
});

describe("sponsor slots and descriptions", () => {
  it("counts every sponsor screen of the programme exactly once", () => {
    const slots = sponsorSlots(events);
    const total = events
      .flatMap((e, i) => Object.values(assignScreens(e, i)))
      .filter((c) => c.kind === "sponsor").length;
    expect(slots.map((s) => s.sponsor.id)).toEqual(SPONSORS.map((s) => s.id));
    expect(slots.reduce((a, s) => a + s.slots, 0)).toBe(total);
  });

  it("describes each screen in words, with the same numbers it shows", () => {
    const look = assignScreens(byType("key-look"), 1);
    expect(describeContent(look.tunnel)).toBe(
      "Walk-out (the look): Joss Ferriday, number 8, Kestrel Bay",
    );
    expect(describeContent(look.main)).toMatch(
      /^Tactical replay still: J\. Ferriday → N\. Varnhall/,
    );
    expect(describeContent(look.ribbon)).toContain("0.8 s before the ball reaches him");
  });
});

describe("transitions (no strobe)", () => {
  const a = assignScreens(events[0], 0);
  const b = assignScreens(events[1], 1);

  it("holds unchanged screens, fades changed ones, cuts with reduced motion or on the first show", () => {
    const t = transitions(a, b, false);
    for (const s of SCREEN_IDS) expect(t[s]).toBe(a[s].key === b[s].key ? "hold" : "fade");
    expect(Object.values(transitions(a, b, true)).filter((x) => x === "fade")).toEqual([]);
    expect(Object.values(transitions(null, b, false))).toEqual(SCREEN_IDS.map(() => "cut"));
    expect(Object.values(transitions(a, a, false))).toEqual(SCREEN_IDS.map(() => "hold"));
  });

  it("dips slowly and never brightens past the content", () => {
    expect(fadeLevel(0)).toBe(1);
    expect(fadeLevel(FADE.ms)).toBe(1);
    expect(fadeLevel(FADE.ms / 2)).toBeCloseTo(FADE.dip);
    for (let t = 0; t <= FADE.ms; t += 10) {
      expect(fadeLevel(t)).toBeGreaterThanOrEqual(FADE.dip - 1e-9);
      expect(fadeLevel(t)).toBeLessThanOrEqual(1);
      // No step: from one 60 Hz frame to the next it moves by under a tenth of the range.
      expect(Math.abs(fadeLevel(t + 1000 / 60) - fadeLevel(t))).toBeLessThan(0.1);
    }
    expect(FADE.ms).toBeGreaterThanOrEqual(1000); // slow: a second or more
  });

  it("lets at most one change through per gap: under three flashes a second", () => {
    expect(commitAt(null, 100)).toBe(100);
    expect(commitAt(100, 200)).toBe(100 + MIN_GAP_MS);
    expect(commitAt(100, 100 + MIN_GAP_MS + 5)).toBe(100 + MIN_GAP_MS + 5);
    expect(MIN_GAP_MS).toBeGreaterThan(FADE.ms); // a fade ends before the next can start
    expect(1000 / MIN_GAP_MS).toBeLessThan(3);
  });
});
