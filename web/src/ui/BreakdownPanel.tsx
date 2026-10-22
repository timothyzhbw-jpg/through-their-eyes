// The breakdown player's console: which plan is loaded (and why, if it fell back to the template),
// play / stop, and the cue list with the step being executed. With the live service the plan is
// the Telestrator agent's, with the narration's voice cues added as voice steps, and the Producer's
// failure drill sits below it. "Crew trace" (here and on the Producer desk) opens the timeline of
// the crew run behind the breakdown on screen.

import { useEffect, useRef, useState } from "react";
import { CrewTracePanel, TraceButton } from "../crewtrace/CrewTrace";
import type { PlanStep, Script } from "../plan/schema";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { Chapter } from "./Chapter";
import { Producer } from "./Producer";

const rel = (s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(2)} s`;

export function describeStep(step: PlanStep, script: Script = {}): string {
  switch (step.do) {
    case "freeze":
      return "Freeze";
    case "rewind":
      return `Rewind to ${rel(step.to)}`;
    case "play":
      return `Play to ${rel(step.to)} at ${step.speed}×`;
    case "camera":
      return `Camera: ${step.mode}`;
    case "pov":
      return `POV ${step.player}, ${rel(step.from)} → ${rel(step.to)} at ${step.speed}×`;
    case "scan_marker":
      return `Mark ${step.scan}`;
    case "zone":
      return `Zone: ${step.layer} of ${step.player}`;
    case "ghost":
      return step.kind === "belief" ? "Ghosts: belief" : `Ghost: counterfactual ${step.cf}`;
    case "voice":
      return script[step.line] ? `${step.line}: “${script[step.line]}”` : `Voice ${step.line}`;
  }
}

export function BreakdownPanel() {
  const { runner, controls } = useSession();
  const { resolved, script, origin, status: arrival } = useBreakdown();
  const status = useStore(runner.status, (s) => s.status);
  const t = useStore(runner.status, (s) => s.t);
  const applied = useStore(runner.status, (s) => s.applied);
  const { plan, source, errors } = resolved;
  const running = status === "running";
  const ready = arrival === "ready" || arrival === "failed";
  const list = useRef<HTMLOListElement>(null);
  const [tracing, setTracing] = useState(false);
  const api = ready && origin?.kind === "api" ? origin : null;
  const toggleTrace = () => setTracing((open) => !open);

  // Keep the step being executed in view inside the (scrollable) cue list.
  useEffect(() => {
    const ol = list.current;
    const now = ol?.querySelector<HTMLElement>("li.now");
    if (!ol || !now) return;
    if (
      now.offsetTop < ol.scrollTop ||
      now.offsetTop + now.offsetHeight > ol.scrollTop + ol.clientHeight
    ) {
      ol.scrollTop = now.offsetTop - ol.clientHeight / 2;
    }
  }, [applied]);
  return (
    <Chapter
      className="breakdown"
      split
      kicker="Behind the replay"
      title={
        <>
          The crew writes. <em>Code</em> checks.
        </>
      }
      lede="A TelestrationPlan is the cue list the Telestrator agent writes. Every plan is validated before it plays; an invalid one is replaced by a template plan built from the moment."
      aside={
        <div className="breakdown-head">
          {ready && (
            <span className={source === "given" ? "plan-badge ok" : "plan-badge fallback"}>
              {source === "given" ? "Plan validated" : "Template plan (fallback)"}
            </span>
          )}
          {ready && origin?.kind === "api" && (
            <span
              className={origin.planSource === "agent" ? "plan-badge" : "plan-badge fallback"}
              title={
                origin.planSource === "agent"
                  ? "Written by the Telestrator agent"
                  : origin.planErrors.length
                    ? "The Telestrator's plan failed the server's checks: the server sent its template"
                    : "The Telestrator gave no plan: the server sent its template"
              }
            >
              {origin.planSource === "agent" ? "Telestrator agent" : "Server template"}
            </span>
          )}
          {api && <TraceButton open={tracing} onClick={toggleTrace} />}
          <button
            type="button"
            className="btn"
            disabled={!running && arrival === "loading"}
            onClick={running ? controls.stopBreakdown : controls.playBreakdown}
          >
            {running
              ? "Stop"
              : arrival === "waiting"
                ? "Get breakdown"
                : arrival === "loading"
                  ? "Loading…"
                  : status === "idle"
                    ? "Play breakdown"
                    : "Replay breakdown"}
          </button>
        </div>
      }
    >
      {ready && origin?.kind === "api" && origin.planErrors.length > 0 && (
        <details className="plan-errors">
          <summary>The Telestrator's plan failed the server's checks</summary>
          <ul>
            {origin.planErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {ready && errors.length > 0 && (
        <details className="plan-errors">
          <summary>
            The given plan failed validation ({errors.length}{" "}
            {errors.length === 1 ? "problem" : "problems"})
          </summary>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {!ready && (
        <p className="note waiting">
          {arrival === "waiting"
            ? "Waiting for the live stream to detect the moment. Get breakdown asks for it now."
            : "Asking the agent crew for the breakdown…"}
        </p>
      )}
      <div className="progress" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (100 * t) / plan.duration_s)}%` }} />
      </div>
      {ready && (
        // A scrolling box with no control inside: focusable, so the keyboard can scroll it.
        <ol className="steps" ref={list} tabIndex={0} aria-label="Telestration steps">
          {plan.steps.map((step, k) => (
            <li
              key={k}
              className={
                running && k === applied - 1
                  ? "now"
                  : k < applied && status !== "idle"
                    ? "done"
                    : ""
              }
            >
              <span className="t">{step.t.toFixed(1)}</span>
              <span>{describeStep(step, script)}</span>
            </li>
          ))}
        </ol>
      )}
      <Producer trace={api ? { open: tracing, toggle: toggleTrace } : null} />
      {api && tracing && (
        <CrewTracePanel
          kind="breakdowns"
          traceKey={api.key}
          provenance={api.provenance}
          version={`${api.traceId ?? ""}:${api.totalMs}:${api.drill?.pending.join(",") ?? ""}`}
        />
      )}
    </Chapter>
  );
}
