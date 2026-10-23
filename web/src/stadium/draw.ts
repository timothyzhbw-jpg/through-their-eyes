// Drawing the four content types onto a screen's canvas, in each of the three shapes: 16:9 (the
// main board, the concourse), 9:32 (the tunnel LED) and 40:1 (the ribbon). Every text is fitted to
// its box: the font shrinks until the line (or the wrapped block) fits, and a text that cannot fit
// at the smallest size is left out rather than cut, so a verified sentence is never shown in
// part. Flat colours, no gradients that pulse, no white fields: the screens are lit content, not
// flashes.

import { GK_KITS } from "../players/kit";
import { COLORS } from "../views/scene";
import type { StatCard, TacticalStill, WalkoutPlayer } from "./content";
import type { ScreenShape } from "./formats";
import type { Content } from "./rules";
import { FICTIONAL_SPONSOR, type Sponsor } from "./sponsors";

/** The part of the 2D context the screens draw with. */
export type Ctx = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "strokeRect"
  | "fillText"
  | "measureText"
  | "beginPath"
  | "closePath"
  | "arc"
  | "moveTo"
  | "lineTo"
  | "quadraticCurveTo"
  | "fill"
  | "stroke"
  | "save"
  | "restore"
  | "setLineDash"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "globalAlpha"
>;

export const FONTS = {
  display: '"Saira Condensed", "Arial Narrow", sans-serif',
  data: '"IBM Plex Mono", ui-monospace, monospace',
} as const;

const INK = "#0a100d";
const NIGHT = "#0b1210";
const CHALK = "#efede5";
const MUTED = "#a9b4ad";
const ACCENT = COLORS.floodlight;
/** The line under every stat card: where its numbers come from, with no number in it. */
export const VERIFIED_NOTE = "Numbers from verified claims";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Family = keyof typeof FONTS;

const fontOf = (px: number, family: Family, weight = 700) =>
  `${weight} ${Math.round(px)}px ${FONTS[family]}`;

/** The largest size from `max` down to `min` px at which `text` fits `width`; null if none does. */
export function fitSize(
  ctx: Ctx,
  text: string,
  width: number,
  max: number,
  min: number,
  family: Family,
  weight = 700,
): number | null {
  let px = Math.floor(max);
  while (px >= min) {
    ctx.font = fontOf(px, family, weight);
    if (ctx.measureText(text).width <= width) return px;
    if (px === min) break;
    px = Math.max(min, Math.floor(px * 0.94));
  }
  return null;
}

/** `text` broken into lines of at most `width` at the context's font, by words. A word wider
 * than the line makes the wrap fail (null). */
export function wrap(ctx: Ctx, text: string, width: number): string[] | null {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (!line || ctx.measureText(word).width > width) return null;
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest size at which `text`, wrapped, fits `box`; null if it never does. */
export function fitBlock(
  ctx: Ctx,
  text: string,
  box: Box,
  max: number,
  min: number,
  family: Family,
  weight = 500,
  leading = 1.2,
): { px: number; lines: string[] } | null {
  for (let px = Math.floor(max); px >= min; px = Math.max(min, Math.floor(px * 0.92))) {
    ctx.font = fontOf(px, family, weight);
    const lines = wrap(ctx, text, box.w);
    if (lines && lines.length * px * leading <= box.h) return { px, lines };
    if (px === min) break;
  }
  return null;
}

/** One line of text fitted to `box` (left, centre or right aligned, vertically centred).
 * Returns the height used, 0 if it does not fit. */
function label(
  ctx: Ctx,
  text: string,
  box: Box,
  opts: { family: Family; color: string; max?: number; min?: number; weight?: number },
  align: CanvasTextAlign = "left",
): number {
  const max = Math.min(opts.max ?? box.h, box.h);
  const px = fitSize(ctx, text, box.w, max, opts.min ?? 8, opts.family, opts.weight);
  if (px === null) return 0;
  ctx.font = fontOf(px, opts.family, opts.weight);
  ctx.fillStyle = opts.color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const x = align === "center" ? box.x + box.w / 2 : align === "right" ? box.x + box.w : box.x;
  ctx.fillText(text, x, box.y + box.h / 2);
  return px;
}

/** A wrapped block fitted to `box`, top aligned. Returns the height used, 0 if it does not fit. */
function block(
  ctx: Ctx,
  text: string,
  box: Box,
  opts: { family: Family; color: string; max: number; min: number; weight?: number },
): number {
  const fit = fitBlock(ctx, text, box, opts.max, opts.min, opts.family, opts.weight);
  if (!fit) return 0;
  ctx.font = fontOf(fit.px, opts.family, opts.weight ?? 500);
  ctx.fillStyle = opts.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  fit.lines.forEach((line, k) => ctx.fillText(line, box.x, box.y + k * fit.px * 1.2));
  return fit.lines.length * fit.px * 1.2;
}

const inset = (w: number, h: number, pad: number): Box => ({
  x: pad,
  y: pad,
  w: w - 2 * pad,
  h: h - 2 * pad,
});

/** Padding for a screen: a share of its short side. */
const padOf = (w: number, h: number, shape: ScreenShape) =>
  shape === "ribbon" ? h * 0.12 : Math.min(w, h) * 0.07;

// ---------------------------------------------------------------- the content types

export function drawContent(ctx: Ctx, w: number, h: number, shape: ScreenShape, c: Content): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  switch (c.kind) {
    case "tactical":
      drawTactical(ctx, w, h, shape, c.still);
      break;
    case "stat":
      drawStat(ctx, w, h, shape, c.card);
      break;
    case "walkout":
      drawWalkout(ctx, w, h, shape, c.player, c.kicker);
      break;
    case "sponsor":
      drawSponsor(ctx, w, h, shape, c.sponsor);
      break;
  }
  ctx.restore();
}

