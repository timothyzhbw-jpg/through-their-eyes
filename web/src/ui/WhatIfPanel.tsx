// The "What if…?" box (SPEC 6, 7): one suggested question per option of the hero's decision, and
// a free question for the live service. Picking a suggestion replays the moment from the decision
// with the forced run as a ghost path, and shows its precomputed verified answer (it works offline).
// A free question goes to POST /api/whatif, which maps it to an option or refuses; a verified
// answer replays the same way. Every answer line has its counterfactual label and evidence.

import { useState, type ReactNode } from "react";
import { lineKinds, type Narration, type PayloadLine } from "../narration/payload";
import { useSession } from "../session";
import { useStore } from "../store/store";
import { MAX_QUESTION, type AskState } from "../whatif/ask";
import {
  LANGUAGES,
  optionOf,
  type Language,
  type WhatIfOption,
  type WhatIfRun,
} from "../whatif/whatif";
import { LANG_LABEL } from "./labels";
import { ClaimCard, KindTags } from "./Narration";
import "./whatif.css";

export function WhatIfPanel() {
  const { whatIfs, whatIfError, playback, controls, api, ask: askStore } = useSession();
  const selected = useStore(playback, (s) => s.whatIf);
  const ask = useStore(askStore, (s) => s);
  const [lang, setLang] = useState<Language>("en");
  if (!whatIfs) {
    return whatIfError ? (
      <div className="panel whatif">
        <h2>What if…?</h2>
        <p className="note">No what-if answers: {whatIfError}</p>
      </div>
    ) : null;
  }
  const option = optionOf(whatIfs, selected);
  return (
    <div className="panel whatif">
      <div className="breakdown-head">
        <h2>What if…?</h2>
        <span className="lang" role="group" aria-label="Answer language">
          {LANGUAGES.map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </span>
      </div>
      <div className="questions">
        {whatIfs.options.map((o) => (
          <Question key={o.action} option={o} lang={lang} selected={o.action === selected} />
        ))}
      </div>
      <FreeQuestion lang={lang} online={api !== null} asking={ask.status === "asking"} />
      {ask.status !== "idle" ? (
        <FreeAnswer ask={ask} run={optionOf(whatIfs, ask.action)?.run ?? null} />
      ) : (
        option &&
        option.answers[lang] && (
          <Answer
            asked={option.question[lang]}
            narration={option.answers[lang]!}
            run={option.run}
            onClose={controls.clearWhatIf}
          />
        )
      )}
      <p className="note">
        Each answer forces that option and re-simulates the moment: the outcome is causal inside the
        sim only. Suggested answers were computed ahead of time by the same verifier as the
        narration; your own questions are answered by the live service.
      </p>
    </div>
  );
}

function FreeQuestion({
  lang,
  online,
  asking,
}: {
  lang: Language;
  online: boolean;
  asking: boolean;
}) {
  const { controls } = useSession();
  const [text, setText] = useState("");
  return (
    <form
      className="free"
      onSubmit={(e) => {
        e.preventDefault();
        void controls.askFree(text, lang);
      }}
    >
      <input
        className="free-question"
        type="text"
        maxLength={MAX_QUESTION}
        value={text}
        disabled={!online || asking}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          online
            ? "Ask your own, e.g. what if he had played it back to the centre-back?"
            : "Ask your own question: needs the live service (offline data)"
        }
        aria-label={
          online ? "Ask your own question" : "Ask your own question (needs the live service)"
        }
      />
      {online && (
        <button type="submit" className="play small" disabled={asking || !text.trim()}>
          {asking ? "Asking…" : "Ask"}
        </button>
      )}
    </form>
  );
}

