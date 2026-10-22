// @vitest-environment happy-dom
// Label textures fit their text (views/scene.ts): a tag too long for its canvas widens it, up to
// the style's maxWidth, and only past that is drawn smaller; it is never cut at both ends. With
// fictional names Take his eyes' result tag reads "your look: pass to K. Annersley", about 860 px
// at the tag's 66 px, on what was a fixed 512 px canvas.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitFont, getLabelTexture, LABEL, labelAspect } from "./scene";

const px = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const PAD = 14; // the outline and the clear ends

describe("fitFont", () => {
  it("keeps a font whose text fits", () => {
    expect(fitFont(LABEL.tag.font, 400, 498)).toBe(LABEL.tag.font);
  });

  it("scales the pixel size down to the room", () => {
    expect(fitFont('600 66px "Saira Condensed", sans-serif', 860, 430)).toBe(
      '600 33px "Saira Condensed", sans-serif',
    );
  });
});

describe("getLabelTexture", () => {
  // happy-dom draws no text: a 2D context whose characters are 0.42 em wide, about Saira Condensed's.
  const EM = 0.42;
  let drawn: { text: string; font: string; width: number }[] = [];
  beforeEach(() => {
    drawn = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      const c = {
        font: "10px sans-serif",
        measureText: (text: string) => ({ width: EM * px(c.font) * text.length }),
        strokeText: () => {},
        fillText: (text: string) => {
          drawn.push({ text, font: c.font, width: EM * px(c.font) * text.length });
        },
      };
      return c as unknown as CanvasRenderingContext2D;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const canvas = (tex: ReturnType<typeof getLabelTexture>) => tex.image as HTMLCanvasElement;

  it("widens the canvas for a long tag and keeps its size", () => {
    const text = "your look: pass to K. Annersley";
    const tex = getLabelTexture(text, { ...LABEL.tag, color: "#f6d566" });
    const [label] = drawn;
    expect(label.text).toBe(text);
    expect(px(label.font)).toBe(66);
    expect(canvas(tex).width).toBeGreaterThan(LABEL.tag.width);
    expect(label.width).toBeLessThanOrEqual(canvas(tex).width - PAD);
    expect(labelAspect(tex)).toBeCloseTo(canvas(tex).width / LABEL.tag.height);
  });

  it("draws a tag longer than the widest canvas smaller, inside it", () => {
    const text = "your look: shoot at the far post past the goalkeeper";
    const tex = getLabelTexture(text, { ...LABEL.tag, color: "#ffffff" });
    expect(canvas(tex).width).toBe(LABEL.tag.maxWidth);
    expect(px(drawn[0].font)).toBeLessThan(66);
    expect(drawn[0].width).toBeLessThanOrEqual(LABEL.tag.maxWidth - PAD);
  });

  it("keeps a tag that fits at its size and canvas", () => {
    const tex = getLabelTexture("shoulder check", { ...LABEL.tag, color: "#000000" });
    expect(drawn.map((d) => px(d.font))).toEqual([66]);
    expect(labelAspect(tex)).toBe(LABEL.tag.width / LABEL.tag.height);
  });

  it("never widens a label without a maxWidth: it shrinks the text", () => {
    const tex = getLabelTexture("12345", { ...LABEL.shirt, color: "#ffffff" });
    expect(canvas(tex).width).toBe(128);
    expect(px(drawn[0].font)).toBeLessThan(84);
    expect(drawn[0].width).toBeLessThanOrEqual(128 - PAD);
  });
});
