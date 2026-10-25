import { createContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Persona } from "../api/client";
import type { Language } from "./terms";

export interface GlossaryPreferences {
  persona: Persona;
  language: Language;
}

const GlossaryContext = createContext<GlossaryPreferences>({ persona: "casual", language: "en" });

export function GlossaryProvider({
  persona,
  language,
  children,
}: GlossaryPreferences & { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const value = useMemo(() => ({ persona, language }), [persona, language]);
  useLayoutEffect(() => {
    const scope = root.current;
    if (!scope) return;
    const mark = () => {
      const seen = new Set<string>();
      for (const button of scope.querySelectorAll<HTMLElement>("[data-glossary-id]")) {
        const id = button.dataset.glossaryId!;
        const first = persona === "casual" && !seen.has(id);
        button.dataset.glossaryFirst = String(first);
        seen.add(id);
      }
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(scope, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-glossary-id"],
    });
    return () => observer.disconnect();
  }, [persona]);
  return (
    <GlossaryContext.Provider value={value}>
      <div ref={root} className="glossary-screen" data-glossary-persona={persona}>
        {children}
      </div>
    </GlossaryContext.Provider>
  );
}

export { GlossaryContext };
