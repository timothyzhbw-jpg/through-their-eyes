// The Producer's desk in the breakdown panel (SPEC 6, failure drill). The rows are the crew's steps
// and who answered each one: the model, its template, or code. "Take down" picks agents to fail
// for the next run, and "Bring back" re-runs a downed agent from the workflow checkpoint. The
// trace id names the run's spans in Application Insights.

import { AGENTS, type Agent } from "../api/client";
import { crewSteps, STEP_LABEL, type CrewStep } from "../producer/producer";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { recordedTime } from "./Narration";

const SOURCE = { llm: "Model", template: "Template", code: "Code" } as const;

const names = (agents: Agent[]) => agents.map((a) => STEP_LABEL[a]).join(", ");

function StepRow({ s, picked, busy }: { s: CrewStep; picked: boolean; busy: boolean }) {
  const { controls } = useSession();
  const template = s.source === "template";
  return (
    <li className={template ? "crew-step fallback" : "crew-step"}>
      <span className="crew-name">{STEP_LABEL[s.step]}</span>
      <span
        className={template ? "plan-badge fallback" : "plan-badge"}
        title={
          s.source === "llm"
            ? "Answered by the model"
            : template
              ? "Ran on its deterministic template"
              : s.source === "code"
                ? "Deterministic code"
                : "No breakdown from the crew yet"
        }
      >
        {s.source ? SOURCE[s.source] : "—"}
      </span>
      {s.errorClass && (
        <span className="crew-error" title={s.error ?? undefined}>
          {s.errorClass} · {s.attempts} {s.attempts === 1 ? "attempt" : "attempts"}
        </span>
      )}
      {s.back && (
        <span className="plan-badge ok" title="Re-run from the workflow checkpoint">
          From checkpoint
        </span>
      )}
      {s.agent &&
        (s.pending ? (
          <button
            type="button"
            className="crew-action back"
            disabled={busy}
            onClick={() => controls.bringBack(s.agent!)}
            aria-label={`Bring back the ${STEP_LABEL[s.step]}`}
            title="Re-run this step from the workflow checkpoint"
          >
            Bring back
          </button>
        ) : (
          <button
            type="button"
            className="crew-action"
            aria-pressed={picked}
            disabled={busy}
            onClick={() => controls.toggleDown(s.agent!)}
            aria-label={`Take down the ${STEP_LABEL[s.step]}`}
            title="Fail this agent's model calls in the next run, as in an outage"
          >
            Take down
          </button>
        ))}
    </li>
  );
}

export function Producer() {
  const { api, producer, controls } = useSession();
  const { origin, status } = useBreakdown();
  const { down, busy, error } = useStore(producer, (p) => p);
  if (!api) return null;
  const steps = crewSteps(origin);
  const traceId = origin?.kind === "api" ? origin.traceId : null;
  const picked = AGENTS.filter((a) => down.includes(a));
  const ready = picked.length > 0 && !busy && status !== "loading";
  return (
    <section className="producer" aria-label="Producer: failure drill">
      <h3>Producer · failure drill</h3>
      <ol className="crew">
        {steps.map((s) => (
          <StepRow key={s.step} s={s} picked={!!s.agent && down.includes(s.agent)} busy={!!busy} />
        ))}
      </ol>
      <div className="producer-foot">
        <button
          type="button"
          className="btn"
          // aria-disabled, not disabled: it stays focusable and says why it waits (SPEC 1).
          aria-disabled={!ready}
          onClick={ready ? controls.runDrill : undefined}
        >
          {busy === "drill"
            ? "Running the crew…"
            : busy
              ? `Bringing the ${STEP_LABEL[busy]} back…`
              : picked.length
                ? `Run with ${names(picked)} down`
                : "Pick agents to take down"}
        </button>
        {origin?.kind === "api" && (
          <span
            className="trace-id"
            title={
              traceId
                ? "operation_Id in Application Insights: every span of this crew run"
                : "Tracing was off for this run, or it was cached before trace ids were recorded"
            }
          >
            {traceId ? (
              <>
                trace <code>{traceId}</code>
              </>
            ) : (
              "no trace id"
            )}
          </span>
        )}
      </div>
      {error && <p className="note producer-error">{error}</p>}
      {origin?.kind === "api" && origin.drill && origin.recordedAt && (
        <p className="note producer-recorded">
          Recorded run from {recordedTime(origin.recordedAt)}: new model runs are limited for now
          (this address, or today&apos;s budget), so this is the same drill as it ran then.
        </p>
      )}
      {origin?.kind === "api" &&
        origin.drill &&
        !origin.recordedAt &&
        (origin.rateLimited || origin.capped) && (
          <p className="note producer-recorded">
            New model runs are limited for now, so this ran without the model: the steps it ran
            aired their templates.
          </p>
        )}
      <p className="note">
        A downed agent's model calls fail as in an outage: the step retries once, then airs its
        template. Bring back resumes the workflow from its checkpoint and re-runs that step; only
        the steps that read its output run again.
      </p>
    </section>
  );
}
