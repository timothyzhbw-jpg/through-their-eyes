// The live screen of the Floodlit design (SPEC 7): the picture fills the screen and few controls
// sit over it. One camera switch films his eyes, the broadcast camera or the tactical board; the
// other view shrinks to a picture in picture. The header's "⋯ Settings" holds the rest: the moment,
// who is watching, who to follow, sound, View options (whose eyes, the Auto director, the data on
// the pitch and the overlay toggles) and the full tour. The moment card on the right has one
// action: the breakdown.

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
import { useBreakdown, useSession, useView, type Toggle } from "../session";
import { createStore, useStore, type Store } from "../store/store";
import { Hud, noBeliefs, SKELETON_TITLE } from "../views/PovOverlay";
import { LANGUAGES, type Language } from "../whatif/whatif";
import { ChevronIcon, DotsIcon, ExpandIcon, SlidersIcon } from "./icons";
import { PERSONA_LABEL } from "./labels";
import { MatchPicker } from "./Match";
import { Segmented } from "./Segmented";
import { clubName, shortName } from "../data/roster";
import { directorPrefs } from "../director/director";
import { directorOf, useSuggestion } from "../director/DirectorBar";
import { pitchData, setPitchData } from "./pitchData";
import { captionStoryPrefs, setCaptionStory } from "./captionStory";

export const BLURB: Record<string, string> = {
  blind_side_run:
    "See what the midfielder saw, and what he would have done without one scan over his shoulder.",
  press_escape:
    "See what the centre-back saw with an opponent closing in, and what carrying the ball would have cost.",
  screened_shot:
    "See what the keeper saw past the players in front of him, and what one step across his goal changed.",
  cutback_scan:
    "See what the winger saw when he looked into the box, and what he would have done without that one scan.",
  far_post_finish:
    "See what the striker saw of the keeper as the cutback came, and where he would have shot without one scan at the goal.",
  corner_blind_side:
    "A short corner. See what the centre-back saw of the man he marks, and where that man would have been without one scan over his shoulder.",
};

export const blurbOf = (hero: Hero): string =>
  BLURB[hero.scenario] ?? `A hero moment: ${hero.scenario.replaceAll("_", " ")}.`;

const LANGUAGE_NAME: Record<Language, string> = { en: "English", zh: "中文" };

// What each audience gets (SPEC 6, "Persona specs"): said and shown.
const PERSONA_NOTE: Record<Persona, string> = {
  casual: "The story in three lines, through his eyes.",
  analyst: "The board, pitch control and every number.",
  player_fan: "His look, his pass, the camera on him.",
  coach: "When he looked, and what to teach.",
  audio_description: "Who is where, in order, read slowly.",
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
        "One scan changed his",
        did.startsWith("pass:") ? "pass." : isShot(did) ? "shot." : "decision.",
      ];
    return ["One scan, and", "the same choice."];
  }
  if (did) return ["Under pressure, he", `${didPhrase(did)}.`];
  return ["The", "moment."];
}

const KEPT_MARGIN_M = 1; // closer to his man by more than this with the look: the look kept him

