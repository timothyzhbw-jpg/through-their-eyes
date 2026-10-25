// @vitest-environment happy-dom
// The story so far: the lines already captioned in this playback, beside the picture on desktop.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { App } from "../App";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { CAPTION_STORY_KEY, captionStoryPrefs, setCaptionStory } from "./captionStory";
import { Caption, CaptionStory } from "./Narration";
import { ViewOptions } from "./Stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const offline = () => createSession(hero, EXAMPLE_PLAN, payloadJson, null, {});
const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  setCaptionStory(true);
  localStorage.removeItem(CAPTION_STORY_KEY);
  window.innerWidth = 1024;
});

function mount(session: Session, node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<SessionContext.Provider value={session}>{node}</SessionContext.Provider>));
  mounted.push({ root, container });
  return container;
}

const story = (page: HTMLElement) => page.querySelector('[aria-label="The story so far"]');
const lines = (page: HTMLElement) => [...page.querySelectorAll(".caption-story-line")];
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
const click = (el: HTMLElement) => act(() => el.click());

function button(root: Element, name: string): HTMLButtonElement {
  const all = [...root.querySelectorAll<HTMLButtonElement>("button")];
  const found = all.find((b) => (b.getAttribute("aria-label") ?? text(b)) === name);
  if (!found) throw new Error(`no button "${name}"`);
  return found;
}

function caption(session: Session, frame: number, line: string | null) {
  act(() => session.playback.set({ frame, captionLine: line }));
}

describe("the story so far", () => {
  it("is wired into The look's live screen beside the unchanged caption", () => {
    window.innerWidth = 1200;
    const session = offline();
    const page = mount(session, <App autoplay={false} />);
    caption(session, 10, "L1");

    expect(page.querySelector(".stage > .stage-content > .caption-story")).not.toBeNull();
    expect(page.querySelector(".stage-caption .caption")).not.toBeNull();
  });

  it("accumulates captioned lines oldest first, highlights the current one, and keeps its tick", () => {
    window.innerWidth = 1200;
    const session = offline();
    const current = session.breakdown.get().narration!;
    session.breakdown.set({ narration: { ...current, fixture: false } });
    const page = mount(session, <CaptionStory />);

    caption(session, 10, "L1");
    caption(session, 20, "L2");
    caption(session, 30, "L3");

    expect(lines(page).map((line) => line.getAttribute("data-line"))).toEqual(["L1", "L2", "L3"]);
    expect(text(lines(page)[0])).toContain("What did he see?");
    expect(text(lines(page)[2])).toContain("Without that look");
    expect(lines(page)[2].classList.contains("now")).toBe(true);
    expect(lines(page)[2].getAttribute("aria-current")).toBe("true");
    expect(lines(page)[0].getAttribute("aria-current")).toBeNull();
    expect(lines(page)[2].querySelector(".caption-more.check svg")).not.toBeNull();
    expect(story(page)?.getAttribute("aria-live")).toBeNull();
  });

  it("drops lines after the playhead on a backward seek and does not duplicate them on replay", () => {
    window.innerWidth = 1200;
    const session = offline();
    const page = mount(session, <CaptionStory />);
    caption(session, 10, "L1");
    caption(session, 20, "L2");
    caption(session, 30, "L3");

    caption(session, 15, "L1");
    expect(lines(page).map((line) => line.getAttribute("data-line"))).toEqual(["L1"]);

    caption(session, 25, "L2");
    expect(lines(page).map((line) => line.getAttribute("data-line"))).toEqual(["L1", "L2"]);
  });

  it("clears when the run changes", () => {
    window.innerWidth = 1200;
    const session = offline();
    const page = mount(session, <CaptionStory />);
    caption(session, 10, "L1");
    caption(session, 20, "L2");

    act(() => session.controls.setMode("counterfactual"));
    expect(lines(page)).toHaveLength(0);
    expect(captionStoryPrefs.get().on).toBe(true);
  });

  it("hides from the View options switch and remembers the choice", () => {
    window.innerWidth = 1200;
    const session = offline();
    const page = mount(
      session,
      <>
        <ViewOptions />
        <CaptionStory />
      </>,
    );
    caption(session, 10, "L1");
    expect(story(page)).not.toBeNull();

    click(button(page, "View options"));
    const option = button(page, "Story beside the picture");
    expect(option.getAttribute("aria-pressed")).toBe("true");
    click(option);

    expect(option.getAttribute("aria-pressed")).toBe("false");
    expect(story(page)).toBeNull();
    expect(localStorage.getItem(CAPTION_STORY_KEY)).toBe("0");
    expect(captionStoryPrefs.get().on).toBe(false);
  });

  it("renders nothing below 1100 px and leaves the on-picture caption alone", () => {
    window.innerWidth = 1099;
    const session = offline();
    const page = mount(
      session,
      <>
        <Caption />
        <CaptionStory />
      </>,
    );
    caption(session, 10, "L1");

    expect(story(page)).toBeNull();
    expect(page.querySelector(".caption .caption-text")).not.toBeNull();
  });

  it("renders at exactly 1100 px", () => {
    window.innerWidth = 1100;
    const session = offline();
    const page = mount(session, <CaptionStory />);
    caption(session, 10, "L1");
    expect(story(page)).not.toBeNull();
  });
});