/** A short stat card: the kicker, whose moment, the figure and verified lines. */
export function drawStat(ctx: Ctx, w: number, h: number, shape: ScreenShape, card: StatCard) {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(0, 0, w, h);
  const pad = padOf(w, h, shape);
  const area = inset(w, h, pad);
  ctx.fillStyle = ACCENT;
  if (shape === "ribbon") {
    ctx.fillRect(0, 0, pad * 0.6, h);
    const parts = [card.kicker, card.title, card.figure ? `${card.figure} · ${card.caption}` : ""];
    const text = parts.filter(Boolean).join("   ·   ");
    const fallback = `${card.kicker}   ·   ${card.title}`;
    const box = { ...area, x: area.x + pad, w: area.w - pad };
    if (!label(ctx, text, box, { family: "display", color: CHALK, min: area.h * 0.6 })) {
      label(ctx, fallback, box, { family: "display", color: CHALK, min: area.h * 0.5 });
    }
    return;
  }
  const tall = shape === "tall";
  if (tall) ctx.fillRect(0, 0, w, pad * 0.35);
  else ctx.fillRect(0, 0, pad * 0.35, h);
  const unit = tall ? area.w : area.h;
  let y = area.y;
  y += label(
    ctx,
    card.kicker,
    { x: area.x, y, w: area.w, h: unit * 0.09 },
    {
      family: "data",
      color: ACCENT,
    },
  );
  y += unit * 0.02;
  y += label(
    ctx,
    card.title,
    { x: area.x, y, w: area.w, h: unit * 0.14 },
    {
      family: "display",
      color: CHALK,
    },
  );
  const footH = unit * 0.06;
  const foot = { x: area.x, y: area.y + area.h - footH, w: area.w, h: footH };
  label(ctx, VERIFIED_NOTE, foot, { family: "data", color: MUTED, weight: 600 });
  const rest = { x: area.x, y: y + unit * 0.04, w: area.w, h: foot.y - y - unit * 0.08 };
  // The figure and its caption: left half (wide) or on top (tall); the lines beside or below.
  const figW = tall ? rest.w : rest.w * 0.4;
  const figH = tall ? rest.h * 0.28 : rest.h;
  if (card.figure) {
    const used = label(
      ctx,
      card.figure,
      { x: rest.x, y: rest.y, w: figW, h: figH * 0.62 },
      { family: "display", color: ACCENT, min: 12 },
    );
    block(
      ctx,
      card.caption,
      { x: rest.x, y: rest.y + Math.max(used, figH * 0.62), w: figW, h: figH * 0.36 },
      { family: "display", color: MUTED, max: unit * 0.07, min: 10, weight: 600 },
    );
  }
  const text = card.figure
    ? tall
      ? { x: rest.x, y: rest.y + figH + unit * 0.06, w: rest.w, h: rest.h - figH - unit * 0.06 }
      : { x: rest.x + figW + rest.w * 0.06, y: rest.y, w: rest.w * 0.54, h: rest.h }
    : rest;
  paragraphs(ctx, card.lines, text, { max: unit * 0.075, min: unit * 0.04, gap: unit * 0.03 });
}

/**
 * Verified lines in `box`, all at one size: the largest at which they fit, each wrapped. If they
 * do not fit even at `min`, the last line is left out and the rest tried again: a line is shown
 * whole or not at all.
 */
