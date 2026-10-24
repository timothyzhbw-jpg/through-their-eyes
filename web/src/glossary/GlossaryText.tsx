import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { contextLine, type ContextClaim } from "./context";
import { detectTerms } from "./detect";
import { GlossaryContext } from "./GlossaryProvider";
import type { GlossaryTerm } from "./terms";
import "./glossary.css";

export function GlossaryText({
  text,
  claims = [],
}: {
  text: string;
  claims?: readonly ContextClaim[];
}) {
  const { language } = useContext(GlossaryContext);
  const parts = useMemo(() => detectTerms(text, language), [text, language]);
  return parts.map((part, index) =>
    part.term ? (
      <GlossaryTermButton key={index} text={part.text} term={part.term} claims={claims} />
    ) : (
      part.text
    ),
  );
}

function GlossaryTermButton({
  text,
  term,
  claims,
}: {
  text: string;
  term: GlossaryTerm;
  claims: readonly ContextClaim[];
}) {
  const { persona, language } = useContext(GlossaryContext);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const popover = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const restoringFocus = useRef(false);
  const id = useId();
  const label = term.label[language];
  const here = contextLine(term, language, claims);
  const restoreFocus = () => {
    restoringFocus.current = true;
    setOpen(false);
    button.current?.focus({ preventScroll: true });
    restoringFocus.current = false;
  };

  // Keep the popover inside the viewport: measure it at left 0, then shift it back by the overflow.
  useLayoutEffect(() => {
    const node = popover.current;
    if (!open || !node) return;
    node.style.left = "0px";
    const rect = node.getBoundingClientRect();
    const margin = 8;
    const overflow = rect.right - (window.innerWidth - margin);
    const shift = overflow > 0 ? -overflow : Math.max(0, margin - rect.left);
    if (shift !== 0) node.style.left = `${shift}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      restoreFocus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <span
      className="glossary-term-wrap"
      ref={wrap}
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="glossary-term"
        data-glossary-id={term.id}
        aria-label={`${text}: explain ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onFocus={() => {
          if (!restoringFocus.current) setOpen(true);
        }}
        onClick={() => setOpen(true)}
      >
        {text}
      </button>
      {open && (
        <span
          id={id}
          ref={popover}
          className="glossary-popover"
          role="dialog"
          aria-labelledby={`${id}-title`}
          lang={language}
        >
          <span className="glossary-popover-head">
            <strong id={`${id}-title`}>{label}</strong>
            <button
              type="button"
              className="glossary-close"
              aria-label={`Close ${label} explanation`}
              onClick={restoreFocus}
            >
              ×
            </button>
          </span>
          <span className="glossary-definition">{term.definition[language]}</span>
          {persona === "analyst" && term.analyst && (
            <span className="glossary-analyst">{term.analyst[language]}</span>
          )}
          {here && <span className="glossary-context">{here}</span>}
        </span>
      )}
    </span>
  );
}
