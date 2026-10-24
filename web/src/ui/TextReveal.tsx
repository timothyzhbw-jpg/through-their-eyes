import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { usePrefersReducedMotion, useTextReveal } from "./reveal";

function words(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return String(child)
        .split(/(\s+)/)
        .map((part, index) =>
          part.trim() ? (
            <span className="scroll-word" key={`${index}-${part}`}>
              {part}
            </span>
          ) : (
            part
          ),
        );
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      return cloneElement(child, undefined, words(child.props.children));
    }
    return child;
  });
}

/** Scroll-linked visual words; the ordinary inline text remains in the accessibility tree. */
export function TextReveal({ children }: { children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const ref = useTextReveal<HTMLSpanElement>(reduced);
  return (
    <span className="scroll-text" ref={ref}>
      {words(children)}
    </span>
  );
}
