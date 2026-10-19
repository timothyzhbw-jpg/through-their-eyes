// The breakdown player's console: which plan is loaded (and why, if it fell back to the template),
// play / stop, and the cue list with the step being executed.

import { useEffect, useRef } from "react";
import type { PlanStep, Script } from "../plan/schema";
import { useSession } from "../session";
import { useStore } from "../store/store";

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
  const { runner, resolved, script, controls } = useSession();
  const status = useStore(runner.status, (s) => s.status);
  const t = useStore(runner.status, (s) => s.t);
  const applied = useStore(runner.status, (s) => s.applied);
  const { plan, source, errors } = resolved;
  const running = status === "running";
  const list = useRef<HTMLOListElement>(null);

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
    <div className="panel breakdown">
      <div className="breakdown-head">
        <h2>Breakdown</h2>
        <span className={source === "given" ? "plan-badge ok" : "plan-badge fallback"}>
          {source === "given" ? "Plan validated" : "Template plan (fallback)"}
        </span>
        <button
          type="button"
          className="play small"
          onClick={running ? controls.stopBreakdown : controls.playBreakdown}
        >
          {running ? "Stop" : status === "idle" ? "Play breakdown" : "Replay breakdown"}
        </button>
      </div>
      {errors.length > 0 && (
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
      <div className="progress" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (100 * t) / plan.duration_s)}%` }} />
      </div>
      <ol className="steps" ref={list}>
        {plan.steps.map((step, k) => (
          <li
            key={k}
            className={
              running && k === applied - 1 ? "now" : k < applied && status !== "idle" ? "done" : ""
            }
          >
            <span className="t">{step.t.toFixed(1)}</span>
            <span>{describeStep(step, script)}</span>
          </li>
        ))}
      </ol>
      <p className="note">
        A TelestrationPlan is the cue list the Telestrator agent will write. Every plan is validated
        before it plays; an invalid one is replaced by a template plan built from the moment.
      </p>
    </div>
  );
}
