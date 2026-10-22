// @vitest-environment happy-dom
// A stitched match's Moments panel (SPEC 3.1, 7): match-1 has about 200 moments, 149 of them
// sprints and some 40 line-breaking passes. The hero moments come first; every other moment folds
// into one row per kind and lens, those a lens explains first, small groups open, big ones on
// demand.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../api/client";
import { parseHero } from "../data/hero";
import type { ExportMatchMoment } from "../data/types";
import { createMatchSession } from "../match/matchSession";
import { SessionContext } from "../session";
import { API, fakeFetch, fakeSockets, MATCH, matchExport } from "../testing";
import { groupMoments, MomentsPanel, routineLabel } from "./Live";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

/** A match-1-sized list: the fixture's four moments plus `sprints` sprints and two receptions,
 * spread over the possessions, in anchor order. */
function bigExport(sprints = 140) {
  const m = matchExport();
  const base = m.moments[0];
  const extra: ExportMatchMoment[] = [];
  for (let k = 0; k < sprints; k++) {
    extra.push({
      ...base,
      id: `m:sprint:A${(k % 11) + 1}:${String(k).padStart(4, "0")}`,
      kind: "sprint",
      actor: `A${(k % 11) + 1}`,
      possession: k % 3,
      anchor_frame: k,
      anchor_t: k * m.dt,
    });
  }
  for (const k of [7, 77]) {
    extra.push({
      ...base,
      id: `m:reception:H${k % 10}:${String(k).padStart(4, "0")}`,
      kind: "reception",
      actor: `H${k % 10}`,
      possession: 1,
      anchor_frame: k,
      anchor_t: k * m.dt,
    });
  }
  m.moments = [...m.moments, ...extra];
  return m;
}

function session(raw = matchExport()) {
  return createMatchSession(parseHero(raw), {
    api: createApi(API, MATCH, fakeFetch({})),
    dataUrl: "/data/",
    socket: fakeSockets(),
  });
}

function mount(s: ReturnType<typeof session>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={s}>
        <MomentsPanel />
      </SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return container;
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("grouping a match's moments", () => {
  it("pins the hero moments and folds the rest by kind and lens, lensed groups first", () => {
    const g = groupMoments(session(bigExport()).match.moments);
    expect(g.heroes.map((m) => m.hero)).toEqual([true, true]);
    expect(g.groups.map((r) => [r.kind, r.lens, r.moments.length])).toEqual([
      ["line_breaking_pass", "pressure", 1],
      ["sprint", null, 141],
      ["reception", null, 2],
    ]);
    // Each moment once; each group in match order.
    const all = [...g.heroes, ...g.groups.flatMap((r) => r.moments)];
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
    expect(all).toHaveLength(146);
    for (const r of g.groups) {
      const frames = r.moments.map((m) => m.anchor_frame);
      expect(frames).toEqual([...frames].sort((a, b) => a - b));
    }
  });

  it("names a group in plain words, singular and plural, any kind", () => {
    expect(routineLabel("sprint", 141)).toBe("141 sprints");
    expect(routineLabel("sprint", 1)).toBe("1 sprint");
    expect(routineLabel("line_breaking_pass", 3)).toBe("3 line-breaking passes");
    expect(routineLabel("pressed_decision", 2)).toBe("2 decisions under pressure");
    expect(routineLabel("first_touch_turn", 4)).toBe("4 × first touch turn");
  });

  it("keeps a match with no moment at all working", () => {
    expect(groupMoments([])).toEqual({ heroes: [], groups: [] });
  });
});

describe("the Moments panel of a whole match", () => {
  it("shows the hero moments at the top, with their breakdowns, not buried by sprints", () => {
    const page = mount(session(bigExport()));
    const key = page.querySelector("[aria-label='Key moments']")!;
    const rows = [...key.querySelectorAll(":scope > ol > li")];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.classList.contains("hero"))).toBe(true);
    expect(text(rows[0])).toContain("Breakdown");
    expect(text(rows[0])).toContain("Possession 2");
    // Two breakdown buttons on the page; the 141 sprints are one closed row.
    expect(
      [...page.querySelectorAll("button")].filter((b) => text(b) === "Breakdown"),
    ).toHaveLength(2);
    expect(page.querySelectorAll("li").length).toBeLessThan(10);
    // A small group a lens explains starts open; a big routine one starts closed.
    const toggles = [...page.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")];
    expect(toggles.map((b) => [text(b), b.getAttribute("aria-expanded")])).toEqual([
      ["1 line-breaking pass · pressure lens", "true"],
      ["141 sprints · live only", "false"],
      ["2 × reception · live only", "true"],
    ]);
  });

  it("opens and closes a group of routine moments; each of them still replays", () => {
    const s = session(bigExport());
    const page = mount(s);
    const toggle = [...page.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
      (b) => text(b).startsWith("141 sprints"),
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const list = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(141);
    act(() => rows[5].querySelector("button")!.click());
    expect(s.playback.get().frame).toBe(
      s.match.moments.filter((m) => m.kind === "sprint")[5].anchor_frame,
    );
    act(() => toggle.click());
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeNull();
  });

  it("says when a match has no hero moment", () => {
    const raw = matchExport();
    raw.moments = raw.moments.map((m) => ({ ...m, hero: false }));
    const page = mount(session(raw));
    expect(text(page.querySelector("[aria-label='Key moments']"))).toContain(
      "No hero moment in this match",
    );
    expect(page.querySelector("button[aria-expanded]")).not.toBeNull();
  });
});
