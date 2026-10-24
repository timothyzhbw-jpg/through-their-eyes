// The journey (SPEC 7): one coherent path through a hero moment, from the event on the pitch to its
// value off it. A bar that stays on screen while the moment's story scrolls ("Event → Tactics →
// Your view → Content → Value"; on a phone a stepper), and under it the open step's panel, all for
// the moment on screen:
// - Event: the moment, with the look and without it, each side told by its verified lines;
// - Tactics: the Tactics lab (tacticslab/);
// - Your view: the audience, the language and who to follow (personal/);
// - Content: the content package (studio/) and the stadium's screens (stadium/);
// - Value: the business panel (studio/) and the stadium's sponsor slots, both demo data.
// Arrow keys, Home and End move along the bar; ?step=<id> opens a step (deeplink.ts). Nothing here
// calls the service or a model: every panel reads what the page already has, or bundled files.

import { Fragment, lazy, Suspense, useEffect, useRef, type KeyboardEvent } from "react";
import { runLabels } from "../data/hero";
import { TacticsLabPanel } from "../tacticslab/TacticsLab";
import { YourViewControls } from "../personal/YourView";
import { useSession } from "../session";
import { EVENT_LABEL } from "../stadium/rules";
import type { Show } from "../stadium/show";
import { useStore } from "../store/store";
import { BusinessValue, StudioPackage } from "../studio/Studio";
import { enterStep } from "../tour/actions";
import { StepLines } from "../tour/StepLines";
import { TourButton } from "../tour/Tour";
import { Chapter, Title } from "../ui/Chapter";
import { LineText, lineClaims } from "../ui/Narration";
import { blurbOf } from "../ui/Stage";
import { withoutLookOf } from "../without/without";
import { WithoutLookLines } from "../without/WithoutLook";
import { DemoBadge, FACTS_VS_FIGURES } from "./DemoBadge";
import { useCachedBreakdown } from "./gate";
import { journey, openStep } from "./state";
import { eventIndex, stadiumEventFor, useStadiumShow } from "./stadium";
import {
  JOURNEY_STEPS,
  moveStep,
  STEP_LABEL,
  STEP_NOTE,
  stepForKey,
  stepIndex,
  type JourneyStep,
} from "./steps";
import "./journey.css";

// The stadium studio's parts load with the step that shows them (stadium.ts).
const ScreenWall = lazy(() =>
  import("../stadium/StudioApp").then((m) => ({ default: m.ScreenWall })),
);
const SponsorSlots = lazy(() =>
  import("../stadium/StudioApp").then((m) => ({ default: m.SponsorSlots })),
);

export const PANEL_ID = "journey-panel";
const tabId = (step: JourneyStep) => `journey-tab-${step}`;

/** The bar and the open step's panel. */
export function Journey() {
  const step = useStore(journey, (s) => s.step);
  const seq = useStore(journey, (s) => s.seq);
  const panel = useRef<HTMLDivElement>(null);
  // An opening asked for (a step picked, a deep link): the panel's top under the bar. A cut, not a
  // glide: the page jumps there.
  useEffect(() => {
    if (seq === 0) return;
    const id = requestAnimationFrame(() =>
      panel.current?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    return () => cancelAnimationFrame(id);
  }, [seq]);
  return (
    <div className="journey">
      <JourneyBar step={step} />
      <div
        ref={panel}
        id={PANEL_ID}
        className="journey-panel"
        role="tabpanel"
        aria-labelledby={tabId(step)}
        data-step={step}
      >
        <StepPanel step={step} />
      </div>
    </div>
  );
}

/** Pick a step from the bar: its panel opens, in view, and the address says so. */
const pick = (step: JourneyStep) => openStep(step, { address: true });

function JourneyBar({ step }: { step: JourneyStep }) {
  const tabs = useRef<Partial<Record<JourneyStep, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: KeyboardEvent) => {
    const next = stepForKey(step, e.key);
    if (!next) return;
    e.preventDefault();
    pick(next);
    tabs.current[next]?.focus({ preventScroll: true });
  };
  const i = stepIndex(step);
  const last = JOURNEY_STEPS.length - 1;
  return (
    <nav className="journey-bar" aria-label="This moment, from event to value">
      <div className="journey-tabs" role="tablist" aria-label="Journey steps" onKeyDown={onKeyDown}>
        {JOURNEY_STEPS.map((s, k) => (
          <Fragment key={s}>
            {k > 0 && (
              <span className="journey-arrow" aria-hidden="true">
                →
              </span>
            )}
            <button
              ref={(el) => {
                tabs.current[s] = el;
              }}
              id={tabId(s)}
              type="button"
              role="tab"
              className="journey-tab"
              aria-selected={s === step}
              aria-controls={PANEL_ID}
              tabIndex={s === step ? 0 : -1}
              title={STEP_NOTE[s]}
              onClick={() => pick(s)}
            >
              <span className="journey-num" aria-hidden="true">
                {k + 1}
              </span>
              {STEP_LABEL[s]}
            </button>
          </Fragment>
        ))}
      </div>
      {/* A phone: the same five steps as a stepper, one at a time. */}
      <div className="journey-stepper">
        <button
          type="button"
          className="btn"
          disabled={i === 0}
          aria-label={i > 0 ? `Back to ${STEP_LABEL[moveStep(step, -1)]}` : "Back"}
          onClick={() => pick(moveStep(step, -1))}
        >
          Back
        </button>
        <p className="journey-where" aria-live="polite">
          <span className="kicker">
            Step {i + 1} of {JOURNEY_STEPS.length}
          </span>
          <strong>{STEP_LABEL[step]}</strong>
        </p>
        <button
          type="button"
          className="btn"
          disabled={i === last}
          aria-label={i < last ? `Next: ${STEP_LABEL[moveStep(step, 1)]}` : "Next"}
          onClick={() => pick(moveStep(step, 1))}
        >
          Next
        </button>
      </div>
      <TourButton className="btn btn-quiet journey-story" kind="story" />
    </nav>
  );
}

