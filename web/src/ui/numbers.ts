// Numbers in a narration line (SPEC 5.3, the Floodlit design). The crew never writes digits: every
// number on air is slot-filled from a value the verifier checked, so in a verified line each
// number, with its unit, is marked for the dotted Floodlight underline. Player ids such as H8 are
// names: a digit right after a letter is not a number.

export interface Part {
  text: string;
  num: boolean;
}

const UNITS = [
  "seconds?",
  "metres?",
  "meters?",
  "km/h",
  "m/s",
  "xT",
  "per ?cent",
  "degrees?",
  "m",
  "s",
];
const NUMBER = new RegExp(
  String.raw`(?<![A-Za-z0-9.])[+−-]?\d+(?:\.\d+)?` +
    String.raw`(?:%|°|-[a-z]+|[秒米次度]|\s(?:${UNITS.join("|")})(?![\p{L}\p{N}]))?`,
  "gu",
);

/** `text` split into plain runs and numbers (with their units); joined, the parts are `text`. */
export function numberParts(text: string): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const m of text.matchAll(NUMBER)) {
    const start = m.index;
    if (start > at) parts.push({ text: text.slice(at, start), num: false });
    parts.push({ text: m[0], num: true });
    at = start + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), num: false });
  return parts;
}
