// A segmented control of the Floodlit design: a pill of pressed-state buttons with a thumb that
// springs to the chosen one. Each button is a native toggle (aria-pressed); the group has a name.

import type { CSSProperties, ReactNode } from "react";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  lang?: string;
  disabled?: boolean;
  className?: string;
}

export function Segmented<T extends string>(props: {
  label: string; // the group's accessible name
  options: Segment<T>[];
  value: T | null;
  onPick: (value: T) => void;
  className?: string;
  title?: string;
}) {
  const { options, value } = props;
  const index = options.findIndex((o) => o.value === value);
  const chosen = options[index];
  const style = { "--n": options.length, "--i": Math.max(0, index) } as CSSProperties;
  return (
    <div
      className={["seg", props.className, chosen?.className ? `on-${chosen.className}` : ""]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label={props.label}
      title={props.title}
      style={style}
    >
      {index >= 0 && <span className="seg-thumb" aria-hidden="true" />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.className}
          aria-pressed={o.value === value}
          lang={o.lang}
          title={o.title}
          disabled={o.disabled}
          onClick={() => props.onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
