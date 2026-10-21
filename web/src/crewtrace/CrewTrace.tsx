// The Crew trace (SPEC 6): one real run of the agent crew as a timeline, opened from the Producer
// desk, from a breakdown, or from the end-of-match recap. Each run (the first one, then each
// bring-back) has a lane per step in the graph's order; a bar is a step, filled by who answered it
// (the model, its template, or code), and the run's events mark the failure drill: an agent taken
// down, its fallback, its request to be brought back, the checkpoints and the bring-back. Picking a
// step shows its typed input and output, the shared state it read and wrote, its model calls, the
// Analyst's MCP tool calls and the Verifier's rejections and rewrites.
//
// Drawn in both the hero and the match views, so it reads the session with `useView()`. Every time
// on it is telemetry (the server's wall clock), labelled as such; no number on it is a claim.

import { useEffect, useState } from "react";
import { useView } from "../session";
import "./crewtrace.css";
import {
  errorClass,
  firstStep,
  LANE_LABEL,
  loadTrace,
  ms,
  NOT_RECORDED,
  runTitle,
  SOURCE_LABEL,
  stepTitle,
  timeline,
  type CrewTrace,
  type Payload,
  type TraceEvent,
  type TraceKind,
  type TraceState,
  type TraceStep,
} from "./trace";

const EVENT_LABEL: Record<TraceEvent["kind"], string> = {
  down: "Taken down",
  fallback: "Fallback",
  waiting: "Waiting",
  checkpoint: "Checkpoint",
  back: "Brought back",
  resumed: "Resumed",
};

const TELEMETRY = "Telemetry: the server's wall clock, not a claim.";

/** Opens or closes the crew trace of the breakdown or recap on screen. */
export function TraceButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn trace-open"
      aria-expanded={open}
      onClick={onClick}
      title="The timeline of the crew run behind it: every step, handoff and tool call"
    >
      Crew trace
    </button>
  );
}

/** Load and show the crew trace of one breakdown or recap. `version` changes when the run on
 * screen does (a bring-back keeps the key but extends the trace). */
