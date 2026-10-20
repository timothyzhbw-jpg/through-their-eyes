// Verified narration in the main view (SPEC 5.3, 7): the caption over the first-person view, the
// evidence card under the views, and the list of every line. Any line can be opened: it shows
// each claim with its kind label, verdict, values and evidence events, and seeks the replay to
// the evidence. Counterfactual claims always carry their label: they are causal only in the sim.

import type { Hero } from "../data/hero";
import {
  claimRun,
  KIND_LABEL,
  lineKinds,
  lineOf,
  type ClaimKind,
  type Narration,
  type PayloadLine,
} from "../narration/payload";
import { useSession } from "../session";
import { useStore } from "../store/store";

export function KindTag({ kind }: { kind: ClaimKind }) {
  return (
    <span className={`kind kind-${kind}`} title={KIND_LABEL[kind].detail}>
      {KIND_LABEL[kind].name}
      {kind === "counterfactual" && " · inside the sim"}
    </span>
  );
}

function KindTags({ narration, line }: { narration: Narration; line: PayloadLine }) {
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
  const { narration, playback, controls } = useSession();
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
  const { hero, narration, playback, controls } = useSession();
  const lineId = useStore(playback, (s) => s.evidenceLine);
  const frame = useStore(playback, (s) => s.frame);
  const mode = useStore(playback, (s) => s.mode);
  const line = lineOf(narration, lineId);
  if (!narration || !line) return null;
  const at = (f: number) => `${(f * hero.dt).toFixed(2)} s`;
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
              <li key={id} className={`claim kind-${c.kind}${here ? " here" : ""}`}>
                <div className="claim-head">
                  <KindTag kind={c.kind} />
                  <span className="claim-verdict">{c.verdict}</span>
                  <code>{c.id}</code>
                  {c.seek_frame != null && (
                    <button
                      type="button"
                      className="seek"
                      onClick={() => controls.openLine(line.id, c.id)}
                    >
                      Show at {at(c.seek_frame)}
                      {run === "counterfactual" ? ", without the look" : ""}
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
                    const f = eventFrame(hero, e);
                    return (
                      <button
                        type="button"
                        key={e}
                        className="event"
                        onClick={() => controls.seekEvidence(c.id, e)}
                      >
                        {e}
                        {f !== undefined && <small> · {at(f)}</small>}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Every line of the breakdown's narration; each opens its evidence. */
export function NarrationPanel() {
  const { narration, payloadErrors, playback, controls } = useSession();
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
      </div>
      {!narration ? (
        <div className="plan-errors">
          <p>No narration: the render payload failed its checks.</p>
          <ul>
            {payloadErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
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
      )}
      {narration?.fixture && <p className="note">{narration.payload.note}</p>}
    </div>
  );
}
