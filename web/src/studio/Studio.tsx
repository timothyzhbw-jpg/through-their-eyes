// "Publish this moment" (SPEC 7): the moment as a content package. A highlight (the breakdown
// reel's own shot list: nothing is encoded here), a tactical explainer card, social posts in en and
// zh, data cards as PNG, and a Business value panel whose figures are a seeded simulation. It reads
// the verified narration and the plan already on screen and calls no service. For studios
// (journey/) shows the package as its Automated Highlights and the business panel as its Value's
// demo KPIs.

import { useMemo, useState } from "react";
import { renameIds } from "../data/roster";
import { DemoBadge } from "../journey/DemoBadge";
import { BreakdownWait } from "../journey/gate";
import { KIND_LABEL, lineKinds } from "../narration/payload";
import { useBreakdown, useSession } from "../session";
import { Chapter } from "../ui/Chapter";
import { LANG_LABEL, PERSONA_LABEL } from "../ui/labels";
import { useReveal } from "../ui/reveal";
import { Segmented } from "../ui/Segmented";
import {
  audienceOf,
  LANGUAGE_REACH,
  PERSONA_FACTORS,
  percent,
  RANGES,
  SPONSOR,
  withCommas,
} from "./audience";
import {
  CARD_DIMENSIONS,
  CARD_SIZES,
  cardBlob,
  cardFileName,
  cardSpec,
  downloadBlob,
  momentSlug,
  type CardSize,
  type CardSpec,
} from "./cards";
import {
  FORMAT_LABEL,
  POST_FORMATS,
  POST_LANGUAGES,
  postsOf,
  type PostFormat,
  type PostLanguage,
} from "./posts";
import { CAMERA_LABEL, shotList, shotListText } from "./shotlist";
import "./studio.css";

/** Where the business model is written (docs/SUBMISSION.md). */
export const BUSINESS_MODEL_URL =
  "https://github.com/timothyzhbw-jpg/through-their-eyes/blob/main/docs/SUBMISSION.md#business-model";

const textBlob = (text: string) => new Blob([text], { type: "text/plain;charset=utf-8" });

/** The whole package as one chapter: the content, then its business value. */
export function StudioPanel() {
  return (
    <Chapter
      className="studio"
      kicker="Publish this moment"
      title={
        <>
          One moment, <em>every channel</em>.
        </>
      }
      lede="A highlight, an explainer, posts and data cards, all from the lines the checker passed. No model is called."
    >
      <StudioPackage />
      <BusinessValue numbered />
    </Chapter>
  );
}

/** The package without its business panel: the language, the highlight, the explainer, the posts
 * and the data cards. `postsNote`: a line under the posts' heading saying what they are for. */
