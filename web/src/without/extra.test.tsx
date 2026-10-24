// @vitest-environment happy-dom
// "With two more looks", the opposite of the run without the look: the hero keeps his own looks
// and adds two (sim.export --extra-looks). The lines are checked against the replay like any
// payload; the verdict's "Without the look" panel switches to them, with a source chip naming the
// eval report. Every line on screen is the bundle's own text: nothing here is typed by hand.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import extraBundle from "../../public/data/extra_looks_seed3.json";
import bundle from "../../public/data/without_look_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { fakeFetch, json, settle } from "../testing";
import { countWord, EXTRA_FILES, extraLooksOf, parseExtraLooks } from "./extra";
import { withoutLookOf } from "./without";
import { WithoutLookLines } from "./WithoutLook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const MOMENT = "m:decision_after_scan:H8:0075";

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
const lineText = (lang: "en" | "zh", id: string) =>
  extraBundle.answers[lang].lines.find((l) => l.id === id)!.text;

/** An offline session with both bundles loaded, as the app loads them. */
async function loaded(): Promise<Session> {
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
  const fetch = fakeFetch({
    "GET /data/without_look_seed3.json": () => json(bundle),
    "GET /data/extra_looks_seed3.json": () => json(extraBundle),
  });
  await withoutLookOf(session, fetch, "/data/").load();
  await extraLooksOf(session, fetch, "/data/").load();
  return session;
}

const button = (el: Element, name: string) =>
  [...el.querySelectorAll("button")].find((b) => text(b) === name)!;

describe("the bundle", () => {
  it("is bundled for the scan hero the demo shows", () => {
    expect(EXTRA_FILES["blind_side_run-3"]).toBe("extra_looks_seed3.json");
    expect(EXTRA_FILES["press_escape-0"]).toBeUndefined();
  });

  it("parses into checked lines in en and zh, the added scans and the report", () => {
    const x = parseExtraLooks(extraBundle, hero, MOMENT);
    expect(x.errors).toEqual([]);
    expect(x.added).toHaveLength(2);
    expect(x.added.map((a) => a.bodyDeg)).toEqual([90, -90]); // left, then right
    for (const a of x.added) expect(a.id.startsWith("scan:H8:")).toBe(true);
    // Both looks end before his key scan, which he keeps.
    expect(Math.max(...x.added.map((a) => a.end))).toBeLessThan(hero.keyScan!.start);
    expect(x.keptOwn).toBe(true);
    expect(x.report).toBe("eval/reports/extra_looks_blind_side_run.md");
    for (const lang of ["en", "zh"] as const)
      expect(x.answers[lang]!.lines.map((l) => l.id)).toEqual([
        "added_looks",
        "extra_result",
        "extra_zones",
      ]);
  });

  it("is refused for another moment, another player or a report outside eval/reports", () => {
    expect(() => parseExtraLooks(extraBundle, hero, "m:decision_after_scan:H8:0080")).toThrow(
      new RegExp(MOMENT),
    );
    const other = structuredClone(extraBundle);
    other.added[0].id = "scan:H9:0005";
    expect(() => parseExtraLooks(other, hero, MOMENT)).toThrow(/not H8's/);
    const elsewhere = structuredClone(extraBundle);
    elsewhere.report = "https://example.com/report.md";
    expect(() => parseExtraLooks(elsewhere, hero, MOMENT)).toThrow(/not an eval report/);
    const version = structuredClone(extraBundle);
    version.version = 2;
    expect(() => parseExtraLooks(version, hero, MOMENT)).toThrow(/version 2/);
  });

  it("drops a language whose line names evidence the replay does not have", () => {
    const tampered = structuredClone(extraBundle);
    tampered.answers.en.claims[0].evidence = ["reception:H8:0001"];
    const x = parseExtraLooks(tampered, hero, MOMENT);
    expect(x.answers.en).toBeUndefined();
    expect(x.answers.zh).toBeDefined();
    expect(x.errors.join(" ")).toMatch(/en: claim added_looks: evidence reception:H8:0001/);
  });

  it("loads nothing for a hero without a bundle", async () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    const c = extraLooksOf(session, fakeFetch({}), "/elsewhere/");
    await c.load();
    expect(c.state.get().status).toBe("failed");
    expect(c.state.get().data).toBeNull();
  });
});

describe("in the verdict", () => {
  it("offers With two more looks beside Without the look, and shows its verified lines", async () => {
    const session = await loaded();
    const page = mount(session, <WithoutLookLines />);
    const group = page.querySelector("[role=group][aria-label='Compare his look with']")!;
    expect([...group.querySelectorAll("button")].map((b) => text(b))).toEqual([
      "Without the look",
      "With two more looks",
    ]);
    // Without the look stays the default.
    expect(button(group, "Without the look").getAttribute("aria-pressed")).toBe("true");
    expect(text(page)).toContain("Only this look changes");
    act(() => button(group, "With two more looks").click());
    expect(button(group, "With two more looks").getAttribute("aria-pressed")).toBe("true");
    for (const id of ["added_looks", "extra_result", "extra_zones"])
      expect(text(page)).toContain(lineText("en", id));
    expect(text(page)).not.toContain("Only this look changes");
    expect(page.querySelector(".source")?.getAttribute("title")).toBe(
      "Eval result from eval/reports/extra_looks_blind_side_run.md",
    );
    act(() => button(group, "Without the look").click());
    expect(text(page)).toContain("Only this look changes");
  });

  it("speaks the breakdown's language", async () => {
    const session = await loaded();
    act(() => session.breakdown.set({ language: "zh" }));
    const page = mount(session, <WithoutLookLines />);
    act(() => button(page, "With two more looks").click());
    expect(text(page)).toContain(lineText("zh", "added_looks"));
  });

  it("names as many looks as the bundle added, and keeps the switch when the panel remounts", async () => {
    const session = await loaded();
    expect(countWord(extraBundle.added.length)).toBe("two"); // the label follows the data
    const first = mount(session, <WithoutLookLines />);
    act(() => button(first, "With two more looks").click());
    mounted.splice(0).forEach(({ root, container }) => {
      act(() => root.unmount());
      container.remove();
    });
    const again = mount(session, <WithoutLookLines />);
    expect(button(again, "With two more looks").getAttribute("aria-pressed")).toBe("true");
    expect(text(again)).toContain(lineText("en", "added_looks"));
  });

  it("shows no switch when the bundle is missing", async () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    const fetch = fakeFetch({ "GET /data/without_look_seed3.json": () => json(bundle) });
    await withoutLookOf(session, fetch, "/data/").load();
    await extraLooksOf(session, fetch, "/data/").load();
    const page = mount(session, <WithoutLookLines />);
    await act(settle);
    expect(page.querySelector(".compare-switch")).toBeNull();
    expect(text(page)).toContain("Only this look changes");
  });
});
