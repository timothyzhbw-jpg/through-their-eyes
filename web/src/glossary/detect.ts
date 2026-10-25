import { TERMS, type GlossaryTerm, type Language } from "./terms";

export type GlossaryPart =
  | { kind: "text"; text: string; term?: undefined }
  | { kind: "term"; text: string; term: GlossaryTerm };

interface Pattern {
  source: string;
  alias: string;
  term: GlossaryTerm;
}

/** Key a matched string by its lowercase text, each run of spaces and hyphens as one space. */
const normal = (text: string) => text.toLowerCase().replace(/[\s\-‐‑‒–—]+/g, " ");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ascii = (text: string) => /^[\x00-\x7F]*$/.test(text);

function patternFor(alias: string, term: GlossaryTerm): Pattern {
  const words = alias
    .split(/[\s\-‐‑‒–—]+/)
    .map(escape)
    .join("[\\s\\-‐‑‒–—]+");
  const bounded = ascii(alias) ? `(?<![\\p{L}\\p{N}_])${words}(?![\\p{L}\\p{N}_])` : words;
  return { source: bounded, alias, term };
}

const PATTERNS = new Map<Language, { regex: RegExp; byText: Map<string, GlossaryTerm> }>(
  (["en", "zh"] as const).map((language) => {
    const patterns = TERMS.flatMap((term) =>
      term.aliases[language].map((alias) => patternFor(alias, term)),
    ).sort((a, b) => b.source.length - a.source.length);
    const byText = new Map<string, GlossaryTerm>();
    for (const p of patterns) if (!byText.has(normal(p.alias))) byText.set(normal(p.alias), p.term);
    return [
      language,
      { regex: new RegExp(patterns.map((p) => p.source).join("|"), "giu"), byText },
    ];
  }),
);

/** Split visible prose at whole glossary terms, without touching other words. */
export function detectTerms(text: string, language: Language = "en"): GlossaryPart[] {
  const { regex, byText } = PATTERNS.get(language)!;
  const parts: GlossaryPart[] = [];
  let at = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index;
    if (index > at) parts.push({ kind: "text", text: text.slice(at, index) });
    const term = byText.get(normal(match[0]))!;
    parts.push({ kind: "term", text: match[0], term });
    at = index + match[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}
