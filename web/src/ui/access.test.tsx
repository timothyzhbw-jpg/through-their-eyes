// @vitest-environment happy-dom
// Audio description (SPEC 1, 7) and the controls a blind or low-vision viewer reaches by keyboard:
// audience, language, sound, captions, breakdown and playback. Plain DOM assertions on the mounted
// page (happy-dom, MIT), after axe's rules: every control is a native, focusable element with an
// accessible name, toggles expose their state, groups and the caption live region are labelled.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { createApi, DESCRIBED, PERSONAS } from "../api/client";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession, SessionContext, type Session } from "../session";
import { API, breakdownResponse, fakeFetch, json, settle } from "../testing";
import type { AudioLike } from "../voice/voice";
import { BreakdownPanel } from "./BreakdownPanel";
import { Caption, EvidenceCard, NarrationPanel } from "./Narration";
import { PERSONA_LABEL } from "./labels";
import { Transport } from "./Transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hero = parseHero(raw);
const AD = "audio_description";

function online(opts: { play?: () => Promise<void>; tts?: () => Response } = {}) {
  const fetch = fakeFetch({
    "POST /api/breakdowns": (body) => {
      const { personas, languages } = body as { personas: string[]; languages: string[] };
      return json(breakdownResponse({}, { persona: personas[0], language: languages[0] }));
    },
    "POST /api/tts": opts.tts ?? (() => new Response(new Blob(["RIFF"], { type: "audio/wav" }))),
  });
  const play = opts.play ?? (async () => {});
  const audio = (): AudioLike => ({ play, pause: () => {}, onended: null });
  const session = createSession(hero, EXAMPLE_PLAN, payloadJson, null, {
    api: createApi(API, "blind_side_run-3", fetch),
    makeAudio: audio,
  });
  return { session, fetch };
}

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

const sound = (s: Session) => s.voice.state.get().on;
const textOf = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

/** Accessible name, simplified from accname: aria-labelledby, aria-label, a <label>, contents. */
function accessibleName(el: Element): string {
  const by = el.getAttribute("aria-labelledby");
  if (by)
    return by
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)) ?? "")
      .join(" ");
  const label = el.getAttribute("aria-label")?.trim();
  if (label) return label;
  const wrapping = el.id ? document.querySelector(`label[for="${el.id}"]`) : el.closest("label");
  if (wrapping) {
    const copy = wrapping.cloneNode(true) as Element;
    copy.querySelectorAll("select, input, textarea").forEach((c) => c.remove());
    return textOf(copy) ?? "";
  }
  return textOf(el) ?? "";
}

const CONTROLS =
  "button, select, input, textarea, a[href], [tabindex], [role=button], [role=switch], [role=slider]";
const NATIVE = new Set(["BUTTON", "SELECT", "INPUT", "TEXTAREA", "A"]);

/** Axe-style checks on everything a keyboard can operate inside `root`; returns the problems. */
function problems(root: HTMLElement): string[] {
  const out: string[] = [];
  const controls = [...root.querySelectorAll<HTMLElement>(CONTROLS)];
  if (!controls.length) out.push("no controls");
  for (const el of controls) {
    const what = `${el.tagName.toLowerCase()} "${textOf(el)?.slice(0, 30)}"`;
    if (!accessibleName(el)) out.push(`${what}: no accessible name`);
    if (!NATIVE.has(el.tagName) && el.tabIndex < 0) out.push(`${what}: not focusable`);
    if (el.tabIndex < 0 || el.getAttribute("tabindex") === "-1") out.push(`${what}: tabindex -1`);
    if (el.closest("[aria-hidden=true]")) out.push(`${what}: inside aria-hidden`);
    const pressed = el.getAttribute("aria-pressed");
    if (pressed !== null && !["true", "false"].includes(pressed)) out.push(`${what}: aria-pressed`);
    if ((el as HTMLButtonElement).disabled) out.push(`${what}: disabled`);
    el.focus();
    if (document.activeElement !== el) out.push(`${what}: does not take focus`);
  }
  for (const group of root.querySelectorAll("[role=group], [role=region]")) {
    const named = group.getAttribute("aria-label")?.trim() || group.getAttribute("aria-labelledby");
    if (!named) out.push(`${group.getAttribute("role")}: no name`); // contents do not name a group
  }
  const ids = [...root.querySelectorAll("[id]")].map((e) => e.id);
  if (new Set(ids).size !== ids.length) out.push("duplicate ids");
  return out;
}