function paragraphs(
  ctx: Ctx,
  lines: string[],
  box: Box,
  opts: { max: number; min: number; gap: number },
): void {
  const min = Math.max(8, opts.min);
  for (let n = lines.length; n > 0; n--) {
    for (let px = Math.floor(opts.max); px >= min; px = Math.max(min, Math.floor(px * 0.92))) {
      ctx.font = fontOf(px, "display", 600);
      const wrapped = lines.slice(0, n).map((l) => wrap(ctx, l, box.w));
      if (wrapped.every((w) => w)) {
        const rows = wrapped.reduce((k, w) => k + w!.length, 0);
        if (rows * px * 1.2 + (n - 1) * opts.gap <= box.h) {
          ctx.fillStyle = CHALK;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          let y = box.y;
          for (const w of wrapped) {
            for (const row of w!) {
              ctx.fillText(row, box.x, y);
              y += px * 1.2;
            }
            y += opts.gap;
          }
          return;
        }
      }
      if (px === min) break;
    }
  }
}

/** A player walking out (or on screen for his moment): number, name, club in his kit's colours. */
export function drawWalkout(
  ctx: Ctx,
  w: number,
  h: number,
  shape: ScreenShape,
  p: WalkoutPlayer,
  kicker = "WALKING OUT",
) {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(0, 0, w, h);
  const pad = padOf(w, h, shape);
  const area = inset(w, h, pad);
  const number = String(p.number);
  const swatches = (box: Box) => {
    const colours = [p.kit.shirt, p.kit.shorts, p.kit.socks];
    const s = Math.min(box.h, box.w / 4);
    colours.forEach((c, k) => {
      ctx.fillStyle = c;
      ctx.fillRect(box.x + k * s * 1.25, box.y + (box.h - s) / 2, s, s);
      ctx.strokeStyle = MUTED;
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.strokeRect(box.x + k * s * 1.25, box.y + (box.h - s) / 2, s, s);
    });
  };
  if (shape === "ribbon") {
    ctx.fillStyle = p.kit.shirt;
    ctx.fillRect(0, 0, h * 1.6, h);
    label(
      ctx,
      number,
      { x: 0, y: area.y, w: h * 1.6, h: area.h },
      {
        family: "data",
        color: p.kit.trim,
      },
      "center",
    );
    const text = `${kicker}   ·   ${p.name.toUpperCase()}   ·   ${p.club.toUpperCase()}`;
    label(
      ctx,
      text,
      { x: h * 2.2, y: area.y, w: w - h * 2.2 - h * 4.5, h: area.h },
      {
        family: "display",
        color: CHALK,
        min: area.h * 0.5,
      },
    );
    swatches({ x: w - h * 4, y: area.y, w: h * 3.8, h: area.h * 0.8 });
    return;
  }
  const tall = shape === "tall";
  // A band of his shirt colour behind the number.
  ctx.fillStyle = p.kit.shirt;
  if (tall) ctx.fillRect(0, 0, w, h * 0.42);
  else ctx.fillRect(0, 0, w * 0.4, h);
  const numBox = tall
    ? { x: area.x, y: area.y, w: area.w, h: h * 0.42 - 2 * pad }
    : { x: area.x, y: area.y, w: w * 0.4 - 2 * pad, h: area.h };
  label(ctx, number, numBox, { family: "data", color: p.kit.trim, max: numBox.h * 0.8 }, "center");
  const info = tall
    ? { x: area.x, y: h * 0.42 + pad, w: area.w, h: h * 0.58 - 2 * pad }
    : { x: w * 0.4 + pad, y: area.y, w: w * 0.6 - 2 * pad, h: area.h };
  const unit = tall ? info.w : info.h;
  let y = info.y;
  y += label(
    ctx,
    kicker,
    { x: info.x, y, w: info.w, h: unit * (tall ? 0.14 : 0.09) },
    {
      family: "data",
      color: ACCENT,
    },
  );
  y += unit * 0.04;
  const [first, ...rest] = p.name.split(" ");
  const last = rest.join(" ") || first;
  if (tall) {
    y += label(
      ctx,
      first.toUpperCase(),
      { x: info.x, y, w: info.w, h: unit * 0.24 },
      {
        family: "display",
        color: CHALK,
      },
    );
    y += label(
      ctx,
      last.toUpperCase(),
      { x: info.x, y, w: info.w, h: unit * 0.3 },
      {
        family: "display",
        color: CHALK,
      },
    );
  } else {
    y += label(
      ctx,
      p.name.toUpperCase(),
      { x: info.x, y, w: info.w, h: unit * 0.22 },
      {
        family: "display",
        color: CHALK,
      },
    );
  }
  y += unit * 0.04;
  y += label(
    ctx,
    p.club,
    { x: info.x, y, w: info.w, h: unit * (tall ? 0.14 : 0.1) },
    {
      family: "display",
      color: MUTED,
      weight: 600,
    },
  );
  y += unit * 0.06;
  swatches({ x: info.x, y, w: info.w * (tall ? 0.8 : 0.4), h: unit * (tall ? 0.18 : 0.1) });
}

