// The chip beside a number saying where it comes from (source.ts): the same chip everywhere a
// number is shown, so "sim", "tracking" and a verified ✓ read as one system.

import { SOURCES, type SourceKind } from "./source";

/** `title` says more about this number when the kind's own words are not enough; `spoken` also
 * reads the title to a screen reader, after the label. */
export function SourceChip(props: { kind: SourceKind; title?: string; spoken?: boolean }) {
  const { label, title: words } = SOURCES[props.kind];
  const title = props.title ?? words;
  return (
    <span
      className={props.kind === "verified" ? "source verified" : "source"}
      data-source={props.kind}
      title={title}
    >
      {label}
      {props.spoken && (
        <span className="sr-only"> ({title.charAt(0).toLowerCase() + title.slice(1)})</span>
      )}
    </span>
  );
}
