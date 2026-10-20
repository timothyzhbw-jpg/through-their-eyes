// Verified narration in the main view (SPEC 5.3, 7): the caption over the first-person view, the
// evidence card under the views, and the list of every line. Any line can be opened: it shows
// each claim with its kind label, verdict, values and evidence events, and seeks the replay to
// the evidence. Counterfactual claims always carry their label: they are causal only in the sim.
// With the live service the panel also picks the persona and language (SPEC 1), says where the
// breakdown came from (cached or generated, model or template, rate limit and daily cap) and
// turns the voice on.

import { PERSONAS } from "../api/client";
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
import { LANGUAGES } from "../whatif/whatif";
import { LANG_LABEL, PERSONA_LABEL } from "./labels";
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

/** The current voice line over the first-person view. Click to open its evidence. */
export function Caption() {
  const { playback, controls } = useSession();
  const { narration } = useBreakdown();
  const lineId = useStore(playback, (s) => s.captionLine);
  const open = useStore(playback, (s) => s.evidenceLine);
  const line = lineOf(narration, lineId);
  if (!narration || !line) return null;
  return (
    <button
      type="button"
      className={hasCounterfactual(narration, line) ? "caption cf" : "caption"}
      aria-expanded={open === line.id}
      onClick={() => controls.openLine(line.id)}
      title="Open the evidence for this line"
    >
      <KindTags narration={narration} line={line} />
      <span className="caption-text">{line.text}</span>
      {line.claims.length > 0 && <span className="caption-more">Evidence ›</span>}
    </button>
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
  if (!narration || !line) return null;
  const at = (f: number) => `${((f + offset) * hero.dt).toFixed(2)} s`; // the match clock
  const elsewhere = `, ${runLabels(hero).tag.counterfactual}`;
  return (
    <section className="evidence" aria-label="Evidence for this line">
      <div className="evidence-head">
        <h2>Evidence</h2>
        {narration.fixture && (
          <span className="plan-badge fallback" title={narration.payload.note}>
            Fixture · not checked by the verifier
          </span>
        )}
        <button
          type="button"
          className="close"
          onClick={controls.closeEvidence}
          aria-label="Close evidence"
        >
          ×
        </button>
      </div>
      <p className={hasCounterfactual(narration, line) ? "evidence-line cf" : "evidence-line"}>
        {line.text}
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
              />
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
}

/** One claim behind a line: kind label, verdict, values and evidence events (SPEC 5.3, 7). */
export function ClaimCard({
  claim: c,
  here,
  showLabel,
  onShow,
  eventTime,
  onEvent,
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
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
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
    </li>
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
      <span className="lang" role="group" aria-label="Narration language" title={why}>
        {LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={language === l}
            disabled={!online}
            onClick={() => controls.setLanguage(l)}
          >
            {LANG_LABEL[l]}
          </button>
        ))}
      </span>
      <SoundToggle />
    </div>
  );
}

/** Spoken narration (Azure AI Speech through the API). Off until the viewer turns it on. */
export function SoundToggle() {
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
      className={status === "failed" ? "sound failed" : "sound"}
      aria-pressed={on}
      disabled={!voice.available}
      title={title}
      onClick={() => controls.setSound(!on)}
    >
      {on ? "Sound on" : "Sound off"}
      {on && status === "loading" && " …"}
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
        {LANG_LABEL[language]}: a cached one comes back at once, a new one takes about 10 s.
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
  const { narration, payloadErrors, status } = useBreakdown();
  const caption = useStore(playback, (s) => s.captionLine);
  const open = useStore(playback, (s) => s.evidenceLine);
  return (
    <div className="panel narration">
      <div className="breakdown-head">
        <h2>Narration</h2>
        {narration && (
          <span className="meta">
            {narration.payload.persona} · {narration.payload.language}
          </span>
        )}
        {narration?.fixture && (
          <span className="plan-badge fallback" title={narration.payload.note}>
            Fixture
          </span>
        )}
        <BreakdownSource />
      </div>
      <BreakdownChoice />
      <BreakdownNote />
      {narration ? (
        <ol className="lines">
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
                  {line.text}
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
    </div>
  );
}
