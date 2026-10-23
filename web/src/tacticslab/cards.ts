// The Tactics lab's cards (SPEC 4.8, 7): why a common tactic works, told with this match's own
// synthetic data. Each card names what it measures, prints the definition of every number and its
// source, and ties them to the hero moment that shows the tactic at work. The numbers are computed
// here from the events and tracking of the session on screen (a hero moment or the stitched
// match), so a card says what its scope is: "this moment" or "this match".

import type { Hero } from "../data/hero";
import {
  FULL_MATCH,
  MOMENT_LINKS,
  hrefOf,
  type MomentLink,
  type MomentLinkId,
} from "../moments/moments";
import type { SourceKind } from "../provenance/source";
import { clock, fixed, signed } from "../tactics/tactics";
import { shortName } from "../data/roster";
import { OPEN_P, laneCounts, lanesAt } from "./lanes";
import { CARD_SCENARIO, NO_SCOPE, type Scope } from "./scope";
import {
  FPS,
  HALF_LENGTH,
  PITCH_L,
  PRESS_ZONE_FROM,
  PRESS_ZONE_SHARE,
  REGAIN_WINDOW_S,
  THIRD_START,
  XG_CAP,
  XG_D0,
  XG_PEAK,
  XG_SCALE,
  pressMetrics,
  progression,
  regains,
  shotQuality,
  type Team,
  type XtGrid,
} from "./metrics";

export type CardId = "high_press" | "decisions" | "corners" | "shot_quality" | "progression";

export const CARD_IDS: readonly CardId[] = [
  "high_press",
  "decisions",
  "corners",
  "shot_quality",
  "progression",
];

export interface Metric {
  label: string;
  /** One value per team (home, away) or a single one. */
  values: string[];
  definition: string;
  source: SourceKind;
  /** What the source chip's tooltip adds, when the kind's own words are not enough. */
  sourceNote?: string;
  /** One line on why the value is zero or empty in the data, shown when it is. */
  zeroWhy?: string;
}

export interface Watch {
  label: string;
  frame: number; // on the clock of the session on screen
}

export interface LabCard {
  id: CardId;
  kicker: string;
  title: string;
  /** The tactic in a sentence, and why it works, in plain words. */
  idea: string;
  scope: "this moment" | "this match";
  /** What the numbers were measured on, in words: the moment that shows the tactic, or the match. */
  measured: string;
  metrics: Metric[];
  /** What the sim cannot say here, said honestly. */
  limits: string;
  moment: MomentLink;
  /** True when the session on screen is the card's own hero moment. */
  here: boolean;
  /** Where the metrics are told in the moment's own view, if the viewer is on it. */
  watch: Watch | null;
  /** Nothing to show in this session: why, and what to open instead. */
  empty: string | null;
}

export const TEAMS = ["Home", "Away"] as const;
const TEAM_IDS: readonly Team[] = [0, 1];

const link = (id: MomentLinkId): MomentLink => MOMENT_LINKS.find((m) => m.id === id)!;

/** The card's hero moment. */
export const CARD_MOMENT: Record<CardId, MomentLinkId> = {
  high_press: "pressure",
  decisions: "pressure",
  corners: "corner",
  shot_quality: "goal",
  progression: "look",
};

/**
 * The With / Without comparison of a card's moment: the moment opened on its run without the look
 * and at the decision, for the heroes that stand alone; for the ones told inside the match the
 * moment's own run toggle does it (a link into a match does not carry the run).
 */
export function compareHref(id: CardId): string {
  const m = link(CARD_MOMENT[id]);
  const alone = !m.query.includes("moment=");
  return hrefOf(alone ? { query: `${m.query}&run=counterfactual&at=decision` } : m);
}

export const momentHref = (id: CardId): string => hrefOf(link(CARD_MOMENT[id]));

const each = (f: (team: Team) => string): string[] => TEAM_IDS.map(f);
const dash = "–";
const ppdaText = (v: number | null) => (v === null ? dash : v.toFixed(1));

const TRACKING = (what: string) => `${what}, computed in the browser from this match's event feed`;
const MODELLED = "The sim's own models, read from the export";

