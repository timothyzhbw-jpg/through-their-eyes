// @vitest-environment happy-dom
// "Without the look", told (teammates' feedback 2026-10-21): which look was removed, what losing
// it cost, and where the pass went in expected threat, from verified lines bundled per hero
// (sim.export --without-look). The removed look is marked on the timeline, in the HUD and at the
// edge of his eyes; the xT explainer draws the grid with both passes' ends.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import bundle from "../../public/data/without_look_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { fakeFetch, json, settle } from "../testing";
import { Transport } from "../ui/Transport";
import { Hud } from "../views/PovOverlay";
import { parseWithoutLook, WITHOUT_FILES, withoutLookOf } from "./without";
import { RemovedLookEdge, WithoutLookLines, WithoutLookNote } from "./WithoutLook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(session: Session, node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

/** An offline session whose bundle is loaded, as the app loads it. */
async function loaded(): Promise<Session> {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
  const fetch = fakeFetch({ "GET /data/without_look_seed3.json": () => json(bundle) });
  await withoutLookOf(session, fetch, "/data/").load();
  return session;
}

describe("the bundle", () => {
  it("is bundled for the scan heroes the demo shows", () => {
    expect(WITHOUT_FILES["blind_side_run-3"]).toBe("without_look_seed3.json");
    expect(WITHOUT_FILES["far_post_finish-11"]).toBe("without_look_far_post_finish_seed11.json");
    expect(WITHOUT_FILES["press_escape-0"]).toBeUndefined(); // its other run forces a carry
  });

  it("parses into checked lines in en and zh, the removed scan and the xT grid", () => {
    const w = parseWithoutLook(bundle, hero, "m:decision_after_scan:H8:0075");
    expect(w.errors).toEqual([]);
    expect(w.removed).toEqual({ id: "scan:H8:0050", start: 50, end: 70 });
    expect(w.removed.id).toBe(hero.keyScan!.id);
    for (const lang of ["en", "zh"] as const)
      expect(w.answers[lang]!.lines.map((l) => l.id)).toEqual([
        "removed_look",
        "look_cost",
        "pass_zones",
      ]);
    expect(w.side).toBe("right");
    expect(w.grid.length).toBe(16 * 12);
    expect(Math.max(...w.grid)).toBeLessThan(1);
  });

  it("is refused for another moment, and a line whose evidence is not in the replay is dropped", () => {
    expect(() => parseWithoutLook(bundle, hero, "m:decision_after_scan:H8:0080")).toThrow(
      /m:decision_after_scan:H8:0075/,
    );
    const tampered = structuredClone(bundle);
    tampered.answers.en.claims[0].evidence = ["scan:H8:0049"];
    const w = parseWithoutLook(tampered, hero, "m:decision_after_scan:H8:0075");
    expect(w.answers.en).toBeUndefined();
    expect(w.answers.zh).toBeDefined();
    expect(w.errors.join(" ")).toMatch(/en: claim removed_look: evidence scan:H8:0049/);
  });
});

describe("on the live screen", () => {
  it("says which look was removed and what it cost, only in the run without it", async () => {
    const session = await loaded();
    const page = mount(session, <WithoutLookNote />);
    expect(page.textContent).toBe("");
    act(() => session.controls.setMode("counterfactual"));
    const note = page.querySelector("[aria-label='The run without the look']")!;
    expect(text(note)).toContain(
      "Removed: H8's look over his right shoulder, 0.8 seconds before the ball reached him.",
    );
    expect(text(note)).toContain(
      "Without that look, H8 would have played it back to H4 instead of forward to H9.",
    );
    act(() => session.breakdown.set({ language: "zh" }));
    expect(text(page.querySelector("[aria-label='The run without the look']"))).toContain(
      "去掉的是：球到之前0.8秒，H8向右后方的那一眼。",
    );
  });

  it("marks the removed look on the timeline and in the HUD", async () => {
    const session = await loaded();
    act(() => session.controls.setMode("counterfactual"));
    act(() => session.controls.seek(56));
    const bar = mount(session, <Transport />);
    const mark = [...bar.querySelectorAll("button")].find((b) => text(b) === "Removed look");
    expect(mark).toBeDefined();
    const hud = mount(session, <Hud />);
    expect(text(hud)).toContain("removed look");
    act(() => session.controls.setMode("factual"));
    expect([...bar.querySelectorAll("button")].some((b) => text(b) === "Key scan")).toBe(true);
  });

  it("lights the edge of his eyes on the side of the removed look, while it would have lasted", async () => {
    const session = await loaded();
    const page = mount(session, <RemovedLookEdge />);
    act(() => session.controls.setMode("counterfactual"));
    act(() => session.controls.seek(40));
    expect(page.querySelector(".removed-edge")).toBeNull();
    act(() => session.controls.seek(56));
    const edge = page.querySelector(".removed-edge")!;
    expect(edge.classList.contains("right")).toBe(true);
    expect(text(edge)).toBe("Removed look");
    act(() => session.controls.seek(71));
    expect(page.querySelector(".removed-edge")).toBeNull();
    act(() => session.controls.seek(56));
    act(() => session.controls.setMode("factual"));
    expect(page.querySelector(".removed-edge")).toBeNull();
  });
});

describe("in the verdict", () => {
  it("tells where the pass went, and the explainer draws both ends on the xT grid", async () => {
    const session = await loaded();
    const page = mount(session, <WithoutLookLines />);
    expect(text(page)).toContain(
      "H8's pass reached H9 in the final third, right of centre: xT 0.172. Without that look it " +
        "would have reached H4 in his own half, right of centre: xT 0.002.",
    );
    const open = [...page.querySelectorAll("button")].find((b) => text(b) === "How xT works")!;
    act(() => open.click());
    const dialog = document.querySelector<HTMLElement>("[role=dialog][aria-modal=true]")!;
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.querySelectorAll("rect.xt-cell")).toHaveLength(16 * 12);
    const ends = [...dialog.querySelectorAll("rect.xt-cell.end")];
    expect(ends).toHaveLength(2);
    // The two values on the grid are the verified line's, nothing else.
    expect([...dialog.querySelectorAll(".xt-end-label")].map((l) => text(l))).toEqual([
      "xT 0.172",
      "xT 0.002",
    ]);
    expect(text(dialog)).toMatch(/value iteration/);
    expect(document.activeElement?.textContent).toBe("Close");
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[role=dialog][aria-modal=true]")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("says nothing for a hero without a bundle", async () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    const fetch = fakeFetch({});
    await withoutLookOf(session, fetch, "/elsewhere/").load();
    act(() => session.controls.setMode("counterfactual"));
    const page = mount(
      session,
      <>
        <WithoutLookNote />
        <WithoutLookLines />
      </>,
    );
    await act(settle);
    expect(page.textContent).toBe("");
  });
});