/** The tactical board at the moment: the pitch, everyone where they were, his pass. */
export function drawTactical(
  ctx: Ctx,
  w: number,
  h: number,
  shape: ScreenShape,
  still: TacticalStill,
) {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(0, 0, w, h);
  const pad = padOf(w, h, shape);
  const area = inset(w, h, pad);
  if (shape === "ribbon") {
    label(ctx, `${still.kicker}   ·   ${still.title}`, area, { family: "display", color: CHALK });
    return;
  }
  const tall = shape === "tall";
  const head = tall ? area.w * 0.42 : area.h * 0.16;
  label(
    ctx,
    still.kicker,
    { x: area.x, y: area.y, w: area.w, h: head * 0.45 },
    {
      family: "data",
      color: ACCENT,
    },
  );
  label(
    ctx,
    still.title,
    { x: area.x, y: area.y + head * 0.5, w: area.w, h: head * 0.5 },
    {
      family: "display",
      color: CHALK,
    },
  );
  const room = { x: area.x, y: area.y + head + pad * 0.5, w: area.w, h: area.h - head - pad * 0.5 };
  // The pitch, 105 x 68 m plus a margin, as large as fits: lengthways down a tall screen.
  const L = 105;
  const W = 68;
  const along = tall ? room.h : room.w;
  const across = tall ? room.w : room.h;
  const s = Math.min(along / (L + 4), across / (W + 4));
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const at = (x: number, y: number): [number, number] =>
    tall ? [cx - y * s, cy - x * s] : [cx + x * s, cy - y * s];
  const [x0, y0] = at(-L / 2, -W / 2);
  const [x1, y1] = at(L / 2, W / 2);
  const field = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)] as const;
  ctx.fillStyle = "#16301f";
  ctx.fillRect(...field);
  ctx.strokeStyle = "rgba(239,237,229,0.55)";
  ctx.lineWidth = Math.max(1, s * 0.25);
  ctx.strokeRect(...field);
  const line = (a: [number, number], b: [number, number]) => {
    ctx.beginPath();
    ctx.moveTo(...at(...a));
    ctx.lineTo(...at(...b));
    ctx.stroke();
  };
  line([0, -34], [0, 34]);
  ctx.beginPath();
  ctx.arc(...at(0, 0), 9.15 * s, 0, 2 * Math.PI);
  ctx.stroke();
  for (const g of [-1, 1]) {
    line([g * 52.5, -20.16], [g * 36, -20.16]);
    line([g * 36, -20.16], [g * 36, 20.16]);
    line([g * 36, 20.16], [g * 52.5, 20.16]);
  }
  // His pass: dashed, in the accent, with a head.
  if (still.pass) {
    const [fx, fy] = at(...still.pass.from);
    const [tx, ty] = at(...still.pass.to);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(2, s * 0.5);
    ctx.setLineDash([s * 1.6, s * 1.1]);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    const a = Math.atan2(ty - fy, tx - fx);
    const k = s * 2.4;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - k * Math.cos(a - 0.45), ty - k * Math.sin(a - 0.45));
    ctx.lineTo(tx - k * Math.cos(a + 0.45), ty - k * Math.sin(a + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  const r = Math.max(5, s * 1.5);
  const px = Math.max(6, r * 1.05);
  for (const p of still.players) {
    const [x, y] = at(p.x, p.y);
    const colour = p.keeper ? GK_KITS[p.team].shirt : p.team === 0 ? COLORS.home : COLORS.away;
    if (p.id === still.hero || p.id === still.pass?.receiver) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = Math.max(2, r * 0.3);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    if (px < 8) continue; // too small to read: the dot alone
    ctx.font = fontOf(px, "data");
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.number), x, y + px * 0.04);
  }
  const [bx, by] = at(...still.ball);
  ctx.fillStyle = CHALK;
  ctx.beginPath();
  ctx.arc(bx, by, Math.max(3, r * 0.45), 0, 2 * Math.PI);
  ctx.fill();
}

