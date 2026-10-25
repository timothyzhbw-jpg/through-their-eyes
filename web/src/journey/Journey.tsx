// The studios' journey (SPEC 7, door 3 of doors/): one coherent path through a hero moment, from
// why its tactics work to what it is worth off the pitch, then the crew behind it. A bar that stays
// on screen while the door's page scrolls ("Tactics → Content → Value → Behind the scenes"; on a
// phone a stepper), and under it the open step's panel, all for the moment on screen:
// - Tactics: the Tactics lab (tacticslab/);
// - Content: the content package (studio/) and the stadium's screens (stadium/);
// - Value: the business panel (studio/) and the stadium's sponsor slots, both demo data;
// - Behind the scenes: the AI crew's breakdown (its cue list, the failure drill, the trace) and its
//   evidence, opened on the picture.
// Each step ends on one action: the next step. Arrow keys, Home and End move along the bar;
// ?door=studios&step=<id> opens a step (deeplink.ts). The moment itself, with the look and without
// it, is door 1's compare (ComparePanel, below). Nothing here calls a model by itself: every panel
// reads what the page already has, bundled files, or a cached breakdown (gate.tsx).

import { Fragment, lazy, Suspense, useEffect, useRef, type KeyboardEvent } from "react";
import { runLabels } from "../data/hero";
import { openDoor } from "../doors/state";
import { TacticsLabPanel } from "../tacticslab/TacticsLab";
import { useSession } from "../session";
import { EVENT_LABEL } from "../stadium/rules";
import type { Show } from "../stadium/show";
import { stepThroughOf } from "../steps/controller";
import { useStore } from "../store/store";
import { BusinessValue, StudioPackage } from "../studio/Studio";
import { enterStep, showEvidence } from "../tour/actions";
import { StepLines } from "../tour/StepLines";
import { BreakdownPanel } from "../ui/BreakdownPanel";
import { Chapter, Title } from "../ui/Chapter";
import { ArrowIcon } from "../ui/icons";
import { LineText } from "../ui/Narration";
import { jumpTo, useReveal } from "../ui/reveal";
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
    const id = requestAnimationFrame(() => panel.current && jumpTo(panel.current));
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
        <NextStep step={step} />
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
    <nav className="journey-bar" aria-label="For studios, from tactics to the crew">
      <div className="journey-tabs" role="tablist" aria-label="Studio steps" onKeyDown={onKeyDown}>
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
      {/* A phone: the same steps as a stepper, one at a time. */}
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
    </nav>
  );
}

/** The step's one action, under its panel: on to the next step; after the last, the end. */
function NextStep({ step }: { step: JourneyStep }) {
  const i = stepIndex(step);
  if (i === JOURNEY_STEPS.length - 1) {
    return (
      <p className="journey-end note">
        That&apos;s the studio side: every number above is checked in code or labelled as demo data.
      </p>
    );
  }
  const next = moveStep(step, 1);
  return (
    <div className="journey-next">
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          pick(next);
          document.getElementById(tabId(next))?.focus({ preventScroll: true });
        }}
      >
        Next: {STEP_LABEL[next]}
        <ArrowIcon />
      </button>
    </div>
  );
}

function StepPanel({ step }: { step: JourneyStep }) {
  switch (step) {
    case "tactics":
      return <TacticsLabPanel kicker={kickerOf("tactics")} />;
    case "content":
      return <ContentPanel />;
    case "value":
      return <ValuePanel />;
    case "crew":
      return <CrewPanel />;
  }
}

const kickerOf = (step: JourneyStep) =>
  `Step ${stepIndex(step) + 1} of ${JOURNEY_STEPS.length} · ${STEP_LABEL[step]}`;

// ---------- door 1's compare: the moment, with the look and without it ----------

/** The look's door, under the picture: the moment with the look and without it, each side told by
 * its verified lines (the switch to the run with two more looks is in the without side's lines),
 * and the scan story one link away. */
export function ComparePanel() {
  const factualCard = useReveal<HTMLElement>();
  const counterfactualCard = useReveal<HTMLElement>(1);
  const session = useSession();
  const { hero } = session;
  const bundled = useStore(withoutLookOf(session).state, (s) => s.data);
  const steps = stepThroughOf(session);
  const labels = runLabels(hero);
  // The app's own controls, as the tours use them: the picture is at the top of the page.
  const show = (name: "look" | "counterfactual" | "compare") => {
    window.scrollTo({ top: 0 });
    enterStep(name, session);
  };
  return (
    <Chapter
      className="journey-step journey-event"
      kicker="The look · compared"
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
      label="The look, compared"
    >
      <div className="pick-row">
        <button type="button" className="btn" onClick={() => show("look")}>
          {hero.keyScan ? "With the look" : "Watch the moment"}
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
        {!steps.unavailable && (
          <button
            id="scan-steps-story"
            type="button"
            className="btn btn-quiet"
            title="Step through each look he took, frozen, then his decision"
            onClick={() => {
              window.scrollTo({ top: 0 });
              steps.open();
            }}
          >
            Step through his looks
          </button>
        )}
      </div>
      <div className="tile-grid journey-compare">
        <article className="tile" aria-label={labels.factual} ref={factualCard}>
          <p className="kicker accent">{labels.factual}</p>
          <TheLook />
          <StepLines say="look" />
        </article>
        {hero.counterfactual && (
          <article
            className="tile journey-without"
            aria-label={labels.counterfactual}
            ref={counterfactualCard}
          >
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
      <LineText text={line.text} verified />
    </p>
  );
}

const REMOVED_LOOK = "removed_look"; // explain/look_cost.py: which look the comparison removes

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

// ---------- Behind the scenes: the AI crew ----------

/** The crew's breakdown as the existing panel tells it (its cue list, the failure drill, the crew
 * trace), and its evidence: each claim's events, opened on the picture in door 1. */
function CrewPanel() {
  const session = useSession();
  useCachedBreakdown(); // a cold visit (?step=crew): the cached breakdown the crew wrote
  return (
    <div className="journey-crew">
      <BreakdownPanel
        kicker={`${kickerOf("crew")}: the AI crew`}
        lead={
          <div className="pick-row">
            <button
              type="button"
              className="btn"
              title="A claim of the commentary, the Verifier's verdict and the match events it rests on"
              onClick={() => {
                openDoor("look", { address: true });
                window.scrollTo({ top: 0 });
                showEvidence(session);
              }}
            >
              Open the evidence
            </button>
          </div>
        }
      />
    </div>
  );
}
