// The end-of-match recap in the page (SPEC 6, 7): the chapter below the match with the verified
// card, the caption and the reel's overlays over the live screen, and the button that asks for it
// from the Moments panel. Every sentence and number here is a verified line or a verified value.
// "Crew trace" opens the timeline of the crew run that wrote the recap (SPEC 6).

import { useState } from "react";
import { PERSONAS, type Persona } from "../api/client";
import { CrewTracePanel, TraceButton } from "../crewtrace/CrewTrace";
import { ProvenanceChip } from "../provenance/ProvenanceChip";
import type { MatchSession } from "../match/matchSession";
import { useView } from "../session";
import { useStore } from "../store/store";
import { Chapter } from "../ui/Chapter";
import { SoundOffIcon, SoundOnIcon } from "../ui/icons";
import { LANG_LABEL, PERSONA_LABEL } from "../ui/labels";
import { momentLabel } from "../ui/Live";
import { Segmented } from "../ui/Segmented";
import { LANGUAGES } from "../whatif/whatif";
import type { Cue } from "./recap";
import "./recap.css";

const NOTHING = "Nothing verified to say about it.";

const LANGUAGE_OPTIONS = LANGUAGES.map((language) => ({
  value: language,
  label: LANG_LABEL[language],
}));

export function RecapPanel() {
  const session = useView();
  if (session.kind !== "match") return null;
  return <Panel session={session} />;
}