export function CrewTracePanel({
  kind,
  traceKey,
  version = "",
}: {
  kind: TraceKind;
  traceKey: string;
  version?: string;
}) {
  const { api } = useView();
  const [state, setState] = useState<TraceState>({ status: "loading" });
  useEffect(() => {
    if (!api) return;
    let live = true;
    setState({ status: "loading" });
    void loadTrace(api, kind, traceKey).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [api, kind, traceKey, version]);
  if (!api) return null;
  return <CrewTraceView state={state} />;
}

export function CrewTraceView({ state }: { state: TraceState }) {
  return (
    <section className="crew-trace" aria-label="Crew trace">
      <h3>Crew trace</h3>
      {state.status === "loading" && <p className="note">Reading the crew's trace…</p>}
      {state.status === "missing" && (
        <p className="note trace-missing">
          {NOT_RECORDED[0].toUpperCase() + NOT_RECORDED.slice(1)}: it was cached before the crew
          recorded its timeline. A new run, or any failure drill, records one.
        </p>
      )}
      {state.status === "failed" && <p className="note producer-error">{state.error}</p>}
      {state.status === "ready" && <Timeline trace={state.trace} />}
    </section>
  );
}

function Timeline({ trace }: { trace: CrewTrace }) {
  const runs = timeline(trace);
  const [picked, pick] = useState<string | null>(() => firstStep(trace)?.id ?? null);
  const step = trace.steps.find((s) => s.id === picked) ?? null;
  const run = step ? trace.runs.find((r) => r.index === step.run) : undefined;
  return (
    <>
      <p className="note">
        One real run of the crew, as the workflow recorded it: no model was called to show it.{" "}
        {TELEMETRY}
      </p>
      <ul className="trace-legend" aria-label="Who answered each step">
        <li>
          <i className="trace-swatch llm" aria-hidden="true" /> Model
        </li>
        <li>
          <i className="trace-swatch template" aria-hidden="true" /> Template
        </li>
        <li>
          <i className="trace-swatch code" aria-hidden="true" /> Code
        </li>
      </ul>
      {runs.map(({ run, span, lanes, marks, events }) => (
        <div className="trace-run" key={run.index} data-run={run.index}>
          <header className="trace-run-head">
            <b>{runTitle(run)}</b>
            <span>
              {run.total_ms == null ? "did not finish" : ms(run.total_ms)} ·{" "}
              {run.model === "offline" ? "offline templates" : run.model}
              {run.down.length > 0 &&
                ` · down: ${run.down.map((d) => LANE_LABEL[d] ?? d).join(", ")}`}
            </span>
            {run.trace_id && (
              <span className="trace-id" title="operation_Id in Application Insights">
                trace <code>{run.trace_id}</code>
              </span>
            )}
          </header>
          <div className="trace-grid" role="group" aria-label={`${runTitle(run)}: steps over time`}>
            {marks.length > 0 && (
              <div className="trace-lane trace-marks">
                <span className="trace-lane-name">Events</span>
                <div className="trace-track">
                  {marks.map(({ event, left }, k) => (
                    <i
                      key={k}
                      className={`trace-mark ${event.kind}`}
                      style={{ left: `${left}%` }}
                      title={`${EVENT_LABEL[event.kind]} · ${ms(event.t_ms)}: ${event.detail}`}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
            )}
            {lanes.map(({ lane, bars }) => (
              <div className="trace-lane" key={lane} data-lane={lane}>
                <span className="trace-lane-name">{LANE_LABEL[lane] ?? lane}</span>
                <div className="trace-track">
                  {bars.map(({ step: s, left, width }) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`trace-bar ${s.source}${s.error ? " failed" : ""}${s.resumed ? " resumed" : ""}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      aria-pressed={s.id === picked}
                      aria-label={`${stepTitle(s)}: ${SOURCE_LABEL[s.source]}, ${ms(s.end_ms - s.start_ms)}`}
                      title={`${stepTitle(s)} · ${SOURCE_LABEL[s.source]} · ${ms(s.end_ms - s.start_ms)}`}
                      onClick={() => pick(s.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="trace-lane trace-axis" aria-hidden="true">
              <span className="trace-lane-name" />
              <div className="trace-track">
                <span style={{ left: 0 }}>0</span>
                <span style={{ right: 0 }}>{ms(span)}</span>
              </div>
            </div>
          </div>
          {events.length > 0 && (
            <ol className="trace-events" aria-label={`${runTitle(run)}: events`}>
              {events.map((e, k) => (
                <li key={k} className={`trace-event ${e.kind}`}>
                  <span className="t">{ms(e.t_ms)}</span>
                  <span className={`trace-kind ${e.kind}`}>{EVENT_LABEL[e.kind]}</span>
                  <span>
                    {e.step && <b>{LANE_LABEL[e.step] ?? e.step}</b>} {e.detail}
                    {e.kind === "checkpoint" && e.keys.length > 0 && (
                      <small className="trace-keys">
                        {" "}
                        holds{" "}
                        {e.keys.filter((x) => !x.startsWith("executor.")).join(", ") ||
                          "executor states only"}
                      </small>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
      {step && (
        <StepCard step={step} traceId={run?.trace_id ?? null} runName={run ? runTitle(run) : ""} />
      )}
    </>
  );
}

function StepCard({
  step,
  traceId,
  runName,
}: {
  step: TraceStep;
  traceId: string | null;
  runName: string;
}) {
  const kind = errorClass(step.error);
  return (
    <article className="trace-step" aria-label={`Step: ${stepTitle(step)}`} data-step={step.id}>
      <header>
        <h4>{stepTitle(step)}</h4>
        <span className={step.source === "template" ? "plan-badge fallback" : "plan-badge"}>
          {SOURCE_LABEL[step.source]}
        </span>
        {step.resumed && <span className="plan-badge ok">From checkpoint</span>}
        {kind && (
          <span className="crew-error" title={step.error ?? undefined}>
            {kind} · {step.attempts} {step.attempts === 1 ? "attempt" : "attempts"}
          </span>
        )}
      </header>
      <p className="trace-when" title={TELEMETRY}>
        {runName} · starts at {ms(step.start_ms)}, ends at {ms(step.end_ms)} ·{" "}
        <b>{ms(step.end_ms - step.start_ms)}</b> <small>(telemetry)</small>
      </p>
      <dl className="trace-io">
        <dt>In</dt>
        <dd>
          {step.input ? (
            <PayloadView p={step.input} />
          ) : (
            <span className="none">before the crew starts</span>
          )}
        </dd>
        <dt>Out</dt>
        <dd>
          {step.output.length ? (
            step.output.map((p, k) => <PayloadView key={k} p={p} />)
          ) : (
            <span className="none">nothing sent</span>
          )}
        </dd>
        <dt>Read</dt>
        <dd className="trace-keys">
          {step.reads.length ? (
            step.reads.map((k) => <code key={k}>{k}</code>)
          ) : (
            <span className="none">no shared state</span>
          )}
        </dd>
        <dt>Wrote</dt>
        <dd className="trace-keys">
          {step.writes.length ? (
            step.writes.map((k) => <code key={k}>{k}</code>)
          ) : (
            <span className="none">no shared state</span>
          )}
        </dd>
      </dl>
      {step.calls.length > 0 && (
        <div className="trace-block">
          <h5>Model calls</h5>
          <ul className="trace-calls">
            {step.calls.map((c, k) => (
              <li key={k}>
                <code>{c.role}</code>
                {c.persona && (
                  <span>
                    {c.persona}/{c.language}
                  </span>
                )}
                <span className={c.source === "template" ? "plan-badge fallback" : "plan-badge"}>
                  {SOURCE_LABEL[c.source]}
                </span>
                <span>
                  {c.attempts} {c.attempts === 1 ? "attempt" : "attempts"} · {ms(c.ms)}
                </span>
                {c.error && <span className="crew-error">{errorClass(c.error)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.tools.length > 0 && (
        <div className="trace-block">
          <h5>MCP tool calls</h5>
          <ol className="trace-tools">
            {step.tools.map((t, k) => (
              <li key={k}>
                <code className="call">
                  {t.name}({Object.keys(t.arguments).length ? JSON.stringify(t.arguments) : ""})
                </code>
                <small> arguments written by the model</small>
                {t.error && <span className="crew-error"> {t.error}</span>}
                {t.result != null && (
                  <details>
                    <summary>
                      Result from our MCP server{t.truncated ? " (cut short)" : ""}: raw tool
                      output, not a claim
                    </summary>
                    <pre>{t.result}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {step.rejected.length > 0 && (
        <div className="trace-block">
          <h5>Sent back by the Verifier</h5>
          <ul className="trace-lines">
            {step.rejected.map((r, k) => (
              <li key={k}>
                <code>
                  {r.persona}/{r.language} {r.line} · {r.speaker}
                </code>
                <q>{r.text}</q>
                <span className="crew-error">{r.problems.join("; ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.rewritten.length > 0 && (
        <div className="trace-block">
          <h5>Rewritten by the voice that wrote it</h5>
          <ul className="trace-lines">
            {step.rewritten.map((r, k) => (
              <li key={k}>
                <code>
                  {r.persona}/{r.language} {r.line} · {r.speaker}
                </code>
                <span>
                  <q className="before">{r.before}</q> →{" "}
                  {r.after ? <q>{r.after}</q> : <i>no new line: unchanged</i>}
                </span>
                <small>
                  claims {r.claims_before.join(", ") || "none"} →{" "}
                  {r.claims_after.join(", ") || "none"}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.notes.length > 0 && (
        <ul className="trace-notes">
          {step.notes.map((n, k) => (
            <li key={k}>{n}</li>
          ))}
        </ul>
      )}
      {(step.span_id || traceId) && (
        <p className="trace-id" title="Application Insights: operation_Id is the run's trace id">
          {traceId && (
            <>
              operation_Id <code>{traceId}</code>
            </>
          )}
          {step.span_id && (
            <>
              {" "}
              · span <code>{step.span_id}</code>
            </>
          )}
        </p>
      )}
    </article>
  );
}

function PayloadView({ p }: { p: Payload }) {
  return (
    <div className="trace-payload">
      <code className="type">{p.type}</code> <span>{p.summary}</span>
      {p.data != null ? (
        <details>
          <summary>JSON</summary>
          <pre>{JSON.stringify(p.data, null, 1)}</pre>
        </details>
      ) : (
        p.truncated && <small> (too long to keep)</small>
      )}
    </div>
  );
}