function StepPanel({ step }: { step: JourneyStep }) {
  switch (step) {
    case "event":
      return <EventPanel />;
    case "tactics":
      return <TacticsLabPanel kicker={kickerOf("tactics")} />;
    case "your-view":
      return <YourViewPanel />;
    case "content":
      return <ContentPanel />;
    case "value":
      return <ValuePanel />;
  }
}

const kickerOf = (step: JourneyStep) =>
  `Step ${stepIndex(step) + 1} of ${JOURNEY_STEPS.length} · ${STEP_LABEL[step]}`;

// ---------- Event: the moment, with the look and without it ----------

function EventPanel() {
  const session = useSession();
  const { hero } = session;
  const bundled = useStore(withoutLookOf(session).state, (s) => s.data);
  const labels = runLabels(hero);
  // The app's own controls, as the tours use them: the picture is at the top of the page.
  const show = (name: "look" | "counterfactual" | "compare") => {
    window.scrollTo({ top: 0 });
    enterStep(name, session);
  };
  return (
    <Chapter
      className="journey-step journey-event"
      kicker={kickerOf("event")}
      title={
        hero.counterfactual ? (
          <Title lead={`${labels.factual},`} em={`${labels.counterfactual.toLowerCase()}.`} />
        ) : (
          <Title lead="What" em="happened." />
        )
      }
      lede={
        hero.counterfactual
          ? `${blurbOf(hero)} Watch it, then the same seconds re-simulated with that one change; each side is told by its checked lines.`
          : blurbOf(hero)
      }
      label="Event"
    >
      <div className="pick-row">
        <button type="button" className="btn btn-primary" onClick={() => show("look")}>
          {hero.keyScan ? "Watch the look" : "Watch the moment"}
        </button>
        {hero.counterfactual && (
          <>
            <button type="button" className="btn" onClick={() => show("counterfactual")}>
              {labels.counterfactual}
            </button>
            <button type="button" className="btn" onClick={() => show("compare")}>
              Compare from above
            </button>
          </>
        )}
        {/* On a phone the bar has no room for it: the Full story starts here. */}
        <TourButton className="btn btn-quiet journey-story-here" kind="story" />
      </div>
      <div className="tile-grid journey-compare">
        <article className="tile" aria-label={labels.factual}>
          <p className="kicker accent">{labels.factual}</p>
          <TheLook />
          <StepLines say="look" />
        </article>
        {hero.counterfactual && (
          <article className="tile journey-without" aria-label={labels.counterfactual}>
            <p className="kicker">{labels.counterfactual}</p>
            {bundled ? <WithoutLookLines /> : <StepLines say="without" />}
          </article>
        )}
      </div>
      {!hero.counterfactual && (
        <p className="note">This moment has no re-simulated run to compare it with.</p>
      )}
    </Chapter>
  );
}

