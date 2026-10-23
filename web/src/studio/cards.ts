// Data cards (SPEC 7): a moment's verified numbers on a still, in three sizes (square, 9:16 story,
// 16:9), each saved as a PNG. `cardSpec` is the pure part: which numbers, in which words; `drawCard`
// paints a spec on a 2D canvas (no blur, no gradients, no animation); `cardBlob` and
// `downloadBlob` turn it into a file. The numbers are supported claims' values, as FACTS in
// posts.ts reads them; a card with no number to show says so instead of inventing one.

import { CLUBS, shortName } from "../data/roster";
import type { Narration } from "../narration/payload";
import { checked, allowedNumbers, clubOf, type PostLanguage } from "./posts";

export type CardSize = "square" | "story" | "wide";
export const CARD_SIZES: readonly CardSize[] = ["square", "story", "wide"];

export const CARD_DIMENSIONS: Record<CardSize, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: "Square" },
  story: { width: 1080, height: 1920, label: "9:16 story" },
  wide: { width: 1920, height: 1080, label: "16:9" },
};

export interface Stat {
  value: string; // the number as shown, with its unit
  label: string;
}

export interface CardSpec {
  size: CardSize;
  width: number;
  height: number;
  kicker: string;
  title: string;
  stats: Stat[];
  empty: string | null; // said when no supported claim has a number to show
  footer: string;
}

interface StatTemplate {
  claim: string;
  key: string;
  decimals: number;
  unit: string;
  label: Record<PostLanguage, (hero: string, runner: string | null) => string>;
  needsRunner?: boolean;
}

/** The numbers a card shows, in the order it prefers them. */
const STATS: readonly StatTemplate[] = [
  {
    claim: "belief_error",
    key: "err",
    decimals: 1,
    unit: " m",
    needsRunner: true,
    label: {
      en: (_h, r) => `his picture of ${r} was off by`,
      zh: (_h, r) => `对${r}位置的判断偏差`,
    },
  },
  {
    claim: "cf_belief_error",
    key: "err",
    decimals: 1,
    unit: " m",
    needsRunner: true,
    label: {
      en: (_h, r) => `without the look, the picture of ${r} would be off by`,
      zh: (_h, r) => `没有那一眼，对${r}的偏差会达到`,
    },
  },
  {
    claim: "cf_value",
    key: "dxt",
    decimals: 2,
    unit: " xT",
    label: {
      en: () => "what the look was worth, in expected threat",
      zh: () => "那一眼价值的预期威胁",
    },
  },
  {
    claim: "pass_success",
    key: "p_true",
    decimals: 2,
    unit: "",
    label: { en: () => "chance the pass arrived", zh: () => "传球实际成功率" },
  },
  {
    claim: "scans_before_reception",
    key: "n",
    decimals: 0,
    unit: "",
    label: { en: () => "scans before receiving", zh: () => "接球前回头观察次数" },
  },
  {
    claim: "gap_to_nearest_opponent",
    key: "gap",
    decimals: 1,
    unit: " m",
    needsRunner: true,
    label: {
      en: (_h, r) => `${r} from the nearest opponent`,
      zh: (_h, r) => `${r}离最近对手的距离`,
    },
  },
  {
    claim: "gap_opened",
    key: "gain",
    decimals: 1,
    unit: " m",
    needsRunner: true,
    label: {
      en: (_h, r) => `${r} opened up on his marker`,
      zh: (_h, r) => `${r}拉开与盯防者的距离`,
    },
  },
  {
    claim: "observed_share",
    key: "share",
    decimals: 0,
    unit: "%",
    label: { en: () => "of the opponents' space he saw", zh: () => "他看到的对手控制区域" },
  },
  {
    claim: "pass_speed",
    key: "kmh",
    decimals: 1,
    unit: " km/h",
    label: { en: () => "pass speed", zh: () => "传球时速" },
  },
];

const COPY = {
  en: {
    kicker: "THROUGH THEIR EYES",
    title: (hero: string) => `Through ${hero}'s eyes`,
    empty: "No verified number for this moment.",
    footer: (home: string, away: string) => `${home} v ${away} · synthetic match`,
  },
  zh: {
    kicker: "他的视角",
    title: (hero: string) => `透过${hero}的眼睛`,
    empty: "这一刻没有可展示的已验证数字。",
    footer: (home: string, away: string) => `${home}对${away} · 合成比赛`,
  },
} satisfies Record<PostLanguage, unknown>;

const MAX_STATS = 3;

export function cardSpec(
  narration: Narration,
  heroId: string,
  runnerId: string | null,
  size: CardSize,
  lang: PostLanguage,
): CardSpec {
  const hero = shortName(heroId, lang);
  const runner = runnerId ? shortName(runnerId, lang) : null;
  const allowed = allowedNumbers(narration);
  const stats: Stat[] = [];
  for (const t of STATS) {
    if (stats.length >= MAX_STATS) break;
    const claim = narration.claims.get(t.claim);
    const raw = claim?.verdict === "supported" ? claim.values[t.key] : undefined;
    if (typeof raw !== "number" || (t.needsRunner && !runner)) continue;
    const value = `${raw.toFixed(t.decimals)}${t.unit}`;
    if (!checked(value, allowed)) continue;
    stats.push({ value, label: t.label[lang](hero, runner) });
  }
  const copy = COPY[lang];
  const heroClub = clubOf(heroId);
  const club = (t: 0 | 1) => (lang === "zh" ? CLUBS[t].zh : CLUBS[t].name);
  const { width, height } = CARD_DIMENSIONS[size];
  return {
    size,
    width,
    height,
    kicker: copy.kicker,
    title: copy.title(hero),
    stats,
    empty: stats.length ? null : copy.empty,
    footer: copy.footer(club(heroClub), club(heroClub === 0 ? 1 : 0)),
  };
}

