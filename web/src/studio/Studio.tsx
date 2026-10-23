// "Publish this moment" (SPEC 7): the moment as a content package. A highlight (the breakdown
// reel's own shot list: nothing is encoded here), a tactical explainer card, social posts in en and
// zh, data cards as PNG, and a Business value panel whose figures are a seeded simulation. It reads
// the verified narration and the plan already on screen and calls no service.

import { useMemo, useState } from "react";
import { renameIds } from "../data/roster";
import { KIND_LABEL, lineKinds } from "../narration/payload";
import { useBreakdown, useSession } from "../session";
import { Chapter } from "../ui/Chapter";
import { LANG_LABEL, PERSONA_LABEL } from "../ui/labels";
import { Segmented } from "../ui/Segmented";
import {
  audienceOf,
  DEMO_LABEL,
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
} from "./cards";
import { FORMAT_LABEL, POST_FORMATS, POST_LANGUAGES, postsOf, type PostLanguage } from "./posts";
import { CAMERA_LABEL, shotList, shotListText } from "./shotlist";
import "./studio.css";

/** Where the business model is written (docs/SUBMISSION.md). */
export const BUSINESS_MODEL_URL =
  "https://github.com/timothyzhbw-jpg/through-their-eyes/blob/main/docs/SUBMISSION.md#business-model";

const textBlob = (text: string) => new Blob([text], { type: "text/plain;charset=utf-8" });

