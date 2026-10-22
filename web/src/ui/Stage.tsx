// The live screen of the Floodlit design (SPEC 7): the picture fills the screen and the controls
// sit over it. One camera switch films his eyes, the broadcast camera or the tactical board; the
// other view shrinks to a picture in picture. The overlay toggles live behind one "View options"
// button, who is watching sits in the header, and the moment card on the right has one primary
// action: read the moment.

import { QualityOption } from "../quality/QualityOption";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { DESCRIBED, PERSONAS, type Persona } from "../api/client";
import { isShot, runLabels, shotPost, type Hero } from "../data/hero";
import { trial } from "../players/trial";
import { crewSteps } from "../producer/producer";
import { ProvenanceChip } from "../provenance/ProvenanceChip";
import { FirstTourButton } from "../tour/Tour";
import { useBreakdown, useSession, useView, type Toggle } from "../session";
import { createStore, useStore, type Store } from "../store/store";
import { Hud, noBeliefs, SKELETON_TITLE } from "../views/PovOverlay";
import { LANGUAGES, type Language } from "../whatif/whatif";
import { ArrowIcon, ChevronIcon, CloseIcon, ExpandIcon, SlidersIcon } from "./icons";
import { PERSONA_LABEL } from "./labels";
import { MatchPicker } from "./Match";
import { Segmented } from "./Segmented";
import { clubName, shortName } from "../data/roster";

export const BLURB: Record<string, string> = {
  blind_side_run:
    "See what the midfielder saw, and what he would have done without one look over his shoulder.",
  press_escape:
    "See what the centre-back saw with an opponent closing in, and what carrying the ball would have cost.",
  screened_shot:
    "See what the keeper saw past the players in front of him, and what one step across his goal changed.",
  cutback_scan:
    "See what the winger saw when he looked into the box, and what he would have done without that one look.",
  far_post_finish:
    "See what the striker saw of the keeper as the cutback came, and where he would have shot without one look at the goal.",
  corner_blind_side:
    "A short corner. See what the centre-back saw of the man he marks, and where that man would have been without one look over his shoulder.",
};

export const blurbOf = (hero: Hero): string =>
  BLURB[hero.scenario] ?? `A hero moment: ${hero.scenario.replaceAll("_", " ")}.`;

const LANGUAGE_NAME: Record<Language, string> = { en: "English", zh: "中文" };

const PERSONA_NOTE: Record<Persona, string> = {
  casual: "The story, no jargon.",
  analyst: "The mechanism, with the numbers.",
  player_fan: "His view, his choices.",
  coach: "Shapes, distances, decisions.",
  audio_description: "Every line spoken, in large print.",
};

/** What he did, as a past-tense phrase: "passed to K. Annersley", "carried it". */
function didPhrase(action: string): string {
  if (action.startsWith("pass:")) return `passed to ${shortName(action.slice(5))}`;
  if (action === "carry") return "carried it";
  if (action === "shot") return "shot";
  const post = shotPost(action);
  if (post) return `shot at the ${post} post`;
  return `chose ${action}`;
}

/**
 * The moment's headline, from the runs (no numbers, nothing the runs do not show): the look
 * changed the decision, or the press he played out of. The last words are set in italic.
 */
export function momentTitle(hero: Hero): [string, string] {
  if (hero.marker) return markerTitle(hero, hero.marker);
  if (hero.keeperStep) {
    const { factual, counterfactual } = hero.keeperStep.resolved;
    return factual.type === "save" && counterfactual.type !== "save"
      ? ["One step, and", "he saves it."]
      : ["One step, and", "the same outcome."];
  }
  const did = hero.runs.factual.decision?.chosen;
  const without = hero.counterfactual ? hero.runs.counterfactual.decision?.chosen : undefined;
  if (hero.keyScan) {
    if (did && without && did !== without)
      return [
        "One look changed his",
        did.startsWith("pass:") ? "pass." : isShot(did) ? "shot." : "decision.",
      ];
    return ["One look, and", "the same choice."];
  }
  if (did) return ["Under pressure, he", `${didPhrase(did)}.`];
  return ["The", "moment."];
}

const KEPT_MARGIN_M = 1; // closer to his man by more than this with the look: the look kept him

