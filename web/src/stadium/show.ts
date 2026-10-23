// The show: the timeline's position, what each screen shows, and its fades. Each screen has one
// canvas, its render target, shared by the 3D preview (as a texture) and the Screen wall (as the
// element itself); a canvas is drawn only when its content changes, never per frame. A change
// waits for the last one to be MIN_GAP_MS old (scrubbing the timeline does not strobe the bowl);
// a changing screen fades down, swaps its picture at the bottom of the fade and comes back up, or
// cuts with reduced motion.

import { createStore, type Store } from "../store/store";
import { drawContent, type Ctx } from "./draw";
import { SCREEN_IDS, SCREENS, type ScreenFormat, type ScreenId } from "./formats";
import {
  assignScreens,
  commitAt,
  FADE,
  fadeLevel,
  MIN_GAP_MS,
  transitions,
  type Assignment,
  type Content,
  type StudioEvent,
} from "./rules";

export interface Surface {
  format: ScreenFormat;
  canvas: HTMLCanvasElement;
  key: string | null; // what is drawn on it
  draws: number; // how many times it was drawn
}

export type Surfaces = Record<ScreenId, Surface>;

export function createSurfaces(
  make: () => HTMLCanvasElement = () => document.createElement("canvas"),
): Surfaces {
  const out = {} as Surfaces;
  for (const format of SCREENS) {
    const canvas = make();
    canvas.width = format.canvas.width;
    canvas.height = format.canvas.height;
    out[format.id] = { format, canvas, key: null, draws: 0 };
  }
  return out;
}

/** Draw `content` on the surface unless it already shows it. True if it drew. */
export function paint(surface: Surface, content: Content): boolean {
  if (surface.key === content.key) return false;
  const ctx = surface.canvas.getContext("2d") as Ctx | null;
  if (!ctx) return false;
  const { width, height } = surface.format.canvas;
  drawContent(ctx, width, height, surface.format.shape, content);
  surface.key = content.key;
  surface.draws++;
  return true;
}

export interface ShowState {
  selected: number; // where the timeline is
  shown: number | null; // the event on the screens
  fades: Record<ScreenId, number | null>; // when each screen's fade started (ms)
  versions: Record<ScreenId, number>; // bumped on every draw: textures re-upload on it
}

export interface ShowDeps {
  now: () => number;
  later: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  reducedMotion: () => boolean;
}

const browserDeps = (): ShowDeps => ({
  now: () => performance.now(),
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  reducedMotion: () =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
});

export interface Show {
  events: StudioEvent[];
  surfaces: Surfaces;
  state: Store<ShowState>;
  select(index: number): void;
  /** Brightness of a screen now: 1, or less during its fade. */
  level(screen: ScreenId): number;
  fading(): boolean;
  assignment(): Assignment | null;
  dispose(): void;
}

const each = <T>(v: () => T) => Object.fromEntries(SCREEN_IDS.map((s) => [s, v()]));

export function createShow(
  events: StudioEvent[],
  surfaces: Surfaces,
  deps: ShowDeps = browserDeps(),
): Show {
  const state = createStore<ShowState>({
    selected: 0,
    shown: null,
    fades: each(() => null) as ShowState["fades"],
    versions: each(() => 0) as ShowState["versions"],
  });
  let current: Assignment | null = null;
  let lastShown: number | null = null;
  let pending: unknown = null;
  const swaps = new Map<unknown, () => void>(); // timer -> its swap

  const draw = (screen: ScreenId, content: Content) => {
    if (!paint(surfaces[screen], content)) return;
    const s = state.get();
    state.set({ versions: { ...s.versions, [screen]: s.versions[screen] + 1 } });
  };

  const commit = () => {
    pending = null;
    const index = state.get().selected;
    if (index === state.get().shown) return;
    const next = assignScreens(events[index], index);
    const how = transitions(current, next, deps.reducedMotion());
    const now = deps.now();
    const fades = { ...state.get().fades };
    for (const screen of SCREEN_IDS) {
      if (how[screen] === "cut") draw(screen, next[screen]);
      if (how[screen] === "fade") {
        fades[screen] = now;
        // Swap at the bottom of the dip, while the screen is at its darkest.
        const swap = () => {
          swaps.delete(h);
          draw(screen, next[screen]);
        };
        const h = deps.later(swap, FADE.ms / 2);
        swaps.set(h, swap);
      }
    }
    current = next;
    lastShown = now;
    state.set({ shown: index, fades });
  };

  return {
    events,
    surfaces,
    state,
    select(index) {
      const i = Math.max(0, Math.min(events.length - 1, Math.round(index)));
      state.set({ selected: i });
      if (pending !== null) return; // the commit already waiting takes the latest position
      const now = deps.now();
      const at = commitAt(lastShown, now, MIN_GAP_MS);
      if (at <= now) commit();
      else pending = deps.later(commit, at - now);
    },
    level(screen) {
      const start = state.get().fades[screen];
      return start === null ? 1 : fadeLevel(deps.now() - start);
    },
    fading() {
      const now = deps.now();
      return SCREEN_IDS.some((s) => {
        const start = state.get().fades[s];
        return start !== null && now - start < FADE.ms;
      });
    },
    assignment: () => current,
    /** Stop the timers. A swap still waiting is drawn at once, so every screen shows what the
     * show says it does (a show used again starts from there). */
    dispose() {
      if (pending !== null) deps.cancel(pending);
      pending = null;
      for (const [h, swap] of [...swaps]) {
        deps.cancel(h);
        swap();
      }
      const fades = { ...state.get().fades };
      for (const s of SCREEN_IDS) fades[s] = null;
      state.set({ fades });
    },
  };
}
