// Page layout: header with the run toggle, the two views, transport, then the panels. A stitched
// match has its own layout (MatchView): the score bug, the views, the match transport and every
// moment; a hero moment's breakdown opens over it as the hero layout with a way back (MatchApp).

import { useEffect } from "react";
import { DirectorBar } from "./director/DirectorBar";
import type { MatchSession } from "./match/matchSession";
import { SessionContext, startClock, useSession, useView } from "./session";
import { useStore } from "./store/store";
import { BreakdownPanel } from "./ui/BreakdownPanel";
import { LiveBar, MomentsPanel } from "./ui/Live";
import { BackToMatch, MatchPicker, OpeningNotice, Scoreboard } from "./ui/Match";
import { EvidenceCard, NarrationPanel } from "./ui/Narration";
import { DecisionPanel, StoryPanel } from "./ui/Panels";
import { RunToggle } from "./ui/RunToggle";
import { TelemetryPanel } from "./ui/TelemetryPanel";
import { Transport } from "./ui/Transport";
import { WhatIfPanel } from "./ui/WhatIfPanel";
import { PovView } from "./views/PovView";
import { TacticalView } from "./views/TacticalView";

const BLURB: Record<string, string> = {
  blind_side_run:
    "Hero moment: the blind-side run. See what the midfielder saw, and what he would have done without one look over his shoulder.",
  press_escape:
    "Hero moment: escaping the press. See what the centre-back saw with an opponent closing in, and what carrying the ball would have cost.",
};

/** A hero moment: its views, the breakdown and the panels. `onBack`: it is inside a match. */
export function App({ autoplay, onBack }: { autoplay: boolean; onBack?: () => void }) {
  const session = useSession();
  const { hero, playback, controls } = session;
  const mode = useStore(playback, (s) => s.mode);
  const focus = useStore(playback, (s) => s.focus);

  useEffect(() => startClock(session), [session]);
  useEffect(() => {
    if (!autoplay) return;
    // With the live service: watch the match live, then its breakdown once the moment is
    // detected (SPEC 2). Offline: play the bundled breakdown at once.
    if (!session.feed) {
      controls.playBreakdown();
      return;
    }
    controls.startLive();
    return () => session.feed?.stop();
  }, [autoplay, controls, session]);

  return (
    <div className={mode === "counterfactual" ? "app mode-cf" : "app"}>
      <header>
        <div className="brand">
          <h1>
            Through Their Eyes <span className="tag">synthetic match</span>
          </h1>
          <p>{BLURB[hero.scenario] ?? `Hero moment: ${hero.scenario.replaceAll("_", " ")}.`}</p>
        </div>
        <div className="header-controls">
          {onBack ? (
            <BackToMatch onBack={onBack} />
          ) : (
            <>
              <MatchPicker />
              <LiveBar />
            </>
          )}
          <RunToggle />
        </div>
      </header>

      <DirectorBar />
      <section className={`stage focus-${focus}`}>
        <PovView />
        <TacticalView />
      </section>

      <EvidenceCard />

      <Transport />

      <TelemetryPanel />

      <section className="below">
        <NarrationPanel />
        <MomentsPanel />
        <WhatIfPanel />
        <BreakdownPanel />
        <StoryPanel />
        <DecisionPanel />
      </section>

      <Legend />
    </div>
  );
}

/** A stitched match, or one of its hero moments' breakdowns over it. */
export function MatchApp({ session, autoplay }: { session: MatchSession; autoplay: boolean }) {
  const open = useStore(session.screen, (s) => s.hero);
  // The Breakdown buttons sit low on the page: show the views of whichever screen comes up.
  useEffect(() => {
    window.scrollTo({ top: 0 }); // newer browsers return a promise: not a cleanup
  }, [open]);
  useEffect(() => {
    if (!autoplay) return;
    session.controls.startLive();
    return () => session.feed?.stop();
  }, [autoplay, session]);
  if (open) {
    return (
      <SessionContext.Provider value={open}>
        <App autoplay={false} onBack={session.controls.backToMatch} />
      </SessionContext.Provider>
    );
  }
  return (
    <SessionContext.Provider value={session}>
      <MatchView />
    </SessionContext.Provider>
  );
}

function MatchView() {
  const session = useView();
  const focus = useStore(session.playback, (s) => s.focus);
  useEffect(() => startClock(session), [session]);
  const count = session.kind === "match" ? session.match.possessions.length : 0;
  return (
    <div className="app match">
      <header>
        <div className="brand">
          <h1>
            Through Their Eyes <span className="tag">synthetic match</span>
          </h1>
          <p>
            A whole match of {count} possessions on one clock, streamed live from the API. Every
            moment is on the timeline and in the Moments panel; open a hero moment's breakdown to
            see the decision through the player's eyes.
          </p>
        </div>
        <div className="header-controls">
          <MatchPicker />
          <LiveBar />
        </div>
      </header>

      <Scoreboard />
      <OpeningNotice />

      <DirectorBar />
      <section className={`stage focus-${focus}`}>
        <PovView />
        <TacticalView />
      </section>

      <Transport />

      <section className="below">
        <MomentsPanel />
      </section>

      <Legend />
    </div>
  );
}

function Legend() {
  const { hero } = useView();
  return (
    <footer className="legend">
      <span>
        <i style={{ background: "var(--home)" }} />
        Home (attacking right)
      </span>
      <span>
        <i style={{ background: "var(--away)" }} />
        Away
      </span>
      {hero.runs.factual.sight && (
        <span>
          <i style={{ background: "var(--sight)" }} />
          In his sight right now
        </span>
      )}
      {hero.heroId && (
        <span>
          <i className="dashed" />
          Where he believes a player is
        </span>
      )}
      <span>All players and clubs are fictional; the match is generated by our simulator.</span>
    </footer>
  );
}
