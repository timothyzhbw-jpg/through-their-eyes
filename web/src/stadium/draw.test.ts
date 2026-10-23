import { describe, expect, it } from "vitest";
import { allowedNumbers } from "./content";
import { drawContent, fitBlock, fitSize, VERIFIED_NOTE } from "./draw";
import { SCREENS } from "./formats";
import { assignScreens, PLAYER_KICKER, programme, type Content } from "./rules";
import { SPONSORS } from "./sponsors";
import { extent, facts, recordingCtx, vertical, type DrawnText } from "./testing";

const f = facts();
const events = programme(f);

/** Every screen of every event, drawn: what was written where. */
function drawAll(): { screen: (typeof SCREENS)[number]; content: Content; texts: DrawnText[] }[] {
  const out = [];
  for (const [i, event] of events.entries()) {
    const a = assignScreens(event, i);
    for (const screen of SCREENS) {
      const { ctx, texts } = recordingCtx();
      const { width, height } = screen.canvas;
      drawContent(ctx, width, height, screen.shape, a[screen.id]);
      out.push({ screen, content: a[screen.id], texts });
    }
  }
  return out;
}

/** Every content of every kind on every screen shape, whether or not a rule puts it there. */
function everyContent(): Content[] {
  const out: Content[] = [];
  for (const e of events) {
    if (e.still) out.push({ kind: "tactical", key: "t", still: e.still });
    for (const card of e.cards) out.push({ kind: "stat", key: "s", card });
    for (const player of e.players) {
      out.push({ kind: "walkout", key: "w", player, kicker: PLAYER_KICKER[e.type] });
    }
  }
  for (const player of Object.values(f.players)) {
    out.push({ kind: "walkout", key: "w", player, kicker: "WALKING OUT" });
  }
  for (const sponsor of SPONSORS) out.push({ kind: "sponsor", key: "p", sponsor });
  return out;
}

const NUMBER = /\d+(?:\.\d+)?/g;

describe("the screens' canvases", () => {
  it("writes every text inside its canvas, on every screen shape", () => {
    for (const content of everyContent()) {
      for (const screen of SCREENS) {
        const { ctx, texts } = recordingCtx();
        const { width, height } = screen.canvas;
        drawContent(ctx, width, height, screen.shape, content);
        expect(texts.length, `${content.kind} on ${screen.id}`).toBeGreaterThan(0);
        for (const t of texts) {
          const [l, r] = extent(t);
          const [top, bottom] = vertical(t);
          const where = `${content.kind} "${t.text}" on ${screen.id}`;
          expect(l, where).toBeGreaterThanOrEqual(-0.5);
          expect(r, where).toBeLessThanOrEqual(width + 0.5);
          expect(top, where).toBeGreaterThanOrEqual(-0.5);
          expect(bottom, where).toBeLessThanOrEqual(height + 0.5);
          expect(t.px, where).toBeGreaterThanOrEqual(8); // legible on the screen
        }
      }
    }
  });

  it("shows no digit that is not a claim's value or a shirt number", () => {
    const allowed = allowedNumbers(f);
    const shown = new Set<string>();
    for (const { screen, texts } of drawAll()) {
      for (const t of texts) {
        for (const m of t.text.matchAll(NUMBER)) {
          expect(allowed, `"${t.text}" on ${screen.id}`).toContain(m[0]);
          shown.add(m[0]);
        }
      }
    }
    // The claims' numbers do reach the screens: the look's 0.8 s and the goal's 0.4 s.
    expect(shown).toContain("0.8");
    expect(shown).toContain("0.4");
  });

  it("no text is hand-typed with a digit: sponsors, kickers and notes have none", () => {
    for (const s of SPONSORS) expect(`${s.name} ${s.line}`).not.toMatch(/\d/);
    for (const e of events) {
      for (const c of e.cards) expect(`${c.kicker} ${c.caption}`).not.toMatch(/\d/);
      expect(`${e.label} ${PLAYER_KICKER[e.type]}`).not.toMatch(/\d/);
    }
    expect(VERIFIED_NOTE).not.toMatch(/\d/);
  });

  it("writes a stat card's verified lines whole on the main board", () => {
    const main = SCREENS.find((s) => s.id === "main")!;
    for (const e of events) {
      for (const card of e.cards) {
        const { ctx, texts } = recordingCtx();
        drawContent(ctx, main.canvas.width, main.canvas.height, main.shape, {
          kind: "stat",
          key: card.id,
          card,
        });
        const written = texts.map((t) => t.text).join(" ");
        for (const line of card.lines) expect(written).toContain(line);
        if (card.figure) expect(texts.map((t) => t.text)).toContain(card.figure);
      }
    }
  });

  it("labels every sponsor screen as fictional", () => {
    for (const { content, texts } of drawAll()) {
      if (content.kind !== "sponsor") continue;
      const all = texts.map((t) => t.text).join(" ");
      expect(all).toContain(content.sponsor.name);
    }
    for (const screen of SCREENS.filter((s) => s.shape !== "ribbon")) {
      const { ctx, texts } = recordingCtx();
      drawContent(ctx, screen.canvas.width, screen.canvas.height, screen.shape, {
        kind: "sponsor",
        key: "p",
        sponsor: SPONSORS[0],
      });
      expect(texts.map((t) => t.text)).toContain("Fictional sponsor");
    }
  });
});

describe("text fitting", () => {
  it("shrinks a line to fit, or gives up below the smallest size", () => {
    const { ctx } = recordingCtx();
    const px = fitSize(ctx, "ABCDEFGHIJ", 100, 80, 8, "display")!;
    expect(px * 10 * 0.62).toBeLessThanOrEqual(100);
    expect(fitSize(ctx, "ABCDEFGHIJ", 10, 80, 8, "display")).toBeNull();
  });

  it("wraps a block by words and never splits one", () => {
    const { ctx } = recordingCtx();
    const fit = fitBlock(
      ctx,
      "one two three four five six",
      { x: 0, y: 0, w: 120, h: 200 },
      40,
      8,
      "display",
    )!;
    expect(fit.lines.join(" ")).toBe("one two three four five six");
    expect(
      fitBlock(ctx, "unbreakablewordthatistoolong", { x: 0, y: 0, w: 20, h: 20 }, 40, 8, "display"),
    ).toBeNull();
  });
});
