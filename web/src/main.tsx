// Entry point: load the hero export, pick the plan, build the session, render.
//
// URL parameters (for testing and filming):
//   ?plan=invalid   load a deliberately broken plan to show the template fallback
//   ?autoplay=0     do not start the breakdown on load

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadHero } from "./data/hero";
import { EXAMPLE_PLAN, INVALID_PLAN } from "./plan/example";
import { SessionContext, createSession } from "./session";
import { loadWhatIfs } from "./whatif/whatif";
import "./styles.css";

const DATA_URL = `${import.meta.env.BASE_URL}data/hero_seed3.json`;
// A fixture until the verifier serves real payloads (sim.export.render_payload_fixture).
const PAYLOAD_URL = `${import.meta.env.BASE_URL}data/fixture_payload_seed3.json`;
// Every option's "What if…?" answer, precomputed by sim.export.export_what_ifs.
const WHAT_IF_URL = `${import.meta.env.BASE_URL}data/whatif_seed3.json`;

/** The payload, or null if it cannot be fetched: the app then runs without captions. */
async function loadPayload(url: string): Promise<unknown> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  const root = createRoot(document.getElementById("root")!);
  const params = new URLSearchParams(window.location.search);
  try {
    // Canvas textures draw shirt numbers with the web fonts, so wait for them (briefly).
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    const [hero, payload, whatIfs] = await Promise.all([
      loadHero(DATA_URL),
      loadPayload(PAYLOAD_URL),
      loadWhatIfs(WHAT_IF_URL),
    ]);
    const plan = params.get("plan") === "invalid" ? INVALID_PLAN : EXAMPLE_PLAN;
    const session = createSession(hero, plan, payload, whatIfs);
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
