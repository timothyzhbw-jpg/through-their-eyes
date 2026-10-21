// Verified narration in the main view (SPEC 5.3, 7): the caption over the first-person view, the
// evidence card under the views, and the list of every line. Any line can be opened: it shows
// each claim with its kind label, verdict, values and evidence events, and seeks the replay to
// the evidence. Counterfactual claims always carry their label: they are causal only in the sim.
// With the live service the panel also picks the persona and language (SPEC 1), says where the
// breakdown came from (cached or generated, model or template, rate limit and daily cap) and
// turns the voice on, and each claim with a number in the evidence card offers "Try a wrong
// number": the service's verifier checks the claim again with the viewer's value (SPEC 7).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DESCRIBED, PERSONAS, type VerifyResponse } from "../api/client";
import { runLabels, type Hero } from "../data/hero";
import {
  claimRun,
  KIND_LABEL,
  lineKinds,
  lineOf,
  type ClaimKind,
  type Narration,
  type PayloadClaim,
  type PayloadLine,
} from "../narration/payload";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { numericValues, wrongNumber, type TamperState } from "../tamper/tamper";
import { LANGUAGES } from "../whatif/whatif";
import { CheckIcon, SoundOffIcon, SoundOnIcon } from "./icons";
import { LANG_LABEL, PERSONA_LABEL } from "./labels";
import { Chapter } from "./Chapter";
import { numberParts } from "./numbers";
import { Segmented } from "./Segmented";
import { formatSlot, plainReason, slotLabel } from "./tamperText";
import "./live.css";
import "./whatif.css";

export function KindTag({ kind }: { kind: ClaimKind }) {
  return (
    <span className={`kind kind-${kind}`} title={KIND_LABEL[kind].detail}>
      {KIND_LABEL[kind].name}
      {kind === "counterfactual" && " · inside the sim"}
    </span>
  );
}

export function KindTags({ narration, line }: { narration: Narration; line: PayloadLine }) {
  const kinds = lineKinds(narration, line);
  if (!kinds.length) return null;
  return (
    <span className="kind-tags">
      {kinds.map((k) => (
        <KindTag key={k} kind={k} />
      ))}
    </span>
  );
}

const hasCounterfactual = (narration: Narration, line: PayloadLine) =>
  lineKinds(narration, line).includes("counterfactual");

/** A line the verifier checked: it has claims and the payload is not the unchecked fixture. */
export const isVerified = (narration: Narration, line: PayloadLine) =>
  !narration.fixture && line.claims.length > 0;

/**
 * A line's text; in a verified line each number, with its unit, gets the dotted Floodlight
 * underline (every digit on air was slot-filled from a checked value).
 */