function high_press(hero: Hero, view: Context): LabCard {
  const events = hero.runs.factual.events;
  const [home, away] = TEAM_IDS.map((t) => pressMetrics(events, t));
  const first = regains(events)
    .filter((r) => r.high)
    .sort((a, b) => a.frame - b.frame)[0];
  return {
    id: "high_press",
    kicker: "Pressing · win it where the goal is close",
    title: "High press",
    idea:
      "Press high and together, and the ball is won near the opponent's goal: one regain there " +
      "leaves the defence behind the play, so the next pass has far less to beat.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics: [
      {
        label: "Regains",
        zeroWhy:
          "No ball was won here: the sim's open play changes hands on interceptions only and has " +
          "no open-play tackles (docs/NUMBERS.md M4).",
        values: each((t) => String(t ? away.regains : home.regains)),
        definition:
          "The ball won from the opponent: an interception, or a tackle (the sim has tackles in " +
          "the pressure moment only). Each is a change of possession.",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "High regains",
        zeroWhy: "No ball was won in the winner's attacking third in this view.",
        values: each((t) => String(t ? away.highRegains : home.highRegains)),
        definition: `A regain in the winner's attacking third: beyond ${THIRD_START.toFixed(1)} m from the centre spot toward the goal it attacks (the last ${(HALF_LENGTH - THIRD_START).toFixed(0)} m of ${PITCH_L}).`,
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "PPDA, interceptions and tackles",
        zeroWhy: "No interception or tackle in the pressing zone, so PPDA has no value to give.",
        values: each((t) => ppdaText(t ? away.ppda : home.ppda)),
        definition:
          "Opponent passes per defensive action. Passes the opponent kicks in its own " +
          `${Math.round(PRESS_ZONE_SHARE * 100)}% of the pitch (beyond ${PRESS_ZONE_FROM} m in the pressing team's frame), divided by the ` +
          "pressing team's interceptions and tackles in that zone. Lower means a harder press. " +
          "The usual PPDA also counts challenges and fouls, which the sim does not have; a dash " +
          "means no defensive action in the zone.",
        source: "tracking",
        sourceNote: TRACKING("Computed"),
      },
      {
        label: `Shots within ${REGAIN_WINDOW_S} s of a high regain · xG`,
        zeroWhy: "There was no high regain to follow, so no shot followed one.",
        values: each((t) => {
          const m = t ? away : home;
          return `${m.shotsAfterHighRegain} · ${fixed(m.xgAfterHighRegain)}`;
        }),
        definition:
          `Shots by the side that won the ball, kicked within ${REGAIN_WINDOW_S} s of a high ` +
          "regain, and their xG (the sim's distance model, see Shot quality).",
        source: "sim",
        sourceNote: MODELLED,
      },
    ],
    limits:
      "Open play in the sim changes hands on interceptions only; tackles exist in the pressure " +
      "moment, and there are no fouls, challenges or duels anywhere (docs/NUMBERS.md M4). So " +
      "PPDA here counts interceptions and tackles, not the usual defensive actions, and a short " +
      "clip has too few passes for a stable value: read it over the match.",
    moment: link("pressure"),
    here: view.scenario === "press_escape",
    watch: first ? { label: "Watch the first high regain", frame: first.frame } : null,
    empty: events.some((e) => e.type === "pass" || e.type === "interception" || e.type === "tackle")
      ? null
      : "This view has no passes or regains yet.",
  };
}

