// Where the tour card goes. On a phone it is a sheet across the width (16 px gutters); on a wider
// screen a narrow card. It never leaves the screen, never covers its target when there is room,
// and keeps clear of what the step wants seen (the caption, the moment card, Your call's card).
// Candidates: next to the target (the side away from the screen's middle first), then the screen's
// edges; each is scored by what it covers (area × weight) plus a little for its distance from the
// target, and the lowest wins.

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Something on screen the card should not cover, and how much that matters. */
export interface Keep {
  box: Box;
  weight: number;
}

export const GUTTER = 16;
export const PHONE_MAX = 640; // narrower than this: the phone sheet
const CARD_W = 400;
const GAP = 16; // between the target's ring and the card
const TARGET_WEIGHT = 50;
const DISTANCE_WEIGHT = 10; // per px from the target's centre: near wins among equals

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export function placeCard(
  target: Box | null,
  view: Size,
  card: Size,
  keep: Keep[] = [],
): { top: number; left: number; width: number } {
  const phone = view.w < PHONE_MAX;
  const width = phone ? view.w - 2 * GUTTER : Math.min(CARD_W, view.w - 2 * GUTTER);
  const h = card.h;
  const lowest = view.h - h - GUTTER;
  const centre = (view.w - width) / 2;
  if (!target) return { top: clamp(lowest, GUTTER, lowest), left: phone ? GUTTER : centre, width };

  const candidates: { top: number; left: number }[] = [];
  const x = phone
    ? GUTTER
    : clamp(target.left + target.width / 2 - width / 2, GUTTER, view.w - GUTTER - width);
  const below = target.top + target.height + GAP;
  const above = target.top - GAP - h;
  const upper = target.top + target.height / 2 < view.h / 2;
  for (const top of upper ? [below, above] : [above, below]) candidates.push({ top, left: x });
  if (!phone) {
    const top = clamp(target.top, GUTTER, lowest);
    const leftward = target.left + target.width / 2 > view.w / 2;
    const sides = [target.left - GAP - width, target.left + target.width + GAP];
    for (const left of leftward ? sides : sides.reverse()) candidates.push({ top, left });
  }
  const xs = phone ? [GUTTER] : [GUTTER, centre, view.w - GUTTER - width];
  for (const top of [lowest, (view.h - h) / 2, GUTTER]) {
    for (const left of xs) candidates.push({ top, left });
  }

  const fits = (c: { top: number; left: number }) =>
    c.left >= GUTTER - 0.5 &&
    c.left + width <= view.w - GUTTER + 0.5 &&
    c.top >= GUTTER - 0.5 &&
    c.top + h <= view.h - GUTTER + 0.5;
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const avoid = [{ box: target, weight: TARGET_WEIGHT }, ...keep];
  let best: { top: number; left: number } | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (!fits(c)) continue;
    const box = { top: c.top, left: c.left, width, height: h };
    const covered = avoid.reduce((s, k) => s + k.weight * overlap(box, k.box), 0);
    const distance = Math.hypot(c.left + width / 2 - cx, c.top + h / 2 - cy);
    const score = covered + DISTANCE_WEIGHT * distance;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  // A card taller than the screen: from the top, scrolled by its reader.
  return { ...(best ?? { top: GUTTER, left: phone ? GUTTER : centre }), width };
}

/** Is the box fully on screen? A step scrolls its target into view when it is not. */
export function onScreen(box: Box, view: Size): boolean {
  return (
    box.top >= 0 &&
    box.left >= 0 &&
    box.top + box.height <= view.h &&
    box.left + box.width <= view.w
  );
}