export function LineText({ text, verified }: { text: string; verified: boolean }) {
  if (!verified) return <>{text}</>;
  return (
    <>
      {numberParts(text).map((p, k) =>
        p.num ? (
          <span key={k} className="num">
            {p.text}
          </span>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

const SPEAKER: Record<string, string> = { pbp: "Play-by-play", color: "Co-commentator" };

/**
 * The current voice line over the first-person view. Click to open its evidence. Large print for
 * audio description (SPEC 1). A screen reader hears each line from a live region that is always
 * present, except while a voice clip is actually playing.
 */
export function Caption() {
  const { playback, controls, voice } = useSession();
  const { narration, persona, voice: cues } = useBreakdown();
  const lineId = useStore(playback, (s) => s.captionLine);
  const open = useStore(playback, (s) => s.evidenceLine);
  // Only a clip that is playing speaks: sound on with a blocked, failed or capped clip is silent.
  const speaking = useStore(voice.state, (s) => s.on && s.status === "playing");
  const line = lineOf(narration, lineId);
  const large = DESCRIBED.has(persona) ? " large" : "";
  const speaker = SPEAKER[cues.find((c) => c.line === lineId)?.speaker ?? ""];
  const verified = !!narration && !!line && isVerified(narration, line);
  return (
    <>
      <p className="sr-only" aria-live={speaking ? "off" : "polite"}>
        {line?.text}
      </p>
      {narration && line && (
        <button
          type="button"
          className={(hasCounterfactual(narration, line) ? "caption cf" : "caption") + large}
          aria-expanded={open === line.id}
          onClick={() => controls.openLine(line.id)}
          title="Open the evidence for this line"
        >
          <span className="caption-meta">
            {speaker && <span className="speaker">{speaker}</span>}
            <KindTags narration={narration} line={line} />
          </span>
          <span className="caption-text">
            <LineText text={line.text} verified={verified} />
            {line.claims.length > 0 &&
              (verified ? (
                <span className="caption-more check">
                  <CheckIcon />
                  <span className="sr-only">Evidence</span>
                </span>
              ) : (
                <span className="caption-more">Evidence</span>
              ))}
          </span>
        </button>
      )}
    </>
  );
}

function eventFrame(hero: Hero, id: string): number | undefined {
  return [...hero.runs.factual.events, ...hero.runs.counterfactual.events].find((e) => e.id === id)
    ?.frame;
}

/** The claims behind the open line, right under the views. */
export function EvidenceCard() {
  const { hero, playback, controls, offset } = useSession();
  const { narration } = useBreakdown();
  const lineId = useStore(playback, (s) => s.evidenceLine);
  const frame = useStore(playback, (s) => s.frame);
  const mode = useStore(playback, (s) => s.mode);
  const line = lineOf(narration, lineId);
  const isOpen = !!narration && !!line;
  // What had the focus when the card opened (the caption, a narration line): it gets it back on
  // close, by Escape or the close button, instead of dropping it on <body>.
  const opener = useRef<HTMLElement | null>(null);
  const close = () => {
    const back = opener.current;
    controls.closeEvidence();
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const closeNow = useRef(close);
  closeNow.current = close;
  useEffect(() => {
    if (!isOpen) return;
    const focused = document.activeElement;
    opener.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    // Escape closes it wherever the focus is: in the card, on its caption, or nowhere (a ?tamper=
    // link). A menu that handles its own Escape stops the event before it gets here.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNow.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);
  if (!narration || !line) return null;
  const at = (f: number) => `${((f + offset) * hero.dt).toFixed(2)} s`; // the match clock
  const elsewhere = `, ${runLabels(hero).tag.counterfactual}`;
  return (
    <section className="evidence" aria-label="Evidence for this line">
      <div className="evidence-head">
        <h2>Evidence</h2>
        {narration.fixture && (
          <span className="plan-badge fallback" data-fixture="true" title={narration.payload.note}>
            Sample data · not checked by the verifier
          </span>
        )}
        <button type="button" className="close" onClick={close} aria-label="Close evidence">
          ×
        </button>
      </div>
      <p className={hasCounterfactual(narration, line) ? "evidence-line cf" : "evidence-line"}>
        <LineText text={line.text} verified={isVerified(narration, line)} />
      </p>
      {line.claims.length === 0 ? (
        <p className="note">A connective phrase: it states no fact, so there is no evidence.</p>
      ) : (
        <ul className="claims">
          {line.claims.map((id) => {
            const c = narration.claims.get(id)!;
            const run = claimRun(c);
            const here =
              c.seek_frame != null && mode === run && Math.abs(frame - c.seek_frame) < 0.5;
            return (
              <ClaimCard
                key={id}
                claim={c}
                here={here}
                showLabel={
                  c.seek_frame != null &&
                  `Show at ${at(c.seek_frame)}${run === "counterfactual" ? elsewhere : ""}`
                }
                onShow={() => controls.openLine(line.id, c.id)}
                eventTime={(e) => {
                  const f = eventFrame(hero, e);
                  return f === undefined ? undefined : at(f);
                }}
                onEvent={(e) => controls.seekEvidence(c.id, e)}
              >
                <TamperControl claim={c} />
              </ClaimCard>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface ClaimCardProps {
  claim: PayloadClaim;
  here: boolean; // the replay is at this claim's evidence
  showLabel: string | false; // the seek button, if the claim has a seek frame
  onShow: () => void;
  eventTime: (eventId: string) => string | undefined;
  onEvent: (eventId: string) => void;
  children?: ReactNode; // under the evidence events
}

/** One claim behind a line: kind label, verdict, values and evidence events (SPEC 5.3, 7). */
export function ClaimCard({
  claim: c,
  here,
  showLabel,
  onShow,
  eventTime,
  onEvent,
  children,
}: ClaimCardProps) {
  return (
    <li className={`claim kind-${c.kind}${here ? " here" : ""}`}>
      <div className="claim-head">
        <KindTag kind={c.kind} />
        <span className="claim-verdict">{c.verdict}</span>
        <code>{c.id}</code>
        {showLabel && (
          <button type="button" className="seek" onClick={onShow}>
            {showLabel}
          </button>
        )}
      </div>
      <p className="kind-detail">{KIND_LABEL[c.kind].detail}</p>
      {Object.keys(c.values).length > 0 && (
        <dl className="values">
          {Object.entries(c.values).map(([k, v]) => (
            <div key={k}>
              <dt title={k}>{slotLabel(k)}</dt>
              <dd>{typeof v === "number" ? formatSlot(k, v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="events">
        <span>Evidence</span>
        {c.evidence.map((e) => {
          const t = eventTime(e);
          return (
            <button type="button" key={e} className="event" onClick={() => onEvent(e)}>
              {e}
              {t !== undefined && <small> · {t}</small>}
            </button>
          );
        })}
      </div>
      {children}
    </li>
  );
}

const OFFLINE_TAMPER = "Checking a changed number needs the live service";

/**
 * "Try a wrong number" (SPEC 7 producer console): change one value of the claim and the live
 * service's verifier checks the claim again against the match data (POST /api/verify). Only for
 * claims with numbers; offline it shows, disabled, why it cannot check.
 */
export function TamperControl({ claim }: { claim: PayloadClaim }) {
  const { api, controls, tamper } = useSession();
  const state = useStore(tamper, (s) => s);
  const slots = numericValues(claim);
  if (!slots.length) return null;
  const open = state.open === claim.id;
  return (
    <div className="tamper">
      <button
        type="button"
        className="tamper-toggle"
        aria-expanded={open}
        onClick={() => controls.openTamper(open ? null : claim.id)}
      >
        Try a wrong number
      </button>
      {open && (
        <>
          <p className="tamper-note">
            Change a number and the verifier checks this claim again against the match data. Nothing
            you try is saved or aired.
          </p>
          {!api && <p className="tamper-note offline">{OFFLINE_TAMPER}.</p>}
          {slots.map(([slot, value]) => (
            <TamperForm
              key={`${claim.id}.${slot}`}
              claim={claim.id}
              slot={slot}
              value={value}
              disabled={!api}
              checking={state.status === "checking"}
            />
          ))}
          {state.claim === claim.id && <TamperResult state={state} />}
        </>
      )}
    </div>
  );
}

function TamperForm({
  claim,
  slot,
  value,
  disabled,
  checking,
}: {
  claim: string;
  slot: string;
  value: number;
  disabled: boolean;
  checking: boolean;
}) {
  const { controls } = useSession();
  const [text, setText] = useState(String(wrongNumber(value)));
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(n);
  const why = disabled ? OFFLINE_TAMPER : undefined;
  return (
    <form
      className="tamper-form"
      title={why}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void controls.tryValue(claim, slot, n);
      }}
    >
      <label>
        <span title={slot}>{slotLabel(slot)}</span>
        <input
          name={slot}
          type="number"
          step="any"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button type="submit" disabled={disabled || checking || !valid}>
        Check
      </button>
      <button
        type="button"
        className="link"
        disabled={disabled || checking}
        onClick={() => {
          setText(String(value));
          void controls.tryValue(claim, slot, value);
        }}
      >
        Check the true value ({formatSlot(slot, value)})
      </button>
    </form>
  );
}

const VERDICT_HEAD: Record<VerifyResponse["status"], string> = {
  supported: "Supported — this line would air",
  refuted: "Refuted — this line would not air",
  inconclusive: "Inconclusive — this line would not air",
};

/** The verifier's answer: verdict, the line as it would read, and the verifier's own reason. */
function TamperResult({ state }: { state: TamperState }) {
  if (state.status === "checking") {
    return (
      <p className="tamper-note waiting" role="status">
        Checking {slotLabel(state.slot ?? "")} = {String(state.value)} …
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="plan-errors" role="status">
        No check: {state.error}
      </p>
    );
  }
  const r = state.result;
  if (state.status !== "done" || !r) return null;
  return <TamperVerdict r={r} />;
}

/** The verifier's answer, brought into view when it arrives: the evidence card scrolls on its own
 * and at 1440 x 900 the verdict landed below its fold. */
function TamperVerdict({ r }: { r: VerifyResponse }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: "nearest" });
  }, [r]);
  const head =
    r.status === "supported" && !r.airs
      ? "Supported, but the line would not air"
      : VERDICT_HEAD[r.status];
  const changed = r.value !== r.verified_value;
  const label = slotLabel(r.slot);
  return (
    <div className={`tamper-result ${r.airs ? "airs" : "held"}`} role="status" ref={box}>
      <p className="tamper-verdict">
        <strong>{head}</strong>
      </p>
      {r.line && <p className="tamper-line">{r.airs ? r.line : <s>{r.line}</s>}</p>}
      <p className="tamper-why">
        {!changed
          ? `${label} = ${formatSlot(r.slot, r.value)}, the verified value.`
          : r.status === "supported"
            ? `This number is true as well: the claim still holds with ${label} = ${r.value}.`
            : `You set ${label} to ${r.value}; the match data says ${formatSlot(r.slot, r.verified_value)}.`}
      </p>
      <p className="tamper-reason">
        Verifier: <code title={r.reason}>{plainReason(r.reason)}</code>
      </p>
      {r.status === "supported" && !r.airs && (
        <ul className="tamper-violations">
          {r.violations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Where the breakdown on screen came from (SPEC 2, 8). */
export function BreakdownSource() {
  const { origin } = useBreakdown();
  if (!origin) return null;
  if (origin.kind === "bundled") {
    return (
      <span className="plan-badge fallback" title="The bundled breakdown in public/data">
        Offline data
      </span>
    );
  }
  const seconds = (origin.totalMs / 1000).toFixed(1);
  return (
    <>
      <span
        className={origin.cached ? "plan-badge ok" : "plan-badge fresh"}
        title={
          origin.cached
            ? `Served from the breakdown cache (key ${origin.key})`
            : `Generated now by the agent crew in ${seconds} s, then cached`
        }
      >
        {origin.cached ? "Cached" : "Generated"}
      </span>
      <span
        className={origin.source === "model" ? "plan-badge" : "plan-badge fallback"}
        title={
          origin.source === "model"
            ? "Written by the agent crew on the Microsoft Foundry model, then verified"
            : "No model call: the crew's offline template wrote it, then the verifier checked it"
        }
      >
        {origin.source === "model" ? "Model" : "Template"}
      </span>
      {origin.rateLimited && (
        <span
          className="plan-badge fallback"
          title="Too many new breakdowns from this address: the cache or the template was served"
        >
          Rate-limited
        </span>
      )}
      {origin.capped && (
        <span
          className="plan-badge fallback"
          title="Today's model budget is used up: the cache or the template was served"
        >
          Daily cap reached
        </span>
      )}
    </>
  );
}

/** Persona and language of the breakdown, and the voice. Offline only the bundled one exists. */
export function BreakdownChoice() {
  const { api, controls } = useSession();
  const { persona, language } = useBreakdown();
  const online = api !== null;
  const why = online ? undefined : "Other audiences and languages need the live service";
  return (
    <div className="choice">
      <label title={why}>
        <span>Audience</span>
        <select
          value={persona}
          disabled={!online}
          onChange={(e) => controls.setPersona(e.target.value as (typeof PERSONAS)[number])}
        >
          {PERSONAS.map((p) => (
            <option key={p} value={p}>
              {PERSONA_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <Segmented
        label="Narration language"
        className="lang"
        title={why}
        value={language}
        onPick={controls.setLanguage}
        options={LANGUAGES.map((l) => ({
          value: l,
          label: LANG_LABEL[l],
          lang: l,
          disabled: !online,
        }))}
      />
      <SoundToggle />
    </div>
  );
}

/** Spoken narration (Azure AI Speech through the API). Off until the viewer turns it on or
 * chooses audio description. Its name stays "Sound"; `aria-pressed` carries the state. The text
 * button shows "Sound" and draws "off" / "on" from aria-pressed (live.css), so what it shows
 * is in its name (WCAG 2.5.3). */
export function SoundToggle({ icon = false }: { icon?: boolean }) {
  const { voice, controls } = useSession();
  const on = useStore(voice.state, (s) => s.on);
  const status = useStore(voice.state, (s) => s.status);
  const error = useStore(voice.state, (s) => s.error);
  const title = !voice.available
    ? "The voice needs the live service"
    : error
      ? `Speech failed: ${error}`
      : on
        ? "Turn the commentary voice off"
        : "Speak each narration line as it comes up";
  return (
    <button
      type="button"
      className={[
        "sound",
        icon ? "btn btn-icon" : "",
        status === "failed" ? "failed" : "",
        on && status === "loading" ? "loading" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Sound"
      aria-pressed={on}
      disabled={!voice.available}
      title={title}
      onClick={() => controls.setSound(!on)}
    >
      {icon ? on ? <SoundOnIcon /> : <SoundOffIcon /> : "Sound"}
    </button>
  );
}

/** Online, before and while the breakdown is asked for; or why the service gave none. */
function BreakdownNote() {
  const { controls } = useSession();
  const { status, error, persona, language } = useBreakdown();
  if (status === "waiting") {
    return (
      <p className="note waiting">
        The breakdown is asked for when the live stream detects the moment.{" "}
        <button type="button" className="link" onClick={controls.requestBreakdown}>
          Ask now
        </button>
      </p>
    );
  }
  if (status === "loading") {
    return (
      <p className="note waiting">
        Asking the agent crew for the {PERSONA_LABEL[persona].toLowerCase()} breakdown in{" "}
        {LANG_LABEL[language]}: a cached one comes back at once, a new one takes longer to generate.
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="plan-errors">
        The live service gave no breakdown ({error}). Showing the bundled one instead.
      </p>
    );
  }
  return null;
}

/** Every line of the breakdown's narration; each opens its evidence. */
export function NarrationPanel() {
  const { playback, controls } = useSession();
  const { narration, payloadErrors, status, persona } = useBreakdown();
  const caption = useStore(playback, (s) => s.captionLine);
  const open = useStore(playback, (s) => s.evidenceLine);
  return (
    <Chapter
      className="narration"
      split
      kicker="The call"
      title={
        <>
          Two voices. <em>Every line</em> a claim.
        </>
      }
      lede="A play-by-play voice and a co-commentator, written for the audience you chose. Open any line to see the claim behind it and how it was checked."
      aside={
        <>
          <BreakdownChoice />
          <div className="breakdown-head">
            {narration && (
              <span className="meta">
                {narration.payload.persona} · {narration.payload.language}
              </span>
            )}
            {narration?.fixture && (
              <span
                className="plan-badge fallback"
                data-fixture="true"
                title={narration.payload.note}
              >
                Sample
              </span>
            )}
            <BreakdownSource />
          </div>
        </>
      }
    >
      <BreakdownNote />
      {narration ? (
        <ol className={DESCRIBED.has(persona) ? "lines large" : "lines"}>
          {narration.lines.map((line) => (
            <li key={line.id} className={line.id === caption ? "now" : undefined}>
              <button
                type="button"
                aria-expanded={open === line.id}
                onClick={() => controls.openLine(line.id)}
              >
                <span className="t">{line.id}</span>
                <span>
                  <KindTags narration={narration} line={line} />
                  <LineText text={line.text} verified={isVerified(narration, line)} />
                </span>
              </button>
            </li>
          ))}
          {narration.withheld.map((line) => (
            <li key={line.id} className="withheld">
              <span className="t">{line.id}</span>
              <span>Withheld: a claim on this line is not supported.</span>
            </li>
          ))}
        </ol>
      ) : (
        (status === "ready" || status === "failed") && (
          <div className="plan-errors">
            <p>No narration: the render payload failed its checks.</p>
            <ul>
              {payloadErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )
      )}
      {narration?.fixture && <p className="note">{narration.payload.note}</p>}
    </Chapter>
  );
}
