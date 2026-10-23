// Claim table and {claim.value} slots (SPEC 10). Moved out of capture.mjs so the trailer edit
// fills the same way the capture kit does: a number reaches the picture or the voice only when
// claims.json marks the claim usable (verified breakdown, verdict supported, no conflicting
// values). Anything missing uses a slot-free fallback, or the line / title is dropped.
//
// claims.json is the harvest capture.mjs writes: { site, sources, claims }.

/** @typedef {{ kind?: string, verdict?: string, values: Record<string, string>, usable: boolean, seen: string[], conflict?: unknown[] }} Claim */

/** A well-formed slot. The `g` flag is for callers that scan; `fill` uses a fresh copy. */
export const SLOT = /\{([a-z_]+)\.([a-z_]+)\}/g;

/**
 * Verified claims by id. Values are the strings the evidence card showed.
 * A later sighting that disagrees, or an unsupported verdict, marks the claim unusable.
 * @param {Array<{ persona: string, language: string, verified?: boolean, lines: Array<{ id: string, text: string, claims: Array<{ id: string, verdict?: string, kind?: string, values: Record<string, string> }> }> }>} sources
 * @returns {Record<string, Claim>}
 */
export function claimTable(sources) {
  const table = {};
  for (const src of sources) {
    for (const line of src.lines) {
      for (const c of line.claims) {
        const seen = `${src.persona}/${src.language} ${line.id}: "${line.text}"`;
        const usable = src.verified && c.verdict === "supported";
        const prev = table[c.id];
        if (!prev) {
          table[c.id] = { kind: c.kind, verdict: c.verdict, values: c.values, usable, seen: [seen] };
          continue;
        }
        prev.seen.push(seen);
        prev.usable = prev.usable && usable;
        if (JSON.stringify(prev.values) !== JSON.stringify(c.values)) {
          prev.usable = false;
          prev.conflict = (prev.conflict ?? []).concat([c.values]);
        }
      }
    }
  }
  return table;
}

/**
 * Numbers read off a committed eval report, for slots the live page cannot back (an offline
 * test's result). `facts` is trailer.json's `report_facts`: { id: { file, pattern, values } },
 * `pattern` a regular expression whose groups, in order, are the `values` names. A match is a
 * usable claim of kind "report"; no match leaves the id unusable, so the title takes its fallback.
 * Integers of four digits or more get thousands separators ("2,837").
 * @param {(file: string) => string | null} read the report's text, by repo-relative path
 * @param {Record<string, { file: string, pattern: string, values: string[] }>} facts
 * @returns {Record<string, Claim>}
 */
export function reportFacts(read, facts = {}) {
  const table = {};
  for (const [id, fact] of Object.entries(facts)) {
    const text = read(fact.file);
    const lines = text == null ? [] : text.split("\n");
    const k = lines.findIndex((line) => new RegExp(fact.pattern).test(line));
    if (k < 0) {
      table[id] = { kind: "report", verdict: "missing", values: {}, usable: false, seen: [] };
      continue;
    }
    const m = lines[k].match(new RegExp(fact.pattern));
    const values = Object.fromEntries(
      fact.values.map((name, i) => {
        const raw = m[i + 1];
        return [name, /^\d{4,}$/.test(raw) ? Number(raw).toLocaleString("en-US") : raw];
      }),
    );
    table[id] = { kind: "report", verdict: "supported", values, usable: true, seen: [`${fact.file} L${k + 1}: "${m[0]}"`] };
  }
  return table;
}

/**
 * Replace `{claim.value}` slots. Missing and unusable claims stay as the slot text and are
 * listed in `missing` — this never invents a number.
 * @param {string} text
 * @param {Record<string, Claim> | null | undefined} claims
 * @returns {{ text: string, used: Array<{ slot: string, value: string, seen: string }>, missing: string[] }}
 */
export function fill(text, claims) {
  const used = [];
  const missing = [];
  const filled = text.replace(/\{([a-z_]+)\.([a-z_]+)\}/g, (slot, id, key) => {
    const c = claims?.[id];
    if (c?.usable && c.values && Object.prototype.hasOwnProperty.call(c.values, key)) {
      used.push({ slot, value: c.values[key], seen: c.seen?.[0] ?? "" });
      return String(c.values[key]);
    }
    missing.push(slot);
    return slot;
  });
  return { text: filled, used, missing };
}