/** The live service's answer to a free question: verified lines, a refusal, or the failure. */
function FreeAnswer({ ask, run }: { ask: AskState; run: WhatIfRun | null }) {
  const { controls } = useSession();
  if (ask.status === "asking") {
    return <p className="note waiting">Asking the live service: “{ask.question}”</p>;
  }
  const flags = (
    <>
      {ask.cached && <span className="plan-badge ok">Cached</span>}
      {ask.capped && (
        <span
          className="plan-badge fallback"
          title="Today's model budget is used up: the question was matched by rules"
        >
          Daily cap reached
        </span>
      )}
    </>
  );
  if (ask.status === "answered" && ask.narration) {
    return (
      <Answer
        asked={ask.question}
        narration={ask.narration}
        run={run}
        onClose={controls.clearWhatIf}
        flags={flags}
      />
    );
  }
  return (
    <div className="answer refused">
      <div className="answer-head">
        <span className="asked">{ask.question}</span>
        {flags}
        <button
          type="button"
          className="close"
          onClick={controls.clearWhatIf}
          aria-label="Clear the what-if"
        >
          ×
        </button>
      </div>
      <p>{ask.status === "refused" ? ask.refusal : `No answer: ${ask.error}`}</p>
    </div>
  );
}

function Question({
  option,
  lang,
  selected,
}: {
  option: WhatIfOption;
  lang: Language;
  selected: boolean;
}) {
  const { controls } = useSession();
  const answerable = option.factual || !!option.answers[lang];
  return (
    <button
      type="button"
      className={option.factual ? "question factual" : "question"}
      aria-pressed={selected}
      disabled={!answerable}
      title={option.errors.length ? option.errors.join("\n") : undefined}
      onClick={() => controls.askWhatIf(option.action)}
    >
      {option.question[lang]}
      {option.factual && <span className="did">{lang === "zh" ? "他的选择" : "what he did"}</span>}
    </button>
  );
}

function Answer({
  asked,
  narration,
  run,
  onClose,
  flags,
}: {
  asked: string;
  narration: Narration;
  run: WhatIfRun | null; // the forced run, for evidence times
  onClose: () => void;
  flags?: ReactNode;
}) {
  const { hero, playback, controls } = useSession();
  const frame = useStore(playback, (s) => s.frame);
  const [open, setOpen] = useState<string | null>(null);
  const at = (f: number) => `${(f * hero.dt).toFixed(2)} s`;
  const events = new Map(
    [...hero.runs.factual.events, ...(run?.events ?? [])].map((e) => [e.id, e.frame]),
  );
  const line = (l: PayloadLine) => (
    <li key={l.id} className={open === l.id ? "open" : undefined}>
      <button
        type="button"
        aria-expanded={open === l.id}
        onClick={() => {
          setOpen(open === l.id ? null : l.id);
          const first = l.claims
            .map((id) => narration.claims.get(id)!)
            .find((c) => c.seek_frame != null);
          if (first?.seek_frame != null) controls.seekWhatIf(first.seek_frame);
        }}
      >
        <KindTags narration={narration} line={l} />
        {l.text}
      </button>
      {open === l.id && (
        <ul className="claims">
          {l.claims.map((id) => {
            const c = narration.claims.get(id)!;
            return (
              <ClaimCard
                key={id}
                claim={c}
                here={c.seek_frame != null && Math.abs(frame - c.seek_frame) < 0.5}
                showLabel={c.seek_frame != null && `Show at ${at(c.seek_frame)}`}
                onShow={() => c.seek_frame != null && controls.seekWhatIf(c.seek_frame)}
                eventTime={(e) => {
                  const f = events.get(e);
                  return f === undefined ? undefined : at(f);
                }}
                onEvent={(e) => {
                  const f = events.get(e);
                  if (f !== undefined) controls.seekWhatIf(f);
                }}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
  const allCounterfactual = narration.lines.every((l) =>
    lineKinds(narration, l).includes("counterfactual"),
  );
  return (
    <div className={allCounterfactual ? "answer cf" : "answer"}>
      <div className="answer-head">
        <span className="asked">{asked}</span>
        {flags}
        <button type="button" className="close" onClick={onClose} aria-label="Clear the what-if">
          ×
        </button>
      </div>
      <ol className="answer-lines">{narration.lines.map(line)}</ol>
    </div>
  );
}
