// One chapter of the moment's story (the Floodlit design's story page): a numbered mono kicker, a
// serif title whose last words are italic, a lede in plain words, the mechanism behind "How it
// works" for whoever wants it, then the chapter's own figure. No boxes: the chapters are set like a
// magazine, separated by space and a hairline.

import type { ReactNode } from "react";
import { useReveal } from "./reveal";
import { TextReveal } from "./TextReveal";

export function Chapter(props: {
  className: string; // the panel's own class (narration, breakdown, …): scripts find it by it
  kicker: string; // what the chapter is, in a few words; CSS numbers it
  title: ReactNode;
  lede?: ReactNode;
  how?: ReactNode; // the mechanism and its terms, folded under the lede ("How it works")
  aside?: ReactNode; // controls and badges under the lede
  split?: boolean; // the head as a sticky column on the left, the body on the right
  label?: string; // the section's accessible name; defaults to the kicker
  children: ReactNode;
}) {
  const chapter = useReveal<HTMLElement>();
  return (
    <section
      className={`panel chapter ${props.className}${props.split ? " split" : ""}`}
      aria-label={props.label ?? props.kicker}
      ref={chapter}
    >
      <header className="chapter-head">
        <div className="chapter-title">
          <p className="kicker">{props.kicker}</p>
          <h2>
            <TextReveal>{props.title}</TextReveal>
          </h2>
        </div>
        {(props.lede || props.how || props.aside) && (
          <div className="chapter-lede">
            {props.lede && (
              <p className="lede">
                <TextReveal>{props.lede}</TextReveal>
              </p>
            )}
            {props.how && <HowItWorks>{props.how}</HowItWorks>}
            {props.aside}
          </div>
        )}
      </header>
      <div className="chapter-body">{props.children}</div>
    </section>
  );
}

/** The terms and the mechanism, on demand: plain words first, jargon one tap away. */
export function HowItWorks({ children }: { children: ReactNode }) {
  return (
    <details className="how">
      <summary>How it works</summary>
      <div className="how-body">{children}</div>
    </details>
  );
}

/** A title whose last words are set in italic: <Title lead="Take the look" em="away." />. */
export function Title({ lead, em }: { lead: string; em: string }) {
  return (
    <>
      {lead} <em>{em}</em>
    </>
  );
}