export function StudioPackage({ postsNote }: { postsNote?: string } = {}) {
  const explainer = useReveal<HTMLElement>();
  const { hero, moment, controls, possession } = useSession();
  const { narration, resolved, script, language: spoken } = useBreakdown();
  const [lang, setLang] = useState<PostLanguage>(spoken);
  const [note, setNote] = useState<string | null>(null);

  const ctx = useMemo(
    () =>
      narration && hero.heroId ? { narration, hero: hero.heroId, runner: hero.runnerId } : null,
    [narration, hero.heroId, hero.runnerId],
  );
  const shots = useMemo(
    () => shotList(resolved.plan, moment, script),
    [resolved.plan, moment, script],
  );
  const posts = useMemo(() => (ctx ? postsOf(ctx, lang) : null), [ctx, lang]);
  const momentId = possession?.moment ?? moment.id;

  const copy = (text: string) => {
    const done = () => setNote("Copied.");
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => setNote(null));
    else setNote("Select the text to copy it.");
  };
  const saveCard = async (size: CardSize) => {
    if (!ctx) return;
    try {
      const blob = await cardBlob(cardSpec(ctx.narration, ctx.hero, ctx.runner, size, lang));
      downloadBlob(blob, cardFileName(momentId, size, lang));
      setNote(`Saved the ${CARD_DIMENSIONS[size].label} card.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  };
  const savePosts = () => {
    if (!posts) return;
    const text = POST_FORMATS.map((f) => `# ${FORMAT_LABEL[f]}\n${posts[f]}`).join("\n\n");
    downloadBlob(textBlob(text), `${momentSlug(momentId)}-posts-${lang}.txt`);
  };

  if (!ctx || !posts) {
    return (
      <BreakdownWait
        what="package"
        offline="The package is built from a verified breakdown: it appears when one is on screen."
      />
    );
  }
  // One mapping feeds the desktop table and the phone cards, so they cannot drift apart.
  const rows = shots.map((s) => ({
    n: s.n,
    inFrame: s.inFrame,
    outFrame: s.outFrame,
    camera: `${CAMERA_LABEL[s.camera]}${s.player ? ` · ${renameIds(s.player)}` : ""}`,
    caption: s.caption ?? "—",
  }));
  return (
    <>
      <Segmented
        label="Package language"
        className="lang"
        value={lang}
        onPick={setLang}
        options={POST_LANGUAGES.map((l) => ({ value: l, label: LANG_LABEL[l], lang: l }))}
      />

      <section className="studio-block" aria-labelledby="studio-highlight">
        <h3 id="studio-highlight" className="block-title">
          1 · Highlight
        </h3>
        <p className="note">
          Plays on the app&apos;s own reel. The shot list is the cut sheet; no video is encoded.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => controls.playBreakdown()}>
          Play highlight
        </button>
        <details className="how studio-shot-list">
          <summary>Shot list</summary>
          <div className="stats-table-wrap" role="region" tabIndex={0} aria-label="Shot list">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Shot</th>
                  <th scope="col">In</th>
                  <th scope="col">Out</th>
                  <th scope="col">Camera</th>
                  <th scope="col">Caption</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n}>
                    <th scope="row">{r.n}</th>
                    <td>{r.inFrame}</td>
                    <td>{r.outFrame}</td>
                    <td>{r.camera}</td>
                    <td className="prose">{r.caption}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ol className="studio-shot-cards" aria-label="Shot list">
            {rows.map((r) => (
              <li key={r.n}>
                <h4>Shot {r.n}</h4>
                <dl>
                  <div>
                    <dt>Camera</dt>
                    <dd>{r.camera}</dd>
                  </div>
                  <div>
                    <dt>In</dt>
                    <dd>{r.inFrame}</dd>
                  </div>
                  <div>
                    <dt>Out</dt>
                    <dd>{r.outFrame}</dd>
                  </div>
                </dl>
                <p className="prose">{r.caption}</p>
              </li>
            ))}
          </ol>
        </details>
        <button type="button" className="btn btn-quiet" onClick={() => copy(shotListText(shots))}>
          Copy shot list
        </button>
      </section>

      <section className="studio-block" aria-labelledby="studio-explainer">
        <h3 id="studio-explainer" className="block-title">
          2 · Tactical explainer card
        </h3>
        <article className="studio-explainer tile" ref={explainer}>
          <p className="kicker">Verified lines only</p>
          <ol>
            {ctx.narration.lines
              .filter((l) => l.claims.length > 0)
              .map((l) => (
                <li key={l.id}>
                  <span lang={spoken}>{renameIds(l.text, spoken)}</span>
                  <span className="studio-kinds">
                    {lineKinds(ctx.narration, l)
                      .map((k) => KIND_LABEL[k].name)
                      .join(" · ")}
                  </span>
                </li>
              ))}
          </ol>
        </article>
      </section>

      <section className="studio-block" aria-labelledby="studio-posts">
        <h3 id="studio-posts" className="block-title">
          3 · Social posts
        </h3>
        {postsNote && <p className="note">{postsNote}</p>}
        {POST_FORMATS.map((format, index) => (
          <SocialPost
            key={format}
            format={format}
            text={posts[format]}
            lang={lang}
            index={index}
            onCopy={copy}
          />
        ))}
        <button type="button" className="btn btn-quiet" onClick={savePosts}>
          Download posts (.txt)
        </button>
      </section>

      <section className="studio-block" aria-labelledby="studio-cards">
        <h3 id="studio-cards" className="block-title">
          4 · Data cards
        </h3>
        <div className="tile-grid">
          {CARD_SIZES.map((size, index) => (
            <DataCard
              key={size}
              size={size}
              spec={cardSpec(ctx.narration, ctx.hero, ctx.runner, size, lang)}
              index={index}
              onSave={saveCard}
            />
          ))}
        </div>
      </section>

      <p className="studio-status" role="status">
        {note}
      </p>
    </>
  );
}

function SocialPost({
  format,
  text,
  lang,
  index,
  onCopy,
}: {
  format: PostFormat;
  text: string;
  lang: PostLanguage;
  index: number;
  onCopy: (text: string) => void;
}) {
  const card = useReveal<HTMLDivElement>(index);
  return (
    <div className="studio-post" ref={card}>
      <div className="studio-post-head">
        <h4>{FORMAT_LABEL[format]}</h4>
        <button type="button" className="btn btn-quiet" onClick={() => onCopy(text)}>
          Copy
        </button>
      </div>
      <pre className="tile" lang={lang}>
        {text}
      </pre>
    </div>
  );
}