/** The look the comparison removes, in the bundled "without the look" file's verified line (in
 * the breakdown's language, else English): there even before a breakdown is on screen. */
function TheLook() {
  const session = useSession();
  const data = useStore(withoutLookOf(session).state, (s) => s.data);
  const language = useStore(session.breakdown, (b) => b.language);
  const narration = data?.answers[language] ?? data?.answers.en ?? null;
  const line = narration?.lines.find((l) => l.id === REMOVED_LOOK);
  if (!line) return null;
  return (
    <p className="journey-look" lang={language}>
      <LineText text={line.text} verified claims={lineClaims(narration!, line)} />
    </p>
  );
}

const REMOVED_LOOK = "removed_look"; // explain/look_cost.py: which look the comparison removes

// ---------- Your view ----------

function YourViewPanel() {
  return (
    <Chapter
      className="journey-step journey-your-view"
      kicker={kickerOf("your-view")}
      title={<Title lead="Your view," em="your moments." />}
      lede="Pick who the commentary is for and its language, and follow a club or a player: their moments come first on the rail, and the player is ringed in the 3D view and on the board."
      label="Your view"
    >
      <div className="your-view-inline tile">
        <YourViewControls />
      </div>
    </Chapter>
  );
}

// ---------- Content: the package and the stadium's screens ----------

function ContentPanel() {
  useCachedBreakdown(); // a cold visit: the moment's cached breakdown, never a new one
  return (
    <Chapter
      className="journey-step journey-content studio"
      kicker={kickerOf("content")}
      title={<Title lead="One moment," em="every channel." />}
      lede="A highlight, an explainer, posts and data cards, all from the lines the checker passed, and what the stadium's screens show for it. No model is called."
      label="Content"
    >
      <StudioPackage />
      <StadiumScreens />
    </Chapter>
  );
}

function StadiumScreens() {
  const show = useStadiumShow();
  return (
    <section className="studio-block journey-stadium" aria-labelledby="journey-stadium">
      <h3 id="journey-stadium" className="block-title">
        In the stadium
      </h3>
      {show === null ? (
        <p className="note" role="status">
          Loading the stadium&apos;s screens…
        </p>
      ) : show instanceof Error ? (
        <p className="note">The stadium&apos;s screens could not be loaded ({show.message}).</p>
      ) : (
        <Screens show={show} />
      )}
      <a className="btn" href={`${import.meta.env.BASE_URL}?studio=1`}>
        Open the Stadium Screen Studio
      </a>
    </section>
  );
}

function Screens({ show }: { show: Show }) {
  const { hero } = useSession();
  const own = stadiumEventFor(hero.scenario, hero.seed);
  const selected = useStore(show.state, (s) => s.selected);
  useEffect(() => {
    show.select(eventIndex(show.events, own));
    return () => show.dispose();
  }, [show, own]);
  const event = show.events[selected];
  return (
    <>
      <p className="note">
        {own
          ? `What the stadium's screens show for this moment (${EVENT_LABEL[own].toLowerCase()}).`
          : "This moment has no screens of its own: these are the key look's."}
      </p>
      <div className="pick-row" role="group" aria-label="Matchday event">
        {show.events.map((e, i) => (
          <button
            key={e.id}
            type="button"
            className="btn"
            aria-pressed={i === selected}
            onClick={() => show.select(i)}
          >
            {e.label}
            {e.rehearsal ? " (rehearsal)" : ""}
          </button>
        ))}
      </div>
      {event && <p className="note">{event.note}.</p>}
      <Suspense fallback={null}>
        <ScreenWall show={show} Heading="h4" />
      </Suspense>
    </>
  );
}

// ---------- Value: the business panel and the sponsor slots ----------

function ValuePanel() {
  useCachedBreakdown();
  const show = useStadiumShow();
  return (
    <Chapter
      className="journey-step journey-value studio"
      kicker={kickerOf("value")}
      title={<Title lead="What it could be" em="worth." />}
      lede="The package's audience, its click-through to the official watch entry, and the sponsors' share of it, on the app and in the stadium."
      aside={
        <p className="journey-facts">
          <DemoBadge /> <span>{FACTS_VS_FIGURES}</span>
        </p>
      }
      label="Value"
    >
      <BusinessValue />
      {show && !(show instanceof Error) && (
        <Suspense fallback={null}>
          <SponsorSlots events={show.events} Heading="h3" />
        </Suspense>
      )}
    </Chapter>
  );
}
