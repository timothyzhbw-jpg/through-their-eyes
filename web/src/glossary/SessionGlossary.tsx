import type { ReactNode } from "react";
import { useView } from "../session";
import { createStore, useStore } from "../store/store";
import { GlossaryProvider, type GlossaryPreferences } from "./GlossaryProvider";

const NONE = createStore<GlossaryPreferences>({ persona: "casual", language: "en" });

export function SessionGlossary({ children }: { children: ReactNode }) {
  const view = useView();
  const hero = useStore(view.kind === "hero" ? view.breakdown : NONE, (state) => state);
  const match = useStore(view.kind === "match" ? view.recap.state : NONE, (state) => state);
  const { persona, language } = view.kind === "hero" ? hero : match;
  return (
    <GlossaryProvider persona={persona} language={language}>
      {children}
    </GlossaryProvider>
  );
}
