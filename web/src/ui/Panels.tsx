// Story beats with the verdict, and the decision the hero made on his belief.
// Numbers here are read straight from the sim export; narration with verified claims replaces
// the beat texts once explain/ and agents/ land (SPEC 5.3).

import { actionLabel, type Hero, type Run } from "../data/hero";
import { useSession } from "../session";
import { useStore } from "../store/store";

interface Beat {
  from: number; // frame
  text: string;
}

function beats(hero: Hero, run: Run): Beat[] {
  const factual = run.name === "factual";
  const runner = hero.runnerId ?? "the runner";
  const dec = run.decision;
  const act = run.action;
  const key = hero.keyScan;
  const err = dec && hero.runnerId ? dec.belief_error[hero.runnerId] : 0;
  const age = dec && hero.runnerId ? dec.belief_age[hero.runnerId] : 0;
  const chosen = dec ? actionLabel(dec.chosen) : "";
  const p = dec ? (dec.options.find((o) => o.action === dec.chosen)?.prob ?? 0) : 0;
  const passer = run.firstPass?.player ?? "The centre-back";
  const outcome = !act
    ? ""
    : act.outcome === "complete"
      ? `Completed to ${act.receiver}.`
      : `Lost: ${act.outcome} by ${act.receiver || "nobody"}.`;
  const s = (f: number) => (f * hero.dt).toFixed(2);
  return [
    {
      from: 0,
      text: `${passer} has the ball at the back. ${hero.heroId} drops in to receive with his back to goal.`,
    },
    {
      from: run.firstPass?.frame ?? 0,
      text: `The pass is on its way. ${runner} starts a run behind ${hero.heroId}, outside his field of view.`,
    },
    factual
      ? {
          from: key.start,
          text: `${hero.heroId} checks over his shoulder: a ${s(key.end - key.start)} s look away from the ball.`,
        }
      : {
          from: key.start,
          text: `Same moment, but ${hero.heroId} keeps his eyes on the ball. No look over the shoulder.`,
        },
    factual
      ? {
          from: key.end,
          text: `He has seen ${runner} running in behind. His picture of ${runner} is ${err.toFixed(1)} m off.`,
        }
      : {
          from: key.end,
          text: `He still pictures ${runner} where he last saw him, ${age.toFixed(1)} s ago: ${err.toFixed(1)} m from where he really is.`,
        },
    {
      from: dec ? dec.frame : run.frames - 1,
      text: `Decision: ${chosen.charAt(0).toLowerCase() + chosen.slice(1)} (chosen with probability ${p.toFixed(2)}).`,
    },
    { from: act?.end ?? run.frames - 1, text: outcome },
  ];
}

export function StoryPanel() {
  const { hero, playback, controls } = useSession();
  const mode = useStore(playback, (s) => s.mode);
  const frame = useStore(playback, (s) => s.frame);
  const run = hero.runs[mode];
  const list = beats(hero, run);
  let now = 0;
  list.forEach((b, k) => {
    if (frame + 1e-6 >= b.from) now = k;
  });
  const f = hero.runs.factual.decision?.chosen ?? "";
  const c = hero.runs.counterfactual.decision?.chosen ?? "";
  return (
    <div className="panel">
      <h2>What happened</h2>
      <ol className="beats">
        {list.map((b, k) => (
          <li key={k} className={k === now ? "now" : undefined}>
            <button type="button" onClick={() => controls.seek(b.from)}>
              <span className="t">{(b.from * hero.dt).toFixed(2)} s</span>
              <span>{b.text}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="verdict">
        <div>
          With the look: <b>{actionLabel(f)}</b>
        </div>
        <div>
          Without: <b>{actionLabel(c)}</b>
        </div>
        <div>
          Expected threat gained by looking:{" "}
          <b className="num">
            {hero.deltaXt >= 0 ? "+" : ""}
            {hero.deltaXt.toFixed(3)} xT
          </b>
        </div>
      </div>
    </div>
  );
}

export function DecisionPanel() {
  const { hero, playback } = useSession();
  const mode = useStore(playback, (s) => s.mode);
  const run = hero.runs[mode];
  const dec = run.decision;
  if (!dec) return null;
  const runner = hero.runnerId;
  const runnerOption = runner ? dec.options.find((o) => o.action === `pass:${runner}`) : undefined;
  return (
    <div className="panel">
      <h2>
        {hero.heroId}'s options at {(dec.frame * hero.dt).toFixed(2)} s, on his belief
      </h2>
      <div className="options">
        {dec.options.slice(0, 6).map((o) => (
          <div
            key={o.action}
            className={o.action === dec.chosen ? "opt chosen" : "opt"}
            title={`P(success) ${o.p_success.toFixed(2)} · value ${o.value.toFixed(4)} xT`}
          >
            <span className="name">{actionLabel(o.action)}</span>
            <span className="bar">
              <i style={{ width: `${Math.max(1, o.prob * 100)}%` }} />
            </span>
            <span className="p">{o.prob.toFixed(2)}</span>
          </div>
        ))}
      </div>
      {runner && (
        <div className="facts">
          <Fact
            label={`Belief error on ${runner}`}
            value={`${dec.belief_error[runner].toFixed(1)} m`}
          />
          <Fact label={`Last saw ${runner}`} value={`${dec.belief_age[runner].toFixed(2)} s ago`} />
          <Fact
            label={`P(pass to ${runner} arrives), as he sees it`}
            value={runnerOption ? runnerOption.p_success.toFixed(2) : "not on"}
          />
        </div>
      )}
      <p className="note">
        Options are scored on what he believes, never on the truth. Probabilities come from the
        softmax of each option's expected threat.
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