function decisions(hero: Hero, view: Context): LabCard {
  const run = hero.runs.factual;
  const lanes = lanesAt(hero, run);
  const chosen = lanes.find((l) => l.chosen) ?? null;
  const counts = laneCounts(lanes);
  const action = run.action;
  const outcome = action?.outcome ?? null;
  const metrics: Metric[] = [];
  if (run.decision && lanes.length) {
    metrics.push(
      {
        label: "Pass lanes open · blocked",
        values: [`${counts.open} · ${counts.blocked}`],
        definition:
          `Among his top options, a lane is open when the pass would have arrived at least ` +
          `${Math.round(OPEN_P * 100)}% of the time on the true state at the decision; ` +
          "otherwise blocked.",
        source: "sim",
        sourceNote: MODELLED,
      },
      {
        label: "Pressure on the receiver he chose",
        values: [chosen?.pressure == null ? dash : `${chosen.pressure.toFixed(1)} m`],
        definition:
          "Distance from the receiver to the nearest opponent at the decision frame, from the " +
          "tracking. A smaller distance is more pressure.",
        source: "tracking",
        sourceNote: TRACKING("Measured"),
      },
      {
        label: "He thought · it was",
        values: [
          chosen
            ? `${chosen.pBelief.toFixed(2)} · ${chosen.pTrue === null ? "not playable" : chosen.pTrue.toFixed(2)}`
            : dash,
        ],
        definition:
          "His chance of the chosen pass arriving as he saw it, and as it really was on the " +
          "truth at that moment.",
        source: "sim",
        sourceNote: MODELLED,
      },
      {
        label: "Outcome",
        values: [
          outcome
            ? `${chosen ? chosen.label : "Pass"}: ${outcome}${action?.receiver ? ` (${shortName(action.receiver)})` : ""}`
            : dash,
        ],
        definition: "How the ball he played ended in the run: complete, intercepted or out.",
        source: "sim",
        sourceNote: MODELLED,
      },
    );
  }
  return {
    id: "decisions",
    kicker: "Decisions · the pass out of a press",
    title: "Decisions under pressure",
    idea:
      "Under pressure a player chooses on what he believes, not on what is true. The lanes " +
      "that look open on his picture may be shut on the pitch; the card puts both side by side.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics,
    limits:
      "The decision model chooses at the hero moments only; elsewhere in the match a passing " +
      "rule plays the ball (SPEC 3.1). The lanes are the player's top options at his decision, " +
      "not every pass on the pitch.",
    moment: link("pressure"),
    here: view.scenario === "press_escape",
    watch: run.decision ? { label: "Watch the decision", frame: run.decision.frame } : null,
    empty: metrics.length
      ? null
      : hero.kind === "match"
        ? "The match has no decision to open here: its hero moments carry them."
        : "This moment has no decision on the ball.",
  };
}

function corners(hero: Hero, view: Context): LabCard {
  const events = hero.runs.factual.events;
  const metrics: Metric[] = [];
  const marker = hero.marker;
  if (marker) {
    const sep = marker.separation;
    metrics.push(
      {
        label: "Marker to his man when the pass arrived",
        values: [
          `${sep.factual.toFixed(1)} m with the look · ${sep.counterfactual.toFixed(1)} m without`,
        ],
        definition:
          "The corner's marker's distance to the runner he marks at the frame the pass to the " +
          "runner is received or cut out, in the run with his key scan and in the run without it.",
        source: "tracking",
        sourceNote: TRACKING("Measured"),
      },
      {
        label: "How the pass ended",
        values: [
          `${marker.resolved.factual.type} with the look · ${marker.resolved.counterfactual.type} without`,
        ],
        definition: "The event that ended the cutback in each run: reception, interception or out.",
        source: "sim",
        sourceNote: MODELLED,
      },
    );
  }
  if (hero.match) {
    const taken = hero.match.possessions.filter((p) => p.restart === "corner");
    const cornerPossession = new Set(taken.map((p) => p.index));
    const shotIds = new Set(
      events
        .filter((e) => e.type === "shot" && cornerPossession.has(e.possession ?? -1))
        .map((e) => e.id),
    );
    const fromCorners = TEAM_IDS.flatMap((t) => shotQuality(events, t).list).filter((s) =>
      shotIds.has(s.id),
    );
    metrics.push({
      label: "Corners · shots from them · xG",
      values: [
        `${taken.length} · ${fromCorners.length} · ${fixed(fromCorners.reduce((s, x) => s + x.xg, 0))}`,
      ],
      definition:
        "Possessions that began from a corner, the shots taken in those possessions, and their " +
        "xG (the sim's distance model).",
      source: "sim",
      sourceNote: MODELLED,
    });
  }
  const corner = hero.match?.possessions.find((p) => p.restart === "corner");
  return {
    id: "corners",
    kicker: "Set pieces · the short corner",
    title: "Corners",
    idea:
      "A corner is a rehearsed passage, so one look can decide it: a marker who checks over his " +
      "shoulder before the ball is played keeps his man; one who does not loses him.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics,
    limits:
      "A corner's passage ends after its cutback and the stitched match cuts it before a shot " +
      "could follow (SPEC 3.1); the row counts what the match's events hold. Crosses and " +
      "headers are not modelled.",
    moment: link("corner"),
    here: view.scenario === "corner_blind_side",
    watch: marker
      ? { label: "Watch the cutback", frame: marker.pass.frame }
      : corner
        ? { label: `Watch the first corner (${clock(corner.start / FPS)})`, frame: corner.start }
        : null,
    empty: metrics.length ? null : "No corner in this view.",
  };
}

