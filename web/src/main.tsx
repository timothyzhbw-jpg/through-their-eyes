// Entry point: load the hero export, pick the plan, build the session, render.
//
// URL parameters (for testing and filming):
//   ?plan=invalid   load a deliberately broken plan to show the template fallback
//   ?autoplay=0     do not start the breakdown on load

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadHero } from "./data/hero";
import { EXAMPLE_PLAN, EXAMPLE_SCRIPT, INVALID_PLAN } from "./plan/example";
import { SessionContext, createSession } from "./session";
import "./styles.css";

const DATA_URL = `${import.meta.env.BASE_URL}data/hero_seed3.json`;

async function main() {
  const root = createRoot(document.getElementById("root")!);
  const params = new URLSearchParams(window.location.search);
  try {
    // Canvas textures draw shirt numbers with the web fonts, so wait for them (briefly).
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    const hero = await loadHero(DATA_URL);
    const plan = params.get("plan") === "invalid" ? INVALID_PLAN : EXAMPLE_PLAN;
    const session = createSession(hero, plan, EXAMPLE_SCRIPT);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const autoplay = params.get("autoplay") !== "0" && !reducedMotion;
    root.render(
      <StrictMode>
        <SessionContext.Provider value={session}>
          <App autoplay={autoplay} />
        </SessionContext.Provider>
      </StrictMode>,
    );
  } catch (err) {
    root.render(
      <p className="load-error">
        Could not load the match data: {err instanceof Error ? err.message : String(err)}
      </p>,
    );
  }
}

void main();
