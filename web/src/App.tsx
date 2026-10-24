// Page layout (the Floodlit design): the live screen fills the first screen (the picture with the
// header, the moment card, the caption and the playback bar over it), and the moment is told
// below it, panel by panel. A stitched match has its own layout (MatchView): the same live screen
// with the score card, and every moment below; a hero moment's breakdown opens over it as the
// hero layout with a way back (MatchApp). The first screen keeps few controls: the header's
// Moments, Your call and ⋯ (everything else), the run switch, and the playback bar.

import { useEffect, useRef, type ReactNode } from "react";
import { DirectorAttach } from "./director/DirectorBar";
import type { MatchSession } from "./match/matchSession";
import { RecapCaption, RecapPanel, RecapStage } from "./recap/RecapPanel";
import { GK_KITS } from "./players/kit";
import { SessionContext, startClock, useBreakdown, useSession, useView } from "./session";
import { createStore, useStore, type Store } from "./store/store";
import type { LiveStatus } from "./live/feed";
import { BreakdownPanel } from "./ui/BreakdownPanel";
import { IntroCard } from "./ui/IntroCard";
import { LiveBar, MomentsPanel, OfflineBadge } from "./ui/Live";
import { BackToMatch, MatchPicker, OpeningNotice, Scoreboard } from "./ui/Match";
import { Caption, EvidenceCard, NarrationPanel, SoundToggle } from "./ui/Narration";
import { ArrowIcon, CheckIcon } from "./ui/icons";
import { intro } from "./ui/intro";
import { PERSONA_LABEL } from "./ui/labels";
import { DecisionPanel, StoryPanel, VerdictPanel } from "./ui/Panels";
import { RunToggle } from "./ui/RunToggle";
import {
  blurbOf,
  HeaderMore,
  MenuSection,
  MomentCard,
  momentKicker,
  MomentTitle,
  StageHud,
  SwapViews,
  ViewerMenu,
  ViewOptions,
} from "./ui/Stage";
import { bindMatchSound, bindSound } from "./sound/bind";
import { soundEngine } from "./sound/engine";
import { StatsPanel } from "./ui/StatsPanel";
import { Journey } from "./journey/Journey";
import { StatsTicker } from "./ui/StatsTicker";
import { WithoutLookNote } from "./without/WithoutLook";
import { TelemetryPanel } from "./ui/TelemetryPanel";
import { Transport } from "./ui/Transport";
import { WhatIfPanel } from "./ui/WhatIfPanel";
import { PovView } from "./views/PovView";
import { BeliefMap, beliefPip } from "./views/BeliefMap";
import { FirstTourButton, Tour, TourButton } from "./tour/Tour";
import { tour } from "./tour/tourState";
import { TacticalView } from "./views/TacticalView";
import { stepThroughOf } from "./steps/controller";
import { ScanStepsButton, ScanStepsScreen, useStepThroughOpen } from "./steps/ScanSteps";
import { takeEyesOf } from "./takeeyes/controller";
import { TakeEyesButton, TakeEyesScreen, useTakeEyesOpen } from "./takeeyes/TakeEyes";
import { yourCallOf } from "./yourcall/controller";
import { YourCallButton, YourCallScreen, useYourCallOpen } from "./yourcall/YourCall";
import { clubName } from "./data/roster";
import { MomentsMenu } from "./moments/MomentRail";
import { TacticsLabPanel } from "./tacticslab/TacticsLab";
import { usePersonalSync, YourViewLine, YourViewMenu } from "./personal/YourView";
import { drillOf } from "./drill/controller";
import { DRILL_NAME, DRILL_SUB, DrillScreen, useDrillOpen } from "./drill/Drill";
import { StageSkeletonKey } from "./skeleton/SkeletonLegend";