export function StudioPanel() {
  const { hero, moment, controls, possession } = useSession();
  const { narration, resolved, script, persona, language: spoken } = useBreakdown();
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
  const audience = useMemo(
    () => audienceOf({ moment: momentId, persona, language: spoken }),
    [momentId, persona, spoken],
  );

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
      {!ctx || !posts ? (
        <p className="studio-wait" role="status">
          The package is built from a verified breakdown: it appears when one is on screen.
        </p>
      ) : (
        <>
          <Segmented
            label="Package language"
            className="lang"
            value={lang}
            onPick={setLang}
            options={POST_LANGUAGES.map((l) => ({ value: l, label: LANG_LABEL[l], lang: l }))}
          />

          <section className="studio-block" aria-labelledby="studio-highlight">
            <h3 id="studio-highlight">1 · Highlight</h3>
            <p className="studio-note">
              Plays on the app&apos;s own reel. The shot list is the cut sheet; no video is encoded.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => controls.playBreakdown()}
            >
              Play highlight
            </button>
            <table className="studio-shots">
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
                {shots.map((s) => (
                  <tr key={s.n}>
                    <th scope="row">{s.n}</th>
                    <td>{s.inFrame}</td>
                    <td>{s.outFrame}</td>
                    <td>
                      {CAMERA_LABEL[s.camera]}
                      {s.player ? ` · ${renameIds(s.player)}` : ""}
                    </td>
                    <td>{s.caption ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => copy(shotListText(shots))}
            >
              Copy shot list
            </button>
          </section>

          <section className="studio-block" aria-labelledby="studio-explainer">
            <h3 id="studio-explainer">2 · Tactical explainer card</h3>
            <article className="studio-explainer">
              <p className="kicker">Verified lines only</p>
              <ol>
                {narration!.lines
                  .filter((l) => l.claims.length > 0)
                  .map((l) => (
                    <li key={l.id}>
                      <span lang={spoken}>{renameIds(l.text, spoken)}</span>
                      <span className="studio-kinds">
                        {lineKinds(narration!, l)
                          .map((k) => KIND_LABEL[k].name)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
              </ol>
            </article>
          </section>

          <section className="studio-block" aria-labelledby="studio-posts">
            <h3 id="studio-posts">3 · Social posts</h3>
            {POST_FORMATS.map((f) => (
              <div className="studio-post" key={f}>
                <div className="studio-post-head">
                  <h4>{FORMAT_LABEL[f]}</h4>
                  <button type="button" className="btn btn-quiet" onClick={() => copy(posts[f])}>
                    Copy
                  </button>
                </div>
                <pre lang={lang}>{posts[f]}</pre>
              </div>
            ))}
            <button type="button" className="btn btn-quiet" onClick={savePosts}>
              Download posts (.txt)
            </button>
          </section>

          <section className="studio-block" aria-labelledby="studio-cards">
            <h3 id="studio-cards">4 · Data cards</h3>
            <div className="studio-cards">
              {CARD_SIZES.map((size) => {
                const spec = cardSpec(ctx.narration, ctx.hero, ctx.runner, size, lang);
                return (
                  <div className="studio-card" key={size}>
                    <h4>{CARD_DIMENSIONS[size].label}</h4>
                    <p className="studio-note">
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
                    <button type="button" className="btn" onClick={() => void saveCard(size)}>
                      Download PNG
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="studio-block studio-business" aria-labelledby="studio-business">
            <h3 id="studio-business">5 · Business value</h3>
            <p className="studio-demo">{DEMO_LABEL}</p>
            <p className="studio-note">
              Seeded by this moment, {PERSONA_LABEL[persona]} and {LANG_LABEL[spoken]}: the same
              three always give the same figures.
            </p>
            <dl className="studio-metrics">
              <Metric name="Impressions" value={withCommas(audience.impressions)} />
              <Metric
                name="Engagement rate"
                value={percent(audience.engagementRate)}
                detail={`${withCommas(audience.engagements)} engagements`}
              />
              <Metric
                name={`Click-through to “Official watch”`}
                value={percent(audience.clickThrough)}
                detail={`${withCommas(audience.clicks)} clicks`}
              />
              <Metric
                name={`Sponsor impressions (${SPONSOR})`}
                value={withCommas(audience.sponsorImpressions)}
              />
              <Metric name="Sponsor recall proxy" value={percent(audience.recall)} />
            </dl>
            <details className="studio-assumptions">
              <summary>Assumptions</summary>
              <ul>
                <li>
                  Each figure is a seeded draw inside a range: impressions{" "}
                  {withCommas(RANGES.impressions.min)}–{withCommas(RANGES.impressions.max)},
                  engagement {percent(RANGES.engagementRate.min)}–
                  {percent(RANGES.engagementRate.max)}, click-through{" "}
                  {percent(RANGES.clickThrough.min)}–{percent(RANGES.clickThrough.max)}, sponsor
                  share of impressions {percent(RANGES.sponsorShare.min)}–
                  {percent(RANGES.sponsorShare.max)}, recall {percent(RANGES.recall.min)}–
                  {percent(RANGES.recall.max)}. No source backs the ranges.
                </li>
                <li>
                  Persona scales reach and engagement
                  {` (reach ×${PERSONA_FACTORS[persona].reach}, engagement ×${PERSONA_FACTORS[persona].engagement} for ${PERSONA_LABEL[persona]})`}
                  ; language scales reach (×{LANGUAGE_REACH[spoken] ?? 1} for {LANG_LABEL[spoken]}).
                </li>
                <li>
                  The recall proxy is the share of sponsor impressions that would name the sponsor;
                  no survey stands behind it. {SPONSOR} is invented.
                </li>
              </ul>
            </details>
            <p>
              <a href={BUSINESS_MODEL_URL} target="_blank" rel="noreferrer">
                Business model
              </a>{" "}
              <span className="studio-note">
                (who would pay, cost to serve and what is still needed)
              </span>
            </p>
          </section>

          <p className="studio-status" role="status">
            {note}
          </p>
        </>
      )}
    </Chapter>
  );
}

function Metric({ name, value, detail }: { name: string; value: string; detail?: string }) {
  return (
    <div className="studio-metric">
      <dt>{name}</dt>
      <dd>
        <strong>{value}</strong>
        {detail && <span>{detail}</span>}
        <small>{DEMO_LABEL}</small>
      </dd>
    </div>
  );
}
