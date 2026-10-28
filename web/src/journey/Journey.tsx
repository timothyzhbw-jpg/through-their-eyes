// For studios (SPEC 7, door 3 of doors/): what one moment does for the league's revenue, broadcast
// and social first. A bar that stays on screen while the door's page scrolls (on a phone a
// stepper), and under it the open section's panel, all for the moment on screen:
// - A · AI Tactical Broadcast: a broadcast's questions, each opening the view that answers it,
//   over the Tactics lab (tacticslab/);
// - B · AI Personalised Commentary: the audiences and languages (picked in Settings), and the AI
//   crew that writes them (its cue list, the failure drill, the trace, the evidence);
// - C · AI Automated Highlights: the content package (studio/) for the league's channels;
// - D · AI Stadium Experience: the stadium's screens (stadium/);
// - Value: the league's revenue levers in words, the one measured cost, then the demo KPIs (the
//   business panel and the sponsor slots, demo data).
// Each section has one value line, the feature that shows it, one "Business value" line and one
// primary action; under it, the next section. Arrow keys, Home and End move along the bar;
// ?door=studios&step=<id> opens a section (deeplink.ts). The moment itself, with the look and
// without it, is door 1's compare (ComparePanel, below). Nothing here calls a model by itself:
// every panel reads what the page already has, bundled files, or a cached breakdown (gate.tsx).

import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { runLabels } from "../data/hero";
import { openDoor, revealCompare } from "../doors/state";
import { LANGUAGE_NAME } from "../personal/summary";
import { TacticsLabPanel } from "../tacticslab/TacticsLab";
import type { CardId } from "../tacticslab/cards";
import { useBreakdown, useSession } from "../session";
import { EVENT_LABEL } from "../stadium/rules";
import type { Show } from "../stadium/show";
import { stepThroughOf } from "../steps/controller";
import { optionLabel, personLookup, personOf, scanDirection, tagOf } from "../steps/story";
import { useStore } from "../store/store";
import { BusinessValue, StudioPackage } from "../studio/Studio";
import { enterStep, showEvidence } from "../tour/actions";
import { StepLines } from "../tour/StepLines";
import { BreakdownPanel } from "../ui/BreakdownPanel";
import { Chapter, Title } from "../ui/Chapter";
import { ArrowIcon } from "../ui/icons";
import { PERSONA_LABEL } from "../ui/labels";
import { LineText, lineClaims } from "../ui/Narration";
import { jumpTo, useReveal } from "../ui/reveal";
import { blurbOf, settingsMenu } from "../ui/Stage";
import { withoutLookOf } from "../without/without";
import { WithoutLookLines } from "../without/WithoutLook";
import { DemoBadge, FACTS_VS_FIGURES } from "./DemoBadge";
import { useCachedBreakdown } from "./gate";
import { COST_PER_VERIFIED_BREAKDOWN, COST_REPORT_URL } from "./measured";
import { journey, openStep } from "./state";
import { eventIndex, stadiumEventFor, useStadiumShow } from "./stadium";
import {
  JOURNEY_STEPS,
  moveStep,
  STEP_LABEL,
  STEP_MARK,
  STEP_NOTE,
  STEP_TITLE,
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
    <nav
      className="journey-bar"
      aria-label="For studios: four solutions for the league, then the value"
    >
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
              {STEP_MARK[s] && (
                <span className="journey-num" aria-hidden="true">
                  {STEP_MARK[s]}
                </span>
              )}
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

/** Under the panel, the way on: the next section (the section's own primary action is above, in
 * its panel); after the last, the end. */
function NextStep({ step }: { step: JourneyStep }) {
  const i = stepIndex(step);
  if (i === JOURNEY_STEPS.length - 1) {
    return (
      <p className="journey-end note">
        That&apos;s the studio side: every figure above is measured, checked in code, or labelled as
        demo data.
      </p>
    );
  }
  const next = moveStep(step, 1);
  return (
    <div className="journey-next">
      <button
        type="button"
        className="btn"
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
    case "broadcast":
      return <BroadcastPanel />;
    case "commentary":
      return <CommentaryPanel />;
    case "highlights":
      return <HighlightsPanel />;
    case "stadium":
      return <StadiumPanel />;
    case "value":
      return <ValuePanel />;
  }
}

/** "A · AI Tactical Broadcast"; Value has no letter. */
const kickerOf = (step: JourneyStep) =>
  STEP_MARK[step] ? `${STEP_MARK[step]} · ${STEP_TITLE[step]}` : STEP_TITLE[step];

/** A solution's head: what it is (the kicker), its value in one line (the lede), and under it
 * what it is worth to the league, in one line. Its body is the feature that shows it, with the
 * section's one primary action. */
function Solution({
  step,
  className = "",
  title,
  lede,
  worth,
  children,
}: {
  step: JourneyStep;
  className?: string; // the feature's own styles (studio: the package's and the stadium's)
  title: ReactNode;
  lede: string;
  worth: string;
  children: ReactNode;
}) {
  return (
    <Chapter
      className={`journey-step journey-solution journey-${step} ${className}`.trim()}
      kicker={kickerOf(step)}
      title={title}
      lede={lede}
      aside={
        <p className="journey-worth">
          <strong className="journey-label">Business value</strong> <span>{worth}</span>
        </p>
      }
      label={STEP_TITLE[step]}
    >
      {children}
    </Chapter>
  );
}

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
          ? hero.keyScan
            ? `Try the simulation: ${tagOf(personOf(hero, hero.heroId!))} with his deliberate scan, then the same seconds re-simulated without it. ${blurbOf(hero)} Each side is told by its checked lines.`
            : `${blurbOf(hero)} Watch it, then the same seconds re-simulated with that one change; each side is told by its checked lines.`
          : blurbOf(hero)
      }
      aside={hero.counterfactual && hero.keyScan ? <CompareSummary /> : null}
      label="The look, compared"
    >
      <div className="pick-row">
        <button type="button" className="btn" onClick={() => show("look")}>
          {hero.keyScan ? "With the scan" : "Watch the moment"}
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