/** A hero moment: the live screen, then the moment told panel by panel. `onBack`: inside a match. */
export function App({ autoplay, onBack }: { autoplay: boolean; onBack?: () => void }) {
  const session = useSession();
  const { hero, playback, controls, moment, offset } = session;
  const mode = useStore(playback, (s) => s.mode);
  const evidence = useStore(playback, (s) => s.evidenceLine);
  const yourCall = useYourCallOpen();
  const takeEyes = useTakeEyesOpen();
  const scanSteps = useStepThroughOpen();
  const drill = useDrillOpen();
  const start = onBack ? <BackToMatch onBack={onBack} /> : null; // inside a match: the way back
  const wasYourCall = useRef(false);
  const wasTakeEyes = useRef(false);
  const wasScanSteps = useRef(false);
  const wasDrill = useRef(false);
  const introOpen = useStore(intro, (s) => s.open);
  // While a tour runs its card is the one panel: the moment card stands down. An open evidence
  // card stays (the full tour points at it, and the quick tour's check does too); otherwise the
  // quick tour's card takes the moment card's place.
  const touring = useStore(tour, (s) => (s.open ? s.kind : null));

  usePersonalSync(!!onBack); // inside a match: start on the audience and language already chosen
  useEffect(() => startClock(session), [session]);
  useEffect(() => bindSound(session, soundEngine), [session]); // crowd, whooshes, stings
  // Closing Your call (Back, Escape, the header pill) returns focus to the live screen's pill.
  useEffect(() => {
    if (wasYourCall.current && !yourCall) {
      document.getElementById("your-call-open")?.focus({ preventScroll: true });
    }
    wasYourCall.current = yourCall;
  }, [yourCall]);
  useEffect(() => {
    if (wasTakeEyes.current && !takeEyes) returnFocus("take-eyes-open", "take-eyes-story");
    wasTakeEyes.current = takeEyes;
  }, [takeEyes]);
  useEffect(() => {
    if (wasScanSteps.current && !scanSteps) returnFocus("scan-steps-open", "scan-steps-story");
    wasScanSteps.current = scanSteps;
  }, [scanSteps]);
  useEffect(() => {
    if (wasDrill.current && !drill) returnFocus("drill-open", "drill-story");
    wasDrill.current = drill;
  }, [drill]);
  // The autoplay waits for the intro card: the key scan comes in the stream's first seconds and
  // must not play under it. Behind the card the picture rests on the first frame. Online: watch
  // live, then the show (the look, then the run without it) and the breakdown once the moment is
  // detected. Offline: the show and the bundled breakdown at once. Once per session: the card
  // never opens again. A tour started from the card drives the app itself: the autoplay would
  // take its first step over (the step is set up before this effect runs).
  const started = useRef(false);
  useEffect(() => {
    if (!autoplay || started.current) return;
    if (introOpen) {
      if (playback.get().frame !== 0) playback.set({ frame: 0 });
      return;
    }
    started.current = true;
    if (tour.get().open) return;
    if (session.feed) controls.startLive();
    else controls.autoplay();
  }, [autoplay, controls, introOpen, playback, session]);
  useEffect(() => () => session.feed?.stop(), [session]);

  return (
    <div className={mode === "counterfactual" ? "app mode-cf" : "app"}>
      {/* Your call takes the live screen, and hides what would give his decision away until the
          viewer has made theirs: the director, the telemetry and the whole moment below. */}
      {drill ? (
        <DrillScreen start={start} />
      ) : yourCall ? (
        // No live pill: the stream would play unseen under it. Inside a match, the way back stays.
        <YourCallScreen start={start} />
      ) : takeEyes ? (
        <TakeEyesScreen start={start} />
      ) : scanSteps ? (
        <ScanStepsScreen start={start} />
      ) : (
        <LiveScreen
          // Every moment in reach in one menu; no Live pill on a hero moment (Moments has the
          // full match, live), only the badge when the service is off.
          start={
            <>
              {onBack ? start : <OfflineBadge />}
              <MomentsMenu />
            </>
          }
          end={
            <>
              <YourCallButton />
              <HeaderMore>
                <MenuSection label="Sound">
                  <SoundToggle />
                </MenuSection>
                <MenuSection label="Commentary">
                  <ViewerMenu />
                </MenuSection>
                <MenuSection label="More ways in">
                  <ScanStepsButton />
                  <TakeEyesButton />
                  <DrillButton />
                  <FirstTourButton className="btn" />
                </MenuSection>
                <ViewOptions />
              </HeaderMore>
            </>
          }
          run={<RunToggle />}
          card={
            evidence ? (
              <EvidenceCard />
            ) : touring === "quick" ? (
              <div className="tour-home" aria-hidden="true" />
            ) : touring ? null : (
              <MomentCard />
            )
          }
          caption={
            <>
              <Caption />
              <WithoutLookNote />
            </>
          }
        />
      )}

      {!yourCall && !takeEyes && !scanSteps && !drill && (
        <main className="moment" id="moment" aria-labelledby="moment-title" inert={introOpen}>
          <header className="moment-head">
            <p className="kicker accent">
              {momentKicker(hero, moment.decisionFrame, offset).replace("Moment", "The moment")}
            </p>
            <h2 id="moment-title">
              <MomentTitle hero={hero} />
            </h2>
            <p className="lede">{blurbOf(hero)}</p>
            <YourViewLine />
            <StoryCta />
          </header>
          {/* Event → Tactics → Your view → Content → Value: the Tactics lab and the content
              studio are its steps' panels. */}
          <Journey />
          <div className="below">
            <StoryPanel />
            <DecisionPanel />
            <VerdictPanel />
            <NarrationPanel />
            <WhatIfPanel />
            <BreakdownPanel />
            {/* The data under the moment, one click away: no tour step points into it. */}
            <details className="how match-data">
              <summary>Match data for this moment</summary>
              <TelemetryPanel />
              <StatsPanel />
              <MomentsPanel />
            </details>
          </div>
        </main>
      )}

      <Legend />
      <Tour />
    </div>
  );
}

