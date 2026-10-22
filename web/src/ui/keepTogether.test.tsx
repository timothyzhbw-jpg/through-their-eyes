// @vitest-environment happy-dom
// Club names stay on one line (ui/keepTogether.tsx): the full-time line broke "Corvane / Vale 0."
// at 960 px and left a lone "." at 1280.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { keepTogether } from "./keepTogether";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(text: string, phrases: string[]): HTMLElement {
  const el = document.createElement("p");
  const root = createRoot(el);
  act(() => root.render(<>{keepTogether(text, phrases)}</>));
  return el;
}

describe("keepTogether", () => {
  const clubs = ["Kestrel Bay", "Corvane Vale"];

  it("wraps each club name and leaves the text as it was", () => {
    const text = "Full time: Kestrel Bay 1, Corvane Vale 0.";
    const el = render(text, clubs);
    expect(el.textContent).toBe(text);
    expect([...el.querySelectorAll(".nowrap")].map((s) => s.textContent)).toEqual(clubs);
  });

  it("leaves a text without the names alone", () => {
    expect(keepTogether("Possession 3 of 19", clubs)).toEqual(["Possession 3 of 19"]);
  });

  it("takes every occurrence, and no one-word phrase", () => {
    const el = render("Kestrel Bay v Kestrel Bay, H9", [...clubs, "H9"]);
    expect(el.querySelectorAll(".nowrap")).toHaveLength(2);
    expect(el.textContent).toBe("Kestrel Bay v Kestrel Bay, H9");
  });
});