describe("audio description", () => {
  it("is an audience in the picker, by its own name", async () => {
    expect(PERSONAS).toContain(AD);
    expect(DESCRIBED.has(AD)).toBe(true);
    expect(PERSONA_LABEL[AD]).toBe("Audio description");
    const { session } = online();
    const page = mount(session, <NarrationPanel />);
    const select = page.querySelector<HTMLSelectElement>(".choice select")!;
    expect(accessibleName(select)).toBe("Audience");
    const option = [...select.options].find((o) => o.value === AD);
    expect(textOf(option)).toBe("Audio description");

    session.controls.requestBreakdown();
    await settle();
    act(() => {
      select.value = AD; // chosen with the keyboard: a change event on the native select
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(session.breakdown.get()).toMatchObject({ persona: AD, status: "ready" });
  });

  it("turns the sound on when chosen; every other audience keeps it off", async () => {
    const { session, fetch } = online();
    session.controls.requestBreakdown();
    await settle();
    for (const p of PERSONAS.filter((p) => !DESCRIBED.has(p))) {
      session.controls.setPersona(p);
      await settle();
      expect(sound(session), p).toBe(false);
    }
    session.controls.setPersona(AD);
    expect(sound(session)).toBe(true);
    await settle();
    expect(fetch.calls.at(-1)?.body).toMatchObject({ personas: [AD] });
    session.controls.openLine("L1"); // its caption comes up and is spoken
    await settle();
    expect(fetch.calls.at(-1)?.path).toBe("/api/tts");

    session.controls.setPersona("casual"); // the sound it turned on goes off with it
    expect(sound(session)).toBe(false);
  });

  it("leaves a sound choice the viewer made alone", async () => {
    const { session } = online();
    session.controls.requestBreakdown();
    await settle();
    session.controls.setSound(true); // on by the viewer, before audio description
    session.controls.setPersona(AD);
    session.controls.setPersona("analyst");
    expect(sound(session)).toBe(true);

    session.controls.setSound(false);
    session.controls.setPersona(AD);
    expect(sound(session)).toBe(true);
    session.controls.setSound(false); // off by the viewer while describing: stays off
    session.controls.setPersona("coach");
    session.controls.setPersona(AD);
    expect(sound(session)).toBe(true); // choosing it again turns it on again
  });

  it("makes the captions and the narration list large print", async () => {
    const { session } = online();
    session.controls.requestBreakdown();
    await settle();
    const page = mount(
      session,
      <>
        <Caption />
        <NarrationPanel />
      </>,
    );
    act(() => session.controls.openLine("L1"));
    const caption = () => page.querySelector<HTMLElement>("button.caption")!;
    const list = () => page.querySelector<HTMLElement>("ol.lines")!;
    expect(caption().classList.contains("large")).toBe(false);
    expect(list().classList.contains("large")).toBe(false);

    act(() => session.controls.setPersona(AD));
    await act(settle);
    act(() => session.controls.openLine("L1"));
    expect(caption().classList.contains("large")).toBe(true);
    expect(list().classList.contains("large")).toBe(true);
    expect(textOf(caption())).toContain("H8 checked his shoulder");
  });
});

describe("keyboard and screen reader access", () => {
  it("names every control, keeps it focusable, and exposes toggle state", async () => {
    const { session } = online();
    session.controls.requestBreakdown();
    await settle();
    act(() => session.controls.setPersona(AD));
    await act(settle);
    const page = mount(
      session,
      <>
        <Caption />
        <EvidenceCard />
        <Transport />
        <NarrationPanel />
        <BreakdownPanel />
      </>,
    );
    act(() => session.controls.openLine("L2"));
    expect(problems(page)).toEqual([]);

    const soundButton = page.querySelector<HTMLButtonElement>("button.sound")!;
    expect(accessibleName(soundButton)).toBe("Sound");
    expect(soundButton.getAttribute("aria-pressed")).toBe("true");
    act(() => soundButton.click());
    expect(soundButton.getAttribute("aria-pressed")).toBe("false");
    expect(accessibleName(soundButton)).toBe("Sound"); // the name stays; the state changes

    const languages = page.querySelector("[role=group][aria-label='Narration language']")!;
    expect([...languages.querySelectorAll("button")].map((b) => b.getAttribute("lang"))).toEqual([
      "en",
      "zh",
    ]);
    expect(accessibleName(page.querySelector("section.transport")!)).toBe("Playback");
  });

  it("announces captions to screen readers while the voice is off, and not over it", async () => {
    const { session } = online();
    session.controls.requestBreakdown();
    await settle();
    const page = mount(session, <Caption />);
    const region = () => page.querySelector<HTMLElement>("[aria-live]")!;
    expect(region().getAttribute("aria-live")).toBe("polite"); // there before any caption
    expect(textOf(region())).toBe("");
    act(() => session.controls.openLine("L3"));
    expect(textOf(region())).toBe("Without that look, H8 would have passed to H4.");
    act(() => session.controls.setSound(true));
    // Sound on alone is not speech: the region stays polite until a clip actually plays.
    expect(region().getAttribute("aria-live")).toBe("polite");
    act(() => session.controls.openLine("L1"));
    await act(settle);
    expect(session.voice.state.get().status).toBe("playing");
    expect(region().getAttribute("aria-live")).toBe("off"); // the voice reads it instead
  });

  const announcedWhenSilent = async (session: Session) => {
    session.controls.requestBreakdown();
    await settle();
    act(() => session.controls.setSound(true));
    const page = mount(session, <Caption />);
    const region = () => page.querySelector<HTMLElement>("[aria-live]")!;
    act(() => session.controls.openLine("L3"));
    await act(settle);
    expect(sound(session)).toBe(true);
    expect(session.voice.state.get().status).toBe("failed");
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(textOf(region())).toBe("Without that look, H8 would have passed to H4.");
  };

  it("still announces captions when the browser blocks the clip from playing", async () => {
    const blocked = async () => {
      throw new DOMException("play() needs a user gesture", "NotAllowedError");
    };
    await announcedWhenSilent(online({ play: blocked }).session);
  });

  it("still announces captions when speech fails or is capped", async () => {
    await announcedWhenSilent(online({ tts: () => json({ detail: "daily cap" }, 429) }).session);
  });
});

describe("the checks themselves", () => {
  it("catch a nameless, unfocusable, disabled or badly pressed control", () => {
    const page = document.createElement("div");
    page.innerHTML = `
      <button type="button"></button>
      <div role="button">Play</div>
      <button type="button" tabindex="-1">Skip</button>
      <button type="button" disabled>Sound</button>
      <button type="button" aria-pressed="yes">Mixed</button>
      <div aria-hidden="true"><button type="button">Hidden</button></div>
      <span role="group"><button type="button">EN</button></span>`;
    document.body.append(page);
    expect(problems(page)).toEqual([
      'button "": no accessible name',
      'div "Play": not focusable',
      'div "Play": tabindex -1',
      'button "Skip": tabindex -1',
      'button "Sound": disabled',
      'button "Sound": does not take focus',
      'button "Mixed": aria-pressed',
      'button "Hidden": inside aria-hidden',
      "group: no name",
    ]);
    page.remove();
  });
});
