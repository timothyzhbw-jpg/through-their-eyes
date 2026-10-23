// The panel and its downloads (SPEC 7): the panel says its figures are demo data and links the
// business model; a card downloads as a PNG file, the posts as a text file.

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { createSession } from "../session";
import { render } from "../testing";
import { DEMO_LABEL } from "./audience";
import {
  CARD_SIZES,
  cardBlob,
  cardFileName,
  cardSpec,
  downloadBlob,
  type CardCanvas,
} from "./cards";
import { postsOf } from "./posts";
import { BUSINESS_MODEL_URL, StudioPanel } from "./Studio";
import { validatePayload } from "../narration/payload";
import { heroMoment } from "../plan/moment";

const hero = parseHero(raw);
const session = () => createSession(hero, EXAMPLE_PLAN, payloadJson);

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A canvas that records what is painted and "encodes" a PNG signature plus the paint count. */
function recordingCanvas(): CardCanvas & { calls: string[] } {
  const calls: string[] = [];
  const paint = new Proxy(
    { fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textBaseline: "", textAlign: "" },
    {
      get(target, key) {
        if (key in target) return (target as Record<string | symbol, unknown>)[key];
        if (key === "measureText") return (t: string) => ({ width: t.length * 10 });
        return (...args: unknown[]) => calls.push(`${String(key)}:${args.join(",")}`);
      },
    },
  );
  return {
    calls,
    width: 0,
    height: 0,
    getContext: () => paint as never,
    toBlob(done, type) {
      done(new Blob([PNG, new Uint8Array(calls.length)], { type }));
    },
  };
}

describe("studio panel", () => {
  const html = render(session(), <StudioPanel />);

  it("lists the package: highlight, explainer, posts, cards and business value", () => {
    for (const part of [
      "Publish this moment",
      "Play highlight",
      "Tactical explainer card",
      "Social posts",
      "Short post",
      "Carousel caption",
      "Vertical-video caption",
      "Data cards",
      "Download PNG",
      "Business value",
    ]) {
      expect(html).toContain(part);
    }
    expect(html).toContain("#KestrelBay");
  });

  it("labels every business figure as demo data and links the business model", () => {
    const labels = html.split(DEMO_LABEL).length - 1;
    // the banner and one under each of the five figures
    expect(labels).toBeGreaterThanOrEqual(6);
    expect(html).toContain(BUSINESS_MODEL_URL);
    expect(BUSINESS_MODEL_URL.endsWith("docs/SUBMISSION.md#business-model")).toBe(true);
  });

  it("builds nothing without a verified breakdown", () => {
    const empty = render(createSession(hero, EXAMPLE_PLAN, null), <StudioPanel />);
    expect(empty).toContain("appears when one is on screen");
    expect(empty).not.toContain("Download PNG");
  });
});

describe("downloads", () => {
  const checkedNarration = () => {
    const v = validatePayload(payloadJson, heroMoment(hero), hero);
    if (!v.ok) throw new Error(v.errors.join("; "));
    return v.narration;
  };

  it.each(CARD_SIZES)("the %s card is a PNG file with its size and a name", async (size) => {
    const spec = cardSpec(checkedNarration(), hero.heroId!, hero.runnerId, size, "en");
    const canvas = recordingCanvas();
    const blob = await cardBlob(spec, () => canvas);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(PNG.length);
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 8)]).toEqual([...PNG]);
    expect(canvas.width).toBe(spec.width);
    expect(canvas.height).toBe(spec.height);
    expect(canvas.calls.some((c) => c.startsWith("fillText"))).toBe(true);
    expect(cardFileName("m:decision_after_scan:H8:0075", size, "en")).toBe(
      `m-decision-after-scan-H8-0075-${size}-en.png`,
    );
  });

  it("paints the card's numbers", async () => {
    const spec = cardSpec(checkedNarration(), hero.heroId!, hero.runnerId, "square", "en");
    expect(spec.stats.length).toBeGreaterThan(0);
    const canvas = recordingCanvas();
    await cardBlob(spec, () => canvas);
    const text = canvas.calls.filter((c) => c.startsWith("fillText")).join("\n");
    for (const s of spec.stats) expect(text).toContain(s.value);
  });

  it("rejects when there is no 2D canvas", async () => {
    const spec = cardSpec(checkedNarration(), hero.heroId!, hero.runnerId, "wide", "en");
    const none = { ...recordingCanvas(), getContext: () => null };
    await expect(cardBlob(spec, () => none)).rejects.toThrow("no 2D canvas");
  });

  it("hands the browser a link with the file name, and clicks it", async () => {
    const clicked: { href: string; download: string }[] = [];
    const doc = {
      createElement: () => ({
        href: "",
        download: "",
        click() {
          clicked.push({ href: this.href, download: this.download });
        },
        remove() {},
      }),
      body: { appendChild() {} },
    } as unknown as Document;
    const blob = new Blob([PNG], { type: "image/png" });
    downloadBlob(blob, "card.png", doc);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("card.png");
    expect(clicked[0].href).toMatch(/^blob:/);
  });

  it("writes the posts as a text file", async () => {
    const ctx = { narration: checkedNarration(), hero: hero.heroId!, runner: hero.runnerId };
    const posts = postsOf(ctx, "zh");
    const blob = new Blob([posts.short], { type: "text/plain;charset=utf-8" });
    expect(blob.size).toBeGreaterThan(0);
    expect(await blob.text()).toContain("#红隼湾");
  });
});
