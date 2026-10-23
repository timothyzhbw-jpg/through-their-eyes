// Entry point: load the match (from the live service, or the bundled files), pick the plan, build
// the session, render.
//
// Build-time setting: VITE_API_URL, the API service's base URL (see README). Unset, or when the
// service does not answer within a few seconds, the app plays the bundled data ("offline data").
//
// URL parameters (deep links for judges, testing and filming): see deeplink.ts and the README.
// ?match=match-1 plays another match the service serves (data/load.ts matchFromUrl).
// ?camera=broadcast starts on the broadcast camera, focused (for filming).
// ?cine=1 is a full-screen capture view for filming the demo (SPEC 10), never linked from the app.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, MatchApp } from "./App";
import { apiBase, MATCH_ID } from "./api/client";
import { loadData, matchFromUrl, WHAT_IF_FILES } from "./data/load";
import { LOOK_FILES } from "./takeeyes/looks";
import { applyDeepLink, DeepLinkContext, parseDeepLink } from "./deeplink";
import { scenarioMatchId } from "./match/match";
import { createMatchSession } from "./match/matchSession";
import { EXAMPLE_PLAN, INVALID_PLAN } from "./plan/example";
import { SessionContext, createSession, type ViewControls, type ViewSession } from "./session";
import { kindOf } from "./tour/steps";
import { startTour } from "./tour/tourState";
import { heroGatesOf } from "./without/gates";
import { withoutLookOf } from "./without/without";
import { intro } from "./ui/intro";
import "./styles.css";

async function main() {
  const root = createRoot(document.getElementById("root")!);
  const link = parseDeepLink(window.location.search);
  const filming = new URLSearchParams(window.location.search).get("cine") === "1";
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
    const showCine = async (session: ViewSession) => {
      const { CineApp } = await import("./cine/CineApp");
      root.render(
        <SessionContext.Provider value={session}>
          <CineApp />
        </SessionContext.Provider>,
      );
    };

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
      if (link.tour) startTour(link.tour, kindOf(link.tour)); // the judge tour's match steps: the recap
      // play=recap: the end-of-match recap for the link's audience, offered as at full time.
      if (link.play === "recap") session.recap.openAtFullTime(link.persona, link.language);
      // play=eyes, play=drill: the first hero moment whose possession has a bundled look grid.
      const eyes = session.match.moments.find((m) => {
        if (!m.hero) return false;
        const p = session.match.possessions.find((x) => x.index === m.possession);
        return !!p && !!LOOK_FILES[scenarioMatchId(p)];
      });
      if (link.play === "eyes" && eyes) session.controls.openBreakdown(eyes, "eyes");
      if (link.play === "drill" && eyes) session.controls.openBreakdown(eyes, "drill");
      // moment=<scenario>: that hero moment's breakdown, as its Breakdown button opens it.
      const named = link.moment
        ? session.match.moments.find(
            (m) =>
              m.hero &&
              session.match.possessions.find((p) => p.index === m.possession)?.scenario ===
                link.moment,
          )
        : undefined;
      if (named) session.controls.openBreakdown(named);
      broadcast(session.controls);
      if (filming) {
        await showCine(session);
        return;
      }
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
    void withoutLookOf(session, undefined, dataUrl).load(); // "Without the look", told: a few KB
    void heroGatesOf(session, undefined, dataUrl).load(); // how often the held-out seeds change
    applyDeepLink(session, link);
    broadcast(session.controls);
    if (filming) {
      await showCine(session);
      return;
    }
    if (link.tour) startTour(link.tour, kindOf(link.tour)); // a tour: its steps are a hero moment's
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
