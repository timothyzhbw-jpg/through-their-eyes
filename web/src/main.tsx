// Entry point: load the match (from the live service, or the bundled files), pick the plan, build
// the session, render.
//
// Build-time setting: VITE_API_URL, the API service's base URL (see README). Unset, or when the
// service does not answer within a few seconds, the app plays the bundled data ("offline data").
//
// URL parameters (deep links for judges, testing and filming): see deeplink.ts and the README.
// ?match=match-1 plays another match the service serves (data/load.ts matchFromUrl).
// ?camera=broadcast starts on the broadcast camera, focused (for filming).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, MatchApp } from "./App";
import { apiBase, MATCH_ID } from "./api/client";
import { loadData, matchFromUrl, WHAT_IF_FILES } from "./data/load";
import { applyDeepLink, DeepLinkContext, parseDeepLink } from "./deeplink";
import { scenarioMatchId } from "./match/match";
import { createMatchSession } from "./match/matchSession";
import { EXAMPLE_PLAN, INVALID_PLAN } from "./plan/example";
import { SessionContext, createSession, type ViewControls } from "./session";
import { startTour } from "./tour/tourState";
import { intro } from "./ui/intro";
import "./styles.css";

async function main() {
  const root = createRoot(document.getElementById("root")!);
  const link = parseDeepLink(window.location.search);
  intro.set({ open: link.intro });
  if (link.warnings.length) console.warn(`Ignored URL parameters: ${link.warnings.join(", ")}`);
  const forcedOffline = link.offline;
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
    const plan = link.invalidPlan ? INVALID_PLAN : EXAMPLE_PLAN;
    const offline = forcedOffline ? "offline=1 in the address" : loaded.offline;
    const broadcast = (controls: ViewControls) => {
      if (new URLSearchParams(window.location.search).get("camera") !== "broadcast") return;
      controls.setFocus("broadcast");
      controls.setCamera("broadcast");
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const autoplay = link.autoplay && !reducedMotion;

    if (loaded.hero.kind === "match") {
      const session = createMatchSession(loaded.hero, {
        api: loaded.api,
        offline,
        dataUrl,
        plan,
        payload: loaded.payload,
        whatIfs: loaded.whatIfs,
      });
      // A match has no audience, run or named frames of its own: its view and a frame apply.
      if (link.view) session.controls.setFocus(link.view);
      if (typeof link.at === "number") session.controls.seek(link.at);
      // play=yourcall: the first hero moment whose possession has bundled what-ifs, in Your call.
      const hero = session.match.moments.find((m) => {
        if (!m.hero) return false;
        const p = session.match.possessions.find((x) => x.index === m.possession);
        return !!p && !!WHAT_IF_FILES[scenarioMatchId(p)];
      });
      if (link.play === "yourcall" && hero) session.controls.openBreakdown(hero, "yourcall");
      broadcast(session.controls);
      root.render(
        <StrictMode>
          <DeepLinkContext.Provider value={link}>
            <MatchApp session={session} autoplay={autoplay} />
          </DeepLinkContext.Provider>
        </StrictMode>,
      );
      return;
    }
    // The bundled fixture and plan belong to the bundled hero moment only; the what-ifs were
    // loaded for this one.
    const bundled = `${loaded.hero.scenario}-${loaded.hero.seed}` === MATCH_ID;
    const session = createSession(
      loaded.hero,
      bundled ? plan : null,
      bundled ? loaded.payload : null,
      loaded.whatIfs,
      { api: loaded.api, offline, momentId: loaded.momentId },
    );
    applyDeepLink(session, link);
    broadcast(session.controls);
    if (link.tour) startTour(link.tour); // the judge tour: its steps are a hero moment's
    root.render(
      <StrictMode>
        <SessionContext.Provider value={session}>
          <DeepLinkContext.Provider value={link}>
            <App autoplay={autoplay} />
          </DeepLinkContext.Provider>
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
