// Page layout (the Floodlit design), as a landing page and three doors (doors/, SPEC 7). The
// landing page, where a plain visit opens: the promise, the story's one button, the three doors in
// a few lines each with every feature one link away. The look: the live screen fills the first
// screen (the picture with the header, the moment card, the caption and the playback bar over
// it), the story of the moment is the quick tour over it, and below it the moment's compare, its
// commentary and the what-ifs (what used to introduce them is on the landing page). Your turn: a
// hub whose three cards open the modes where the viewer is the player; each mode takes the screen
// as it always has. For studios: four solutions, then their value, one step at a time. The header
// is the same on every page: the brand (back to the landing page), the three doors, and one
// "⋯ Settings" menu. A stitched match has its own layout
// (MatchView): the same live screen with the score card, and every moment below; a hero moment's
// breakdown opens over it as the hero layout with a way back (MatchApp).

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { jumpToTop } from "./ui/reveal";
import { DirectorAttach } from "./director/DirectorBar";
import type { MatchSession } from "./match/matchSession";
import { RecapCaption, RecapPanel, RecapStage } from "./recap/RecapPanel";
import { GK_KITS } from "./players/kit";
import { SessionContext, startClock, useSession, useView } from "./session";
import { createStore, useStore, type Store } from "./store/store";
import type { LiveStatus } from "./live/feed";
import { IntroCard } from "./ui/IntroCard";
import { LiveBar, MomentsPanel, OfflineBadge } from "./ui/Live";
import { BackToMatch, MatchPicker, OpeningNotice, Scoreboard } from "./ui/Match";
import { Caption, EvidenceCard, NarrationPanel, SoundToggle } from "./ui/Narration";
import { intro } from "./ui/intro";
import { RunToggle } from "./ui/RunToggle";
import {
  blurbOf,
  MenuSection,
  MomentCard,
  momentKicker,
  momentTitle,
  SettingsMenu,
  StageHud,
  SwapViews,
  ViewerMenu,
  ViewOptions,
} from "./ui/Stage";
import { bindMatchSound, bindSound } from "./sound/bind";
import { soundEngine } from "./sound/engine";
import { StatsPanel } from "./ui/StatsPanel";
import { ASK_RUN_ID, ComparePanel } from "./journey/Journey";
import { StatsTicker } from "./ui/StatsTicker";
import { WithoutLookNote } from "./without/WithoutLook";
import { TelemetryPanel } from "./ui/TelemetryPanel";
import { Transport } from "./ui/Transport";
import { WhatIfPanel } from "./ui/WhatIfPanel";
import { PovView } from "./views/PovView";
import { BeliefMap, beliefPip } from "./views/BeliefMap";
import { Tour, TourButton } from "./tour/Tour";
import { resumeTour, tour } from "./tour/tourState";
import { TacticalView } from "./views/TacticalView";
import { ScanStepsScreen, useStepThroughOpen } from "./steps/ScanSteps";
import { TakeEyesScreen, useTakeEyesOpen } from "./takeeyes/TakeEyes";
import { YourCallScreen, useYourCallOpen } from "./yourcall/YourCall";
import { clubName } from "./data/roster";
import { MomentChips } from "./moments/MomentRail";
import { TacticsLabPanel } from "./tacticslab/TacticsLab";
import { usePersonalSync, YourViewLine, YourViewMenu } from "./personal/YourView";
import { DrillScreen, useDrillOpen } from "./drill/Drill";
import { StageSkeletonKey } from "./skeleton/SkeletonLegend";
import { FloodlightBackground } from "./ui/FloodlightBackground";
import { TextReveal } from "./ui/TextReveal";
import { DoorTabs, ForStudios, TURN_CARD_ID, YourTurn } from "./doors/DoorPages";
import { Landing } from "./doors/Landing";
import { doors, openDoor } from "./doors/state";

