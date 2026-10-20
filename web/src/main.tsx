// Entry point: load the match (from the live service, or the bundled files), pick the plan, build
// the session, render.
//
// Build-time setting: VITE_API_URL, the API service's base URL (see README). Unset, or when the
// service does not answer within a few seconds, the app plays the bundled data ("offline data").
//
// URL parameters (for testing and filming):
//   ?match=match-1  play another match the service serves: the stitched match, or a hero moment
//                   such as press_escape-0 (default blind_side_run-3, the bundled one)
//   ?plan=invalid   load a deliberately broken plan to show the template fallback
//   ?autoplay=0     do not start the live stream (or the breakdown) on load
//   ?offline=1      ignore the live service and play the bundled data

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, MatchApp } from "./App";
import { apiBase, MATCH_ID } from "./api/client";
import { loadData, matchFromUrl } from "./data/load";
import { createMatchSession } from "./match/matchSession";
import { EXAMPLE_PLAN, INVALID_PLAN } from "./plan/example";
import { SessionContext, createSession } from "./session";
import "./styles.css";

async function main() {
  const root = createRoot(document.getElementById("root")!);
  const params = new URLSearchParams(window.location.search);
  const forcedOffline = params.get("offline") === "1";
  root.render(<p className="loading">Loading the match…</p>);
  try {
    // Canvas textures draw shirt numbers with the web fonts, so wait for them (briefly).
    const fonts = Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    const dataUrl = `${import.meta.env.BASE_URL}data/`;
    const [loaded] = await Promise.all([
      loadData({
        apiBase: forcedOffline ? null : apiBase(import.meta.env.VITE_API_URL),
        dataUrl,
        match: matchFromUrl(window.location.search),
      }),
      fonts,
    ]);
    const plan = params.get("plan") === "invalid" ? INVALID_PLAN : EXAMPLE_PLAN;
    const offline = forcedOffline ? "offline=1 in the address" : loaded.offline;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const autoplay = params.get("autoplay") !== "0" && !reducedMotion;

    if (loaded.hero.kind === "match") {
      const session = createMatchSession(loaded.hero, {
        api: loaded.api,
        offline,
        dataUrl,
        plan,
        payload: loaded.payload,
        whatIfs: loaded.whatIfs,
      });
      root.render(
        <StrictMode>
          <MatchApp session={session} autoplay={autoplay} />
        </StrictMode>,
      );
      return;
    }
    // The bundled fixture, plan and what-ifs belong to the bundled hero moment only.
    const bundled = `${loaded.hero.scenario}-${loaded.hero.seed}` === MATCH_ID;
    const session = createSession(
      loaded.hero,
      bundled ? plan : null,
      bundled ? loaded.payload : null,
      bundled ? loaded.whatIfs : null,
      { api: loaded.api, offline, momentId: loaded.momentId },
    );
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
