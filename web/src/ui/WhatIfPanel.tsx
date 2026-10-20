// The "What if…?" box (SPEC 6, 7): one suggested question per option of the hero's decision.
// Picking one replays the moment from the decision with the forced run as a ghost path, and shows
// its verified answer lines with their counterfactual labels and evidence. Free questions need the
// live service, so the text box is disabled for now.

import { useState } from "react";
import { lineKinds, type PayloadLine } from "../narration/payload";
import { useSession } from "../session";
import { useStore } from "../store/store";
import { LANGUAGES, optionOf, type Language, type WhatIfOption } from "../whatif/whatif";
import { ClaimCard, KindTags } from "./Narration";
import "./whatif.css";

const LANG_LABEL: Record<Language, string> = { en: "EN", zh: "中文" };

export function WhatIfPanel() {
  const { whatIfs, whatIfError, playback, controls } = useSession();
  const selected = useStore(playback, (s) => s.whatIf);
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
      <input
        className="free-question"
        type="text"
        disabled
        placeholder="Ask your own question: coming with the live service"
        aria-label="Ask your own question (coming with the live service)"
      />
      {option && <Answer option={option} lang={lang} onClose={controls.clearWhatIf} />}
      <p className="note">
        Each answer forces that option and re-simulates the moment: the outcome is causal inside the
        sim only. Answers were computed ahead of time by the same verifier as the narration.
      </p>
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
  option,
  lang,
  onClose,
}: {
  option: WhatIfOption;
  lang: Language;
  onClose: () => void;
}) {
  const { hero, playback, controls } = useSession();
  const frame = useStore(playback, (s) => s.frame);
  const [open, setOpen] = useState<string | null>(null);
  const narration = option.answers[lang];
  if (!narration) return null;
  const at = (f: number) => `${(f * hero.dt).toFixed(2)} s`;
  const events = new Map(
    [...hero.runs.factual.events, ...(option.run?.events ?? [])].map((e) => [e.id, e.frame]),
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
        <span className="asked">{option.question[lang]}</span>
        <button type="button" className="close" onClick={onClose} aria-label="Clear the what-if">
          ×
        </button>
      </div>
      <ol className="answer-lines">{narration.lines.map(line)}</ol>
    </div>
  );
}