/** The file name of a card: stable for the same moment, size and language. */
export const momentSlug = (moment: string): string =>
  moment.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const cardFileName = (moment: string, size: CardSize, lang: PostLanguage): string =>
  `${momentSlug(moment)}-${size}-${lang}.png`;

// ----- Painting ----------------------------------------------------------------------------------

// The app's palette (styles.css :root), as plain values: a canvas has no CSS variables.
const NIGHT = "#080e0b";
const RAISED = "#0f1513";
const CHALK = "#efede5";
const CHALK_2 = "#b6b8b1";
const FLOODLIGHT = "#f6d566";
const LINE = "rgba(239, 237, 229, 0.12)";
const DISPLAY = '"Newsreader", "Iowan Old Style", Georgia, "PingFang SC", "Microsoft YaHei", serif';
const BODY = '"Geist", "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif';

/** The 2D calls a card needs: the canvas's own context satisfies it, and a test can record it. */
export type Paint = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "strokeRect"
  | "fillText"
  | "measureText"
  | "beginPath"
  | "arc"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "save"
  | "restore"
> & {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textBaseline: unknown;
  textAlign: unknown;
};

/** Words (or Chinese characters) onto lines no wider than `maxWidth`. */
export function wrap(p: Pick<Paint, "measureText">, text: string, maxWidth: number): string[] {
  const tokens = /\s/.test(text) ? text.split(/\s+/) : [...text];
  const glue = /\s/.test(text) ? " " : "";
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const next = line ? `${line}${glue}${token}` : token;
    if (line && p.measureText(next).width > maxWidth) {
      lines.push(line);
      line = token;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCard(p: Paint, spec: CardSpec): void {
  const { width: w, height: h } = spec;
  const wide = spec.size === "wide";
  const pad = Math.round(Math.min(w, h) * 0.08);
  const unit = Math.min(w, h) / 1080;
  p.fillStyle = NIGHT;
  p.fillRect(0, 0, w, h);

  // The pitch's halfway line and centre circle, a quiet motif behind the numbers.
  p.strokeStyle = LINE;
  p.lineWidth = 3 * unit;
  p.beginPath();
  p.moveTo(w / 2, 0);
  p.lineTo(w / 2, h);
  p.stroke();
  p.beginPath();
  p.arc(w / 2, h / 2, 0.22 * Math.min(w, h), 0, Math.PI * 2);
  p.stroke();
  p.strokeRect(pad / 2, pad / 2, w - pad, h - pad);

  p.textBaseline = "alphabetic";
  p.textAlign = "left";
  p.fillStyle = FLOODLIGHT;
  p.font = `600 ${Math.round(30 * unit)}px ${BODY}`;
  p.fillText(spec.kicker, pad, pad + 30 * unit);

  p.fillStyle = CHALK;
  p.font = `500 ${Math.round(88 * unit)}px ${DISPLAY}`;
  const titleWidth = wide ? w * 0.5 - pad : w - 2 * pad;
  let y = pad + 150 * unit;
  for (const line of wrap(p, spec.title, titleWidth)) {
    p.fillText(line, pad, y);
    y += 100 * unit;
  }

  const area = wide
    ? { x: w * 0.5 + pad / 2, y: pad + 40 * unit, width: w * 0.5 - 1.5 * pad }
    : { x: pad, y: y + 40 * unit, width: w - 2 * pad };
  let top = area.y;
  if (spec.empty) {
    p.fillStyle = CHALK_2;
    p.font = `400 ${Math.round(40 * unit)}px ${BODY}`;
    p.fillText(spec.empty, area.x, top + 40 * unit);
  }
  const tile = 250 * unit;
  for (const stat of spec.stats) {
    p.fillStyle = RAISED;
    p.fillRect(area.x, top, area.width, tile);
    p.fillStyle = FLOODLIGHT;
    p.fillRect(area.x, top, 8 * unit, tile);
    p.fillStyle = CHALK;
    p.font = `600 ${Math.round(112 * unit)}px ${DISPLAY}`;
    p.fillText(stat.value, area.x + 40 * unit, top + 130 * unit);
    p.fillStyle = CHALK_2;
    p.font = `400 ${Math.round(34 * unit)}px ${BODY}`;
    let ly = top + 185 * unit;
    for (const line of wrap(p, stat.label, area.width - 80 * unit).slice(0, 2)) {
      p.fillText(line, area.x + 40 * unit, ly);
      ly += 40 * unit;
    }
    top += tile + 24 * unit;
  }

  p.fillStyle = CHALK_2;
  p.font = `400 ${Math.round(30 * unit)}px ${BODY}`;
  p.fillText(spec.footer, pad, h - pad);
}

// ----- Files -------------------------------------------------------------------------------------

/** A canvas as the card needs it: size, a 2D context and a PNG out. A test passes its own. */
export interface CardCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): Paint | null;
  toBlob(done: (blob: Blob | null) => void, type: string): void;
}

const pageCanvas = (): CardCanvas => document.createElement("canvas") as unknown as CardCanvas;

/** The card as a PNG. Rejects when the browser has no 2D canvas or gives no image. */
export function cardBlob(spec: CardSpec, make: () => CardCanvas = pageCanvas): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = make();
    canvas.width = spec.width;
    canvas.height = spec.height;
    const paint = canvas.getContext("2d");
    if (!paint) return reject(new Error("this browser has no 2D canvas"));
    drawCard(paint, spec);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png");
  });
}

/** Save `blob` as `name` through a download link (what a click on "Download" does). */
export function downloadBlob(blob: Blob, name: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
