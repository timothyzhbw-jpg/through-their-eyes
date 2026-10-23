// Social copy for a moment (SPEC 7): a short post, a carousel caption and a vertical-video caption,
// in en and zh. No model writes it. Each sentence is either one of the moment's verified narration
// lines (when the breakdown on screen is in that language) or a template filled from a supported
// claim's values and the players' names, so every number in it is a claim's. A guard drops any
// sentence with a number no supported claim carries (`checked`), whatever wrote it. Hashtags are
// the two invented clubs'. The copy says it is a synthetic match.

import { CLUBS, renameIds, shortName, type NameLanguage } from "../data/roster";
import type { Narration, PayloadClaim } from "../narration/payload";

export type PostLanguage = NameLanguage;
export const POST_LANGUAGES: readonly PostLanguage[] = ["en", "zh"];
export type PostFormat = "short" | "carousel" | "vertical";
export const POST_FORMATS: readonly PostFormat[] = ["short", "carousel", "vertical"];
export const FORMAT_LABEL: Record<PostFormat, string> = {
  short: "Short post",
  carousel: "Carousel caption",
  vertical: "Vertical-video caption",
};

export interface PostContext {
  narration: Narration;
  hero: string; // player id of the moment's hero
  runner: string | null; // player id of the man he finds, when the moment has one
}

type Values = PayloadClaim["values"];

const NUMBER = /\d+(?:\.\d+)?/g;

/** Every number in `text`, as written. */
export const numbersIn = (text: string): string[] => text.match(NUMBER) ?? [];

/** The numbers a post may print: the values of the narration's supported claims. */
export function allowedNumbers(narration: Narration): Set<number> {
  const out = new Set<number>();
  for (const claim of narration.claims.values()) {
    if (claim.verdict !== "supported") continue;
    for (const v of Object.values(claim.values)) if (typeof v === "number") out.add(v);
  }
  return out;
}

/** True when every number in `text` is one of `allowed` (the same value, however it is written). */
export const checked = (text: string, allowed: ReadonlySet<number>): boolean =>
  numbersIn(text).every((n) => {
    // A value prints rounded to the decimals the text gives it, so compare at those decimals.
    const decimals = n.split(".")[1]?.length ?? 0;
    for (const v of allowed) if (Number(v.toFixed(decimals)) === Number(n)) return true;
    return false;
  });

// ----- Templates ---------------------------------------------------------------------------------

/** A claim's values and the two names a sentence may use. */
interface Slots {
  v: Values;
  hero: string;
  runner: string | null;
}

interface Fact {
  id: string; // the claim it states (explain/builders.py)
  en: (s: Slots & { n: (key: string, decimals: number) => string }) => string | null;
  zh: (s: Slots & { n: (key: string, decimals: number) => string }) => string | null;
}

const has = (v: Values, ...keys: string[]) => keys.every((k) => typeof v[k] === "number");

/** The facts a post can state, in the order it prefers them: what he saw, what it cost him to
 * miss it, then what the look was worth. Claims with no template here are not stated. */
