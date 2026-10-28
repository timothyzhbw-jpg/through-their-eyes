// @vitest-environment happy-dom
// "Challenge a friend" (SPEC 7, ShareChallenge.tsx): the share sheet when the device has one, with
// the mode's link and its line; else the link copied and said so; a cancelled share or a refused
// clipboard leaves the button as it was, with no status and nothing thrown; the link keeps the
// page's query.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { challengeUrl, ShareChallenge } from "./ShareChallenge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = "Train your scanning: where would you look before the ball arrives?";
const mounted: { root: Root; container: HTMLElement }[] = [];
const stubbed: string[] = [];

/** Gives `navigator` its own `name` (happy-dom has no share; its clipboard is on the prototype). */
function stub(name: "share" | "clipboard", value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
  stubbed.push(name);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  stub("share", undefined);
});
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  for (const name of stubbed.splice(0))
    delete (navigator as unknown as Record<string, unknown>)[name];
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

function mount(action = "?play=drill"): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ShareChallenge action={action} text={TEXT} />));
  mounted.push({ root, container });
  return container;
}

async function press(el: HTMLElement) {
  const button = el.querySelector<HTMLButtonElement>("button")!;
  expect(button.textContent).toBe("Challenge a friend");
  expect(button.className).toBe("btn btn-quiet");
  await act(async () => {
    button.click();
    for (let k = 0; k < 3; k++) await new Promise((r) => setTimeout(r, 0));
  });
}

const status = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="status"]');

describe("ShareChallenge", () => {
  it("opens the share sheet with the link and the line when the device has one", async () => {
    window.history.replaceState(null, "", "/?match=press_escape-0&lang=zh");
    const share = vi.fn(() => Promise.resolve());
    const writeText = vi.fn(() => Promise.resolve());
    stub("share", share);
    stub("clipboard", { writeText });
    const el = mount();
    await press(el);
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: "Through Their Eyes",
      text: TEXT,
      url: `${window.location.origin}/?match=press_escape-0&lang=zh&play=drill`,
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(status(el)?.textContent).toBe("");
  });

  it("copies the link and says so without a share sheet", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stub("clipboard", { writeText });
    const el = mount("?play=yourcall");
    expect(status(el)?.textContent).toBe("");
    await press(el);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?play=yourcall`);
    expect(status(el)?.textContent).toBe("Link copied");
  });

  it("leaves no status and throws nothing when the share is cancelled", async () => {
    const error = vi.spyOn(console, "error");
    const abort = Object.assign(new Error("Share canceled"), { name: "AbortError" });
    const share = vi.fn(() => Promise.reject(abort));
    const writeText = vi.fn(() => Promise.resolve());
    stub("share", share);
    stub("clipboard", { writeText });
    const el = mount();
    await press(el);
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(status(el)?.textContent).toBe("");
    expect(el.querySelector("button")?.textContent).toBe("Challenge a friend");
    expect(error).not.toHaveBeenCalled();
  });

  it("shows the link to copy by hand, throwing nothing, when the clipboard is refused", async () => {
    const error = vi.spyOn(console, "error");
    const writeText = vi.fn(() => Promise.reject(new Error("Write permission denied.")));
    stub("clipboard", { writeText });
    const el = mount();
    await press(el);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(status(el)?.textContent).toBe(`Copy this link: ${window.location.origin}/?play=drill`);
    expect(el.querySelector("button")?.textContent).toBe("Challenge a friend");
    expect(error).not.toHaveBeenCalled();
  });

  it("copies the link instead when the share sheet fails for another reason", async () => {
    const refused = Object.assign(new Error("Not allowed"), { name: "NotAllowedError" });
    const share = vi.fn(() => Promise.reject(refused));
    const writeText = vi.fn(() => Promise.resolve());
    stub("share", share);
    stub("clipboard", { writeText });
    const el = mount("?play=yourcall");
    await press(el);
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?play=yourcall`);
    expect(status(el)?.textContent).toBe("Link copied");
  });

  it("builds the link from the page's query, without the actions already consumed", () => {
    window.history.replaceState(null, "", "/?match=press_escape-0&persona=coach&door=turn&at=12");
    expect(challengeUrl("?play=drill")).toBe(
      `${window.location.origin}/?match=press_escape-0&persona=coach&play=drill`,
    );
    expect(challengeUrl("?play=yourcall", { origin: "https://example.test", search: "" })).toBe(
      "https://example.test/?play=yourcall",
    );
  });
});