/** A hero moment: its door on screen, or a mode over all of them. `onBack`: inside a match. */
export function App({ autoplay, onBack }: { autoplay: boolean; onBack?: () => void }) {
  const session = useSession();
  const { hero, playback, controls, moment, offset, runner } = session;
  const [titleLead, titleEmphasis] = momentTitle(hero);
  const mode = useStore(playback, (s) => s.mode);
  const evidence = useStore(playback, (s) => s.evidenceLine);
  const yourCall = useYourCallOpen();
  const takeEyes = useTakeEyesOpen();
  const scanSteps = useStepThroughOpen();
  const drill = useDrillOpen();
  const door = useStore(doors, (s) => s.door);
  // Next to the brand: inside a match the way back; else the badge when the service is off.
  const start = onBack ? <BackToMatch onBack={onBack} /> : <OfflineBadge />;
  const introOpen = useStore(intro, (s) => s.open);
  // While a tour runs its card is the one panel: the moment card stands down. An open evidence
  // card stays (the full tour points at it, and the quick tour's check does too); otherwise the
  // quick tour's card takes the moment card's place.
  const touring = useStore(tour, (s) => (s.open ? s.kind : null));

  usePersonalSync(!!onBack); // inside a match: start on the audience and language already chosen
  useEffect(() => startClock(session), [session]);
  useEffect(() => bindSound(session, soundEngine), [session]); // crowd, whooshes, stings
  // Closing a mode gives the keyboard back to what opened it (modeClosed).
  useModeFocus(yourCall, TURN_CARD_ID.yourCall);
  useModeFocus(takeEyes, TURN_CARD_ID.takeEyes);
  useModeFocus(drill, TURN_CARD_ID.drill);
  useModeFocus(scanSteps, "scan-steps-story", resumeTour);
  // The picture is door 1's: what starts playing on it (a breakdown, a line's evidence) brings
  // door 1 back; leaving door 1 stops what plays there, unseen.
  useEffect(() => {
    let evidenceWas = playback.get().evidenceLine;
    let runningWas = runner.status.get().status === "running";
    const toLook = () => {
      if (doors.get().door !== "look") openDoor("look", { address: true });
    };
    const offEvidence = playback.subscribe(() => {
      const now = playback.get().evidenceLine;
      if (now && now !== evidenceWas) toLook();
      evidenceWas = now;
    });
    const offRunner = runner.status.subscribe(() => {
      const now = runner.status.get().status === "running";
      if (now && !runningWas) toLook();
      runningWas = now;
    });
    return () => {
      offEvidence();
      offRunner();
    };
  }, [playback, runner]);
  // A new door's page starts at its top, once it is laid out: a scroll still running from the
  // last page (a tour step's) would land it part-way down.
  const doorSeq = useStore(doors, (s) => s.seq);
  useLayoutEffect(() => {
    if (doorSeq > 0) jumpToTop();
  }, [doorSeq]);
  useEffect(() => {
    if (door === "look") return;
    controls.stopBreakdown();
    controls.leaveLive();
    if (playback.get().playing) playback.set({ playing: false });
  }, [door, controls, playback]);
  // The autoplay waits for the intro card: the key scan comes in the stream's first seconds and
  // must not play under it. Behind the card the picture rests on the first frame. Online: watch
  // live, then the show (the look, then the run without it) and the breakdown once the moment is
  // detected. Offline: the show and the bundled breakdown at once. Once per session: the card
  // never opens again. A tour started from the card drives the app itself: the autoplay would
  // take its first step over (the step is set up before this effect runs). It waits for the
  // landing page as for the card: it starts when the viewer opens The look, unless what opened it
  // was a mode or a tour.
  const started = useRef(false);
  const modeOpen = yourCall || takeEyes || scanSteps || drill;
  useEffect(() => {
    if (!autoplay || started.current) return;
    if (introOpen) {
      if (playback.get().frame !== 0) playback.set({ frame: 0 });
      return;
    }
    if (door === "home") return;
    started.current = true;
    if (tour.get().open || door !== "look" || modeOpen) return;
    if (session.feed) controls.startLive();
    else controls.autoplay();
  }, [autoplay, controls, introOpen, playback, session, door, modeOpen]);
  useEffect(() => () => session.feed?.stop(), [session]);

  // A mode takes the screen, and hides what would give his decision away until the viewer has
  // made theirs. Its own header keeps the way back inside a match.
  const way = onBack ? <BackToMatch onBack={onBack} /> : null;
  const modeScreen = drill ? (
    <DrillScreen start={way} />
  ) : yourCall ? (
    <YourCallScreen start={way} />
  ) : takeEyes ? (
    <TakeEyesScreen start={way} />
  ) : scanSteps ? (
    <ScanStepsScreen start={way} />
  ) : null;

  return (
    <div
      className={mode === "counterfactual" ? "app mode-cf" : "app"}
      data-door={modeScreen ? undefined : door}
      onClickCapture={(e) => {
        const id = (e.target as Element).closest?.("button[id]")?.id;
        if (id && OPENER_IDS.includes(id)) lastPressed.id = id;
      }}
    >
      {modeScreen ??
        (door === "look" ? (
          <>
            <LiveScreen
              start={start}
              end={<HeroSettings />}
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
            <main className="moment" id="moment" aria-labelledby="moment-title" inert={introOpen}>
              <FloodlightBackground />
              <header className="moment-head">
                <p className="kicker accent">
                  {momentKicker(hero, moment.decisionFrame, offset).replace("Moment", "The moment")}
                </p>
                <h2 id="moment-title" tabIndex={-1}>
                  <TextReveal>
                    {titleLead} <em>{titleEmphasis}</em>
                  </TextReveal>
                </h2>
                <p className="lede">
                  <TextReveal>{blurbOf(hero)}</TextReveal>
                </p>
                <YourViewLine />
              </header>
              {/* The look and the run without it, side by side: the story's compare, kept. The
                  chapters that introduced the moment are the landing page's now. */}
              <ComparePanel />
              <div className="below">
                <NarrationPanel />
                <WhatIfPanel />
                {/* The data under the moment, one click away: no tour step points into it. */}
                <details className="how match-data">
                  <summary>Match data for this moment</summary>
                  <TelemetryPanel />
                  <StatsPanel />
                  <MomentsPanel />
                </details>
              </div>
            </main>
          </>
        ) : (
          <DoorScreen start={start} end={<HeroSettings />}>
            {door === "home" ? <Landing /> : door === "turn" ? <YourTurn /> : <ForStudios />}
          </DoorScreen>
        ))}

      <Legend />
      <Tour />
    </div>
  );
}