/** A sponsor's generated wordmark: a geometric mark and the name. */
export function drawSponsor(ctx: Ctx, w: number, h: number, shape: ScreenShape, s: Sponsor) {
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, w, h);
  const pad = padOf(w, h, shape);
  const area = inset(w, h, pad);
  if (shape === "ribbon") {
    // The wordmark repeated along the ribbon, as a ribbon board runs it.
    const size = area.h;
    const text = `${s.name}   ·   ${s.line}`;
    const px = fitSize(ctx, text, w / 2 - size * 3, area.h * 0.8, area.h * 0.4, "display");
    if (px === null) return;
    ctx.font = fontOf(px, "display");
    const unitW = size * 1.6 + ctx.measureText(text).width + size * 2.5;
    for (let x = pad; x + unitW <= w; x += unitW) {
      mark(ctx, s, { x, y: area.y, w: size, h: size });
      ctx.font = fontOf(px, "display");
      ctx.fillStyle = s.fg;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + size * 1.6, area.y + area.h / 2);
    }
    return;
  }
  const tall = shape === "tall";
  const markSize = tall ? area.w * 0.7 : area.h * 0.34;
  if (tall) {
    mark(ctx, s, { x: area.x + (area.w - markSize) / 2, y: area.y, w: markSize, h: markSize });
    let y = area.y + markSize + pad;
    for (const word of s.name.split(" ")) {
      y += label(
        ctx,
        word,
        { x: area.x, y, w: area.w, h: area.w * 0.34 },
        {
          family: "display",
          color: s.fg,
        },
        "center",
      );
    }
    y += pad * 0.5;
    block(
      ctx,
      s.line,
      { x: area.x, y, w: area.w, h: area.y + area.h - y - area.w * 0.2 },
      {
        family: "display",
        color: s.accent,
        max: area.w * 0.15,
        min: 10,
        weight: 600,
      },
    );
  } else {
    const y0 = area.y + area.h * 0.12;
    mark(ctx, s, { x: area.x + (area.w - markSize) / 2, y: y0, w: markSize, h: markSize });
    const y1 = y0 + markSize + area.h * 0.06;
    const used = label(
      ctx,
      s.name,
      { x: area.x, y: y1, w: area.w, h: area.h * 0.2 },
      {
        family: "display",
        color: s.fg,
      },
      "center",
    );
    label(
      ctx,
      s.line,
      { x: area.x, y: y1 + used + area.h * 0.03, w: area.w, h: area.h * 0.1 },
      {
        family: "display",
        color: s.accent,
        weight: 600,
      },
      "center",
    );
  }
  // Every sponsor screen says what it is.
  const tagH = tall ? area.w * 0.1 : area.h * 0.06;
  label(
    ctx,
    FICTIONAL_SPONSOR,
    { x: area.x, y: area.y + area.h - tagH, w: area.w, h: tagH },
    {
      family: "data",
      color: s.fg,
      weight: 600,
    },
    tall ? "center" : "right",
  );
}

/** The sponsor's mark inside a square `box`. */
function mark(ctx: Ctx, s: Sponsor, box: Box) {
  const r = box.w / 2;
  const cx = box.x + r;
  const cy = box.y + box.h / 2;
  ctx.strokeStyle = s.accent;
  ctx.fillStyle = s.accent;
  ctx.lineWidth = r * 0.18;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (s.mark) {
    case "wave":
      // Three swells, one above the other.
      for (const dy of [-0.45, 0, 0.45]) {
        const y = cy + dy * r;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.8, y);
        ctx.quadraticCurveTo(cx - r * 0.4, y - r * 0.28, cx, y);
        ctx.quadraticCurveTo(cx + r * 0.4, y + r * 0.28, cx + r * 0.8, y);
        ctx.stroke();
      }
      break;
    case "chevron":
      for (const dy of [-0.3, 0.25]) {
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.7, cy + (dy + 0.3) * r);
        ctx.lineTo(cx, cy + (dy - 0.25) * r);
        ctx.lineTo(cx + r * 0.7, cy + (dy + 0.3) * r);
        ctx.stroke();
      }
      break;
    case "leaf":
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.85);
      ctx.quadraticCurveTo(cx + r * 0.9, cy, cx, cy + r * 0.85);
      ctx.quadraticCurveTo(cx - r * 0.9, cy, cx, cy - r * 0.85);
      ctx.fill();
      ctx.strokeStyle = s.bg;
      ctx.lineWidth = r * 0.08;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.6);
      ctx.lineTo(cx, cy + r * 0.7);
      ctx.stroke();
      break;
  }
}
