// Page layout (the Floodlit design): the live screen fills the first screen (the picture with the
// header, the moment card, the caption and the playback bar over it), and the moment is told
// below it, panel by panel. A stitched match has its own layout (MatchView): the same live screen
// with the score card, and every moment below; a hero moment's breakdown opens over it as the
// hero layout with a way back (MatchApp).

import { useEffect, useRef, type ReactNode } from "react";
import { DirectorBar } from "./director/DirectorBar";
import type { MatchSession } from "./match/matchSession";
import { RecapCaption, RecapPanel, RecapStage } from "./recap/RecapPanel";
import { SessionContext, startClock, useBreakdown, useSession, useView } from "./session";
import { useStore } from "./store/store";
import { BreakdownPanel } from "./ui/BreakdownPanel";
import { LineupCard } from "./ui/LineupCard";
import { LiveBar, MomentsPanel } from "./ui/Live";
import { BackToMatch, MatchPicker, OpeningNotice, Scoreboard } from "./ui/Match";
import { Caption, EvidenceCard, NarrationPanel, SoundToggle } from "./ui/Narration";
import { ArrowIcon, CheckIcon } from "./ui/icons";
import { intro } from "./ui/intro";
import { PERSONA_LABEL } from "./ui/labels";
import { DecisionPanel, StoryPanel, VerdictPanel } from "./ui/Panels";
import { RunToggle } from "./ui/RunToggle";
import {
  blurbOf,
  MomentCard,
  momentKicker,
  MomentTitle,
  StageHud,
  SwapViews,
  ViewerMenu,
} from "./ui/Stage";
import { bindSound } from "./sound/bind";
import { soundEngine } from "./sound/engine";
import { StatsPanel } from "./ui/StatsPanel";
import { StatsTicker } from "./ui/StatsTicker";
import { TelemetryPanel } from "./ui/TelemetryPanel";
import { Transport } from "./ui/Transport";
import { WhatIfPanel } from "./ui/WhatIfPanel";
import { PovView } from "./views/PovView";
import { TacticalView } from "./views/TacticalView";
import { yourCallOf } from "./yourcall/controller";
import { YourCallButton, YourCallScreen, useYourCallOpen } from "./yourcall/YourCall";

/** A hero moment: the live screen, then the moment told panel by panel. `onBack`: inside a match. */
export function App({ autoplay, onBack }: { autoplay: boolean; onBack?: () => void }) {
  const session = useSession();
  const { hero, playback, controls, moment, offset } = session;
  const mode = useStore(playback, (s) => s.mode);
  const evidence = useStore(playback, (s) => s.evidenceLine);
  const yourCall = useYourCallOpen();
  const start = onBack ? <BackToMatch onBack={onBack} /> : <LiveBar />;
  const wasYourCall = useRef(false);
  const introOpen = useStore(intro, (s) => s.open);

  useEffect(() => startClock(session), [session]);
  useEffect(() => bindSound(session, soundEngine), [session]); // crowd, whooshes, stings
  // Closing Your call (Back, Escape, the header pill) returns focus to the live screen's pill.
  useEffect(() => {
    if (wasYourCall.current && !yourCall) {
      document.getElementById("your-call-open")?.focus({ preventScroll: true });
    }
    wasYourCall.current = yourCall;
  }, [yourCall]);
  // Online: play behind the card. Not `introOpen`: closing the card must not restart the stream.
  useEffect(() => {
    if (!autoplay || !session.feed) return;
    controls.startLive();
    return () => session.feed?.stop();
  }, [autoplay, controls, session]);
  // The bundled breakdown still waits for the card so the viewer sees it from its first line.
  useEffect(() => {
    if (!autoplay || session.feed || introOpen) return;
    controls.playBreakdown();
  }, [autoplay, controls, introOpen, session]);

  return (
    <div className={mode === "counterfactual" ? "app mode-cf" : "app"}>
      {/* Your call takes the live screen, and hides what would give his decision away until the
          viewer has made theirs: the director, the telemetry and the whole moment below. */}
      {yourCall ? (
        // No live pill: the stream would play unseen under it. Inside a match, the way back stays.
        <YourCallScreen start={onBack ? start : null} />
      ) : (
        <LiveScreen
          start={start}
          end={
            <>
              <YourCallButton />
              <SoundToggle icon />
              <ViewerMenu />
            </>
          }
          run={<RunToggle />}
          card={evidence ? <EvidenceCard /> : <MomentCard />}
          caption={<Caption />}
        />
      )}

      {!yourCall && (
        <main className="moment" id="moment" aria-labelledby="moment-title" inert={introOpen}>
          <header className="moment-head">
            <p className="kicker accent">
              {momentKicker(hero, moment.decisionFrame, offset).replace("Moment", "The moment")}
            </p>
            <h2 id="moment-title">
              <MomentTitle hero={hero} />
            </h2>
            <p className="lede">{blurbOf(hero)}</p>
            <StoryCta />
          </header>
          <div className="below">
            <StoryPanel />
            <TelemetryPanel />
            <StatsPanel />
            <DecisionPanel />
            <VerdictPanel />
            <WhatIfPanel />
            <NarrationPanel />
            <BreakdownPanel />
            <MomentsPanel />
          </div>
        </main>
      )}

      <Legend />
    </div>
  );
}

