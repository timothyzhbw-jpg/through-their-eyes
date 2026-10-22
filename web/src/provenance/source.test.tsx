// @vitest-environment happy-dom
// Every number on screen carries the same source chip (provenance/source.ts, SourceChip.tsx): the
// words come from one table, a verified claim is told apart from a metric, and no screen writes a
// chip by hand, so the label, its title and its style cannot drift apart again (the blind-side
// overlay said "sim" while its title said tracking; the skeleton key said "sim data").

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SOURCES, type SourceKind } from "./source";
import { SourceChip } from "./SourceChip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function chip(props: Parameters<typeof SourceChip>[0]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(<SourceChip {...props} />));
  return container.querySelector<HTMLElement>(".source")!;
}

describe("SourceChip", () => {
  it("says each kind in the table's words", () => {
    for (const kind of Object.keys(SOURCES) as SourceKind[]) {
      const el = chip({ kind });
      expect(el.textContent).toBe(SOURCES[kind].label);
      expect(el.getAttribute("title")).toBe(SOURCES[kind].title);
      expect(el.dataset.source).toBe(kind);
      expect(el.classList.contains("verified")).toBe(kind === "verified");
    }
  });

  it("says what each number is first, and tells a number computed in code from the AI's", () => {
    for (const [kind, { title }] of Object.entries(SOURCES)) {
      // Never framed as a lack ("not a verified claim" read as "not to be trusted").
      expect(title, kind).not.toMatch(/not a verified claim/);
      if (kind === "verified") expect(title).toMatch(/Verifier checked it/);
      else if (kind === "sample") expect(title).toMatch(/not checked by the Verifier/);
      else {
        expect(title, kind).toMatch(/^(Computed|Measured|Estimated)/);
        expect(title, kind).toContain("not AI narration. The Verifier checks what the AI crew");
      }
    }
    expect(SOURCES.sim.title).toMatch(/^Computed directly by the simulation/);
  });

  it("takes a closer title, and reads it to a screen reader when asked", () => {
    const el = chip({ kind: "sim", title: "Live readouts from the sim" });
    expect(el.getAttribute("title")).toBe("Live readouts from the sim");
    expect(el.querySelector(".sr-only")).toBeNull();
    const spoken = chip({ kind: "sim", spoken: true });
    expect(spoken.querySelector(".sr-only")?.textContent).toMatch(
      /^ \(computed directly by the simulation: not AI narration\. /,
    );
  });
});

// Vitest stubs CSS imports; read the sources with Node's fs (no @types/node here).
type Fs = {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string, options: { recursive: true }): string[];
};
const nodeProcess = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): Fs; cwd(): string } }
).process;

describe("the screens", () => {
  it("draw every source chip with SourceChip, none by hand", () => {
    const fs = nodeProcess.getBuiltinModule("node:fs");
    const src = `${nodeProcess.cwd()}/src`;
    const views = fs
      .readdirSync(src, { recursive: true })
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test.") && !f.endsWith("SourceChip.tsx"));
    expect(views.length).toBeGreaterThan(20);
    const byHand = views.filter((f) =>
      /className=(?:"source[" ]|\{[^}]*"source[" ])/.test(fs.readFileSync(`${src}/${f}`, "utf8")),
    );
    expect(byHand).toEqual([]);
  });
});