function CompareSummary() {
  const session = useSession();
  const { hero } = session;
  const data = useStore(withoutLookOf(session).state, (s) => s.data);
  const language = useStore(session.breakdown, (b) => b.language);
  const narration = data?.answers[language] ?? data?.answers.en ?? null;
  const line = (id: string) => narration?.lines.find((l) => l.id === id);
  const key = hero.keyScan!;
  const direction = scanDirection(hero, hero.runs.factual, key.start).code;
  const side = direction === "L" ? "left" : direction === "R" ? "right" : null;
  const before = ((hero.reception - key.start) * hero.dt).toFixed(1);
  const fallback = side
    ? `Removed: ${personOf(hero, hero.heroId!).name}'s look over his ${side} shoulder, ${before} seconds before the ball reached him.`
    : null;
  const removed = line(REMOVED_LOOK)?.text ?? fallback;
  const runner = hero.runnerId ? tagOf(personOf(hero, hero.runnerId)) : null;
  const look = removed
    ? runner
      ? `${removed.replace(/\.$/, "")}, where he saw ${runner}'s run behind him.`
      : removed
    : null;
  const decision = hero.runs.factual.decision;
  const chosen = decision
    ? optionLabel(decision.chosen, personLookup(hero)).replace(/^./, (c) => c.toLowerCase())
    : null;
  const cost = line("look_cost")?.text;
  const result = chosen ? `With it, ${chosen}.${cost ? ` ${cost}` : ""}` : null;
  if (!look && !result) return null;
  return (
    <div className="journey-compare-summary" lang={language}>
      {look && (
        <p className="note">
          <strong>The look:</strong> {look}
        </p>
      )}
      {result && (
        <p className="note">
          <strong>The result:</strong> {result}
        </p>
      )}
    </div>
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

// ---------- A · AI Tactical Broadcast ----------

/** The broadcast's question that opens the scan story: what closing it gives the keyboard back to
 * (App.tsx OPENER_IDS). */
export const ASK_RUN_ID = "studios-ask-run";

/** A broadcast's questions that a tactic card answers. */
const LAB_ASKS: readonly { card: CardId; ask: string }[] = [
  { card: "high_press", ask: "Why did this high press work?" },
  { card: "counter_attack", ask: "Why did xT jump on this attack?" },
  { card: "transition", ask: "What did the back line expose after losing the ball?" },
];

function BroadcastPanel() {
  const session = useSession();
  const steps = stepThroughOf(session);
  const [card, setCard] = useState<CardId>("high_press");
  // A question opens its card in the lab below, in view; the keyboard stays on the question.
  const ask = (c: CardId) => {
    setCard(c);
    requestAnimationFrame(() => {
      const el = document.querySelector("#tactics-lab .lab-card");
      if (el) jumpTo(el);
    });
  };
  // The run he saw: his looks step by step (a mode, closed back to this question), else door 1's
  // compare, the moment with the look and without it.
  const run = () => {
    window.scrollTo({ top: 0 });
    if (!steps.unavailable) {
      steps.open();
      return;
    }
    openDoor("look", { address: true });
    revealCompare();
  };
  // The broadcast itself: the moment played through his eyes with its overlays, on door 1.
  const watch = () => {
    openDoor("look", { address: true, focus: true });
    window.scrollTo({ top: 0 });
    session.controls.playBreakdown();
  };
  return (
    <>
      <Solution
        step="broadcast"
        title={<Title lead="Tactics," em="explained on air." />}
        lede="AI combines match events, player positions and tactical models into visual explanations a broadcast can air."
        worth="Deeper viewing, a differentiated broadcast product, and tactical-data display rights to sell to sponsors."
      >
        <div className="pick-row journey-asks" role="group" aria-label="Ask the broadcast">
          {LAB_ASKS.map((a) => (
            <button
              key={a.card}
              type="button"
              className="btn"
              aria-pressed={card === a.card}
              aria-controls="tactics-lab"
              onClick={() => ask(a.card)}
            >
              {a.ask}
            </button>
          ))}
          <button
            id={ASK_RUN_ID}
            type="button"
            className="btn"
            title={
              steps.unavailable
                ? "The moment with his scan and without it, on The look"
                : "His looks before the ball arrived, step by step: the run he saw, then his decision"
            }
            onClick={run}
          >
            Whose off-ball run made the shooting space?
          </button>
        </div>
        <div className="pick-row">
          <button type="button" className="btn btn-primary" onClick={watch}>
            Watch the broadcast
            <ArrowIcon />
          </button>
        </div>
      </Solution>
      <TacticsLabPanel kicker="The Tactics lab" card={card} onPick={setCard} />
    </>
  );
}

// ---------- B · AI Personalised Commentary ----------

/** Who the commentary is told for: the audiences and languages Settings picks. */
const AUDIENCES: readonly { name: string; line: string }[] = [
  { name: "Casual fan", line: "The plain account: what happened, and why it mattered." },
  { name: "Tactical analyst", line: "Shape, press, xG and space, every number checked." },
  {
    name: "Player focus",
    line: "Follow one player: his moments first, ringed on the pitch and on the board.",
  },
  {
    name: "Coach",
    line: "His eyes with the board beside them: when he looked against the ball, what changed without the look, and what to teach from it.",
  },
  {
    name: "Audio description",
    line: "For blind and low-vision fans: where he got the ball, which way he looked and whom he saw, in calm, slower speech with no jargon.",
  },
  {
    name: "Multilingual",
    line: "Subtitles, audio and summaries in the fan's language. We ship English and Chinese, each written for its language, not translated.",
  },
];

/** The commentary as the fan picks it, and behind it the crew that writes it: its breakdown panel
 * (the cue list, the failure drill, the crew trace) and its evidence, opened on the picture. */
function CommentaryPanel() {
  const session = useSession();
  const { persona, language } = useBreakdown();
  useCachedBreakdown(); // a cold visit (?step=commentary): the cached breakdown the crew wrote
  // Settings opens over the page, its toggle focused: Escape closes it back onto the toggle.
  const choose = () => {
    window.scrollTo({ top: 0 });
    settingsMenu.set({ open: true });
    document.getElementById("settings")?.focus({ preventScroll: true });
  };
  return (
    <>
      <Solution
        step="commentary"
        title={<Title lead="Every fan's" em="commentary." />}
        lede="One verified account of the moment, told for each fan: how deep it goes, whom it follows, and in which language."
        worth="A better international experience, more time in the official app, and a stronger draw for subscriptions."
      >
        <dl className="tile-grid journey-audiences">
          {AUDIENCES.map((a) => (
            <div key={a.name} className="tile">
              <dt>{a.name}</dt>
              <dd>{a.line}</dd>
            </div>
          ))}
        </dl>
        <p className="note">
          Now: {PERSONA_LABEL[persona]} · <span lang={language}>{LANGUAGE_NAME[language]}</span>.
          The audience and language are under Commentary in Settings; the player under Follow.
        </p>
        <div className="pick-row">
          <button type="button" className="btn btn-primary" onClick={choose}>
            Choose in Settings
          </button>
        </div>
      </Solution>
      <div className="journey-crew">
        <BreakdownPanel
          kicker="Behind the commentary: the AI crew"
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
    </>
  );
}

// ---------- C · AI Automated Highlights ----------

function HighlightsPanel() {
  useCachedBreakdown(); // a cold visit: the moment's cached breakdown, never a new one
  return (
    <Solution
      step="highlights"
      className="studio"
      title={<Title lead="Highlights," em="ready to post." />}
      lede="AI finds the goals, key saves, dangerous attacks and tactical turning points, stamps their times, writes the captions and lays out landscape and vertical versions."
      worth="Lower production cost, a shorter time from match event to published post, and a more efficient social operation."
    >
      <p className="note">Built from the lines the Verifier passed: no model is called.</p>
      <StudioPackage postsNote="For the league's own channels, to grow its reach: one format per platform (a short post, a carousel, a vertical video), in English and Chinese." />
      <p className="note journey-rights">
        Publishing and distribution stay within the rights the league grants.
      </p>
    </Solution>
  );
}

// ---------- D · AI Stadium Experience ----------

function StadiumPanel() {
  return (
    <Solution
      step="stadium"
      className="studio"
      title={<Title lead="The stadium," em="on the same moment." />}
      lede="The moment on the stadium's main board, tunnel LED and ribbon ring, with a virtual preview of the bowl."
      worth="New sponsor inventory on the stadium's own screens, and one matchday story from the broadcast to the stands."
    >
      <p className="note">
        Big-league stadiums already run giant main boards, tunnel LEDs and ribbon rings on matchday;
        this fills them from the match data.
      </p>
      <StadiumScreens />
    </Solution>
  );
}

function StadiumScreens() {
  const show = useStadiumShow();
  return (
    <section className="studio-block journey-stadium" aria-labelledby="journey-stadium">
      <h3 id="journey-stadium" className="block-title">
        On the screens
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
      <a
        className="btn btn-primary"
        href={`${import.meta.env.BASE_URL}?studio=1`}
        title="Every screen on the matchday programme, and the virtual 3D preview of the bowl"
      >
        Open the Stadium Screen Studio
        <ArrowIcon />
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

// ---------- Value: the league's revenue levers, then the demo KPIs ----------

/** What the four solutions do for the league's revenue, in words: no figure is put on any. */
const LEVERS: readonly { name: string; line: string }[] = [
  {
    name: "Broadcast differentiation",
    line: "a tactical layer, explained on air, that the league's broadcast partners can carry and a standard feed does not have.",
  },
  {
    name: "Sponsor inventory",
    line: "tactical-data displays on air, in the app and on the stadium's boards are new places to sell.",
  },
  {
    name: "International and app engagement",
    line: "commentary at each fan's depth and in their language keeps more of them in the official app.",
  },
  {
    name: "Social reach",
    line: "every key moment ready to post, in each platform's format and in English and Chinese, grows the league's own channels.",
  },
  {
    name: "Lower production cost",
    line: "highlights, captions and explainers come from checked data, so editors review rather than write from scratch.",
  },
];

function ValuePanel() {
  useCachedBreakdown();
  const show = useStadiumShow();
  return (
    <Chapter
      className="journey-step journey-value studio"
      kicker={kickerOf("value")}
      title={<Title lead="What it is worth" em="to the league." />}
      lede="The revenue levers first, in plain words; then the demo's own figures, every simulated one labelled."
      label="Value"
    >
      <section className="studio-block journey-levers" aria-labelledby="journey-levers">
        <h3 id="journey-levers" className="block-title">
          Revenue levers for the league
        </h3>
        <ul className="journey-lever-list">
          {LEVERS.map((l) => (
            <li key={l.name}>
              <strong>{l.name}:</strong> {l.line}
            </li>
          ))}
        </ul>
        <p className="note">
          Hypotheses, not sales: no league, broadcaster or sponsor has seen it, and we put no
          revenue figure on any of them.
        </p>
        <p className="journey-measured">
          <strong className="journey-label">Measured</strong>{" "}
          <span>
            <strong>{COST_PER_VERIFIED_BREAKDOWN}</strong> average model cost per eval breakdown
            with four scripts: the deployed AI crew on Microsoft Foundry, at list price (
            <a href={COST_REPORT_URL} target="_blank" rel="noreferrer">
              the crew vs single report
            </a>
            ).
          </span>
        </p>
      </section>
      <p className="journey-facts">
        <DemoBadge /> <span>{FACTS_VS_FIGURES}</span>
      </p>
      <BusinessValue heading="Demo KPIs" />
      {show && !(show instanceof Error) && (
        <Suspense fallback={null}>
          <SponsorSlots events={show.events} Heading="h3" />
        </Suspense>
      )}
    </Chapter>
  );
}
