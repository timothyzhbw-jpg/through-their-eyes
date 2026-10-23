// Test stand-ins for the screens: a 2D context that records every text it is asked to draw (with
// a font-proportional measure), a canvas that hands it out, and the studio's facts from the
// committed files in public/data.

import hero from "../../public/data/hero_seed3.json";
import steps from "../../public/data/steps_seed3.json";
import without from "../../public/data/without_look_seed3.json";
import goalWithout from "../../public/data/without_look_far_post_finish_seed11.json";
import { parseHero } from "../data/hero";
import { studioFacts, type StudioFacts } from "./content";
import type { Ctx } from "./draw";

export interface DrawnText {
  text: string;
  x: number;
  y: number;
  width: number;
  px: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
}

/** A glyph is this many ems wide on average: wider than Saira Condensed and Plex Mono. */
export const EM = 0.62;

export function recordingCtx(): { ctx: Ctx; texts: DrawnText[] } {
  const texts: DrawnText[] = [];
  const state = {
    font: "10px sans-serif",
    textAlign: "start" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
  };
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10);
  const measure = (text: string) => ({ width: text.length * px() * EM }) as TextMetrics;
  const ctx = new Proxy(state as unknown as Ctx, {
    get(target, prop) {
      if (prop === "measureText") return measure;
      if (prop === "fillText") {
        return (text: string, x: number, y: number) =>
          texts.push({
            text,
            x,
            y,
            width: measure(text).width,
            px: px(),
            align: state.textAlign,
            baseline: state.textBaseline,
          });
      }
      if (prop in target) return (target as unknown as Record<string | symbol, unknown>)[prop];
      return () => undefined;
    },
    set(target, prop, value) {
      (target as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });
  return { ctx, texts };
}

/** A canvas whose 2D context records (see recordingCtx); `texts` collects every canvas's. */
export function recordingCanvas(texts: DrawnText[] = []): () => HTMLCanvasElement {
  return () => {
    const rec = recordingCtx();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => rec.ctx,
      texts: rec.texts,
    };
    rec.texts.push = (...items: DrawnText[]) => {
      texts.push(...items);
      return Array.prototype.push.apply(rec.texts, items);
    };
    return canvas as unknown as HTMLCanvasElement;
  };
}

/** Left and right edges of a drawn text, by its alignment. */
export function extent(t: DrawnText): [number, number] {
  if (t.align === "center") return [t.x - t.width / 2, t.x + t.width / 2];
  if (t.align === "right" || t.align === "end") return [t.x - t.width, t.x];
  return [t.x, t.x + t.width];
}

/** Top and bottom of a drawn text, by its baseline (a line is about one em tall). */
export function vertical(t: DrawnText): [number, number] {
  if (t.baseline === "middle") return [t.y - t.px / 2, t.y + t.px / 2];
  if (t.baseline === "top") return [t.y, t.y + t.px];
  return [t.y - t.px * 0.8, t.y + t.px * 0.2];
}

export const facts = (): StudioFacts =>
  studioFacts({ hero: parseHero(hero), steps, without, goalWithout });