/** The header's one menu on a hero moment: the moment, who is watching and in which language,
 * who to follow, the sound, the view options and the full tour. */
function HeroSettings() {
  return (
    <SettingsMenu>
      <MenuSection label="Moment">
        <MomentChips />
      </MenuSection>
      <MenuSection label="Commentary">
        <ViewerMenu />
      </MenuSection>
      <MenuSection label="Follow">
        <YourViewMenu />
      </MenuSection>
      <MenuSection label="Sound">
        <SoundToggle />
      </MenuSection>
      <ViewOptions />
      <MenuSection label="Tour">
        <TourButton className="btn" />
      </MenuSection>
    </SettingsMenu>
  );
}

/** The buttons that open a mode (the hub's cards, the compare's scan story, For studios' question
 * about the run): the one last pressed is what closing its mode gives the keyboard back to. */
const OPENER_IDS = [
  TURN_CARD_ID.yourCall,
  TURN_CARD_ID.takeEyes,
  TURN_CARD_ID.drill,
  "scan-steps-story",
  ASK_RUN_ID,
];

const lastPressed = { id: "" };

/** When a mode closes, the keyboard goes back to what opened it, never to the body: a tour left
 * for it comes back (`resume`); else the button that was pressed, when it is on screen; else the
 * mode's own way in on the door it opened over (`home`: the hub's card, the compare's link); else
 * the door's heading. */
function useModeFocus(open: boolean, home: string, resume?: () => boolean) {
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !open && !resume?.()) {
      const shown = (el: HTMLElement | null): el is HTMLElement =>
        !!el && !el.closest("[hidden]") && getComputedStyle(el).display !== "none";
      const pressed = lastPressed.id ? document.getElementById(lastPressed.id) : null;
      const el = [pressed, document.getElementById(home)].find(shown);
      (el ?? document.querySelector<HTMLElement>(".stage-head h1"))?.focus({
        preventScroll: true,
      });
    }
    was.current = open;
  }, [open, home, resume]);
}

/** The header on every page: the brand (a link back to the landing page), `start` beside it (the
 * offline badge, the way back to the match, a match's live pill), the three doors, and `end`
 * (Settings). */
function SiteHeader({ start, end }: { start: ReactNode; end: ReactNode }) {
  const view = useView();
  const home = useStore(doors, (s) => s.door === "home");
  return (
    <header className="stage-head">
      <div className="brand">
        {/* Focused when the intro card closes (IntroCard), never by Tab. */}
        <h1 tabIndex={-1}>
          <a
            className="brand-link"
            href={`${import.meta.env.BASE_URL}?door=home`}
            aria-current={home && view.kind === "hero" ? "page" : undefined}
            onClick={(e) => {
              // A stitched match is no door: the link loads the hero moment's landing page.
              if (view.kind === "match" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              openDoor("home", { address: true, focus: true });
            }}
          >
            Through Their Eyes
          </a>
        </h1>
        <p className="sub">
          A synthetic match<span className="sub-more"> · every player fictional</span>
        </p>
      </div>
      <div className="header-start">{start}</div>
      <DoorTabs />
      <div className="header-end">{end}</div>
    </header>
  );
}

/** Door 2 or 3: the header in the page's flow, then the door's page. */
function DoorScreen({
  start,
  end,
  children,
}: {
  start: ReactNode;
  end: ReactNode;
  children: ReactNode;
}) {
  const introOpen = useStore(intro, (s) => s.open);
  return (
    <div className="door-screen" inert={introOpen}>
      <SiteHeader start={start} end={end} />
      <main className="moment door-main" id="moment">
        <FloodlightBackground />
        {children}
      </main>
    </div>
  );
}

/**
 * The live screen: the main view fills it and the other rides along as a picture in picture
 * (unless the 3D view is focused alone); the header, a card on the right, the caption and the
 * playback bar sit over the picture.
 */
function LiveScreen(props: {
  start: ReactNode; // next to the brand: the way back to the match, a match's live pill
  end?: ReactNode; // the header's right: Settings
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
        <SiteHeader start={props.start} end={props.end} />
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
        start={<LiveBar />}
        end={
          <SettingsMenu>
            <MenuSection label="Moment">
              <MomentChips />
              <MatchPicker />
            </MenuSection>
            <MenuSection label="Your view">
              <YourViewMenu />
            </MenuSection>
            <MenuSection label="Sound">
              <SoundToggle />
            </MenuSection>
            <ViewOptions />
          </SettingsMenu>
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