export const FACTS: readonly Fact[] = [
  {
    id: "belief_error",
    en: ({ v, hero, runner, n }) =>
      runner && has(v, "err")
        ? `When ${hero} played the pass, his picture of ${runner} was off by ${n("err", 1)} metres.`
        : null,
    zh: ({ v, hero, runner, n }) =>
      runner && has(v, "err")
        ? `出球时，${hero}对${runner}位置的判断偏差为${n("err", 1)}米。`
        : null,
  },
  {
    id: "cf_belief_error",
    en: ({ v, runner, n }) =>
      runner && has(v, "err")
        ? `Without that look, the picture of ${runner} would have been off by ${n("err", 1)} metres.`
        : null,
    zh: ({ v, runner, n }) =>
      runner && has(v, "err")
        ? `如果没有那一眼，对${runner}位置的判断偏差会达到${n("err", 1)}米。`
        : null,
  },
  {
    id: "scans_before_reception",
    en: ({ v, hero, n }) =>
      has(v, "n", "window_s")
        ? `${hero} scanned ${n("n", 0)} ${v.n === 1 ? "time" : "times"} in the ${n("window_s", 0)} seconds before receiving.`
        : null,
    zh: ({ v, hero, n }) =>
      has(v, "n", "window_s")
        ? `接球前${n("window_s", 0)}秒内，${hero}回头观察了${n("n", 0)}次。`
        : null,
  },
  {
    id: "pass_success",
    en: ({ v, hero, runner, n }) =>
      runner && has(v, "p_belief", "p_true")
        ? `${hero} gave the pass to ${runner} a ${n("p_belief", 2)} chance; it was ${n("p_true", 2)}.`
        : null,
    zh: ({ v, hero, runner, n }) =>
      runner && has(v, "p_belief", "p_true")
        ? `${hero}判断传给${runner}的成功率是${n("p_belief", 2)}，实际是${n("p_true", 2)}。`
        : null,
  },
  {
    id: "cf_pass_success",
    en: ({ v, hero, runner, n }) =>
      runner && has(v, "p_belief", "p_true")
        ? `Without that look, ${hero} would have given the pass to ${runner} a ${n("p_belief", 2)} chance; it was ${n("p_true", 2)}.`
        : null,
    zh: ({ v, hero, runner, n }) =>
      runner && has(v, "p_belief", "p_true")
        ? `如果没有那一眼，${hero}会以为传给${runner}的成功率是${n("p_belief", 2)}，实际是${n("p_true", 2)}。`
        : null,
  },
  {
    id: "cf_value",
    en: ({ v, n }) =>
      has(v, "dxt") ? `That look was worth ${n("dxt", 2)} in expected threat.` : null,
    zh: ({ v, n }) => (has(v, "dxt") ? `那一眼价值${n("dxt", 2)}的预期威胁。` : null),
  },
  {
    id: "gap_to_nearest_opponent",
    en: ({ v, runner, n }) =>
      runner && has(v, "gap")
        ? `${runner} was ${n("gap", 1)} metres from the nearest opponent when the pass was played.`
        : null,
    zh: ({ v, runner, n }) =>
      runner && has(v, "gap") ? `出球时，${runner}离最近的对手有${n("gap", 1)}米。` : null,
  },
  {
    id: "gap_opened",
    en: ({ v, runner, n }) =>
      runner && has(v, "gain")
        ? `While the ball travelled, ${runner} opened up ${n("gain", 1)} metres on his marker.`
        : null,
    zh: ({ v, runner, n }) =>
      runner && has(v, "gain")
        ? `球在途中，${runner}把与盯防者的距离拉开了${n("gain", 1)}米。`
        : null,
  },
  {
    id: "time_since_last_scan",
    en: ({ v, hero, n }) =>
      has(v, "secs")
        ? `${hero} had last checked his shoulder ${n("secs", 1)} seconds before the ball arrived.`
        : null,
    zh: ({ v, hero, n }) =>
      has(v, "secs") ? `球到脚下时，${hero}距上次回头观察已过去${n("secs", 1)}秒。` : null,
  },
  {
    id: "observed_share",
    en: ({ v, hero, n }) =>
      has(v, "window_s", "share")
        ? `In the ${n("window_s", 0)} seconds before receiving, ${hero} saw ${n("share", 0)}% of the space the opponents controlled.`
        : null,
    zh: ({ v, hero, n }) =>
      has(v, "window_s", "share")
        ? `接球前${n("window_s", 0)}秒内，${hero}看到了对手控制区域的${n("share", 0)}%。`
        : null,
  },
  {
    id: "pass_speed",
    en: ({ v, hero, n }) =>
      has(v, "kmh") ? `${hero}'s pass left his foot at ${n("kmh", 1)} km/h.` : null,
    zh: ({ v, hero, n }) =>
      has(v, "kmh") ? `${hero}这脚传球的出球时速为${n("kmh", 1)}公里。` : null,
  },
];

const COPY: Record<
  PostLanguage,
  {
    hook: (hero: string) => string;
    versus: (home: string, away: string) => string;
    synthetic: string;
    swipe: string;
    watch: string;
    tags: string[];
  }