/** A marker's look: did it keep him with his man (or win him the ball)? No numbers. */
function markerTitle(hero: Hero, m: NonNullable<Hero["marker"]>): [string, string] {
  const won = m.resolved.factual;
  if (won.type === "interception" && won.player === hero.heroId)
    return ["One look, and he", "won the ball."];
  if (m.separation.counterfactual - m.separation.factual > KEPT_MARGIN_M)
    return ["One look kept him", "with his man."];
  return ["One look, and", "the same outcome."];
}

export function MomentTitle({ hero }: { hero: Hero }) {
  const [lead, emphasis] = momentTitle(hero);
  return (
    <>
      {lead} <em>{emphasis}</em>
    </>
  );
}

/** "Moment · 3.00 s · Perception": when the decision falls on the clock, and the lens. */
export function momentKicker(hero: Hero, decisionFrame: number, offset: number): string {
  const lens = hero.keyScan || hero.keeperStep ? "Perception" : "Pressure"; // a step: his sight
  return `Moment · ${((decisionFrame + offset) * hero.dt).toFixed(2)} s · ${lens}`;
}

/** Close a popover on Escape (focus back to its button) or on a press outside it. */
function usePopover(
  open: boolean,
  close: () => void,
  wrap: RefObject<HTMLElement | null>,
  toggle: RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, close, wrap]);
  return (e: ReactKeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    close();
    toggle.current?.focus();
  };
}

// ---------- camera ----------

type Shot = "pov" | "broadcast" | "tactical";

/** His eyes, the broadcast camera or the tactical board as the main view. */
export function CameraSwitch() {
  const { playback, controls } = useView();
  const focus = useStore(playback, (s) => s.focus);
  const camera = useStore(playback, (s) => s.camera);
  const value: Shot = focus === "tactical" ? "tactical" : camera;
  const pick = (shot: Shot) => {
    // Every switch is a clean cut (beat/cut.ts).
    if (shot === "tactical") return controls.setFocus("tactical");
    controls.setCamera(shot);
    // The picture in picture stays as it was: off (the 3D view alone) or on (the board with it).
    controls.setFocus(focus === "pov" || focus === "broadcast" ? shot : "split");
  };
  return (
    <Segmented<Shot>
      label="Camera"
      className="camera"
      value={value}
      onPick={pick}
      options={[
        { value: "pov", label: "His eyes", title: "Through the eyes of the chosen player" },
        {
          value: "broadcast",
          label: "Broadcast",
          title: "High on the near side, following the ball",
        },
        { value: "tactical", label: "Tactical", title: "The board from above" },
      ]}
    />
  );
}

/** Over the picture in picture: make it the main view. */
export function SwapViews() {
  const { playback, controls } = useView();
  const focus = useStore(playback, (s) => s.focus);
  const camera = useStore(playback, (s) => s.camera);
  const board = focus === "tactical";
  const name = !board
    ? "Make the tactical board the main view"
    : camera === "broadcast"
      ? "Make the broadcast camera the main view"
      : "Make his eyes the main view";
  return (
    <button
      type="button"
      className="swap"
      aria-label={name}
      title={name}
      onClick={() =>
        controls.setFocus(board ? (camera === "broadcast" ? "broadcast" : "split") : "tactical")
      }
    >
      <ExpandIcon />
    </button>
  );
}

// ---------- whose eyes ----------