/**
 * `fill` for every string inside a title's params (objects and arrays, any depth).
 * @param {unknown} params
 * @param {Record<string, Claim> | null | undefined} claims
 * @returns {{ params: unknown, used: Array<{ slot: string, value: string, seen: string }>, missing: string[] }}
 */
export function fillDeep(params, claims) {
  const used = [];
  const missing = [];
  const walk = (value) => {
    if (typeof value === "string") {
      const result = fill(value, claims);
      used.push(...result.used);
      missing.push(...result.missing);
      return result.text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [key, inner] of Object.entries(value)) out[key] = walk(inner);
      return out;
    }
    return value;
  };
  return { params: walk(params), used, missing };
}

/**
 * The index-th narration line (0-based) of a persona and language in a claims.json document.
 * @param {{ sources?: Array<{ persona: string, language: string, lines?: Array<{ text?: string }> }> } | null | undefined} doc
 * @param {{ persona: string, language: string, index: number }} ref
 * @returns {string | null}
 */
export function narrationText(doc, ref) {
  const src = doc?.sources?.find((s) => s.persona === ref.persona && s.language === ref.language);
  const text = src?.lines?.[ref.index]?.text;
  return typeof text === "string" && text ? text : null;
}

/**
 * A voice-over line, after slots. A `line` reference speaks the app's own narration; a slotted
 * line uses `fallback` (no slots) when a claim is missing; with no fallback the line is dropped.
 * @param {{ id: string, text?: string, fallback?: string, line?: { persona: string, language: string, index: number } }} line
 * @param {Record<string, Claim> | null | undefined} claims
 * @param {{ sources?: unknown[] } | null | undefined} [doc]
 */
export function resolveVo(line, claims, doc) {
  if (line.line) {
    const text = narrationText(doc, line.line);
    if (text == null) {
      const where = `${line.line.persona}/${line.line.language} #${line.line.index}`;
      return {
        drop: true,
        warning: `vo "${line.id}": narration line ${where} is not in claims.json; dropped`,
        used: [],
        missing: [],
      };
    }
    return { drop: false, text, used: [], missing: [], fallback: false, narration: true };
  }
  const filled = fill(line.text ?? "", claims);
  if (!filled.missing.length) {
    return { drop: false, text: filled.text, used: filled.used, missing: [], fallback: false };
  }
  if (typeof line.fallback === "string") {
    if (/\{[a-z_]+\.[a-z_]+\}/.test(line.fallback)) {
      return {
        drop: true,
        warning: `vo "${line.id}": fallback contains a slot; dropped`,
        used: [],
        missing: filled.missing,
      };
    }
    return { drop: false, text: line.fallback, used: [], missing: filled.missing, fallback: true };
  }
  return {
    drop: true,
    warning: `vo "${line.id}": missing ${filled.missing.join(", ")}; no fallback, dropped`,
    used: filled.used,
    missing: filled.missing,
  };
}

/**
 * Title params, after slots. Same drop rule as a voice-over line: fallback params, or drop.
 * @param {{ id?: string, params?: unknown, fallback?: unknown }} title
 * @param {Record<string, Claim> | null | undefined} claims
 */
export function resolveTitle(title, claims) {
  const id = title.id ?? "?";
  const filled = fillDeep(title.params ?? {}, claims);
  if (!filled.missing.length) {
    return { drop: false, params: filled.params, used: filled.used, missing: [], fallback: false };
  }
  if (title.fallback !== undefined) {
    const fb = fillDeep(title.fallback, claims);
    if (fb.missing.length) {
      return {
        drop: true,
        warning: `title "${id}": fallback still has ${fb.missing.join(", ")}; dropped`,
        used: [],
        missing: filled.missing,
      };
    }
    return { drop: false, params: fb.params, used: [], missing: filled.missing, fallback: true };
  }
  return {
    drop: true,
    warning: `title "${id}": missing ${filled.missing.join(", ")}; no fallback, dropped`,
    used: filled.used,
    missing: filled.missing,
  };
}