function DataCard({
  size,
  spec,
  index,
  onSave,
}: {
  size: CardSize;
  spec: CardSpec;
  index: number;
  onSave: (size: CardSize) => Promise<void>;
}) {
  const card = useReveal<HTMLDivElement>(index);
  return (
    <div className="studio-card tile" ref={card}>
      <h4>{CARD_DIMENSIONS[size].label}</h4>
      <p className="note">
        {spec.width} × {spec.height} px
      </p>
      <ul>
        {spec.stats.map((s) => (
          <li key={s.label}>
            <strong>{s.value}</strong> {s.label}
          </li>
        ))}
        {spec.empty && <li>{spec.empty}</li>}
      </ul>
      <button type="button" className="btn" onClick={() => void onSave(size)}>
        Download PNG
      </button>
    </div>
  );
}

/** The business panel: the seeded audience's figures, each labelled demo data, and their
 * assumptions. Only with a verified breakdown on screen, like the package it would measure.
 * `numbered`: headed as the package's fifth part; `heading`: its heading otherwise. */
export function BusinessValue({
  numbered = false,
  heading = "Business value",
}: {
  numbered?: boolean;
  heading?: string;
}) {
  const { hero, moment, possession } = useSession();
  const { narration, persona, language: spoken } = useBreakdown();
  const momentId = possession?.moment ?? moment.id;
  const audience = useMemo(
    () => audienceOf({ moment: momentId, persona, language: spoken }),
    [momentId, persona, spoken],
  );
  if (!narration || !hero.heroId) {
    return numbered ? null : (
      <BreakdownWait
        what="business panel"
        offline="The business panel measures the package: it appears with a verified breakdown."
      />
    );
  }
  return (
    <section className="studio-block studio-business" aria-labelledby="studio-business">
      <h3 id="studio-business" className="block-title">
        {numbered ? "5 · Business value" : heading}
      </h3>
      <DemoBadge />
      <dl className="tile-grid studio-metrics">
        <Metric index={0} name="Impressions" value={withCommas(audience.impressions)} />
        <Metric
          index={1}
          name="Engagement rate"
          value={percent(audience.engagementRate)}
          detail={`${withCommas(audience.engagements)} engagements`}
        />
        <Metric
          index={2}
          name={`Click-through to “Official watch”`}
          value={percent(audience.clickThrough)}
          detail={`${withCommas(audience.clicks)} clicks`}
        />
        <Metric
          index={3}
          name={`Sponsor impressions (${SPONSOR})`}
          value={withCommas(audience.sponsorImpressions)}
        />
        <Metric index={4} name="Sponsor recall proxy" value={percent(audience.recall)} />
      </dl>
      <details className="how studio-assumptions">
        <summary>Assumptions</summary>
        <p className="note">
          Seeded by this moment, {PERSONA_LABEL[persona]} and {LANG_LABEL[spoken]}: the same three
          always give the same figures.
        </p>
        <ul>
          <li>
            Each figure is a seeded draw inside a range: impressions{" "}
            {withCommas(RANGES.impressions.min)}–{withCommas(RANGES.impressions.max)}, engagement{" "}
            {percent(RANGES.engagementRate.min)}–{percent(RANGES.engagementRate.max)}, click-through{" "}
            {percent(RANGES.clickThrough.min)}–{percent(RANGES.clickThrough.max)}, sponsor share of
            impressions {percent(RANGES.sponsorShare.min)}–{percent(RANGES.sponsorShare.max)},
            recall {percent(RANGES.recall.min)}–{percent(RANGES.recall.max)}. No source backs the
            ranges.
          </li>
          <li>
            Persona scales reach and engagement
            {` (reach ×${PERSONA_FACTORS[persona].reach}, engagement ×${PERSONA_FACTORS[persona].engagement} for ${PERSONA_LABEL[persona]})`}
            ; language scales reach (×{LANGUAGE_REACH[spoken] ?? 1} for {LANG_LABEL[spoken]}).
          </li>
          <li>
            The recall proxy is the share of sponsor impressions that would name the sponsor; no
            survey stands behind it. {SPONSOR} is invented.
          </li>
        </ul>
      </details>
      <p className="note">
        <a href={BUSINESS_MODEL_URL} target="_blank" rel="noreferrer">
          Business model
        </a>{" "}
        (who would pay, cost to serve and what is still needed)
      </p>
    </section>
  );
}

function Metric({
  name,
  value,
  detail,
  index,
}: {
  name: string;
  value: string;
  detail?: string;
  index: number;
}) {
  const card = useReveal<HTMLDivElement>(index);
  return (
    <div className="studio-metric tile" ref={card}>
      <dt>{name}</dt>
      <dd>
        <strong>{value}</strong>
        {detail && <span>{detail}</span>}
        <DemoBadge compact />
      </dd>
    </div>
  );
}
