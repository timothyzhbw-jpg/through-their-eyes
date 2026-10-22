// Photosensitivity guard (SPEC 10): count flashes in the encoded film the way WCAG 2.3.1
// ("Three Flashes or Below Threshold") defines them, so a cut that strobes fails the run.
//
// A general flash is a pair of opposing changes in relative luminance of at least 10% of the
// maximum, where the darker image is below 0.80. A red flash is a pair of opposing transitions
// into or out of saturated red. No more than three of either in any one-second window.
// The film is measured as frame averages over the whole picture and over each quarter of it
// (a flash in a quarter of the screen is a large enough area to count).

/** sRGB 0..255 → linear 0..1. */
function linear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (WCAG) of an sRGB colour 0..255. */
export function luminance(r, g, b) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG's saturated red: R / (R + G + B) ≥ 0.8 in linear light. */
export function isSaturatedRed(r, g, b) {
  const R = linear(r);
  const sum = R + linear(g) + linear(b);
  return sum > 0.02 && R / sum >= 0.8;
}

/**
 * The changes of a series that count: runs of same-direction movement merged, kept when they
 * swing by `delta` or more and the darker end is below `darkMax`.
 * @param {number[]} values one per frame
 * @returns {Array<{ frame: number, dir: 1 | -1 }>} frame where each counting change ends
 */
export function transitions(values, { delta = 0.1, darkMax = 0.8 } = {}) {
  const out = [];
  if (values.length < 2) return out;
  let start = 0;
  let dir = 0;
  const close = (end) => {
    if (dir === 0) return;
    const a = values[start];
    const b = values[end];
    if (Math.abs(b - a) >= delta && Math.min(a, b) < darkMax) out.push({ frame: end, dir });
  };
  for (let i = 1; i < values.length; i++) {
    const step = Math.sign(values[i] - values[i - 1]);
    if (step === 0) continue;
    if (dir === 0) {
      dir = step;
      start = i - 1;
    } else if (step !== dir) {
      close(i - 1);
      dir = step;
      start = i - 1;
    }
  }
  close(values.length - 1);
  return out;
}

/**
 * Flashes (pairs of opposing changes, the second within a second of the first: a slow fade up
 * and down is not a flash) and the most in any one-second window.
 * @param {Array<{ frame: number, dir: 1 | -1 }>} changes
 * @param {number} fps
 */
export function flashWindows(changes, fps) {
  const flashes = [];
  for (let i = 1; i < changes.length; i++) {
    if (changes[i].dir !== changes[i - 1].dir && changes[i].frame - changes[i - 1].frame <= fps) {
      flashes.push(changes[i].frame);
      i++; // a pair is used up
    }
  }
  let most = 0;
  let at = null;
  for (let i = 0, j = 0; i < flashes.length; i++) {
    while (flashes[i] - flashes[j] >= fps) j++;
    if (i - j + 1 > most) {
      most = i - j + 1;
      at = flashes[j] / fps;
    }
  }
  return { flashes: flashes.length, maxPerSecond: most, at };
}

/**
 * Measure frames given as tiny RGB images (e.g. 32 x 18, from ffmpeg).
 * @param {Buffer} raw rgb24 frames, back to back
 * @param {{ width: number, height: number, fps: number }} size
 */
export function measureFlashes(raw, { width, height, fps }) {
  const frameBytes = width * height * 3;
  const n = Math.floor(raw.length / frameBytes);
  const regions = [
    [0, 0, width, height],
    [0, 0, width / 2, height / 2],
    [width / 2, 0, width, height / 2],
    [0, height / 2, width / 2, height],
    [width / 2, height / 2, width, height],
  ];
  const lum = regions.map(() => new Array(n));
  const red = regions.map(() => new Array(n));
  for (let f = 0; f < n; f++) {
    regions.forEach(([x0, y0, x1, y1], k) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = f * frameBytes + (y * width + x) * 3;
          r += raw[o];
          g += raw[o + 1];
          b += raw[o + 2];
          count++;
        }
      }
      r /= count;
      g /= count;
      b /= count;
      lum[k][f] = luminance(r, g, b);
      red[k][f] = isSaturatedRed(r, g, b) ? 1 : 0;
    });
  }
  let general = { flashes: 0, maxPerSecond: 0, at: null };
  let redFlash = { flashes: 0, maxPerSecond: 0, at: null };
  regions.forEach((_, k) => {
    const g = flashWindows(transitions(lum[k]), fps);
    if (g.maxPerSecond > general.maxPerSecond || g.flashes > general.flashes) general = g;
    // A red flash: into and out of saturated red, each a counting change (delta on the 0/1 series).
    const r = flashWindows(transitions(red[k], { delta: 1, darkMax: 2 }), fps);
    if (r.flashes > redFlash.flashes) redFlash = r;
  });
  return { frames: n, general, red: redFlash };
}