/** Whether the story's "More ways in" is open: kept while a mode it opens takes the page. */
const storyWaysIn = createStore<{ open: boolean }>({ open: false });

/** Focus back on what opened a mode: its pill in the header's More while the menu is open, else
 * the story's own button, its "More ways in" opened so that button can take focus. */
function returnFocus(pillId: string, storyId: string) {
  const pill = document.getElementById(pillId);
  if (pill && !pill.closest("[hidden]") && getComputedStyle(pill).display !== "none") {
    pill.focus({ preventScroll: true });
    return;
  }
  const story = document.getElementById(storyId);
  const fold = story?.closest("details");
  if (fold && !fold.open) {
    fold.open = true;
    storyWaysIn.set({ open: true });
  }
  (story ?? document.querySelector<HTMLElement>(".stage-head h1"))?.focus({ preventScroll: true });
}

/** The academy drill in the header's More (the moment rail links to it too). */
function DrillButton() {
  const drill = drillOf(useSession());
  if (drill.unavailable) return null;
  return (
    <button
      id="drill-open"
      type="button"
      className="btn"
      title={`${DRILL_SUB}, then make the pass`}
      onClick={() => drill.open()}
    >
      {DRILL_NAME}
    </button>
  );
}

/** The story's primary action: back to the picture, with the breakdown playing; or make his call. */
function StoryCta() {
  const session = useSession();
  const { controls } = session;
  const yc = yourCallOf(session);
  const te = takeEyesOf(session);
  const steps = stepThroughOf(session);
  const drill = drillOf(session);
  const { narration, persona, status } = useBreakdown();
  const checked = narration && !narration.fixture;
  const waysIn = useStore(storyWaysIn, (s) => s.open);
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
      {/* The other ways in, one click away. Open or closed, it stays so across the modes it opens. */}
      <details
        className="how ways-in"
        open={waysIn}
        onToggle={(e) => storyWaysIn.set({ open: e.currentTarget.open })}
      >
        <summary>More ways in</summary>
        <div className="ways-in-body">
          {!steps.unavailable && (
            <button
              id="scan-steps-story"
              type="button"
              className="btn"
              title="Step through each look he took, frozen, then his decision"
              onClick={() => {
                window.scrollTo({ top: 0 });
                steps.open();
              }}
            >
              Step through his looks
            </button>
          )}
          {!te.unavailable && (
            <button
              id="take-eyes-story"
              type="button"
              className="btn"
              title="Choose when and where he looks; the sim re-runs the moment"
              onClick={() => {
                window.scrollTo({ top: 0 });
                te.open();
              }}
            >
              Take his eyes
            </button>
          )}
          {!drill.unavailable && (
            <button
              id="drill-story"
              type="button"
              className="btn"
              title={`${DRILL_SUB}, then make the pass`}
              onClick={() => {
                window.scrollTo({ top: 0 });
                drill.open();
              }}
            >
              {DRILL_NAME}
            </button>
          )}
          <TourButton className="btn" />
        </div>
      </details>
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
  start: ReactNode; // next to the brand: Moments, the way back to the match, a match's live pill
  end?: ReactNode; // the header's right: Your call and ⋯
  run?: ReactNode; // the run switch: centred over the picture, under the bar on a phone
  card: ReactNode;
  caption?: ReactNode;
}) {
  const session = useView();
  const { playback } = session;
  const focus = useStore(playback, (s) => s.focus);
  const camera = useStore(playback, (s) => s.camera);
  const introOpen = useStore(intro, (s) => s.open);
  const touring = useStore(tour, (s) => (s.open ? s.kind : null));
  const board = focus === "tactical";
  const pip = focus === "split" || board;
  // Beside his eyes the corner shows his belief map; the board otherwise (BeliefMap.tsx).
  const belief = pip && !board && beliefPip(session, camera);
  // The stream's state, for scripts (a hero moment's header no longer shows it).
  const stream = useStore((session.feed?.state ?? NO_FEED) as typeof NO_FEED, (s) => s.status);
  return (
    <section
      className={[
        "stage",
        `focus-${focus}`,
        pip && "with-pip",
        touring && "touring", // the HUD row stands down: the tour card is the one panel
        touring === "quick" && "touring-quick", // and the caption: its lines are in the card
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Live screen"
      data-stream={stream}
    >
      <DirectorAttach session={session} />
      {/* display: contents: it only carries inert while the card is up; layout ignores it. */}
      <div className="stage-content" inert={introOpen} style={{ display: "contents" }}>
        <div className="views">
          <div className={board ? "slot pip" : "slot main"}>
            <PovView />
          </div>
          <div className={board ? "slot main" : pip ? "slot pip" : "slot hidden"}>
            {/* The board stays mounted under the belief map: a cut to it is instant. */}
            <TacticalView hidden={belief} />
            {belief && <BeliefMap />}
          </div>
          <div className="shade top" aria-hidden="true" />
          <div className="shade bottom" aria-hidden="true" />
          {pip && <SwapViews />}
        </div>
        <header className="stage-head">
          <div className="brand">
            {/* Focused when the intro card closes (IntroCard), never by Tab. */}
            <h1 tabIndex={-1}>Through Their Eyes</h1>
            <p className="sub">
              A synthetic match<span className="sub-more"> · every player fictional</span>
            </p>
          </div>
          <div className="header-start">{props.start}</div>
          <div className="header-end">{props.end}</div>
        </header>
        <div className="stage-top">
          <StageHud />
          <StatsTicker />
          <StageSkeletonKey />
        </div>
        {props.run && <div className="stage-run">{props.run}</div>}
        {props.caption && <div className="stage-caption">{props.caption}</div>}
        <Transport />
        {/* The intro card takes the card's place while it is up. */}
        <div className="stage-card">{introOpen ? null : props.card}</div>
      </div>
      <IntroCard />
    </section>
  );
}

const NO_FEED: Store<{ status: LiveStatus }> = createStore<{ status: LiveStatus }>({
  status: "off",
});

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
  usePersonalSync(true);
  useEffect(() => startClock(session), [session]);
  useEffect(
    () => (session.kind === "match" ? bindMatchSound(session.recap.voice, soundEngine) : undefined),
    [session],
  ); // the crowd, under the recap's voice
  const count = session.kind === "match" ? session.match.possessions.length : 0;
  return (
    <div className="app match">
      <LiveScreen
        start={
          <>
            <LiveBar />
            <MatchPicker />
            <MomentsMenu />
          </>
        }
        end={
          <HeaderMore>
            <MenuSection label="Sound">
              <SoundToggle />
            </MenuSection>
            <MenuSection label="Your view">
              <YourViewMenu />
            </MenuSection>
            <ViewOptions />
          </HeaderMore>
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
          <YourViewLine />
        </header>
        <div className="below">
          <StatsPanel />
          <RecapPanel />
          <TacticsLabPanel />
          <MomentsPanel />
        </div>
      </main>

      <Legend />
      <Tour />
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
        {clubName(0)} (attacking right)
      </span>
      <span>
        <i style={{ background: "var(--away)" }} />
        {clubName(1)}
      </span>
      <span>
        {GK_KITS.map((kit) => (
          <i key={kit.shirt} style={{ background: kit.shirt }} />
        ))}
        Keepers (home, away)
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