function shot_quality(hero: Hero, view: Context): LabCard {
  const events = hero.runs.factual.events;
  const [home, away] = TEAM_IDS.map((t) => shotQuality(events, t));
  const all = [...home.list, ...away.list].sort((a, b) => b.xg - a.xg);
  return {
    id: "shot_quality",
    kicker: "Finishing · where the shot is taken",
    title: "Shot quality",
    idea:
      "A shot from close and central is worth far more than one from range: the same number of " +
      "shots is a different attack depending on where they are struck, so teams work the ball " +
      "to a better place first.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics: [
      {
        label: "Shots",
        values: each((t) => String((t ? away : home).shots)),
        definition: "Shot events in the feed, by the team that took them.",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "xG",
        values: each((t) => fixed((t ? away : home).xg)),
        definition:
          "Expected goals of an unplaced shot at d metres from the centre of the goal it " +
          `attacks: the smaller of ${XG_CAP} and ${XG_PEAK} · e^(−(d − ${XG_D0}) / ${XG_SCALE}), the sim's distance model ` +
          "(sim/decision.py), summed over the team's shots.",
        source: "sim",
        sourceNote: MODELLED,
      },
      {
        label: "xG per shot",
        values: each((t) => fixed((t ? away : home).perShot)),
        definition: "xG divided by shots; a dash means no shot.",
        source: "sim",
        sourceNote: MODELLED,
      },
    ],
    limits:
      "The distance model sees only where the ball was kicked from. The far-post finish moment " +
      "is decided by a placed-shot model (keeper, aim and sight) that this xG does not use, " +
      "so its chance of scoring is told in the moment itself, not here.",
    moment: link("goal"),
    here: view.scenario === "far_post_finish",
    watch: all[0] ? { label: "Watch the best chance", frame: all[0].frame } : null,
    empty: all.length ? null : "No shot in this view.",
  };
}

function progression_card(hero: Hero, view: Context): LabCard {
  const events = hero.runs.factual.events;
  const xt = view.xt;
  const [home, away] = xt ? TEAM_IDS.map((t) => progression(events, t, xt)) : [null, null];
  const best = [home?.best, away?.best]
    .filter((b): b is NonNullable<typeof b> => !!b)
    .sort((a, b) => b.xt - a.xt)[0];
  const stat = (f: (p: NonNullable<typeof home>) => string) =>
    each((t) => {
      const p = t ? away : home;
      return p ? f(p) : dash;
    });
  return {
    id: "progression",
    kicker: "Build-up · moving the ball into danger",
    title: "Progression",
    idea:
      "A pass is worth what it does to the threat: moving the ball from a cold place to a " +
      "dangerous one adds expected threat, and the passes that add the most are the ones that " +
      "break lines, which is why teams look for them.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics: [
      {
        label: "Passes · completed",
        values: stat((p) => `${p.passes} · ${p.completed}`),
        definition: "Passes kicked and passes received by a team-mate, by the kicker's team.",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "xT added",
        values: stat((p) => signed(p.xtAdded)),
        definition:
          "Expected threat (Singh, 2019) where each completed pass was received minus where it " +
          "was kicked, for the team that kicked it, summed. xT is our own grid, fitted on the " +
          "sim's open play (analytics/xt.py).",
        source: "tracking",
        sourceNote: TRACKING("Computed"),
      },
      {
        label: "Progressive passes",
        values: stat((p) => String(p.progressive)),
        definition: "Completed passes that added expected threat (above zero).",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "Best pass",
        values: stat((p) =>
          p.best
            ? `${shortName(p.best.player)} → ${shortName(p.best.receiver ?? "?")} ${signed(p.best.xt)}`
            : dash,
        ),
        definition: "The completed pass that added the most expected threat.",
        source: "tracking",
        sourceNote: TRACKING("Computed"),
      },
    ],
    limits:
      "xT credits only passes that were received: a lost pass adds nothing here (the match's " +
      "tactics card counts it as the threat handed over). In open play the sim's passing rule " +
      "rarely reaches the final third, so most gains are small.",
    moment: link("look"),
    here: view.scenario === "blind_side_run",
    watch: best ? { label: "Watch the best pass", frame: best.frame } : null,
    empty: !xt
      ? "The xT grid is loading."
      : events.some((e) => e.type === "pass")
        ? null
        : "No pass in this view.",
  };
}

