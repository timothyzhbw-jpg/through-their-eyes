// Club names do not break across lines: "Corvane / Vale 0." left a lone word on the full-time
// card. The text is unchanged; each name in it is a span the browser will not wrap inside.

import { Fragment, type ReactNode } from "react";

/** `text` with every occurrence of `phrases` wrapped so it stays on one line. */
export function keepTogether(text: string, phrases: readonly string[]): ReactNode[] {
  const found = phrases.filter((p) => p.includes(" ") && text.includes(p));
  if (!found.length) return [text];
  const escape = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${found.map(escape).join("|")})`));
  return parts.map((part, k) =>
    found.includes(part) ? (
      <span key={k} className="nowrap">
        {part}
      </span>
    ) : (
      <Fragment key={k}>{part}</Fragment>
    ),
  );
}