/** A marker's look: did it keep him with his man (or win him the ball)? No numbers. */
function markerTitle(hero: Hero, m: NonNullable<Hero["marker"]>): [string, string] {
  const won = m.resolved.factual;
  if (won.type === "interception" && won.player === hero.heroId)
    return ["One scan, and he", "won the ball."];
  if (m.separation.counterfactual - m.separation.factual > KEPT_MARGIN_M)
    return ["One scan kept him", "with his man."];
  return ["One scan, and", "the same outcome."];
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
export function usePopover(
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

/** His eyes, the broadcast camera or the tactical board as the main view. The director's pending
 * suggestion is a dot on its camera: picking that camera takes it (whose eyes too). */
export function CameraSwitch() {
  const session = useView();
  const { playback, controls } = session;
  const focus = useStore(playback, (s) => s.focus);
  const camera = useStore(playback, (s) => s.camera);
  const suggestion = useSuggestion(session);
  const hint = useId();
  const value: Shot = focus === "tactical" ? "tactical" : camera;
  const pick = (shot: Shot) => {
    if (suggestion?.camera === shot) return directorOf(session).take();
    // Every switch is a clean cut (beat/cut.ts).
    if (shot === "tactical") return controls.setFocus("tactical");
    controls.setCamera(shot);
    // The picture in picture stays as it was: off (the 3D view alone) or on (the board with it).
    controls.setFocus(focus === "pov" || focus === "broadcast" ? shot : "split");
  };
  const option = (shot: Shot, label: string, title: string) => {
    const suggested = suggestion?.camera === shot;
    return {
      value: shot,
      label: (
        <>
          {label}
          {suggested && <i className="cam-dot" aria-hidden="true" />}
        </>
      ),
      title: suggested ? suggestion.text : title,
      describedBy: suggested ? hint : undefined,
    };
  };
  return (
    <>
      <Segmented<Shot>
        label="Camera"
        className="camera"
        value={value}
        onPick={pick}
        options={[
          option("pov", "His eyes", "Through the eyes of the chosen player"),
          option("broadcast", "Broadcast", "High on the near side, following the ball"),
          option("tactical", "Tactical", "The board from above"),
        ]}
      />
      {suggestion && (
        <span id={hint} className="sr-only">
          Suggested: {suggestion.text}
        </span>
      )}
    </>
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

/** Top left of the picture while his eyes are on screen (whose eyes is picked in View options):
 * the scan and blind-side badges, and his readouts with the data on the pitch. */
export function StageHud() {
  const { playback } = useView();
  const pov = useStore(playback, (s) => s.camera === "pov" && s.focus !== "tactical");
  const data = useStore(pitchData, (s) => s.on);
  if (!pov) return null;
  return (
    <div className="stage-hud">
      <Hud readout={data} />
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

export const SPEEDS = [0.25, 0.5, 1];
export const MATCH_SPEEDS = [0.5, 1, 2, 4]; // a whole match is long: faster, no slow motion

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

/** The measured tags over the players and his readouts: off by default, kept between visits. */
function PitchDataOption() {
  const on = useStore(pitchData, (s) => s.on);
  return (
    <section className="options-group">
      <h3 className="kicker">On the pitch</h3>
      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={on}
          onClick={() => setPitchData(!on)}
          title="The measured tags over the players (passes, sprints, the ball carrier) and his readouts in his eyes"
        >
          Show data on the pitch
        </button>
      </div>
    </section>
  );
}

function CaptionStoryOption() {
  const on = useStore(captionStoryPrefs, (s) => s.on);
  return (
    <section className="options-group">
      <h3 className="kicker">Captions</h3>
      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={on}
          onClick={() => setCaptionStory(!on)}
          title="Keep the lines already captioned beside the picture on desktop"
        >
          Story beside the picture
        </button>
      </div>
    </section>
  );
}

/** Whose eyes and the Auto director, off the picture. */
function CameraOptions() {
  const auto = useStore(directorPrefs, (s) => s.auto);
  return (
    <section className="options-group">
      <h3 className="kicker">Camera</h3>
      <PlayerPicker />
      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={auto}
          onClick={() => directorPrefs.set({ auto: !auto })}
          title="Let the director cut the cameras: it holds each shot a moment, never cuts in the middle of a scan, and never starts a replay"
        >
          Auto director
        </button>
      </div>
    </section>
  );
}

/** Every overlay toggle of both views, behind one button (in the header's ⋯, where it opens in
 * place). */
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
        <ChevronIcon />
      </button>
      {open && (
        <div id={id} className="popover options-panel" role="group" aria-label="View options">
          <PitchDataOption />
          <CaptionStoryOption />
          <CameraOptions />
          <PovOptions />
          <QualityOption />
          <TacticalOptions />
        </div>
      )}
    </div>
  );
}

// ---------- settings ----------

/** Whether the header's Settings menu is open: page-wide, so a tour step or a deep link
 * (?step=your-view) can open it, and a door change keeps it as it was. */
export const settingsMenu = createStore<{ open: boolean }>({ open: false });

/** Open Settings when `el` sits in it closed (a tour step points at it); true when it did. */
export function revealInMenu(el: Element): boolean {
  const panel = el.closest<HTMLElement>(".more-panel");
  if (!panel?.hidden) return false;
  settingsMenu.set({ open: true });
  return true;
}

/** A section of the Settings menu, under a quiet label. */
export function MenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="menu-section" role="group" aria-label={label}>
      <p className="menu-label" aria-hidden="true">
        {label}
      </p>
      {children}
    </div>
  );
}

/** The header's one menu, "⋯ Settings": the moment, the audience and language, who to follow, the
 * sound, the view options and the full tour, behind one button. The items stay mounted while it is
 * closed (`hidden`): a tour step whose target is in here opens it (tour/Tour.tsx). Escape closes
 * it, or the menu inside it that is open, and the keyboard goes back to that menu's button. */
export function SettingsMenu({ children }: { children: ReactNode }) {
  const open = useStore(settingsMenu, (s) => s.open);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useRef(() => settingsMenu.set({ open: false })).current;
  const onKeyDown = usePopover(open, close, wrap, toggle);
  return (
    <div className="popover-wrap header-more settings" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        id="settings"
        type="button"
        className="btn settings-toggle"
        aria-label="Settings"
        title="The moment, audience and language, who you follow, sound, view options, the full tour"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => settingsMenu.set({ open: !open })}
      >
        <DotsIcon />
        <span className="btn-label">Settings</span>
      </button>
      <div
        id={id}
        className="popover more-panel"
        role="group"
        aria-label="Settings"
        hidden={!open}
        // A tour takes the screen, and a moment link leaves the page: the menu closes behind them.
        onClick={(e) => (e.target as Element).closest(".tour-start, .moment-chip") && close()}
      >
        {children}
      </div>
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

/** The hero moment, top right of the live screen: its title, one line and one action. Escape from
 * inside it closes it to a chip that opens it again. */
export function MomentCard() {
  const session = useSession();
  const closed = useStore(closedOf(session), (s) => s.closed);
  const chip = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const moved = useRef(false); // the viewer opened or closed it: focus follows (not on mount)
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (closed) return chip.current?.focus({ preventScroll: true });
    card.current?.querySelector<HTMLButtonElement>(".moment-close")?.focus({ preventScroll: true });
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
        Show the moment card
      </button>
    );
  }
  return <MomentCardBody cardRef={card} onClose={() => setClosed(true)} />;
}

// The card's one line under the title: short; the story below has the full lede (BLURB).
export const CARD_LINE: Record<string, string> = {
  blind_side_run: "Through the midfielder's eyes, with and without one scan.",
  press_escape: "Through the centre-back's eyes, as the press closes in.",
  screened_shot: "Through the keeper's eyes, past the players in front of him.",
  cutback_scan: "Through the winger's eyes, with and without one scan.",
  far_post_finish: "Through the striker's eyes, as the cutback comes.",
  corner_blind_side: "A short corner, through the eyes of the man marking.",
};

export const cardLineOf = (hero: Hero): string => CARD_LINE[hero.scenario] ?? blurbOf(hero);

function MomentCardBody({
  cardRef,
  onClose,
}: {
  cardRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { hero, runner, controls, playback, feed } = useSession();
  const { status } = useBreakdown();
  const run = useStore(runner.status, (s) => s.status);
  const live = useStore(playback, (s) => s.live);
  const waiting = status === "waiting";
  // Waiting for the moment, the card says what is really going on: watching only while the
  // stream is live; "left" once frames came in and the viewer left before the moment. A link that
  // opens paused never streamed: it names the moment. `latest` only matters once `live` drops,
  // and that change re-renders the card.
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
      ref={cardRef}
      className="moment-card card"
      aria-label="The moment"
      aria-keyshortcuts="Escape"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}
    >
      <button
        type="button"
        className="icon-btn moment-close"
        aria-label="Hide the moment card"
        onClick={onClose}
      >
        ×
      </button>
      {left ? (
        <>
          <h2>You left the stream.</h2>
          <p className="card-body">It stopped before the moment. Get the breakdown now.</p>
        </>
      ) : watching ? (
        <>
          <h2>Watching the stream.</h2>
          <p className="card-body">The moment shows here when the stream detects it.</p>
        </>
      ) : (
        <>
          <h2>
            <MomentTitle hero={hero} />
          </h2>
          <p className="card-body">{cardLineOf(hero)}</p>
        </>
      )}
      {/* One action for the card's whole life: the breakdown (the rest is in the header's ⋯). */}
      <div className="card-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!running && status === "loading"}
          onClick={running ? controls.stopBreakdown : controls.playBreakdown}
        >
          {label}
        </button>
      </div>
      <CrewStatus />
    </aside>
  );
}