/** Whose eyes the first-person view looks through; he also owns the vision cone on the board. */
export function PlayerPicker() {
  const { hero, playback, controls } = useView();
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  return (
    <label className="eyes-picker">
      <span className="eyes-label" aria-hidden="true">
        Eyes
      </span>
      <select
        value={povPlayer}
        onChange={(e) => controls.setPovPlayer(e.target.value)}
        aria-label="Whose eyes"
        title="Whose eyes the first-person view looks through"
      >
        {[0, 1].map((team) => (
          <optgroup key={team} label={clubName(team)}>
            {hero.players
              .filter((p) => p.team === team)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {shortName(p.id)} · {p.role}
                  {p.id === hero.heroId ? " (hero)" : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** Top left of the picture: the player picker, and his readouts while his eyes are on screen. */
export function StageHud() {
  const { playback } = useView();
  const pov = useStore(playback, (s) => s.camera === "pov" && s.focus !== "tactical");
  return (
    <div className="stage-hud">
      <PlayerPicker />
      {pov && <Hud />}
    </div>
  );
}

// ---------- view options ----------

function Chip(props: { name: Toggle; label: string; title: string; disabled?: boolean }) {
  const { playback, controls } = useView();
  const on = useStore(playback, (s) => s[props.name]);
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={on && !props.disabled}
      disabled={props.disabled}
      title={props.title}
      onClick={() => controls.toggle(props.name)}
    >
      {props.label}
    </button>
  );
}

const SPEEDS = [0.25, 0.5, 1];
const MATCH_SPEEDS = [0.5, 1, 2, 4]; // a whole match is long: faster, no slow motion

/** Playback speed: slow motion for a moment, faster for a whole match. */
function SpeedOption() {
  const { hero, playback, controls } = useView();
  const speed = useStore(playback, (s) => s.speed);
  const speeds = hero.match ? MATCH_SPEEDS : SPEEDS;
  return (
    <label className="picker">
      <span>Playback speed</span>
      <select
        value={String(speeds.includes(speed) ? speed : 1)}
        onChange={(e) => controls.setSpeed(Number(e.target.value))}
        aria-label="Playback speed"
      >
        {speeds.map((s) => (
          <option key={s} value={String(s)}>
            {s}×
          </option>
        ))}
      </select>
    </label>
  );
}

/** First person: comfort, belief ghosts, animated players; and the playback speed. */
export function PovOptions() {
  const { hero, playback } = useView();
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const rigged = useStore(trial, (s) => s.rigged);
  const ghostsAvailable = povPlayer === hero.heroId;
  const ghostsOn = useStore(playback, (s) => s.beliefGhosts);
  return (
    <section className="options-group">
      <h3 className="kicker">Playback and his eyes</h3>
      <SpeedOption />
      <div className="chips">
        <Chip
          name="comfort"
          label="Comfort"
          title="Eased head turns and slower playback when the head whips round"
        />
        <Chip
          name="motionBlur"
          label="Motion blur"
          title="A slight smear while his head whips round, as a camera's would (off by default)"
        />
        <Chip
          name="beliefGhosts"
          label="Belief ghosts"
          disabled={!ghostsAvailable}
          title={
            ghostsAvailable
              ? "Where he believes the runner is, from his look to his decision: a ring on the grass and a line to where the runner really is"
              : noBeliefs(hero)
          }
        />
        <Chip
          name="ghostsAll"
          label="All ghosts"
          disabled={!ghostsAvailable || !ghostsOn}
          title="Everyone his picture has a metre or more wrong, at any time, on the broadcast camera too"
        />
        <button
          type="button"
          className="chip"
          aria-pressed={rigged}
          onClick={() => trial.set({ rigged: !rigged })}
          title="Animated players (Gameplay Football models) instead of tokens"
        >
          Animated players
        </button>
      </div>
    </section>
  );
}

/**
 * The tactical board's layers (the skeleton is drawn on the broadcast camera too: one chip, one
 * state), and whether the board rides along as a picture in picture.
 */
export function TacticalOptions() {
  const { hero, playback, controls } = useView();
  const mode = useStore(playback, (s) => s.mode);
  const focus = useStore(playback, (s) => s.focus);
  const camera = useStore(playback, (s) => s.camera);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const labels = runLabels(hero);
  const pip = focus === "split" || focus === "tactical";
  return (
    <section className="options-group">
      <h3 className="kicker">Tactical board</h3>
      <div className="chips">
        <Chip
          name="cone"
          label="Vision cone"
          disabled={!hero.vision}
          title={
            hero.vision
              ? `${povPlayer}'s field of view`
              : "The vision model comes with a hero moment's export"
          }
        />
        <Chip
          name="options"
          label="Pass options"
          title="At the decision: every option he weighed, on his belief and on the truth"
        />
        <Chip
          name="blindSide"
          label="Blind side"
          title="Live: who has lost sight of a player on the move, from tracking only"
        />
        <Chip
          name="pitchControl"
          label="Pitch control"
          title="Which team gets to each point of the pitch first (home: coral, away: blue)"
        />
        <Chip name="skeleton" label="Skeleton" title={SKELETON_TITLE} />
        {hero.counterfactual && (
          <Chip
            name="cfGhost"
            label={mode === "factual" ? labels.ghostOfCounterfactual : labels.ghostOfFactual}
            title="Ball path of the other run, from the decision on"
          />
        )}
        <button
          type="button"
          className="chip"
          aria-pressed={pip}
          disabled={focus === "tactical"}
          title="The other view in a small window in the corner"
          onClick={() => controls.setFocus(pip ? camera : "split")}
        >
          Picture in picture
        </button>
      </div>
    </section>
  );
}

/** Every overlay toggle of both views, behind one button. */
export function ViewOptions() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useRef(() => setOpen(false)).current;
  const onKeyDown = usePopover(open, close, wrap, toggle);
  return (
    <div className="popover-wrap view-options" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        type="button"
        className="btn btn-quiet"
        aria-label="View options"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <SlidersIcon />
        <span className="btn-label">View options</span>
      </button>
      {open && (
        <div id={id} className="popover options-panel" role="group" aria-label="View options">
          <PovOptions />
          <QualityOption />
          <TacticalOptions />
        </div>
      )}
    </div>
  );
}

// ---------- who is watching ----------

/** The audience and language of the commentary, in the header (SPEC 1). It stays open while the
 * viewer picks, until Escape or a press outside. */
export function ViewerMenu() {
  const { api, controls } = useSession();
  const { persona, language } = useBreakdown();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const close = useRef(() => setOpen(false)).current;
  const onKeyDown = usePopover(open, close, wrap, toggle);
  const online = api !== null;
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  return (
    <div className="popover-wrap viewer" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        type="button"
        className="btn viewer-toggle"
        aria-label={`Watching as ${PERSONA_LABEL[persona]} · ${LANGUAGE_NAME[language]}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {/* The initial is drawn by CSS: as text it would be shown but not named (WCAG 2.5.3). */}
        <span
          className="avatar"
          aria-hidden="true"
          data-initial={PERSONA_LABEL[persona].charAt(0)}
        />
        <span>
          <span className="hide-sm">Watching as </span>
          {PERSONA_LABEL[persona]} · {LANGUAGE_NAME[language]}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="popover viewer-panel" role="dialog" aria-label="Who is watching">
          <p className="kicker">Commentary for</p>
          {PERSONAS.map((p) => (
            <button
              key={p}
              ref={p === persona ? first : undefined}
              type="button"
              className="persona"
              aria-pressed={p === persona}
              disabled={!online && p !== persona}
              // The menu stays open: the language, or another audience, is one more pick. It
              // closes on Escape or a press outside (usePopover), the keyboard back on the toggle.
              onClick={() => controls.setPersona(p)}
            >
              <span className="persona-name">{PERSONA_LABEL[p]}</span>{" "}
              <span className="persona-note">{PERSONA_NOTE[p]}</span>
            </button>
          ))}
          <div className="viewer-lang">
            <span className="kicker">Language</span>
            <Segmented<Language>
              label="Language"
              value={language}
              onPick={controls.setLanguage}
              options={LANGUAGES.map((l) => ({
                value: l,
                label: LANGUAGE_NAME[l],
                lang: l,
                disabled: !online && l !== language,
              }))}
            />
          </div>
          <MatchPicker />
          {!online && <p className="note">Other audiences and languages need the live service.</p>}
          {DESCRIBED.has(persona) && (
            <p className="note">Audio description speaks every line and sets it in large print.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- the moment card ----------

/** Who wrote the breakdown and whether its numbers were checked; the crew's steps as they ran. */
function CrewStatus() {
  const { status, origin, narration } = useBreakdown();
  let body: ReactNode = null;
  if (status === "loading") {
    body = (
      <>
        <span className="crew-bar working" aria-hidden="true">
          <i />
        </span>
        <span className="crew-note">The crew is writing the breakdown…</span>
      </>
    );
  } else if (status === "ready" || status === "failed") {
    const steps = origin?.kind === "api" ? crewSteps(origin) : [];
    // Who wrote it is what the service said (provenance), never a guess from the other fields.
    const note = !narration
      ? "No narration: the breakdown failed its checks"
      : narration.fixture
        ? "Bundled example · not checked by the verifier"
        : "Every number checked in code";
    body = (
      <>
        {steps.length > 0 && (
          <span className="crew-bar" aria-hidden="true">
            {steps.map((s) => (
              <i key={s.step} data-step={s.step} data-source={s.source ?? ""} />
            ))}
          </span>
        )}
        {origin?.kind === "api" && <ProvenanceChip provenance={origin.provenance} />}
        <span className="crew-note">{note}</span>
      </>
    );
  }
  return (
    <div className="crew-status" aria-live="polite">
      {body}
    </div>
  );
}

/** Whether the viewer closed a session's moment card: kept per session, so the card stays closed
 * when its slot shows the evidence, Your call or Take his eyes and comes back. */
const cardClosed = new WeakMap<object, Store<{ closed: boolean }>>();
function closedOf(session: object): Store<{ closed: boolean }> {
  let store = cardClosed.get(session);
  if (!store)
    cardClosed.set(session, (store = createStore<{ closed: boolean }>({ closed: false })));
  return store;
}

/** The hero moment, top right of the live screen: what it is, the crew, and what to do next.
 * Its × or Escape (from inside it) closes it to a chip that opens it again. */
export function MomentCard() {
  const session = useSession();
  const closed = useStore(closedOf(session), (s) => s.closed);
  const chip = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const moved = useRef(false); // the viewer opened or closed it: focus follows (not on mount)
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (closed ? chip : close).current?.focus({ preventScroll: true });
  }, [closed]);
  const setClosed = (value: boolean) => {
    moved.current = true;
    closedOf(session).set({ closed: value });
  };
  if (closed) {
    return (
      <button
        ref={chip}
        type="button"
        className="btn moment-chip"
        aria-expanded={false}
        onClick={() => setClosed(false)}
      >
        <i className="dot" aria-hidden="true" />
        Show the moment
      </button>
    );
  }
  return <MomentCardBody closeRef={close} onClose={() => setClosed(true)} />;
}

function MomentCardBody({
  closeRef,
  onClose,
}: {
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { hero, moment, offset, runner, controls, playback, feed } = useSession();
  const { status } = useBreakdown();
  const run = useStore(runner.status, (s) => s.status);
  const live = useStore(playback, (s) => s.live);
  const waiting = status === "waiting";
  // Waiting for the moment, the card says what is really going on: watching only while the
  // stream is live; "left" once frames came in and the viewer left before the moment (the Live
  // pill and the transport do). A link that opens paused never streamed: it names the moment.
  // `latest` only matters once `live` drops, and that change re-renders the card.
  const watching = waiting && live;
  const left = waiting && !live && (feed?.state.get().latest ?? -1) >= 0;
  const running = run === "running";
  const label = running
    ? "Stop"
    : waiting
      ? "Get breakdown"
      : status === "loading"
        ? "Loading…"
        : run === "idle"
          ? "Play breakdown"
          : "Replay breakdown";
  return (
    <aside
      className="moment-card card"
      aria-label="The moment"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}
    >
      <div className="card-head">
        <span className="kicker accent">
          <i className="dot" aria-hidden="true" />
          {watching
            ? "Live · waiting for the moment"
            : left
              ? "Off the stream · moment not reached"
              : momentKicker(hero, moment.decisionFrame, offset)}
        </span>
        <button
          ref={closeRef}
          type="button"
          className="icon-btn"
          aria-label="Dismiss the moment"
          aria-keyshortcuts="Escape"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      {left ? (
        <>
          <h2>You left the stream.</h2>
          <p className="card-body">
            The stream stopped before it reached the moment. Press Live to pick it up again, or get
            the breakdown now.
          </p>
        </>
      ) : watching ? (
        <>
          <h2>Watching the stream.</h2>
          <p className="card-body">
            The moment appears here when the stream detects it. Nothing to read yet, and nothing
            pretends otherwise.
          </p>
        </>
      ) : (
        <>
          <h2>
            <MomentTitle hero={hero} />
          </h2>
          <p className="card-body">{blurbOf(hero)}</p>
        </>
      )}
      <CrewStatus />
      <div className="card-actions">
        {!waiting && (
          <a className="btn btn-primary" href="#moment">
            Read the moment
            <ArrowIcon />
          </a>
        )}
        <button
          type="button"
          className={waiting ? "btn btn-primary" : "btn"}
          disabled={!running && status === "loading"}
          onClick={running ? controls.stopBreakdown : controls.playBreakdown}
        >
          {label}
        </button>
      </div>
      <FirstTourButton />
    </aside>
  );
}