export interface Context {
  scenario: string;
  xt: XtGrid | null;
}

const scopeOf = (hero: Hero): LabCard["scope"] =>
  hero.kind === "match" ? "this match" : "this moment";

const BUILDERS: Record<CardId, (hero: Hero, view: Context) => LabCard> = {
  high_press,
  decisions,
  corners,
  shot_quality,
  progression: progression_card,
};

/** A value with nothing in it: zero, a dash, or only zeros ("0 · 0.00"). */
export const isBlank = (v: string): boolean => /^[\s0.·–+−-]*$/.test(v);

const ZERO_WHY = "Nothing of this in the data for this view.";

/** True when no metric has a value to lead with. */
const nothingToShow = (c: LabCard): boolean =>
  c.metrics.every((m) => m.values.every(isBlank)) && (c.metrics.length > 0 || c.empty !== null);

/**
 * A card never leads with zeros or dashes: the metrics that have a value come first, the ones that
 * do not follow with one line on why (their `zeroWhy`), and a card with nothing but those says
 * so instead of printing a table of them.
 */
export function leadWithValues(card: LabCard): LabCard {
  const has = (m: Metric) => m.values.some((v) => !isBlank(v));
  const live = card.metrics.filter(has).map(({ zeroWhy: _, ...m }) => m);
  const blank = card.metrics
    .filter((m) => !has(m))
    .map((m) => ({ ...m, zeroWhy: m.zeroWhy ?? ZERO_WHY }));
  if (!live.length && card.metrics.length) {
    return {
      ...card,
      metrics: blank,
      empty: card.empty ?? `Nothing to measure on ${card.measured}. ${blank[0].zeroWhy}`,
    };
  }
  return { ...card, metrics: [...live, ...blank] };
}

/** The card for `id`, measured on the moment that shows its tactic (see scope.ts). */
function scoped(id: CardId, session: Hero, xt: XtGrid | null, scope: Scope): LabCard {
  const want = CARD_SCENARIO[id];
  const moment = link(CARD_MOMENT[id]);
  const view: Context = { scenario: session.kind === "hero" ? session.scenario : "match", xt };
  const hero = session.kind === "match" || session.scenario === want ? session : scope.heroes[want];
  if (!hero) {
    return {
      ...BUILDERS[id](session, view),
      measured: `${moment.label} (${want})`,
      scope: "this moment",
      metrics: [],
      watch: null,
      here: false,
      empty: scope.loading
        ? `Loading ${moment.label.toLowerCase()}, the moment that shows this tactic…`
        : scope.online
          ? `${moment.label} (${want}) could not be loaded from the service: open it from the link below.`
          : `This card measures ${moment.label.toLowerCase()} (${want}), which needs the live service: only ${session.scenario} is bundled.`,
    };
  }
  const on = (h: Hero, measured: string): LabCard => {
    const card = BUILDERS[id](h, view);
    return leadWithValues({ ...card, measured, watch: h === session ? card.watch : null });
  };
  const own = session.kind === "match" ? "this match" : `${moment.label} (${want})`;
  const card = on(hero, own);
  if (!nothingToShow(card) || !scope.match || hero === scope.match) return card;
  // The moment holds none of what the card measures: the whole stitched match does, or says so.
  const wide = on(
    scope.match,
    `the whole stitched match (${FULL_MATCH}), as ${own} holds none of it`,
  );
  return nothingToShow(wide) ? card : wide;
}

/**
 * The five cards. On a hero moment each is measured on the moment that shows its tactic, whichever
 * one the page opened on, from `scope`; a match page's cards are measured on the match.
 */
export function buildCards(hero: Hero, xt: XtGrid | null, scope: Scope = NO_SCOPE): LabCard[] {
  return CARD_IDS.map((id) => scoped(id, hero, xt, scope));
}