/** The story's primary action: back to the picture, with the breakdown playing; or make his call. */
function StoryCta() {
  const session = useSession();
  const { controls } = session;
  const yc = yourCallOf(session);
  const { narration, persona, status } = useBreakdown();
  const checked = narration && !narration.fixture;
  return (
    <div className="moment-cta">
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          window.scrollTo({ top: 0 });
          controls.playBreakdown();
        }}
      >
        Watch it through his eyes
        <ArrowIcon />
      </button>
      {!yc.unavailable && (
        <button
          type="button"
          className="btn"
          title="Decide with only what he knew, then see what really happened"
          onClick={() => {
            window.scrollTo({ top: 0 });
            yc.open();
          }}
        >
          Make his call
        </button>
      )}
      {(status === "ready" || status === "failed") && (
        <span className="written">
          {checked && <CheckIcon />}
          {checked
            ? `Written for ${PERSONA_LABEL[persona]} · every number checked in code`
            : "Bundled example · not checked by the verifier"}
        </span>
      )}
    </div>
  );
}

/**
 * The live screen: the main view fills it and the other rides along as a picture in picture
 * (unless the 3D view is focused alone); the header, a card on the right, the caption and the
 * playback bar sit over the picture.
 */
function LiveScreen(props: {
  start: ReactNode; // next to the brand: the live pill, or the way back to the match
  end?: ReactNode; // the header's right: sound and who is watching
  run?: ReactNode; // the run switch: centred over the picture, under the bar on a phone
  card: ReactNode;
  caption?: ReactNode;
}) {
  const { playback } = useView();
  const focus = useStore(playback, (s) => s.focus);
  const introOpen = useStore(intro, (s) => s.open);
  const board = focus === "tactical";
  const pip = focus === "split" || board;
  return (
    <section className={`stage focus-${focus}${pip ? " with-pip" : ""}`} aria-label="Live screen">
      {/* display: contents: it only carries inert while the card is up; layout ignores it. */}
      <div className="stage-content" inert={introOpen} style={{ display: "contents" }}>
        <div className="views">
          <div className={board ? "slot pip" : "slot main"}>
            <PovView />
          </div>
          <div className={board ? "slot main" : pip ? "slot pip" : "slot hidden"}>
            <TacticalView />
          </div>
          <div className="shade top" aria-hidden="true" />
          <div className="shade bottom" aria-hidden="true" />
          {pip && <SwapViews />}
        </div>
        <header className="stage-head">
          <div className="brand">
            <h1>Through Their Eyes</h1>
            <p className="sub">A synthetic match · every player fictional</p>
          </div>
          <div className="header-start">{props.start}</div>
          <div className="header-end">{props.end}</div>
        </header>
        <div className="stage-top">
          <StageHud />
          <div className="stage-director">
            <DirectorBar />
          </div>
          <StatsTicker />
        </div>
        {props.run && <div className="stage-run">{props.run}</div>}
        {props.caption && <div className="stage-caption">{props.caption}</div>}
        <Transport />
        <div className="stage-card">{props.card}</div>
      </div>
      <LineupCard />
    </section>
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
  const introOpen = useStore(intro, (s) => s.open);
  useEffect(() => startClock(session), [session]);
  const count = session.kind === "match" ? session.match.possessions.length : 0;
  return (
    <div className="app match">
      <LiveScreen
        start={
          <>
            <LiveBar />
            <MatchPicker />
          </>
        }
        card={
          <>
            <Scoreboard />
            <OpeningNotice />
            <RecapStage />
          </>
        }
        caption={<RecapCaption />}
      />

      <main className="moment" id="moment" aria-labelledby="moment-title" inert={introOpen}>
        <header className="moment-head">
          <p className="kicker accent">The match · {count} possessions</p>
          <h2 id="moment-title">
            Every moment, <em>on one clock.</em>
          </h2>
          <p className="lede">
            A whole match of {count} possessions, streamed live from the API. Every moment is on the
            timeline and below; open a hero moment's breakdown to see the decision through the
            player's eyes.
          </p>
        </header>
        <div className="below">
          <StatsPanel />
          <RecapPanel />
          <MomentsPanel />
        </div>
      </main>

      <Legend />
    </div>
  );
}

function Legend() {
  const { hero } = useView();
  const introOpen = useStore(intro, (s) => s.open);
  return (
    <footer className="legend" inert={introOpen}>
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
