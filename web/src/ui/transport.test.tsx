// @vitest-environment happy-dom
// Space plays the picture only when nothing has the page: the pre-match lineup card blocks it.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { intro } from "./intro";
import { Transport } from "./Transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  intro.set({ open: false });
});

function mount(session: Session): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <Transport />
      </SessionContext.Provider>,
    ),
  );
  mounted.push({ root, container });
  return container;
}

describe("Space on the picture", () => {
  it("does nothing while the pre-match card is open, and plays once it closes", () => {
    const session = createSession(hero, EXAMPLE_PLAN, payloadJson);
    intro.set({ open: true });
    const page = mount(session);
    const pressSpace = () =>
      act(() =>
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }),
        ),
      );

    pressSpace();
    expect(session.playback.get().playing).toBe(false);

    act(() => intro.set({ open: false }));
    pressSpace();
    expect(session.playback.get().playing).toBe(true);
    expect(page.querySelector("section.transport")).not.toBeNull();
  });
});
