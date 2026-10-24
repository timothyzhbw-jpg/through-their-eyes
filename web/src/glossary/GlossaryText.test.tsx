// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "./GlossaryProvider";
import { GlossaryText } from "./GlossaryText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function Example({ persona, language }: { persona: "casual" | "analyst"; language: "en" | "zh" }) {
  return (
    <GlossaryProvider persona={persona} language={language}>
      <p>
        <GlossaryText
          text={
            language === "zh"
              ? "高位逼抢后夺回球权，再次高位逼抢。"
              : "A high press creates a regain. Another high press follows."
          }
        />
      </p>
      <GlossaryText
        text={
          language === "zh" ? "高位逼抢带来攻防转换。" : "The high press leads to a transition."
        }
      />
    </GlossaryProvider>
  );
}

function mount(persona: "casual" | "analyst" = "casual", language: "en" | "zh" = "en") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Example persona={persona} language={language} />));
  mounted.push({ root, container });
  return container;
}

const key = (el: Element, value: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
  });

describe("glossary popovers", () => {
  it("opens on keyboard focus, closes on Escape and returns focus to the term", () => {
    const page = mount();
    const term = page.querySelector<HTMLButtonElement>("button.glossary-term")!;
    expect(term.getAttribute("aria-label")).toContain("high press");
    expect(term.getAttribute("aria-haspopup")).toBe("dialog");
    act(() => term.focus());
    expect(page.querySelector("[role=dialog]")?.textContent).toContain("Pressure high up");
    expect(term.getAttribute("aria-expanded")).toBe("true");
    key(term, "Escape");
    expect(page.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(term);

    act(() => term.click());
    const close = page.querySelector<HTMLButtonElement>(".glossary-close")!;
    act(() => close.focus());
    key(close, "Escape");
    expect(page.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(term);
  });

  it("opens on click and shows the definition in Chinese", () => {
    const page = mount("casual", "zh");
    const term = page.querySelector<HTMLButtonElement>("button.glossary-term")!;
    act(() => term.click());
    expect(page.querySelector("[role=dialog]")?.textContent).toContain("高位逼抢");
    expect(page.querySelector("[role=dialog]")?.getAttribute("lang")).toBe("zh");
  });

  it("marks only the first occurrence per screen in Casual, none in Analyst", () => {
    const casual = mount();
    const terms = [...casual.querySelectorAll("[data-glossary-first]")];
    expect(terms.filter((el) => el.getAttribute("data-glossary-first") === "true")).toHaveLength(3);
    expect(terms.filter((el) => el.textContent === "high press")).toHaveLength(3);
    act(() => mounted[0].root.render(<Example persona="analyst" language="en" />));
    expect(casual.querySelectorAll('[data-glossary-first="true"]')).toHaveLength(0);
  });
});