function Panel({ session }: { session: MatchSession }) {
  const { recap, hero } = session;
  const state = useStore(recap.state, (s) => s);
  const script = recap.script();
  const card = script?.card ?? null;
  const response = state.response;
  const scoreLine = card?.lines.find((line) => line.id === "S") ?? null;
  const final = card?.claims.find((claim) => claim.id === "final_score");
  const home = final?.values.home;
  const away = final?.values.away;
  const stats = card?.lines.filter((line) => line.id.startsWith("T")) ?? [];
  const [tracing, setTracing] = useState(false);
  const moments = response?.result.moments ?? [];

  return (
    <div id="recap">
      <Chapter
        className="recap"
        kicker="Full time · the recap"
        title={
          <>
            The match, <em>in moments.</em>
          </>
        }
        lede="At the final whistle: the key moments by how much they changed the match, every sentence and number checked in code before it airs. The chip says who wrote it: the agent crew now, a cached crew run, or the offline template."
      >
        {state.status === "idle" && (
          <button type="button" className="btn btn-primary" onClick={() => void recap.request()}>
            Write the match recap
          </button>
        )}

        {state.status === "loading" && <p className="note">The crew is writing the recap…</p>}

        {state.status === "failed" && (
          <>
            <p className="note error">{state.error}</p>
            <div className="recap-actions">
              <button type="button" className="btn" onClick={() => void recap.request()}>
                Try again
              </button>
            </div>
          </>
        )}

        {state.status === "ready" && response && (
          <>
            <div className="recap-choices">
              {/* Five audiences do not fit a segmented control on a phone: a menu. */}
              <label className="recap-audience">
                <span className="kicker">Commentary for</span>
                <select
                  value={state.persona}
                  onChange={(e) => void recap.request({ persona: e.target.value as Persona })}
                >
                  {PERSONAS.map((p) => (
                    <option key={p} value={p}>
                      {PERSONA_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <Segmented
                label="Language"
                options={LANGUAGE_OPTIONS}
                value={state.language}
                onPick={(language) => void recap.request({ language })}
              />
            </div>

            <div
              className="recap-score"
              aria-label={`Home ${String(home ?? "")}, away ${String(away ?? "")}`}
            >
              <span className="team home">Home</span>
              <b>{home ?? ""}</b>
              <span className="dash">–</span>
              <b>{away ?? ""}</b>
              <span className="team away">Away</span>
              {scoreLine && <p className="recap-score-line">{scoreLine.text}</p>}
            </div>

            <ol className="recap-moments">
              {moments.map((moment) => {
                const lineId = script?.card_moments[moment.id];
                const line = lineId
                  ? (card?.lines.find((candidate) => candidate.id === lineId) ?? null)
                  : null;
                const matchMoment = session.match.moments.find((m) => m.id === moment.id);
                return (
                  <li key={moment.id}>
                    <span className="t">{(moment.anchor_frame * hero.dt).toFixed(2)} s</span>
                    <span className="what">
                      {momentLabel(moment)}
                      <small> · {moment.lens ? `${moment.lens} lens` : "no lens"}</small>
                    </span>
                    <p>{line ? line.text : NOTHING}</p>
                    <div className="recap-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          window.scrollTo({ top: 0 }); // the replay plays at the top
                          recap.watch(moment.id);
                        }}
                        title="Watch this moment"
                      >
                        Watch
                      </button>
                      {moment.hero && matchMoment && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => session.controls.openBreakdown(matchMoment)}
                        >
                          Breakdown
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {stats.length > 0 && (
              <ul className="recap-stats">
                {stats.map((line) => (
                  <li key={line.id}>{line.text}</li>
                ))}
              </ul>
            )}

            <div className="recap-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (state.reel) {
                    recap.stopReel();
                    return;
                  }
                  window.scrollTo({ top: 0 });
                  recap.playReel();
                }}
              >
                {state.reel ? "Stop the reel" : "Play the recap reel"}
              </button>
              <RecapSound session={session} />
              {recap.cuesUrl() && (
                <a className="btn" href={recap.cuesUrl()!} target="_blank" rel="noreferrer">
                  Overlay cues (JSON)
                </a>
              )}
              <TraceButton open={tracing} onClick={() => setTracing((open) => !open)} />
              <p className="written">
                <ProvenanceChip provenance={response.provenance} /> Every number checked in code
              </p>
            </div>
            {tracing && (
              <CrewTracePanel
                kind="recaps"
                traceKey={response.key}
                provenance={response.provenance}
              />
            )}
          </>
        )}
      </Chapter>
    </div>
  );
}

export function RecapCaption() {
  const session = useView();
  if (session.kind !== "match") return null;
  return <Caption session={session} />;
}

/** A moment's title from its cue's data, like a row of the Moments panel: what and who, and
 * its lens. The verified sentence is the caption under it. */
function titleOf(cue: Cue): string {
  const { kind, actor, receiver, lens } = cue.data;
  const label = momentLabel({
    kind: String(kind ?? ""),
    actor: actor == null ? null : String(actor),
    receiver: receiver == null ? null : String(receiver),
  });
  return lens ? `${label} · ${String(lens)} lens` : label;
}

/** The reel's lower third: the moment's title over the caption of the line being spoken. */
function Caption({ session }: { session: MatchSession }) {
  const { recap } = session;
  const reel = useStore(recap.state, (s) => s.reel);
  if (!reel) return null;
  const line = reel.caption
    ? recap.script()?.payload.lines.find((candidate) => candidate.id === reel.caption)
    : null;
  return (
    <div className="recap-lower">
      {reel.title && <p className="recap-title">{titleOf(reel.title)}</p>}
      <p className="recap-caption" aria-live="polite">
        {line?.text ?? ""}
      </p>
    </div>
  );
}

export function RecapStage() {
  const session = useView();
  if (session.kind !== "match") return null;
  return <Stage session={session} />;
}

function Stage({ session }: { session: MatchSession }) {
  const { recap } = session;
  const state = useStore(recap.state, (s) => s);
  const scoreLine = recap.script()?.card.lines.find((line) => line.id === "S") ?? null;
  const reel = state.reel;

  if (reel) {
    return (
      <>
        {reel.intro && (
          // The result is the caption already: the card says what follows.
          <section className="recap-card intro" aria-label="Full time">
            <p className="kicker">Full time · the recap</p>
            <p className="recap-score-line">The moments that changed the match, in order.</p>
          </section>
        )}
        {reel.stats.length > 0 && (
          <section className="recap-card stats" aria-label="Match stats">
            <ul>{reel.stats.map((cue) => cue.text && <li key={cue.id}>{cue.text}</li>)}</ul>
          </section>
        )}
        <div className="recap-actions">
          <button type="button" className="btn recap-stop" onClick={recap.stopReel}>
            Stop
          </button>
          <RecapSound session={session} />
        </div>
      </>
    );
  }

  if (!state.fullTime || (state.status !== "ready" && state.status !== "loading")) return null;

  return (
    <section className="recap-card full-time" aria-label="Full time">
      <p className="kicker">Full time</p>
      {scoreLine && <p className="recap-score-line">{scoreLine.text}</p>}
      {state.status === "loading" ? (
        <p className="note">The crew is writing the recap…</p>
      ) : (
        <div className="recap-actions">
          <button type="button" className="btn btn-primary" onClick={recap.playReel}>
            Play the recap reel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => document.getElementById("recap")?.scrollIntoView({ behavior: "smooth" })}
          >
            Read the recap
          </button>
        </div>
      )}
    </section>
  );
}

/** The reel's voices: off until the viewer turns them on (audio description: on by itself). */
function RecapSound({ session }: { session: MatchSession }) {
  const { voice } = session.recap;
  const on = useStore(voice.state, (s) => s.on);
  const error = useStore(voice.state, (s) => s.error);
  const title = !voice.available
    ? "The voice needs the live service"
    : error
      ? `Speech failed: ${error}`
      : on
        ? "Turn the commentary voice off"
        : "Speak each line of the reel as it comes up";
  return (
    <button
      type="button"
      className="btn recap-sound"
      aria-label="Sound"
      aria-pressed={on}
      disabled={!voice.available}
      title={title}
      onClick={() => session.recap.setSound(!on)}
    >
      {on ? <SoundOnIcon /> : <SoundOffIcon />}
      {on ? "Sound on" : "Sound off"}
    </button>
  );
}
