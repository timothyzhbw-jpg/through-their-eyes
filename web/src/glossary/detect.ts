import { TERMS, type GlossaryTerm, type Language } from "./terms";

export type GlossaryPart =
  | { kind: "text"; text: string; term?: undefined }
  | { kind: "term"; text: string; term: GlossaryTerm };

interface Pattern {
  source: string;
  term: GlossaryTerm;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ascii = (text: string) => /^[\x00-\x7F]*$/.test(text);

function patternFor(alias: string, term: GlossaryTerm): Pattern {
  const words = alias
    .split(/[\s\-‐‑‒–—]+/)
    .map(escape)
    .join("[\\s\\-‐‑‒–—]+");
  const bounded = ascii(alias) ? `(?<![\\p{L}\\p{N}_])${words}(?![\\p{L}\\p{N}_])` : words;
  return { source: bounded, term };
}

const PATTERNS = new Map<Language, { regex: RegExp; patterns: Pattern[] }>(
  (["en", "zh"] as const).map((language) => {
    const patterns = TERMS.flatMap((term) =>
      term.aliases[language].map((alias) => patternFor(alias, term)),
    ).sort((a, b) => b.source.length - a.source.length);
    return [
      language,
      { regex: new RegExp(patterns.map((p) => p.source).join("|"), "giu"), patterns },
    ];
  }),
);

/** Split visible prose at whole glossary terms, without touching other words. */
export function detectTerms(text: string, language: Language = "en"): GlossaryPart[] {
  const { regex, patterns } = PATTERNS.get(language)!;
  const parts: GlossaryPart[] = [];
  let at = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index;
    if (index > at) parts.push({ kind: "text", text: text.slice(at, index) });
    const term = patterns.find((p) => new RegExp(`^(?:${p.source})$`, "iu").test(match[0]))!.term;
    parts.push({ kind: "term", text: match[0], term });
    at = index + match[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}