> = {
  en: {
    hook: (hero) => `Through ${hero}'s eyes.`,
    versus: (home, away) => `${home} v ${away}, a synthetic match.`,
    synthetic: "Synthetic match: re-simulated, not real footage.",
    swipe: "Swipe for what he saw:",
    watch: "Official watch: link in bio.",
    tags: ["#ThroughTheirEyes"],
  },
  zh: {
    hook: (hero) => `透过${hero}的眼睛。`,
    versus: (home, away) => `${home}对${away}，一场合成比赛。`,
    synthetic: "合成比赛：重新模拟，并非真实画面。",
    swipe: "左滑看他看到了什么：",
    watch: "官方观看入口：见简介链接。",
    tags: ["#他的视角"],
  },
};

/** The index of the club a player belongs to (the hero's club is named first). */
export const clubOf = (id: string): 0 | 1 => (id.startsWith("A") ? 1 : 0);

/** The club names as hashtags: "Kestrel Bay" -> #KestrelBay; in Chinese, #红隼湾. */
export function hashtags(lang: PostLanguage): string[] {
  const clubs = ([0, 1] as const).map((t) =>
    lang === "zh" ? `#${CLUBS[t].zh}` : `#${CLUBS[t].name.replace(/\s+/g, "")}`,
  );
  return [...COPY[lang].tags, ...clubs];
}

/**
 * The sentences a post may state in `lang`, best first: the verified narration lines when the
 * breakdown is in `lang` (the question that opens a script excluded: it states nothing), else
 * templates over the supported claims. Sentences with a number no claim carries are dropped.
 */
export function facts(ctx: PostContext, lang: PostLanguage): string[] {
  const { narration } = ctx;
  const allowed = allowedNumbers(narration);
  if (narration.payload.language === lang) {
    return narration.lines
      .filter((l) => l.claims.length > 0)
      .map((l) => renameIds(l.text, lang))
      .filter((t) => checked(t, allowed));
  }
  const supported = new Map(
    [...narration.claims.values()].filter((c) => c.verdict === "supported").map((c) => [c.id, c]),
  );
  const hero = shortName(ctx.hero, lang);
  const runner = ctx.runner ? shortName(ctx.runner, lang) : null;
  const out: string[] = [];
  for (const fact of FACTS) {
    const claim = supported.get(fact.id);
    if (!claim) continue;
    const n = (key: string, decimals: number) => Number(claim.values[key]).toFixed(decimals);
    const text = fact[lang]({ v: claim.values, hero, runner, n });
    if (text && checked(text, allowed)) out.push(text);
  }
  return out;
}

export type Posts = Record<PostFormat, string>;

const SHORT_FACTS = 1;
const CAROUSEL_FACTS = 4;
const VERTICAL_FACTS = 2;

/** The three posts for one language. */
export function postsOf(ctx: PostContext, lang: PostLanguage): Posts {
  const copy = COPY[lang];
  const hero = shortName(ctx.hero, lang);
  const sentences = facts(ctx, lang);
  const club = (t: 0 | 1) => (lang === "zh" ? CLUBS[t].zh : CLUBS[t].name);
  const heroClub = clubOf(ctx.hero);
  const versus = copy.versus(club(heroClub), club(heroClub === 0 ? 1 : 0));
  const tags = hashtags(lang).join(" ");
  const joiner = lang === "zh" ? "" : " ";
  return {
    short: [
      [copy.hook(hero), ...sentences.slice(0, SHORT_FACTS)].join(joiner),
      copy.synthetic,
      tags,
    ].join("\n"),
    carousel: [
      `${copy.hook(hero)}${joiner}${versus}`,
      copy.swipe,
      ...sentences.slice(0, CAROUSEL_FACTS).map((s) => `• ${s}`),
      copy.watch,
      copy.synthetic,
      tags,
    ].join("\n"),
    vertical: [
      [copy.hook(hero), ...sentences.slice(0, VERTICAL_FACTS)].join(joiner),
      copy.watch,
      tags,
    ].join("\n"),
  };
}
